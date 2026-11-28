/**
 * Yönetim Merkezi ortak kuralları (Aşama 14): istek şemaları, içerik türleri ve düzenlenebilir alanlar,
 * ayar kayıtları, fark hesabı ve API görünüm tipleri.
 *
 * Yetkiler YALNIZCA sunucuda denetlenir. Buradaki izin adları arayüzün menüyü gizlemesi içindir.
 */
import { z } from 'zod';
import { ROLES, type PermissionKey, type RoleKey } from './roles.js';

const reason = z.string().trim().min(3, 'Gerekçe en az 3 karakter olmalı.').max(500, 'Gerekçe en fazla 500 karakter olabilir.');

// ------------------------------------------------------------------ yaptırımlar
export const SANCTION_KINDS = ['warning', 'mute', 'suspension', 'ban', 'lock'] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];
export const SANCTION_LABELS: Record<SanctionKind, string> = {
  warning: 'Uyarı',
  mute: 'Susturma',
  suspension: 'Askıya alma',
  ban: 'Kalıcı ban',
  lock: 'Hesap kilidi',
};
/** Süre isteyen yaptırımlar */
export const TIMED_SANCTIONS: readonly SanctionKind[] = ['mute', 'suspension', 'lock'];
/** Her yaptırımı vermek için gereken yetki */
export const SANCTION_PERMISSION: Record<SanctionKind, PermissionKey> = {
  warning: 'players.warn',
  mute: 'chat.moderate',
  suspension: 'players.ban',
  ban: 'players.ban',
  lock: 'players.lock',
};
/** Kaldırmak için gereken yetki (uyarı kaldırılmaz, geçmişte kalır) */
export const SANCTION_REVOKE_PERMISSION: Record<Exclude<SanctionKind, 'warning'>, PermissionKey> = {
  mute: 'chat.moderate',
  suspension: 'players.unban',
  ban: 'players.unban',
  lock: 'players.lock',
};

export const adminSanctionSchema = z
  .strictObject({
    kind: z.enum(SANCTION_KINDS),
    reason,
    publicReason: z.string().trim().max(300).optional(),
    /** saat: susturma, askı ve kilit için zorunlu (en fazla 1 yıl) */
    hours: z.number().int().min(1).max(8760).optional(),
    reportId: z.number().int().positive().optional(),
  })
  .superRefine((v, ctx) => {
    const timed = TIMED_SANCTIONS.includes(v.kind);
    if (timed && !v.hours) ctx.addIssue({ code: 'custom', path: ['hours'], message: 'Bu yaptırım için süre zorunlu.' });
    if (!timed && v.hours) ctx.addIssue({ code: 'custom', path: ['hours'], message: 'Bu yaptırım süresizdir.' });
  });
export const adminReasonSchema = z.strictObject({ reason });

// ------------------------------------------------------------------ para / eşya verme
export const adminGrantSchema = z.strictObject({
  playerId: z.string().uuid('Geçersiz pilot.'),
  kind: z.enum(['currency', 'item']),
  code: z.string().regex(/^[A-Za-z0-9_.-]{2,40}$/, 'Geçersiz kod.'),
  amount: z.number().int().min(1, 'Miktar en az 1 olmalı.').max(1_000_000_000),
  reason,
});

// ------------------------------------------------------------------ roller
export const adminRoleChangeSchema = z.strictObject({
  role: z.enum(ROLES).refine((r) => r !== 'player', '"Oyuncu" rolü varsayılandır; atanamaz veya kaldırılamaz.'),
  grant: z.boolean(),
  reason,
});

// ------------------------------------------------------------------ onaylar
export const APPROVAL_ACTIONS = ['economy.grant', 'player.ban.permanent', 'role.grant.super_admin'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export const APPROVAL_ACTION_LABELS: Record<ApprovalAction, string> = {
  'economy.grant': 'Para / eşya verme',
  'player.ban.permanent': 'Kalıcı ban',
  'role.grant.super_admin': 'Süper Yönetici ataması',
};
/** Onaylayabilmek için gereken yetki (approvals.review her işlemi onaylayabilir). Talep eden kendi talebini onaylayamaz. */
export const APPROVAL_PERMISSION: Record<ApprovalAction, PermissionKey> = {
  'economy.grant': 'economy.grant',
  'player.ban.permanent': 'players.ban',
  'role.grant.super_admin': 'approvals.review',
};
export const adminReviewSchema = z.strictObject({ approve: z.boolean(), note: z.string().trim().max(500).optional() });

// ------------------------------------------------------------------ şikâyetler
export const REPORT_STATUSES = ['open', 'in_review', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: 'Açık',
  in_review: 'İnceleniyor',
  actioned: 'İşlem yapıldı',
  dismissed: 'Reddedildi',
};
export const REPORT_TARGET_LABELS: Record<string, string> = {
  player: 'Pilot',
  chat_message: 'Sohbet mesajı',
  clan: 'Klan',
  forum_post: 'Forum mesajı',
  forum_thread: 'Forum konusu',
};
export const adminReportResolveSchema = z.strictObject({
  status: z.enum(['in_review', 'actioned', 'dismissed']),
  note: z.string().trim().max(500).optional(),
});

// ------------------------------------------------------------------ sistem
export const adminMaintenanceSchema = z.strictObject({
  enabled: z.boolean(),
  message: z.string().trim().min(5, 'Mesaj en az 5 karakter olmalı.').max(200),
  reason,
});
export const adminBroadcastSchema = z.strictObject({
  text: z.string().trim().min(3, 'Duyuru en az 3 karakter olmalı.').max(200, 'Duyuru en fazla 200 karakter olabilir.'),
  reason,
});

// ------------------------------------------------------------------ içerik ve ayarlar
export const CONTENT_TYPES = ['npc_type', 'ship_type', 'shop_offer', 'quest', 'map', 'setting'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export type FieldKind = 'int' | 'number' | 'text' | 'longtext' | 'bool' | 'datetime' | 'list';
export interface ContentField {
  /** veri anahtarı; ayarlarda iç içe yol ("value.cost.amount") */
  key: string;
  label: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  step?: number;
  minLength?: number;
  maxLength?: number;
  nullable?: boolean;
  help?: string;
}

export interface ContentTypeDef {
  type: ContentType;
  label: string;
  plural: string;
  read: PermissionKey;
  write: PermissionKey;
  publish: PermissionKey;
  rollback: PermissionKey;
  /** ayar dışındaki türlerde alanlar sabittir; ayarlarda anahtara göre SETTING_DEFS'ten gelir */
  fields: ContentField[];
  /** listede gösterilecek sütunlar */
  columns: string[];
  /** yayının oyuna nasıl yansıdığı (önizlemede gösterilir) */
  liveNote: string;
}

const int = (key: string, label: string, min: number, max: number, extra: Partial<ContentField> = {}): ContentField => ({ key, label, kind: 'int', min, max, ...extra });

export const CONTENT_TYPE_DEFS: Record<ContentType, ContentTypeDef> = {
  npc_type: {
    type: 'npc_type',
    label: 'NPC',
    plural: 'NPC türleri',
    read: 'npcs.read',
    write: 'npcs.write',
    publish: 'content.publish',
    rollback: 'content.rollback',
    fields: [
      { key: 'name', label: 'Ad', kind: 'text', minLength: 2, maxLength: 40 },
      int('hitpoints', 'Can', 1, 10_000_000),
      int('shield', 'Kalkan', 0, 10_000_000),
      { key: 'shield_absorb', label: 'Kalkan emme oranı', kind: 'number', min: 0, max: 1, step: 0.05 },
      int('damage', 'Hasar', 0, 1_000_000),
      int('attack_rate_ms', 'Atış aralığı (ms)', 250, 20_000),
      int('attack_range', 'Atış menzili', 50, 3000),
      int('speed', 'Hız', 1, 1000),
      int('experience', 'Deneyim ödülü', 0, 10_000_000),
      int('honor', 'Şeref ödülü', 0, 1_000_000),
    ],
    columns: ['code', 'name', 'level', 'hitpoints', 'shield', 'damage'],
    liveNote: 'Yayınlanınca oyun sunucuları anında yeniden yükler: yeni doğan NPC yeni değerlerle doğar, yaşayan NPC\'lerin canı ve kalkanı oranı korunarak ölçeklenir.',
  },
  ship_type: {
    type: 'ship_type',
    label: 'Gemi',
    plural: 'Gemiler',
    read: 'ships.read',
    write: 'ships.write',
    publish: 'content.publish',
    rollback: 'content.rollback',
    fields: [
      { key: 'name', label: 'Ad', kind: 'text', minLength: 2, maxLength: 40 },
      { key: 'description', label: 'Açıklama', kind: 'longtext', maxLength: 500, nullable: true },
      int('hitpoints', 'Taban can', 1, 10_000_000),
      int('base_speed', 'Taban hız', 50, 1000),
      int('cargo_capacity', 'Ambar kapasitesi', 0, 100_000),
      int('min_level', 'Gereken seviye', 1, 50),
      { key: 'is_for_sale', label: 'Satışta', kind: 'bool' },
    ],
    columns: ['code', 'name', 'hitpoints', 'base_speed', 'cargo_capacity', 'is_for_sale'],
    liveNote: 'Yayınlanınca bu gemiyi kullanan çevrimiçi pilotların hız, can ve ambar değerleri anında yeniden hesaplanır; hangar ve mağaza bir sonraki istekte yeni değeri gösterir.',
  },
  shop_offer: {
    type: 'shop_offer',
    label: 'Mağaza ürünü',
    plural: 'Mağaza',
    read: 'economy.read',
    write: 'economy.write',
    publish: 'content.publish',
    rollback: 'content.rollback',
    fields: [
      int('price', 'Fiyat', 0, 1_000_000_000_000),
      int('discount_percent', 'İndirim (%)', 0, 90),
      { key: 'discount_ends_at', label: 'İndirim bitişi', kind: 'datetime', nullable: true },
      int('max_per_purchase', 'Tek seferde en fazla', 1, 1000),
      int('per_player_limit', 'Pilot başına sınır', 1, 1_000_000, { nullable: true }),
      { key: 'is_active', label: 'Satışta', kind: 'bool' },
    ],
    columns: ['title', 'category', 'currency', 'price', 'discount_percent', 'is_active'],
    liveNote: 'Mağaza her istekte veritabanından okunur: yeni fiyat bir sonraki mağaza listelemesinde ve satın almada geçerlidir.',
  },
  quest: {
    type: 'quest',
    label: 'Görev',
    plural: 'Görevler',
    read: 'quests.read',
    write: 'quests.write',
    publish: 'content.publish',
    rollback: 'content.rollback',
    fields: [
      { key: 'title', label: 'Başlık', kind: 'text', minLength: 3, maxLength: 80 },
      { key: 'description', label: 'Açıklama', kind: 'longtext', minLength: 3, maxLength: 600 },
      { key: 'is_published', label: 'Yayında (oyuncular görür)', kind: 'bool' },
      { key: 'starts_at', label: 'Başlangıç', kind: 'datetime', nullable: true, help: 'Etkinlik görevlerinde zorunlu' },
      { key: 'ends_at', label: 'Bitiş', kind: 'datetime', nullable: true, help: 'Etkinlik görevlerinde zorunlu' },
      int('min_level', 'En düşük seviye', 1, 50),
      int('max_level', 'En yüksek seviye', 1, 50, { nullable: true }),
    ],
    columns: ['code', 'category', 'title', 'min_level', 'is_published'],
    liveNote: 'Görev listesi her istekte veritabanından okunur: yayınlanan görev oyuncunun görev ekranında bir sonraki listelemede görünür.',
  },
  map: {
    type: 'map',
    label: 'Harita',
    plural: 'Haritalar',
    read: 'maps.read',
    write: 'maps.write',
    publish: 'content.publish',
    rollback: 'content.rollback',
    fields: [
      { key: 'name', label: 'Ad', kind: 'text', minLength: 2, maxLength: 40 },
      int('min_level', 'Giriş seviyesi', 1, 50),
      { key: 'pvp_enabled', label: 'PvP açık', kind: 'bool' },
      { key: 'is_closed', label: 'Bakımda (kapalı)', kind: 'bool', help: 'Kapatılınca içerideki pilotlar şirket haritasına taşınır' },
      { key: 'closed_reason', label: 'Kapanış sebebi', kind: 'text', maxLength: 120, nullable: true },
    ],
    columns: ['code', 'name', 'min_level', 'pvp_enabled', 'is_closed'],
    liveNote: 'Kapatılan haritadaki pilotlar birkaç saniye içinde şirket haritasına taşınır; PvP ayarı açık odaya anında uygulanır; giriş seviyesi bir sonraki geçitte denetlenir.',
  },
  setting: {
    type: 'setting',
    label: 'Ayar',
    plural: 'Oyun ayarları',
    read: 'settings.read',
    write: 'settings.write',
    publish: 'settings.write',
    rollback: 'settings.write',
    fields: [],
    columns: ['key', 'title'],
    liveNote: 'Ayarlar her istekte veritabanından okunur; oyun sunucusunu ilgilendiren ayarlar (savaş, sohbet, sosyal) yayında oyun sunucularına da bildirilir.',
  },
};

export interface SettingDef {
  key: string;
  title: string;
  description: string;
  fields: ContentField[];
  /** oyun sunucusu bu ayarı bellekte tutuyorsa yayında yeniden yüklemesi istenir */
  game?: 'content' | 'social';
}
const v = (path: string) => `value.${path}`;
export const SETTING_DEFS: SettingDef[] = [
  { key: 'registration.enabled', title: 'Kayıt', description: 'Yeni hesap kaydı açık mı?', fields: [{ key: 'value', label: 'Kayıt açık', kind: 'bool' }] },
  {
    key: 'starter.currencies',
    title: 'Başlangıç paraları',
    description: 'Yeni pilota verilen para.',
    fields: [int(v('KREDI'), 'Kredi', 0, 100_000_000), int(v('AKCE'), 'Akçe', 0, 1_000_000)],
  },
  {
    key: 'company.change',
    title: 'Şirket değiştirme',
    description: 'Bekleme süresi ve ücret.',
    fields: [int(v('cooldown_days'), 'Bekleme (gün)', 0, 365), int(v('cost.amount'), 'Ücret (Akçe)', 0, 1_000_000)],
  },
  { key: 'repair', title: 'Tamir', description: 'Tamir ücreti.', fields: [int(v('per_1000_hp'), '1.000 can başına Kredi', 0, 1_000_000)] },
  { key: 'inventory', title: 'Envanter', description: 'Envanter sınırı.', fields: [int(v('max_items'), 'En fazla eşya satırı', 10, 10_000)] },
  {
    key: 'quests',
    title: 'Görevler',
    description: 'Günlük/haftalık görev sayıları.',
    fields: [
      int(v('max_active'), 'Aynı anda aktif görev', 1, 50),
      int(v('daily_count'), 'Günlük görev sayısı', 0, 10),
      int(v('weekly_count'), 'Haftalık görev sayısı', 0, 10),
      int(v('daily_rerolls'), 'Günlük yeniden çekme', 0, 10),
      int(v('weekly_rerolls'), 'Haftalık yeniden çekme', 0, 10),
    ],
  },
  {
    key: 'combat',
    title: 'Savaş',
    description: 'PvP şerefi ve hasar dalgalanması.',
    game: 'content',
    fields: [
      int(v('pvp_honor'), 'PvP şeref ödülü', 0, 100_000),
      { key: v('damage_variance'), label: 'Hasar dalgalanması', kind: 'number', min: 0, max: 0.5, step: 0.01 },
      int(v('repair_delay_ms'), 'Savaş sonrası tamir gecikmesi (ms)', 0, 120_000),
    ],
  },
  {
    key: 'chat',
    title: 'Sohbet',
    description: 'Mesaj uzunluğu, hız sınırı ve yasaklı kelimeler.',
    game: 'social',
    fields: [
      int(v('max_length'), 'Mesaj uzunluğu', 20, 300),
      int(v('rate_count'), '10 sn\'de en fazla mesaj', 1, 30),
      int(v('history'), 'Geçmişte gösterilen mesaj', 10, 200),
      { key: v('banned_words'), label: 'Yasaklı kelimeler (her satıra bir)', kind: 'list', maxLength: 40 },
    ],
  },
  {
    key: 'clan',
    title: 'Klan',
    description: 'Kurma ücreti ve sınırlar.',
    fields: [
      int(v('create_cost.amount'), 'Kurma ücreti (Kredi)', 0, 100_000_000),
      int(v('create_min_level'), 'Kurma seviyesi', 1, 50),
      int(v('max_members'), 'En fazla üye', 2, 500),
    ],
  },
  {
    key: 'social',
    title: 'Sosyal',
    description: 'Grup ve arkadaş sınırları.',
    game: 'social',
    fields: [int(v('party_max'), 'Grup üyesi', 2, 16), int(v('max_friends'), 'Arkadaş', 10, 1000), int(v('max_blocks'), 'Engel', 10, 5000)],
  },
  {
    key: 'forum',
    title: 'Forum',
    description: 'Sayfalama ve düzenleme süresi.',
    fields: [
      int(v('threads_per_page'), 'Sayfa başına konu', 5, 100),
      int(v('posts_per_page'), 'Sayfa başına mesaj', 5, 100),
      int(v('edit_window_minutes'), 'Düzenleme süresi (dk)', 0, 43_200),
    ],
  },
  {
    key: 'support',
    title: 'Destek',
    description: 'Talep ve ek dosya sınırları.',
    fields: [
      int(v('max_open_tickets'), 'Açık talep sınırı', 1, 50),
      int(v('auto_close_days'), 'Çözülen talep kapanma (gün)', 1, 90),
      int(v('max_attachment_bytes'), 'Ek boyutu (bayt, en fazla 10 MB)', 1024, 10_485_760),
      int(v('max_attachments_per_message'), 'Mesaj başına ek', 0, 10),
      int(v('attach_window_minutes'), 'Ek ekleme süresi (dk)', 1, 1440),
    ],
  },
  {
    key: 'auction',
    title: 'Açık artırma',
    description: 'Artış ve son saniye uzatması.',
    fields: [
      int(v('min_increment'), 'En az artış', 1, 1_000_000),
      int(v('min_increment_pct'), 'En az artış (%)', 0, 100),
      int(v('extend_seconds'), 'Uzatma (sn)', 0, 600),
    ],
  },
  {
    key: 'admin',
    title: 'Yönetim eşikleri',
    description: 'Bu tutarların üstündeki para/eşya verme işlemleri ikinci bir yetkilinin onayını ister.',
    fields: [
      int(v('grant_approval_threshold.KREDI'), 'Kredi eşiği', 0, 1_000_000_000),
      int(v('grant_approval_threshold.AKCE'), 'Akçe eşiği', 0, 100_000_000),
      int(v('grant_item_approval_threshold'), 'Eşya adedi eşiği', 0, 100_000),
      int(v('approval_hours'), 'Onay süresi (saat)', 1, 720),
    ],
  },
];
export const SETTING_DEF_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));

// ------------------------------------------------------------------ yol ve fark yardımcıları
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
export function setPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const out: Record<string, unknown> = structuredClone(obj);
  const keys = path.split('.');
  let cur = out;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    const next = cur[k];
    cur[k] = next !== null && typeof next === 'object' && !Array.isArray(next) ? { ...(next as Record<string, unknown>) } : {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
  return out as T;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface FieldDiff {
  key: string;
  label: string;
  before: unknown;
  after: unknown;
}
/** Yalnızca tanımlı alanlar karşılaştırılır. */
export function diffFields(fields: ContentField[], before: unknown, after: unknown): FieldDiff[] {
  return fields
    .filter((f) => !same(getPath(before, f.key), getPath(after, f.key)))
    .map((f) => ({ key: f.key, label: f.label, before: getPath(before, f.key) ?? null, after: getPath(after, f.key) ?? null }));
}

/** Alan tanımına göre tek değeri doğrular ve normalleştirir; hata varsa Türkçe mesaj döner. */
export function validateField(f: ContentField, raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw === null || raw === undefined || raw === '') {
    if (f.nullable) return { ok: true, value: null };
    if (f.kind === 'bool') return { ok: false, message: `${f.label}: değer seçilmeli.` };
    if (f.kind === 'list') return { ok: true, value: [] };
    return { ok: false, message: `${f.label} boş olamaz.` };
  }
  switch (f.kind) {
    case 'int':
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return { ok: false, message: `${f.label} sayı olmalı.` };
      if (f.kind === 'int' && !Number.isInteger(n)) return { ok: false, message: `${f.label} tam sayı olmalı.` };
      if (f.min !== undefined && n < f.min) return { ok: false, message: `${f.label} en az ${f.min.toLocaleString('tr-TR')} olmalı.` };
      if (f.max !== undefined && n > f.max) return { ok: false, message: `${f.label} en fazla ${f.max.toLocaleString('tr-TR')} olabilir.` };
      return { ok: true, value: n };
    }
    case 'bool':
      if (typeof raw !== 'boolean') return { ok: false, message: `${f.label}: evet/hayır olmalı.` };
      return { ok: true, value: raw };
    case 'text':
    case 'longtext': {
      if (typeof raw !== 'string') return { ok: false, message: `${f.label} metin olmalı.` };
      const s = f.kind === 'text' ? raw.trim().replace(/\s+/g, ' ') : raw.replace(/\r\n?/g, '\n').trim();
      if (!s && f.nullable) return { ok: true, value: null };
      if (f.minLength !== undefined && s.length < f.minLength) return { ok: false, message: `${f.label} en az ${f.minLength} karakter olmalı.` };
      if (f.maxLength !== undefined && s.length > f.maxLength) return { ok: false, message: `${f.label} en fazla ${f.maxLength} karakter olabilir.` };
      return { ok: true, value: s };
    }
    case 'datetime': {
      const d = typeof raw === 'string' ? new Date(raw) : null;
      if (!d || Number.isNaN(d.getTime())) return { ok: false, message: `${f.label} geçerli bir tarih olmalı.` };
      return { ok: true, value: d.toISOString() };
    }
    case 'list': {
      const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('\n') : null;
      if (!arr || arr.some((x) => typeof x !== 'string')) return { ok: false, message: `${f.label} metin listesi olmalı.` };
      const items = [...new Set(arr.map((x) => String(x).trim().toLocaleLowerCase('tr-TR')).filter(Boolean))];
      if (items.length > 500) return { ok: false, message: `${f.label} en fazla 500 öğe olabilir.` };
      if (f.maxLength !== undefined && items.some((x) => x.length > f.maxLength!)) return { ok: false, message: `${f.label}: her öğe en fazla ${f.maxLength} karakter.` };
      return { ok: true, value: items };
    }
  }
}

export const contentDraftSchema = z.strictObject({
  /** alan anahtarı → yeni değer (yalnızca değişenler) */
  changes: z.record(z.string().max(80), z.unknown()).refine((o) => Object.keys(o).length > 0 && Object.keys(o).length <= 40, 'En az bir değişiklik gerekli.'),
  note: z.string().trim().max(300).optional(),
});

/** Yeni etkinlik görevi (yayımlanmadan oluşturulur; yayın içerik sürümleme ile yapılır). */
export const QUEST_CREATE_OBJECTIVES = ['kill_npc', 'visit_map', 'collect_cargo', 'deal_damage', 'travel_distance', 'jump_portal'] as const;
export const adminQuestCreateSchema = z.strictObject({
  code: z.string().regex(/^[a-z0-9_]{3,40}$/, 'Kod küçük harf, rakam ve alt çizgi olmalı (3–40).'),
  category: z.enum(['event', 'main']),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(3).max(600),
  minLevel: z.number().int().min(1).max(50),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  objective: z.strictObject({
    type: z.enum(QUEST_CREATE_OBJECTIVES),
    target: z.number().int().min(1).max(1_000_000),
    label: z.string().trim().min(3).max(80),
    /** ör. {"npc":["cakal"]} veya {"maps":["{c}-2"]} */
    params: z.record(z.string().max(20), z.array(z.string().max(40)).max(10)).default({}),
  }),
  reward: z.strictObject({
    credits: z.number().int().min(0).max(10_000_000).default(0),
    experience: z.number().int().min(0).max(10_000_000).default(0),
    honor: z.number().int().min(0).max(1_000_000).default(0),
  }),
}).superRefine((q, ctx) => {
  if (q.category === 'event') {
    if (!q.startsAt || !q.endsAt) ctx.addIssue({ code: 'custom', path: ['startsAt'], message: 'Etkinlik görevinde başlangıç ve bitiş zorunlu.' });
    else if (new Date(q.endsAt) <= new Date(q.startsAt)) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Bitiş başlangıçtan sonra olmalı.' });
  }
  if (q.reward.credits + q.reward.experience + q.reward.honor === 0) ctx.addIssue({ code: 'custom', path: ['reward'], message: 'En az bir ödül gerekli.' });
});

// ------------------------------------------------------------------ görünüm tipleri
export interface AuditEntryView {
  id: number;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  result: 'success' | 'failure' | 'pending_approval';
  ip: string | null;
  at: string;
}

export interface GameNodeStatus {
  id: string;
  startedAt: string;
  at: string;
  connections: number;
  players: number;
  rooms: number;
  npcs: number;
  tickMs: number;
  rssMb: number;
  maps: Record<string, number>;
}

export interface AdminDashboard {
  players: { total: number; registeredToday: number; registered7d: number; pilots: number; online: number };
  maps: Array<{ code: string; name: string; online: number }>;
  nodes: GameNodeStatus[];
  api: { uptimeSec: number; rssMb: number; dbMs: number; redisMs: number };
  queues: { openTickets: number | null; openReports: number | null; pendingApprovals: number };
  platforms: Array<{ platform: string; sessions: number }>;
  maintenance: { enabled: boolean; message: string };
  recentAudit: AuditEntryView[] | null;
}

export interface SanctionView {
  id: number;
  kind: SanctionKind;
  reason: string;
  publicReason: string | null;
  startsAt: string;
  endsAt: string | null;
  issuedBy: string;
  active: boolean;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export interface AdminPlayerSummary {
  userId: string;
  publicId: number;
  username: string;
  email: string;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  roles: RoleKey[];
  createdAt: string;
  pilots: Array<{ id: string; name: string; server: string; level: number; online: boolean }>;
}

export interface AdminPlayerDetail extends AdminPlayerSummary {
  emailVerified: boolean;
  suspendedUntil: string | null;
  lockedUntil: string | null;
  statusReason: string | null;
  mutedUntil: string | null;
  sanctions: SanctionView[];
  sessions: Array<{ id: string; platform: string; browser: string | null; os: string | null; ip: string | null; createdAt: string; lastSeenAt: string }>;
  logins: Array<{ success: boolean; reason: string | null; platform: string; ip: string | null; at: string }>;
  pilotDetails: Array<{
    id: string;
    name: string;
    server: string;
    company: string;
    level: number;
    experience: number;
    honor: number;
    map: string | null;
    online: boolean;
    clan: string | null;
    wallets: Record<string, number>;
    ship: string | null;
    items: number;
    activeQuests: number;
  }>;
}

export interface FieldValueRow {
  key: string;
  label: string;
  kind: FieldKind;
  value: unknown;
}

export interface RevisionView {
  id: number;
  version: number;
  baseVersion: number | null;
  status: 'draft' | 'published' | 'superseded' | 'rolled_back' | 'discarded';
  data: Record<string, unknown>;
  diff: FieldDiff[];
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  note: string | null;
  hot: boolean;
}

export interface ContentListItem {
  id: string;
  title: string;
  columns: Record<string, unknown>;
  draftId: number | null;
  version: number | null;
}

export interface ContentDetail {
  type: ContentType;
  id: string;
  title: string;
  description: string | null;
  fields: ContentField[];
  current: Record<string, unknown>;
  draft: RevisionView | null;
  revisions: RevisionView[];
  impact: string[];
  liveNote: string;
  can: { write: boolean; publish: boolean; rollback: boolean };
}

export interface ApprovalView {
  id: number;
  action: ApprovalAction;
  summary: string;
  reason: string;
  requestedBy: string;
  status: 'pending' | 'rejected' | 'expired' | 'executed' | 'failed';
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  expiresAt: string;
  reviewedAt: string | null;
  canReview: boolean;
  mine: boolean;
}

export interface ReportView {
  id: number;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  snapshot: Record<string, unknown>;
  status: ReportStatus;
  reporter: string;
  target: { userId: string | null; username: string | null; pilot: string | null };
  handledBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface RoleMatrixView {
  roles: Array<{ key: RoleKey; label: string; rank: number; permissions: PermissionKey[]; members: number }>;
}
