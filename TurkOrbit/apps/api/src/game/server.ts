/**
 * Türk Orbit gerçek zamanlı oyun sunucusu (Aşama 8).
 *
 * Sunucu otoritelidir: istemci yalnızca niyet gönderir (yön, hedef nokta, geçit). Konumu sunucu
 * 20 Hz sabit adımla hesaplar ve 10 Hz anlık görüntü yollar. Ayrıntılı tasarım:
 * Documentation/02-Teknik-Mimari.md §4 ve Documentation/Asama-08-Multiplayer/Protokol.md
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import {
  clientMessageSchema,
  CLOSE_CODES,
  DETECTION,
  IDLE_INPUT,
  PROTOCOL_VERSION,
  sanitizeInput,
  selfState,
  SNAPSHOT_EVERY,
  stepShip,
  TICK_MS,
  type EntityInfo,
  type EntityState,
  type MapResponse,
  type MoveInput,
  type ServerMessage,
  type ShipState,
} from '@turkorbit/shared';
import type { Redis } from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';
import type { Db } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../modules/auth/service.js';
import { GAME_CHANNELS, GAME_KEYS, GameBridge, PRESENCE_TTL_SECONDS, type Presence } from '../modules/game/bridge.js';
import { activeShipStats } from '../modules/hangar/stats.js';
import { WorldService } from '../modules/world/service.js';

const DT = TICK_MS / 1000;
/**
 * Sunucuda bekleyen en fazla girdi (1 sn). Sunucu her tikte en fazla bir girdi işler; fazlası en eskiden atılır.
 * Böylece gerçek zamandan hızlı girdi gönderen (hız hilesi) istemci fazladan adım atamaz.
 */
const MAX_QUEUE = 20;
/** Girdi gelmeyen tiklerde son girdi tekrarlanır; en fazla bu kadar "borç" tutulur (geç gelen girdiyle ödenir) */
const MAX_DEBT = 4;
/** Bağlantı başına saniyede en fazla mesaj (istemci 20 girdi + ping gönderir) */
const MAX_MESSAGES_PER_SECOND = 60;
const AOI_CELL = 2000;

export interface GameServerOptions {
  db: Db;
  /** Komutlar için Redis bağlantısı */
  redis: Redis;
  /** Abonelik için ayrı Redis bağlantısı (SUBSCRIBE modundaki bağlantı komut çalıştıramaz) */
  sub: Redis;
  log: Logger;
  allowedOrigins: string[];
  lingerSeconds: number;
  /** false: tik döngüsü ve zamanlayıcılar başlatılmaz; testler tick()/saveAll() çağırır */
  autoTick?: boolean;
  helloTimeoutMs?: number;
  saveIntervalMs?: number;
  sessionCheckMs?: number;
  mapCheckMs?: number;
}

interface QueuedInput {
  seq: number;
  input: MoveInput;
}

interface Room {
  code: string;
  width: number;
  height: number;
  stations: Array<{ x: number; y: number; r: number }>;
  players: Map<number, Player>;
}

interface Player {
  entityId: number;
  playerId: string;
  userId: string;
  sessionId: string;
  info: EntityInfo;
  ws: WebSocket | null;
  connId: string;
  room: Room;
  map: MapResponse;
  state: ShipState;
  speed: number;
  radar: number;
  queue: QueuedInput[];
  lastInput: MoveInput;
  lastSeq: number;
  debt: number;
  missing: number;
  visible: Set<number>;
  station: boolean;
  dirty: boolean;
  lingerUntil: number | null;
  /** welcome gönderilene kadar false: bu sürede anlık görüntü gönderilmez (istemci önce haritayı almalı) */
  ready: boolean;
  jumping: boolean;
  msgWindow: { start: number; count: number; strikes: number };
}

const send = (ws: WebSocket | null, msg: ServerMessage) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

export class GameServer {
  readonly instanceId = randomUUID();
  private readonly world: WorldService;
  private readonly bridge: GameBridge;
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private rooms = new Map<string, Room>();
  /** Bu süreçte kabul edilen bağlantılar (kendi yayınladığımız tek-oturum mesajını yok saymak için) */
  private localConns = new Set<string>();
  private byPlayer = new Map<string, Player>();
  private nextEntityId = 1;
  private tickNo = 0;
  private timers: NodeJS.Timeout[] = [];
  private loopTimer: NodeJS.Timeout | null = null;
  private nextTickAt = 0;
  private closing = false;
  /** Bağlantı başına ilk mesaj (hello) bekleyen soketler */
  private pending = new Set<WebSocket>();

  constructor(private readonly o: GameServerOptions) {
    this.world = new WorldService(o.db, o.log);
    this.bridge = new GameBridge(o.redis, o.log);
  }

  // ================================================================== yaşam döngüsü
  async listen(port: number, host = '0.0.0.0'): Promise<number> {
    this.http = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: !this.closing, players: this.byPlayer.size, rooms: this.rooms.size, tick: this.tickNo }));
        return;
      }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({ server: this.http, path: '/game', maxPayload: 4096 });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    await this.subscribe();
    if (this.o.autoTick !== false) this.startTimers();
    await new Promise<void>((resolve) => this.http!.listen(port, host, resolve));
    const addr = this.http.address();
    return typeof addr === 'object' && addr ? addr.port : port;
  }

  private startTimers() {
    this.nextTickAt = performance.now() + TICK_MS;
    const loop = () => {
      let n = 0;
      const now = performance.now();
      while (now >= this.nextTickAt && n < 5) {
        this.tick();
        this.nextTickAt += TICK_MS;
        n++;
      }
      // Sunucu çok geride kaldıysa (ör. uzun GC duraklaması) yakalamaya çalışmaz, ileri atlar.
      if (now - this.nextTickAt > 250) this.nextTickAt = now + TICK_MS;
      this.loopTimer = setTimeout(loop, Math.max(0, this.nextTickAt - performance.now()));
    };
    this.loopTimer = setTimeout(loop, TICK_MS);
    this.timers.push(
      setInterval(() => void this.saveAll(), this.o.saveIntervalMs ?? 5000),
      setInterval(() => void this.checkSessions(), this.o.sessionCheckMs ?? 30_000),
      setInterval(() => void this.checkMaps(), this.o.mapCheckMs ?? 15_000),
    );
  }

  async close() {
    this.closing = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    for (const t of this.timers) clearInterval(t);
    for (const p of this.byPlayer.values()) {
      if (p.ws) p.ws.close(CLOSE_CODES.SHUTDOWN, 'Sunucu yeniden başlatılıyor');
      p.dirty = true;
    }
    await this.saveAll();
    await Promise.all([...this.byPlayer.values()].map((p) => this.o.redis.del(GAME_KEYS.presence(p.playerId)).catch(() => 0)));
    for (const ws of this.pending) ws.close(CLOSE_CODES.SHUTDOWN, 'Sunucu yeniden başlatılıyor');
    await this.o.sub.unsubscribe().catch(() => undefined);
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
  }

  get stats() {
    return { players: this.byPlayer.size, rooms: this.rooms.size, tick: this.tickNo };
  }

  // ================================================================== bağlantı ve kimlik doğrulama
  private onConnection(ws: WebSocket, req: IncomingMessage) {
    const origin = req.headers.origin;
    // Tarayıcı Origin başlığı gönderir: izinli değilse (başka sitenin sayfası) reddedilir. Bilet zaten zorunludur.
    if (origin && !this.o.allowedOrigins.includes(origin)) {
      ws.close(CLOSE_CODES.AUTH_FAILED, 'Kaynak izinli değil');
      return;
    }
    this.pending.add(ws);
    const timer = setTimeout(() => {
      this.pending.delete(ws);
      ws.close(CLOSE_CODES.HELLO_TIMEOUT, 'Kimlik doğrulama zaman aşımı');
    }, this.o.helloTimeoutMs ?? 5000);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      void this.onHello(ws, raw.toString()).catch((err: unknown) => {
        this.o.log.error({ err }, 'oyuna giriş hatası');
        ws.close(CLOSE_CODES.PROTOCOL, 'Giriş başarısız');
      });
    });
    ws.on('close', () => {
      clearTimeout(timer);
      this.pending.delete(ws);
    });
    ws.on('error', () => undefined);
  }

  private async onHello(ws: WebSocket, raw: string) {
    let msg;
    try {
      msg = clientMessageSchema.parse(JSON.parse(raw));
    } catch {
      return ws.close(CLOSE_CODES.PROTOCOL, 'Geçersiz mesaj');
    }
    if (msg.t !== 'hello') return ws.close(CLOSE_CODES.PROTOCOL, 'Önce hello gönderilmeli');
    if (msg.v !== PROTOCOL_VERSION) return ws.close(CLOSE_CODES.VERSION, 'Oyun güncellendi. Sayfayı yenile.');
    const ticket = await this.bridge.consumeTicket(msg.ticket);
    if (!ticket) return ws.close(CLOSE_CODES.AUTH_FAILED, 'Oyun biletin geçersiz veya süresi dolmuş');
    if (!(await this.sessionValid([ticket.sessionId])).has(ticket.sessionId)) {
      return ws.close(CLOSE_CODES.SESSION_ENDED, 'Oturumun geçerli değil. Tekrar giriş yap.');
    }
    if (ws.readyState !== WebSocket.OPEN || this.closing) return;
    this.pending.delete(ws);

    const connId = randomUUID();
    this.localConns.add(connId);
    ws.once('close', () => this.localConns.delete(connId));
    // Tek aktif oyun oturumu: diğer süreçlerdeki eski bağlantılar da kapanır (Redis pub/sub).
    // Bu süreçteki eski bağlantı aşağıda doğrudan devralınır.
    await this.o.redis.set(GAME_KEYS.session(ticket.playerId), connId, 'EX', 24 * 3600);
    await this.o.redis.publish(GAME_CHANNELS.kick, JSON.stringify({ playerId: ticket.playerId, connId }));

    let p = this.byPlayer.get(ticket.playerId);
    if (p) {
      // Aynı pilot bu süreçte zaten var (başka cihazda açık ya da bağlantısı yeni koptu): gemi devralınır.
      if (p.ws && p.ws !== ws) this.kickConnection(p, CLOSE_CODES.REPLACED, 'Hesabınla başka bir cihazdan oyuna girildi.');
      p.ready = false;
      p.ws = ws;
      p.connId = connId;
      p.userId = ticket.userId;
      p.sessionId = ticket.sessionId;
      p.lingerUntil = null;
      p.queue = [];
      p.lastSeq = 0;
      p.debt = 0;
      p.lastInput = IDLE_INPUT;
      p.visible.clear();
      await this.reloadStats(p, false);
    } else {
      const { map } = await this.world.enterWorld(ticket.playerId);
      if (ws.readyState !== WebSocket.OPEN) return;
      p = this.createPlayer(ticket, ws, connId, map);
      this.byPlayer.set(p.playerId, p);
      this.joinRoom(p, map);
      await this.o.db.query('UPDATE players SET last_online_at = now() WHERE id = $1', [p.playerId]);
    }
    await this.writePresence(p);
    if (ws.readyState !== WebSocket.OPEN || p.ws !== ws) return;
    // Sıra önemli: önce welcome (harita), sonra anlık görüntüler. Aradaki await'lerde tik gelse bile
    // ready=false olduğundan bu bağlantıya henüz snap/enter gönderilmez.
    p.visible.clear();
    p.ready = true;
    send(ws, { t: 'welcome', id: p.entityId, tick: this.tickNo, tickMs: TICK_MS, map: p.map, you: selfState(p.state) });
    if (p.map.notice) send(ws, { t: 'notice', kind: 'info', text: p.map.notice });
    p.map = { ...p.map, notice: null };
    this.o.log.info({ playerId: p.playerId, map: p.room.code, entityId: p.entityId }, 'oyuna girdi');

    const player = p;
    ws.on('message', (data) => this.onMessage(player, ws, data.toString()));
    ws.on('close', () => this.onClose(player, ws));
  }

  private createPlayer(t: { playerId: string; userId: string; sessionId: string }, ws: WebSocket, connId: string, map: MapResponse): Player {
    const entityId = this.nextEntityId++;
    return {
      entityId,
      playerId: t.playerId,
      userId: t.userId,
      sessionId: t.sessionId,
      info: {
        id: entityId,
        n: map.pilot.pilotName,
        cc: map.pilot.company.code,
        c: map.pilot.company.colorHex,
        s: map.pilot.ship.spriteKey,
        l: map.pilot.level,
      },
      ws,
      connId,
      room: null as unknown as Room,
      map,
      state: { x: map.position.x, y: map.position.y, vx: 0, vy: 0, h: -Math.PI / 2 },
      speed: map.pilot.ship.speed,
      radar: map.rules.detection.radar,
      queue: [],
      lastInput: IDLE_INPUT,
      lastSeq: 0,
      debt: 0,
      missing: 0,
      visible: new Set(),
      station: false,
      dirty: false,
      lingerUntil: null,
      ready: false,
      jumping: false,
      msgWindow: { start: 0, count: 0, strikes: 0 },
    };
  }

  private kickConnection(p: Player, code: number, message: string) {
    const ws = p.ws;
    if (!ws) return;
    p.ws = null;
    send(ws, { t: 'kick', code, message });
    ws.close(code, message.slice(0, 100));
  }

  // ================================================================== mesajlar
  private onMessage(p: Player, ws: WebSocket, raw: string) {
    if (p.ws !== ws) return; // devralınmış eski bağlantı
    const now = Date.now();
    const w = p.msgWindow;
    if (now - w.start >= 1000) {
      if (w.count > MAX_MESSAGES_PER_SECOND) w.strikes++;
      w.start = now;
      w.count = 0;
    }
    if (++w.count > MAX_MESSAGES_PER_SECOND * 2 || w.strikes >= 3) {
      this.kickConnection(p, CLOSE_CODES.RATE_LIMITED, 'Çok fazla mesaj gönderildi.');
      return;
    }
    let msg;
    try {
      msg = clientMessageSchema.parse(JSON.parse(raw));
    } catch {
      return; // bozuk mesaj yok sayılır (bağlantı kopmaz)
    }
    switch (msg.t) {
      case 'in':
        for (const cmd of msg.i) {
          const last = p.queue.length ? p.queue[p.queue.length - 1]!.seq : p.lastSeq;
          if (cmd[0] <= last) continue; // tekrar/eski girdi
          p.queue.push({ seq: cmd[0], input: sanitizeInput(cmd, p.room.width, p.room.height) });
        }
        while (p.queue.length > MAX_QUEUE) {
          const dropped = p.queue.shift()!;
          p.lastSeq = dropped.seq;
          p.lastInput = dropped.input;
        }
        break;
      case 'jump':
        void this.jump(p, msg.p);
        break;
      case 'ping':
        send(ws, { t: 'pong', c: msg.c, s: now });
        break;
      case 'hello':
        break;
    }
  }

  private onClose(p: Player, ws: WebSocket) {
    if (p.ws !== ws) return;
    p.ws = null;
    p.dirty = true;
    p.queue = [];
    p.lastInput = p.lastInput.m === 2 ? p.lastInput : IDLE_INPUT;
    void this.savePlayers([p]);
    if (this.o.lingerSeconds > 0 && !this.closing) {
      // Gemi bir süre haritada kalır (savaştan bağlantı keserek kaçılamaz); bu sürede geri dönülürse devam eder.
      p.lingerUntil = Date.now() + this.o.lingerSeconds * 1000;
    } else {
      void this.removePlayer(p);
    }
  }

  private async removePlayer(p: Player) {
    if (this.byPlayer.get(p.playerId) !== p) return;
    this.byPlayer.delete(p.playerId);
    this.leaveRoom(p);
    p.dirty = true;
    await this.savePlayers([p]);
    await this.o.db.query('UPDATE players SET last_online_at = now() WHERE id = $1', [p.playerId]).catch(() => undefined);
    await this.o.redis.del(GAME_KEYS.presence(p.playerId)).catch(() => 0);
    this.o.log.info({ playerId: p.playerId }, 'oyundan çıktı');
  }

  // ================================================================== odalar (harita = oda)
  private joinRoom(p: Player, map: MapResponse) {
    let room = this.rooms.get(map.map.code);
    if (!room) {
      room = {
        code: map.map.code,
        width: map.map.width,
        height: map.map.height,
        stations: map.zones.filter((z) => z.zoneType === 'station').map((z) => ({ x: z.x, y: z.y, r: z.r })),
        players: new Map(),
      };
      this.rooms.set(room.code, room);
    }
    p.room = room;
    p.map = map;
    room.players.set(p.entityId, p);
    p.station = this.inStation(p);
  }

  private leaveRoom(p: Player) {
    const room = p.room;
    if (!room) return;
    room.players.delete(p.entityId);
    // Odadaki diğer oyuncular bir sonraki anlık görüntüde AOI farkıyla "leave" alır.
    if (room.players.size === 0) this.rooms.delete(room.code);
  }

  private inStation(p: Player) {
    return p.room.stations.some((s) => Math.hypot(s.x - p.state.x, s.y - p.state.y) <= s.r);
  }

  // ================================================================== simülasyon
  /** Bir sunucu adımı (50 ms). Her SNAPSHOT_EVERY adımda anlık görüntü gönderilir. */
  tick() {
    this.tickNo++;
    const now = Date.now();
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) {
        if (p.lingerUntil !== null && now >= p.lingerUntil) {
          void this.removePlayer(p);
          continue;
        }
        this.stepPlayer(p);
      }
    }
    if (this.tickNo % SNAPSHOT_EVERY === 0) this.broadcast();
  }

  private stepPlayer(p: Player) {
    let cmd = p.queue.shift();
    // Geç gelen girdiler, daha önce girdisiz geçen (tahminle tekrarlanan) adımların borcunu öder.
    while (cmd && p.debt > 0) {
      p.lastInput = cmd.input;
      p.lastSeq = cmd.seq;
      p.debt--;
      cmd = p.queue.shift();
    }
    if (cmd) {
      p.lastInput = cmd.input;
      p.lastSeq = cmd.seq;
      p.missing = 0;
    } else if (p.ws) {
      p.missing++;
      if (p.missing <= MAX_DEBT) p.debt = Math.min(p.debt + 1, MAX_DEBT);
      else {
        p.debt = 0;
        // İstemci girdi göndermeyi bıraktı (sekme arka planda, bağlantı sorunu): yön girdisi durdurulur.
        if (p.lastInput.m === 1) p.lastInput = IDLE_INPUT;
      }
    }
    const bx = p.state.x;
    const by = p.state.y;
    stepShip(p.state, p.lastInput, DT, p.speed, p.room.width, p.room.height);
    if (p.state.x !== bx || p.state.y !== by) {
      p.dirty = true;
      const st = this.inStation(p);
      if (st !== p.station) {
        p.station = st;
        void this.writePresence(p);
      }
    }
  }

  /** İlgi alanı (AOI): her oyuncuya yalnızca radar menzilindeki diğer gemiler gönderilir. */
  private broadcast() {
    for (const room of this.rooms.values()) {
      const grid = new Map<string, Player[]>();
      for (const p of room.players.values()) {
        const key = `${Math.floor(p.state.x / AOI_CELL)}:${Math.floor(p.state.y / AOI_CELL)}`;
        const cell = grid.get(key);
        if (cell) cell.push(p);
        else grid.set(key, [p]);
      }
      for (const p of room.players.values()) {
        if (!p.ws || !p.ready) continue;
        const seen = new Set<number>();
        const entities: EntityState[] = [];
        const entered: EntityInfo[] = [];
        const span = Math.ceil(p.radar / AOI_CELL);
        const cx = Math.floor(p.state.x / AOI_CELL);
        const cy = Math.floor(p.state.y / AOI_CELL);
        for (let gx = cx - span; gx <= cx + span; gx++) {
          for (let gy = cy - span; gy <= cy + span; gy++) {
            for (const o of grid.get(`${gx}:${gy}`) ?? []) {
              if (o === p) continue;
              if (Math.hypot(o.state.x - p.state.x, o.state.y - p.state.y) > p.radar) continue;
              seen.add(o.entityId);
              if (!p.visible.has(o.entityId)) entered.push(o.info);
              entities.push([o.entityId, Math.round(o.state.x), Math.round(o.state.y), Math.round(o.state.h * 100) / 100, Math.round(o.state.vx), Math.round(o.state.vy)]);
            }
          }
        }
        const left = [...p.visible].filter((id) => !seen.has(id));
        p.visible = seen;
        if (entered.length) send(p.ws, { t: 'enter', e: entered });
        if (left.length) send(p.ws, { t: 'leave', e: left });
        // Yavaş bağlantıda arabellek şişerse anlık görüntü atlanır (bir sonraki zaten tam durumu taşır).
        if (p.ws.bufferedAmount > 512 * 1024) continue;
        send(p.ws, { t: 'snap', k: this.tickNo, a: p.lastSeq, y: selfState(p.state), e: entities });
      }
    }
  }

  // ================================================================== geçit
  private async jump(p: Player, portalId: number) {
    if (p.jumping) return;
    p.jumping = true;
    try {
      const map = await this.world.jumpForGame(p.playerId, portalId, { x: p.state.x, y: p.state.y });
      this.moveToMap(p, map, 'portal');
    } catch (err) {
      if (err instanceof AppError) send(p.ws, { t: 'error', code: err.code, message: err.message });
      else {
        this.o.log.error({ err, playerId: p.playerId }, 'geçit hatası');
        send(p.ws, { t: 'error', code: 'INTERNAL_ERROR', message: 'Geçiş başarısız. Tekrar dene.' });
      }
    } finally {
      p.jumping = false;
    }
  }

  private moveToMap(p: Player, map: MapResponse, reason: 'portal' | 'map_closed') {
    this.leaveRoom(p);
    p.state = { x: map.position.x, y: map.position.y, vx: 0, vy: 0, h: p.state.h };
    if (p.queue.length) p.lastSeq = p.queue[p.queue.length - 1]!.seq;
    p.queue = [];
    p.debt = 0;
    p.lastInput = IDLE_INPUT;
    p.visible.clear();
    p.speed = map.pilot.ship.speed;
    p.radar = map.rules.detection.radar;
    this.joinRoom(p, map);
    send(p.ws, { t: 'map', tick: this.tickNo, map, you: selfState(p.state), reason });
    if (map.notice) send(p.ws, { t: 'notice', kind: 'info', text: map.notice });
    p.map = { ...map, notice: null };
    void this.writePresence(p);
  }

  // ================================================================== canlı değişiklikler (Redis)
  private async subscribe() {
    await this.o.sub.subscribe(GAME_CHANNELS.kick, GAME_CHANNELS.playerUpdated);
    this.o.sub.on('message', (channel: string, raw: string) => {
      let data: { playerId?: string; connId?: string };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        return;
      }
      const p = data.playerId ? this.byPlayer.get(data.playerId) : undefined;
      if (!p) return;
      if (channel === GAME_CHANNELS.kick && data.connId && !this.localConns.has(data.connId) && p.connId !== data.connId) {
        // Başka bir süreç (veya bu süreç) aynı pilot için yeni bağlantı kabul etti.
        this.kickConnection(p, CLOSE_CODES.REPLACED, 'Hesabınla başka bir cihazdan oyuna girildi.');
        void this.removePlayer(p);
      } else if (channel === GAME_CHANNELS.playerUpdated) {
        void this.reloadStats(p, true);
      }
    });
  }

  /** Hangarda ekipman/gemi/konfigürasyon değişince hız, can, kalkan ve radar canlı güncellenir. */
  private async reloadStats(p: Player, notify: boolean) {
    const ship = await activeShipStats(this.o.db, p.playerId);
    if (!ship) return;
    p.speed = ship.stats.speed;
    p.radar = DETECTION.baseRadar + (ship.stats.radarBonus ?? 0);
    const shipInfo = {
      name: ship.name,
      spriteKey: ship.spriteKey,
      hitpoints: ship.hitpoints,
      maxHitpoints: ship.maxHitpoints,
      shield: ship.stats.shield,
      speed: ship.stats.speed,
    };
    p.map = { ...p.map, pilot: { ...p.map.pilot, ship: shipInfo }, rules: { ...p.map.rules, detection: { ...p.map.rules.detection, radar: p.radar } } };
    p.info = { ...p.info, s: ship.spriteKey };
    if (notify) send(p.ws, { t: 'pilot', ship: shipInfo, radar: p.radar });
  }

  private async writePresence(p: Player) {
    const presence: Presence = { map: p.room.code, station: p.station, instance: this.instanceId, at: Date.now() };
    await this.o.redis.set(GAME_KEYS.presence(p.playerId), JSON.stringify(presence), 'EX', PRESENCE_TTL_SECONDS).catch((err: unknown) => {
      this.o.log.warn({ err, playerId: p.playerId }, 'çevrimiçi durum yazılamadı');
    });
  }

  // ================================================================== kalıcılık ve periyodik denetimler
  /** Konumlar her tikte değil, toplu olarak yazılır (varsayılan 5 sn; çıkışta hemen). */
  async saveAll() {
    await this.savePlayers([...this.byPlayer.values()].filter((p) => p.dirty));
    await Promise.all([...this.byPlayer.values()].map((p) => this.writePresence(p)));
  }

  private async savePlayers(list: Player[]) {
    const dirty = list.filter((p) => p.dirty);
    if (dirty.length === 0) return;
    for (const p of dirty) p.dirty = false;
    const values: unknown[] = [];
    const rows = dirty.map((p, i) => {
      values.push(p.playerId, p.state.x, p.state.y);
      return `($${i * 3 + 1}::uuid, $${i * 3 + 2}::real, $${i * 3 + 3}::real)`;
    });
    try {
      await this.o.db.query(
        `UPDATE players p SET pos_x = v.x, pos_y = v.y, pos_updated_at = now()
         FROM (VALUES ${rows.join(', ')}) AS v(id, x, y) WHERE p.id = v.id`,
        values,
      );
    } catch (err) {
      for (const p of dirty) p.dirty = true;
      this.o.log.error({ err }, 'konumlar kaydedilemedi');
    }
  }

  private async sessionValid(sessionIds: string[]): Promise<Set<string>> {
    if (sessionIds.length === 0) return new Set();
    const r = await this.o.db.query<{ id: string }>(
      `SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ANY($1::uuid[]) AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.status = 'active' AND u.email_verified_at IS NOT NULL`,
      [sessionIds],
    );
    return new Set(r.rows.map((x) => x.id));
  }

  /** Çıkış yapılan, parolası değişen veya yasaklanan hesabın oyun bağlantısı kapatılır. */
  async checkSessions() {
    const online = [...this.byPlayer.values()].filter((p) => p.ws);
    const valid = await this.sessionValid(online.map((p) => p.sessionId));
    for (const p of online) {
      if (!valid.has(p.sessionId)) {
        this.kickConnection(p, CLOSE_CODES.SESSION_ENDED, 'Oturumun sonlandırıldı. Tekrar giriş yap.');
        await this.removePlayer(p);
      }
    }
  }

  /** Yönetim Merkezi haritayı bakıma alırsa içerideki pilotlar şirket haritasına taşınır. */
  async checkMaps() {
    const occupied = new Map<string, Player[]>();
    for (const p of this.byPlayer.values()) {
      const list = occupied.get(p.room.code);
      if (list) list.push(p);
      else occupied.set(p.room.code, [p]);
    }
    if (occupied.size === 0) return;
    const r = await this.o.db.query<{ code: string }>('SELECT code FROM maps WHERE code = ANY($1::text[]) AND is_closed', [[...occupied.keys()]]);
    for (const { code } of r.rows) {
      for (const p of occupied.get(code) ?? []) {
        p.dirty = true;
        await this.savePlayers([p]);
        const { map, relocated } = await this.world.enterWorld(p.playerId);
        if (relocated) this.moveToMap(p, map, 'map_closed');
      }
    }
  }
}

