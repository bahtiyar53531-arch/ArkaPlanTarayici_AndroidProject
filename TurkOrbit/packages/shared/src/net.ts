/**
 * Türk Orbit gerçek zamanlı ağ protokolü (Aşama 8) ve deterministik hareket simülasyonu.
 *
 * Oyun sunucusu ve istemci AYNI `stepShip` fonksiyonunu çalıştırır:
 *  - Sunucu otoritedir: her tikte (50 ms) oyuncunun girdisiyle bir adım ilerletir.
 *  - İstemci tahmin eder: aynı girdiyle aynı adımı hemen uygular (gecikme hissedilmez).
 *  - Anlık görüntü `ack` (son işlenen girdi) ile gelir; istemci sunucu durumuna döner ve
 *    onaylanmamış girdileri yeniden uygular (uzlaştırma).
 *
 * Mesajlar şimdilik JSON'dur (kısa alan adlarıyla). İkili protokol Aşama 16'da (performans) ele alınacak.
 */
import { z } from 'zod';
import { AMMO_CODES, ROCKET_CODES, type CombatState, type Fx, type RewardMessage } from './combat.js';

export const PROTOCOL_VERSION = 2;
/** Sunucu simülasyon adımı (20 Hz). */
export const TICK_MS = 50;
/** Kaç tikte bir anlık görüntü gönderilir (2 → 10 Hz). */
export const SNAPSHOT_EVERY = 2;
/** Hedefe bu mesafeden yakınsa varılmış sayılır. */
export const ARRIVE_DISTANCE = 8;

// ------------------------------------------------------------------ hareket simülasyonu
export interface ShipState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Burun yönü (radyan, 0 = sağ, saat yönünde artar; ekran koordinatları) */
  h: number;
}

/** m: 0 = dur, 1 = yön (x,y ∈ [-1,1]: klavye/joystick), 2 = hedef nokta (x,y dünya koordinatı: tıkla-git) */
export interface MoveInput {
  m: 0 | 1 | 2;
  x: number;
  y: number;
}

export const IDLE_INPUT: MoveInput = Object.freeze({ m: 0, x: 0, y: 0 }) as MoveInput;

const ACCEL = 6; // hız yumuşatma katsayısı (1/sn)
const TURN_RATE = 6; // dönüş hızı (rad/sn)
const SLOWDOWN_DISTANCE = 160; // hedefe yaklaşırken yavaşlama mesafesi

export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  return a - t * Math.floor((a + Math.PI) / t);
}

export function rotateTowards(current: number, target: number, maxStep: number): number {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * maxStep);
}

/**
 * Bir simülasyon adımı. Durumu YERİNDE değiştirir ve döner.
 * Hız asla `speed` değerini aşmaz; konum harita sınırına kırpılır.
 */
export function stepShip(s: ShipState, input: MoveInput, dtSeconds: number, speed: number, width: number, height: number): ShipState {
  let dx = 0;
  let dy = 0;
  if (input.m === 1) {
    const mag = Math.hypot(input.x, input.y);
    if (mag > 0.05) {
      const m = Math.min(1, mag);
      dx = (input.x / mag) * speed * m;
      dy = (input.y / mag) * speed * m;
    }
  } else if (input.m === 2) {
    const tx = input.x - s.x;
    const ty = input.y - s.y;
    const d = Math.hypot(tx, ty);
    if (d >= ARRIVE_DISTANCE) {
      const v = speed * Math.min(1, d / SLOWDOWN_DISTANCE);
      dx = (tx / d) * v;
      dy = (ty / d) * v;
    }
  }
  const a = 1 - Math.exp(-dtSeconds * ACCEL);
  s.vx += (dx - s.vx) * a;
  s.vy += (dy - s.vy) * a;
  let v = Math.hypot(s.vx, s.vy);
  if (v > speed) {
    const k = speed > 0 ? speed / v : 0;
    s.vx *= k;
    s.vy *= k;
    v = speed;
  }
  if (v < 0.5 && input.m === 0) {
    s.vx = 0;
    s.vy = 0;
    v = 0;
  }
  s.x = Math.min(width, Math.max(0, s.x + s.vx * dtSeconds));
  s.y = Math.min(height, Math.max(0, s.y + s.vy * dtSeconds));
  if (v > 6) s.h = rotateTowards(s.h, Math.atan2(s.vy, s.vx), TURN_RATE * dtSeconds);
  return s;
}

/** Hedef girdisi için: hedefe varıldı mı? (istemci bu durumda girdiyi "dur"a çevirir) */
export function arrived(s: ShipState, input: MoveInput): boolean {
  return input.m === 2 && Math.hypot(input.x - s.x, input.y - s.y) < ARRIVE_DISTANCE && Math.hypot(s.vx, s.vy) < 6;
}

// ------------------------------------------------------------------ istemci → sunucu
const finite = z.number().finite();
/** Girdi komutu: [seq, mod, x, y] */
const inputCommand = z.tuple([z.number().int().nonnegative(), z.union([z.literal(0), z.literal(1), z.literal(2)]), finite, finite]);

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('hello'), v: z.number().int(), ticket: z.string().min(20).max(200) }),
  z.strictObject({ t: z.literal('in'), i: z.array(inputCommand).min(1).max(10) }),
  z.strictObject({ t: z.literal('jump'), p: z.number().int().positive() }),
  z.strictObject({ t: z.literal('ping'), c: finite }),
  // --- Aşama 9: savaş niyetleri (hasar, menzil ve atış hızı yalnızca sunucuda hesaplanır)
  z.strictObject({ t: z.literal('target'), id: z.number().int().positive().nullable() }),
  z.strictObject({ t: z.literal('attack'), on: z.boolean() }),
  z.strictObject({ t: z.literal('ammo'), c: z.enum(AMMO_CODES) }),
  z.strictObject({ t: z.literal('rtype'), c: z.enum(ROCKET_CODES) }),
  z.strictObject({ t: z.literal('rocket') }),
  z.strictObject({ t: z.literal('respawn') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type InputCommand = z.infer<typeof inputCommand>;

/** Yön girdisi [-1,1] aralığına, hedef girdisi harita sınırına sıkıştırılır (sunucu da aynısını yapar). */
export function sanitizeInput(cmd: InputCommand, width: number, height: number): MoveInput {
  const [, m, x, y] = cmd;
  if (m === 1) return { m, x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  if (m === 2) return { m, x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)) };
  return { m: 0, x: 0, y: 0 };
}

// ------------------------------------------------------------------ sunucu → istemci
/** Kendi gemi durumu: [x, y, vx, vy, h] (2 ondalık) */
export type SelfState = [number, number, number, number, number];
/** Görünen varlık: [id, x, y, h, vx, vy, can%, kalkan%] (konum tam sayı, yön 2 ondalık, yüzdeler 0–100) */
export type EntityState = [number, number, number, number, number, number, number, number];
/** Kendi değerlerin: [can, azami can, kalkan, azami kalkan, anlık hız] (hız yavaşlatma etkisini içerir; tahmin bunu kullanır) */
export type SelfStats = [number, number, number, number, number];

export interface EntityInfo {
  id: number;
  /** tür: p = pilot, n = NPC, c = kargo kutusu */
  k: 'p' | 'n' | 'c';
  /** ad (pilot adı / NPC türü) */
  n: string;
  /** şirket kodu (NPC ve kargo için boş) ve renk */
  cc: string;
  c: string;
  /** çizim anahtarı (gemi, NPC ailesi, kargo) */
  s: string;
  /** seviye / kademe */
  l: number;
  /** çizim ölçeği (NPC) */
  z?: number;
  /** boss mu */
  b?: boolean;
}

export interface ShipInfo {
  name: string;
  spriteKey: string;
  hitpoints: number;
  maxHitpoints: number;
  shield: number;
  speed: number;
}

export type ServerMessage =
  | { t: 'welcome'; id: number; tick: number; tickMs: number; map: import('./world.js').MapResponse; you: SelfState }
  | { t: 'map'; tick: number; map: import('./world.js').MapResponse; you: SelfState; reason: 'portal' | 'map_closed' | 'respawn' }
  | { t: 'snap'; k: number; a: number; y: SelfState; st: SelfStats; e: EntityState[]; fx?: Fx[] }
  | { t: 'enter'; e: EntityInfo[] }
  | { t: 'leave'; e: number[] }
  | { t: 'pilot'; ship: ShipInfo; radar: number }
  | { t: 'notice'; kind: 'info' | 'error' | 'success'; text: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'kick'; code: number; message: string }
  | { t: 'pong'; c: number; s: number }
  | ({ t: 'cs' } & CombatState)
  | RewardMessage
  | { t: 'dead'; by: string | null; kind: 'npc' | 'player' | 'other' };

/** WebSocket kapanış kodları (4000–4999 uygulamaya ayrılmıştır) */
export const CLOSE_CODES = {
  PROTOCOL: 4000,
  AUTH_FAILED: 4001,
  REPLACED: 4002,
  SESSION_ENDED: 4003,
  SHUTDOWN: 4004,
  HELLO_TIMEOUT: 4008,
  RATE_LIMITED: 4009,
  VERSION: 4010,
} as const;

/** İstemcinin yeniden bağlanmaması gereken kapanışlar (kullanıcı işlemi gerekir). */
export const NO_RECONNECT_CODES: readonly number[] = [
  CLOSE_CODES.AUTH_FAILED,
  CLOSE_CODES.REPLACED,
  CLOSE_CODES.SESSION_ENDED,
  CLOSE_CODES.VERSION,
];

export const ticketRequestSchema = z.strictObject({ serverCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/) });

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const selfState = (s: ShipState): SelfState => [r2(s.x), r2(s.y), r2(s.vx), r2(s.vy), r2(s.h)];
