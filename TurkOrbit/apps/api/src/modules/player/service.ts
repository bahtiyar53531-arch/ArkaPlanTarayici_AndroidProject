import {
  changeCompanySchema,
  createPilotSchema,
  levelForXp,
  levelProgress,
  rankFor,
  rankPoints,
  updatePilotSchema,
  type CompanyInfo,
  type GameServerInfo,
  type LedgerEntry,
  type PilotProfile,
  type PublicPilotProfile,
} from '@turkorbit/shared';
import { uniqueViolation, withTransaction, type Db, type Queryable } from '../../db/pool.js';
import { AppError, Errors } from '../../lib/errors.js';
import type { Logger } from '../auth/service.js';
import { getSetting } from '../auth/repository.js';
import { applyCurrencyChange, getBalances, listLedger } from '../economy/wallet.js';
import { ensureStarterKit } from '../hangar/starter-kit.js';
import { syncAchievements } from './achievements.js';
import * as repo from './repository.js';

export interface PilotOwner {
  id: string;
  username: string;
}

interface CompanyChangeSetting {
  cooldown_days: number;
  cost: { currency: string; amount: number };
}

const DEFAULT_COMPANY_CHANGE: CompanyChangeSetting = { cooldown_days: 30, cost: { currency: 'AKCE', amount: 2000 } };

export class PlayerService {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  // ================================================================== Sunucu ve şirket listeleri
  async listServers(userId: string | null): Promise<GameServerInfo[]> {
    const rows = await repo.listServers(this.db, userId);
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      region: r.region,
      isOpen: r.is_open,
      isMaintenance: r.is_maintenance,
      pilotCount: Number(r.pilot_count),
      hasMyPilot: r.has_my_pilot,
    }));
  }

  async listCompanies(serverCode: string | undefined): Promise<CompanyInfo[]> {
    const server = serverCode ? await repo.findServer(this.db, serverCode.toUpperCase()) : null;
    if (serverCode && !server) throw Errors.notFound('Sunucu');
    const rows = await repo.listCompanies(this.db, server?.id ?? null);
    return rows.map((c) => ({
      code: c.code,
      name: c.name,
      motto: c.motto,
      description: c.description,
      focus: c.focus,
      colorHex: c.color_hex,
      homeMap: { code: c.home_map_code, name: c.home_map_name },
      pilotCount: Number(c.pilot_count),
    }));
  }

  // ================================================================== Pilot oluşturma
  async createPilot(owner: PilotOwner, input: unknown): Promise<PilotProfile> {
    const data = createPilotSchema.parse(input);
    const server = await repo.findServer(this.db, data.serverCode);
    if (!server) throw Errors.notFound('Sunucu');
    if (!server.is_open || server.is_maintenance) {
      throw new AppError('SERVER_CLOSED', 403, `${server.name} sunucusu şu anda yeni pilot kabul etmiyor.`);
    }
    const company = await repo.findCompany(this.db, data.companyCode);
    if (!company) throw Errors.notFound('Şirket');
    const ship = await repo.findStarterShip(this.db);
    if (!ship) throw new Error('Başlangıç gemisi tanımlı değil (ship_types.is_starter)');

    // Yönetim Merkezi'nden değiştirilebilen başlangıç değerleri (game_settings.starter.currencies)
    const starter = (await getSetting<Record<string, number>>(this.db, 'starter.currencies')) ?? {};

    let playerId: string;
    try {
      playerId = await withTransaction(this.db, async (c) => {
        const ins = await c.query<{ id: string }>(
          `INSERT INTO players (user_id, server_id, pilot_name, company_id, map_id, pos_x, pos_y)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [owner.id, server.id, owner.username, company.id, company.home_map_id, company.spawn_x, company.spawn_y],
        );
        const id = ins.rows[0]!.id;
        await c.query('INSERT INTO player_stats (player_id) VALUES ($1)', [id]);
        const shipRow = await c.query<{ id: string }>(
          `INSERT INTO player_ships (player_id, ship_type_id, hitpoints, source) VALUES ($1, $2, $3, 'starter') RETURNING id`,
          [id, ship.id, ship.hitpoints],
        );
        await c.query('UPDATE players SET active_ship_id = $2 WHERE id = $1', [id, shipRow.rows[0]!.id]);
        await c.query(
          `INSERT INTO wallets (player_id, currency_code) SELECT $1, code FROM currencies ON CONFLICT DO NOTHING`,
          [id],
        );
        for (const [currency, amount] of Object.entries(starter).sort()) {
          if (!Number.isSafeInteger(amount) || amount <= 0) continue;
          await applyCurrencyChange(c, {
            playerId: id,
            currency,
            delta: amount,
            reason: 'starter_grant',
            refType: 'player',
            refId: id,
            idempotencyKey: `starter:${id}:${currency}`,
          });
        }
        await c.query(
          `INSERT INTO player_achievements (player_id, achievement_id)
           SELECT $1, id FROM achievements WHERE code = 'pilot_created' ON CONFLICT DO NOTHING`,
          [id],
        );
        await ensureStarterKit(c, id);
        return id;
      });
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint === 'players_user_id_server_id_key' || constraint === 'players_server_id_pilot_name_key') {
        throw new AppError('PILOT_EXISTS', 409, `${server.name} sunucusunda zaten bir pilotun var.`);
      }
      throw err;
    }
    this.log.info({ playerId, server: server.code, company: company.code }, 'pilot oluşturuldu');
    return this.profileById(playerId);
  }

  // ================================================================== Profil okuma
  async myPilots(owner: PilotOwner): Promise<PilotProfile[]> {
    const rows = await repo.findPilotsByUser(this.db, owner.id);
    return Promise.all(rows.map((r) => this.buildProfile(r)));
  }

  private async myPilotRow(owner: PilotOwner, serverCode: string, db: Queryable = this.db) {
    const row = await repo.findPilotByUserAndServer(db, owner.id, serverCode);
    if (!row) throw new AppError('PILOT_NOT_FOUND', 404, 'Bu sunucuda henüz bir pilotun yok.');
    return row;
  }

  private async profileById(playerId: string): Promise<PilotProfile> {
    const row = await repo.findPilotById(this.db, playerId);
    if (!row) throw new AppError('PILOT_NOT_FOUND', 404, 'Pilot bulunamadı.');
    return this.buildProfile(row);
  }

  private async buildProfile(r: repo.PilotRow): Promise<PilotProfile> {
    const experience = Number(r.experience);
    const honor = Number(r.honor);
    const stats = {
      npcKills: Number(r.npc_kills),
      playerKills: Number(r.player_kills),
      deaths: Number(r.deaths),
      gatesCompleted: Number(r.gates_completed),
      cargoCollected: Number(r.cargo_collected),
      damageDealt: Number(r.damage_dealt),
      damageTaken: Number(r.damage_taken),
    };
    const playtimeSeconds = Number(r.playtime_seconds);
    const [ranks, currencies, achievements, ccSetting] = await Promise.all([
      repo.listRanks(this.db),
      getBalances(this.db, r.id),
      this.syncAchievements(r.id, { level: levelForXp(experience), playtimeSeconds, ...stats }),
      getSetting<CompanyChangeSetting>(this.db, 'company.change'),
    ]);
    const points = rankPoints({ experience, honor, ...stats });
    const rank = rankFor(points, ranks);
    const cc = { ...DEFAULT_COMPANY_CHANGE, ...ccSetting };
    const lastChange = r.company_changed_at ?? r.created_at;
    const availableAt = new Date(lastChange.getTime() + cc.cooldown_days * 86_400_000);

    return {
      id: r.id,
      playerId: Number(r.public_id),
      pilotName: r.pilot_name,
      server: { code: r.server_code, name: r.server_name },
      company: { code: r.company_code, name: r.company_name, colorHex: r.company_color },
      level: levelProgress(experience),
      honor,
      rank: {
        id: rank.current.id,
        name: rank.current.name,
        points,
        minPoints: rank.current.minPoints,
        next: rank.next ? { name: rank.next.name, minPoints: rank.next.minPoints } : null,
      },
      currencies,
      activeShip: r.ship_code
        ? {
            code: r.ship_code,
            name: r.ship_name!,
            shipClass: r.ship_class!,
            spriteKey: r.ship_sprite!,
            hitpoints: Math.min(r.ship_hp!, r.ship_max_hp!),
            maxHitpoints: r.ship_max_hp!,
            speed: r.ship_speed!,
            cargoCapacity: r.ship_cargo!,
            slots: { laser: r.slots_laser!, generator: r.slots_generator!, extra: r.slots_extra!, drone: r.slots_drone! },
          }
        : null,
      map: {
        code: r.map_code,
        name: r.map_name,
        mapType: r.map_type,
        pvpEnabled: r.pvp_enabled,
        x: Math.round(r.pos_x),
        y: Math.round(r.pos_y),
      },
      playtimeSeconds,
      stats,
      achievements,
      motto: r.motto,
      companyChange: {
        availableAt: availableAt.getTime() > Date.now() ? availableAt.toISOString() : null,
        cost: cc.cost,
        cooldownDays: cc.cooldown_days,
      },
      clan: null,
      createdAt: r.created_at.toISOString(),
      lastOnlineAt: r.last_online_at?.toISOString() ?? null,
    };
  }

  /** Başarımlar (ortak değerlendirme: achievements.ts; oyun olayları da aynı fonksiyonu çağırır). */
  private async syncAchievements(playerId: string, values: Record<string, number>): Promise<PilotProfile['achievements']> {
    const r = await syncAchievements(this.db, playerId, values);
    return { earned: r.earned, total: r.total, items: r.items };
  }

  // ================================================================== Profil güncelleme
  async updatePilot(owner: PilotOwner, input: unknown): Promise<PilotProfile> {
    const data = updatePilotSchema.parse(input);
    const row = await this.myPilotRow(owner, data.serverCode);
    await this.db.query('UPDATE players SET motto = $2 WHERE id = $1', [row.id, data.motto]);
    return this.profileById(row.id);
  }

  /** Şirket değişimi: bekleme süresi + ücret (defterli) + yeni şirketin başlangıç haritasına taşınma. */
  async changeCompany(owner: PilotOwner, input: unknown): Promise<PilotProfile> {
    const data = changeCompanySchema.parse(input);
    const target = await repo.findCompany(this.db, data.companyCode);
    if (!target) throw Errors.notFound('Şirket');
    const setting = { ...DEFAULT_COMPANY_CHANGE, ...(await getSetting<CompanyChangeSetting>(this.db, 'company.change')) };

    const playerId = await withTransaction(this.db, async (c) => {
      const pilot = await this.myPilotRow(owner, data.serverCode, c);
      // Pilot satırını kilitle: eşzamanlı iki istek sırayla işlenir, ikincisi değişikliği görür.
      const locked = await c.query<{ company_id: number; company_changed_at: Date | null; created_at: Date }>(
        'SELECT company_id, company_changed_at, created_at FROM players WHERE id = $1 FOR UPDATE',
        [pilot.id],
      );
      const p = locked.rows[0]!;
      if (p.company_id === target.id) {
        throw new AppError('SAME_COMPANY', 400, `Zaten ${target.name} üyesisin.`);
      }
      const last = p.company_changed_at ?? p.created_at;
      const availableAt = new Date(last.getTime() + setting.cooldown_days * 86_400_000);
      if (availableAt.getTime() > Date.now()) {
        const when = availableAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
        throw new AppError(
          'COMPANY_CHANGE_COOLDOWN',
          409,
          `Şirketini ${setting.cooldown_days} günde en fazla bir kez değiştirebilirsin. Bir sonraki değişiklik: ${when} (TSİ).`,
        );
      }
      if (setting.cost.amount > 0) {
        await applyCurrencyChange(c, {
          playerId: pilot.id,
          currency: setting.cost.currency,
          delta: -setting.cost.amount,
          reason: 'company_change',
          refType: 'company',
          refId: target.code,
          idempotencyKey: `company_change:${pilot.id}:${last.getTime()}`,
        });
      }
      await c.query(
        `UPDATE players SET company_id = $2, company_changed_at = now(), map_id = $3, pos_x = $4, pos_y = $5,
           pos_updated_at = now() WHERE id = $1`,
        [pilot.id, target.id, target.home_map_id, target.spawn_x, target.spawn_y],
      );
      return pilot.id;
    });
    this.log.info({ playerId, company: target.code }, 'şirket değiştirildi');
    return this.profileById(playerId);
  }

  async ledger(owner: PilotOwner, serverCode: string): Promise<LedgerEntry[]> {
    const row = await this.myPilotRow(owner, serverCode.toUpperCase());
    return listLedger(this.db, row.id, 50);
  }

  // ================================================================== Herkese açık profil
  async publicProfile(serverCode: string, pilotName: string): Promise<PublicPilotProfile> {
    if (!/^[A-Za-z0-9-]{1,16}$/.test(serverCode) || !/^[A-Za-z0-9_]{1,20}$/.test(pilotName)) {
      throw new AppError('PILOT_NOT_FOUND', 404, 'Pilot bulunamadı.');
    }
    const row = await repo.findPublicPilot(this.db, serverCode.toUpperCase(), pilotName);
    if (!row) throw new AppError('PILOT_NOT_FOUND', 404, 'Pilot bulunamadı.');
    const full = await this.buildProfile(row);
    return {
      playerId: full.playerId,
      pilotName: full.pilotName,
      server: full.server,
      company: full.company,
      level: full.level.level,
      honor: full.honor,
      rank: { id: full.rank.id, name: full.rank.name },
      motto: full.motto,
      stats: {
        npcKills: full.stats.npcKills,
        playerKills: full.stats.playerKills,
        gatesCompleted: full.stats.gatesCompleted,
      },
      achievements: {
        earned: full.achievements.earned,
        total: full.achievements.total,
        items: full.achievements.items
          .filter((a) => a.completedAt)
          .map((a) => ({ code: a.code, name: a.name, completedAt: a.completedAt })),
      },
      activeShip: full.activeShip ? { name: full.activeShip.name, spriteKey: full.activeShip.spriteKey } : null,
      createdAt: full.createdAt,
    };
  }
}
