/**
 * Yönetim Merkezi — oyuncu yönetimi (Aşama 14): arama, ayrıntı, yaptırımlar, oturum sonlandırma, rol atama,
 * para/eşya verme.
 *
 * Her işlem: rota yetkisi + hedef rütbe kontrolü → işlem + denetim kaydı (aynı transaction) → commit sonrası
 * oyuncuya bildirim ve oyun sunucularına olay (ban/askı/kilit: bağlantı anında kapanır).
 */
import { randomUUID } from 'node:crypto';
import {
  ROLE_LABELS_TR,
  ROLE_RANK,
  adminGrantSchema,
  adminReasonSchema,
  adminRoleChangeSchema,
  adminSanctionSchema,
  levelForXp,
  type AdminPlayerDetail,
  type AdminPlayerSummary,
  type ApprovalView,
  type RoleKey,
  type SanctionKind,
  type SanctionView,
} from '@turkorbit/shared';
import { withTransaction, type Db, type DbClient, type Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { getSetting, getUserRoles } from '../auth/repository.js';
import type { AuthService, Logger } from '../auth/service.js';
import { grantItem } from '../economy/inventory.js';
import { applyCurrencyChange } from '../economy/wallet.js';
import type { GameBridge } from '../game/bridge.js';
import { Outbox, type Notifier } from '../social/notifications.js';
import type { ApprovalService, ExecContext, ExecResult } from './approvals.js';
import { assertCanActOn, audit, fmt, iso, likeEscape, notFound, type AdminActor } from './common.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const trDate = (d: Date) => d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' });

export interface AdminPlayersDeps {
  db: Db;
  log: Logger;
  auth: AuthService;
  bridge: GameBridge;
  notifier: Notifier;
  approvals: ApprovalService;
  clock?: () => Date;
}

interface UserRow {
  id: string;
  public_id: string;
  username: string;
  email: string;
  email_verified_at: Date | null;
  status: AdminPlayerSummary['status'];
  suspended_until: Date | null;
  locked_until: Date | null;
  status_reason: string | null;
  created_at: Date;
}

export class AdminPlayerService {
  constructor(private readonly d: AdminPlayersDeps) {
    d.approvals.executors['economy.grant'] = (c, ctx) => this.execGrant(c, ctx);
    d.approvals.executors['player.ban.permanent'] = (c, ctx) => this.execBan(c, ctx);
    d.approvals.executors['role.grant.super_admin'] = (c, ctx) => this.execRole(c, ctx);
  }

  private now() {
    return this.d.clock?.() ?? new Date();
  }

  // ================================================================== arama ve ayrıntı
  async search(qRaw: string): Promise<AdminPlayerSummary[]> {
    const q = qRaw.trim().slice(0, 80);
    if (q.length < 2) return [];
    const like = `${likeEscape(q)}%`;
    const r = await this.d.db.query<UserRow & { roles: RoleKey[] }>(
      `SELECT u.id, u.public_id::text, u.username::text, u.email::text, u.email_verified_at, u.status, u.suspended_until, u.locked_until,
              u.status_reason, u.created_at,
              COALESCE((SELECT array_agg(ur.role_key ORDER BY ur.role_key) FROM user_roles ur WHERE ur.user_id = u.id), '{}') AS roles
       FROM users u
       WHERE u.status <> 'deleted' AND (
             u.username ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM players p WHERE p.user_id = u.id AND (p.pilot_name ILIKE $1 ESCAPE '\\' OR ($3::uuid IS NOT NULL AND p.id = $3::uuid)))
          OR ($2::bigint IS NOT NULL AND u.public_id = $2::bigint)
          OR ($3::uuid IS NOT NULL AND u.id = $3::uuid)
          OR ($4::inet IS NOT NULL AND (EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id AND le.ip = $4::inet)
                                     OR EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.ip = $4::inet))))
       ORDER BY u.username LIMIT 25`,
      [like, /^\d{1,15}$/.test(q) ? q : null, UUID.test(q) ? q : null, IPV4.test(q) || q.includes(':') ? q : null],
    ).catch((err: unknown) => {
      // geçersiz IP biçimi gibi durumlarda boş sonuç
      if ((err as { code?: string }).code === '22P02') return { rows: [] };
      throw err;
    });
    return this.summaries(r.rows);
  }

  private async summaries(rows: Array<UserRow & { roles: RoleKey[] }>): Promise<AdminPlayerSummary[]> {
    if (rows.length === 0) return [];
    const pilots = await this.d.db.query<{ id: string; user_id: string; pilot_name: string; server: string; experience: string }>(
      `SELECT p.id, p.user_id, p.pilot_name::text, s.code AS server, p.experience::text
       FROM players p JOIN game_servers s ON s.id = p.server_id WHERE p.user_id = ANY($1::uuid[]) ORDER BY s.code`,
      [rows.map((u) => u.id)],
    );
    const online = await this.d.bridge.presenceMany(pilots.rows.map((p) => p.id));
    return rows.map((u) => ({
      userId: u.id,
      publicId: Number(u.public_id),
      username: u.username,
      email: u.email,
      status: u.status,
      roles: u.roles,
      createdAt: u.created_at.toISOString(),
      pilots: pilots.rows
        .filter((p) => p.user_id === u.id)
        .map((p) => ({ id: p.id, name: p.pilot_name, server: p.server, level: levelForXp(Number(p.experience)), online: online.has(p.id) })),
    }));
  }

  private async user(c: Queryable, userId: string, lock = false): Promise<UserRow> {
    if (!UUID.test(userId)) throw notFound('USER_NOT_FOUND', 'Kullanıcı');
    const r = await c.query<UserRow>(
      `SELECT id, public_id::text, username::text, email::text, email_verified_at, status, suspended_until, locked_until, status_reason, created_at
       FROM users WHERE id = $1 AND status <> 'deleted' ${lock ? 'FOR UPDATE' : ''}`,
      [userId],
    );
    if (!r.rows[0]) throw notFound('USER_NOT_FOUND', 'Kullanıcı');
    return r.rows[0];
  }

  async detail(userId: string): Promise<AdminPlayerDetail> {
    const db = this.d.db;
    const u = await this.user(db, userId);
    const roles = await getUserRoles(db, u.id);
    const [summary] = await this.summaries([{ ...u, roles }]);
    const [sanctions, sessions, logins, pilots] = await Promise.all([
      this.sanctions(db, u.id),
      db.query<{ id: string; platform: string; browser: string | null; os: string | null; ip: string | null; created_at: Date; last_seen_at: Date }>(
        `SELECT id, platform, browser, os, host(ip) AS ip, created_at, last_seen_at FROM sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC LIMIT 20`,
        [u.id],
      ),
      db.query<{ success: boolean; failure_reason: string | null; platform: string; ip: string | null; created_at: Date }>(
        `SELECT success, failure_reason, platform, host(ip) AS ip, created_at FROM login_events WHERE user_id = $1 ORDER BY id DESC LIMIT 20`,
        [u.id],
      ),
      db.query<{
        id: string; pilot_name: string; server: string; company: string; experience: string; honor: string; map: string | null;
        clan: string | null; ship: string | null; items: string; quests: string;
      }>(
        `SELECT p.id, p.pilot_name::text, s.code AS server, co.code AS company, p.experience::text, p.honor::text, m.code AS map,
                cl.tag::text AS clan, st.name AS ship,
                (SELECT count(*) FROM player_items pi WHERE pi.player_id = p.id)::text AS items,
                (SELECT count(*) FROM player_quests pq WHERE pq.player_id = p.id AND pq.status = 'active')::text AS quests
         FROM players p
         JOIN game_servers s ON s.id = p.server_id JOIN companies co ON co.id = p.company_id
         LEFT JOIN maps m ON m.id = p.map_id
         LEFT JOIN clan_members cm ON cm.player_id = p.id LEFT JOIN clans cl ON cl.id = cm.clan_id
         LEFT JOIN player_ships ps ON ps.id = p.active_ship_id LEFT JOIN ship_types st ON st.id = ps.ship_type_id
         WHERE p.user_id = $1 ORDER BY s.code`,
        [u.id],
      ),
    ]);
    const wallets = await db.query<{ player_id: string; currency_code: string; balance: string }>(
      'SELECT player_id, currency_code, balance::text FROM wallets WHERE player_id = ANY($1::uuid[])',
      [pilots.rows.map((p) => p.id)],
    );
    const presence = await this.d.bridge.presenceMany(pilots.rows.map((p) => p.id));
    const mute = sanctions.find((s) => s.kind === 'mute' && s.active);
    return {
      ...summary!,
      emailVerified: u.email_verified_at !== null,
      suspendedUntil: iso(u.suspended_until),
      lockedUntil: iso(u.locked_until),
      statusReason: u.status_reason,
      mutedUntil: mute?.endsAt ?? null,
      sanctions,
      sessions: sessions.rows.map((s) => ({ id: s.id, platform: s.platform, browser: s.browser, os: s.os, ip: s.ip, createdAt: s.created_at.toISOString(), lastSeenAt: s.last_seen_at.toISOString() })),
      logins: logins.rows.map((l) => ({ success: l.success, reason: l.failure_reason, platform: l.platform, ip: l.ip, at: l.created_at.toISOString() })),
      pilotDetails: pilots.rows.map((p) => ({
        id: p.id,
        name: p.pilot_name,
        server: p.server,
        company: p.company,
        level: levelForXp(Number(p.experience)),
        experience: Number(p.experience),
        honor: Number(p.honor),
        map: presence.get(p.id)?.map ?? p.map,
        online: presence.has(p.id),
        clan: p.clan,
        wallets: Object.fromEntries(wallets.rows.filter((w) => w.player_id === p.id).map((w) => [w.currency_code, Number(w.balance)])),
        ship: p.ship,
        items: Number(p.items),
        activeQuests: Number(p.quests),
      })),
    };
  }

  private async sanctions(c: Queryable, userId: string): Promise<SanctionView[]> {
    const now = this.now().getTime();
    const r = await c.query<{
      id: string; kind: SanctionKind; reason: string; public_reason: string | null; starts_at: Date; ends_at: Date | null; issued_label: string;
      revoked_at: Date | null; revoked_label: string | null; revoke_reason: string | null;
    }>(
      `SELECT s.id::text, s.kind, s.reason, s.public_reason, s.starts_at, s.ends_at, s.issued_label, s.revoked_at,
              ru.username::text AS revoked_label, s.revoke_reason
       FROM sanctions s LEFT JOIN users ru ON ru.id = s.revoked_by WHERE s.user_id = $1 ORDER BY s.id DESC LIMIT 100`,
      [userId],
    );
    return r.rows.map((s) => ({
      id: Number(s.id),
      kind: s.kind,
      reason: s.reason,
      publicReason: s.public_reason,
      startsAt: s.starts_at.toISOString(),
      endsAt: iso(s.ends_at),
      issuedBy: s.issued_label,
      active: s.kind !== 'warning' && !s.revoked_at && (s.ends_at === null || s.ends_at.getTime() > now),
      revokedAt: iso(s.revoked_at),
      revokedBy: s.revoked_label,
      revokeReason: s.revoke_reason,
    }));
  }

  // ================================================================== yaptırımlar
  private async notifyUser(c: Queryable, out: Outbox, userId: string, title: string, body: string) {
    const pilots = await c.query<{ id: string }>('SELECT id FROM players WHERE user_id = $1', [userId]);
    for (const p of pilots.rows) await this.d.notifier.create(c, out, p.id, { kind: 'sanction', title, body });
  }

  /**
   * kind rotadan gelir (rota yetkisi: uyarı players.warn, susturma chat.moderate, askı/ban players.ban, kilit players.lock).
   * Kalıcı ban doğrudan uygulanmaz: iki yetkili onayı talebi oluşturur.
   */
  async sanction(actor: AdminActor, userId: string, kind: SanctionKind, input: unknown): Promise<{ status: 'applied' | 'pending_approval'; approval?: ApprovalView }> {
    const b = adminSanctionSchema.parse({ ...(input as object), kind });
    const out = new Outbox();
    let kick: string | null = null;
    let reloadMute = false;
    const res = await withTransaction(this.d.db, async (c) => {
      const u = await this.user(c, userId, true);
      await assertCanActOn(c, actor, u.id);
      if (u.status === 'banned' && kind !== 'warning') throw new AppError('VALIDATION_ERROR', 409, 'Hesap zaten kalıcı olarak yasaklı.');
      if (b.reportId) {
        const rep = await c.query('SELECT 1 FROM reports WHERE id = $1', [b.reportId]);
        if (!rep.rowCount) throw notFound('REPORT_NOT_FOUND', 'Şikâyet');
      }
      if (kind === 'ban') {
        const pending = await c.query(
          `SELECT 1 FROM approval_requests WHERE action = 'player.ban.permanent' AND status = 'pending' AND payload->>'userId' = $1 AND expires_at > $2`,
          [u.id, this.now()],
        );
        if (pending.rowCount) throw new AppError('VALIDATION_ERROR', 409, 'Bu hesap için zaten bekleyen bir kalıcı ban talebi var.');
        const approval = await this.d.approvals.create(
          c,
          actor,
          'player.ban.permanent',
          { userId: u.id, username: u.username, reason: b.reason, publicReason: b.publicReason ?? null, reportId: b.reportId ?? null },
          `${u.username} → kalıcı ban`,
          b.reason,
        );
        return { status: 'pending_approval' as const, approval };
      }
      const now = this.now();
      const ends = b.hours ? new Date(now.getTime() + b.hours * 3_600_000) : null;
      const s = await c.query<{ id: string }>(
        `INSERT INTO sanctions (user_id, kind, reason, public_reason, starts_at, ends_at, issued_by, issued_label, report_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $5) RETURNING id::text`,
        [u.id, kind, b.reason, b.publicReason ?? null, now, ends, actor.userId, actor.label, b.reportId ?? null],
      );
      const before = { status: u.status, suspendedUntil: iso(u.suspended_until), lockedUntil: iso(u.locked_until) };
      let after: Record<string, unknown> = { sanctionId: Number(s.rows[0]!.id), kind, endsAt: iso(ends) };
      if (kind === 'warning') {
        await this.notifyUser(c, out, u.id, 'Uyarı aldın', b.publicReason ?? 'Topluluk kurallarına uymadığın için Türk Orbit ekibi tarafından uyarıldın.');
      } else if (kind === 'mute') {
        reloadMute = true;
        await this.notifyUser(c, out, u.id, 'Susturuldun', `${trDate(ends!)} (TSİ) tarihine kadar sohbete ve foruma yazamazsın.${b.publicReason ? ` Gerekçe: ${b.publicReason}` : ''}`);
      } else if (kind === 'suspension') {
        await c.query(`UPDATE users SET status = 'suspended', suspended_until = $2, status_reason = $3 WHERE id = $1`, [u.id, ends, b.publicReason ?? null]);
        await this.d.auth.revokeAllForUser(u.id, 'admin_suspension', c);
        kick = `Hesabın ${trDate(ends!)} (TSİ) tarihine kadar askıya alındı.${b.publicReason ? ` Gerekçe: ${b.publicReason}` : ''}`;
        after = { ...after, status: 'suspended' };
      } else if (kind === 'lock') {
        await c.query('UPDATE users SET locked_until = $2 WHERE id = $1', [u.id, ends]);
        await this.d.auth.revokeAllForUser(u.id, 'admin_lock', c);
        kick = 'Hesabın güvenlik nedeniyle geçici olarak kilitlendi. Destek ekibiyle iletişime geç.';
        after = { ...after, lockedUntil: iso(ends) };
      }
      if (b.reportId) {
        await c.query(`UPDATE reports SET status = 'actioned', handled_by = $2, handled_at = $3 WHERE id = $1 AND status IN ('open', 'in_review')`, [b.reportId, actor.userId, now]);
      }
      await audit(c, actor, { action: `player.${kind}`, targetType: 'user', targetId: u.id, before, after, reason: b.reason });
      return { status: 'applied' as const };
    });
    await this.d.notifier.flush(out);
    if (kick) await this.d.bridge.publishAdmin({ type: 'sanction', userId, kick: true, message: kick });
    else if (reloadMute) await this.d.bridge.publishAdmin({ type: 'sanction', userId, kick: false });
    return res;
  }

  /** Onaylanan kalıcı ban (onaylayan yetkilinin transaction'ında). */
  private async execBan(c: DbClient, ctx: ExecContext): Promise<ExecResult> {
    const p = ctx.payload as { userId: string; reason: string; publicReason: string | null; reportId: number | null };
    const u = await this.user(c, p.userId, true);
    if (u.status === 'banned') throw new AppError('VALIDATION_ERROR', 409, 'Hesap zaten yasaklı.');
    // Talep sonrası hedefe yüksek rol verildiyse rütbe kuralı yeniden uygulanır
    await assertCanActOn(c, ctx.approver, u.id);
    const now = this.now();
    await c.query(
      `INSERT INTO sanctions (user_id, kind, reason, public_reason, starts_at, issued_by, issued_label, report_id, created_at)
       VALUES ($1, 'ban', $2, $3, $4, $5, $6, $7, $4)`,
      [u.id, p.reason, p.publicReason, now, ctx.requestedBy.id, `${ctx.requestedBy.label} (onay: ${ctx.approver.label})`, p.reportId],
    );
    await c.query(`UPDATE users SET status = 'banned', status_reason = $2 WHERE id = $1`, [u.id, p.publicReason]);
    await this.d.auth.revokeAllForUser(u.id, 'admin_ban', c);
    if (p.reportId) await c.query(`UPDATE reports SET status = 'actioned', handled_by = $2, handled_at = $3 WHERE id = $1 AND status IN ('open', 'in_review')`, [p.reportId, ctx.approver.userId, now]);
    await audit(c, ctx.approver, {
      action: 'player.ban',
      targetType: 'user',
      targetId: u.id,
      before: { status: u.status },
      after: { status: 'banned', requestedBy: ctx.requestedBy.label, approvalId: ctx.approvalId },
      reason: p.reason,
    });
    const message = `Hesabın kalıcı olarak yasaklandı.${p.publicReason ? ` Gerekçe: ${p.publicReason}` : ''}`;
    return { result: { banned: u.username }, after: () => this.d.bridge.publishAdmin({ type: 'sanction', userId: u.id, kick: true, message }) };
  }

  /** what: mute → susturma kaldırılır · ban → askı ve kalıcı ban kaldırılır · lock → kilit kaldırılır */
  async revoke(actor: AdminActor, userId: string, what: 'mute' | 'ban' | 'lock', input: unknown): Promise<{ revoked: number }> {
    const b = adminReasonSchema.parse(input);
    const kinds = what === 'mute' ? ['mute'] : what === 'ban' ? ['suspension', 'ban'] : ['lock'];
    const res = await withTransaction(this.d.db, async (c) => {
      const u = await this.user(c, userId, true);
      await assertCanActOn(c, actor, u.id);
      const now = this.now();
      const r = await c.query(
        `UPDATE sanctions SET revoked_at = $3, revoked_by = $4, revoke_reason = $5
         WHERE user_id = $1 AND kind = ANY($2::text[]) AND revoked_at IS NULL AND (ends_at IS NULL OR ends_at > $3)`,
        [u.id, kinds, now, actor.userId, b.reason],
      );
      const before = { status: u.status, suspendedUntil: iso(u.suspended_until), lockedUntil: iso(u.locked_until) };
      if (what === 'ban' && (u.status === 'suspended' || u.status === 'banned')) {
        await c.query(`UPDATE users SET status = 'active', suspended_until = NULL, status_reason = NULL WHERE id = $1`, [u.id]);
      } else if (what === 'lock' && u.locked_until) {
        await c.query('UPDATE users SET locked_until = NULL WHERE id = $1', [u.id]);
      } else if ((r.rowCount ?? 0) === 0) {
        throw notFound('SANCTION_NOT_FOUND', 'Kaldırılacak etkin yaptırım');
      }
      await this.d.auth.dropSessionCache(u.id, c);
      await audit(c, actor, { action: `player.un${what}`, targetType: 'user', targetId: u.id, before, after: { revoked: r.rowCount ?? 0 }, reason: b.reason });
      return { revoked: r.rowCount ?? 0 };
    });
    if (what === 'mute') await this.d.bridge.publishAdmin({ type: 'sanction', userId, kick: false });
    return res;
  }

  async revokeSessions(actor: AdminActor, userId: string, input: unknown): Promise<{ revoked: number }> {
    const b = adminReasonSchema.parse(input);
    const n = await withTransaction(this.d.db, async (c) => {
      const u = await this.user(c, userId, true);
      await assertCanActOn(c, actor, u.id);
      const count = await this.d.auth.revokeAllForUser(u.id, 'admin_revoked', c);
      await audit(c, actor, { action: 'player.sessions.revoke', targetType: 'user', targetId: u.id, after: { revoked: count }, reason: b.reason });
      return count;
    });
    await this.d.bridge.publishAdmin({ type: 'sanction', userId, kick: true, message: 'Oturumun Türk Orbit ekibi tarafından sonlandırıldı. Tekrar giriş yapabilirsin.' });
    return { revoked: n };
  }

  // ================================================================== roller
  async changeRole(actor: AdminActor, userId: string, input: unknown): Promise<{ status: 'applied' | 'pending_approval'; roles?: RoleKey[]; approval?: ApprovalView }> {
    const b = adminRoleChangeSchema.parse(input);
    const role = b.role as RoleKey;
    return withTransaction(this.d.db, async (c) => {
      const u = await this.user(c, userId, true);
      if (u.id === actor.userId) throw new AppError('ROLE_RANK', 403, 'Kendi rollerini değiştiremezsin.');
      const isSuper = actor.roles.includes('super_admin');
      const target = await getUserRoles(c, u.id);
      if (!isSuper) {
        if (ROLE_RANK[role] >= actor.rank) throw new AppError('ROLE_RANK', 403, 'Kendi rütbene eşit veya daha yüksek bir rolü atayamaz ya da kaldıramazsın.');
        if (Math.max(0, ...target.map((r) => ROLE_RANK[r])) >= actor.rank) throw new AppError('ROLE_RANK', 403, 'Kendi rütbene eşit veya daha yüksek rütbedeki bir personelin rollerini değiştiremezsin.');
      }
      if (b.grant && target.includes(role)) throw new AppError('NO_CHANGES', 409, 'Kullanıcı bu role zaten sahip.');
      if (!b.grant && !target.includes(role)) throw new AppError('NO_CHANGES', 409, 'Kullanıcının bu rolü yok.');
      if (b.grant && role === 'super_admin') {
        const approval = await this.d.approvals.create(c, actor, 'role.grant.super_admin', { userId: u.id, username: u.username, reason: b.reason }, `${u.username} → Süper Yönetici`, b.reason);
        return { status: 'pending_approval' as const, approval };
      }
      if (!b.grant && role === 'super_admin') {
        const n = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM user_roles WHERE role_key = 'super_admin'`);
        if (Number(n.rows[0]!.n) <= 1) throw new AppError('ROLE_RANK', 409, 'Son Süper Yöneticinin rolü kaldırılamaz.');
      }
      const roles = await this.applyRole(c, actor, u.id, role, b.grant, b.reason, target);
      return { status: 'applied' as const, roles };
    });
  }

  private async applyRole(c: Queryable, actor: Pick<AdminActor, 'userId' | 'label' | 'ip'>, userId: string, role: RoleKey, grant: boolean, reason: string, before: RoleKey[]) {
    if (grant) {
      await c.query(`INSERT INTO user_roles (user_id, role_key, granted_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [userId, role, actor.userId, reason]);
    } else {
      await c.query('DELETE FROM user_roles WHERE user_id = $1 AND role_key = $2', [userId, role]);
    }
    const after = await getUserRoles(c, userId);
    await audit(c, actor, { action: grant ? 'role.grant' : 'role.revoke', targetType: 'user', targetId: userId, before: { roles: before }, after: { roles: after, role, label: ROLE_LABELS_TR[role] }, reason });
    return after;
  }

  private async execRole(c: DbClient, ctx: ExecContext): Promise<ExecResult> {
    const p = ctx.payload as { userId: string; reason: string };
    const u = await this.user(c, p.userId, true);
    const before = await getUserRoles(c, u.id);
    if (before.includes('super_admin')) throw new AppError('NO_CHANGES', 409, 'Kullanıcı zaten Süper Yönetici.');
    const roles = await this.applyRole(c, ctx.approver, u.id, 'super_admin', true, `${p.reason} (talep: ${ctx.requestedBy.label})`, before);
    return { result: { user: u.username, roles } };
  }

  // ================================================================== para / eşya verme
  async catalog() {
    const [currencies, items] = await Promise.all([
      this.d.db.query<{ code: string; name: string }>('SELECT code, name FROM currencies ORDER BY code'),
      this.d.db.query<{ code: string; name: string; category: string; stackable: boolean }>(
        `SELECT code, name, category, stackable FROM item_types WHERE NOT is_archived ORDER BY category, name`,
      ),
    ]);
    const s = (await getSetting<{ grant_approval_threshold?: Record<string, number>; grant_item_approval_threshold?: number }>(this.d.db, 'admin')) ?? {};
    return { currencies: currencies.rows, items: items.rows, thresholds: { currency: s.grant_approval_threshold ?? {}, item: s.grant_item_approval_threshold ?? 0 } };
  }

  async grant(actor: AdminActor, input: unknown): Promise<{ status: 'executed' | 'pending_approval'; approval?: ApprovalView; balance?: number }> {
    const b = adminGrantSchema.parse(input);
    const out = new Outbox();
    let after: (() => Promise<void>) | undefined;
    const res = await withTransaction(this.d.db, async (c) => {
      const pr = await c.query<{ id: string; pilot_name: string; user_id: string; username: string }>(
        `SELECT p.id, p.pilot_name::text, p.user_id, u.username::text FROM players p JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND u.status <> 'deleted'`,
        [b.playerId],
      );
      const pilot = pr.rows[0];
      if (!pilot) throw notFound('USER_NOT_FOUND', 'Pilot');
      if (pilot.user_id === actor.userId) throw new AppError('ROLE_RANK', 403, 'Kendi pilotuna para veya eşya veremezsin.');
      const name = await this.refName(c, b.kind, b.code);
      const s = (await getSetting<{ grant_approval_threshold?: Record<string, number>; grant_item_approval_threshold?: number }>(c, 'admin')) ?? {};
      const threshold = b.kind === 'currency' ? (s.grant_approval_threshold?.[b.code] ?? 0) : (s.grant_item_approval_threshold ?? 0);
      const payload = { playerId: pilot.id, pilot: pilot.pilot_name, kind: b.kind, code: b.code, amount: b.amount, reason: b.reason };
      if (b.amount > threshold) {
        const approval = await this.d.approvals.create(c, actor, 'economy.grant', payload, `${pilot.pilot_name} → ${fmt(b.amount)} ${name}`, b.reason);
        return { status: 'pending_approval' as const, approval };
      }
      const r = await this.doGrant(c, actor, { id: actor.userId, label: actor.label }, payload, out, null);
      after = r.after;
      return { status: 'executed' as const, ...(r.balance !== undefined ? { balance: r.balance } : {}) };
    });
    await this.d.notifier.flush(out);
    if (after) await after();
    return res;
  }

  private async refName(c: Queryable, kind: 'currency' | 'item', code: string): Promise<string> {
    if (kind === 'currency') {
      const r = await c.query<{ name: string }>('SELECT name FROM currencies WHERE code = $1', [code]);
      if (!r.rows[0]) throw new AppError('VALIDATION_ERROR', 400, 'Bilinmeyen para birimi.', { fields: { code: ['Bilinmeyen para birimi.'] } });
      return r.rows[0].name;
    }
    const r = await c.query<{ name: string }>('SELECT name FROM item_types WHERE code = $1 AND NOT is_archived', [code]);
    if (!r.rows[0]) throw new AppError('VALIDATION_ERROR', 400, 'Bilinmeyen eşya.', { fields: { code: ['Bilinmeyen eşya.'] } });
    return r.rows[0].name;
  }

  private async doGrant(
    c: Queryable,
    actor: Pick<AdminActor, 'userId' | 'label' | 'ip'>,
    requestedBy: { id: string; label: string },
    p: { playerId: string; pilot: string; kind: 'currency' | 'item'; code: string; amount: number; reason: string },
    out: Outbox,
    approvalId: number | null,
  ): Promise<{ balance?: number; after?: () => Promise<void> }> {
    const exists = await c.query('SELECT 1 FROM players WHERE id = $1', [p.playerId]);
    if (!exists.rowCount) throw notFound('USER_NOT_FOUND', 'Pilot');
    const name = await this.refName(c, p.kind, p.code);
    const key = `admin-grant:${approvalId ?? randomUUID()}`;
    let balance: number | undefined;
    if (p.kind === 'currency') {
      const r = await applyCurrencyChange(c, {
        playerId: p.playerId,
        currency: p.code,
        delta: p.amount,
        reason: 'admin_grant',
        refType: approvalId ? 'approval' : 'admin',
        refId: approvalId ? String(approvalId) : actor.userId,
        idempotencyKey: key,
        actorUserId: requestedBy.id,
      });
      balance = r.balance;
    } else {
      const t = await c.query<{ id: number; code: string; name: string; category: string; stackable: boolean }>(
        'SELECT id, code, name, category, stackable FROM item_types WHERE code = $1',
        [p.code],
      );
      await grantItem(c, p.playerId, t.rows[0]!, p.amount, {
        reason: 'admin_grant',
        source: 'admin',
        refType: approvalId ? 'approval' : 'admin',
        refId: approvalId ? String(approvalId) : actor.userId,
        idempotencyKey: key,
        actorUserId: requestedBy.id,
      });
    }
    await this.d.notifier.create(c, out, p.playerId, {
      kind: 'admin_grant',
      title: `Hesabına ${fmt(p.amount)} ${name} eklendi`,
      body: 'Türk Orbit ekibi tarafından verildi.',
      link: p.kind === 'item' ? '/hangar' : '/pilot',
    });
    await audit(c, actor, {
      action: 'economy.grant',
      targetType: 'player',
      targetId: p.playerId,
      after: { pilot: p.pilot, kind: p.kind, code: p.code, amount: p.amount, ...(approvalId ? { approvalId, requestedBy: requestedBy.label } : {}) },
      reason: p.reason,
    });
    return {
      ...(balance !== undefined ? { balance } : {}),
      after: async () => {
        await this.d.notifier.flush(out);
        if (p.kind === 'item') await this.d.bridge.notifyPlayerUpdated(p.playerId, 'inventory');
      },
    };
  }

  private async execGrant(c: DbClient, ctx: ExecContext): Promise<ExecResult> {
    const p = ctx.payload as { playerId: string; pilot: string; kind: 'currency' | 'item'; code: string; amount: number; reason: string };
    const out = new Outbox();
    const r = await this.doGrant(c, ctx.approver, ctx.requestedBy, p, out, ctx.approvalId);
    return { result: { pilot: p.pilot, code: p.code, amount: p.amount, ...(r.balance !== undefined ? { balance: r.balance } : {}) }, ...(r.after ? { after: r.after } : {}) };
  }
}
