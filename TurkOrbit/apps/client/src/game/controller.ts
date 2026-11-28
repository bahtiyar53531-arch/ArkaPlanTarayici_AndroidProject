/**
 * Oyun kontrolcüsü (Aşama 8): WebSocket istemcisi + tahmin/uzlaştırma/enterpolasyon + HUD köprüsü.
 *
 *  - Kendi gemin: 50 ms'lik sabit adımlarla ortak `stepShip` ile anında tahmin edilir; her adımın girdisi
 *    sıra numarasıyla sunucuya gider. Anlık görüntü `ack` ile gelince sunucu durumuna dönülür ve
 *    onaylanmamış girdiler yeniden uygulanır. Küçük fark görsel olarak yumuşatılır, büyük farkta atlanır.
 *  - Diğer pilotlar: anlık görüntüler tamponlanır, ~150 ms geriden iki görüntü arasında çizilir.
 *  - Bağlantı koparsa yeni biletle otomatik yeniden bağlanır; başka cihazdan girilirse durur.
 */
import {
  AMMO_LABELS,
  arrived,
  CLOSE_CODES,
  IDLE_INPUT,
  NO_RECONNECT_CODES,
  PROTOCOL_VERSION,
  stepShip,
  TICK_MS,
  type AmmoCode,
  type ChatChannel,
  type ChatMessageView,
  type CombatState,
  type EntityInfo,
  type Fx,
  type MapResponse,
  type PartyView,
  type RewardMessage,
  type RocketCode,
  type MoveInput,
  type PlayerSettings,
  type PortalInfo,
  type QuestProgressUpdate,
  type QuestsResponse,
  type QuestView,
  type ServerMessage,
  type ShipState,
} from '@turkorbit/shared';
import { api, ApiError } from '../api/client';

export const SERVER = 'TR1';
const INTERP_DELAY = 150;
const SNAP_CORRECTION = 300;

export interface Vec {
  x: number;
  y: number;
}

export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'replaced' | 'ended';

export interface NearbyPilot {
  id: number;
  name: string;
  color: string;
  company: string;
  level: number;
  distance: number;
}

export interface HudState {
  position: Vec;
  heading: number;
  moving: boolean;
  target: Vec | null;
  nearPortal: PortalInfo | null;
  fps: number;
  jumping: boolean;
  toast: { kind: 'info' | 'error' | 'success'; text: string; id: number } | null;
  conn: ConnState;
  connMessage: string | null;
  reconnectAttempt: number;
  ping: number | null;
  nearby: NearbyPilot[];
  // --- Aşama 9: savaş
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  combat: CombatState;
  dead: { by: string | null; kind: 'npc' | 'player' | 'other' } | null;
  // --- Aşama 10: görevler (HUD izleyici + çekmece)
  quests: QuestView[];
  /** Sunucu "quests" bildirdikçe artar: açık görev çekmecesi listeyi yeniden ister */
  questsVersion: number;
  // --- Aşama 12: sohbet, grup, bildirim
  chat: ChatMessageView[];
  /** sohbet paneli kapalıyken gelen mesaj sayısı */
  chatUnread: number;
  party: PartyView | null;
  partyInvites: Array<{ from: string; level: number; company: string; expiresAt: number }>;
  /** klan/diplomasi değişti (sunucu "social") — açık klan bilgileri yenilenir */
  socialVersion: number;
}

/** Sohbette tutulan en fazla mesaj */
const CHAT_KEEP = 200;

export interface RemoteShip {
  info: EntityInfo;
  buf: Array<{ t: number; x: number; y: number; h: number }>;
  x: number;
  y: number;
  h: number;
  /** can ve kalkan yüzdesi (0–100) */
  hp: number;
  sh: number;
}

const fmtN = (n: number) => n.toLocaleString('tr-TR');

type Listener = () => void;

const wsUrl = (): string =>
  (import.meta.env.VITE_GAME_URL as string | undefined) ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game`;

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class GameController {
  map!: MapResponse;
  settings: PlayerSettings;
  readonly state: HudState;
  /** Joystick yönü (-1..1); React bileşeni yazar. */
  joystick: Vec = { x: 0, y: 0 };
  /** Sahnenin/mini haritanın seçtiği hedef nokta (tıkla-git). */
  pendingTarget: Vec | null = null;
  zoomDelta = 0;
  /** Harita değişince (veya yeniden bağlanınca) artar: sahne yeniden kurulur. */
  mapSeq = 0;
  /** Görünen diğer pilotlar (radar menzili) */
  readonly ships = new Map<number, RemoteShip>();
  myEntityId = 0;

  // --- tahmin
  private self: ShipState = { x: 0, y: 0, vx: 0, vy: 0, h: -Math.PI / 2 };
  private prev: ShipState = { ...this.self };
  private pending: Array<{ seq: number; input: MoveInput }> = [];
  private seq = 0;
  private target: Vec | null = null;
  private acc = 0;
  private lastFrame = 0;
  /** Uzlaştırma farkının görsel olarak yumuşatılması */
  private offset: Vec = { x: 0, y: 0 };
  private serverOffset: number | null = null;

  // --- bağlantı
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private toastId = 0;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** Aşama 14: son "kick" mesajının metni (kapanış gerekçesi olarak gösterilir) */
  private kickMessage: string | null = null;
  private firstWelcome: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  private jumpTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNearbyAt = 0;
  /** Sunucunun bildirdiği anlık hız (yavaşlatma etkisi dahil); tahmin bunu kullanır */
  private speedNow = 0;
  /** Sahnenin her karede boşalttığı görsel efekt kuyruğu */
  readonly fxQueue: Fx[] = [];

  constructor(settings: PlayerSettings) {
    this.settings = settings;
    this.state = {
      position: { x: 0, y: 0 },
      heading: -Math.PI / 2,
      moving: false,
      target: null,
      nearPortal: null,
      fps: 0,
      jumping: false,
      toast: null,
      conn: 'connecting',
      connMessage: null,
      reconnectAttempt: 0,
      ping: null,
      nearby: [],
      hp: 0,
      maxHp: 1,
      shield: 0,
      maxShield: 0,
      combat: { target: null, attacking: false, ammo: 'ammo.isk1', rocket: 'rocket.yildirim', counts: {}, rocketCooldownMs: 0, laserRange: 0, cargo: [0, 0] },
      dead: null,
      quests: [],
      questsVersion: 0,
      chat: [],
      chatUnread: 0,
      party: null,
      partyInvites: [],
      socialVersion: 0,
    };
  }

  // ================================================================== sohbet ve grup (Aşama 12)
  /** Sohbet paneli açık mı (kapalıyken gelen mesajlar okunmamış sayılır) */
  chatOpen = false;
  private historyLoaded = false;

  sendChat(ch: ChatChannel, text: string, to?: string) {
    const b = text.trim();
    if (!b) return;
    this.send({ t: 'chat', ch, b, ...(ch === 'dm' && to ? { to } : {}) });
  }

  partyAction(a: 'invite' | 'accept' | 'decline' | 'leave' | 'kick' | 'promote', n?: string) {
    if (a === 'accept' || a === 'decline') this.state.partyInvites = this.state.partyInvites.filter((i) => i.from !== n);
    this.send({ t: 'party', a, ...(n ? { n } : {}) });
    this.emit();
  }

  setChatOpen(open: boolean) {
    this.chatOpen = open;
    if (open) this.state.chatUnread = 0;
    if (open && !this.historyLoaded) void this.loadChatHistory();
    this.emit();
  }

  /** Genel, şirket ve klan kanallarının son mesajları (REST); canlı mesajlarla birleştirilir. */
  async loadChatHistory() {
    this.historyLoaded = true;
    const all: ChatMessageView[] = [];
    for (const ch of ['global', 'company', 'clan'] as const) {
      try {
        const r = await api<{ messages: ChatMessageView[] }>('GET', `/chat/history?server=${SERVER}&channel=${ch}`);
        all.push(...r.messages);
      } catch {
        /* klansız pilot için klan geçmişi yok */
      }
    }
    const seen = new Set(this.state.chat.map((m) => m.id));
    this.state.chat = [...all.filter((m) => !seen.has(m.id)), ...this.state.chat].sort((a, b) => a.id - b.id).slice(-CHAT_KEEP);
    this.emit();
  }

  /** Özel mesaj geçmişi (sekme açılınca) */
  async loadDmHistory(name: string) {
    try {
      const r = await api<{ messages: ChatMessageView[] }>('GET', `/chat/history?server=${SERVER}&channel=dm&with=${encodeURIComponent(name)}`);
      const seen = new Set(this.state.chat.map((m) => m.id));
      this.state.chat = [...this.state.chat, ...r.messages.filter((m) => !seen.has(m.id))].sort((a, b) => a.id - b.id).slice(-CHAT_KEEP);
      this.emit();
    } catch (e) {
      this.toast('error', e instanceof ApiError ? e.message : 'Mesaj geçmişi alınamadı.');
    }
  }

  // ================================================================== olaylar (HUD)
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const l of this.listeners) l();
  }

  toast(kind: 'info' | 'error' | 'success', text: string) {
    this.state.toast = { kind, text, id: ++this.toastId };
    this.emit();
  }

  // ================================================================== bağlantı
  /** İlk bağlantı: karşılama mesajı gelince çözülür (bilet hatası, ör. PILOT_NOT_FOUND, reddedilir). */
  connect(): Promise<void> {
    const p = new Promise<void>((resolve, reject) => (this.firstWelcome = { resolve, reject }));
    void this.open();
    this.timers.push(setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000));
    window.addEventListener('online', this.onOnline);
    return p;
  }

  private onOnline = () => {
    if (this.state.conn === 'reconnecting') {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      void this.open();
    }
  };

  private async open() {
    if (this.disposed) return;
    let ticket: string;
    try {
      ticket = (await api<{ ticket: string }>('POST', '/game/ticket', { serverCode: SERVER })).ticket;
    } catch (e) {
      if (this.firstWelcome && e instanceof ApiError && e.status >= 400 && e.status < 500 && e.code !== 'RATE_LIMITED') {
        this.firstWelcome.reject(e);
        this.firstWelcome = null;
        return;
      }
      if (e instanceof ApiError && (e.code === 'UNAUTHENTICATED' || e.code === 'EMAIL_NOT_VERIFIED')) {
        return this.end('ended', 'Oturumun sona erdi. Tekrar giriş yap.');
      }
      return this.scheduleReconnect();
    }
    if (this.disposed) return;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, ticket }));
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
    ws.onclose = (ev) => this.onClose(ws, ev.code, ev.reason);
  }

  private onClose(ws: WebSocket, code: number, reason: string) {
    if (this.ws !== ws || this.disposed) return;
    this.ws = null;
    if (code === CLOSE_CODES.REPLACED) return this.end('replaced', 'Hesabınla başka bir cihazdan oyuna girildi.');
    // Sunucu kapanıştan önce gerekçeyi "kick" mesajıyla gönderir (ban, askı, bakım): o metin gösterilir
    if (code === CLOSE_CODES.SESSION_ENDED) return this.end('ended', this.kickMessage ?? 'Oturumun sonlandırıldı. Tekrar giriş yap.');
    if (code === CLOSE_CODES.MAINTENANCE) return this.end('ended', this.kickMessage ?? 'Türk Orbit bakımda. Kısa süre içinde geri döneceğiz.');
    if (code === CLOSE_CODES.VERSION) return this.end('ended', 'Oyun güncellendi. Devam etmek için sayfayı yenile.');
    if (NO_RECONNECT_CODES.includes(code) && this.state.reconnectAttempt >= 3) return this.end('ended', reason || 'Oyun sunucusuna bağlanılamadı.');
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.disposed) return;
    const n = ++this.state.reconnectAttempt;
    this.state.conn = 'reconnecting';
    this.state.connMessage = 'Bağlantı koptu, yeniden bağlanılıyor…';
    this.emit();
    const delay = Math.min(10_000, 1000 * 2 ** Math.min(n - 1, 4));
    this.reconnectTimer = setTimeout(() => void this.open(), delay);
  }

  private end(conn: 'replaced' | 'ended', message: string) {
    this.state.conn = conn;
    this.state.connMessage = message;
    this.ws?.close(1000);
    this.ws = null;
    this.emit();
  }

  /** "Bu cihazda devam et": diğer cihazdaki bağlantıyı kapatarak yeniden bağlanır. */
  resume() {
    this.state.conn = 'connecting';
    this.state.connMessage = null;
    this.state.reconnectAttempt = 0;
    this.emit();
    void this.open();
  }

  dispose() {
    this.disposed = true;
    for (const t of this.timers) clearInterval(t);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.jumpTimer) clearTimeout(this.jumpTimer);
    window.removeEventListener('online', this.onOnline);
    this.ws?.close(1000);
    this.ws = null;
    this.listeners.clear();
  }

  private send(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.state.conn === 'online') this.ws.send(JSON.stringify(msg));
  }

  // ================================================================== sunucu mesajları
  private onMessage(m: ServerMessage) {
    // Savunma: harita (welcome) gelmeden dünya mesajları işlenmez.
    if (!this.map && m.t !== 'welcome' && m.t !== 'kick' && m.t !== 'pong') return;
    switch (m.t) {
      case 'welcome': {
        this.myEntityId = m.id;
        this.resetWorld(m.map, m.you);
        const wasReconnect = this.state.reconnectAttempt > 0;
        this.state.conn = 'online';
        this.state.connMessage = null;
        this.state.reconnectAttempt = 0;
        this.mapSeq++;
        if (this.firstWelcome) {
          this.firstWelcome.resolve();
          this.firstWelcome = null;
        } else if (wasReconnect) this.toast('success', 'Yeniden bağlandın.');
        this.emit();
        void this.refreshQuests();
        break;
      }
      case 'map':
        this.resetWorld(m.map, m.you);
        this.state.jumping = false;
        if (this.jumpTimer) clearTimeout(this.jumpTimer);
        this.mapSeq++;
        if (m.reason === 'portal') this.toast('success', `${m.map.map.code} ${m.map.map.name} bölgesine geçtin.`);
        if (m.reason === 'respawn') {
          this.state.dead = null;
          this.toast('info', `${m.map.map.code} istasyonunda acil onarımla yeniden doğdun. Tam onarım hangarda.`);
        }
        this.emit();
        break;
      case 'cs': {
        const { t: _t, ...cs } = m;
        this.state.combat = cs;
        this.emit();
        break;
      }
      case 'reward':
        this.onReward(m);
        break;
      case 'qp':
        this.onQuestProgress(m.u);
        break;
      case 'quests':
        this.state.questsVersion++;
        void this.refreshQuests();
        break;
      case 'dead':
        this.state.dead = { by: m.by, kind: m.kind };
        this.state.combat = { ...this.state.combat, target: null, attacking: false };
        this.target = null;
        this.emit();
        break;
      case 'snap':
        this.onSnapshot(m);
        break;
      case 'enter':
        for (const info of m.e) {
          if (info.id === this.myEntityId) continue;
          const known = this.ships.get(info.id);
          // Bilgisi güncellenen (ör. klan etiketi) varlığın konum tamponu korunur
          if (known) known.info = info;
          else this.ships.set(info.id, { info, buf: [], x: NaN, y: NaN, h: 0, hp: 100, sh: 0 });
        }
        break;
      case 'leave':
        for (const id of m.e) this.ships.delete(id);
        break;
      case 'pilot':
        this.map = {
          ...this.map,
          pilot: { ...this.map.pilot, ship: m.ship },
          rules: { ...this.map.rules, detection: { ...this.map.rules.detection, radar: m.radar } },
        };
        this.toast('info', `Gemi değerleri güncellendi (hız ${m.ship.speed}).`);
        break;
      case 'notice':
        this.toast(m.kind, m.text);
        break;
      case 'chat':
        this.state.chat = [...this.state.chat, m.m].slice(-CHAT_KEEP);
        if (!this.chatOpen) this.state.chatUnread++;
        this.emit();
        break;
      case 'party':
        this.state.party = m.p;
        this.emit();
        break;
      case 'pinv':
        this.state.partyInvites = [
          ...this.state.partyInvites.filter((i) => i.from !== m.from),
          { from: m.from, level: m.level, company: m.company, expiresAt: Date.now() + m.expiresIn * 1000 },
        ];
        this.emit();
        break;
      case 'notif':
        this.toast('info', m.n.body ? `${m.n.title}: ${m.n.body}` : m.n.title);
        break;
      case 'social':
        this.state.socialVersion++;
        this.emit();
        break;
      case 'error':
        this.state.jumping = false;
        if (this.jumpTimer) clearTimeout(this.jumpTimer);
        this.toast('error', m.message);
        break;
      case 'kick':
        this.state.connMessage = m.message;
        this.kickMessage = m.message;
        break;
      case 'pong':
        this.state.ping = Math.round(performance.now() - m.c);
        break;
    }
  }

  private resetWorld(map: MapResponse, you: [number, number, number, number, number]) {
    this.map = map;
    this.speedNow = map.pilot.ship.speed;
    this.state.hp = map.pilot.ship.hitpoints;
    this.state.maxHp = map.pilot.ship.maxHitpoints;
    this.fxQueue.length = 0;
    this.self = { x: you[0], y: you[1], vx: you[2], vy: you[3], h: you[4] };
    this.prev = { ...this.self };
    this.pending = [];
    this.target = null;
    this.offset = { x: 0, y: 0 };
    this.acc = 0;
    this.lastFrame = 0;
    this.ships.clear();
    this.state.position = { x: you[0], y: you[1] };
    this.state.heading = you[4];
    this.state.target = null;
    this.state.nearPortal = null;
    this.state.nearby = [];
  }

  private onSnapshot(m: Extract<ServerMessage, { t: 'snap' }>) {
    const now = performance.now();
    const sample = m.k * TICK_MS - now;
    // Sunucu saati tahmini: erken gelen görüntü saati hemen ileri alır, geç gelenler yavaşça geri çeker.
    this.serverOffset =
      this.serverOffset === null ? sample : sample > this.serverOffset ? sample : this.serverOffset + (sample - this.serverOffset) * 0.05;
    // --- uzlaştırma: sunucu durumu + onaylanmamış girdilerin yeniden oynatılması
    const [hp, maxHp, sh, maxSh, speed] = m.st;
    this.state.hp = hp;
    this.state.maxHp = maxHp;
    this.state.shield = sh;
    this.state.maxShield = maxSh;
    this.speedNow = speed;
    if (m.fx) for (const f of m.fx) this.fxQueue.push(f);
    if (this.fxQueue.length > 200) this.fxQueue.splice(0, this.fxQueue.length - 200);
    this.pending = this.pending.filter((p) => p.seq > m.a);
    const before = { x: this.self.x, y: this.self.y };
    const s: ShipState = { x: m.y[0], y: m.y[1], vx: m.y[2], vy: m.y[3], h: m.y[4] };
    const { width, height } = this.map.map;
    for (const p of this.pending) stepShip(s, p.input, TICK_MS / 1000, this.speedNow, width, height);
    const ex = before.x - s.x;
    const ey = before.y - s.y;
    if (Math.hypot(ex, ey) > SNAP_CORRECTION) this.offset = { x: 0, y: 0 };
    else {
      this.offset.x += ex;
      this.offset.y += ey;
    }
    this.prev = { ...this.prev, x: this.prev.x - ex, y: this.prev.y - ey };
    this.self = s;
    // --- diğer pilotlar: enterpolasyon tamponu
    const t = m.k * TICK_MS;
    for (const [id, x, y, h, , , hpPct, shPct] of m.e) {
      const ship = this.ships.get(id);
      if (!ship) continue;
      ship.hp = hpPct;
      ship.sh = shPct;
      ship.buf.push({ t, x, y, h });
      if (ship.buf.length > 20) ship.buf.shift();
    }
  }

  // ================================================================== kare güncellemesi (sahne çağırır)
  /**
   * dir: klavye/joystick yönü (-1..1). Sabit 50 ms adımlarla tahmin yapar, girdileri gönderir,
   * çizim için yumuşatılmış konumu ve diğer pilotların enterpolasyonlu konumunu hesaplar.
   */
  update(now: number, dir: Vec): { x: number; y: number; h: number; moving: boolean } {
    if (this.pendingTarget) {
      this.target = this.pendingTarget;
      this.pendingTarget = null;
    }
    const online = this.state.conn === 'online' && !this.state.dead;
    let frameMs = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    // Sekme arka plandaydı/duraklatıldı: kaçırılan adımlar simüle edilmez, sunucu görüntüsü gerçeği getirir.
    if (frameMs > 250) frameMs = 0;
    if (online) this.acc += frameMs;
    const batch: Array<[number, number, number, number]> = [];
    const { width, height } = this.map.map;
    const speed = this.speedNow;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      const input = this.currentInput(dir);
      const seq = ++this.seq;
      this.prev = { ...this.self };
      stepShip(this.self, input, TICK_MS / 1000, speed, width, height);
      this.pending.push({ seq, input });
      if (this.pending.length > 100) this.pending.shift();
      batch.push([seq, input.m, input.x, input.y]);
    }
    if (batch.length) this.send({ t: 'in', i: batch.slice(-10) });

    // Görsel düzeltme farkı ~10/sn hızla sönümlenir.
    const k = Math.exp(-frameMs / 100);
    this.offset.x *= k;
    this.offset.y *= k;
    const a = Math.min(1, this.acc / TICK_MS);
    const x = this.prev.x + (this.self.x - this.prev.x) * a + this.offset.x;
    const y = this.prev.y + (this.self.y - this.prev.y) * a + this.offset.y;
    const h = lerpAngle(this.prev.h, this.self.h, a);
    this.interpolate(now);
    if (now - this.lastNearbyAt > 250) {
      this.lastNearbyAt = now;
      this.state.nearby = [...this.ships.values()]
        .filter((s) => s.info.k === 'p' && Number.isFinite(s.x))
        .map((s) => ({
          id: s.info.id,
          name: s.info.n,
          color: s.info.c,
          company: s.info.cc,
          level: s.info.l,
          distance: Math.round(Math.hypot(s.x - x, s.y - y)),
        }))
        .sort((p, q) => p.distance - q.distance);
    }
    this.state.target = this.target;
    return { x, y, h, moving: Math.hypot(this.self.vx, this.self.vy) > 6 };
  }

  private currentInput(dir: Vec): MoveInput {
    if (Math.hypot(dir.x, dir.y) > 0.15) {
      this.target = null;
      return { m: 1, x: Math.round(dir.x * 100) / 100, y: Math.round(dir.y * 100) / 100 };
    }
    if (this.target) {
      const input: MoveInput = { m: 2, x: Math.round(this.target.x), y: Math.round(this.target.y) };
      if (arrived(this.self, input)) {
        this.target = null;
        return IDLE_INPUT;
      }
      return input;
    }
    return IDLE_INPUT;
  }

  private interpolate(now: number) {
    if (this.serverOffset === null) return;
    const rt = now + this.serverOffset - INTERP_DELAY;
    for (const s of this.ships.values()) {
      const b = s.buf;
      if (b.length === 0) continue;
      let i = b.length - 1;
      while (i > 0 && b[i - 1]!.t > rt) i--;
      const p1 = b[i]!;
      const p0 = i > 0 ? b[i - 1]! : p1;
      if (rt >= p1.t || p0 === p1) {
        // Görüntü gecikti: en fazla 100 ms son yönde devam et, sonra bekle.
        const span = p1.t - p0.t || TICK_MS;
        const over = p0 === p1 ? 0 : Math.min(100, Math.max(0, rt - p1.t));
        s.x = p1.x + ((p1.x - p0.x) / span) * over;
        s.y = p1.y + ((p1.y - p0.y) / span) * over;
        s.h = p1.h;
      } else {
        const t = (rt - p0.t) / (p1.t - p0.t);
        s.x = p0.x + (p1.x - p0.x) * t;
        s.y = p0.y + (p1.y - p0.y) * t;
        s.h = lerpAngle(p0.h, p1.h, t);
      }
    }
  }

  // ================================================================== savaş komutları (niyet; karar sunucuda)
  // ================================================================== görevler
  /** HUD izleyicisi için görev listesi (oyun sunucusu ilerlemeyi 'qp' ile anlık bildirir). */
  async refreshQuests() {
    try {
      const r = await api<{ quests: QuestsResponse }>('GET', `/quests?server=${SERVER}`);
      if (this.disposed) return;
      this.state.quests = r.quests.quests;
      this.emit();
    } catch {
      /* görev listesi alınamazsa izleyici boş kalır; oyun etkilenmez */
    }
  }

  setQuests(q: QuestsResponse) {
    this.state.quests = q.quests;
    this.emit();
  }

  /** Görev ödülüyle seviye değişince HUD güncellenir (oyun sunucusu da 'quests' ile yeniler). */
  applyLevel(level: number) {
    if (level === this.map.pilot.level) return;
    this.map = { ...this.map, pilot: { ...this.map.pilot, level } };
    this.emit();
  }

  private onQuestProgress(updates: QuestProgressUpdate[]) {
    let missing = false;
    for (const u of updates) {
      const q = this.state.quests.find((x) => x.code === u.code && x.cycle === u.cycle);
      if (!q) {
        missing = true;
        continue;
      }
      q.status = u.status;
      for (const o of u.objectives) {
        const obj = q.objectives.find((x) => x.id === o.id);
        if (obj) obj.current = o.current;
      }
    }
    this.state.quests = [...this.state.quests];
    this.emit();
    if (missing) void this.refreshQuests();
  }

  private onReward(m: RewardMessage) {
    const parts: string[] = [];
    if (m.xp) parts.push(`+${fmtN(m.xp)} deneyim`);
    if (m.honor) parts.push(`+${fmtN(m.honor)} şeref`);
    for (const c of m.currencies) parts.push(`+${fmtN(c.amount)} ${c.code === 'KREDI' ? 'Kredi' : c.code === 'AKCE' ? 'Akçe' : c.code}`);
    for (const it of m.items) parts.push(`${fmtN(it.amount)} × ${it.name}`);
    if (m.clanTax) parts.push(`klan vergisi −${fmtN(m.clanTax)} Kredi`);
    this.toast('success', `${m.source}: ${parts.join(' · ') || 'ödül yok'}`);
    if (m.levelUp) {
      this.map = { ...this.map, pilot: { ...this.map.pilot, level: m.level } };
      setTimeout(() => this.toast('success', `Seviye atladın! Artık seviye ${m.level}.`), 1500);
    }
  }

  selectTarget(id: number | null) {
    if (this.state.dead) return;
    this.send({ t: 'target', id });
    this.state.combat = { ...this.state.combat, target: id, attacking: false };
    this.emit();
  }

  setAttack(on: boolean) {
    if (on && this.state.combat.target === null) {
      this.toast('error', 'Önce bir hedef seç (tıkla/dokun veya Tab).');
      return;
    }
    this.send({ t: 'attack', on });
  }

  toggleAttack() {
    this.setAttack(!this.state.combat.attacking);
  }

  selectAmmo(code: AmmoCode) {
    this.send({ t: 'ammo', c: code });
    if ((this.state.combat.counts[code] ?? 0) === 0) this.toast('error', `${AMMO_LABELS[code]} yok. Mağazadan alabilirsin.`);
  }

  selectRocket(code: RocketCode) {
    this.send({ t: 'rtype', c: code });
  }

  fireRocket() {
    if (this.state.combat.target === null) {
      this.toast('error', 'Önce bir hedef seç.');
      return;
    }
    this.send({ t: 'rocket' });
  }

  respawn() {
    this.send({ t: 'respawn' });
  }

  /** En yakın NPC veya düşman pilotu hedefler; tekrar basılırsa bir sonrakine geçer. */
  targetNearest(from: Vec) {
    const mine = this.map.pilot.company.code;
    const list = [...this.ships.values()]
      .filter((s) => Number.isFinite(s.x) && (s.info.k === 'n' || (s.info.k === 'p' && s.info.cc !== mine)))
      .map((s) => ({ id: s.info.id, d: Math.hypot(s.x - from.x, s.y - from.y) }))
      .sort((a, b) => a.d - b.d);
    if (list.length === 0) {
      this.toast('info', 'Radar menzilinde hedef yok.');
      return;
    }
    const cur = list.findIndex((e) => e.id === this.state.combat.target);
    this.selectTarget(list[(cur + 1) % list.length]!.id);
  }

  // ================================================================== geçit ve ayarlar
  jump() {
    const portal = this.state.nearPortal;
    if (!portal || this.state.jumping || this.state.conn !== 'online') return;
    if (!portal.access.ok) {
      this.toast('error', portal.access.reason);
      return;
    }
    this.state.jumping = true;
    this.emit();
    this.send({ t: 'jump', p: portal.id });
    this.jumpTimer = setTimeout(() => {
      this.state.jumping = false;
      this.emit();
    }, 6000);
  }

  setTarget(p: Vec | null) {
    this.pendingTarget = p;
  }

  async saveSettings(settings: PlayerSettings, deviceClass: string) {
    await api('PUT', '/settings', { deviceClass, settings });
    this.settings = settings;
    this.emit();
  }
}
