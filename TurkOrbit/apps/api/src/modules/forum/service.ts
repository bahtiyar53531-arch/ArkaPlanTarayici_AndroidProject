/**
 * Forum servisi (Aşama 13): oyun hesabıyla ortak forum.
 *
 *  - Okuma herkese açık; yazmak için oturum + doğrulanmış e-posta (rota denetler).
 *  - Kilitli konuya yanıt REDDEDİLİR (konu satırı kilitlenerek okunur: kilitleme ile eşzamanlı gelen yanıt da reddedilir).
 *    Moderatörler kilitli konuya yazabilir.
 *  - Moderasyon: genel `forum.moderate` yetkisi veya bölüm moderatörlüğü. Her işlem `admin_audit_log`'a yazılır.
 *  - Silme yumuşaktır (içerik kanıt olarak kalır, okuyucuya gösterilmez). Başlık ve mesaj sohbet filtresinden geçer.
 *  - Takip edilen konuya yanıt ve alıntı bildirimleri, kullanıcının pilotuna (bildirim zili / oyun içi) gider.
 */
import {
  DEFAULT_CHAT_SETTINGS,
  filterChat,
  forumDeleteSchema,
  forumEditSchema,
  forumModerateSchema,
  forumModeratorSchema,
  forumReplySchema,
  forumReportSchema,
  forumThreadCreateSchema,
  levelForXp,
  ROLE_LABELS_TR,
  type ChatSettings,
  type ForumAuthor,
  type ForumCategoryView,
  type ForumPostView,
  type ForumSearchResult,
  type ForumThreadSummary,
  type ForumThreadView,
  type RoleKey,
} from '@turkorbit/shared';
import type { Redis } from 'ioredis';
import { uniqueViolation, withTransaction, type Db, type DbClient, type Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { getSetting, userHasPermission } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import { Notifier, Outbox } from '../social/notifications.js';

const err = (code: ConstructorParameters<typeof AppError>[0], status: number, message: string) => new AppError(code, status, message);

export interface ForumSettings {
  threads_per_page: number;
  posts_per_page: number;
  edit_window_minutes: number;
}
const DEFAULT_FORUM: ForumSettings = { threads_per_page: 20, posts_per_page: 20, edit_window_minutes: 1440 };

/** Oturum açmış kullanıcı (yazma işlemleri) */
export interface ForumUser {
  id: string;
  username: string;
  verified: boolean;
}

interface ThreadRow {
  id: string;
  category_id: number;
  slug: string;
  category_name: string;
  author_id: string | null;
  author: string | null;
  title: string;
  is_pinned: boolean;
  is_locked: boolean;
  is_deleted: boolean;
  reply_count: number;
  view_count: number;
  last_post_at: Date;
  last_poster: string | null;
  created_at: Date;
}

const THREAD_SELECT = `SELECT t.id::text, t.category_id, c.slug, c.name AS category_name, t.author_id, au.username::text AS author, t.title,
    t.is_pinned, t.is_locked, t.is_deleted, t.reply_count, t.view_count, t.last_post_at, lp.username::text AS last_poster, t.created_at
  FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
  LEFT JOIN users au ON au.id = t.author_id LEFT JOIN users lp ON lp.id = t.last_poster_id`;

const summary = (r: ThreadRow): ForumThreadSummary => ({
  id: Number(r.id),
  title: r.title,
  category: { slug: r.slug, name: r.category_name },
  author: r.author_id === null ? null : r.author,
  isPinned: r.is_pinned,
  isLocked: r.is_locked,
  replies: r.reply_count,
  views: r.view_count,
  lastPostAt: r.last_post_at.toISOString(),
  lastPoster: r.last_poster,
  createdAt: r.created_at.toISOString(),
});

export class ForumService {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly notifier: Notifier,
    private readonly redis: Redis | null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async settings(c: Queryable = this.db): Promise<ForumSettings> {
    return { ...DEFAULT_FORUM, ...(await getSetting<Partial<ForumSettings>>(c, 'forum')) };
  }

  private async banned(c: Queryable = this.db): Promise<string[]> {
    return { ...DEFAULT_CHAT_SETTINGS, ...(await getSetting<Partial<ChatSettings>>(c, 'chat')) }.banned_words;
  }

  /** Genel forum moderatörü veya bu bölümün moderatörü mü */
  private async canModerate(c: Queryable, userId: string | null, categoryId: number): Promise<boolean> {
    if (!userId) return false;
    if (await userHasPermission(c, userId, 'forum.moderate')) return true;
    const r = await c.query('SELECT 1 FROM forum_moderators WHERE category_id = $1 AND user_id = $2', [categoryId, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  private async canPostIn(c: Queryable, user: ForumUser | null, postPermission: string | null): Promise<boolean> {
    if (!user || !user.verified) return false;
    return postPermission === null || (await userHasPermission(c, user.id, postPermission));
  }

  /** Kullanıcının pilotları (bildirimler pilota gider; pilotu olmayan kullanıcı forum bildirimi almaz) */
  private async pilotsOf(c: Queryable, userIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (userIds.length === 0) return out;
    const r = await c.query<{ id: string; user_id: string }>('SELECT id, user_id FROM players WHERE user_id = ANY($1::uuid[])', [userIds]);
    for (const row of r.rows) out.set(row.user_id, [...(out.get(row.user_id) ?? []), row.id]);
    return out;
  }

  private async audit(c: Queryable, actor: ForumUser, action: string, targetType: string, targetId: string, before: unknown, after: unknown, reason?: string) {
    await c.query(
      `INSERT INTO admin_audit_log (actor_user_id, actor_label, action, target_type, target_id, before_value, after_value, reason, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'success')`,
      [actor.id, actor.username, action, targetType, targetId, JSON.stringify(before), JSON.stringify(after), reason ?? null],
    );
  }

  /** Yazar bilgileri (kullanıcı adı, personel rolü, pilot, mesaj sayısı) toplu okunur. */
  private async authors(c: Queryable, ids: string[]): Promise<Map<string, ForumAuthor>> {
    const out = new Map<string, ForumAuthor>();
    if (ids.length === 0) return out;
    const r = await c.query<{
      id: string;
      username: string;
      created_at: Date;
      role: RoleKey | null;
      company: string | null;
      experience: string | null;
      clan_tag: string | null;
      posts: string;
    }>(
      `SELECT u.id, u.username::text AS username, u.created_at,
         (SELECT r.key FROM user_roles ur JOIN roles r ON r.key = ur.role_key WHERE ur.user_id = u.id AND r.is_staff ORDER BY r.rank DESC LIMIT 1) AS role,
         co.code AS company, p.experience, cl.tag::text AS clan_tag,
         (SELECT count(*) FROM forum_posts fp WHERE fp.author_id = u.id AND NOT fp.is_deleted) AS posts
       FROM users u
       LEFT JOIN players p ON p.user_id = u.id AND p.server_id = (SELECT id FROM game_servers ORDER BY id LIMIT 1)
       LEFT JOIN companies co ON co.id = p.company_id
       LEFT JOIN clan_members cm ON cm.player_id = p.id LEFT JOIN clans cl ON cl.id = cm.clan_id
       WHERE u.id = ANY($1::uuid[])`,
      [ids],
    );
    for (const a of r.rows) {
      out.set(a.id, {
        username: a.username,
        staffRole: a.role ? ROLE_LABELS_TR[a.role] : null,
        pilot: a.company ? { company: a.company, level: levelForXp(Number(a.experience ?? 0)), clanTag: a.clan_tag } : null,
        postCount: Number(a.posts),
        joinedAt: a.created_at.toISOString(),
      });
    }
    return out;
  }

  private async categoryBySlug(c: Queryable, slug: string) {
    const r = await c.query<{ id: number; slug: string; name: string; description: string | null; post_permission: string | null; is_archived: boolean }>(
      'SELECT id, slug, name, description, post_permission, is_archived FROM forum_categories WHERE slug = $1',
      [slug],
    );
    if (!r.rows[0]) throw err('FORUM_CATEGORY_NOT_FOUND', 404, 'Forum bölümü bulunamadı.');
    return r.rows[0];
  }

  private async threadRow(c: Queryable, id: number, lock = false): Promise<ThreadRow> {
    if (!Number.isSafeInteger(id) || id <= 0) throw err('THREAD_NOT_FOUND', 404, 'Konu bulunamadı.');
    if (lock) await c.query('SELECT id FROM forum_threads WHERE id = $1 FOR UPDATE', [id]);
    const r = await c.query<ThreadRow>(`${THREAD_SELECT} WHERE t.id = $1`, [id]);
    if (!r.rows[0]) throw err('THREAD_NOT_FOUND', 404, 'Konu bulunamadı.');
    return r.rows[0];
  }

  // ================================================================== okuma
  async categories(user: ForumUser | null): Promise<ForumCategoryView[]> {
    const r = await this.db.query<{
      id: number;
      slug: string;
      name: string;
      description: string | null;
      post_permission: string | null;
      threads: string;
      posts: string;
      last_id: string | null;
      last_title: string | null;
      last_at: Date | null;
      last_by: string | null;
    }>(
      `SELECT c.id, c.slug, c.name, c.description, c.post_permission,
         (SELECT count(*) FROM forum_threads t WHERE t.category_id = c.id AND NOT t.is_deleted) AS threads,
         (SELECT COALESCE(sum(t.reply_count + 1), 0) FROM forum_threads t WHERE t.category_id = c.id AND NOT t.is_deleted) AS posts,
         l.id::text AS last_id, l.title AS last_title, l.last_post_at AS last_at, lu.username::text AS last_by
       FROM forum_categories c
       LEFT JOIN LATERAL (SELECT id, title, last_post_at, last_poster_id FROM forum_threads t WHERE t.category_id = c.id AND NOT t.is_deleted
                          ORDER BY last_post_at DESC LIMIT 1) l ON true
       LEFT JOIN users lu ON lu.id = l.last_poster_id
       WHERE NOT c.is_archived ORDER BY c.sort_order, c.id`,
    );
    const out: ForumCategoryView[] = [];
    for (const c of r.rows) {
      out.push({
        slug: c.slug,
        name: c.name,
        description: c.description,
        threads: Number(c.threads),
        posts: Number(c.posts),
        canPost: await this.canPostIn(this.db, user, c.post_permission),
        last: c.last_id ? { threadId: Number(c.last_id), title: c.last_title!, at: c.last_at!.toISOString(), by: c.last_by } : null,
      });
    }
    return out;
  }

  async listThreads(slug: string, page: number, user: ForumUser | null) {
    const cat = await this.categoryBySlug(this.db, slug);
    const s = await this.settings();
    const total = Number((await this.db.query<{ n: string }>('SELECT count(*) AS n FROM forum_threads WHERE category_id = $1 AND NOT is_deleted', [cat.id])).rows[0]!.n);
    const pages = Math.max(1, Math.ceil(total / s.threads_per_page));
    const p = Math.min(Math.max(1, page || 1), pages);
    const r = await this.db.query<ThreadRow>(
      `${THREAD_SELECT} WHERE t.category_id = $1 AND NOT t.is_deleted ORDER BY t.is_pinned DESC, t.last_post_at DESC, t.id DESC LIMIT $2 OFFSET $3`,
      [cat.id, s.threads_per_page, (p - 1) * s.threads_per_page],
    );
    return {
      category: { slug: cat.slug, name: cat.name, description: cat.description, canPost: await this.canPostIn(this.db, user, cat.post_permission) },
      threads: r.rows.map(summary),
      page: p,
      pages,
      total,
    };
  }

  async thread(id: number, page: number, user: ForumUser | null, viewerKey: string): Promise<ForumThreadView> {
    const t = await this.threadRow(this.db, id);
    const mod = await this.canModerate(this.db, user?.id ?? null, t.category_id);
    if (t.is_deleted && !mod) throw err('THREAD_NOT_FOUND', 404, 'Konu bulunamadı.');
    // Görüntülenme: aynı izleyici saatte bir kez sayılır
    if (this.redis && (await this.redis.set(`forum:view:${t.id}:${viewerKey}`, '1', 'EX', 3600, 'NX'))) {
      await this.db.query('UPDATE forum_threads SET view_count = view_count + 1 WHERE id = $1', [t.id]);
      t.view_count++;
    }
    const s = await this.settings();
    const total = t.reply_count + 1;
    const pages = Math.max(1, Math.ceil(total / s.posts_per_page));
    const p = Math.min(Math.max(1, page || 1), pages);
    const posts = await this.db.query<{
      id: string;
      author_id: string | null;
      body: string;
      quoted_post_id: string | null;
      q_author: string | null;
      q_body: string | null;
      q_deleted: boolean | null;
      is_first: boolean;
      is_deleted: boolean;
      deleted_by: string | null;
      deleted_reason: string | null;
      like_count: number;
      edited_at: Date | null;
      created_at: Date;
      liked: boolean;
    }>(
      `SELECT fp.id::text, fp.author_id, fp.body, fp.quoted_post_id::text, qu.username::text AS q_author, q.body AS q_body, q.is_deleted AS q_deleted,
         fp.is_first, fp.is_deleted, fp.deleted_by, fp.deleted_reason, fp.like_count, fp.edited_at, fp.created_at,
         EXISTS (SELECT 1 FROM forum_likes l WHERE l.post_id = fp.id AND l.user_id = $4) AS liked
       FROM forum_posts fp LEFT JOIN forum_posts q ON q.id = fp.quoted_post_id LEFT JOIN users qu ON qu.id = q.author_id
       WHERE fp.thread_id = $1 ORDER BY fp.id LIMIT $2 OFFSET $3`,
      [t.id, s.posts_per_page, (p - 1) * s.posts_per_page, user?.id ?? null],
    );
    const authors = await this.authors(this.db, [...new Set(posts.rows.map((x) => x.author_id).filter((x): x is string => x !== null))]);
    const now = this.clock().getTime();
    const views: ForumPostView[] = posts.rows.map((x) => {
      const own = user !== null && x.author_id === user.id;
      return {
        id: Number(x.id),
        author: x.author_id
          ? authors.get(x.author_id)!
          : { username: null, staffRole: t.author_id === null && x.is_first ? 'Türk Orbit Ekibi' : null, pilot: null, postCount: 0, joinedAt: null },
        body: x.is_deleted ? null : x.body,
        deleted: x.is_deleted ? { by: x.deleted_by && x.deleted_by === x.author_id ? 'author' : 'moderator', reason: x.deleted_by === x.author_id ? null : x.deleted_reason } : null,
        quoted: x.quoted_post_id ? { id: Number(x.quoted_post_id), author: x.q_author, excerpt: x.q_deleted ? null : (x.q_body ?? '').slice(0, 300) } : null,
        likes: x.like_count,
        likedByMe: x.liked,
        isFirst: x.is_first,
        editedAt: x.edited_at?.toISOString() ?? null,
        createdAt: x.created_at.toISOString(),
        canEdit: own && !x.is_deleted && (!t.is_locked || mod) && now - x.created_at.getTime() <= s.edit_window_minutes * 60_000,
        canDelete: !x.is_deleted && (own || mod),
      };
    });
    let following = false;
    if (user) following = ((await this.db.query('SELECT 1 FROM forum_follows WHERE thread_id = $1 AND user_id = $2', [t.id, user.id])).rowCount ?? 0) > 0;
    const blocked = !user
      ? 'Yanıt yazmak için giriş yap.'
      : !user.verified
        ? 'Yanıt yazmak için e-posta adresini doğrula.'
        : t.is_deleted
          ? 'Bu konu silindi.'
          : t.is_locked && !mod
            ? 'Bu konu kilitli; yeni yanıt yazılamaz.'
            : null;
    const cats = mod ? (await this.db.query<{ slug: string; name: string }>('SELECT slug, name FROM forum_categories WHERE NOT is_archived ORDER BY sort_order')).rows : [];
    return { ...summary(t), posts: views, page: p, pages, following, canReply: blocked === null, replyBlockedReason: blocked, canModerate: mod, categories: cats };
  }

  /**
   * Arama: her kelime için kelime başı eşleşmesi (Türkçe ekler: "gemi" → "gemileri"). Sorgu yalnızca harf/rakam
   * kelimelerinden kurulur (tsquery sözdizimi enjekte edilemez); en fazla 6 kelime, hepsi bulunmalı.
   */
  async search(q: string, page: number): Promise<{ results: ForumSearchResult[]; query: string }> {
    const words = (q.slice(0, 120).toLocaleLowerCase('tr-TR').match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 2).slice(0, 6);
    if (words.length === 0) throw err('VALIDATION_ERROR', 400, 'Arama için en az 2 harfli bir kelime yaz.');
    const query = words.join(' ');
    const tsq = words.map((w) => `${w}:*`).join(' & ');
    const p = Math.min(Math.max(1, page || 1), 20);
    const r = await this.db.query<{ thread_id: string; title: string; category: string; post_id: string | null; snippet: string; at: Date }>(
      `WITH q AS (SELECT to_tsquery('simple', $1) AS tq),
       hits AS (
         SELECT t.id AS thread_id, NULL::bigint AS post_id, ts_rank(t.search, q.tq) * 2 AS rank, t.last_post_at AS at, t.title AS text
         FROM forum_threads t, q WHERE t.search @@ q.tq AND NOT t.is_deleted
         UNION ALL
         SELECT fp.thread_id, fp.id, ts_rank(fp.search, q.tq), fp.created_at, fp.body
         FROM forum_posts fp JOIN forum_threads t ON t.id = fp.thread_id, q
         WHERE fp.search @@ q.tq AND NOT fp.is_deleted AND NOT t.is_deleted
       ),
       best AS (SELECT DISTINCT ON (thread_id) * FROM hits ORDER BY thread_id, rank DESC, at DESC)
       SELECT b.thread_id::text, t.title, c.name AS category, b.post_id::text,
              ts_headline('simple', b.text, q.tq, 'StartSel=[[,StopSel=]],MaxWords=28,MinWords=8,MaxFragments=1') AS snippet, b.at
       FROM best b JOIN forum_threads t ON t.id = b.thread_id JOIN forum_categories c ON c.id = t.category_id, q
       ORDER BY b.rank DESC, b.at DESC LIMIT 20 OFFSET $2`,
      [tsq, (p - 1) * 20],
    );
    return {
      query,
      results: r.rows.map((x) => ({ threadId: Number(x.thread_id), title: x.title, category: x.category, postId: x.post_id ? Number(x.post_id) : null, snippet: x.snippet, at: x.at.toISOString() })),
    };
  }

  // ================================================================== yazma
  private async run<T>(fn: (c: DbClient, out: Outbox) => Promise<T>): Promise<T> {
    const out = new Outbox();
    const r = await withTransaction(this.db, (c) => fn(c, out));
    await this.notifier.flush(out);
    return r;
  }

  async createThread(user: ForumUser, input: unknown): Promise<{ id: number }> {
    const b = forumThreadCreateSchema.parse(input);
    return this.run(async (c) => {
      const cat = await this.categoryBySlug(c, b.category);
      if (cat.is_archived) throw err('FORUM_CATEGORY_NOT_FOUND', 404, 'Bu bölüm arşivlendi.');
      if (!(await this.canPostIn(c, user, cat.post_permission))) throw err('FORBIDDEN', 403, `"${cat.name}" bölümünde yalnızca ekip konu açabilir.`);
      const banned = await this.banned(c);
      const title = filterChat(b.title, banned).text;
      const body = filterChat(b.body, banned).text;
      const t = await c.query<{ id: string }>(
        `INSERT INTO forum_threads (category_id, author_id, title, last_poster_id, created_at, last_post_at) VALUES ($1, $2, $3, $2, $4, $4) RETURNING id::text`,
        [cat.id, user.id, title, this.clock()],
      );
      const id = t.rows[0]!.id;
      await c.query('INSERT INTO forum_posts (thread_id, author_id, body, is_first, created_at) VALUES ($1, $2, $3, true, $4)', [id, user.id, body, this.clock()]);
      await c.query('INSERT INTO forum_follows (thread_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, user.id]);
      this.log.info({ threadId: id, category: cat.slug, user: user.username }, 'forum konusu açıldı');
      return { id: Number(id) };
    });
  }

  async reply(user: ForumUser, threadId: number, input: unknown): Promise<{ postId: number; page: number }> {
    const b = forumReplySchema.parse(input);
    return this.run(async (c, out) => {
      // Konu satırı kilitlenir: aynı anda kilitlenen konuya yanıt yazılamaz
      const t = await this.threadRow(c, threadId, true);
      const mod = await this.canModerate(c, user.id, t.category_id);
      if (t.is_deleted) throw err('THREAD_NOT_FOUND', 404, 'Konu bulunamadı.');
      if (t.is_locked && !mod) throw err('THREAD_LOCKED', 409, 'Bu konu kilitli; yeni yanıt yazılamaz.');
      let quotedAuthor: string | null = null;
      if (b.quotedPostId !== undefined) {
        const q = await c.query<{ author_id: string | null }>('SELECT author_id FROM forum_posts WHERE id = $1 AND thread_id = $2 AND NOT is_deleted', [b.quotedPostId, t.id]);
        if (!q.rows[0]) throw err('POST_NOT_FOUND', 404, 'Alıntılanan mesaj bulunamadı.');
        quotedAuthor = q.rows[0].author_id;
      }
      const body = filterChat(b.body, await this.banned(c)).text;
      const ins = await c.query<{ id: string }>(
        'INSERT INTO forum_posts (thread_id, author_id, body, quoted_post_id, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id::text',
        [t.id, user.id, body, b.quotedPostId ?? null, this.clock()],
      );
      const postId = Number(ins.rows[0]!.id);
      await c.query('UPDATE forum_threads SET reply_count = reply_count + 1, last_post_at = $3, last_poster_id = $2 WHERE id = $1', [t.id, user.id, this.clock()]);
      await c.query('INSERT INTO forum_follows (thread_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.id, user.id]);
      const s = await this.settings(c);
      const page = Math.ceil((t.reply_count + 2) / s.posts_per_page);
      const link = `/forum/konu/${t.id}?sayfa=${page}`;
      // Bildirimler: alıntılanan yazar + konuyu takip edenler (yazar hariç, kişi başı tek bildirim)
      const followers = (await c.query<{ user_id: string }>('SELECT user_id FROM forum_follows WHERE thread_id = $1 AND user_id <> $2', [t.id, user.id])).rows.map((r) => r.user_id);
      const targets = new Map<string, 'quote' | 'follow'>();
      for (const f of followers) targets.set(f, 'follow');
      if (quotedAuthor && quotedAuthor !== user.id) targets.set(quotedAuthor, 'quote');
      const pilots = await this.pilotsOf(c, [...targets.keys()]);
      for (const [uid, kind] of targets) {
        for (const pid of pilots.get(uid) ?? []) {
          await this.notifier.create(c, out, pid, {
            kind: kind === 'quote' ? 'forum_quote' : 'forum_reply',
            title: kind === 'quote' ? `${user.username} seni alıntıladı` : `Takip ettiğin konuya yanıt: ${t.title}`.slice(0, 120),
            body: kind === 'quote' ? `"${t.title}" konusunda` : `${user.username} yanıt yazdı.`,
            link,
          });
        }
      }
      return { postId, page };
    });
  }

  async edit(user: ForumUser, postId: number, input: unknown): Promise<{ ok: true }> {
    const b = forumEditSchema.parse(input);
    return this.run(async (c) => {
      const r = await c.query<{ thread_id: string; author_id: string | null; is_deleted: boolean; created_at: Date }>(
        'SELECT thread_id::text, author_id, is_deleted, created_at FROM forum_posts WHERE id = $1 FOR UPDATE',
        [postId],
      );
      const p = r.rows[0];
      if (!p || p.is_deleted) throw err('POST_NOT_FOUND', 404, 'Mesaj bulunamadı.');
      if (p.author_id !== user.id) throw err('FORBIDDEN', 403, 'Yalnızca kendi mesajını düzenleyebilirsin.');
      const t = await this.threadRow(c, Number(p.thread_id));
      const mod = await this.canModerate(c, user.id, t.category_id);
      if (t.is_locked && !mod) throw err('THREAD_LOCKED', 409, 'Bu konu kilitli; mesajlar düzenlenemez.');
      const s = await this.settings(c);
      if (this.clock().getTime() - p.created_at.getTime() > s.edit_window_minutes * 60_000) {
        throw err('EDIT_WINDOW_PASSED', 409, `Mesajlar yalnızca yazıldıktan sonraki ${Math.round(s.edit_window_minutes / 60)} saat içinde düzenlenebilir.`);
      }
      await c.query('UPDATE forum_posts SET body = $2, edited_at = $3, edit_count = edit_count + 1 WHERE id = $1', [postId, filterChat(b.body, await this.banned(c)).text, this.clock()]);
      return { ok: true as const };
    });
  }

  async deletePost(user: ForumUser, postId: number, input: unknown): Promise<{ ok: true }> {
    const b = forumDeleteSchema.parse(input ?? {});
    return this.run(async (c, out) => {
      const r = await c.query<{ thread_id: string; author_id: string | null; is_deleted: boolean; body: string }>(
        'SELECT thread_id::text, author_id, is_deleted, body FROM forum_posts WHERE id = $1 FOR UPDATE',
        [postId],
      );
      const p = r.rows[0];
      if (!p || p.is_deleted) throw err('POST_NOT_FOUND', 404, 'Mesaj bulunamadı.');
      const t = await this.threadRow(c, Number(p.thread_id));
      const own = p.author_id === user.id;
      const mod = await this.canModerate(c, user.id, t.category_id);
      if (!own && !mod) throw err('FORBIDDEN', 403, 'Bu mesajı silme yetkin yok.');
      await c.query('UPDATE forum_posts SET is_deleted = true, deleted_by = $2, deleted_reason = $3 WHERE id = $1', [postId, user.id, own ? null : b.reason ?? null]);
      if (!own) {
        await this.audit(c, user, 'forum.post.delete', 'forum_post', String(postId), { body: p.body.slice(0, 500) }, { deleted: true }, b.reason);
        if (p.author_id) {
          for (const pid of (await this.pilotsOf(c, [p.author_id])).get(p.author_id) ?? []) {
            await this.notifier.create(c, out, pid, {
              kind: 'forum_moderation',
              title: 'Forum mesajın moderatör tarafından silindi',
              body: `"${t.title}"${b.reason ? ` · Sebep: ${b.reason}` : ''}`,
              link: `/forum/konu/${t.id}`,
            });
          }
        }
      }
      return { ok: true as const };
    });
  }

  async like(user: ForumUser, postId: number, on: boolean): Promise<{ likes: number; liked: boolean }> {
    return withTransaction(this.db, async (c) => {
      const r = await c.query<{ author_id: string | null; is_deleted: boolean }>('SELECT author_id, is_deleted FROM forum_posts WHERE id = $1 FOR UPDATE', [postId]);
      const p = r.rows[0];
      if (!p || p.is_deleted) throw err('POST_NOT_FOUND', 404, 'Mesaj bulunamadı.');
      if (p.author_id === user.id) throw err('NOT_ALLOWED', 400, 'Kendi mesajını beğenemezsin.');
      const changed = on
        ? await c.query('INSERT INTO forum_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, user.id])
        : await c.query('DELETE FROM forum_likes WHERE post_id = $1 AND user_id = $2', [postId, user.id]);
      const delta = (changed.rowCount ?? 0) * (on ? 1 : -1);
      const u = await c.query<{ like_count: number }>('UPDATE forum_posts SET like_count = like_count + $2 WHERE id = $1 RETURNING like_count', [postId, delta]);
      return { likes: u.rows[0]!.like_count, liked: on };
    });
  }

  async follow(user: ForumUser, threadId: number, on: boolean): Promise<{ following: boolean }> {
    const t = await this.threadRow(this.db, threadId);
    if (t.is_deleted) throw err('THREAD_NOT_FOUND', 404, 'Konu bulunamadı.');
    if (on) await this.db.query('INSERT INTO forum_follows (thread_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.id, user.id]);
    else await this.db.query('DELETE FROM forum_follows WHERE thread_id = $1 AND user_id = $2', [t.id, user.id]);
    return { following: on };
  }

  /** Sabitle, kilitle, taşı, sil, geri getir — moderatör yetkisi sunucuda denetlenir; her işlem denetim kaydına yazılır. */
  async moderate(user: ForumUser, threadId: number, input: unknown): Promise<{ ok: true }> {
    const b = forumModerateSchema.parse(input);
    return this.run(async (c, out) => {
      const t = await this.threadRow(c, threadId, true);
      if (!(await this.canModerate(c, user.id, t.category_id))) throw err('FORBIDDEN', 403, 'Bu işlem için forum moderatörü olmalısın.');
      const before = { pinned: t.is_pinned, locked: t.is_locked, deleted: t.is_deleted, category: t.slug };
      let note: string | null = null;
      switch (b.action) {
        case 'pin':
        case 'unpin':
          await c.query('UPDATE forum_threads SET is_pinned = $2 WHERE id = $1', [t.id, b.action === 'pin']);
          break;
        case 'lock':
        case 'unlock':
          await c.query('UPDATE forum_threads SET is_locked = $2 WHERE id = $1', [t.id, b.action === 'lock']);
          if (b.action === 'lock') note = 'kilitlendi';
          break;
        case 'move': {
          if (!b.category) throw err('VALIDATION_ERROR', 400, 'Taşınacak bölümü seç.');
          const target = await this.categoryBySlug(c, b.category);
          await c.query('UPDATE forum_threads SET category_id = $2 WHERE id = $1', [t.id, target.id]);
          note = `"${target.name}" bölümüne taşındı`;
          break;
        }
        case 'delete':
          await c.query('UPDATE forum_threads SET is_deleted = true, deleted_by = $2, deleted_reason = $3 WHERE id = $1', [t.id, user.id, b.reason ?? null]);
          note = 'silindi';
          break;
        case 'restore':
          await c.query('UPDATE forum_threads SET is_deleted = false, deleted_by = NULL, deleted_reason = NULL WHERE id = $1', [t.id]);
          break;
      }
      await this.audit(c, user, `forum.thread.${b.action}`, 'forum_thread', String(t.id), before, { action: b.action, category: b.category ?? null }, b.reason);
      if (note && t.author_id && t.author_id !== user.id) {
        for (const pid of (await this.pilotsOf(c, [t.author_id])).get(t.author_id) ?? []) {
          await this.notifier.create(c, out, pid, {
            kind: 'forum_moderation',
            title: `Konun ${note}`.slice(0, 120),
            body: `"${t.title}"${b.reason ? ` · Sebep: ${b.reason}` : ''}`,
            link: `/forum/konu/${t.id}`,
          });
        }
      }
      return { ok: true as const };
    });
  }

  async report(user: ForumUser, target: { type: 'forum_post' | 'forum_thread'; id: number }, input: unknown): Promise<{ id: number }> {
    const b = forumReportSchema.parse(input);
    let snapshot: Record<string, unknown>;
    let targetUser: string | null;
    if (target.type === 'forum_post') {
      const r = await this.db.query<{ author_id: string | null; body: string; title: string; author: string | null; is_deleted: boolean }>(
        `SELECT fp.author_id, fp.body, t.title, u.username::text AS author, fp.is_deleted FROM forum_posts fp JOIN forum_threads t ON t.id = fp.thread_id
         LEFT JOIN users u ON u.id = fp.author_id WHERE fp.id = $1`,
        [target.id],
      );
      const p = r.rows[0];
      if (!p || p.is_deleted) throw err('POST_NOT_FOUND', 404, 'Mesaj bulunamadı.');
      targetUser = p.author_id;
      snapshot = { thread: p.title, author: p.author, body: p.body.slice(0, 2000) };
    } else {
      const t = await this.threadRow(this.db, target.id);
      if (t.is_deleted) throw err('THREAD_NOT_FOUND', 404, 'Konu bulunamadı.');
      targetUser = t.author_id;
      snapshot = { title: t.title, author: t.author, category: t.slug };
    }
    if (targetUser === user.id) throw err('VALIDATION_ERROR', 400, 'Kendi içeriğini şikâyet edemezsin.');
    const pilot = targetUser ? (await this.db.query<{ id: string }>('SELECT id FROM players WHERE user_id = $1 ORDER BY server_id LIMIT 1', [targetUser])).rows[0]?.id ?? null : null;
    const reporter = (await this.db.query<{ id: string }>('SELECT id FROM players WHERE user_id = $1 ORDER BY server_id LIMIT 1', [user.id])).rows[0]?.id ?? null;
    try {
      const ins = await this.db.query<{ id: string }>(
        `INSERT INTO reports (reporter_user_id, reporter_player_id, target_type, target_id, target_player_id, reason, details, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
        [user.id, reporter, target.type, String(target.id), pilot, b.reason, b.details || null, JSON.stringify(snapshot)],
      );
      return { id: Number(ins.rows[0]!.id) };
    } catch (e) {
      if (uniqueViolation(e)) throw err('REPORT_EXISTS', 409, 'Bu içerik için zaten açık bir şikâyetin var; moderasyon ekibi inceliyor.');
      throw e;
    }
  }

  /** Bölüm moderatörü atama/kaldırma (yetki: forum.moderators.assign — rota denetler). */
  async assignModerator(actor: ForumUser, input: unknown): Promise<{ moderators: string[] }> {
    const b = forumModeratorSchema.parse(input);
    return this.run(async (c) => {
      const cat = await this.categoryBySlug(c, b.category);
      const u = await c.query<{ id: string; username: string }>('SELECT id, username::text AS username FROM users WHERE username = $1', [b.username]);
      if (!u.rows[0]) throw err('NOT_FOUND', 404, 'Kullanıcı bulunamadı.');
      if (b.assign) {
        await c.query('INSERT INTO forum_moderators (category_id, user_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [cat.id, u.rows[0].id, actor.id]);
      } else {
        await c.query('DELETE FROM forum_moderators WHERE category_id = $1 AND user_id = $2', [cat.id, u.rows[0].id]);
      }
      await this.audit(c, actor, b.assign ? 'forum.moderator.assign' : 'forum.moderator.remove', 'user', u.rows[0].id, null, { category: cat.slug });
      const list = await c.query<{ username: string }>(
        'SELECT u.username::text AS username FROM forum_moderators m JOIN users u ON u.id = m.user_id WHERE m.category_id = $1 ORDER BY u.username',
        [cat.id],
      );
      return { moderators: list.rows.map((x) => x.username) };
    });
  }
}
