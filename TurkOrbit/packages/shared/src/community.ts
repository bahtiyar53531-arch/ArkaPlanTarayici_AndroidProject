/**
 * Forum ve destek ortak kuralları (Aşama 13): istek şemaları, talep numarası, ek dosya türü tespiti (sihirli baytlar),
 * dosya adı temizliği ve API tipleri. Asıl denetim sunucudadır; istemci aynı kuralla kullanıcıyı önceden uyarır.
 */
import { z } from 'zod';

const oneLine = (s: string) => s.trim().replace(/\s+/g, ' ');
/** Satır sonları korunur; satır sonundaki boşluklar ve 3'ten fazla boş satır sadeleşir; görünmez karakterler atılır. */
export function cleanMultiline(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// ------------------------------------------------------------------ forum
export const FORUM_REPORT_REASONS = ['spam', 'insult', 'cheating', 'inappropriate_name', 'scam', 'other'] as const;

const title = z
  .string()
  .transform(oneLine)
  .pipe(z.string().min(5, 'Başlık en az 5 karakter olmalı.').max(140, 'Başlık en fazla 140 karakter olabilir.'));
const body = (min: number, max: number) =>
  z
    .string()
    .transform(cleanMultiline)
    .pipe(z.string().min(min, min > 1 ? `Mesaj en az ${min} karakter olmalı.` : 'Mesaj boş olamaz.').max(max, `Mesaj en fazla ${max.toLocaleString('tr-TR')} karakter olabilir.`));

export const forumThreadCreateSchema = z.strictObject({ category: z.string().regex(/^[a-z0-9-]{2,40}$/), title, body: body(1, 20000) });
export const forumReplySchema = z.strictObject({ body: body(1, 20000), quotedPostId: z.number().int().positive().optional() });
export const forumEditSchema = z.strictObject({ body: body(1, 20000) });
export const forumDeleteSchema = z.strictObject({ reason: z.string().trim().max(200).optional() });
export const forumModerateSchema = z.strictObject({
  action: z.enum(['pin', 'unpin', 'lock', 'unlock', 'move', 'delete', 'restore']),
  category: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  reason: z.string().trim().max(200).optional(),
});
export const forumReportSchema = z.strictObject({ reason: z.enum(FORUM_REPORT_REASONS), details: z.string().trim().max(500).optional() });
export const forumModeratorSchema = z.strictObject({ category: z.string().regex(/^[a-z0-9-]{2,40}$/), username: z.string().trim().min(1).max(40), assign: z.boolean() });

export interface ForumAuthor {
  username: string | null;
  /** personel rolünün Türkçe adı (oyuncu için null) */
  staffRole: string | null;
  /** oyundaki pilot (TR1): şirket kodu, seviye, klan etiketi */
  pilot: { company: string; level: number; clanTag: string | null } | null;
  postCount: number;
  joinedAt: string | null;
}

export interface ForumCategoryView {
  slug: string;
  name: string;
  description: string | null;
  threads: number;
  posts: number;
  /** oturumdaki kullanıcı bu bölümde konu açabilir mi */
  canPost: boolean;
  last: { threadId: number; title: string; at: string; by: string | null } | null;
}

export interface ForumThreadSummary {
  id: number;
  title: string;
  category: { slug: string; name: string };
  author: string | null;
  isPinned: boolean;
  isLocked: boolean;
  replies: number;
  views: number;
  lastPostAt: string;
  lastPoster: string | null;
  createdAt: string;
}

export interface ForumPostView {
  id: number;
  author: ForumAuthor;
  /** silinmiş mesajda null */
  body: string | null;
  deleted: { by: 'author' | 'moderator'; reason: string | null } | null;
  quoted: { id: number; author: string | null; excerpt: string | null } | null;
  likes: number;
  likedByMe: boolean;
  isFirst: boolean;
  editedAt: string | null;
  createdAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ForumThreadView extends ForumThreadSummary {
  posts: ForumPostView[];
  page: number;
  pages: number;
  following: boolean;
  /** oturumdaki kullanıcının yanıt yazıp yazamayacağı ve yazamıyorsa sebebi */
  canReply: boolean;
  replyBlockedReason: string | null;
  canModerate: boolean;
  categories: Array<{ slug: string; name: string }>;
}

export interface ForumSearchResult {
  threadId: number;
  title: string;
  category: string;
  postId: number | null;
  /** [[...]] arasındaki kısımlar eşleşen kelimelerdir (istemci güvenli biçimde vurgular) */
  snippet: string;
  at: string;
}

// ------------------------------------------------------------------ destek
export const SUPPORT_CATEGORIES = ['account', 'payment', 'bug', 'cheat_report', 'ban_appeal', 'gameplay', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  account: 'Hesap ve giriş',
  payment: 'Ödeme ve Akçe',
  bug: 'Hata bildirimi',
  cheat_report: 'Hile bildirimi',
  ban_appeal: 'Yaptırım itirazı',
  gameplay: 'Oyun içi sorun',
  other: 'Diğer',
};
export const SUPPORT_STATUSES = ['waiting_staff', 'waiting_player', 'resolved', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  waiting_staff: 'Ekip yanıtı bekleniyor',
  waiting_player: 'Senin yanıtın bekleniyor',
  resolved: 'Çözüldü',
  closed: 'Kapatıldı',
};
/** Personel görünümü (destek masası) */
export const SUPPORT_STATUS_STAFF_LABELS: Record<SupportStatus, string> = {
  waiting_staff: 'Ekip yanıtı bekleniyor',
  waiting_player: 'Oyuncu yanıtı bekleniyor',
  resolved: 'Çözüldü',
  closed: 'Kapatıldı',
};
export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];
export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = { low: 'Düşük', normal: 'Normal', high: 'Yüksek', urgent: 'Acil' };

export const supportCreateSchema = z.strictObject({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z
    .string()
    .transform(oneLine)
    .pipe(z.string().min(5, 'Konu en az 5 karakter olmalı.').max(120, 'Konu en fazla 120 karakter olabilir.')),
  body: body(10, 5000),
});
export const supportReplySchema = z.strictObject({ body: body(1, 5000) });
export const supportStaffReplySchema = z.strictObject({ body: body(1, 5000), internal: z.boolean().default(false) });
export const supportUpdateSchema = z.strictObject({
  status: z.enum(SUPPORT_STATUSES).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  /** true: talebi kendine ata · false: atamayı kaldır */
  assignToMe: z.boolean().optional(),
});

/** Talep numarası: TO-<yıl>-<en az 6 hane> (dizi değerinden; benzersizliği veritabanı da korur). */
export const ticketNumber = (year: number, seq: number) => `TO-${year}-${String(seq).padStart(6, '0')}`;
export const TICKET_NO_REGEX = /^TO-\d{4}-\d{6,}$/;

// ------------------------------------------------------------------ ek dosyalar
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/pdf'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
export const ATTACHMENT_EXT: Record<AttachmentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'application/pdf': 'pdf',
};
export const ATTACHMENT_LABEL = 'PNG, JPEG, WEBP, PDF veya düz metin (TXT)';

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

/**
 * Dosya türü İÇERİKTEN (sihirli baytlar) tespit edilir; istemcinin bildirdiği tür veya uzantıya güvenilmez.
 * Metin dosyası: geçerli UTF-8, NUL ve denetim karakteri yok (sekme, satır sonu hariç).
 * Desteklenmeyen tür → null (ör. çalıştırılabilir dosya, HTML, SVG, ZIP).
 */
export function detectFileType(b: Uint8Array): AttachmentType | null {
  if (b.length === 0) return null;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (b.length >= 12 && startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  // Metin: ilk 64 KB'ın tamamı yazdırılabilir UTF-8 olmalı. HTML/SVG/betik metin olarak kabul edilse bile
  // yalnızca text/plain ve "indirme" olarak sunulur (tarayıcıda çalıştırılmaz).
  const sample = b.subarray(0, 65536);
  for (const c of sample) if (c === 0 || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b.length > 65536 ? b.subarray(0, 65532) : b);
  } catch {
    return null;
  }
  return 'text/plain';
}

/** Dosya adı: yol bölümü atılır, yalnızca harf/rakam/boşluk/._-() kalır; uzantı içerikten belirlenen türe göre konur. */
export function sanitizeFileName(name: string, type: AttachmentType): string {
  const base = (name.split(/[\\/]/).pop() ?? '').normalize('NFC');
  const stem = base
    .replace(/\.[^.]*$/, '')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
    .slice(0, 100);
  return `${stem || 'dosya'}.${ATTACHMENT_EXT[type]}`;
}

export interface SupportAttachmentView {
  id: number;
  fileName: string;
  mimeType: AttachmentType;
  sizeBytes: number;
}
export interface SupportMessageView {
  id: number;
  author: string | null;
  isStaff: boolean;
  internal: boolean;
  body: string;
  createdAt: string;
  attachments: SupportAttachmentView[];
  /** oturumdaki kullanıcı bu mesaja hâlâ dosya ekleyebilir mi (yazarı, süre ve sayı sınırı içinde) */
  canAttach: boolean;
}
export interface SupportTicketSummary {
  ticketNo: string;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  priority: SupportPriority;
  createdAt: string;
  updatedAt: string;
  /** personel görünümü */
  user?: string;
  assignedTo?: string | null;
}
export interface SupportTicketView extends SupportTicketSummary {
  messages: SupportMessageView[];
  platform: string | null;
  appVersion: string | null;
  canReply: boolean;
  replyBlockedReason: string | null;
}
export interface SupportLimits {
  maxAttachmentBytes: number;
  maxAttachmentsPerMessage: number;
  types: AttachmentType[];
}
