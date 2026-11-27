/**
 * Türk Orbit dünya kuralları: harita giriş koşulları, konum doğrulaması (hız denetimi), oyuncu ayarları.
 * Sunucu bu fonksiyonlarla KARAR verir; istemci yalnızca kullanıcıya önceden bilgi göstermek için kullanır.
 */
import { z } from 'zod';

// ------------------------------------------------------------------ harita giriş koşulları
export interface MapEntryInput {
  playerLevel: number;
  playerCompanyCode: string;
  map: {
    minLevel: number;
    companyCode: string | null;
    isClosed: boolean;
    entryRules: { enemy_company_min_level?: number; min_level?: number };
  };
  /** Portalın kendi ek koşulları */
  portalRules?: { min_level?: number };
}

export type MapEntryResult =
  | { ok: true }
  | { ok: false; code: 'MAP_CLOSED' | 'MAP_LOCKED'; reason: string; requiredLevel?: number };

export function canEnterMap(i: MapEntryInput): MapEntryResult {
  if (i.map.isClosed) return { ok: false, code: 'MAP_CLOSED', reason: 'Bu harita bakım nedeniyle geçici olarak kapalı.' };
  let required = Math.max(i.map.minLevel, i.map.entryRules.min_level ?? 1, i.portalRules?.min_level ?? 1);
  let enemy = false;
  if (i.map.companyCode && i.map.companyCode !== i.playerCompanyCode && i.map.entryRules.enemy_company_min_level) {
    required = Math.max(required, i.map.entryRules.enemy_company_min_level);
    enemy = true;
  }
  if (i.playerLevel < required) {
    return {
      ok: false,
      code: 'MAP_LOCKED',
      requiredLevel: required,
      reason: enemy
        ? `Düşman şirket bölgesine girmek için en az seviye ${required} olmalısın.`
        : `Bu haritaya girmek için en az seviye ${required} olmalısın.`,
    };
  }
  return { ok: true };
}

// ------------------------------------------------------------------ konum doğrulaması
export interface MovementRules {
  /** İzin verilen mesafe çarpanı (ağ gecikmesi/saat farkı payı) */
  tolerance: number;
  /** Sabit ek pay (birim) */
  slack: number;
  /** Geçen süre bu değerle sınırlanır (uzun beklemeden sonra ışınlanma olmasın) */
  max_elapsed_seconds: number;
}

export const DEFAULT_MOVEMENT_RULES: MovementRules = { tolerance: 1.25, slack: 300, max_elapsed_seconds: 10 };

export interface MoveCheck {
  ok: boolean;
  distance: number;
  allowed: number;
  reason?: 'out_of_bounds' | 'too_fast';
}

/** Hız birimi: birim/saniye. Sunucu yeni konumu bu kurala göre kabul eder veya reddeder. */
export function checkMove(
  from: { x: number; y: number },
  to: { x: number; y: number },
  speed: number,
  elapsedMs: number,
  bounds: { width: number; height: number },
  rules: MovementRules = DEFAULT_MOVEMENT_RULES,
): MoveCheck {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const elapsed = Math.min(Math.max(0, elapsedMs) / 1000, rules.max_elapsed_seconds);
  const allowed = speed * elapsed * rules.tolerance + rules.slack;
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || to.x < 0 || to.y < 0 || to.x > bounds.width || to.y > bounds.height) {
    return { ok: false, distance, allowed, reason: 'out_of_bounds' };
  }
  if (distance > allowed) return { ok: false, distance, allowed, reason: 'too_fast' };
  return { ok: true, distance, allowed };
}

export function insideCircle(p: { x: number; y: number }, c: { x: number; y: number; r: number }): boolean {
  return Math.hypot(p.x - c.x, p.y - c.y) <= c.r;
}

/** HUD kuralları (madde 18): algılama mesafeleri. Mini harita bu mesafe dışındaki düşman/kargoyu göstermez. */
export const DETECTION = {
  /** Temel radar menzili; Uzun Menzil Radar ekstrası (radarBonus) eklenir. */
  baseRadar: 1500,
  /** Kargo kutuları yalnızca bu yakınlıkta görünür. */
  cargo: 600,
} as const;

// ------------------------------------------------------------------ istek şemaları
const server = z.string().trim().regex(/^[A-Za-z0-9-]{1,16}$/).transform((v) => v.toUpperCase());
const coord = z.number().finite().min(-100_000).max(100_000);

export const positionSchema = z.strictObject({ serverCode: server, x: coord, y: coord });
export const jumpSchema = z.strictObject({
  serverCode: server,
  portalId: z.number().int().positive(),
  x: coord,
  y: coord,
});

// ------------------------------------------------------------------ oyuncu ayarları (madde 16.2–16.5)
export const DEVICE_CLASSES = ['desktop', 'phone', 'tablet'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

const keyCode = z.string().regex(/^[A-Za-z0-9]{1,20}$/);

export const settingsSchema = z.strictObject({
  controls: z.strictObject({
    /** Dokunmatikte hareket: sanal joystick veya dokun-git */
    mode: z.enum(['joystick', 'tap']),
    joystickSide: z.enum(['left', 'right']),
    joystickSize: z.number().min(0.6).max(1.6),
    joystickOpacity: z.number().min(0.2).max(1),
    /** Joystick'in alt kenardan yüksekliği (ekran yüksekliğinin oranı) */
    joystickOffsetY: z.number().min(0).max(0.4),
    keyboardMove: z.boolean(),
  }),
  keys: z.strictObject({
    up: keyCode,
    down: keyCode,
    left: keyCode,
    right: keyCode,
    jump: keyCode,
    galaxy: keyCode,
    zoomIn: keyCode,
    zoomOut: keyCode,
    fullscreen: keyCode,
  }),
  graphics: z.strictObject({
    quality: z.enum(['low', 'medium', 'high']),
    fpsLimit: z.union([z.literal(30), z.literal(60), z.literal(120)]),
    showFps: z.boolean(),
  }),
  hud: z.strictObject({
    scale: z.number().min(0.75).max(1.5),
    minimapSize: z.enum(['small', 'medium', 'large']),
    showCoordinates: z.boolean(),
  }),
});
export type PlayerSettings = z.infer<typeof settingsSchema>;

export function defaultSettings(device: DeviceClass): PlayerSettings {
  const touch = device !== 'desktop';
  return {
    controls: {
      mode: 'joystick',
      joystickSide: 'left',
      joystickSize: device === 'tablet' ? 1.1 : 1,
      joystickOpacity: 0.6,
      joystickOffsetY: 0.08,
      keyboardMove: true,
    },
    keys: {
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      jump: 'KeyJ',
      galaxy: 'KeyM',
      zoomIn: 'Equal',
      zoomOut: 'Minus',
      fullscreen: 'KeyF',
    },
    graphics: { quality: device === 'phone' ? 'medium' : 'high', fpsLimit: 60, showFps: false },
    hud: { scale: device === 'phone' ? 0.9 : 1, minimapSize: touch ? 'small' : 'medium', showCoordinates: true },
  };
}

export const updateSettingsSchema = z.strictObject({ deviceClass: z.enum(DEVICE_CLASSES), settings: settingsSchema });

// ------------------------------------------------------------------ API tipleri
export interface GalaxyMap {
  code: string;
  name: string;
  mapType: string;
  company: { code: string; colorHex: string } | null;
  minLevel: number;
  pvpEnabled: boolean;
  galaxyX: number;
  galaxyY: number;
  isClosed: boolean;
  access: MapEntryResult;
}

export interface GalaxyResponse {
  currentMap: string;
  maps: GalaxyMap[];
  links: Array<[string, string]>;
}

export interface PortalInfo {
  id: number;
  x: number;
  y: number;
  target: { code: string; name: string; mapType: string };
  access: MapEntryResult;
}

export interface ZoneInfo {
  id: number;
  zoneType: 'station' | 'safe' | 'resource' | 'no_pvp';
  name: string;
  x: number;
  y: number;
  r: number;
  properties: Record<string, unknown>;
}

export interface MapResponse {
  serverCode: string;
  pilot: {
    pilotName: string;
    level: number;
    company: { code: string; name: string; colorHex: string };
    ship: { name: string; spriteKey: string; hitpoints: number; maxHitpoints: number; shield: number; speed: number };
  };
  map: {
    code: string;
    name: string;
    mapType: string;
    width: number;
    height: number;
    backgroundKey: string;
    pvpEnabled: boolean;
    company: { code: string; colorHex: string } | null;
  };
  position: { x: number; y: number };
  portals: PortalInfo[];
  zones: ZoneInfo[];
  rules: { jumpRadius: number; movement: MovementRules; detection: { radar: number; cargo: number } };
  /** Pilot bulunduğu harita kapatıldığı için taşındıysa bilgi mesajı */
  notice: string | null;
}
