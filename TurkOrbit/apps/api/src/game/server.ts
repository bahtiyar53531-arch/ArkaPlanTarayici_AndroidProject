/**
 * Türk Orbit gerçek zamanlı oyun sunucusu (Aşama 8: hareket · Aşama 9: NPC ve savaş).
 *
 * Sunucu otoritelidir: istemci yalnızca niyet gönderir (yön, hedef nokta, geçit, hedef seçimi, ateş aç/kapa,
 * mühimmat seçimi, roket). Konum, hasar, menzil, atış hızı, mühimmat tüketimi, ölüm ve ödül yalnızca burada
 * hesaplanır. Tasarım: Documentation/02-Teknik-Mimari.md §4, Asama-08-Multiplayer/Protokol.md, Asama-09-NPC-Savas/
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import {
  AMMO_CODES,
  AMMO_LABELS,
  applyDamage,
  canAttack,
  clientMessageSchema,
  CLOSE_CODES,
  DETECTION,
  IDLE_INPUT,
  levelForXp,
  objectiveMatches,
  questCycles,
  PROTOCOL_VERSION,
  ROCKET_CODES,
  ROCKET_LABELS,
  rollDamage,
  rollRewards,
  sanitizeInput,
  selfState,
  splitRewards,
  SNAPSHOT_EVERY,
  stepShip,
  TICK_MS,
  volleyIntervalMs,
  type AmmoCode,
  type EntityInfo,
  type EntityState,
  type Fx,
  type MapResponse,
  type MoveInput,
  type ObjectiveType,
  type QuestEvent,
  type RocketCode,
  type RolledReward,
  type ServerMessage,
  type ShipState,
} from '@turkorbit/shared';
import type { Redis } from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';
import type { Db } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../modules/auth/service.js';
import { GAME_CHANNELS, GAME_KEYS, GameBridge, PRESENCE_TTL_SECONDS, type PlayerUpdateReason, type Presence } from '../modules/game/bridge.js';
import { activeShipStats } from '../modules/hangar/stats.js';
import { WorldService } from '../modules/world/service.js';
import { syncAchievements } from '../modules/player/achievements.js';
import { QuestService, type QuestInterest } from '../modules/quest/service.js';
import { GameContent, type NpcSpawn, type NpcType, type ResourceNodeGroup } from './content.js';
import { CombatStore, type GrantResult } from './persistence.js';

const DT = TICK_MS / 1000;
/**
 * Sunucuda bekleyen en fazla girdi (1 sn). Sunucu her tikte en fazla bir girdi işler; fazlası en eskiden atılır.
 * Böylece gerçek zamandan hızlı girdi gönderen (hız hilesi) istemci fazladan adım atamaz.
 */
const MAX_QUEUE = 20;
/** Girdi gelmeyen tiklerde son girdi tekrarlanır; en fazla bu kadar "borç" tutulur (geç gelen girdiyle ödenir) */
const MAX_DEBT = 4;
/** Bağlantı başına saniyede en fazla mesaj (istemci 20 girdi + ping + savaş niyetleri gönderir) */
const MAX_MESSAGES_PER_SECOND = 60;
const AOI_CELL = 2000;
/** Görev olayları bu kadar tikte bir toplu yazılır (1 sn) */
const QUEST_FLUSH_TICKS = 20;
/** NPC lazer efekti için mühimmat sırası yerine kullanılan değer */
const NPC_BEAM = 9;

export type Rng = () => number;

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
  /** Hasar varyansı, ödül zarı ve NPC dolaşımı için (testlerde sabitlenir) */
  rng?: Rng;
  /** Görev döngüleri (günlük/haftalık sıfırlama) için duvar saati (testlerde ayarlanır) */
  clock?: () => Date;
}

/** Pilotun görev durumu: yalnızca etkin hedeflerle eşleşen olaylar biriktirilir ve saniyede bir yazılır. */
interface QuestState {
  interests: QuestInterest[];
  types: Set<ObjectiveType>;
  cycle: string;
  resetHour: number;
  killMinShare: number;
  pending: Map<string, QuestEvent>;
  dist: number;
  loaded: boolean;
}

interface QueuedInput {
  seq: number;
  input: MoveInput;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

interface SpawnState {
  spawn: NpcSpawn;
  type: NpcType;
  alive: number;
  respawnAt: number[];
}

interface ResourceNode {
  entityId: number;
  uuid: string;
  group: ResGroupState;
  x: number;
  y: number;
  info: EntityInfo;
}

interface ResGroupState {
  group: ResourceNodeGroup;
  alive: number;
  respawnAt: number[];
}

interface Room {
  code: string;
  mapType: string;
  width: number;
  height: number;
  pvp: boolean;
  stations: Circle[];
  safeZones: Circle[];
  players: Map<number, Player>;
  npcs: Map<number, Npc>;
  cargo: Map<number, Cargo>;
  spawns: SpawnState[];
  /** Aşama 11: maden noktaları */
  resGroups: ResGroupState[];
  resources: Map<number, ResourceNode>;
  fx: Array<{ f: Fx; x: number; y: number }>;
}

interface Npc {
  entityId: number;
  type: NpcType;
  spawn: SpawnState;
  info: EntityInfo;
  state: ShipState;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  damage: number;
  target: Player | null;
  /** oyuncu kimliği → verdiği hasar (ödül en çok hasar verene) */
  aggro: Map<string, number>;
  nextAttackAt: number;
  wander: { x: number; y: number } | null;
  wanderAt: number;
  returning: boolean;
  kiteDir: 1 | -1;
  slowUntil: number;
  lastHitAt: number;
}

interface Cargo {
  entityId: number;
  uuid: string;
  info: EntityInfo;
  x: number;
  y: number;
  ownerId: string | null;
  ownerUntil: number;
  expiresAt: number;
  items: RolledReward[];
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
  // --- savaş (Aşama 9)
  company: string;
  shipId: string | null;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  absorb: number;
  lasers: number;
  laserDamage: number;
  laserInterval: number;
  laserRange: number;
  repairPerSec: number;
  target: number | null;
  attacking: boolean;
  ammo: AmmoCode;
  rocket: RocketCode;
  counts: Map<string, number>;
  pendingUse: Map<string, number>;
  flushSeq: number;
  nextLaserAt: number;
  rocketReadyAt: number;
  lastCombatAt: number;
  slowUntil: number;
  slowFactor: number;
  poison: { perTick: number; until: number; source: Npc } | null;
  dead: boolean;
  hpDirty: boolean;
  dealt: number;
  taken: number;
  csDirty: boolean;
  noticeAt: Map<string, number>;
  // --- görevler (Aşama 10)
  quest: QuestState;
  // --- madencilik (Aşama 11): ambardaki kaynak / kapasite
  cargoUsed: number;
  cargoCap: number;
}

const send = (ws: WebSocket | null, msg: ServerMessage) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : 0);

export class GameServer {
  readonly instanceId = randomUUID();
  private readonly world: WorldService;
  private readonly bridge: GameBridge;
  private readonly content = new GameContent();
  private readonly store: CombatStore;
  private readonly quests: QuestService;
  private readonly rng: Rng;
  private readonly clock: () => Date;
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private rooms = new Map<string, Room>();
  private roomLoading = new Map<string, Promise<Room>>();
  /** Bu süreçte kabul edilen bağlantılar (kendi yayınladığımız tek-oturum mesajını yok saymak için) */
  private localConns = new Set<string>();
  private byPlayer = new Map<string, Player>();
  private nextEntityId = 1;
  private tickNo = 0;
  /** Oyun zamanı (ms): tik sayısı × 50. Bekleme süreleri buna göre hesaplanır (testte elle ilerletilir). */
  private gameMs = 0;
  private timers: NodeJS.Timeout[] = [];
  private loopTimer: NodeJS.Timeout | null = null;
  private nextTickAt = 0;
  private closing = false;
  /** Bağlantı başına ilk mesaj (hello) bekleyen soketler */
  private pending = new Set<WebSocket>();
  /** Veritabanı işleri (ödül, ölüm) sırayla; tik döngüsünü bekletmez */
  private jobs: Promise<unknown> = Promise.resolve();
  /** Beklenmeden başlatılan arka plan işleri (kayıt, çıkış, geçit); kapanışta hepsi beklenir */
  private inflight = new Set<Promise<unknown>>();

  constructor(private readonly o: GameServerOptions) {
    this.world = new WorldService(o.db, o.log);
    this.bridge = new GameBridge(o.redis, o.log);
    this.store = new CombatStore(o.db, this.content);
    this.clock = o.clock ?? (() => new Date());
    this.quests = new QuestService(o.db, o.log, { clock: this.clock });
    this.rng = o.rng ?? Math.random;
  }

  private now() {
    return this.gameMs;
  }

  /** Arka plan veritabanı işi (sırayla, hata günlüğe yazılır). Testler idle() ile bitmesini bekler. */
  private job<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    const run = this.jobs.then(fn).catch((err: unknown) => {
      this.o.log.error({ err, job: name }, 'oyun sunucusu işi başarısız');
      return undefined;
    });
    this.jobs = run;
    return run;
  }

  /** Bekleyen tüm veritabanı ve arka plan işlerinin bitmesini bekler. */
  async idle() {
    for (let i = 0; i < 10; i++) {
      const before = this.jobs;
      await this.jobs;
      if (this.inflight.size) await Promise.allSettled([...this.inflight]);
      if (before === this.jobs && this.inflight.size === 0) return;
    }
  }

  /** Arka plan işini başlatır ve takip eder (hata günlüğe yazılır). */
  private bg(p: Promise<unknown>) {
    const t = p.catch((err: unknown) => this.o.log.error({ err }, 'arka plan işi başarısız')).finally(() => this.inflight.delete(t));
    this.inflight.add(t);
  }

  // ================================================================== yaşam döngüsü
  async listen(port: number, host = '0.0.0.0'): Promise<number> {
    await this.content.load(this.o.db);
    this.http = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        let npcs = 0;
        for (const r of this.rooms.values()) npcs += r.npcs.size;
        res.end(JSON.stringify({ ok: !this.closing, players: this.byPlayer.size, rooms: this.rooms.size, npcs, tick: this.tickNo }));
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
    await this.idle();
    await this.saveAll();
    await Promise.all([...this.byPlayer.values()].map((p) => this.o.redis.del(GAME_KEYS.presence(p.playerId)).catch(() => 0)));
    for (const ws of this.pending) ws.close(CLOSE_CODES.SHUTDOWN, 'Sunucu yeniden başlatılıyor');
    await this.o.sub.unsubscribe().catch(() => undefined);
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
    // Soket kapanışlarının tetiklediği son kayıtlar (konum, can, mühimmat) da bitsin
    await new Promise((r) => setTimeout(r, 20));
    await this.idle();
  }

  get stats() {
    let npcs = 0;
    for (const r of this.rooms.values()) npcs += r.npcs.size;
    return { players: this.byPlayer.size, rooms: this.rooms.size, npcs, tick: this.tickNo };
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
      p.attacking = false;
      p.visible.clear();
      await this.reloadStats(p, 'stats', false);
    } else {
      const { map } = await this.world.enterWorld(ticket.playerId);
      if (ws.readyState !== WebSocket.OPEN) return;
      p = this.createPlayer(ticket, ws, connId, map);
      await this.reloadStats(p, 'ship', false);
      p.counts = await this.store.ammoCounts(p.playerId);
      p.cargoUsed = await this.store.resourceLoad(p.playerId);
      p.shield = p.maxShield;
      this.byPlayer.set(p.playerId, p);
      await this.joinRoom(p, map);
      await this.o.db.query('UPDATE players SET last_online_at = now() WHERE id = $1', [p.playerId]);
    }
    await this.writePresence(p);
    if (ws.readyState !== WebSocket.OPEN || p.ws !== ws) return;
    // Sıra önemli: önce welcome (harita), sonra anlık görüntüler. Aradaki await'lerde tik gelse bile
    // ready=false olduğundan bu bağlantıya henüz snap/enter gönderilmez.
    p.visible.clear();
    p.ready = true;
    p.csDirty = true;
    send(ws, { t: 'welcome', id: p.entityId, tick: this.tickNo, tickMs: TICK_MS, map: p.map, you: selfState(p.state) });
    if (p.map.notice) send(ws, { t: 'notice', kind: 'info', text: p.map.notice });
    if (p.dead) send(ws, { t: 'dead', by: null, kind: 'other' });
    p.map = { ...p.map, notice: null };
    this.o.log.info({ playerId: p.playerId, map: p.room.code, entityId: p.entityId }, 'oyuna girdi');
    // Görevler: etkin hedefler yüklenir, bulunulan harita "ziyaret" sayılır
    const entered = p;
    void this.loadQuests(entered).then(() => this.questEvent(entered, { type: 'visit_map', amount: 1, map: entered.room.code, mapType: entered.room.mapType }));

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
        k: 'p',
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
      company: map.pilot.company.code,
      shipId: null,
      hp: map.pilot.ship.hitpoints,
      maxHp: map.pilot.ship.maxHitpoints,
      shield: 0,
      maxShield: map.pilot.ship.shield,
      absorb: 0,
      lasers: 0,
      laserDamage: 0,
      laserInterval: 0,
      laserRange: 0,
      repairPerSec: 0,
      target: null,
      attacking: false,
      ammo: 'ammo.isk1',
      rocket: 'rocket.yildirim',
      counts: new Map(),
      pendingUse: new Map(),
      flushSeq: 0,
      nextLaserAt: 0,
      rocketReadyAt: 0,
      lastCombatAt: -1e9,
      slowUntil: 0,
      slowFactor: 1,
      poison: null,
      dead: false,
      hpDirty: false,
      dealt: 0,
      taken: 0,
      csDirty: true,
      noticeAt: new Map(),
      quest: { interests: [], types: new Set(), cycle: '', resetHour: 5, killMinShare: 0.2, pending: new Map(), dist: 0, loaded: false },
      cargoUsed: 0,
      cargoCap: 0,
    };
  }

  private kickConnection(p: Player, code: number, message: string) {
    const ws = p.ws;
    if (!ws) return;
    p.ws = null;
    send(ws, { t: 'kick', code, message });
    ws.close(code, message.slice(0, 100));
  }

  /** Aynı uyarıyı 2 sn içinde tekrar göndermez. */
  private notice(p: Player, text: string, kind: 'info' | 'error' | 'success' = 'error') {
    const t = this.now();
    if ((p.noticeAt.get(text) ?? -1e9) + 2000 > t) return;
    p.noticeAt.set(text, t);
    send(p.ws, { t: 'notice', kind, text });
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
        if (!p.dead) this.bg(this.jump(p, msg.p));
        break;
      case 'ping':
        send(ws, { t: 'pong', c: msg.c, s: now });
        break;
      case 'target':
        this.selectTarget(p, msg.id);
        break;
      case 'attack':
        this.setAttack(p, msg.on);
        break;
      case 'ammo':
        p.ammo = msg.c;
        p.csDirty = true;
        break;
      case 'rtype':
        p.rocket = msg.c;
        p.csDirty = true;
        break;
      case 'rocket':
        this.fireRocket(p);
        break;
      case 'respawn':
        if (p.dead) this.bg(this.respawn(p));
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
    p.attacking = false;
    p.lastInput = p.lastInput.m === 2 ? p.lastInput : IDLE_INPUT;
    this.bg(this.savePlayers([p]));
    this.bg(this.flushCombat([p]));
    if (this.o.lingerSeconds > 0 && !this.closing) {
      // Gemi bir süre haritada kalır (savaştan bağlantı keserek kaçılamaz); bu sürede geri dönülürse devam eder.
      p.lingerUntil = Date.now() + this.o.lingerSeconds * 1000;
    } else {
      this.bg(this.removePlayer(p));
    }
  }

  private async removePlayer(p: Player) {
    if (this.byPlayer.get(p.playerId) !== p) return;
    this.flushQuests([p]);
    this.byPlayer.delete(p.playerId);
    this.leaveRoom(p);
    p.dirty = true;
    await this.savePlayers([p]);
    await this.flushCombat([p]);
    await this.o.db.query('UPDATE players SET last_online_at = now() WHERE id = $1', [p.playerId]).catch(() => undefined);
    await this.o.redis.del(GAME_KEYS.presence(p.playerId)).catch(() => 0);
    this.o.log.info({ playerId: p.playerId }, 'oyundan çıktı');
  }

  // ================================================================== odalar (harita = oda)
  private async ensureRoom(map: MapResponse): Promise<Room> {
    const existing = this.rooms.get(map.map.code);
    if (existing) return existing;
    let loading = this.roomLoading.get(map.map.code);
    if (!loading) {
      loading = (async () => {
        const spawns = await this.content.spawnsFor(this.o.db, map.map.code);
        const resGroups = await this.content.resourceNodesFor(this.o.db, map.map.code);
        const room: Room = {
          code: map.map.code,
          mapType: map.map.mapType,
          width: map.map.width,
          height: map.map.height,
          pvp: map.map.pvpEnabled,
          stations: map.zones.filter((z) => z.zoneType === 'station').map((z) => ({ x: z.x, y: z.y, r: z.r })),
          safeZones: map.zones.filter((z) => z.zoneType === 'safe' || z.zoneType === 'station').map((z) => ({ x: z.x, y: z.y, r: z.r })),
          players: new Map(),
          npcs: new Map(),
          cargo: new Map(),
          spawns: spawns.map((s) => ({ spawn: s, type: this.content.npcTypes.get(s.typeId)!, alive: 0, respawnAt: [] })),
          fx: [],
          resGroups: resGroups.map((g) => ({ group: g, alive: 0, respawnAt: [] })),
          resources: new Map(),
        };
        for (const g of room.resGroups) for (let i = 0; i < g.group.maxCount; i++) this.spawnResource(room, g);
        for (const sp of room.spawns) for (let i = 0; i < sp.spawn.maxAlive; i++) this.spawnNpc(room, sp);
        this.rooms.set(room.code, room);
        return room;
      })().finally(() => this.roomLoading.delete(map.map.code));
      this.roomLoading.set(map.map.code, loading);
    }
    return loading;
  }

  private async joinRoom(p: Player, map: MapResponse) {
    const room = await this.ensureRoom(map);
    p.room = room;
    p.map = map;
    room.players.set(p.entityId, p);
    p.station = this.inStation(p);
  }

  private leaveRoom(p: Player) {
    const room = p.room;
    if (!room) return;
    room.players.delete(p.entityId);
    for (const n of room.npcs.values()) if (n.target === p) n.target = null;
    // Odadaki diğer oyuncular bir sonraki anlık görüntüde AOI farkıyla "leave" alır. Boş oda (NPC'leriyle) kapanır.
    if (room.players.size === 0) this.rooms.delete(room.code);
  }

  private inStation(p: Player) {
    return p.room.stations.some((s) => dist(s, p.state) <= s.r);
  }

  private inSafe(room: Room, pos: { x: number; y: number }) {
    return room.safeZones.some((z) => dist(z, pos) <= z.r);
  }

  private fx(room: Room, f: Fx, x: number, y: number) {
    room.fx.push({ f, x, y });
  }

  // ================================================================== NPC doğma
  private spawnNpc(room: Room, sp: SpawnState) {
    const t = sp.type;
    let x = sp.spawn.area.x;
    let y = sp.spawn.area.y;
    for (let i = 0; i < 20; i++) {
      const a = this.rng() * Math.PI * 2;
      const d = Math.sqrt(this.rng()) * sp.spawn.area.r;
      x = Math.min(room.width, Math.max(0, sp.spawn.area.x + Math.cos(a) * d));
      y = Math.min(room.height, Math.max(0, sp.spawn.area.y + Math.sin(a) * d));
      if (!this.inSafe(room, { x, y })) break;
    }
    const hpMult = sp.spawn.overrides.hitpoints_mult ?? 1;
    const entityId = this.nextEntityId++;
    const npc: Npc = {
      entityId,
      type: t,
      spawn: sp,
      info: { id: entityId, k: 'n', n: t.name, cc: '', c: t.color, s: t.spriteKey, l: t.level, z: t.scale, ...(t.isBoss ? { b: true } : {}) },
      state: { x, y, vx: 0, vy: 0, h: this.rng() * Math.PI * 2 - Math.PI },
      hp: Math.round(t.hitpoints * hpMult),
      maxHp: Math.round(t.hitpoints * hpMult),
      shield: Math.round(t.shield * hpMult),
      maxShield: Math.round(t.shield * hpMult),
      damage: Math.round(t.damage * (sp.spawn.overrides.damage_mult ?? 1)),
      target: null,
      aggro: new Map(),
      nextAttackAt: 0,
      wander: null,
      wanderAt: 0,
      returning: false,
      kiteDir: this.rng() < 0.5 ? 1 : -1,
      slowUntil: 0,
      lastHitAt: -1e9,
    };
    room.npcs.set(entityId, npc);
    sp.alive++;
  }

  // ================================================================== simülasyon
  /** Bir sunucu adımı (50 ms). Her SNAPSHOT_EVERY adımda anlık görüntü gönderilir. */
  tick() {
    this.tickNo++;
    this.gameMs += TICK_MS;
    const wall = Date.now();
    const now = this.now();
    for (const room of this.rooms.values()) {
      for (const sp of room.spawns) {
        while (sp.respawnAt.length && sp.respawnAt[0]! <= now) {
          sp.respawnAt.shift();
          this.spawnNpc(room, sp);
        }
      }
      for (const p of room.players.values()) {
        if (p.lingerUntil !== null && wall >= p.lingerUntil) {
          this.bg(this.removePlayer(p));
          continue;
        }
        this.stepPlayer(p);
        if (!p.dead) {
          this.effects(p);
          this.fireLasers(p);
        }
      }
      for (const n of room.npcs.values()) this.stepNpc(room, n);
      this.cargoTick(room);
      for (const g of room.resGroups) {
        while (g.respawnAt.length && g.respawnAt[0]! <= now) {
          g.respawnAt.shift();
          this.spawnResource(room, g);
        }
      }
      this.miningTick(room);
    }
    if (this.tickNo % SNAPSHOT_EVERY === 0) this.broadcast();
    if (this.tickNo % QUEST_FLUSH_TICKS === 0) this.flushQuests([...this.byPlayer.values()]);
  }

  private effectiveSpeed(p: Player) {
    return p.slowUntil > this.now() ? p.speed * p.slowFactor : p.speed;
  }

  private stepPlayer(p: Player) {
    if (p.dead) {
      // Ölüyken hareket yok; girdiler onaylanır ki istemci tamponu büyümesin.
      if (p.queue.length) p.lastSeq = p.queue[p.queue.length - 1]!.seq;
      p.queue = [];
      p.lastInput = IDLE_INPUT;
      return;
    }
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
    stepShip(p.state, p.lastInput, DT, this.effectiveSpeed(p), p.room.width, p.room.height);
    if (p.state.x !== bx || p.state.y !== by) {
      p.dirty = true;
      if (p.quest.types.has('travel_distance')) p.quest.dist += Math.hypot(p.state.x - bx, p.state.y - by);
      const st = this.inStation(p);
      if (st !== p.station) {
        p.station = st;
        // İstasyona girince can hemen kaydedilir (web hangarındaki tamir doğru eksik canı görsün).
        if (st && p.hpDirty) this.bg(this.flushCombat([p]));
        this.bg(this.writePresence(p));
      }
    }
  }

  /** Zehir, kalkan yenilenmesi ve onarım robotu. */
  private effects(p: Player) {
    const now = this.now();
    const c = this.content.combat;
    if (p.poison) {
      if (now >= p.poison.until) p.poison = null;
      else this.damagePlayer(p, p.poison.perTick, { kind: 'npc', npc: p.poison.source }, true);
      if (p.dead) return;
    }
    if (now - p.lastCombatAt >= c.shield_regen_delay_ms && p.shield < p.maxShield) {
      p.shield = Math.min(p.maxShield, p.shield + p.maxShield * c.shield_regen_ratio_per_sec * DT);
    }
    if (p.repairPerSec > 0 && p.hp < p.maxHp && now - p.lastCombatAt >= c.repair_delay_ms) {
      p.hp = Math.min(p.maxHp, p.hp + p.repairPerSec * DT);
      p.hpDirty = true;
    }
  }

  // ================================================================== hedef ve ateş
  private findTarget(room: Room, id: number): { kind: 'npc'; npc: Npc } | { kind: 'pilot'; player: Player } | null {
    const n = room.npcs.get(id);
    if (n) return { kind: 'npc', npc: n };
    const p = room.players.get(id);
    if (p && !p.dead) return { kind: 'pilot', player: p };
    return null;
  }

  private selectTarget(p: Player, id: number | null) {
    if (id === null || id === p.entityId) {
      p.target = null;
      p.attacking = false;
    } else {
      const t = this.findTarget(p.room, id);
      const pos = t ? (t.kind === 'npc' ? t.npc.state : t.player.state) : null;
      // Yalnızca radar menzilinde görülebilen bir varlık hedeflenebilir.
      if (!pos || dist(pos, p.state) > p.radar) {
        p.target = null;
        p.attacking = false;
      } else if (p.target !== id) {
        p.target = id;
        p.attacking = false;
      }
    }
    p.csDirty = true;
  }

  private setAttack(p: Player, on: boolean) {
    if (on && (p.dead || p.target === null)) {
      this.notice(p, 'Önce bir hedef seç.');
      on = false;
    } else if (on && p.lasers === 0) {
      this.notice(p, 'Aktif konfigürasyonda takılı lazer yok.');
      on = false;
    }
    p.attacking = on;
    p.csDirty = true;
  }

  private attackVerdict(p: Player, t: NonNullable<ReturnType<GameServer['findTarget']>>) {
    const pos = t.kind === 'npc' ? t.npc.state : t.player.state;
    return canAttack({
      targetKind: t.kind,
      mapPvp: p.room.pvp,
      attackerCompany: p.company,
      ...(t.kind === 'pilot' ? { targetCompany: t.player.company } : {}),
      attackerInSafeZone: this.inSafe(p.room, p.state),
      targetInSafeZone: this.inSafe(p.room, pos),
    });
  }

  private fireLasers(p: Player) {
    if (!p.attacking || p.target === null) return;
    const t = this.findTarget(p.room, p.target);
    if (!t) {
      p.target = null;
      p.attacking = false;
      p.csDirty = true;
      return;
    }
    const now = this.now();
    if (now < p.nextLaserAt) return;
    const pos = t.kind === 'npc' ? t.npc.state : t.player.state;
    if (dist(pos, p.state) > p.laserRange) return; // menzil dışı: ateş bekler (istemci "menzil dışı" gösterir)
    const v = this.attackVerdict(p, t);
    if (!v.ok) {
      p.attacking = false;
      p.csDirty = true;
      this.notice(p, v.reason);
      return;
    }
    const have = p.counts.get(p.ammo) ?? 0;
    const use = Math.min(p.lasers, have);
    if (use <= 0) {
      p.attacking = false;
      p.csDirty = true;
      this.notice(p, `${AMMO_LABELS[p.ammo]} bitti. Başka mühimmat seç (1–5).`);
      return;
    }
    const ammo = this.content.ammo.get(p.ammo) ?? { multiplier: 1, shieldLeech: 0 };
    p.counts.set(p.ammo, have - use);
    p.pendingUse.set(p.ammo, (p.pendingUse.get(p.ammo) ?? 0) + use);
    p.csDirty = true;
    p.nextLaserAt = now + p.laserInterval;
    p.lastCombatAt = now;
    const amount = rollDamage((p.laserDamage * ammo.multiplier * use) / p.lasers, this.content.combat.damage_variance, this.rng);
    this.fx(p.room, ['l', p.entityId, p.target, AMMO_CODES.indexOf(p.ammo)], p.state.x, p.state.y);
    const shieldHit = t.kind === 'npc' ? this.damageNpc(t.npc, amount, p) : this.damagePlayer(t.player, amount, { kind: 'player', player: p });
    if (ammo.shieldLeech > 0 && shieldHit > 0) p.shield = Math.min(p.maxShield, p.shield + shieldHit * ammo.shieldLeech);
  }

  private fireRocket(p: Player) {
    if (p.dead || p.target === null) return this.notice(p, 'Önce bir hedef seç.');
    const now = this.now();
    if (now < p.rocketReadyAt) return;
    const t = this.findTarget(p.room, p.target);
    if (!t) return;
    const r = this.content.rockets.get(p.rocket);
    if (!r) return;
    const pos = t.kind === 'npc' ? t.npc.state : t.player.state;
    if (dist(pos, p.state) > r.range) return this.notice(p, 'Hedef roket menzili dışında.');
    const v = this.attackVerdict(p, t);
    if (!v.ok) return this.notice(p, v.reason);
    const have = p.counts.get(p.rocket) ?? 0;
    if (have <= 0) return this.notice(p, `${ROCKET_LABELS[p.rocket]} roketin kalmadı.`);
    p.counts.set(p.rocket, have - 1);
    p.pendingUse.set(p.rocket, (p.pendingUse.get(p.rocket) ?? 0) + 1);
    p.rocketReadyAt = now + r.cooldownMs;
    p.lastCombatAt = now;
    p.csDirty = true;
    this.fx(p.room, ['r', p.entityId, p.target, ROCKET_CODES.indexOf(p.rocket)], p.state.x, p.state.y);
    this.questEvent(p, { type: 'fire_rockets', amount: 1, rocket: p.rocket });
    const hit = (target: NonNullable<ReturnType<GameServer['findTarget']>>) => {
      const amount = rollDamage(r.damage, this.content.combat.damage_variance, this.rng);
      if (target.kind === 'npc') {
        this.damageNpc(target.npc, amount, p);
        if (r.slowMs) target.npc.slowUntil = now + r.slowMs;
      } else {
        this.damagePlayer(target.player, amount, { kind: 'player', player: p });
        if (r.slowMs) {
          target.player.slowUntil = now + r.slowMs;
          target.player.slowFactor = 0.5;
        }
      }
    };
    hit(t);
    if (r.aoeRadius > 0) {
      // Alan hasarı: hedefin çevresindeki diğer saldırılabilir varlıklar
      for (const n of [...p.room.npcs.values()]) if (n !== (t.kind === 'npc' ? t.npc : null) && dist(n.state, pos) <= r.aoeRadius) hit({ kind: 'npc', npc: n });
      for (const o of [...p.room.players.values()]) {
        if (o === p || o.dead || (t.kind === 'pilot' && o === t.player) || dist(o.state, pos) > r.aoeRadius) continue;
        const target = { kind: 'pilot' as const, player: o };
        if (this.attackVerdict(p, target).ok) hit(target);
      }
    }
  }

  /** NPC'ye hasar. Kalkanın aldığı hasarı döner (SE-50 kalkan emme için). */
  private damageNpc(n: Npc, amount: number, attacker: Player): number {
    if (n.hp <= 0) return 0;
    const r = applyDamage({ hp: n.hp, shield: n.shield, absorb: n.type.absorb }, amount);
    n.hp = r.hp;
    n.shield = r.shieldLeft;
    n.lastHitAt = this.now();
    n.aggro.set(attacker.playerId, (n.aggro.get(attacker.playerId) ?? 0) + r.hull + r.shield);
    attacker.dealt += r.hull + r.shield;
    const dealt = Math.round(r.hull + r.shield);
    if (dealt > 0 && attacker.quest.types.has('deal_damage')) {
      this.questEvent(attacker, { type: 'deal_damage', amount: dealt, target: 'npc', npc: n.type.code, family: n.type.family, map: attacker.room.code, mapType: attacker.room.mapType });
    }
    this.fx(attacker.room, ['d', n.entityId, r.hull + r.shield, r.hull === 0 ? 1 : 0], n.state.x, n.state.y);
    // Saldırılan NPC karşılık verir; sürü üyeleri de saldırgana yönelir.
    if (!n.target || n.returning) {
      n.target = attacker;
      n.returning = false;
    }
    if (n.type.ai.pack) {
      for (const o of attacker.room.npcs.values()) {
        if (o !== n && o.spawn === n.spawn && !o.target && dist(o.state, n.state) < 1500) o.target = attacker;
      }
    }
    if (r.killed) this.killNpc(attacker.room, n);
    return r.shield;
  }

  /** Oyuncuya hasar. direct: kalkanı atlar (zehir). Kalkanın aldığı hasarı döner. */
  private damagePlayer(p: Player, amount: number, source: { kind: 'npc'; npc: Npc } | { kind: 'player'; player: Player }, direct = false): number {
    if (p.dead) return 0;
    const r = applyDamage({ hp: p.hp, shield: p.shield, absorb: direct ? 0 : p.absorb }, amount);
    p.hp = r.hp;
    p.shield = r.shieldLeft;
    p.hpDirty = true;
    p.lastCombatAt = this.now();
    p.taken += r.hull + r.shield;
    if (source.kind === 'player') {
      source.player.dealt += r.hull + r.shield;
      const dealt = Math.round(r.hull + r.shield);
      if (dealt > 0 && source.player.quest.types.has('deal_damage')) {
        this.questEvent(source.player, { type: 'deal_damage', amount: dealt, target: 'player', map: p.room.code, mapType: p.room.mapType });
      }
    }
    this.fx(p.room, ['d', p.entityId, r.hull + r.shield, r.hull === 0 ? 1 : 0], p.state.x, p.state.y);
    if (r.killed) this.killPlayer(p, source);
    return r.shield;
  }

  // ================================================================== NPC yapay zekâsı
  private stepNpc(room: Room, n: Npc) {
    const now = this.now();
    const ai = n.type.ai;
    const home = n.spawn.spawn.area;
    const leash = ai.leash ?? 2800;
    // Hedef geçerliliği: öldü, haritadan çıktı, güvenli bölgeye girdi veya NPC yuvasından çok uzaklaştı
    if (n.target) {
      const t = n.target;
      if (t.dead || t.room !== room || this.inSafe(room, t.state) || dist(n.state, home) > leash || dist(n.state, t.state) > leash) {
        n.target = null;
        n.returning = true;
      }
    }
    if (!n.target && !n.returning && ai.behavior !== 'passive') {
      const range = ai.aggro_range ?? 600;
      let best: Player | null = null;
      let bestD = range;
      for (const p of room.players.values()) {
        if (p.dead) continue;
        const d = dist(p.state, n.state);
        if (d <= bestD && !this.inSafe(room, p.state)) {
          best = p;
          bestD = d;
        }
      }
      n.target = best;
    }

    let input: MoveInput = IDLE_INPUT;
    let speed = n.type.speed;
    const t = n.target;
    if (t) {
      const d = dist(n.state, t.state);
      const range = n.type.attackRange;
      if (ai.behavior === 'kite') {
        // Vur-kaç: menzilin kenarında kalır, hedefin çevresinde döner
        const dx = (t.state.x - n.state.x) / (d || 1);
        const dy = (t.state.y - n.state.y) / (d || 1);
        if (d < range * 0.6) input = { m: 1, x: -dx, y: -dy };
        else if (d > range * 0.9) input = { m: 1, x: dx, y: dy };
        else input = { m: 1, x: -dy * n.kiteDir, y: dx * n.kiteDir };
      } else if (d > range * 0.7) {
        input = { m: 2, x: t.state.x, y: t.state.y };
      }
      if (n.damage > 0 && d <= range && now >= n.nextAttackAt && !this.inSafe(room, t.state)) {
        n.nextAttackAt = now + n.type.attackRateMs;
        const amount = rollDamage(n.damage, this.content.combat.damage_variance, this.rng);
        this.fx(room, ['l', n.entityId, t.entityId, NPC_BEAM], n.state.x, n.state.y);
        this.damagePlayer(t, amount, { kind: 'npc', npc: n });
        if (!t.dead && ai.poison) t.poison = { perTick: (amount * ai.poison.ratio) / (ai.poison.ms / TICK_MS), until: now + ai.poison.ms, source: n };
        if (!t.dead && ai.slow) {
          t.slowUntil = now + ai.slow.ms;
          t.slowFactor = ai.slow.factor;
        }
      }
    } else if (n.returning) {
      input = { m: 2, x: home.x, y: home.y };
      if (dist(n.state, home) < 150) n.returning = false;
    } else {
      // Dolaşma: yuva alanında rastgele noktalara yarı hızla gider
      if (!n.wander || now >= n.wanderAt) {
        const a = this.rng() * Math.PI * 2;
        const r = Math.sqrt(this.rng()) * Math.min(home.r, ai.patrol_radius ?? home.r);
        n.wander = { x: home.x + Math.cos(a) * r, y: home.y + Math.sin(a) * r };
        n.wanderAt = now + 3000 + this.rng() * 4000;
      }
      input = { m: 2, x: n.wander.x, y: n.wander.y };
      speed *= 0.5;
    }
    if (n.slowUntil > now) speed *= 0.5;
    const px = n.state.x;
    const py = n.state.y;
    stepShip(n.state, input, DT, speed, room.width, room.height);
    if (this.inSafe(room, n.state)) {
      // NPC güvenli bölgeye giremez
      n.state.x = px;
      n.state.y = py;
      n.state.vx = 0;
      n.state.vy = 0;
      n.wander = null;
    }
    // Savaş dışındayken yenilenir
    if (!n.target && now - n.lastHitAt > 5000 && (n.hp < n.maxHp || n.shield < n.maxShield)) {
      n.hp = Math.min(n.maxHp, n.hp + n.maxHp * 0.1 * DT);
      n.shield = Math.min(n.maxShield, n.shield + n.maxShield * 0.2 * DT);
      if (n.hp >= n.maxHp) n.aggro.clear();
    }
  }

  // ================================================================== ölüm ve ödül
  private killNpc(room: Room, n: Npc) {
    room.npcs.delete(n.entityId);
    n.spawn.alive--;
    n.spawn.respawnAt.push(this.now() + n.spawn.spawn.respawnMs);
    n.spawn.respawnAt.sort((a, b) => a - b);
    this.fx(room, ['x', n.entityId, Math.round(n.state.x), Math.round(n.state.y), n.type.scale], n.state.x, n.state.y);
    for (const p of room.players.values()) {
      if (p.target === n.entityId) {
        p.target = null;
        p.attacking = false;
        p.csDirty = true;
      }
    }
    // Ödül hasar katkısına göre bölünür (yalnızca hâlâ bu haritada olan pilotlar). Eşya, kargo kutusu ve
    // öldürme kaydı en çok hasar verenindir.
    const rolled = rollRewards(n.type.rewards, this.rng);
    const direct: RolledReward[] = [...rolled.direct];
    if (n.type.experience > 0) direct.push({ type: 'experience', code: 'XP', amount: n.type.experience });
    if (n.type.honor) direct.push({ type: 'honor', code: 'HONOR', amount: n.type.honor });
    const shares = splitRewards(
      direct,
      [...n.aggro].map(([id, damage]) => ({ id, damage, present: this.byPlayer.get(id)?.room === room })),
    );
    const top = shares.find((s) => s.top);
    if (!top) return;
    const killer = this.byPlayer.get(top.id)!;
    // Görev: öldürme, en çok hasar verene ve payı yeterli olan (varsayılan %20) pilotlara sayılır
    for (const s of shares) {
      const pl = this.byPlayer.get(s.id);
      if (!pl || (!s.top && s.share < pl.quest.killMinShare)) continue;
      this.questEvent(pl, { type: 'kill_npc', amount: 1, npc: n.type.code, family: n.type.family, boss: n.type.isBoss, map: room.code, mapType: room.mapType });
    }
    if (rolled.cargo.length) {
      const entityId = this.nextEntityId++;
      const c = this.content.combat;
      room.cargo.set(entityId, {
        entityId,
        uuid: randomUUID(),
        info: { id: entityId, k: 'c', n: 'Kargo kutusu', cc: '', c: '#F5B700', s: 'cargo', l: 0 },
        x: n.state.x,
        y: n.state.y,
        ownerId: killer.playerId,
        ownerUntil: this.now() + c.loot_owner_ms,
        expiresAt: this.now() + c.loot_ttl_ms,
        items: rolled.cargo,
      });
    }
    const killId = randomUUID();
    const grants = shares.map((s) => ({ playerId: s.id, rewards: s.rewards }));
    void this.job('npc-kill', async () => {
      const res = await this.store.npcKill(killId, top.id, n.type.id, room.code, grants);
      if (!res) return;
      for (const s of shares) {
        const p = this.byPlayer.get(s.id);
        const r = res.get(s.id);
        if (!p || !r) continue;
        const solo = shares.length === 1 && s.share >= 0.999;
        this.sendReward(p, solo ? `${n.type.name} yok edildi` : `${n.type.name} yok edildi (katkın %${Math.round(s.share * 100)})`, r, solo ? undefined : s.share);
        // Başarımlar anında: öldürme sayısı (en çok hasar veren) veya seviye değiştiyse
        if (s.top || r.level > r.levelBefore) await this.checkAchievements(p);
      }
    });
  }

  private sendReward(p: Player, source: string, r: GrantResult, share?: number) {
    if (r.level > r.levelBefore) this.questEvent(p, { type: 'reach_level', amount: 1, level: r.level });
    if (r.level !== p.info.l) {
      p.info = { ...p.info, l: r.level };
      p.map = { ...p.map, pilot: { ...p.map.pilot, level: r.level } };
    }
    for (const it of r.items) {
      if (this.content.ammo.has(it.code) || this.content.rockets.has(it.code)) {
        p.counts.set(it.code, (p.counts.get(it.code) ?? 0) + it.amount);
        p.csDirty = true;
      }
    }
    send(p.ws, {
      t: 'reward',
      source,
      xp: r.experience,
      honor: r.honor,
      currencies: r.currencies,
      items: r.items,
      level: r.level,
      levelUp: r.level > r.levelBefore,
      ...(share !== undefined ? { share: Math.round(share * 1000) / 1000 } : {}),
    });
  }

  private killPlayer(p: Player, source: { kind: 'npc'; npc: Npc } | { kind: 'player'; player: Player }) {
    p.dead = true;
    p.hp = 0;
    p.attacking = false;
    p.target = null;
    p.poison = null;
    p.state.vx = 0;
    p.state.vy = 0;
    p.lastInput = IDLE_INPUT;
    p.csDirty = true;
    p.hpDirty = false;
    this.fx(p.room, ['x', p.entityId, Math.round(p.state.x), Math.round(p.state.y), 1.2], p.state.x, p.state.y);
    for (const n of p.room.npcs.values()) if (n.target === p) {
      n.target = null;
      n.returning = true;
    }
    for (const o of p.room.players.values()) if (o.target === p.entityId) {
      o.target = null;
      o.attacking = false;
      o.csDirty = true;
    }
    const by = source.kind === 'npc' ? source.npc.type.name : source.player.info.n;
    if (source.kind === 'player') this.questEvent(source.player, { type: 'kill_player', amount: 1, map: p.room.code, mapType: p.room.mapType });
    send(p.ws, { t: 'dead', by, kind: source.kind === 'npc' ? 'npc' : 'player' });
    const victim = { playerId: p.playerId, shipId: p.shipId, mapCode: p.room.code, x: p.state.x, y: p.state.y, name: p.info.n };
    void this.job('death', async () => {
      await this.store.death({
        playerId: victim.playerId,
        shipId: victim.shipId,
        mapCode: victim.mapCode,
        x: victim.x,
        y: victim.y,
        killer: source.kind === 'npc' ? { kind: 'npc', npcTypeId: source.npc.type.id } : { kind: 'player', playerId: source.player.playerId },
      });
      if (source.kind === 'player') {
        const honor = this.content.combat.pvp_honor;
        await this.store.pilotKill(source.player.playerId, honor);
        send(source.player.ws, {
          t: 'reward',
          source: `${victim.name} yenildi`,
          xp: 0,
          honor,
          currencies: [],
          items: [],
          level: source.player.info.l,
          levelUp: false,
        });
        await this.checkAchievements(source.player);
      }
    });
  }

  private async respawn(p: Player) {
    if (!p.dead || p.jumping) return;
    p.jumping = true;
    try {
      await this.jobs; // ölüm kaydı yazılmış olsun (idle() değil: bu işin kendisi de takip ediliyor)
      const map = await this.world.respawnAtHome(p.playerId);
      p.dead = false;
      p.hp = map.pilot.ship.hitpoints;
      p.maxHp = map.pilot.ship.maxHitpoints;
      p.shield = 0;
      p.slowUntil = 0;
      p.lastCombatAt = this.now();
      await this.moveToMap(p, map, 'respawn');
    } finally {
      p.jumping = false;
    }
  }

  // ================================================================== madencilik (Aşama 11)
  private spawnResource(room: Room, g: ResGroupState) {
    const a = g.group.area;
    const ang = this.rng() * Math.PI * 2;
    const rad = Math.sqrt(this.rng()) * a.r;
    const x = Math.max(50, Math.min(room.width - 50, a.x + Math.cos(ang) * rad));
    const y = Math.max(50, Math.min(room.height - 50, a.y + Math.sin(ang) * rad));
    const entityId = this.nextEntityId++;
    const color = g.group.code === 'res.kuvarsit' ? '#C9B8FF' : g.group.code === 'res.ferrolit' ? '#D98C5F' : '#9FE3F0';
    room.resources.set(entityId, {
      entityId,
      uuid: randomUUID(),
      group: g,
      x,
      y,
      info: { id: entityId, k: 'r', n: g.group.name, cc: '', c: color, s: g.group.code.replace('res.', 'res-'), l: 0 },
    });
    g.alive++;
  }

  /** Maden noktasının üzerine gelen pilot kaynağı toplar (ambar doluysa toplanmaz). */
  private miningTick(room: Room) {
    if (room.resources.size === 0) return;
    const radius = this.content.miningRadius;
    for (const rn of [...room.resources.values()]) {
      for (const p of room.players.values()) {
        if (p.dead || dist(p.state, rn) > radius) continue;
        const free = p.cargoCap - p.cargoUsed;
        if (free <= 0) {
          this.notice(p, `Ambarın dolu (${p.cargoUsed}/${p.cargoCap}). Kaynakları Pazar'da sat veya rafineride işle.`, 'info');
          continue;
        }
        const g = rn.group;
        const rolled = g.group.yieldMin + Math.floor(this.rng() * (g.group.yieldMax - g.group.yieldMin + 1));
        const qty = Math.min(rolled, free);
        room.resources.delete(rn.entityId);
        g.alive--;
        g.respawnAt.push(this.now() + g.group.respawnMs);
        g.respawnAt.sort((a, b) => a - b);
        p.cargoUsed += qty;
        p.csDirty = true;
        this.questEvent(p, { type: 'collect_resource', amount: qty, resource: g.group.code, map: room.code, mapType: room.mapType });
        const picker = p;
        void this.job('mining', async () => {
          const res = await this.store.collectResource(rn.uuid, picker.playerId, g.group.code, qty);
          this.sendReward(picker, 'Kaynak toplandı', res);
        });
        break;
      }
    }
  }

  // ================================================================== kargo
  private cargoTick(room: Room) {
    const now = this.now();
    const c = this.content.combat;
    for (const box of [...room.cargo.values()]) {
      if (now >= box.expiresAt) {
        room.cargo.delete(box.entityId);
        continue;
      }
      for (const p of room.players.values()) {
        if (p.dead || dist(p.state, box) > c.loot_pickup_radius) continue;
        if (box.ownerId && box.ownerId !== p.playerId && now < box.ownerUntil) {
          this.notice(p, 'Bu kargo kutusu kısa bir süre daha onu kazanan pilota ait.', 'info');
          continue;
        }
        room.cargo.delete(box.entityId); // tek alıcı: önce bellekten kalkar
        const picker = p;
        this.questEvent(picker, { type: 'collect_cargo', amount: 1, map: room.code, mapType: room.mapType });
        void this.job('cargo', async () => {
          const res = await this.store.collectCargo(box.uuid, picker.playerId, box.items);
          this.sendReward(picker, 'Kargo kutusu toplandı', res);
          await this.checkAchievements(picker);
        });
        break;
      }
    }
  }

  // ================================================================== ilgi alanı (AOI) ve anlık görüntü
  /** Her oyuncuya yalnızca radar menzilindeki gemiler/NPC'ler, kargo algılama menzilindeki kutular gönderilir. */
  private broadcast() {
    const cargoRange = DETECTION.cargo;
    for (const room of this.rooms.values()) {
      const grid = new Map<string, Array<Player | Npc>>();
      const add = (e: Player | Npc) => {
        const key = `${Math.floor(e.state.x / AOI_CELL)}:${Math.floor(e.state.y / AOI_CELL)}`;
        const cell = grid.get(key);
        if (cell) cell.push(e);
        else grid.set(key, [e]);
      };
      for (const p of room.players.values()) if (!p.dead) add(p);
      for (const n of room.npcs.values()) add(n);
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
              if (dist(o.state, p.state) > p.radar) continue;
              seen.add(o.entityId);
              if (!p.visible.has(o.entityId)) entered.push(o.info);
              entities.push([
                o.entityId,
                Math.round(o.state.x),
                Math.round(o.state.y),
                Math.round(o.state.h * 100) / 100,
                Math.round(o.state.vx),
                Math.round(o.state.vy),
                pct(o.hp, 'maxHp' in o ? o.maxHp : 1),
                pct(o.shield, o.maxShield),
              ]);
            }
          }
        }
        for (const box of room.cargo.values()) {
          if (dist(box, p.state) > cargoRange) continue;
          seen.add(box.entityId);
          if (!p.visible.has(box.entityId)) entered.push(box.info);
          entities.push([box.entityId, Math.round(box.x), Math.round(box.y), 0, 0, 0, 100, 0]);
        }
        // Maden noktaları da kargo algılama menzilinde görünür (madde 18)
        for (const rn of room.resources.values()) {
          if (dist(rn, p.state) > cargoRange) continue;
          seen.add(rn.entityId);
          if (!p.visible.has(rn.entityId)) entered.push(rn.info);
          entities.push([rn.entityId, Math.round(rn.x), Math.round(rn.y), 0, 0, 0, 100, 0]);
        }
        const left = [...p.visible].filter((id) => !seen.has(id));
        p.visible = seen;
        if (entered.length) send(p.ws, { t: 'enter', e: entered });
        if (left.length) send(p.ws, { t: 'leave', e: left });
        if (p.csDirty) {
          p.csDirty = false;
          send(p.ws, {
            t: 'cs',
            target: p.target,
            attacking: p.attacking,
            ammo: p.ammo,
            rocket: p.rocket,
            counts: Object.fromEntries([...AMMO_CODES, ...ROCKET_CODES].map((c) => [c, p.counts.get(c) ?? 0])),
            rocketCooldownMs: Math.max(0, p.rocketReadyAt - this.now()),
            laserRange: p.laserRange,
            cargo: [p.cargoUsed, p.cargoCap],
          });
        }
        // Yavaş bağlantıda arabellek şişerse anlık görüntü atlanır (bir sonraki zaten tam durumu taşır).
        if (p.ws.bufferedAmount > 512 * 1024) continue;
        const fx = room.fx.filter((e) => dist(e, p.state) <= p.radar + 400).map((e) => e.f);
        send(p.ws, {
          t: 'snap',
          k: this.tickNo,
          a: p.lastSeq,
          y: selfState(p.state),
          st: [Math.round(p.hp), p.maxHp, Math.round(p.shield), p.maxShield, Math.round(this.effectiveSpeed(p))],
          e: entities,
          ...(fx.length ? { fx } : {}),
        });
      }
      room.fx = [];
    }
  }

  // ================================================================== geçit
  private async jump(p: Player, portalId: number) {
    if (p.jumping) return;
    p.jumping = true;
    try {
      const map = await this.world.jumpForGame(p.playerId, portalId, { x: p.state.x, y: p.state.y });
      await this.moveToMap(p, map, 'portal');
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

  private async moveToMap(p: Player, map: MapResponse, reason: 'portal' | 'map_closed' | 'respawn') {
    this.takeTravel(p); // eski haritada kat edilen yol eski haritaya sayılır
    this.leaveRoom(p);
    p.state = { x: map.position.x, y: map.position.y, vx: 0, vy: 0, h: p.state.h };
    if (p.queue.length) p.lastSeq = p.queue[p.queue.length - 1]!.seq;
    p.queue = [];
    p.debt = 0;
    p.lastInput = IDLE_INPUT;
    p.visible.clear();
    p.target = null;
    p.attacking = false;
    p.poison = null;
    p.csDirty = true;
    p.speed = map.pilot.ship.speed;
    p.radar = map.rules.detection.radar;
    await this.joinRoom(p, map);
    send(p.ws, { t: 'map', tick: this.tickNo, map, you: selfState(p.state), reason });
    this.questEvent(p, { type: 'visit_map', amount: 1, map: p.room.code, mapType: p.room.mapType });
    if (reason === 'portal') this.questEvent(p, { type: 'jump_portal', amount: 1, map: p.room.code, mapType: p.room.mapType });
    if (map.notice) send(p.ws, { t: 'notice', kind: 'info', text: map.notice });
    p.map = { ...map, notice: null };
    this.bg(this.writePresence(p));
  }

  // ================================================================== görevler (Aşama 10)
  /** Olay, pilotun etkin bir hedefiyle eşleşiyorsa biriktirilir (aynı türden olaylar toplanır). */
  private questEvent(p: Player, e: QuestEvent) {
    const q = p.quest;
    if (!q.types.has(e.type)) return;
    if (!q.interests.some((i) => i.type === e.type && objectiveMatches(i.type, i.params, e))) return;
    const key = [e.type, e.npc, e.family, e.boss ? 1 : 0, e.map, e.mapType, e.target, e.category, e.rocket, e.type === 'upgrade_item' ? e.level : ''].join('|');
    const prev = q.pending.get(key);
    if (!prev) q.pending.set(key, { ...e });
    else if (e.type === 'reach_level') prev.level = Math.max(prev.level ?? 0, e.level ?? 0);
    else prev.amount += e.amount;
  }

  private takeTravel(p: Player) {
    if (p.quest.dist < 1 || !p.room) return;
    const n = Math.floor(p.quest.dist);
    p.quest.dist -= n;
    this.questEvent(p, { type: 'travel_distance', amount: n, map: p.room.code, mapType: p.room.mapType });
  }

  private async applyInterests(p: Player, hint: boolean) {
    const r = await this.quests.interests(p.playerId);
    if (!r) return;
    p.quest.interests = r.objectives;
    p.quest.types = new Set(r.objectives.map((o) => o.type));
    p.quest.cycle = r.cycle;
    p.quest.resetHour = r.resetHour;
    p.quest.killMinShare = r.killMinShare;
    p.quest.loaded = true;
    if (!p.quest.types.has('travel_distance')) p.quest.dist = 0;
    if (hint) send(p.ws, { t: 'quests' });
  }

  /** Etkin hedefleri yükler (iş kuyruğunda; görev yazımlarıyla sırası korunur). */
  private loadQuests(p: Player, hint = false) {
    return this.job('quest-load', () => this.applyInterests(p, hint));
  }

  /** Biriken görev olaylarını yazar (saniyede bir, çıkışta ve kapanışta). */
  private flushQuests(list: Player[]) {
    for (const p of list) {
      if (!p.quest.loaded) continue;
      this.takeTravel(p);
      // Yeni günlük/haftalık döngü: görevler yeniden atanır ve istemci listeyi yeniler
      const c = questCycles(this.clock(), p.quest.resetHour);
      const key = `${c.daily}|${c.weekly}`;
      if (key !== p.quest.cycle) {
        p.quest.cycle = key;
        void this.loadQuests(p, true);
      }
      if (!p.quest.pending.size) continue;
      const events = [...p.quest.pending.values()];
      p.quest.pending.clear();
      const player = p;
      void this.job('quests', async () => {
        const updates = await this.quests.record(player.playerId, events);
        if (!updates.length) return;
        send(player.ws, { t: 'qp', u: updates });
        for (const u of updates) {
          if (u.status === 'completed') send(player.ws, { t: 'notice', kind: 'success', text: `Görev tamamlandı: ${u.title}. Ödülünü görev listesinden al.` });
        }
        // Tamamlanan hedefler artık izlenmez
        if (updates.some((u) => u.objectives.some((o) => o.current >= o.target))) await this.applyInterests(player, false);
      });
    }
  }

  /** Testler için: biriken görev olaylarını hemen yazar. */
  async flushQuestEvents() {
    this.flushQuests([...this.byPlayer.values()]);
    await this.idle();
  }

  /** API'de görev listesi değişti (kabul, ödül, yeniden çekme, hangar olayı). */
  private async onQuestsChanged(p: Player) {
    await this.reloadInventory(p);
    const r = await this.o.db.query<{ experience: string }>('SELECT experience FROM players WHERE id = $1', [p.playerId]);
    const level = levelForXp(Number(r.rows[0]?.experience ?? 0));
    if (level !== p.info.l) {
      p.info = { ...p.info, l: level };
      p.map = { ...p.map, pilot: { ...p.map.pilot, level } };
    }
    await this.loadQuests(p, true);
  }

  /** Başarımlar anında değerlendirilir; yeni kazanılan bildirilir. */
  private async checkAchievements(p: Player) {
    const r = await syncAchievements(this.o.db, p.playerId);
    for (const a of r.newlyEarned) send(p.ws, { t: 'notice', kind: 'success', text: `Başarım kazanıldı: ${a.name}` });
  }

  // ================================================================== canlı değişiklikler (Redis)
  private async subscribe() {
    await this.o.sub.subscribe(GAME_CHANNELS.kick, GAME_CHANNELS.playerUpdated);
    this.o.sub.on('message', (channel: string, raw: string) => {
      let data: { playerId?: string; connId?: string; reason?: PlayerUpdateReason };
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
        this.bg(this.removePlayer(p));
      } else if (channel === GAME_CHANNELS.playerUpdated) {
        const reason = data.reason ?? 'stats';
        if (reason === 'inventory') this.bg(this.reloadInventory(p));
        else if (reason === 'quests') this.bg(this.onQuestsChanged(p));
        else this.bg(this.reloadStats(p, reason, true));
      }
    });
  }

  /**
   * Hangarda ekipman/gemi/konfigürasyon değişince hız, can, kalkan, lazer ve radar canlı güncellenir.
   * Can yalnızca tamirde veya gemi değişiminde veritabanından okunur (oyundaki güncel can korunur).
   */
  private async reloadStats(p: Player, reason: Exclude<PlayerUpdateReason, 'inventory' | 'quests'>, notify: boolean) {
    const ship = await activeShipStats(this.o.db, p.playerId);
    if (!ship) return;
    const s = ship.stats;
    p.speed = s.speed;
    p.radar = DETECTION.baseRadar + (s.radarBonus ?? 0);
    p.maxShield = s.shield;
    p.absorb = s.shieldAbsorb;
    p.lasers = s.lasers;
    p.laserDamage = s.damagePerVolley;
    p.laserInterval = volleyIntervalMs(s.damagePerVolley, s.damagePerSecond);
    p.laserRange = s.laserRange;
    p.repairPerSec = s.repairPerSecond;
    p.cargoCap = s.cargo;
    p.maxHp = ship.maxHitpoints;
    if (reason === 'ship' || reason === 'repair' || p.shipId === null) {
      p.hp = ship.hitpoints;
      p.shipId = ship.shipId;
      p.hpDirty = false;
    }
    p.hp = Math.min(p.hp, p.maxHp);
    p.shield = Math.min(p.shield, p.maxShield);
    if (p.lasers === 0) p.attacking = false;
    p.csDirty = true;
    const shipInfo = { name: ship.name, spriteKey: ship.spriteKey, hitpoints: Math.round(p.hp), maxHitpoints: p.maxHp, shield: s.shield, speed: s.speed };
    p.map = { ...p.map, pilot: { ...p.map.pilot, ship: shipInfo }, rules: { ...p.map.rules, detection: { ...p.map.rules.detection, radar: p.radar } } };
    p.info = { ...p.info, s: ship.spriteKey };
    if (notify) send(p.ws, { t: 'pilot', ship: shipInfo, radar: p.radar });
  }

  /** Mağaza/satış sonrası: bekleyen tüketim düşülür, sayılar veritabanından okunur. */
  private async reloadInventory(p: Player) {
    await this.flushCombat([p]);
    p.counts = await this.store.ammoCounts(p.playerId);
    p.cargoUsed = await this.store.resourceLoad(p.playerId);
    // Okuma sırasında harcanan mühimmat da düşülür
    for (const [code, n] of p.pendingUse) p.counts.set(code, Math.max(0, (p.counts.get(code) ?? 0) - n));
    p.csDirty = true;
  }

  private async writePresence(p: Player) {
    const presence: Presence = { map: p.room.code, station: p.station, instance: this.instanceId, at: Date.now() };
    await this.o.redis.set(GAME_KEYS.presence(p.playerId), JSON.stringify(presence), 'EX', PRESENCE_TTL_SECONDS).catch((err: unknown) => {
      this.o.log.warn({ err, playerId: p.playerId }, 'çevrimiçi durum yazılamadı');
    });
  }

  // ================================================================== kalıcılık ve periyodik denetimler
  /** Konum, can, hasar istatistiği ve harcanan mühimmat toplu yazılır (varsayılan 5 sn; çıkışta hemen). */
  async saveAll() {
    this.flushQuests([...this.byPlayer.values()]);
    await this.savePlayers([...this.byPlayer.values()].filter((p) => p.dirty));
    await this.flushCombat([...this.byPlayer.values()]);
    await Promise.all([...this.byPlayer.values()].map((p) => this.writePresence(p)));
  }

  /** Can + hasar istatistikleri + mühimmat tüketimi (defterli, idempotent anahtarla). */
  private async flushCombat(list: Player[]) {
    const rows = list
      .filter((p) => (p.hpDirty && !p.dead) || p.dealt || p.taken)
      .map((p) => {
        const row = { playerId: p.playerId, shipId: p.hpDirty && !p.dead ? p.shipId : null, hp: p.hp, dealt: p.dealt, taken: p.taken };
        p.hpDirty = false;
        p.dealt = 0;
        p.taken = 0;
        return row;
      });
    try {
      await this.store.saveCombatState(rows);
    } catch (err) {
      this.o.log.error({ err }, 'savaş durumu kaydedilemedi');
    }
    for (const p of list) {
      if (p.pendingUse.size === 0) continue;
      const used = p.pendingUse;
      p.pendingUse = new Map();
      const key = `ammo:${p.connId}:${++p.flushSeq}`;
      try {
        await this.store.useAmmo(p.playerId, used, key);
      } catch (err) {
        // Yazılamadıysa bir sonraki denemede tekrar düşülür
        for (const [c, n] of used) p.pendingUse.set(c, (p.pendingUse.get(c) ?? 0) + n);
        this.o.log.error({ err, playerId: p.playerId }, 'mühimmat tüketimi kaydedilemedi');
      }
    }
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
        if (relocated) await this.moveToMap(p, map, 'map_closed');
      }
    }
  }

  /** Test/izleme: bir haritadaki NPC'lerin özeti. */
  /** Test yardımcısı: haritadaki maden noktaları */
  resourcesOn(mapCode: string) {
    const room = this.rooms.get(mapCode);
    return room ? [...room.resources.values()].map((r) => ({ id: r.entityId, code: r.group.group.code, x: r.x, y: r.y })) : [];
  }

  npcsOn(mapCode: string) {
    const room = this.rooms.get(mapCode);
    return room ? [...room.npcs.values()].map((n) => ({ id: n.entityId, code: n.type.code, x: n.state.x, y: n.state.y, hp: n.hp, shield: n.shield, target: n.target?.playerId ?? null })) : [];
  }
}
