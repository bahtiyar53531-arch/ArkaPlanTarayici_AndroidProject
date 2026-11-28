/**
 * İçerik sürümleme (Aşama 14): taslak → önizleme (fark + etki) → yayın → geri alma.
 *
 *  - Her tür için bir adaptör: kaydı okur (yalnızca düzenlenebilir alanlar), uygular, etkiyi tahmin eder ve yayında
 *    oyun sunucularına hangi olayın gideceğini söyler.
 *  - İlk düzenlemede kaydın mevcut hali "sürüm 1 (ilk durum)" olarak yazılır; ilk değişiklik de geri alınabilir.
 *  - İyimser kilit: taslak, yayındaki sürümün üzerine kurulur. Yayın anında yayındaki sürüm değişmişse
 *    (başka bir yönetici araya girdiyse) veya kayıt veritabanında doğrudan değiştirildiyse yayın 409 ile reddedilir.
 *  - Yayın ve geri alma tek transaction: tablo güncellemesi + sürüm durumu + denetim kaydı. Oyun sunucusu olayı
 *    commit'ten sonra gönderilir.
 */
import {
  CONTENT_TYPE_DEFS,
  SETTING_DEFS,
  SETTING_DEF_BY_KEY,
  adminQuestCreateSchema,
  contentDraftSchema,
  diffFields,
  getPath,
  setPath,
  validateField,
  type ContentDetail,
  type ContentField,
  type ContentListItem,
  type ContentType,
  type RevisionView,
} from '@turkorbit/shared';
import { withTransaction, type Db, type Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../auth/service.js';
import type { AdminGameEvent, GameBridge } from '../game/bridge.js';
import { audit, can, fmt, mapDbError, notFound, type AdminActor } from './common.js';

type Data = Record<string, unknown>;

interface Loaded {
  title: string;
  description: string | null;
  data: Data;
}

interface Adapter {
  list(db: Queryable): Promise<Array<{ id: string; title: string; columns: Data }>>;
  load(c: Queryable, id: string): Promise<Loaded | null>;
  fields(id: string): ContentField[];
  check?(c: Queryable, id: string, data: Data): Promise<string | null>;
  apply(c: Queryable, id: string, data: Data, actorId: string): Promise<void>;
  impact(c: Queryable, id: string): Promise<string[]>;
  events(id: string, data: Data): AdminGameEvent[];
}

const isoOrNull = (d: unknown) => (d instanceof Date ? d.toISOString() : d === null || d === undefined ? null : String(d));
const numId = (id: string) => (/^\d{1,9}$/.test(id) ? Number(id) : null);

export class ContentService {
  private readonly adapters: Record<ContentType, Adapter>;
  /** Görev yayını/geri alması sonrası bu süreçteki görev önbelleğini hemen tazelemek için (diğer süreçler ≤2 sn'de görür) */
  onQuestChange: (() => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly bridge: GameBridge,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.adapters = {
      npc_type: this.npcAdapter(),
      ship_type: this.shipAdapter(),
      shop_offer: this.offerAdapter(),
      quest: this.questAdapter(),
      map: this.mapAdapter(),
      setting: this.settingAdapter(),
    };
  }

  // ================================================================== adaptörler
  private npcAdapter(): Adapter {
    const cols = 'name, hitpoints, shield, shield_absorb::float8 AS shield_absorb, damage, attack_rate_ms, attack_range, speed, experience, honor';
    return {
      list: async (db) =>
        (await db.query<Data & { id: number; code: string; level: number; family: string }>(
          `SELECT id, code, family, level, ${cols} FROM npc_types WHERE NOT is_archived ORDER BY level, id`,
        )).rows.map((r) => ({ id: String(r.id), title: String(r.name), columns: { code: r.code, name: r.name, level: r.level, hitpoints: r.hitpoints, shield: r.shield, damage: r.damage } })),
      load: async (c, id) => {
        const n = numId(id);
        if (n === null) return null;
        const r = await c.query<Data & { code: string; family: string; level: number }>(`SELECT code, family, level, ${cols} FROM npc_types WHERE id = $1 AND NOT is_archived`, [n]);
        const x = r.rows[0];
        if (!x) return null;
        const { code, family, level, ...data } = x;
        return { title: String(data.name), description: `${code} · ${family} ailesi · Sv ${level}`, data };
      },
      fields: () => CONTENT_TYPE_DEFS.npc_type.fields,
      apply: async (c, id, d) => {
        await c.query(
          `UPDATE npc_types SET name = $2, hitpoints = $3, shield = $4, shield_absorb = $5, damage = $6, attack_rate_ms = $7, attack_range = $8,
                                speed = $9, experience = $10, honor = $11 WHERE id = $1`,
          [Number(id), d.name, d.hitpoints, d.shield, d.shield_absorb, d.damage, d.attack_rate_ms, d.attack_range, d.speed, d.experience, d.honor],
        );
      },
      impact: async (c, id) => {
        const r = await c.query<{ code: string; n: string }>(
          `SELECT m.code, sum(s.max_alive)::text AS n FROM npc_spawns s JOIN maps m ON m.id = s.map_id
           WHERE s.npc_type_id = $1 AND s.is_enabled GROUP BY m.code ORDER BY m.code`,
          [Number(id)],
        );
        if (r.rows.length === 0) return ['Bu NPC şu an hiçbir haritada doğmuyor.'];
        const total = r.rows.reduce((a, x) => a + Number(x.n), 0);
        return [`${r.rows.length} haritada aynı anda en fazla ${fmt(total)} adet (${r.rows.map((x) => x.code).join(', ')}).`];
      },
      events: () => [{ type: 'content' }],
    };
  }

  private shipAdapter(): Adapter {
    const cols = 'name, description, hitpoints, base_speed, cargo_capacity, min_level, is_for_sale';
    return {
      list: async (db) =>
        (await db.query<Data & { id: number; code: string }>(`SELECT id, code, ${cols} FROM ship_types WHERE NOT is_archived ORDER BY min_level, id`)).rows.map((r) => ({
          id: String(r.id),
          title: String(r.name),
          columns: { code: r.code, name: r.name, hitpoints: r.hitpoints, base_speed: r.base_speed, cargo_capacity: r.cargo_capacity, is_for_sale: r.is_for_sale },
        })),
      load: async (c, id) => {
        const n = numId(id);
        if (n === null) return null;
        const r = await c.query<Data & { code: string; ship_class: string }>(`SELECT code, ship_class, ${cols} FROM ship_types WHERE id = $1 AND NOT is_archived`, [n]);
        const x = r.rows[0];
        if (!x) return null;
        const { code, ship_class, ...data } = x;
        return { title: String(data.name), description: `${code} · ${ship_class}`, data };
      },
      fields: () => CONTENT_TYPE_DEFS.ship_type.fields,
      apply: async (c, id, d) => {
        await c.query(
          `UPDATE ship_types SET name = $2, description = $3, hitpoints = $4, base_speed = $5, cargo_capacity = $6, min_level = $7, is_for_sale = $8 WHERE id = $1`,
          [Number(id), d.name, d.description, d.hitpoints, d.base_speed, d.cargo_capacity, d.min_level, d.is_for_sale],
        );
      },
      impact: async (c, id) => {
        const r = await c.query<{ owned: string; active: string }>(
          `SELECT (SELECT count(*) FROM player_ships WHERE ship_type_id = $1)::text AS owned,
                  (SELECT count(*) FROM players p JOIN player_ships ps ON ps.id = p.active_ship_id WHERE ps.ship_type_id = $1)::text AS active`,
          [Number(id)],
        );
        return [`${fmt(Number(r.rows[0]!.owned))} pilotun hangarında var; ${fmt(Number(r.rows[0]!.active))} pilot aktif olarak kullanıyor.`];
      },
      events: (id) => [{ type: 'ships', shipTypeId: Number(id) }],
    };
  }

  private offerAdapter(): Adapter {
    const sel = `SELECT o.id, o.price, o.discount_percent, o.discount_ends_at, o.max_per_purchase, o.per_player_limit, o.is_active,
                        COALESCE(o.title, it.name, st.name) AS title, o.quantity, o.offer_type, o.currency_code AS currency, sc.name AS category
                 FROM shop_offers o JOIN shop_categories sc ON sc.id = o.category_id
                 LEFT JOIN item_types it ON it.id = o.item_type_id LEFT JOIN ship_types st ON st.id = o.ship_type_id`;
    type Row = { id: number; price: string; discount_percent: number; discount_ends_at: Date | null; max_per_purchase: number; per_player_limit: number | null; is_active: boolean; title: string; quantity: string; offer_type: string; currency: string; category: string };
    const data = (r: Row): Data => ({
      price: Number(r.price),
      discount_percent: r.discount_percent,
      discount_ends_at: isoOrNull(r.discount_ends_at),
      max_per_purchase: r.max_per_purchase,
      per_player_limit: r.per_player_limit,
      is_active: r.is_active,
    });
    const title = (r: Row) => (Number(r.quantity) > 1 ? `${r.title} ×${fmt(Number(r.quantity))}` : r.title);
    return {
      list: async (db) =>
        (await db.query<Row>(`${sel} ORDER BY sc.sort_order, o.sort_order, o.id`)).rows.map((r) => ({
          id: String(r.id),
          title: title(r),
          columns: { title: title(r), category: r.category, currency: r.currency, price: Number(r.price), discount_percent: r.discount_percent, is_active: r.is_active },
        })),
      load: async (c, id) => {
        const n = numId(id);
        if (n === null) return null;
        const r = (await c.query<Row>(`${sel} WHERE o.id = $1`, [n])).rows[0];
        return r ? { title: title(r), description: `${r.category} · ${r.offer_type === 'bundle' ? 'paket' : r.offer_type === 'ship' ? 'gemi' : 'eşya'} · ${r.currency}`, data: data(r) } : null;
      },
      fields: () => CONTENT_TYPE_DEFS.shop_offer.fields,
      check: async (_c, _id, d) => (d.discount_percent && Number(d.discount_percent) > 0 && d.discount_ends_at && new Date(String(d.discount_ends_at)) <= this.now() ? 'İndirim bitişi gelecekte olmalı.' : null),
      apply: async (c, id, d) => {
        await c.query(
          `UPDATE shop_offers SET price = $2, discount_percent = $3, discount_ends_at = $4, max_per_purchase = $5, per_player_limit = $6, is_active = $7 WHERE id = $1`,
          [Number(id), d.price, d.discount_percent, d.discount_ends_at, d.max_per_purchase, d.per_player_limit, d.is_active],
        );
      },
      impact: async (c, id) => {
        const r = await c.query<{ total: string; recent: string }>(
          `SELECT count(*)::text AS total, count(*) FILTER (WHERE created_at > now() - interval '30 days')::text AS recent FROM shop_purchases WHERE offer_id = $1`,
          [Number(id)],
        );
        return [`Toplam ${fmt(Number(r.rows[0]!.total))} satın alma; son 30 günde ${fmt(Number(r.rows[0]!.recent))}.`];
      },
      events: () => [],
    };
  }

  private questAdapter(): Adapter {
    const cols = 'title, description, is_published, starts_at, ends_at, min_level, max_level';
    type Row = { id: number; code: string; category: string; title: string; description: string; is_published: boolean; starts_at: Date | null; ends_at: Date | null; min_level: number; max_level: number | null };
    const data = (r: Row): Data => ({
      title: r.title,
      description: r.description,
      is_published: r.is_published,
      starts_at: isoOrNull(r.starts_at),
      ends_at: isoOrNull(r.ends_at),
      min_level: r.min_level,
      max_level: r.max_level,
    });
    return {
      list: async (db) =>
        (await db.query<Row>(`SELECT id, code, category, ${cols} FROM quests ORDER BY (category = 'event') DESC, category, sort_order, id`)).rows.map((r) => ({
          id: String(r.id),
          title: r.title,
          columns: { code: r.code, category: r.category, title: r.title, min_level: r.min_level, is_published: r.is_published },
        })),
      load: async (c, id) => {
        const n = numId(id);
        if (n === null) return null;
        const r = (await c.query<Row>(`SELECT id, code, category, ${cols} FROM quests WHERE id = $1`, [n])).rows[0];
        return r ? { title: r.title, description: `${r.code} · ${{ main: 'ana', daily: 'günlük', weekly: 'haftalık', event: 'etkinlik' }[r.category] ?? r.category} görevi`, data: data(r) } : null;
      },
      fields: () => CONTENT_TYPE_DEFS.quest.fields,
      check: async (c, id, d) => {
        const cat = (await c.query<{ category: string }>('SELECT category FROM quests WHERE id = $1', [Number(id)])).rows[0]?.category;
        if (cat === 'event' && (!d.starts_at || !d.ends_at)) return 'Etkinlik görevinde başlangıç ve bitiş zorunlu.';
        if (d.starts_at && d.ends_at && new Date(String(d.ends_at)) <= new Date(String(d.starts_at))) return 'Bitiş başlangıçtan sonra olmalı.';
        if (d.max_level !== null && d.max_level !== undefined && Number(d.max_level) < Number(d.min_level)) return 'En yüksek seviye en düşük seviyeden küçük olamaz.';
        return null;
      },
      apply: async (c, id, d) => {
        await c.query(
          `UPDATE quests SET title = $2, description = $3, is_published = $4, starts_at = $5, ends_at = $6, min_level = $7, max_level = $8 WHERE id = $1`,
          [Number(id), d.title, d.description, d.is_published, d.starts_at, d.ends_at, d.min_level, d.max_level],
        );
      },
      impact: async (c, id) => {
        const r = await c.query<{ active: string; done: string }>(
          `SELECT count(*) FILTER (WHERE status = 'active')::text AS active, count(*) FILTER (WHERE status <> 'active')::text AS done FROM player_quests WHERE quest_id = $1`,
          [Number(id)],
        );
        return [`${fmt(Number(r.rows[0]!.active))} pilotta aktif; ${fmt(Number(r.rows[0]!.done))} kez tamamlandı veya bırakıldı.`];
      },
      events: () => [],
    };
  }

  private mapAdapter(): Adapter {
    const cols = 'name, min_level, pvp_enabled, is_closed, closed_reason';
    return {
      list: async (db) =>
        (await db.query<Data & { code: string }>(`SELECT code, ${cols} FROM maps WHERE NOT is_archived ORDER BY code`)).rows.map((r) => ({
          id: r.code,
          title: `${r.code} · ${String(r.name)}`,
          columns: { code: r.code, name: r.name, min_level: r.min_level, pvp_enabled: r.pvp_enabled, is_closed: r.is_closed },
        })),
      load: async (c, id) => {
        const r = await c.query<Data & { map_type: string }>(`SELECT map_type, ${cols} FROM maps WHERE code = $1 AND NOT is_archived`, [id]);
        const x = r.rows[0];
        if (!x) return null;
        const { map_type, ...data } = x;
        return { title: `${id} · ${String(data.name)}`, description: `${map_type} haritası`, data };
      },
      fields: () => CONTENT_TYPE_DEFS.map.fields,
      check: async (_c, _id, d) => (d.is_closed && !d.closed_reason ? 'Haritayı kapatırken bir kapanış sebebi yaz (pilotlara gösterilir).' : null),
      apply: async (c, id, d) => {
        await c.query('UPDATE maps SET name = $2, min_level = $3, pvp_enabled = $4, is_closed = $5, closed_reason = $6 WHERE code = $1', [
          id, d.name, d.min_level, d.pvp_enabled, d.is_closed, d.is_closed ? d.closed_reason : null,
        ]);
      },
      impact: async (c, id) => {
        const online = (await this.bridge.allPresence()).filter((p) => p.map === id).length;
        const saved = (await c.query<{ n: string }>('SELECT count(*)::text AS n FROM players p JOIN maps m ON m.id = p.map_id WHERE m.code = $1', [id])).rows[0]!.n;
        return [`Şu an haritada ${fmt(online)} çevrimiçi pilot; ${fmt(Number(saved))} pilotun son konumu bu harita.`];
      },
      events: (id, d) => [{ type: 'map', code: id, pvp: Boolean(d.pvp_enabled) }],
    };
  }

  private settingAdapter(): Adapter {
    return {
      list: async (db) => {
        const r = await db.query<{ key: string }>('SELECT key FROM game_settings');
        const have = new Set(r.rows.map((x) => x.key));
        return SETTING_DEFS.filter((d) => have.has(d.key)).map((d) => ({ id: d.key, title: d.title, columns: { key: d.key, title: d.title } }));
      },
      load: async (c, id) => {
        const def = SETTING_DEF_BY_KEY.get(id);
        if (!def) return null;
        const r = await c.query<{ value: unknown }>('SELECT value FROM game_settings WHERE key = $1', [id]);
        if (!r.rows[0]) return null;
        return { title: def.title, description: def.description, data: { value: r.rows[0].value } };
      },
      fields: (id) => SETTING_DEF_BY_KEY.get(id)?.fields ?? [],
      apply: async (c, id, d, actorId) => {
        await c.query('UPDATE game_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1', [id, JSON.stringify(d.value), actorId]);
      },
      impact: async () => ['Bu ayar tüm sunuculardaki tüm oyuncular için geçerlidir.'],
      events: (id) => {
        const g = SETTING_DEF_BY_KEY.get(id)?.game;
        return g === 'content' ? [{ type: 'content' }] : g === 'social' ? [{ type: 'social-config' }] : [];
      },
    };
  }

  // ================================================================== sürümler
  private adapter(type: ContentType) {
    return this.adapters[type];
  }

  private pick(fields: ContentField[], data: Data): Data {
    let out: Data = {};
    for (const f of fields) out = setPath(out, f.key, getPath(data, f.key) ?? null);
    return out;
  }

  /** Sürümde saklanan veri: ayarlarda değerin tamamı (alan dışı anahtarlar kaybolmasın), diğerlerinde düzenlenebilir alanlar */
  private snapshot(type: ContentType, fields: ContentField[], data: Data): Data {
    return type === 'setting' ? { value: structuredClone(data.value) } : this.pick(fields, data);
  }

  private sameFields(fields: ContentField[], a: Data, b: Data) {
    return diffFields(fields, a, b).length === 0;
  }

  /** Yayındaki sürümü döner; hiç yoksa veya veritabanı doğrudan değiştirildiyse mevcut hali yayındaki sürüm olarak kaydeder. */
  private async ensureBaseline(c: Queryable, type: ContentType, id: string, fields: ContentField[], current: Data): Promise<number> {
    const pub = await c.query<{ id: string; version: number; data: Data }>(
      `SELECT id::text, version, data FROM content_revisions WHERE entity_type = $1 AND entity_id = $2 AND status = 'published' FOR UPDATE`,
      [type, id],
    );
    const p = pub.rows[0];
    if (p && this.sameFields(fields, p.data, current)) return p.version;
    const next = await this.nextVersion(c, type, id);
    if (p) await c.query(`UPDATE content_revisions SET status = 'superseded' WHERE id = $1`, [p.id]);
    await c.query(
      `INSERT INTO content_revisions (entity_type, entity_id, version, base_version, data, status, created_label, created_at, published_at, note)
       VALUES ($1, $2, $3, $4, $5, 'published', 'Sistem', $6, $6, $7)`,
      [type, id, next, p?.version ?? null, JSON.stringify(this.snapshot(type, fields, current)), this.now(), p ? 'Veritabanında doğrudan yapılan değişiklik' : 'İlk durum'],
    );
    return next;
  }

  private async nextVersion(c: Queryable, type: ContentType, id: string) {
    const r = await c.query<{ v: number | null }>('SELECT max(version) AS v FROM content_revisions WHERE entity_type = $1 AND entity_id = $2', [type, id]);
    return (r.rows[0]!.v ?? 0) + 1;
  }

  async list(type: ContentType): Promise<ContentListItem[]> {
    const items = await this.adapter(type).list(this.db);
    const revs = await this.db.query<{ entity_id: string; status: string; id: string; version: number }>(
      `SELECT entity_id, status, id::text, version FROM content_revisions WHERE entity_type = $1 AND status IN ('draft', 'published')`,
      [type],
    );
    const draft = new Map(revs.rows.filter((r) => r.status === 'draft').map((r) => [r.entity_id, Number(r.id)]));
    const ver = new Map(revs.rows.filter((r) => r.status === 'published').map((r) => [r.entity_id, r.version]));
    return items.map((i) => ({ ...i, draftId: draft.get(i.id) ?? null, version: ver.get(i.id) ?? null }));
  }

  async detail(actor: AdminActor, type: ContentType, id: string): Promise<ContentDetail> {
    const a = this.adapter(type);
    const def = CONTENT_TYPE_DEFS[type];
    const cur = await a.load(this.db, id);
    if (!cur) throw notFound('CONTENT_NOT_FOUND', `${def.label}`);
    const fields = a.fields(id);
    const r = await this.db.query<{
      id: string; version: number; base_version: number | null; data: Data; status: RevisionView['status']; created_label: string; created_at: Date; published_at: Date | null; note: string | null; hot_reloadable: boolean;
    }>(
      `SELECT id::text, version, base_version, data, status, created_label, created_at, published_at, note, hot_reloadable
       FROM content_revisions WHERE entity_type = $1 AND entity_id = $2 AND status <> 'discarded' ORDER BY version DESC LIMIT 30`,
      [type, id],
    );
    const rows = r.rows;
    const view = (x: (typeof rows)[number], prev: Data): RevisionView => ({
      id: Number(x.id),
      version: x.version,
      baseVersion: x.base_version,
      status: x.status,
      data: x.data,
      diff: diffFields(fields, prev, x.data),
      createdBy: x.created_label,
      createdAt: x.created_at.toISOString(),
      publishedAt: x.published_at ? x.published_at.toISOString() : null,
      note: x.note,
      hot: x.hot_reloadable,
    });
    const history = rows.filter((x) => x.status !== 'draft');
    const revisions = history.map((x, i) => view(x, history[i + 1]?.data ?? x.data));
    const d = rows.find((x) => x.status === 'draft');
    return {
      type,
      id,
      title: cur.title,
      description: cur.description,
      fields,
      current: this.pick(fields, cur.data),
      draft: d ? view(d, cur.data) : null,
      revisions,
      impact: await a.impact(this.db, id),
      liveNote: def.liveNote,
      can: { write: can(actor, def.write), publish: can(actor, def.publish) && can(actor, def.write), rollback: can(actor, def.rollback) && can(actor, def.write) },
    };
  }

  async draft(actor: AdminActor, type: ContentType, id: string, input: unknown): Promise<ContentDetail> {
    const b = contentDraftSchema.parse(input);
    const a = this.adapter(type);
    await withTransaction(this.db, async (c) => {
      const cur = await a.load(c, id);
      if (!cur) throw notFound('CONTENT_NOT_FOUND', CONTENT_TYPE_DEFS[type].label);
      const fields = a.fields(id);
      const byKey = new Map(fields.map((f) => [f.key, f]));
      let next: Data = this.snapshot(type, fields, cur.data);
      const errors: Record<string, string[]> = {};
      for (const [k, raw] of Object.entries(b.changes)) {
        const f = byKey.get(k);
        if (!f) {
          errors[k] = ['Bu alan düzenlenemez.'];
          continue;
        }
        const v = validateField(f, raw);
        if (!v.ok) errors[k] = [v.message];
        else next = setPath(next, k, v.value);
      }
      if (Object.keys(errors).length) throw new AppError('VALIDATION_ERROR', 400, 'Gönderilen değerler geçersiz.', { fields: errors });
      const cross = await a.check?.(c, id, next);
      if (cross) throw new AppError('VALIDATION_ERROR', 400, cross, { fields: { _: [cross] } });
      if (diffFields(fields, cur.data, next).length === 0) throw new AppError('NO_CHANGES', 400, 'Yayındaki değerlerden farklı bir değişiklik yok.');
      const base = await this.ensureBaseline(c, type, id, fields, cur.data);
      await c.query(`UPDATE content_revisions SET status = 'discarded' WHERE entity_type = $1 AND entity_id = $2 AND status = 'draft'`, [type, id]);
      const version = await this.nextVersion(c, type, id);
      const r = await c.query<{ id: string }>(
        `INSERT INTO content_revisions (entity_type, entity_id, version, base_version, data, status, created_by, created_label, created_at, note)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9) RETURNING id::text`,
        [type, id, version, base, JSON.stringify(this.snapshot(type, fields, next)), actor.userId, actor.label, this.now(), b.note ?? null],
      );
      await audit(c, actor, { action: 'content.draft', targetType: type, targetId: id, after: { revisionId: Number(r.rows[0]!.id), version, diff: diffFields(fields, cur.data, next) }, reason: b.note ?? null });
    });
    return this.detail(actor, type, id);
  }

  private async lockRevision(c: Queryable, type: ContentType, rid: number) {
    const r = await c.query<{ id: string; entity_id: string; version: number; base_version: number | null; data: Data; status: string; note: string | null }>(
      `SELECT id::text, entity_id, version, base_version, data, status, note FROM content_revisions WHERE id = $1 AND entity_type = $2 FOR UPDATE`,
      [rid, type],
    );
    if (!r.rows[0]) throw notFound('CONTENT_NOT_FOUND', 'Sürüm');
    return r.rows[0];
  }

  private async lockPublished(c: Queryable, type: ContentType, id: string) {
    const r = await c.query<{ id: string; version: number; data: Data }>(
      `SELECT id::text, version, data FROM content_revisions WHERE entity_type = $1 AND entity_id = $2 AND status = 'published' FOR UPDATE`,
      [type, id],
    );
    return r.rows[0] ?? null;
  }

  private conflict() {
    return new AppError('REVISION_CONFLICT', 409, 'Bu kayıt sen taslağı hazırlarken değişti (başka bir yayın veya geri alma yapıldı). Güncel değerlerle yeni bir taslak oluştur.');
  }

  async publish(actor: AdminActor, type: ContentType, rid: number): Promise<ContentDetail> {
    const a = this.adapter(type);
    let entityId = '';
    let events: AdminGameEvent[] = [];
    await withTransaction(this.db, async (c) => {
      const rev = await this.lockRevision(c, type, rid);
      entityId = rev.entity_id;
      if (rev.status !== 'draft') throw new AppError('VALIDATION_ERROR', 409, 'Yalnızca taslak yayımlanabilir.');
      const pub = await this.lockPublished(c, type, rev.entity_id);
      if (!pub || pub.version !== rev.base_version) throw this.conflict();
      const cur = await a.load(c, rev.entity_id);
      if (!cur) throw notFound('CONTENT_NOT_FOUND', CONTENT_TYPE_DEFS[type].label);
      const fields = a.fields(rev.entity_id);
      if (!this.sameFields(fields, pub.data, cur.data)) throw this.conflict();
      const cross = await a.check?.(c, rev.entity_id, rev.data);
      if (cross) throw new AppError('VALIDATION_ERROR', 400, cross);
      await a.apply(c, rev.entity_id, rev.data, actor.userId).catch((err: unknown) => mapDbError(err, 'Değerler veritabanı kurallarına uymuyor; taslağı düzeltip tekrar dene.'));
      const now = this.now();
      await c.query(`UPDATE content_revisions SET status = 'superseded' WHERE id = $1`, [pub.id]);
      await c.query(`UPDATE content_revisions SET status = 'published', published_by = $2, published_at = $3 WHERE id = $1`, [rid, actor.userId, now]);
      await audit(c, actor, {
        action: 'content.publish',
        targetType: type,
        targetId: rev.entity_id,
        before: { version: pub.version, values: this.pick(fields, cur.data) },
        after: { version: rev.version, values: rev.data, diff: diffFields(fields, cur.data, rev.data) },
        reason: rev.note,
      });
      events = a.events(rev.entity_id, rev.data);
    });
    for (const e of events) await this.bridge.publishAdmin(e);
    if (type === 'quest') this.onQuestChange?.();
    return this.detail(actor, type, entityId);
  }

  /** rid: geri dönülecek eski sürüm. Onun verisi yeni bir yayın sürümü olarak uygulanır; yayındaki sürüm "geri alındı" olur. */
  async rollback(actor: AdminActor, type: ContentType, rid: number, input: { reason?: string }): Promise<ContentDetail> {
    const a = this.adapter(type);
    let entityId = '';
    let events: AdminGameEvent[] = [];
    await withTransaction(this.db, async (c) => {
      const target = await this.lockRevision(c, type, rid);
      entityId = target.entity_id;
      if (target.status === 'draft' || target.status === 'discarded') throw new AppError('VALIDATION_ERROR', 409, 'Taslağa geri dönülemez; yalnızca daha önce yayımlanmış bir sürüm seçilebilir.');
      const pub = await this.lockPublished(c, type, target.entity_id);
      if (!pub) throw this.conflict();
      if (pub.id === target.id) throw new AppError('VALIDATION_ERROR', 409, 'Bu sürüm zaten yayında.');
      const cur = await a.load(c, target.entity_id);
      if (!cur) throw notFound('CONTENT_NOT_FOUND', CONTENT_TYPE_DEFS[type].label);
      const fields = a.fields(target.entity_id);
      if (!this.sameFields(fields, pub.data, cur.data)) throw this.conflict();
      await a.apply(c, target.entity_id, type === 'setting' ? target.data : { ...cur.data, ...target.data }, actor.userId).catch((err: unknown) =>
        mapDbError(err, 'Eski sürüm artık veritabanı kurallarına uymuyor; geri alınamadı.'),
      );
      const now = this.now();
      const version = await this.nextVersion(c, type, target.entity_id);
      await c.query(`UPDATE content_revisions SET status = 'rolled_back' WHERE id = $1`, [pub.id]);
      await c.query(`UPDATE content_revisions SET status = 'discarded' WHERE entity_type = $1 AND entity_id = $2 AND status = 'draft'`, [type, target.entity_id]);
      const note = `Sürüm ${target.version} geri yüklendi${input.reason ? `: ${input.reason}` : ''}`.slice(0, 300);
      await c.query(
        `INSERT INTO content_revisions (entity_type, entity_id, version, base_version, data, status, created_by, created_label, published_by, created_at, published_at, note)
         VALUES ($1, $2, $3, $4, $5, 'published', $6, $7, $6, $8, $8, $9)`,
        [type, target.entity_id, version, pub.version, JSON.stringify(target.data), actor.userId, actor.label, now, note],
      );
      await audit(c, actor, {
        action: 'content.rollback',
        targetType: type,
        targetId: target.entity_id,
        before: { version: pub.version, values: this.pick(fields, cur.data) },
        after: { version, restoredVersion: target.version, values: target.data },
        reason: input.reason ?? null,
      });
      events = a.events(target.entity_id, target.data);
    });
    for (const e of events) await this.bridge.publishAdmin(e);
    if (type === 'quest') this.onQuestChange?.();
    return this.detail(actor, type, entityId);
  }

  async discard(actor: AdminActor, type: ContentType, rid: number): Promise<ContentDetail> {
    let entityId = '';
    await withTransaction(this.db, async (c) => {
      const rev = await this.lockRevision(c, type, rid);
      entityId = rev.entity_id;
      if (rev.status !== 'draft') throw new AppError('VALIDATION_ERROR', 409, 'Yalnızca taslak silinebilir.');
      await c.query(`UPDATE content_revisions SET status = 'discarded' WHERE id = $1`, [rid]);
      await audit(c, actor, { action: 'content.discard', targetType: type, targetId: rev.entity_id, after: { revisionId: rid, version: rev.version } });
    });
    return this.detail(actor, type, entityId);
  }

  // ================================================================== yeni görev
  /** Görev yayımlanmadan oluşturulur (oyuncular görmez); yayın, içerik sürümleme ile "Yayında" alanı açılarak yapılır. */
  async createQuest(actor: AdminActor, input: unknown): Promise<{ id: number }> {
    const q = adminQuestCreateSchema.parse(input);
    return withTransaction(this.db, async (c) => {
      const taken = await c.query('SELECT 1 FROM quests WHERE code = $1', [q.code]);
      if (taken.rowCount) throw new AppError('QUEST_CODE_TAKEN', 409, 'Bu görev kodu zaten kullanılıyor.', { fields: { code: ['Bu kod kullanılıyor.'] } });
      const rt = await c.query<{ id: number }>('INSERT INTO reward_tables (code, name) VALUES ($1, $2) RETURNING id', [`quest.admin-${q.code}`, `${q.title} ödülü`]);
      const tableId = rt.rows[0]!.id;
      const entries: Array<[string, string, number]> = [];
      if (q.reward.credits) entries.push(['currency', 'KREDI', q.reward.credits]);
      if (q.reward.experience) entries.push(['experience', 'XP', q.reward.experience]);
      if (q.reward.honor) entries.push(['honor', 'HONOR', q.reward.honor]);
      for (const [t, code, n] of entries) {
        await c.query(
          `INSERT INTO reward_entries (reward_table_id, reward_type, ref_code, min_amount, max_amount, chance, delivery) VALUES ($1, $2, $3, $4, $4, 1, 'direct')`,
          [tableId, t, code, n],
        );
      }
      const r = await c.query<{ id: number }>(
        `INSERT INTO quests (code, category, title, description, min_level, reward_table_id, starts_at, ends_at, sort_order, is_published)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 9000, false) RETURNING id`,
        [q.code, q.category, q.title, q.description, q.minLevel, tableId, q.startsAt ?? null, q.endsAt ?? null],
      ).catch((err: unknown) => mapDbError(err, 'Görev bilgileri veritabanı kurallarına uymuyor.'));
      const id = r.rows[0]!.id;
      await c.query(`INSERT INTO quest_objectives (quest_id, sort_order, objective_type, params, target, label) VALUES ($1, 1, $2, $3, $4, $5)`, [
        id, q.objective.type, JSON.stringify(q.objective.params), q.objective.target, q.objective.label,
      ]);
      await audit(c, actor, { action: 'quest.create', targetType: 'quest', targetId: String(id), after: { code: q.code, category: q.category, title: q.title, objective: q.objective, reward: q.reward, published: false } });
      return { id };
    });
  }
}
