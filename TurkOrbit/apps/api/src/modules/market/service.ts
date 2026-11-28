/**
 * Pazar servisi (Aşama 11): rafineri ve üretim kuyruğu, günlük giriş ödülü, sistem açık artırmaları.
 *
 * Güvenlik ilkeleri:
 *  - Fiyat, tarif ve ödül her zaman sunucudaki kayıttan okunur; istemci yalnızca "ne" ve "kaç adet" söyler.
 *  - Her para/eşya hareketi transaction içinde, satır kilidiyle ve idempotent defter anahtarıyla yazılır.
 *  - Açık artırma teklifi emanete alınır; geçilen teklif aynı transaction'da iade edilir. Cüzdanlar sabit sırada
 *    kilitlenir (kilitlenme/deadlock olmaz). Kapanış FOR UPDATE SKIP LOCKED ile birden çok süreçte güvenlidir.
 */
import {
  auctionBidSchema,
  auctionPeriod,
  craftClaimSchema,
  craftStartSchema,
  dailyClaimSchema,
  dailyStreak,
  DEFAULT_AUCTION_SETTINGS,
  extendedEnd,
  levelForXp,
  minNextBid,
  questCycles,
  recipeInputSchema,
  type AuctionSettings,
  type AuctionsResponse,
  type AuctionView,
  type CraftingResponse,
  type DailyRewardResponse,
  type RecipeInput,
  type RolledReward,
} from '@turkorbit/shared';
import { z } from 'zod';
import { withTransaction, type Db, type Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { getSetting } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import { grantItem, removeItem } from '../economy/inventory.js';
import { grantRewards } from '../economy/rewards.js';
import { applyCurrencyChange, getBalances } from '../economy/wallet.js';
import type { GameBridge } from '../game/bridge.js';
import { activeShipStats } from '../hangar/stats.js';
import type { QuestService } from '../quest/service.js';
import { Outbox, type Notifier } from '../social/notifications.js';

const err = (code: ConstructorParameters<typeof AppError>[0], status: number, message: string) => new AppError(code, status, message);
const CURRENCY_NAMES: Record<string, string> = { KREDI: 'Kredi', AKCE: 'Akçe', XP: 'Deneyim', HONOR: 'Şeref' };
const fmt = (n: number) => n.toLocaleString('tr-TR');

interface Pilot {
  id: string;
  level: number;
  serverId: number;
}
interface RecipeRow {
  id: number;
  code: string;
  name: string;
  category: 'refine' | 'craft';
  output_item_type_id: number;
  output_code: string;
  output_name: string;
  output_stackable: boolean;
  output_quantity: number;
  inputs: unknown;
  duration_seconds: number;
  min_level: number;
}
interface StackRow {
  id: string;
  item_type_id: number;
  code: string;
  name: string;
  quantity: string;
}

export class MarketService {
  private readonly clock: () => Date;
  private readonly bridge: GameBridge | null;
  private readonly quests: QuestService | null;
  /** Aşama 12: teklifi geçilen ve açık artırmayı kazanan pilota bildirim */
  private readonly notifier: Notifier | null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    opts: { clock?: () => Date; bridge?: GameBridge | null; quests?: QuestService | null; notifier?: Notifier | null } = {},
  ) {
    this.clock = opts.clock ?? (() => new Date());
    this.bridge = opts.bridge ?? null;
    this.quests = opts.quests ?? null;
    this.notifier = opts.notifier ?? null;
  }

  // ================================================================== ortak
  private async pilot(c: Queryable, ownerId: string, serverCode: string, lock: boolean): Promise<Pilot> {
    const r = await c.query<{ id: string; experience: string; server_id: number }>(
      `SELECT p.id, p.experience, p.server_id FROM players p JOIN game_servers s ON s.id = p.server_id
       WHERE p.user_id = $1 AND s.code = $2 ${lock ? 'FOR UPDATE OF p' : ''}`,
      [ownerId, serverCode.toUpperCase()],
    );
    const p = r.rows[0];
    if (!p) throw err('PILOT_NOT_FOUND', 404, 'Bu sunucuda henüz bir pilotun yok.');
    return { id: p.id, level: levelForXp(Number(p.experience)), serverId: p.server_id };
  }

  private async stacks(c: Queryable, playerId: string): Promise<Map<string, StackRow>> {
    const r = await c.query<StackRow>(
      `SELECT pi.id, pi.item_type_id, it.code, it.name, pi.quantity FROM player_items pi JOIN item_types it ON it.id = pi.item_type_id
       WHERE pi.player_id = $1 AND pi.is_stack`,
      [playerId],
    );
    return new Map(r.rows.map((x) => [x.code, x]));
  }

  private async recipes(c: Queryable, code?: string): Promise<RecipeRow[]> {
    const r = await c.query<RecipeRow>(
      `SELECT r.id, r.code, r.name, r.category, r.output_item_type_id, it.code AS output_code, it.name AS output_name,
              it.stackable AS output_stackable, r.output_quantity, r.inputs, r.duration_seconds, r.min_level
       FROM crafting_recipes r JOIN item_types it ON it.id = r.output_item_type_id
       WHERE r.is_active ${code ? 'AND r.code = $1' : ''} ORDER BY r.sort_order, r.id`,
      code ? [code] : [],
    );
    return r.rows;
  }

  private parseInputs(r: RecipeRow): RecipeInput[] {
    return z.array(recipeInputSchema).min(1).parse(r.inputs);
  }

  // ================================================================== üretim
  async crafting(owner: { id: string }, serverCode: string): Promise<CraftingResponse> {
    const pilot = await this.pilot(this.db, owner.id, serverCode, false);
    return this.buildCrafting(this.db, pilot);
  }

  private async buildCrafting(c: Queryable, pilot: Pilot): Promise<CraftingResponse> {
    const now = this.clock();
    const s = await this.craftSettings(c);
    // Sıralı sorgular: c bir transaction istemcisi olabilir (aynı istemcide eşzamanlı sorgu gönderilmez)
    const recipes = await this.recipes(c);
    const stacks = await this.stacks(c, pilot.id);
    const balances = await getBalances(c, pilot.id);
    const jobs = await c.query<{ id: string; batches: number; output_quantity: string; started_at: Date; ready_at: Date; code: string; name: string; out_code: string; out_name: string }>(
        `SELECT j.id, j.batches, j.output_quantity, j.started_at, j.ready_at, r.code, r.name, it.code AS out_code, it.name AS out_name
         FROM player_crafting_jobs j JOIN crafting_recipes r ON r.id = j.recipe_id JOIN item_types it ON it.id = j.output_item_type_id
         WHERE j.player_id = $1 AND j.status = 'running' ORDER BY j.id`,
      [pilot.id],
    );
    const resources = await c.query<{ code: string; name: string; tier: number; sell_price: string }>(
      `SELECT code, name, (stats->>'tier')::int AS tier, sell_price FROM item_types WHERE category = 'resource' AND NOT is_archived ORDER BY (stats->>'tier')::int, id`,
    );
    const ship = await activeShipStats(c, pilot.id);
    const bal = new Map(balances.map((b) => [b.code, b.balance]));
    const names = new Map(resources.rows.map((x) => [x.code, x.name]));
    const have = (i: RecipeInput) => ('item' in i ? Number(stacks.get(i.item)?.quantity ?? 0) : (bal.get(i.currency) ?? 0));
    const used = resources.rows.reduce((a, x) => a + Number(stacks.get(x.code)?.quantity ?? 0), 0);
    return {
      serverTime: now.toISOString(),
      level: pilot.level,
      slots: s.slots,
      maxBatches: s.max_batches,
      recipes: recipes.map((r) => {
        const inputs = this.parseInputs(r);
        const maxBatches = Math.min(s.max_batches, ...inputs.map((i) => Math.floor(have(i) / i.qty)));
        return {
          code: r.code,
          name: r.name,
          category: r.category,
          output: { code: r.output_code, name: r.output_name, quantity: r.output_quantity },
          inputs: inputs.map((i) => ({
            kind: 'item' in i ? ('item' as const) : ('currency' as const),
            code: 'item' in i ? i.item : i.currency,
            name: 'item' in i ? (names.get(i.item) ?? stacks.get(i.item)?.name ?? i.item) : (CURRENCY_NAMES[i.currency] ?? i.currency),
            qty: i.qty,
            have: have(i),
          })),
          durationSeconds: r.duration_seconds,
          minLevel: r.min_level,
          maxBatches: pilot.level < r.min_level ? 0 : Math.max(0, maxBatches),
          locked: pilot.level < r.min_level,
        };
      }),
      jobs: jobs.rows.map((j) => ({
        id: Number(j.id),
        recipe: j.code,
        name: j.name,
        batches: j.batches,
        output: { code: j.out_code, name: j.out_name, quantity: Number(j.output_quantity) },
        startedAt: j.started_at.toISOString(),
        readyAt: j.ready_at.toISOString(),
        ready: j.ready_at.getTime() <= now.getTime(),
      })),
      resources: resources.rows.map((x) => ({
        code: x.code,
        name: x.name,
        tier: x.tier,
        quantity: Number(stacks.get(x.code)?.quantity ?? 0),
        sellPrice: Number(x.sell_price),
        itemId: stacks.get(x.code)?.id ?? null,
      })),
      cargo: { used, capacity: ship?.stats.cargo ?? 0 },
    };
  }

  private async craftSettings(c: Queryable) {
    return { slots: 3, max_batches: 50, ...((await getSetting<{ slots: number; max_batches: number }>(c, 'crafting')) ?? {}) };
  }

  /** Üretimi başlatır: girdiler (kaynak + Kredi) hemen düşülür, çıktı süre dolunca "Teslim al" ile verilir. */
  async craftStart(owner: { id: string }, input: unknown): Promise<{ replay: boolean; crafting: CraftingResponse }> {
    const d = craftStartSchema.parse(input);
    const now = this.clock();
    let playerId = '';
    const res = await withTransaction(this.db, async (c) => {
      const pilot = await this.pilot(c, owner.id, d.serverCode, true);
      playerId = pilot.id;
      const key = `craft:${pilot.id}:${d.requestId}`;
      const prev = await c.query('SELECT 1 FROM player_crafting_jobs WHERE idempotency_key = $1', [key]);
      if (prev.rowCount) return { replay: true, crafting: await this.buildCrafting(c, pilot) };
      const r = (await this.recipes(c, d.recipe))[0];
      if (!r) throw err('RECIPE_NOT_FOUND', 404, 'Tarif bulunamadı.');
      if (pilot.level < r.min_level) throw err('LEVEL_TOO_LOW', 403, `${r.name} için en az seviye ${r.min_level} olmalısın.`);
      const s = await this.craftSettings(c);
      if (d.batches > s.max_batches) throw err('VALIDATION_ERROR', 400, `Tek seferde en fazla ${s.max_batches} adet üretebilirsin.`);
      const running = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM player_crafting_jobs WHERE player_id = $1 AND status = 'running'`, [pilot.id]);
      if (running.rows[0]!.n >= s.slots) throw err('CRAFT_SLOTS_FULL', 409, `Aynı anda en fazla ${s.slots} üretim yapılabilir. Hazır olanları teslim al.`);
      const inputs = this.parseInputs(r);
      const stacks = await this.stacks(c, pilot.id);
      const codes = inputs.flatMap((i) => ('item' in i ? [i.item] : []));
      const names = new Map((await c.query<{ code: string; name: string }>('SELECT code, name FROM item_types WHERE code = ANY($1)', [codes])).rows.map((x) => [x.code, x.name]));
      // Önce tüm kaynakları denetle (eksik varsa hiçbir şey düşülmez)
      for (const i of inputs) {
        if (!('item' in i)) continue;
        const need = i.qty * d.batches;
        const st = stacks.get(i.item);
        if (!st || Number(st.quantity) < need) {
          throw err('INSUFFICIENT_RESOURCES', 409, `Yetersiz kaynak: ${fmt(need)} ${names.get(i.item) ?? i.item} gerekiyor (elinde ${fmt(Number(st?.quantity ?? 0))}).`);
        }
      }
      for (const i of inputs) {
        const need = i.qty * d.batches;
        if ('item' in i) {
          const st = stacks.get(i.item)!;
          await removeItem(c, pilot.id, { id: st.id, itemTypeId: st.item_type_id, quantity: Number(st.quantity), isStack: true }, need, {
            reason: 'crafting_input',
            refType: 'crafting_recipe',
            refId: r.code,
            idempotencyKey: `${key}:${i.item}`,
          });
        } else {
          await applyCurrencyChange(c, {
            playerId: pilot.id,
            currency: i.currency,
            delta: -need,
            reason: 'crafting_input',
            refType: 'crafting_recipe',
            refId: r.code,
            idempotencyKey: `${key}:${i.currency}`,
          });
        }
      }
      const readyAt = new Date(now.getTime() + r.duration_seconds * d.batches * 1000);
      await c.query(
        `INSERT INTO player_crafting_jobs (player_id, recipe_id, batches, output_item_type_id, output_quantity, status, started_at, ready_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, 'running', $6, $7, $8)`,
        [pilot.id, r.id, d.batches, r.output_item_type_id, r.output_quantity * d.batches, now, readyAt, key],
      );
      this.log.info({ playerId: pilot.id, recipe: r.code, batches: d.batches }, 'üretim başladı');
      return { replay: false, crafting: await this.buildCrafting(c, pilot) };
    });
    // Oyundaysa ambar (kaynak miktarı) ve envanter güncellenir
    if (!res.replay) await this.bridge?.notifyPlayerUpdated(playerId, 'quests');
    return res;
  }

  /** Süresi dolan üretimin çıktısını envantere ekler (bir kez). */
  async craftClaim(owner: { id: string }, input: unknown) {
    const d = craftClaimSchema.parse(input);
    const now = this.clock();
    let playerId = '';
    const res = await withTransaction(this.db, async (c) => {
      const pilot = await this.pilot(c, owner.id, d.serverCode, true);
      playerId = pilot.id;
      const j = (await c.query<{ id: string; status: string; ready_at: Date; batches: number; output_item_type_id: number; output_quantity: string; out_code: string; out_name: string; out_stackable: boolean }>(
        `SELECT j.id, j.status, j.ready_at, j.batches, j.output_item_type_id, j.output_quantity, it.code AS out_code, it.name AS out_name, it.stackable AS out_stackable
         FROM player_crafting_jobs j JOIN item_types it ON it.id = j.output_item_type_id
         WHERE j.id = $1 AND j.player_id = $2 FOR UPDATE OF j`,
        [d.jobId, pilot.id],
      )).rows[0];
      if (!j) throw err('NOT_FOUND', 404, 'Üretim bulunamadı.');
      const claimed = { code: j.out_code, name: j.out_name, quantity: Number(j.output_quantity) };
      if (j.status === 'claimed') return { claimed, replay: true, crafting: await this.buildCrafting(c, pilot) };
      if (j.ready_at.getTime() > now.getTime()) {
        const sec = Math.ceil((j.ready_at.getTime() - now.getTime()) / 1000);
        throw err('CRAFT_NOT_READY', 409, `Üretim henüz bitmedi (${sec} sn kaldı).`);
      }
      await grantItem(c, pilot.id, { id: j.output_item_type_id, stackable: j.out_stackable }, Number(j.output_quantity), {
        reason: 'crafting_output',
        source: 'crafting',
        refType: 'crafting_job',
        refId: j.id,
        idempotencyKey: `craftjob:${j.id}:out`,
      });
      await c.query(`UPDATE player_crafting_jobs SET status = 'claimed', claimed_at = $2 WHERE id = $1`, [j.id, now]);
      await this.quests?.recordTx(c, pilot.id, [{ type: 'craft_item', amount: j.batches, item: j.out_code }]);
      return { claimed, replay: false, crafting: await this.buildCrafting(c, pilot) };
    });
    if (!res.replay) await this.bridge?.notifyPlayerUpdated(playerId, 'quests');
    return res;
  }

  // ================================================================== günlük giriş ödülü
  private async dailyCalendar(c: Queryable) {
    const r = await c.query<{ day_number: number; reward_type: RolledReward['type']; ref_code: string; min_amount: string; item_name: string | null }>(
      `SELECT d.day_number, e.reward_type, e.ref_code, e.min_amount, it.name AS item_name
       FROM daily_login_rewards d JOIN reward_entries e ON e.reward_table_id = d.reward_table_id
       LEFT JOIN item_types it ON e.reward_type = 'item' AND it.code = e.ref_code
       ORDER BY d.day_number, e.id`,
    );
    const days = new Map<number, Array<{ type: string; code: string; name: string; amount: number }>>();
    for (const x of r.rows) {
      const list = days.get(x.day_number) ?? [];
      list.push({ type: x.reward_type, code: x.ref_code, name: x.item_name ?? CURRENCY_NAMES[x.ref_code] ?? x.ref_code, amount: Number(x.min_amount) });
      days.set(x.day_number, list);
    }
    return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([day, rewards]) => ({ day, rewards }));
  }

  private async lastLogin(c: Queryable, playerId: string) {
    const r = await c.query<{ date: string; streak: number; day_number: number }>(
      `SELECT cycle_date::text AS date, streak, day_number FROM player_daily_logins WHERE player_id = $1 ORDER BY cycle_date DESC LIMIT 1`,
      [playerId],
    );
    return r.rows[0] ?? null;
  }

  private async buildDaily(c: Queryable, pilot: Pilot): Promise<DailyRewardResponse> {
    const now = this.clock();
    const cyc = questCycles(now);
    const last = await this.lastLogin(c, pilot.id);
    const claimedToday = last?.date === cyc.daily;
    const next = claimedToday ? { streak: last!.streak, day: last!.day_number } : dailyStreak(cyc.daily, last ? { date: last.date, streak: last.streak } : null);
    return {
      serverTime: now.toISOString(),
      today: cyc.daily,
      claimedToday,
      day: next.day,
      streak: next.streak,
      nextReset: cyc.nextDailyReset.toISOString(),
      calendar: await this.dailyCalendar(c),
    };
  }

  async daily(owner: { id: string }, serverCode: string): Promise<DailyRewardResponse> {
    const pilot = await this.pilot(this.db, owner.id, serverCode, false);
    return this.buildDaily(this.db, pilot);
  }

  /** Günün ödülünü verir (oyun günü başına bir kez; eşzamanlı istekte tek ödül). */
  async dailyClaim(owner: { id: string }, input: unknown) {
    const d = dailyClaimSchema.parse(input);
    const now = this.clock();
    let playerId = '';
    const res = await withTransaction(this.db, async (c) => {
      const pilot = await this.pilot(c, owner.id, d.serverCode, true); // pilot satırı kilidi: aynı anda iki istek sırayla işlenir
      playerId = pilot.id;
      const today = questCycles(now).daily;
      const last = await this.lastLogin(c, pilot.id);
      if (last?.date === today) {
        return { replay: true, reward: null, daily: await this.buildDaily(c, pilot) };
      }
      const { streak, day } = dailyStreak(today, last ? { date: last.date, streak: last.streak } : null);
      const entries = await c.query<{ reward_type: RolledReward['type']; ref_code: string; min_amount: string }>(
        `SELECT e.reward_type, e.ref_code, e.min_amount FROM daily_login_rewards d JOIN reward_entries e ON e.reward_table_id = d.reward_table_id
         WHERE d.day_number = $1 ORDER BY e.id`,
        [day],
      );
      const items = await c.query<{ id: number; code: string; name: string; stackable: boolean }>('SELECT id, code, name, stackable FROM item_types WHERE category IN (\'ammo\', \'rocket\', \'resource\')');
      const byCode = new Map(items.rows.map((x) => [x.code, x]));
      const reward = await grantRewards(
        c,
        (code) => byCode.get(code),
        pilot.id,
        entries.rows.map((e) => ({ type: e.reward_type, code: e.ref_code, amount: Number(e.min_amount) })),
        { key: `daily:${pilot.id}:${today}`, reason: 'daily_login', refType: 'daily_login', refId: today },
      );
      await c.query(`INSERT INTO player_daily_logins (player_id, cycle_date, streak, day_number, claimed_at) VALUES ($1, $2, $3, $4, $5)`, [
        pilot.id,
        today,
        streak,
        day,
        now,
      ]);
      this.log.info({ playerId: pilot.id, day, streak }, 'günlük ödül alındı');
      return { replay: false, reward: { day, streak, ...reward }, daily: await this.buildDaily(c, pilot) };
    });
    if (!res.replay) await this.bridge?.notifyPlayerUpdated(playerId, 'quests');
    return res;
  }

  // ================================================================== açık artırma
  private async auctionSettings(c: Queryable): Promise<AuctionSettings> {
    return { ...DEFAULT_AUCTION_SETTINGS, ...((await getSetting<Partial<AuctionSettings>>(c, 'auction')) ?? {}) };
  }

  /** Her sunucu ve etkin lot için içinde bulunulan döneme ait açık artırmayı oluşturur (varsa dokunmaz). */
  async ensureAuctions(now = this.clock()): Promise<number> {
    const lots = await this.db.query<{ id: number; auction_type: 'hourly' | 'daily' | 'weekly'; item_type_id: number; quantity: string; currency_code: string; min_bid: string }>(
      'SELECT id, auction_type, item_type_id, quantity, currency_code, min_bid FROM auction_lots WHERE is_active',
    );
    const servers = await this.db.query<{ id: number }>('SELECT id FROM game_servers WHERE NOT is_maintenance');
    let created = 0;
    for (const sv of servers.rows) {
      for (const l of lots.rows) {
        const p = auctionPeriod(l.auction_type, now);
        const r = await this.db.query(
          `INSERT INTO auctions (server_id, lot_id, period_key, auction_type, item_type_id, quantity, currency_code, min_bid, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (server_id, lot_id, period_key) DO NOTHING`,
          [sv.id, l.id, p.key, l.auction_type, l.item_type_id, l.quantity, l.currency_code, l.min_bid, p.startsAt, p.endsAt],
        );
        created += r.rowCount ?? 0;
      }
    }
    return created;
  }

  /** Süresi dolan açık artırmaları sonuçlandırır: kazanan eşyayı alır (emanetteki teklif harcanmış olur). */
  async settleDue(now = this.clock()): Promise<number> {
    let settled = 0;
    const winners: string[] = [];
    const out = new Outbox();
    for (;;) {
      const done = await withTransaction(this.db, async (c) => {
        const a = (await c.query<{ id: string; current_bidder: string | null; current_bid: string | null; item_type_id: number; quantity: string; stackable: boolean; name: string; currency_code: string }>(
          `SELECT a.id, a.current_bidder, a.current_bid, a.item_type_id, a.quantity, it.stackable, it.name, a.currency_code
           FROM auctions a JOIN item_types it ON it.id = a.item_type_id
           WHERE a.status = 'open' AND a.ends_at <= $1 ORDER BY a.ends_at LIMIT 1 FOR UPDATE OF a SKIP LOCKED`,
          [now],
        )).rows[0];
        if (!a) return false;
        if (a.current_bidder) {
          await grantItem(c, a.current_bidder, { id: a.item_type_id, stackable: a.stackable }, Number(a.quantity), {
            reason: 'auction_win',
            source: 'auction',
            refType: 'auction',
            refId: a.id,
            idempotencyKey: `auction:${a.id}:win`,
          });
          winners.push(a.current_bidder);
          await this.notifier?.create(c, out, a.current_bidder, {
            kind: 'auction_won',
            title: 'Açık artırmayı kazandın',
            body: `${fmt(Number(a.quantity))} × ${a.name} envanterine eklendi (${fmt(Number(a.current_bid))} ${CURRENCY_NAMES[a.currency_code] ?? a.currency_code}).`,
            link: '/pazar',
          });
        }
        await c.query(`UPDATE auctions SET status = 'settled', winner_id = current_bidder, settled_at = $2 WHERE id = $1`, [a.id, now]);
        return true;
      });
      if (!done) break;
      settled++;
    }
    for (const w of new Set(winners)) await this.bridge?.notifyPlayerUpdated(w, 'quests');
    await this.notifier?.flush(out);
    if (settled) this.log.info({ settled }, 'açık artırmalar sonuçlandı');
    return settled;
  }

  async auctions(owner: { id: string }, serverCode: string): Promise<AuctionsResponse> {
    const now = this.clock();
    await this.ensureAuctions(now);
    await this.settleDue(now);
    const pilot = await this.pilot(this.db, owner.id, serverCode, false);
    return this.buildAuctions(this.db, pilot);
  }

  private async buildAuctions(c: Queryable, pilot: Pilot): Promise<AuctionsResponse> {
    const now = this.clock();
    const s = await this.auctionSettings(c);
    const rows = await c.query<{
      id: string; auction_type: AuctionView['type']; code: string; name: string; category: string; rarity: string; quantity: string; currency_code: string;
      min_bid: string; current_bid: string | null; current_bidder: string | null; bid_count: number; ends_at: Date; status: AuctionView['status']; winner_id: string | null; my_bid: string | null;
    }>(
      `SELECT a.id, a.auction_type, it.code, it.name, it.category, it.rarity, a.quantity, a.currency_code, a.min_bid, a.current_bid, a.current_bidder,
              a.bid_count, a.ends_at, a.status, a.winner_id,
              (SELECT b.amount FROM auction_bids b WHERE b.auction_id = a.id AND b.player_id = $2 AND NOT b.refunded ORDER BY b.id DESC LIMIT 1) AS my_bid
       FROM auctions a JOIN item_types it ON it.id = a.item_type_id
       WHERE a.server_id = $1 AND (
         (a.status = 'open' AND a.ends_at > $3)
         OR (a.status = 'settled' AND EXISTS (SELECT 1 FROM auction_bids b WHERE b.auction_id = a.id AND b.player_id = $2) AND a.ends_at > $3::timestamptz - interval '7 days')
       )
       ORDER BY a.status, a.ends_at, a.id`,
      [pilot.serverId, pilot.id, now],
    );
    const view = (a: (typeof rows.rows)[number]): AuctionView => {
      const current = a.current_bid === null ? null : Number(a.current_bid);
      return {
        id: Number(a.id),
        type: a.auction_type,
        item: { code: a.code, name: a.name, category: a.category, rarity: a.rarity, quantity: Number(a.quantity) },
        currency: a.currency_code,
        minBid: Number(a.min_bid),
        currentBid: current,
        nextMinBid: minNextBid(Number(a.min_bid), current, s),
        bidCount: a.bid_count,
        leading: a.current_bidder === pilot.id,
        myBid: a.status === 'open' && a.my_bid !== null ? Number(a.my_bid) : null,
        endsAt: a.ends_at.toISOString(),
        status: a.status,
        won: a.status === 'settled' && a.winner_id === pilot.id,
      };
    };
    const balances = await getBalances(c, pilot.id);
    return {
      serverTime: now.toISOString(),
      balances: balances.map((b) => ({ code: b.code, balance: b.balance })),
      open: rows.rows.filter((a) => a.status === 'open').map(view),
      history: rows.rows.filter((a) => a.status === 'settled').slice(-10).map(view),
    };
  }

  /**
   * Teklif: tutar emanete alınır (cüzdandan düşülür), önceki en yüksek teklif sahibine iade edilir.
   * Bitişe 60 sn'den az kala gelen teklif süreyi uzatır.
   */
  async bid(owner: { id: string }, input: unknown) {
    const d = auctionBidSchema.parse(input);
    const now = this.clock();
    const out = new Outbox();
    const res = await withTransaction(this.db, async (c) => {
      const pilot = await this.pilot(c, owner.id, d.serverCode, false);
      const key = `bid:${pilot.id}:${d.requestId}`;
      const prev = await c.query('SELECT 1 FROM auction_bids WHERE idempotency_key = $1', [key]);
      if (prev.rowCount) return { replay: true, auctions: await this.buildAuctions(c, pilot) };
      const a = (await c.query<{ id: string; server_id: number; status: string; ends_at: Date; min_bid: string; current_bid: string | null; current_bidder: string | null; currency_code: string; name: string }>(
        `SELECT a.id, a.server_id, a.status, a.ends_at, a.min_bid, a.current_bid, a.current_bidder, a.currency_code, it.name
         FROM auctions a JOIN item_types it ON it.id = a.item_type_id WHERE a.id = $1 FOR UPDATE OF a`,
        [d.auctionId],
      )).rows[0];
      if (!a || a.server_id !== pilot.serverId) throw err('AUCTION_NOT_FOUND', 404, 'Açık artırma bulunamadı.');
      if (a.status !== 'open' || a.ends_at.getTime() <= now.getTime()) throw err('AUCTION_CLOSED', 409, 'Bu açık artırma sona erdi.');
      const s = await this.auctionSettings(c);
      const current = a.current_bid === null ? null : Number(a.current_bid);
      const min = minNextBid(Number(a.min_bid), current, s);
      if (d.amount < min) throw err('BID_TOO_LOW', 409, `En az ${fmt(min)} ${CURRENCY_NAMES[a.currency_code] ?? a.currency_code} teklif etmelisin.`);
      // Cüzdanlar sabit sırada kilitlenir (eşzamanlı teklif ve iadelerde kilitlenme olmaz)
      const holders = [...new Set([pilot.id, ...(a.current_bidder ? [a.current_bidder] : [])])].sort();
      await c.query('SELECT 1 FROM wallets WHERE player_id = ANY($1) AND currency_code = $2 ORDER BY player_id FOR UPDATE', [holders, a.currency_code]);
      // Önce önceki en yüksek teklif iade edilir (kendi teklifini artıran oyuncu emanetteki tutarı kullanabilir)
      if (a.current_bidder && current !== null) {
        const pb = (await c.query<{ id: string }>(
          `SELECT id FROM auction_bids WHERE auction_id = $1 AND player_id = $2 AND NOT refunded ORDER BY id DESC LIMIT 1`,
          [a.id, a.current_bidder],
        )).rows[0];
        await applyCurrencyChange(c, {
          playerId: a.current_bidder,
          currency: a.currency_code,
          delta: current,
          reason: 'auction_refund',
          refType: 'auction',
          refId: a.id,
          idempotencyKey: `auction:${a.id}:refund:${pb?.id ?? 'x'}`,
        });
        if (pb) await c.query('UPDATE auction_bids SET refunded = true WHERE id = $1', [pb.id]);
        if (a.current_bidder !== pilot.id) {
          await this.notifier?.create(c, out, a.current_bidder, {
            kind: 'auction_outbid',
            title: 'Açık artırmada teklifin geçildi',
            body: `${a.name}: yeni en yüksek teklif ${fmt(d.amount)} ${CURRENCY_NAMES[a.currency_code] ?? a.currency_code}. ${fmt(current)} iade edildi.`,
            link: '/pazar',
          });
        }
      }
      await applyCurrencyChange(c, {
        playerId: pilot.id,
        currency: a.currency_code,
        delta: -d.amount,
        reason: 'auction_bid',
        refType: 'auction',
        refId: a.id,
        idempotencyKey: key,
      });
      await c.query('INSERT INTO auction_bids (auction_id, player_id, amount, idempotency_key) VALUES ($1, $2, $3, $4)', [a.id, pilot.id, d.amount, key]);
      await c.query(
        'UPDATE auctions SET current_bid = $2, current_bidder = $3, bid_count = bid_count + 1, ends_at = $4 WHERE id = $1',
        [a.id, d.amount, pilot.id, extendedEnd(a.ends_at, now, s)],
      );
      this.log.info({ playerId: pilot.id, auction: a.id, amount: d.amount }, 'açık artırma teklifi');
      return { replay: false, auctions: await this.buildAuctions(c, pilot) };
    });
    await this.notifier?.flush(out);
    return res;
  }

  // ================================================================== zamanlayıcı
  /** API sürecinde: dönem açık artırmalarını oluşturur, süresi dolanları sonuçlandırır (birden çok süreçte güvenli). */
  startScheduler(intervalMs = 10_000) {
    const run = async () => {
      try {
        await this.ensureAuctions();
        await this.settleDue();
      } catch (e) {
        this.log.error({ err: e }, 'açık artırma zamanlayıcısı hatası');
      }
    };
    void run();
    this.timer = setInterval(() => void run(), intervalMs);
  }

  stopScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
