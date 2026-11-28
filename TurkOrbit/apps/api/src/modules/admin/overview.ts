/**
 * Yönetim Merkezi — pano, sistem (bakım, duyuru, sunucu durumu), şikâyet kuyruğu, denetim kaydı, klanlar,
 * forum bölümleri ve rol matrisi (Aşama 14).
 */
import {
  ROLES,
  ROLE_LABELS_TR,
  ROLE_RANK,
  adminBroadcastSchema,
  adminMaintenanceSchema,
  adminReportResolveSchema,
  type AdminDashboard,
  type AuditEntryView,
  type GameNodeStatus,
  type PermissionKey,
  type ReportStatus,
  type ReportView,
  type RoleMatrixView,
} from '@turkorbit/shared';
import { z } from 'zod';
import { withTransaction, type Db } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { getSetting } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import type { GameBridge } from '../game/bridge.js';
import type { ApprovalService } from './approvals.js';
import { audit, can, likeEscape, notFound, type AdminActor } from './common.js';

const reason = z.string().trim().min(3, 'Gerekçe en az 3 karakter olmalı.').max(500);
const categoryFields = {
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullable(),
  sortOrder: z.number().int().min(-100).max(1000),
  postPermission: z.enum(['forum.moderate']).nullable(),
  isArchived: z.boolean(),
  reason,
};
const categoryUpdateSchema = z.strictObject(categoryFields);
const categoryCreateSchema = z.strictObject({ ...categoryFields, slug: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Kısa ad küçük harf, rakam ve tire olmalı.') });

export interface AuditQuery {
  actor?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  before?: number;
}

export class AdminOverviewService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly bridge: GameBridge,
    private readonly approvals: ApprovalService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ================================================================== pano ve sistem
  private async nodes(): Promise<GameNodeStatus[]> {
    const raw = (await this.bridge.nodes().catch(() => [])) as GameNodeStatus[];
    return raw.filter((n) => n && typeof n.id === 'string').sort((a, b) => a.id.localeCompare(b.id));
  }

  private async apiHealth() {
    const t0 = performance.now();
    await this.db.query('SELECT 1');
    const dbMs = Math.round((performance.now() - t0) * 10) / 10;
    const redisMs = await this.bridge.ping();
    return { uptimeSec: Math.round((Date.now() - this.startedAt) / 1000), rssMb: Math.round(process.memoryUsage().rss / 1048576), dbMs, redisMs };
  }

  async maintenanceState(): Promise<{ enabled: boolean; message: string }> {
    const m = (await getSetting<{ enabled?: boolean; message?: string }>(this.db, 'maintenance')) ?? {};
    return { enabled: m.enabled === true, message: m.message ?? 'Türk Orbit bakımda.' };
  }

  async dashboard(actor: AdminActor): Promise<AdminDashboard> {
    const [counts, maps, platforms, presence, nodes, api, maintenance] = await Promise.all([
      this.db.query<{ total: string; today: string; week: string; pilots: string }>(
        `SELECT (SELECT count(*) FROM users WHERE status <> 'deleted')::text AS total,
                (SELECT count(*) FROM users WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')::text AS today,
                (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days')::text AS week,
                (SELECT count(*) FROM players)::text AS pilots`,
      ),
      this.db.query<{ code: string; name: string }>('SELECT code, name FROM maps WHERE NOT is_archived ORDER BY code'),
      this.db.query<{ platform: string; n: string }>(
        `SELECT platform, count(*)::text AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > now() AND last_seen_at > now() - interval '1 day'
         GROUP BY platform ORDER BY count(*) DESC`,
      ),
      this.bridge.allPresence().catch(() => []),
      this.nodes(),
      this.apiHealth(),
      this.maintenanceState(),
    ]);
    const perMap = new Map<string, number>();
    for (const p of presence) perMap.set(p.map, (perMap.get(p.map) ?? 0) + 1);
    const c = counts.rows[0]!;
    const [tickets, reports, pending, recent] = await Promise.all([
      can(actor, 'support.read')
        ? this.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM support_tickets WHERE status IN ('waiting_staff', 'waiting_player')`).then((r) => Number(r.rows[0]!.n))
        : Promise.resolve(null),
      can(actor, 'chat.reports.read')
        ? this.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM reports WHERE status IN ('open', 'in_review')`).then((r) => Number(r.rows[0]!.n))
        : Promise.resolve(null),
      this.approvals.pendingCount(actor),
      can(actor, 'audit.read') ? this.audit({}).then((r) => r.entries.slice(0, 8)) : Promise.resolve(null),
    ]);
    return {
      players: { total: Number(c.total), registeredToday: Number(c.today), registered7d: Number(c.week), pilots: Number(c.pilots), online: presence.length },
      maps: maps.rows.map((m) => ({ code: m.code, name: m.name, online: perMap.get(m.code) ?? 0 })),
      nodes,
      api,
      queues: { openTickets: tickets, openReports: reports, pendingApprovals: pending },
      platforms: platforms.rows.map((p) => ({ platform: p.platform, sessions: Number(p.n) })),
      maintenance,
      recentAudit: recent,
    };
  }

  async system() {
    const [nodes, api, maintenance, presence] = await Promise.all([this.nodes(), this.apiHealth(), this.maintenanceState(), this.bridge.allPresence().catch(() => [])]);
    return { nodes, api, maintenance, online: presence.length };
  }

  async setMaintenance(actor: AdminActor, input: unknown) {
    const b = adminMaintenanceSchema.parse(input);
    const before = await this.maintenanceState();
    await withTransaction(this.db, async (c) => {
      await c.query(
        `INSERT INTO game_settings (key, value, updated_by, updated_at) VALUES ('maintenance', $1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [JSON.stringify({ enabled: b.enabled, message: b.message }), actor.userId],
      );
      await audit(c, actor, { action: b.enabled ? 'system.maintenance.on' : 'system.maintenance.off', targetType: 'setting', targetId: 'maintenance', before, after: { enabled: b.enabled, message: b.message }, reason: b.reason });
    });
    await this.bridge.publishAdmin({ type: 'maintenance', enabled: b.enabled, message: b.message });
    return { maintenance: { enabled: b.enabled, message: b.message } };
  }

  async broadcast(actor: AdminActor, input: unknown) {
    const b = adminBroadcastSchema.parse(input);
    const online = (await this.bridge.allPresence().catch(() => [])).length;
    await withTransaction(this.db, (c) => audit(c, actor, { action: 'system.broadcast', targetType: 'game', targetId: 'all', after: { text: b.text, online }, reason: b.reason }));
    await this.bridge.publishAdmin({ type: 'announce', text: b.text });
    return { sent: true, online };
  }

  // ================================================================== denetim kaydı
  async audit(q: AuditQuery): Promise<{ entries: AuditEntryView[]; next: number | null }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.actor) add(`actor_label ILIKE ? ESCAPE '\\'`, `${likeEscape(q.actor.slice(0, 40))}%`);
    if (q.action) add(`action LIKE ? ESCAPE '\\'`, `${likeEscape(q.action.slice(0, 60))}%`);
    if (q.targetType) add('target_type = ?', q.targetType.slice(0, 40));
    if (q.targetId) add('target_id = ?', q.targetId.slice(0, 80));
    if (q.before && Number.isSafeInteger(q.before)) add('id < ?', q.before);
    const r = await this.db.query<{
      id: string; actor_label: string; action: string; target_type: string | null; target_id: string | null; before_value: unknown; after_value: unknown;
      reason: string | null; result: AuditEntryView['result']; ip: string | null; created_at: Date;
    }>(
      `SELECT id::text, actor_label, action, target_type, target_id, before_value, after_value, reason, result, host(ip) AS ip, created_at
       FROM admin_audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 51`,
      params,
    );
    const rows = r.rows.slice(0, 50);
    return {
      entries: rows.map((x) => ({
        id: Number(x.id),
        actor: x.actor_label,
        action: x.action,
        targetType: x.target_type,
        targetId: x.target_id,
        before: x.before_value,
        after: x.after_value,
        reason: x.reason,
        result: x.result,
        ip: x.ip,
        at: x.created_at.toISOString(),
      })),
      next: r.rows.length > 50 ? Number(rows[rows.length - 1]!.id) : null,
    };
  }

  // ================================================================== şikâyetler
  async reports(status: string): Promise<ReportView[]> {
    const st = (['open', 'in_review', 'actioned', 'dismissed'] as const).includes(status as ReportStatus) ? status : 'open';
    const r = await this.db.query<{
      id: string; target_type: string; target_id: string; reason: string; details: string | null; snapshot: Record<string, unknown>; status: ReportStatus;
      reporter: string; target_user_id: string | null; target_username: string | null; target_pilot: string | null; handled_by: string | null; resolution_note: string | null; created_at: Date;
    }>(
      `SELECT r.id::text, r.target_type, r.target_id, r.reason, r.details, r.snapshot, r.status, ru.username::text AS reporter,
              tu.id AS target_user_id, tu.username::text AS target_username, tp.pilot_name::text AS target_pilot,
              hu.username::text AS handled_by, r.resolution_note, r.created_at
       FROM reports r JOIN users ru ON ru.id = r.reporter_user_id
       LEFT JOIN players tp ON tp.id = r.target_player_id LEFT JOIN users tu ON tu.id = tp.user_id
       LEFT JOIN users hu ON hu.id = r.handled_by
       WHERE r.status = $1 ORDER BY r.created_at ${st === 'open' || st === 'in_review' ? 'ASC' : 'DESC'} LIMIT 100`,
      [st],
    );
    return r.rows.map((x) => ({
      id: Number(x.id),
      targetType: x.target_type,
      targetId: x.target_id,
      reason: x.reason,
      details: x.details,
      snapshot: x.snapshot,
      status: x.status,
      reporter: x.reporter,
      target: { userId: x.target_user_id, username: x.target_username, pilot: x.target_pilot },
      handledBy: x.handled_by,
      resolutionNote: x.resolution_note,
      createdAt: x.created_at.toISOString(),
    }));
  }

  async resolveReport(actor: AdminActor, id: number, input: unknown) {
    const b = adminReportResolveSchema.parse(input);
    await withTransaction(this.db, async (c) => {
      const r = await c.query<{ status: string }>('SELECT status FROM reports WHERE id = $1 FOR UPDATE', [id]);
      if (!r.rows[0]) throw notFound('REPORT_NOT_FOUND', 'Şikâyet');
      if (r.rows[0].status === 'actioned' || r.rows[0].status === 'dismissed') throw new AppError('VALIDATION_ERROR', 409, 'Bu şikâyet zaten sonuçlandı.');
      await c.query(`UPDATE reports SET status = $2, handled_by = $3, handled_at = $4, resolution_note = $5 WHERE id = $1`, [id, b.status, actor.userId, this.now(), b.note ?? null]);
      await audit(c, actor, { action: 'report.resolve', targetType: 'report', targetId: String(id), before: { status: r.rows[0].status }, after: { status: b.status }, reason: b.note ?? null });
    });
    return { ok: true };
  }

  // ================================================================== klanlar (salt okunur)
  async clans(q: string) {
    const like = `${likeEscape(q.trim().slice(0, 40))}%`;
    const r = await this.db.query<{ id: string; tag: string; name: string; server: string; members: string; leader: string | null; treasury: string | null; created_at: Date }>(
      `SELECT c.id, c.tag::text, c.name::text, s.code AS server,
              (SELECT count(*) FROM clan_members m WHERE m.clan_id = c.id)::text AS members,
              lp.pilot_name::text AS leader,
              (SELECT balance::text FROM clan_wallets w WHERE w.clan_id = c.id AND w.currency_code = 'KREDI') AS treasury, c.created_at
       FROM clans c JOIN game_servers s ON s.id = c.server_id LEFT JOIN players lp ON lp.id = c.leader_id
       WHERE $1 = '%' OR c.tag ILIKE $1 ESCAPE '\\' OR c.name ILIKE $1 ESCAPE '\\'
       ORDER BY c.created_at DESC LIMIT 100`,
      [like],
    );
    return r.rows.map((x) => ({ id: x.id, tag: x.tag, name: x.name, server: x.server, members: Number(x.members), leader: x.leader, treasury: Number(x.treasury ?? 0), createdAt: x.created_at.toISOString() }));
  }

  async clan(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('CONTENT_NOT_FOUND', 'Klan');
    const c = await this.db.query<{ id: string; tag: string; name: string; description: string | null; tax_percent: number; is_recruiting: boolean; server: string; created_at: Date }>(
      `SELECT c.id, c.tag::text, c.name::text, c.description, c.tax_percent, c.is_recruiting, s.code AS server, c.created_at
       FROM clans c JOIN game_servers s ON s.id = c.server_id WHERE c.id = $1`,
      [id],
    );
    if (!c.rows[0]) throw notFound('CONTENT_NOT_FOUND', 'Klan');
    const [members, events, wallets] = await Promise.all([
      this.db.query<{ player_id: string; pilot: string; username: string; user_id: string; rank: string; joined_at: Date }>(
        `SELECT m.player_id, p.pilot_name::text AS pilot, u.username::text, u.id AS user_id, r.name AS rank, m.joined_at
         FROM clan_members m JOIN players p ON p.id = m.player_id JOIN users u ON u.id = p.user_id JOIN clan_ranks r ON r.id = m.rank_id
         WHERE m.clan_id = $1 ORDER BY r.sort_order, m.joined_at`,
        [id],
      ),
      this.db.query<{ kind: string; actor_name: string | null; target_name: string | null; created_at: Date }>(
        'SELECT kind, actor_name, target_name, created_at FROM clan_events WHERE clan_id = $1 ORDER BY id DESC LIMIT 30',
        [id],
      ),
      this.db.query<{ currency_code: string; balance: string }>('SELECT currency_code, balance::text FROM clan_wallets WHERE clan_id = $1', [id]),
    ]);
    const x = c.rows[0];
    return {
      id: x.id,
      tag: x.tag,
      name: x.name,
      description: x.description,
      taxPercent: x.tax_percent,
      recruiting: x.is_recruiting,
      server: x.server,
      createdAt: x.created_at.toISOString(),
      treasury: Object.fromEntries(wallets.rows.map((w) => [w.currency_code, Number(w.balance)])),
      members: members.rows.map((m) => ({ playerId: m.player_id, pilot: m.pilot, username: m.username, userId: m.user_id, rank: m.rank, joinedAt: m.joined_at.toISOString() })),
      events: events.rows.map((e) => ({ kind: e.kind, actor: e.actor_name, target: e.target_name, at: e.created_at.toISOString() })),
    };
  }

  // ================================================================== forum bölümleri
  async forumCategories() {
    const r = await this.db.query<{ id: number; slug: string; name: string; description: string | null; sort_order: number; post_permission: string | null; is_archived: boolean; threads: string; moderators: string[] | null }>(
      `SELECT c.id, c.slug, c.name, c.description, c.sort_order, c.post_permission, c.is_archived,
              (SELECT count(*) FROM forum_threads t WHERE t.category_id = c.id AND NOT t.is_deleted)::text AS threads,
              (SELECT array_agg(u.username::text ORDER BY u.username) FROM forum_moderators m JOIN users u ON u.id = m.user_id WHERE m.category_id = c.id) AS moderators
       FROM forum_categories c ORDER BY c.sort_order, c.id`,
    );
    return r.rows.map((x) => ({
      id: x.id,
      slug: x.slug,
      name: x.name,
      description: x.description,
      sortOrder: x.sort_order,
      postPermission: x.post_permission,
      isArchived: x.is_archived,
      threads: Number(x.threads),
      moderators: x.moderators ?? [],
    }));
  }

  async updateForumCategory(actor: AdminActor, id: number, input: unknown) {
    const b = categoryUpdateSchema.parse(input);
    await withTransaction(this.db, async (c) => {
      const r = await c.query<Record<string, unknown>>('SELECT name, description, sort_order, post_permission, is_archived FROM forum_categories WHERE id = $1 FOR UPDATE', [id]);
      if (!r.rows[0]) throw notFound('CONTENT_NOT_FOUND', 'Forum bölümü');
      await c.query('UPDATE forum_categories SET name = $2, description = $3, sort_order = $4, post_permission = $5, is_archived = $6 WHERE id = $1', [
        id, b.name, b.description, b.sortOrder, b.postPermission, b.isArchived,
      ]);
      await audit(c, actor, { action: 'forum.category.update', targetType: 'forum_category', targetId: String(id), before: r.rows[0], after: { name: b.name, description: b.description, sort_order: b.sortOrder, post_permission: b.postPermission, is_archived: b.isArchived }, reason: b.reason });
    });
    return { categories: await this.forumCategories() };
  }

  async createForumCategory(actor: AdminActor, input: unknown) {
    const b = categoryCreateSchema.parse(input);
    await withTransaction(this.db, async (c) => {
      const taken = await c.query('SELECT 1 FROM forum_categories WHERE slug = $1', [b.slug]);
      if (taken.rowCount) throw new AppError('VALIDATION_ERROR', 409, 'Bu kısa ad kullanılıyor.', { fields: { slug: ['Bu kısa ad kullanılıyor.'] } });
      const r = await c.query<{ id: number }>(
        'INSERT INTO forum_categories (slug, name, description, sort_order, post_permission, is_archived) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [b.slug, b.name, b.description, b.sortOrder, b.postPermission, b.isArchived],
      );
      await audit(c, actor, { action: 'forum.category.create', targetType: 'forum_category', targetId: String(r.rows[0]!.id), after: { slug: b.slug, name: b.name }, reason: b.reason });
    });
    return { categories: await this.forumCategories() };
  }

  // ================================================================== roller
  async roles(): Promise<RoleMatrixView> {
    const [perms, members] = await Promise.all([
      this.db.query<{ role_key: string; permission_key: PermissionKey }>('SELECT role_key, permission_key FROM role_permissions ORDER BY permission_key'),
      this.db.query<{ role_key: string; n: string }>('SELECT role_key, count(*)::text AS n FROM user_roles GROUP BY role_key'),
    ]);
    const count = new Map(members.rows.map((m) => [m.role_key, Number(m.n)]));
    return {
      roles: ROLES.filter((r) => r !== 'player').map((key) => ({
        key,
        label: ROLE_LABELS_TR[key],
        rank: ROLE_RANK[key],
        permissions: perms.rows.filter((p) => p.role_key === key).map((p) => p.permission_key),
        members: count.get(key) ?? 0,
      })),
    };
  }

  /** Belirli bir roldeki personel listesi */
  async roleMembers(role: string) {
    if (!(ROLES as readonly string[]).includes(role) || role === 'player') throw notFound('CONTENT_NOT_FOUND', 'Rol');
    const r = await this.db.query<{ id: string; username: string; granted_at: Date; granted_by: string | null; reason: string | null }>(
      `SELECT u.id, u.username::text, ur.granted_at, gu.username::text AS granted_by, ur.reason
       FROM user_roles ur JOIN users u ON u.id = ur.user_id LEFT JOIN users gu ON gu.id = ur.granted_by
       WHERE ur.role_key = $1 ORDER BY ur.granted_at`,
      [role],
    );
    return r.rows.map((x) => ({ userId: x.id, username: x.username, grantedAt: x.granted_at.toISOString(), grantedBy: x.granted_by, reason: x.reason }));
  }
}
