/**
 * Görev servisi (Aşama 10).
 *
 *  - Liste: ana/zincir görevler (önceki görevin ödülü alınınca açılır), günlük ve haftalık görevler (05:00 TSİ'de
 *    pilota özel, tohumlu seçimle atanır), etkinlik görevleri (tarih penceresinde).
 *  - Kabul / bırakma (ana ve etkinlik), yeniden çekme (günlük ve haftalık, döngü başına sınırlı hak).
 *  - İlerleme: YALNIZCA sunucu olaylarıyla (oyun sunucusu ve hangar). İstemcinin ilerleme yazabileceği bir uç yoktur.
 *  - Ödül: tamamlanan görev için "Ödülü al" — transaction içinde, idempotent anahtarla (çift ödül olmaz).
 */
import {
  advance,
  objectiveMatches,
  pickSeeded,
  questActionSchema,
  questClaimSchema,
  questCycles,
  resolveCompanyText,
  resolveParams,
  levelForXp,
  type ObjectiveParams,
  type ObjectiveType,
  type QuestCategory,
  type QuestClaimResponse,
  type QuestEvent,
  type QuestProgressUpdate,
  type QuestsResponse,
  type QuestStatus,
  type QuestView,
  type RolledReward,
} from '@turkorbit/shared';
import { withTransaction, type Db, type Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { getSetting } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import { grantRewards, type GrantResult } from '../economy/rewards.js';
import type { GameBridge } from '../game/bridge.js';
import { syncAchievements } from '../player/achievements.js';

export interface QuestSettings {
  daily_count: number;
  weekly_count: number;
  daily_rerolls: number;
  weekly_rerolls: number;
  reset_hour_tr: number;
  max_active: number;
  kill_credit_min_share: number;
}
export const DEFAULT_QUEST_SETTINGS: QuestSettings = {
  daily_count: 3,
  weekly_count: 3,
  daily_rerolls: 1,
  weekly_rerolls: 1,
  reset_hour_tr: 5,
  max_active: 10,
  kill_credit_min_share: 0.2,
};

interface ObjDef {
  id: number;
  type: ObjectiveType;
  params: ObjectiveParams;
  target: number;
  label: string;
}
interface RewardDef {
  type: RolledReward['type'];
  code: string;
  amount: number;
}
export interface QuestDef {
  id: number;
  code: string;
  category: QuestCategory;
  title: string;
  description: string;
  minLevel: number;
  maxLevel: number | null;
  prereqId: number | null;
  chainCode: string | null;
  chainOrder: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
  objectives: ObjDef[];
  rewards: RewardDef[];
}
interface Row {
  id: string;
  quest_id: number;
  cycle_key: string;
  status: 'active' | 'completed' | 'claimed' | 'rerolled' | 'abandoned';
  progress: Record<string, number>;
  completed_at: Date | null;
  claimed_at: Date | null;
}
interface Pilot {
  id: string;
  level: number;
  prefix: string;
}

const err = (code: ConstructorParameters<typeof AppError>[0], status: number, message: string) => new AppError(code, status, message);
const CURRENCY_NAMES: Record<string, string> = { KREDI: 'Kredi', AKCE: 'Akçe', XP: 'Deneyim', HONOR: 'Şeref' };
/** Etkinlikler başlamadan bu kadar önce "yakında" olarak listelenir */
const UPCOMING_MS = 14 * 86_400_000;

/**
 * Görev içeriği önbelleği. Aşama 14: Yönetim Merkezi görev oluşturup yayımlayabildiği için önbellek en fazla 2 sn'de bir,
 * arka planda (isteği bekletmeden) veritabanındaki ucuz bir sürüm anahtarına (görev sayısı + son görev yayını zamanı) bakar;
 * değiştiyse sonraki çağrıda yeniden yükler. Yayını yapan API süreci önbelleği anında geçersiz kılar; diğer API/oyun
 * sunucusu süreçleri değişikliği birkaç saniye içinde görür.
 */
class QuestCatalog {
  byId = new Map<number, QuestDef>();
  byCode = new Map<string, QuestDef>();
  chainTotals = new Map<string, number>();
  items = new Map<string, { id: number; name: string; stackable: boolean }>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private version = '';
  private checkedAt = 0;
  private checking: Promise<void> | null = null;

  private async readVersion(db: Queryable): Promise<string> {
    const r = await db.query<{ v: string }>(
      `SELECT (SELECT count(*) FROM quests)::text || ':' ||
              COALESCE((SELECT (extract(epoch FROM max(published_at)) * 1000)::bigint::text FROM content_revisions WHERE entity_type = 'quest'), '0') AS v`,
    );
    return r.rows[0]!.v;
  }

  async ensure(db: Queryable, maxAgeMs = 60_000) {
    const fresh = Date.now() - this.loadedAt < maxAgeMs && this.byId.size > 0;
    if (fresh) {
      // Sürüm denetimi isteği BEKLETMEZ (çağıran bir transaction içinde olabilir; havuzdan ikinci bağlantı beklemesin).
      // Değişiklik görülürse bir sonraki çağrı yeniden yükler.
      if (Date.now() - this.checkedAt >= 2000 && !this.checking) {
        this.checkedAt = Date.now();
        this.checking = this.readVersion(db)
          .then((v) => {
            if (v !== this.version) this.loadedAt = 0;
          })
          .catch(() => undefined)
          .finally(() => (this.checking = null));
      }
      return;
    }
    this.loading ??= (async () => {
      const v = await this.readVersion(db);
      await this.load(db);
      this.version = v;
      this.checkedAt = Date.now();
    })().finally(() => (this.loading = null));
    await this.loading;
  }

  invalidate() {
    this.loadedAt = 0;
  }

  private async load(db: Queryable) {
    const [q, o, r, it] = await Promise.all([
      db.query<{
        id: number; code: string; category: QuestCategory; title: string; description: string; min_level: number; max_level: number | null;
        prerequisite_quest_id: number | null; chain_code: string | null; chain_order: number | null; starts_at: Date | null; ends_at: Date | null;
        sort_order: number; reward_table_id: number;
      }>('SELECT * FROM quests WHERE is_published ORDER BY sort_order, id'),
      db.query<{ id: number; quest_id: number; objective_type: ObjectiveType; params: ObjectiveParams; target: string; label: string }>(
        'SELECT id, quest_id, objective_type, params, target, label FROM quest_objectives ORDER BY quest_id, sort_order',
      ),
      db.query<{ reward_table_id: number; reward_type: RolledReward['type']; ref_code: string; min_amount: string }>(
        `SELECT e.reward_table_id, e.reward_type, e.ref_code, e.min_amount FROM reward_entries e
         JOIN quests q ON q.reward_table_id = e.reward_table_id ORDER BY e.id`,
      ),
      db.query<{ id: number; code: string; name: string; stackable: boolean }>('SELECT id, code, name, stackable FROM item_types'),
    ]);
    const objs = new Map<number, ObjDef[]>();
    for (const x of o.rows) {
      const list = objs.get(x.quest_id) ?? [];
      list.push({ id: x.id, type: x.objective_type, params: x.params ?? {}, target: Number(x.target), label: x.label });
      objs.set(x.quest_id, list);
    }
    const rewards = new Map<number, RewardDef[]>();
    for (const x of r.rows) {
      const list = rewards.get(x.reward_table_id) ?? [];
      // Görev ödülleri sabittir (min = max, şans = 1)
      list.push({ type: x.reward_type, code: x.ref_code, amount: Number(x.min_amount) });
      rewards.set(x.reward_table_id, list);
    }
    this.byId.clear();
    this.byCode.clear();
    this.chainTotals.clear();
    for (const x of q.rows) {
      const def: QuestDef = {
        id: x.id, code: x.code, category: x.category, title: x.title, description: x.description, minLevel: x.min_level, maxLevel: x.max_level,
        prereqId: x.prerequisite_quest_id, chainCode: x.chain_code, chainOrder: x.chain_order, startsAt: x.starts_at, endsAt: x.ends_at,
        sortOrder: x.sort_order, objectives: objs.get(x.id) ?? [], rewards: rewards.get(x.reward_table_id) ?? [],
      };
      this.byId.set(def.id, def);
      this.byCode.set(def.code, def);
      if (def.chainCode) this.chainTotals.set(def.chainCode, (this.chainTotals.get(def.chainCode) ?? 0) + 1);
    }
    this.items.clear();
    for (const x of it.rows) this.items.set(x.code, { id: x.id, name: x.name, stackable: x.stackable });
    this.loadedAt = Date.now();
  }
}

export interface QuestInterest {
  type: ObjectiveType;
  params: ObjectiveParams;
}

export class QuestService {
  readonly catalog = new QuestCatalog();
  private readonly clock: () => Date;

  private readonly bridge: GameBridge | null;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    opts: { clock?: () => Date; bridge?: GameBridge | null } = {},
  ) {
    this.clock = opts.clock ?? (() => new Date());
    this.bridge = opts.bridge ?? null;
  }

  async settings(db: Queryable = this.db): Promise<QuestSettings> {
    return { ...DEFAULT_QUEST_SETTINGS, ...((await getSetting<Partial<QuestSettings>>(db, 'quests')) ?? {}) };
  }

  // ================================================================== yardımcılar
  private async pilotByOwner(c: Queryable, ownerId: string, serverCode: string, lock: boolean): Promise<Pilot> {
    const r = await c.query<{ id: string; experience: string; prefix: string }>(
      `SELECT p.id, p.experience, left(m.code, 1) AS prefix
       FROM players p JOIN game_servers s ON s.id = p.server_id
       JOIN maps m ON m.company_id = p.company_id AND m.map_type = 'starter'
       WHERE p.user_id = $1 AND s.code = $2 ${lock ? 'FOR UPDATE OF p' : ''}`,
      [ownerId, serverCode],
    );
    const p = r.rows[0];
    if (!p) throw err('PILOT_NOT_FOUND', 404, 'Bu sunucuda henüz bir pilotun yok.');
    return { id: p.id, level: levelForXp(Number(p.experience)), prefix: p.prefix };
  }

  private async pilotById(c: Queryable, playerId: string, lock: boolean): Promise<Pilot | null> {
    const r = await c.query<{ id: string; experience: string; prefix: string }>(
      `SELECT p.id, p.experience, left(m.code, 1) AS prefix
       FROM players p JOIN maps m ON m.company_id = p.company_id AND m.map_type = 'starter'
       WHERE p.id = $1 ${lock ? 'FOR UPDATE OF p' : ''}`,
      [playerId],
    );
    const p = r.rows[0];
    return p ? { id: p.id, level: levelForXp(Number(p.experience)), prefix: p.prefix } : null;
  }

  private inWindow(q: QuestDef, now: Date) {
    return (!q.startsAt || q.startsAt <= now) && (!q.endsAt || q.endsAt > now);
  }

  private resetHour(s: QuestSettings) {
    return s.reset_hour_tr;
  }

  /** Günlük/haftalık görevleri bu döngü için atar (döngü başına bir kez; eşzamanlı çağrılar güvenli). */
  private async ensureCycles(c: Queryable, pilot: Pilot, s: QuestSettings, now: Date) {
    const cyc = questCycles(now, this.resetHour(s));
    for (const [category, key, count] of [
      ['daily', cyc.daily, s.daily_count],
      ['weekly', cyc.weekly, s.weekly_count],
    ] as const) {
      const ins = await c.query(
        `INSERT INTO player_quest_cycles (player_id, category, cycle_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`,
        [pilot.id, category, key],
      );
      if (!ins.rowCount) continue;
      const pool = this.pool(category, pilot.level);
      const picked = pickSeeded(pool, count, `${pilot.id}:${category}:${key}`);
      for (const q of picked) await this.insertActive(c, pilot, q, key, now);
    }
  }

  private pool(category: 'daily' | 'weekly', level: number) {
    return [...this.catalog.byId.values()]
      .filter((q) => q.category === category && q.minLevel <= level && (q.maxLevel === null || level <= q.maxLevel))
      .sort((a, b) => (a.code < b.code ? -1 : 1));
  }

  /** Görevi etkin olarak ekler; seviye hedefleri hemen değerlendirilir. */
  private async insertActive(c: Queryable, pilot: Pilot, q: QuestDef, cycle: string, now: Date, reuse = false) {
    const progress: Record<string, number> = {};
    for (const o of q.objectives) if (o.type === 'reach_level') progress[o.id] = Math.min(o.target, pilot.level);
    const done = q.objectives.length > 0 && q.objectives.every((o) => (progress[o.id] ?? 0) >= o.target);
    const status = done ? 'completed' : 'active';
    if (reuse) {
      await c.query(
        `UPDATE player_quests SET status = $4, progress = $5, accepted_at = $6, completed_at = $7, claimed_at = NULL
         WHERE player_id = $1 AND quest_id = $2 AND cycle_key = $3`,
        [pilot.id, q.id, cycle, status, JSON.stringify(progress), now, done ? now : null],
      );
    } else {
      await c.query(
        `INSERT INTO player_quests (player_id, quest_id, cycle_key, status, progress, accepted_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [pilot.id, q.id, cycle, status, JSON.stringify(progress), now, done ? now : null],
      );
    }
  }

  private async rows(c: Queryable, playerId: string, lock = false): Promise<Row[]> {
    const r = await c.query<Row>(
      `SELECT id, quest_id, cycle_key, status, progress, completed_at, claimed_at FROM player_quests WHERE player_id = $1
       ${lock ? 'FOR UPDATE' : ''}`,
      [playerId],
    );
    return r.rows;
  }

  /** Bu döngüde / pencerede ilerleyebilir mi? */
  private live(q: QuestDef, row: Row, cyc: { daily: string; weekly: string }, now: Date) {
    if (q.category === 'daily') return row.cycle_key === cyc.daily;
    if (q.category === 'weekly') return row.cycle_key === cyc.weekly;
    if (q.category === 'event') return this.inWindow(q, now);
    return true;
  }

  private view(q: QuestDef, pilot: Pilot, row: Row | null, status: QuestStatus, lockedReason: string | null = null): QuestView {
    return {
      code: q.code,
      category: q.category,
      title: resolveCompanyText(q.title, pilot.prefix),
      description: resolveCompanyText(q.description, pilot.prefix),
      status,
      cycle: row?.cycle_key ?? 'once',
      minLevel: q.minLevel,
      lockedReason,
      chain: q.chainCode && q.chainOrder ? { code: q.chainCode, order: q.chainOrder, total: this.catalog.chainTotals.get(q.chainCode) ?? 0 } : null,
      objectives: q.objectives.map((o) => ({
        id: o.id,
        type: o.type,
        label: resolveCompanyText(o.label, pilot.prefix),
        current: status === 'claimed' || status === 'completed' ? o.target : Math.min(o.target, row?.progress[o.id] ?? 0),
        target: o.target,
      })),
      rewards: q.rewards.map((r) => ({
        type: r.type,
        code: r.code,
        name: r.type === 'item' ? (this.catalog.items.get(r.code)?.name ?? r.code) : (CURRENCY_NAMES[r.code] ?? r.code),
        amount: r.amount,
      })),
      startsAt: q.startsAt?.toISOString() ?? null,
      endsAt: q.endsAt?.toISOString() ?? null,
      completedAt: row?.completed_at?.toISOString() ?? null,
      claimedAt: row?.claimed_at?.toISOString() ?? null,
    };
  }

  // ================================================================== liste
  async list(owner: { id: string }, serverCode: string): Promise<QuestsResponse> {
    await this.catalog.ensure(this.db);
    const now = this.clock();
    return withTransaction(this.db, async (c) => {
      const pilot = await this.pilotByOwner(c, owner.id, serverCode, false);
      const s = await this.settings(c);
      await this.ensureCycles(c, pilot, s, now);
      return this.build(c, pilot, s, now);
    });
  }

  private async build(c: Queryable, pilot: Pilot, s: QuestSettings, now: Date): Promise<QuestsResponse> {
    const cyc = questCycles(now, this.resetHour(s));
    const rows = await this.rows(c, pilot.id);
    const cycRows = await c.query<{ category: 'daily' | 'weekly'; rerolls_used: number }>(
      'SELECT category, rerolls_used FROM player_quest_cycles WHERE player_id = $1 AND ((category = $2 AND cycle_key = $3) OR (category = $4 AND cycle_key = $5))',
      [pilot.id, 'daily', cyc.daily, 'weekly', cyc.weekly],
    );
    const used = { daily: 0, weekly: 0 };
    for (const r of cycRows.rows) used[r.category] = r.rerolls_used;

    const once = new Map<number, Row>();
    for (const r of rows) if (r.cycle_key === 'once') once.set(r.quest_id, r);
    const out: QuestView[] = [];
    let activeCount = 0;

    for (const q of this.catalog.byId.values()) {
      if (q.category === 'daily' || q.category === 'weekly') continue;
      const row = once.get(q.id) ?? null;
      const st = row?.status;
      if (q.category === 'main') {
        if (st === 'active' || st === 'completed' || st === 'claimed') {
          if (st === 'active') activeCount++;
          out.push(this.view(q, pilot, row, st));
          continue;
        }
        // Zincirde yalnızca sıradaki görev görünür: önceki görevin ödülü alınmış olmalı
        if (q.prereqId && once.get(q.prereqId)?.status !== 'claimed') continue;
        if (pilot.level < q.minLevel) out.push(this.view(q, pilot, row, 'locked', `${q.minLevel}. seviyede açılır`));
        else out.push(this.view(q, pilot, row, 'available'));
      } else {
        // Etkinlik
        if (st === 'claimed') {
          if (q.endsAt && q.endsAt > now) out.push(this.view(q, pilot, row, 'claimed'));
          continue;
        }
        if (st === 'completed') {
          out.push(this.view(q, pilot, row, 'completed')); // etkinlik bitse de ödül alınabilir
          continue;
        }
        if (!this.inWindow(q, now)) {
          if (q.startsAt && q.startsAt > now && q.startsAt.getTime() - now.getTime() <= UPCOMING_MS) {
            out.push(this.view(q, pilot, null, 'locked', 'Etkinlik henüz başlamadı'));
          }
          continue;
        }
        if (st === 'active') {
          activeCount++;
          out.push(this.view(q, pilot, row, 'active'));
        } else if (pilot.level < q.minLevel) out.push(this.view(q, pilot, row, 'locked', `${q.minLevel}. seviyede açılır`));
        else out.push(this.view(q, pilot, row, 'available'));
      }
    }
    // Günlük ve haftalık: bu döngünün görevleri + eski döngüde tamamlanıp ödülü alınmamış olanlar
    for (const r of rows) {
      const q = this.catalog.byId.get(r.quest_id);
      if (!q || (q.category !== 'daily' && q.category !== 'weekly')) continue;
      const current = r.cycle_key === (q.category === 'daily' ? cyc.daily : cyc.weekly);
      if (r.status === 'rerolled' || r.status === 'abandoned') continue;
      if (current) out.push(this.view(q, pilot, r, r.status as 'active' | 'completed' | 'claimed'));
      else if (r.status === 'completed') out.push(this.view(q, pilot, r, 'completed'));
    }
    return {
      serverTime: now.toISOString(),
      level: pilot.level,
      cycles: { daily: cyc.daily, weekly: cyc.weekly, nextDailyReset: cyc.nextDailyReset.toISOString(), nextWeeklyReset: cyc.nextWeeklyReset.toISOString() },
      rerolls: { daily: { used: used.daily, max: s.daily_rerolls }, weekly: { used: used.weekly, max: s.weekly_rerolls } },
      maxActive: s.max_active,
      activeCount,
      quests: out,
    };
  }

  // ================================================================== işlemler
  private async mutate<T>(owner: { id: string }, serverCode: string, fn: (c: Queryable, pilot: Pilot, s: QuestSettings, now: Date) => Promise<T>) {
    await this.catalog.ensure(this.db);
    const now = this.clock();
    let playerId = '';
    const result = await withTransaction(this.db, async (c) => {
      const pilot = await this.pilotByOwner(c, owner.id, serverCode, true);
      playerId = pilot.id;
      const s = await this.settings(c);
      await this.ensureCycles(c, pilot, s, now);
      const value = await fn(c, pilot, s, now);
      return { value, list: await this.build(c, pilot, s, now) };
    });
    // Oyundaysa izleyici ve ilgi alanları yenilenir
    await this.bridge?.notifyPlayerUpdated(playerId, 'quests');
    return result;
  }

  private def(code: string) {
    const q = this.catalog.byCode.get(code);
    if (!q) throw err('QUEST_NOT_FOUND', 404, 'Görev bulunamadı.');
    return q;
  }

  async accept(owner: { id: string }, input: unknown) {
    const d = questActionSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot, s, now) => {
      const q = this.def(d.code);
      if (q.category !== 'main' && q.category !== 'event') throw err('QUEST_UNAVAILABLE', 400, 'Günlük ve haftalık görevler otomatik verilir.');
      const rows = await this.rows(c, pilot.id);
      const row = rows.find((r) => r.quest_id === q.id && r.cycle_key === 'once');
      if (row && (row.status === 'active' || row.status === 'completed' || row.status === 'claimed')) {
        throw err('QUEST_UNAVAILABLE', 409, row.status === 'claimed' ? 'Bu görevi zaten tamamladın.' : 'Bu görev zaten görev listende.');
      }
      if (pilot.level < q.minLevel) throw err('QUEST_UNAVAILABLE', 400, `Bu görev ${q.minLevel}. seviyede açılır.`);
      if (q.prereqId && rows.find((r) => r.quest_id === q.prereqId && r.cycle_key === 'once')?.status !== 'claimed') {
        throw err('QUEST_UNAVAILABLE', 400, 'Önce zincirdeki önceki görevi tamamlayıp ödülünü almalısın.');
      }
      if (q.category === 'event' && !this.inWindow(q, now)) throw err('QUEST_UNAVAILABLE', 400, 'Bu etkinlik şu anda açık değil.');
      const active = rows.filter((r) => r.status === 'active' && r.cycle_key === 'once').length;
      if (active >= s.max_active) throw err('QUEST_LIMIT', 409, `Aynı anda en fazla ${s.max_active} ana veya etkinlik görevi alabilirsin.`);
      await this.insertActive(c, pilot, q, 'once', now, Boolean(row));
      this.log.info({ playerId: pilot.id, quest: q.code }, 'görev kabul edildi');
      return null;
    });
  }

  async abandon(owner: { id: string }, input: unknown) {
    const d = questActionSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const q = this.def(d.code);
      const r = await c.query(
        `UPDATE player_quests SET status = 'abandoned', progress = '{}'::jsonb
         WHERE player_id = $1 AND quest_id = $2 AND cycle_key = 'once' AND status = 'active' RETURNING id`,
        [pilot.id, q.id],
      );
      if (!r.rowCount) throw err('QUEST_NOT_ACTIVE', 409, q.category === 'daily' || q.category === 'weekly' ? 'Günlük ve haftalık görevler bırakılamaz; yeniden çekebilirsin.' : 'Bu görev etkin değil.');
      return null;
    });
  }

  async reroll(owner: { id: string }, input: unknown) {
    const d = questActionSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot, s, now) => {
      const q = this.def(d.code);
      if (q.category !== 'daily' && q.category !== 'weekly') throw err('QUEST_UNAVAILABLE', 400, 'Yalnızca günlük ve haftalık görevler yeniden çekilebilir.');
      const cyc = questCycles(now, this.resetHour(s));
      const key = q.category === 'daily' ? cyc.daily : cyc.weekly;
      const max = q.category === 'daily' ? s.daily_rerolls : s.weekly_rerolls;
      const cy = await c.query<{ rerolls_used: number }>(
        'SELECT rerolls_used FROM player_quest_cycles WHERE player_id = $1 AND category = $2 AND cycle_key = $3 FOR UPDATE',
        [pilot.id, q.category, key],
      );
      const usedNow = cy.rows[0]?.rerolls_used ?? 0;
      if (usedNow >= max) throw err('REROLL_LIMIT', 409, `Bu ${q.category === 'daily' ? 'gün' : 'hafta'} yeniden çekme hakkını kullandın.`);
      const old = await c.query(
        `UPDATE player_quests SET status = 'rerolled' WHERE player_id = $1 AND quest_id = $2 AND cycle_key = $3 AND status = 'active' RETURNING id`,
        [pilot.id, q.id, key],
      );
      if (!old.rowCount) throw err('QUEST_NOT_ACTIVE', 409, 'Yalnızca bu döngünün tamamlanmamış görevleri yeniden çekilebilir.');
      const taken = new Set((await c.query<{ quest_id: number }>('SELECT quest_id FROM player_quests WHERE player_id = $1 AND cycle_key = $2', [pilot.id, key])).rows.map((r) => r.quest_id));
      const pool = this.pool(q.category, pilot.level).filter((x) => !taken.has(x.id));
      const next = pickSeeded(pool, 1, `${pilot.id}:${q.category}:${key}:r${usedNow + 1}`)[0];
      if (!next) throw err('QUEST_UNAVAILABLE', 409, 'Havuzda başka görev kalmadı.');
      await this.insertActive(c, pilot, next, key, now);
      await c.query('UPDATE player_quest_cycles SET rerolls_used = rerolls_used + 1 WHERE player_id = $1 AND category = $2 AND cycle_key = $3', [pilot.id, q.category, key]);
      return { replacedBy: next.code };
    });
  }

  async claim(owner: { id: string }, input: unknown): Promise<QuestClaimResponse & { list: QuestsResponse }> {
    const d = questClaimSchema.parse(input);
    let grant: GrantResult | null = null;
    let replay = false;
    let questView: QuestView | null = null;
    const res = await this.mutate(owner, d.serverCode, async (c, pilot) => {
      const q = this.def(d.code);
      const r = await c.query<Row>(
        `SELECT id, quest_id, cycle_key, status, progress, completed_at, claimed_at FROM player_quests
         WHERE player_id = $1 AND quest_id = $2 AND ($3::text IS NULL OR cycle_key = $3) AND status IN ('completed', 'claimed')
         ORDER BY (status = 'completed') DESC, accepted_at DESC LIMIT 1 FOR UPDATE`,
        [pilot.id, q.id, d.cycle ?? null],
      );
      const row = r.rows[0];
      if (!row) throw err('QUEST_NOT_COMPLETED', 409, 'Ödülü almak için önce görevi tamamlamalısın.');
      const rewards: RolledReward[] = q.rewards.map((x) => ({ type: x.type, code: x.code, amount: x.amount }));
      if (row.status === 'claimed') {
        // Tekrar (ağ tekrarı / çift tıklama): yeniden verilmez
        replay = true;
        grant = { experience: 0, honor: 0, currencies: [], items: [], level: pilot.level, levelBefore: pilot.level };
      } else {
        grant = await grantRewards(c, (code) => this.catalog.items.get(code), pilot.id, rewards, {
          key: `quest:${pilot.id}:${q.id}:${row.cycle_key}`,
          reason: 'quest_reward',
          refType: 'quest',
          refId: q.code,
        });
        await c.query(`UPDATE player_quests SET status = 'claimed', claimed_at = now() WHERE id = $1`, [row.id]);
        row.status = 'claimed';
        row.claimed_at = new Date();
        if (grant.level > grant.levelBefore) {
          pilot.level = grant.level;
          await this.levelEvent(c, pilot, grant.level);
        }
        await syncAchievements(c, pilot.id);
        this.log.info({ playerId: pilot.id, quest: q.code, cycle: row.cycle_key }, 'görev ödülü alındı');
      }
      questView = this.view(q, pilot, row, 'claimed');
      return null;
    });
    const g = grant as GrantResult | null;
    return {
      quest: questView!,
      reward: {
        xp: g?.experience ?? 0,
        honor: g?.honor ?? 0,
        currencies: g?.currencies ?? [],
        items: g?.items ?? [],
        level: g?.level ?? res.list.level,
        levelUp: g ? g.level > g.levelBefore : false,
      },
      replay,
      list: res.list,
    };
  }

  /** Seviye atlayınca etkin "seviyeye ulaş" hedefleri güncellenir (aynı transaction). */
  private async levelEvent(c: Queryable, pilot: Pilot, level: number) {
    await this.applyEvents(c, pilot, [{ type: 'reach_level', amount: 1, level }], this.clock());
  }

  // ================================================================== olaylar (oyun sunucusu / hangar)
  /**
   * Olayları pilotun etkin görevlerine uygular. Yeni bir transaction açar (oyun sunucusu).
   * Dönen güncellemeler oyun içi izleyiciye gönderilir.
   */
  async record(playerId: string, events: QuestEvent[]): Promise<QuestProgressUpdate[]> {
    if (!events.length) return [];
    await this.catalog.ensure(this.db);
    const now = this.clock();
    return withTransaction(this.db, async (c) => {
      const pilot = await this.pilotById(c, playerId, true);
      if (!pilot) return [];
      await this.ensureCycles(c, pilot, await this.settings(c), now);
      return this.applyEvents(c, pilot, events, now);
    });
  }

  /** Var olan bir transaction içinde (hangar işlemleri) olay uygular. */
  async recordTx(c: Queryable, playerId: string, events: QuestEvent[]): Promise<QuestProgressUpdate[]> {
    if (!events.length) return [];
    await this.catalog.ensure(this.db);
    const now = this.clock();
    const pilot = await this.pilotById(c, playerId, false);
    if (!pilot) return [];
    await this.ensureCycles(c, pilot, await this.settings(c), now);
    return this.applyEvents(c, pilot, events, now);
  }

  private async applyEvents(c: Queryable, pilot: Pilot, events: QuestEvent[], now: Date): Promise<QuestProgressUpdate[]> {
    const s = await this.settings(c);
    const cyc = questCycles(now, this.resetHour(s));
    const rows = (await c.query<Row>(
      `SELECT id, quest_id, cycle_key, status, progress, completed_at, claimed_at FROM player_quests
       WHERE player_id = $1 AND status = 'active' FOR UPDATE`,
      [pilot.id],
    )).rows;
    const updates: QuestProgressUpdate[] = [];
    for (const row of rows) {
      const q = this.catalog.byId.get(row.quest_id);
      if (!q || !this.live(q, row, cyc, now)) continue;
      let changed = false;
      const progress = { ...row.progress };
      for (const o of q.objectives) {
        const p = resolveParams(o.params, pilot.prefix);
        let cur = progress[o.id] ?? 0;
        if (cur >= o.target) continue;
        for (const e of events) {
          if (!objectiveMatches(o.type, p, e)) continue;
          cur = advance(o.type, cur, o.target, e);
        }
        if (cur !== (progress[o.id] ?? 0)) {
          progress[o.id] = cur;
          changed = true;
        }
      }
      if (!changed) continue;
      const done = q.objectives.every((o) => (progress[o.id] ?? 0) >= o.target);
      await c.query(
        `UPDATE player_quests SET progress = $2, status = $3, completed_at = $4 WHERE id = $1`,
        [row.id, JSON.stringify(progress), done ? 'completed' : 'active', done ? now : null],
      );
      updates.push({
        code: q.code,
        title: resolveCompanyText(q.title, pilot.prefix),
        category: q.category,
        cycle: row.cycle_key,
        status: done ? 'completed' : 'active',
        objectives: q.objectives.map((o) => ({ id: o.id, current: Math.min(o.target, progress[o.id] ?? 0), target: o.target })),
      });
    }
    return updates;
  }

  /**
   * Oyun sunucusu için: pilotun etkin (tamamlanmamış) hedefleri. Yalnızca bunlarla eşleşen olaylar kaydedilir,
   * böylece her lazer atışı veya adım veritabanına gitmez.
   */
  async interests(playerId: string): Promise<{ cycle: string; prefix: string; level: number; killMinShare: number; resetHour: number; objectives: QuestInterest[] } | null> {
    await this.catalog.ensure(this.db);
    const now = this.clock();
    return withTransaction(this.db, async (c) => {
      const pilot = await this.pilotById(c, playerId, false);
      if (!pilot) return null;
      const s = await this.settings(c);
      await this.ensureCycles(c, pilot, s, now);
      const cyc = questCycles(now, this.resetHour(s));
      const out: QuestInterest[] = [];
      for (const row of await this.rows(c, pilot.id)) {
        if (row.status !== 'active') continue;
        const q = this.catalog.byId.get(row.quest_id);
        if (!q || !this.live(q, row, cyc, now)) continue;
        for (const o of q.objectives) {
          if ((row.progress[o.id] ?? 0) >= o.target) continue;
          out.push({ type: o.type, params: resolveParams(o.params, pilot.prefix) });
        }
      }
      return { cycle: `${cyc.daily}|${cyc.weekly}`, prefix: pilot.prefix, level: pilot.level, killMinShare: s.kill_credit_min_share, resetHour: this.resetHour(s), objectives: out };
    });
  }

  /** Döngü anahtarı (oyun sunucusu yeni döngüyü fark etmek için kullanır) */
  async cycleKey(): Promise<string> {
    const s = await this.settings();
    const c = questCycles(this.clock(), this.resetHour(s));
    return `${c.daily}|${c.weekly}`;
  }
}
