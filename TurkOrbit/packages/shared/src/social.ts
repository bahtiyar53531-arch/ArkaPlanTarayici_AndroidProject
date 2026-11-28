/**
 * Klan ve sosyal ortak kuralları (Aşama 12): klan yetkileri, rütbe sıralaması, sohbet filtresi, grup konum izni,
 * istek şemaları ve API/protokol tipleri. Asıl denetim sunucudadır; istemci yalnızca gösterim için kullanır.
 */
import { z } from 'zod';

const serverCode = z.string().trim().min(2).max(10);
const pilotName = z.string().trim().regex(/^[A-Za-z0-9_]{1,20}$/, 'Geçersiz pilot adı.');
const requestId = z.string().uuid();

// ------------------------------------------------------------------ klan yetkileri ve rütbeler
export const CLAN_PERMISSIONS = ['invite', 'kick', 'promote', 'diplomacy', 'treasury', 'edit_info'] as const;
export type ClanPermission = (typeof CLAN_PERMISSIONS)[number];
export const CLAN_PERMISSION_LABELS: Record<ClanPermission, string> = {
  invite: 'Üye alma ve davet',
  kick: 'Üye çıkarma',
  promote: 'Rütbe verme',
  diplomacy: 'Diplomasi',
  treasury: 'Hazineden ödeme',
  edit_info: 'Klan bilgisini düzenleme',
};

/** Klan kurulunca oluşturulan rütbeler. sort_order 0 = lider (tüm yetkiler, değiştirilemez). */
export const DEFAULT_CLAN_RANKS: ReadonlyArray<{ name: string; sortOrder: number; isLeader: boolean; permissions: ClanPermission[] }> = [
  { name: 'Lider', sortOrder: 0, isLeader: true, permissions: [...CLAN_PERMISSIONS] },
  { name: 'Komutan', sortOrder: 1, isLeader: false, permissions: ['invite', 'kick', 'promote', 'diplomacy', 'treasury', 'edit_info'] },
  { name: 'Subay', sortOrder: 2, isLeader: false, permissions: ['invite'] },
  { name: 'Üye', sortOrder: 3, isLeader: false, permissions: [] },
];

export interface RankLike {
  sortOrder: number;
  isLeader: boolean;
  permissions: readonly string[];
}

export function hasClanPermission(rank: RankLike, p: ClanPermission): boolean {
  return rank.isLeader || rank.permissions.includes(p);
}

/** Yalnızca kendinden alt rütbedekiler yönetilebilir (çıkarma, rütbe değiştirme). Lider her zaman en üsttedir. */
export function outranks(actor: RankLike, target: RankLike): boolean {
  if (target.isLeader) return false;
  if (actor.isLeader) return true;
  return actor.sortOrder < target.sortOrder;
}

// ------------------------------------------------------------------ klan adı ve etiketi
export const CLAN_TAG_REGEX = /^[A-Z0-9ÇĞİÖŞÜ]{2,5}$/;
export const CLAN_NAME_REGEX = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü][A-Za-z0-9ÇĞİÖŞÜçğıöşü .'-]{1,28}[A-Za-z0-9ÇĞİÖŞÜçğıöşü.]$/;

export const normalizeClanTag = (s: string) => s.trim().toLocaleUpperCase('tr-TR');
/** Adın içindeki birden çok boşluk teke indirilir. */
export const normalizeClanName = (s: string) => s.trim().replace(/\s+/g, ' ');

const clanTag = z
  .string()
  .transform(normalizeClanTag)
  .pipe(z.string().regex(CLAN_TAG_REGEX, 'Klan etiketi 2–5 karakter olmalı; yalnızca harf ve rakam.'));
const clanName = z
  .string()
  .transform(normalizeClanName)
  .pipe(z.string().regex(CLAN_NAME_REGEX, 'Klan adı 3–30 karakter olmalı; harf, rakam, boşluk, nokta, kesme ve tire kullanılabilir.'));
const description = z.string().trim().max(500, 'Açıklama en fazla 500 karakter olabilir.');

export const clanCreateSchema = z.strictObject({ serverCode, tag: clanTag, name: clanName, description: description.optional(), requestId });
export const clanUpdateSchema = z.strictObject({
  serverCode,
  description: description.nullable().optional(),
  isRecruiting: z.boolean().optional(),
  minLevel: z.number().int().min(1).max(50).optional(),
  taxPercent: z.number().int().min(0).max(5).optional(),
});
export const clanApplySchema = z.strictObject({ serverCode, tag: clanTag, message: z.string().trim().max(200).optional() });
export const clanIdSchema = z.strictObject({ serverCode, id: z.number().int().positive() });
export const clanDecideSchema = z.strictObject({ serverCode, id: z.number().int().positive(), accept: z.boolean() });
export const clanPilotSchema = z.strictObject({ serverCode, pilotName });
export const clanMemberRankSchema = z.strictObject({ serverCode, pilotName, rankId: z.number().int().positive() });
export const clanRankUpdateSchema = z.strictObject({
  serverCode,
  rankId: z.number().int().positive(),
  name: z.string().trim().min(1).max(20),
  permissions: z.array(z.enum(CLAN_PERMISSIONS)).max(CLAN_PERMISSIONS.length),
});
export const clanServerSchema = z.strictObject({ serverCode });
export const clanDepositSchema = z.strictObject({ serverCode, amount: z.number().int().min(1).max(1_000_000_000), requestId });
export const clanWithdrawSchema = z.strictObject({ serverCode, pilotName, amount: z.number().int().min(1).max(1_000_000_000), requestId });

export const DIPLOMACY_RELATIONS = ['alliance', 'non_aggression', 'war'] as const;
export type DiplomacyRelation = (typeof DIPLOMACY_RELATIONS)[number];
export const DIPLOMACY_LABELS: Record<DiplomacyRelation, string> = { alliance: 'İttifak', non_aggression: 'Saldırmazlık', war: 'Savaş' };
export const clanProposeSchema = z.strictObject({ serverCode, tag: clanTag, relation: z.enum(['alliance', 'non_aggression']) });
export const clanTargetSchema = z.strictObject({ serverCode, tag: clanTag });
export const clanRespondSchema = z.strictObject({ serverCode, tag: clanTag, accept: z.boolean() });

// ------------------------------------------------------------------ arkadaşlık, engelleme, gizlilik, şikâyet
export const socialPilotSchema = z.strictObject({ serverCode, pilotName });
export const friendRespondSchema = z.strictObject({ serverCode, pilotName, accept: z.boolean() });

export const LOCATION_SHARING = ['group', 'map', 'none'] as const;
export type LocationSharing = (typeof LOCATION_SHARING)[number];
export const LOCATION_SHARING_LABELS: Record<LocationSharing, string> = {
  group: 'Harita ve konum',
  map: 'Yalnızca harita adı',
  none: 'Gizli',
};
export const DM_POLICIES = ['everyone', 'friends', 'nobody'] as const;
export type DmPolicy = (typeof DM_POLICIES)[number];
export const GROUP_INVITE_POLICIES = ['everyone', 'friends_clan', 'nobody'] as const;
export type GroupInvitePolicy = (typeof GROUP_INVITE_POLICIES)[number];

export interface SocialSettings {
  locationSharing: LocationSharing;
  friendsSeeOnline: boolean;
  dmPolicy: DmPolicy;
  groupInvites: GroupInvitePolicy;
  friendRequests: boolean;
}
export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  locationSharing: 'group',
  friendsSeeOnline: true,
  dmPolicy: 'everyone',
  groupInvites: 'everyone',
  friendRequests: true,
};
export const socialSettingsSchema = z.strictObject({
  serverCode,
  locationSharing: z.enum(LOCATION_SHARING),
  friendsSeeOnline: z.boolean(),
  dmPolicy: z.enum(DM_POLICIES),
  groupInvites: z.enum(GROUP_INVITE_POLICIES),
  friendRequests: z.boolean(),
});

export const REPORT_REASONS = ['spam', 'insult', 'cheating', 'inappropriate_name', 'scam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam / flood',
  insult: 'Hakaret veya küfür',
  cheating: 'Hile şüphesi',
  inappropriate_name: 'Uygunsuz ad',
  scam: 'Dolandırıcılık',
  other: 'Diğer',
};
export const reportSchema = z.strictObject({
  serverCode,
  targetType: z.enum(['player', 'chat_message', 'clan']),
  /** Mesaj kimliği, pilot adı veya klan etiketi */
  target: z.string().trim().min(1).max(40),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(500).optional(),
});

export const notificationReadSchema = z.strictObject({ serverCode, ids: z.array(z.number().int().positive()).max(100).optional() });

// ------------------------------------------------------------------ sohbet
export const CHAT_CHANNELS = ['global', 'company', 'map', 'clan', 'group', 'dm'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
export const CHAT_CHANNEL_LABELS: Record<ChatChannel, string> = {
  global: 'Genel',
  company: 'Şirket',
  map: 'Harita',
  clan: 'Klan',
  group: 'Grup',
  dm: 'Özel',
};
export interface ChatSettings {
  max_length: number;
  rate_count: number;
  rate_window_seconds: number;
  history: number;
  mute_seconds: number;
  banned_words: string[];
}
export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  max_length: 300,
  rate_count: 5,
  rate_window_seconds: 10,
  history: 50,
  mute_seconds: 60,
  banned_words: [],
};

/** Özel mesaj kanalı: iki pilot kimliği sıralı (aynı iki pilot her zaman aynı kanal). */
export const dmChannel = (a: string, b: string) => (a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`);

const FOLD: Record<string, string> = { ı: 'i', '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '@': 'a', $: 's', '7': 't' };

/** Karşılaştırma için sadeleştirme: küçük harf, Türkçe harfler ve benzer rakamlar katlanır, tekrar eden harfler teke iner. */
export function foldWord(w: string): string {
  // NFD + işaretlerin atılması: ç→c, ğ→g, ö→o, ş→s, ü→u, İ→i
  const lower = w.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '');
  let out = '';
  for (const ch of lower) out += FOLD[ch] ?? ch;
  return out.replace(/(.)\1+/g, '$1');
}

/**
 * Küfür filtresi: yasaklı kelimeler (tam kelime; 5+ harfli köklerde kelime başı) yıldızlanır.
 * "siiiktir", "s1kt1r", "AMK" gibi yazımlar da yakalanır. Mesaj reddedilmez, maskelenir.
 */
export function filterChat(text: string, banned: readonly string[]): { text: string; filtered: boolean } {
  if (banned.length === 0) return { text, filtered: false };
  const set = banned.map(foldWord).filter((w) => w.length > 0);
  const exact = new Set(set);
  const prefixes = set.filter((w) => w.length >= 5);
  let filtered = false;
  const out = text.replace(/[\p{L}\p{N}@$]+/gu, (token) => {
    const f = foldWord(token);
    if (exact.has(f) || prefixes.some((p) => f.startsWith(p))) {
      filtered = true;
      return '*'.repeat([...token].length);
    }
    return token;
  });
  return { text: out, filtered };
}

/** Görünmez/denetim karakterleri temizlenir, boşluklar sadeleşir. */
export function cleanChatText(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ChatMessageView {
  id: number;
  ch: ChatChannel;
  /** gönderen */
  from: { name: string; company: string; clanTag: string | null; level: number };
  /** özel mesajda alıcı adı */
  to?: string;
  b: string;
  at: string;
}

// ------------------------------------------------------------------ grup (party)
export interface PartyMemberView {
  name: string;
  level: number;
  company: string;
  leader: boolean;
  online: boolean;
  /** can ve kalkan yüzdesi (çevrimiçiyse) */
  hp: number | null;
  sh: number | null;
  /** harita kodu/adı: üyenin konum izni "gizli" ise null */
  map: { code: string; name: string } | null;
  /** koordinat: yalnızca üyenin izni "harita ve konum" ise */
  x: number | null;
  y: number | null;
  /** aynı haritadaysa varlık kimliği (mini haritada ve hedeflemede kullanılır) */
  entityId: number | null;
  you: boolean;
}
export interface PartyView {
  id: string;
  members: PartyMemberView[];
  max: number;
}

/**
 * Grup üyesinin konumu, ÜYENİN kendi izin ayarına göre görünür:
 *  - group: harita + koordinat · map: yalnızca harita adı · none: gizli.
 * Aynı haritadaysa ve izin "gizli" değilse varlık kimliği de verilir.
 */
export function partyLocation(sharing: LocationSharing, member: { mapCode: string; mapName: string; x: number; y: number; entityId: number }, viewerMapCode: string) {
  if (sharing === 'none') return { map: null, x: null, y: null, entityId: null };
  const sameMap = member.mapCode === viewerMapCode;
  return {
    map: { code: member.mapCode, name: member.mapName },
    x: sharing === 'group' ? Math.round(member.x) : null,
    y: sharing === 'group' ? Math.round(member.y) : null,
    entityId: sameMap ? member.entityId : null,
  };
}

// ------------------------------------------------------------------ pilotlar arası ilişki (saldırı kuralı)
/** party: aynı grup · clan: aynı klan · alliance/non_aggression/war: klanlar arası etkin diplomasi */
export type PilotRelation = 'party' | 'clan' | 'alliance' | 'non_aggression' | 'war';

// ------------------------------------------------------------------ API tipleri
export interface ClanRankView {
  id: number;
  name: string;
  sortOrder: number;
  isLeader: boolean;
  permissions: ClanPermission[];
  members: number;
}
export interface ClanMemberView {
  pilotName: string;
  level: number;
  company: { code: string; colorHex: string };
  rankId: number;
  rankName: string;
  joinedAt: string;
  online: boolean;
}
export interface ClanSummary {
  tag: string;
  name: string;
  members: number;
  maxMembers: number;
  leader: string | null;
  isRecruiting: boolean;
  minLevel: number;
  taxPercent: number;
  createdAt: string;
}
export interface ClanRelationView {
  tag: string;
  name: string;
  relation: DiplomacyRelation;
  status: 'proposed' | 'active';
  /** öneriyi (veya savaşı) bizim klan mı yaptı */
  ours: boolean;
  /** savaşta barış önerisi: 'ours' biz önerdik, 'theirs' karşı taraf önerdi */
  peace: 'ours' | 'theirs' | null;
  since: string;
}
export interface ClanPublicView extends ClanSummary {
  description: string | null;
  memberList: Array<{ pilotName: string; level: number; rankName: string; company: string }>;
  relations: ClanRelationView[];
}
export interface ClanApplicationView {
  id: number;
  pilotName: string;
  level: number;
  company: string;
  message: string | null;
  createdAt: string;
}
export interface ClanTreasuryEntry {
  id: number;
  delta: number;
  balanceAfter: number;
  reason: string;
  pilotName: string | null;
  actorName: string | null;
  createdAt: string;
}
export interface ClanEventView {
  id: number;
  kind: string;
  text: string;
  createdAt: string;
}
export interface MyClanView extends ClanSummary {
  description: string | null;
  myRank: ClanRankView;
  ranks: ClanRankView[];
  memberList: ClanMemberView[];
  treasury: { balance: number; entries: ClanTreasuryEntry[] };
  relations: ClanRelationView[];
  applications: ClanApplicationView[];
  invitations: Array<{ id: number; pilotName: string; invitedBy: string | null; expiresAt: string }>;
  events: ClanEventView[];
}
export interface ClanResponse {
  clan: MyClanView | null;
  /** klanı olmayan pilot için: gelen davetler ve bekleyen başvurular */
  invitations: Array<{ id: number; tag: string; name: string; invitedBy: string | null; expiresAt: string }>;
  applications: Array<{ id: number; tag: string; name: string; createdAt: string }>;
  createCost: { currency: string; amount: number };
  createMinLevel: number;
  level: number;
}

export interface FriendView {
  pilotName: string;
  level: number;
  company: { code: string; colorHex: string };
  clanTag: string | null;
  /** arkadaş çevrimiçi durumunu gizlediyse null */
  online: boolean | null;
  map: { code: string; name: string } | null;
  since: string;
}
export interface FriendsResponse {
  friends: FriendView[];
  incoming: Array<{ pilotName: string; level: number; company: string; createdAt: string }>;
  outgoing: Array<{ pilotName: string; createdAt: string }>;
  blocked: Array<{ pilotName: string; createdAt: string }>;
  settings: SocialSettings;
  max: number;
}

export interface NotificationView {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}
export interface NotificationsResponse {
  items: NotificationView[];
  unread: number;
}
