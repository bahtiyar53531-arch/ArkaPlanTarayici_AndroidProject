import {
  canEnterMap,
  DEFAULT_MOVEMENT_RULES,
  defaultSettings,
  DETECTION,
  DEVICE_CLASSES,
  levelForXp,
  settingsSchema,
  updateSettingsSchema,
  type DeviceClass,
  type GalaxyResponse,
  type MapResponse,
  type MovementRules,
  type PlayerSettings,
} from '@turkorbit/shared';
import { withTransaction, type Db, type Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { getSetting } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import { activeShipStats } from '../hangar/stats.js';

interface Owner {
  id: string;
}

export interface PilotWorldRow {
  id: string;
  server_code: string;
  pilot_name: string;
  experience: string;
  company_id: number;
  company_code: string;
  company_name: string;
  company_color: string;
  home_map_id: number;
  map_id: number;
  pos_x: number;
  pos_y: number;
  pos_updated_at: Date;
}

interface MapRow {
  id: number;
  code: string;
  name: string;
  map_type: string;
  width: number;
  height: number;
  spawn_x: number;
  spawn_y: number;
  background_key: string;
  min_level: number;
  entry_rules: { enemy_company_min_level?: number; min_level?: number };
  pvp_enabled: boolean;
  is_closed: boolean;
  galaxy_x: number;
  galaxy_y: number;
  company_code: string | null;
  company_color: string | null;
}

const MAP_SELECT = `SELECT m.id, m.code, m.name, m.map_type, m.width, m.height, m.spawn_x, m.spawn_y, m.background_key,
  m.min_level, m.entry_rules, m.pvp_enabled, m.is_closed, m.galaxy_x, m.galaxy_y,
  c.code AS company_code, c.color_hex AS company_color
  FROM maps m LEFT JOIN companies c ON c.id = m.company_id`;

const err = (code: ConstructorParameters<typeof AppError>[0], status: number, message: string) => new AppError(code, status, message);

export class WorldService {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  private static readonly PILOT_SELECT = `SELECT p.id, s.code AS server_code, p.pilot_name::text AS pilot_name, p.experience,
      p.company_id, co.code AS company_code, co.name AS company_name, co.color_hex AS company_color, co.home_map_id,
      p.map_id, p.pos_x, p.pos_y, p.pos_updated_at
    FROM players p JOIN game_servers s ON s.id = p.server_id JOIN companies co ON co.id = p.company_id`;

  private async pilot(c: Queryable, owner: Owner, serverCode: string, lock = false): Promise<PilotWorldRow> {
    const r = await c.query<PilotWorldRow>(
      `${WorldService.PILOT_SELECT} WHERE p.user_id = $1 AND s.code = $2 ${lock ? 'FOR UPDATE OF p' : ''}`,
      [owner.id, serverCode],
    );
    const p = r.rows[0];
    if (!p) throw err('PILOT_NOT_FOUND', 404, 'Bu sunucuda henüz bir pilotun yok.');
    return p;
  }

  private async pilotById(c: Queryable, playerId: string, lock = false): Promise<PilotWorldRow> {
    const r = await c.query<PilotWorldRow>(`${WorldService.PILOT_SELECT} WHERE p.id = $1 ${lock ? 'FOR UPDATE OF p' : ''}`, [playerId]);
    const p = r.rows[0];
    if (!p) throw err('PILOT_NOT_FOUND', 404, 'Pilot bulunamadı.');
    return p;
  }

  private async mapById(c: Queryable, id: number): Promise<MapRow> {
    return (await c.query<MapRow>(`${MAP_SELECT} WHERE m.id = $1`, [id])).rows[0]!;
  }

  private async rules(c: Queryable): Promise<{ movement: MovementRules; jumpRadius: number }> {
    // Sıralı: c bir işlem (transaction) istemcisi olabilir; tek istemcide eşzamanlı sorgu gönderilmez.
    const m = await getSetting<Partial<MovementRules>>(c, 'movement');
    const p = await getSetting<{ jump_radius: number }>(c, 'portal');
    return { movement: { ...DEFAULT_MOVEMENT_RULES, ...m }, jumpRadius: p?.jump_radius ?? 450 };
  }

  private entry(p: PilotWorldRow, m: MapRow, portalRules?: { min_level?: number }) {
    return canEnterMap({
      playerLevel: levelForXp(Number(p.experience)),
      playerCompanyCode: p.company_code,
      map: { minLevel: m.min_level, companyCode: m.company_code, isClosed: m.is_closed, entryRules: m.entry_rules },
      ...(portalRules ? { portalRules } : {}),
    });
  }

  // ================================================================== galaksi haritası
  async galaxy(owner: Owner, serverCodeRaw: string): Promise<GalaxyResponse> {
    const p = await this.pilot(this.db, owner, serverCodeRaw.toUpperCase());
    const [maps, links] = await Promise.all([
      this.db.query<MapRow>(`${MAP_SELECT} WHERE NOT m.is_archived ORDER BY m.id`),
      this.db.query<{ a: string; b: string }>(
        `SELECT DISTINCT LEAST(ma.code, mb.code) AS a, GREATEST(ma.code, mb.code) AS b
         FROM map_portals mp JOIN maps ma ON ma.id = mp.map_id JOIN maps mb ON mb.id = mp.target_map_id
         WHERE mp.is_enabled ORDER BY 1, 2`,
      ),
    ]);
    const current = maps.rows.find((m) => m.id === p.map_id);
    return {
      currentMap: current?.code ?? '',
      maps: maps.rows.map((m) => ({
        code: m.code,
        name: m.name,
        mapType: m.map_type,
        company: m.company_code ? { code: m.company_code, colorHex: m.company_color! } : null,
        minLevel: m.min_level,
        pvpEnabled: m.pvp_enabled,
        galaxyX: m.galaxy_x,
        galaxyY: m.galaxy_y,
        isClosed: m.is_closed,
        access: this.entry(p, m),
      })),
      links: links.rows.map((l) => [l.a, l.b] as [string, string]),
    };
  }

  // ================================================================== bulunulan harita
  async currentMap(owner: Owner, serverCodeRaw: string): Promise<MapResponse> {
    const serverCode = serverCodeRaw.toUpperCase();
    const { pilot, notice } = await withTransaction(this.db, async (c) => this.relocateIfClosed(c, await this.pilot(c, owner, serverCode, true)));
    return this.buildMap(pilot, notice);
  }

  /**
   * Oyun sunucusu: pilotu dünyaya sokar. Bulunduğu harita bakıma alınmışsa şirketinin başlangıç
   * haritasına taşınır (madde 15.6) ve bildirim döner.
   */
  async enterWorld(playerId: string): Promise<{ map: MapResponse; relocated: boolean }> {
    const { pilot, notice } = await withTransaction(this.db, async (c) => this.relocateIfClosed(c, await this.pilotById(c, playerId, true)));
    return { map: await this.buildMap(pilot, notice), relocated: notice !== null };
  }

  private async relocateIfClosed(c: Queryable, p: PilotWorldRow): Promise<{ pilot: PilotWorldRow; notice: string | null }> {
    const m = await this.mapById(c, p.map_id);
    if (!m.is_closed || m.id === p.home_map_id) return { pilot: p, notice: null };
    const home = await this.mapById(c, p.home_map_id);
    await c.query('UPDATE players SET map_id = $2, pos_x = $3, pos_y = $4, pos_updated_at = now() WHERE id = $1', [
      p.id,
      home.id,
      home.spawn_x,
      home.spawn_y,
    ]);
    await c.query(`INSERT INTO map_transitions (player_id, from_map_id, to_map_id, reason) VALUES ($1, $2, $3, 'map_closed')`, [
      p.id,
      m.id,
      home.id,
    ]);
    return {
      pilot: { ...p, map_id: home.id, pos_x: home.spawn_x, pos_y: home.spawn_y },
      notice: `${m.code} ${m.name} bakım nedeniyle kapatıldı. ${home.code} ${home.name} bölgesine taşındın.`,
    };
  }

  /** Oyun sunucusu: açık haritalar listesi (bakım denetimi için). */
  async closedMapIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) return new Set();
    const r = await this.db.query<{ id: number }>('SELECT id FROM maps WHERE id = ANY($1::int[]) AND is_closed', [ids]);
    return new Set(r.rows.map((x) => x.id));
  }

  private async buildMap(p: PilotWorldRow, notice: string | null): Promise<MapResponse> {
    const [m, portals, zones, ship, rules] = await Promise.all([
      this.mapById(this.db, p.map_id),
      this.db.query<{ id: number; x: number; y: number; requirements: { min_level?: number }; target_id: number }>(
        `SELECT mp.id, mp.x, mp.y, mp.requirements, mp.target_map_id AS target_id FROM map_portals mp
         WHERE mp.map_id = $1 AND mp.is_enabled ORDER BY mp.id`,
        [p.map_id],
      ),
      this.db.query<{ id: number; zone_type: MapResponse['zones'][number]['zoneType']; name: string; shape: { x: number; y: number; r: number }; properties: Record<string, unknown> }>(
        'SELECT id, zone_type, name, shape, properties FROM map_zones WHERE map_id = $1 ORDER BY id',
        [p.map_id],
      ),
      activeShipStats(this.db, p.id),
      this.rules(this.db),
    ]);
    const targets = new Map<number, MapRow>();
    for (const t of portals.rows) if (!targets.has(t.target_id)) targets.set(t.target_id, await this.mapById(this.db, t.target_id));
    return {
      serverCode: p.server_code,
      pilot: {
        pilotName: p.pilot_name,
        level: levelForXp(Number(p.experience)),
        company: { code: p.company_code, name: p.company_name, colorHex: p.company_color },
        ship: ship
          ? {
              name: ship.name,
              spriteKey: ship.spriteKey,
              hitpoints: ship.hitpoints,
              maxHitpoints: ship.maxHitpoints,
              shield: ship.stats.shield,
              speed: ship.stats.speed,
            }
          : { name: '—', spriteKey: 'ship-kirlangic', hitpoints: 0, maxHitpoints: 1, shield: 0, speed: 0 },
      },
      map: {
        code: m.code,
        name: m.name,
        mapType: m.map_type,
        width: m.width,
        height: m.height,
        backgroundKey: m.background_key,
        pvpEnabled: m.pvp_enabled,
        company: m.company_code ? { code: m.company_code, colorHex: m.company_color! } : null,
      },
      position: { x: Math.round(p.pos_x), y: Math.round(p.pos_y) },
      portals: portals.rows.map((t) => {
        const tm = targets.get(t.target_id)!;
        return {
          id: t.id,
          x: t.x,
          y: t.y,
          target: { code: tm.code, name: tm.name, mapType: tm.map_type },
          access: this.entry(p, tm, t.requirements),
        };
      }),
      zones: zones.rows.map((z) => ({
        id: z.id,
        zoneType: z.zone_type,
        name: z.name,
        x: z.shape.x,
        y: z.shape.y,
        r: z.shape.r,
        properties: z.properties,
      })),
      rules: {
        jumpRadius: rules.jumpRadius,
        movement: rules.movement,
        detection: { radar: DETECTION.baseRadar + (ship?.stats.radarBonus ?? 0), cargo: DETECTION.cargo },
      },
      notice,
    };
  }

  // ================================================================== portal geçişi (oyun sunucusu)
  /**
   * Aşama 8: konum oyun sunucusunun bellekteki otoriter konumudur (istemciden gelmez).
   * Sırasıyla: geçit bu haritada ve açık mı → atlama yarıçapında mı → hedef haritaya giriş koşulları.
   */
  async jumpForGame(playerId: string, portalId: number, pos: { x: number; y: number }): Promise<MapResponse> {
    const pilot = await withTransaction(this.db, async (c) => {
      const p = await this.pilotById(c, playerId, true);
      const portal = (
        await c.query<{ id: number; x: number; y: number; target_map_id: number; target_x: number; target_y: number; requirements: { min_level?: number } }>(
          'SELECT id, x, y, target_map_id, target_x, target_y, requirements FROM map_portals WHERE id = $1 AND map_id = $2 AND is_enabled',
          [portalId, p.map_id],
        )
      ).rows[0];
      if (!portal) throw err('PORTAL_NOT_FOUND', 404, 'Bu haritada böyle bir geçit yok.');
      const { jumpRadius } = await this.rules(c);
      if (Math.hypot(pos.x - portal.x, pos.y - portal.y) > jumpRadius) {
        throw err('TOO_FAR_FROM_PORTAL', 400, 'Geçide atlamak için daha yakına gelmelisin.');
      }
      const target = await this.mapById(c, portal.target_map_id);
      const access = this.entry(p, target, portal.requirements);
      if (!access.ok) throw err(access.code, 403, access.reason);
      await c.query('UPDATE players SET map_id = $2, pos_x = $3, pos_y = $4, pos_updated_at = now() WHERE id = $1', [
        p.id,
        target.id,
        portal.target_x,
        portal.target_y,
      ]);
      await c.query('INSERT INTO map_transitions (player_id, from_map_id, to_map_id, portal_id) VALUES ($1, $2, $3, $4)', [
        p.id,
        p.map_id,
        target.id,
        portal.id,
      ]);
      this.log.info({ playerId: p.id, from: p.map_id, to: target.code }, 'harita geçişi');
      return { ...p, map_id: target.id, pos_x: portal.target_x, pos_y: portal.target_y };
    });
    return this.buildMap(pilot, null);
  }

  // ================================================================== oyuncu ayarları
  async getSettings(owner: Owner, deviceClassRaw: string | undefined): Promise<{ deviceClass: DeviceClass; settings: PlayerSettings; saved: boolean }> {
    const deviceClass = (DEVICE_CLASSES as readonly string[]).includes(deviceClassRaw ?? '') ? (deviceClassRaw as DeviceClass) : 'desktop';
    const r = await this.db.query<{ settings: unknown }>('SELECT settings FROM player_settings WHERE user_id = $1 AND device_class = $2', [
      owner.id,
      deviceClass,
    ]);
    const defaults = defaultSettings(deviceClass);
    const stored = r.rows[0]?.settings;
    if (!stored) return { deviceClass, settings: defaults, saved: false };
    // Eski/eksik kayıtlar varsayılanlarla tamamlanır; şemaya uymayan kayıt yok sayılır.
    const merged = deepMerge(defaults, stored as Record<string, unknown>);
    const parsed = settingsSchema.safeParse(merged);
    return { deviceClass, settings: parsed.success ? parsed.data : defaults, saved: parsed.success };
  }

  async saveSettings(owner: Owner, input: unknown) {
    const d = updateSettingsSchema.parse(input);
    await this.db.query(
      `INSERT INTO player_settings (user_id, device_class, settings) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, device_class) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
      [owner.id, d.deviceClass, JSON.stringify(d.settings)],
    );
    return { deviceClass: d.deviceClass, settings: d.settings, saved: true };
  }
}

function deepMerge<T extends Record<string, unknown>>(base: T, over: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' ? deepMerge(b as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out as T;
}
