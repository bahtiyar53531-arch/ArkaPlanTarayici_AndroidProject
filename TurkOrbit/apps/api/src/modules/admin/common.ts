/**
 * Yönetim Merkezi ortak parçaları (Aşama 14): yönetici bağlamı, denetim kaydı ve yardımcılar.
 *
 * Kural: yetki YALNIZCA sunucuda denetlenir. Rota koruması (routes.ts) ilk kapıdır; servisler işlemin
 * ayrıntısına göre (hedefin rütbesi, onaylayanın yetkisi) ikinci kez denetler.
 */
import { ROLE_RANK, type PermissionKey, type RoleKey } from '@turkorbit/shared';
import type { Queryable } from '../../db/pool.js';
import { AppError, Errors } from '../../lib/errors.js';
import { getUserPermissions, getUserRoles } from '../auth/repository.js';

export interface AdminActor {
  userId: string;
  /** denetim kaydında görünen ad (kullanıcı adı) */
  label: string;
  ip: string | null;
  perms: Set<PermissionKey>;
  roles: RoleKey[];
  /** en yüksek rütbe */
  rank: number;
}

export async function loadActor(db: Queryable, user: { id: string; username: string }, ip: string | null): Promise<AdminActor> {
  const [roles, perms] = await Promise.all([getUserRoles(db, user.id), getUserPermissions(db, user.id)]);
  return {
    userId: user.id,
    label: user.username,
    ip,
    perms: new Set(perms as PermissionKey[]),
    roles,
    rank: Math.max(0, ...roles.map((r) => ROLE_RANK[r] ?? 0)),
  };
}

export const can = (a: AdminActor, p: PermissionKey) => a.perms.has(p);
export function must(a: AdminActor, p: PermissionKey) {
  if (!a.perms.has(p)) throw Errors.forbidden();
}

/** Hedef kullanıcının en yüksek rütbesi */
export async function userRank(db: Queryable, userId: string): Promise<{ roles: RoleKey[]; rank: number }> {
  const roles = await getUserRoles(db, userId);
  return { roles, rank: Math.max(0, ...roles.map((r) => ROLE_RANK[r] ?? 0)) };
}

/**
 * Personel kendinden yüksek veya eşit rütbedeki birine yaptırım uygulayamaz, rolünü değiştiremez.
 * Süper Yönetici bu kuraldan muaftır (yine de kendine yaptırım uygulayamaz).
 */
export async function assertCanActOn(db: Queryable, actor: AdminActor, targetUserId: string) {
  if (targetUserId === actor.userId) throw new AppError('ROLE_RANK', 403, 'Bu işlemi kendi hesabına uygulayamazsın.');
  if (actor.roles.includes('super_admin')) return;
  const t = await userRank(db, targetUserId);
  if (t.rank >= actor.rank) throw new AppError('ROLE_RANK', 403, 'Kendi rütbene eşit veya daha yüksek rütbedeki bir personele bu işlemi uygulayamazsın.');
}

export interface AuditInput {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  result?: 'success' | 'failure' | 'pending_approval';
}

/** Denetim kaydı (yalnızca eklenebilir; veritabanı tetikleyicisi UPDATE/DELETE'i engeller). İşlemle aynı transaction'da yazılır. */
export async function audit(c: Queryable, actor: Pick<AdminActor, 'userId' | 'label' | 'ip'>, e: AuditInput) {
  await c.query(
    `INSERT INTO admin_audit_log (actor_user_id, actor_label, action, target_type, target_id, before_value, after_value, reason, result, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      actor.userId,
      actor.label,
      e.action,
      e.targetType ?? null,
      e.targetId ?? null,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      e.reason ?? null,
      e.result ?? 'success',
      actor.ip,
    ],
  );
}

export const notFound = (code: 'USER_NOT_FOUND' | 'CONTENT_NOT_FOUND' | 'APPROVAL_NOT_FOUND' | 'REPORT_NOT_FOUND' | 'SANCTION_NOT_FOUND', what: string) =>
  new AppError(code, 404, `${what} bulunamadı.`);

export const fmt = (n: number) => n.toLocaleString('tr-TR');
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** LIKE desenindeki özel karakterler kaçışlanır */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** PostgreSQL CHECK / NOT NULL / FK ihlali → kullanıcıya anlaşılır doğrulama hatası */
export function mapDbError(err: unknown, fallback: string): never {
  const code = (err as { code?: string }).code;
  if (code === '23514' || code === '23502' || code === '23503' || code === '22007' || code === '22P02') {
    throw new AppError('VALIDATION_ERROR', 400, fallback);
  }
  throw err;
}
