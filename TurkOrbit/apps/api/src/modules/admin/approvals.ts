/**
 * İki yetkili onayı (Aşama 14).
 *
 *  - Kritik işlem (kalıcı ban, eşik üstü para/eşya verme, Süper Yönetici ataması) doğrudan yapılmaz; onay talebi olur.
 *  - Talep eden kendi talebini onaylayamaz/reddedemez: hem kodda hem veritabanı CHECK kısıtında.
 *  - Onaylayan, işlemin kendi yetkisine (ör. economy.grant) veya approvals.review yetkisine sahip olmalıdır.
 *  - Onaylanan işlem onayla AYNI transaction'da yürütülür. Yürütme hata verirse (ör. pilot silinmiş) talep
 *    "başarısız" olarak kapanır ve hiçbir değişiklik uygulanmaz.
 *  - Süresi dolan talep onaylanamaz.
 */
import {
  APPROVAL_PERMISSION,
  adminReviewSchema,
  type ApprovalAction,
  type ApprovalView,
} from '@turkorbit/shared';
import { withTransaction, type Db, type DbClient, type Queryable } from '../../db/pool.js';
import { AppError, Errors } from '../../lib/errors.js';
import { getSetting } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import { audit, can, notFound, type AdminActor } from './common.js';

export interface ExecContext {
  approver: AdminActor;
  requestedBy: { id: string; label: string };
  payload: Record<string, unknown>;
  approvalId: number;
}
export interface ExecResult {
  result: Record<string, unknown>;
  /** commit sonrası yan etkiler (bildirim iletimi, oyun sunucusu olayı) */
  after?: () => Promise<void>;
}
export type Executor = (c: DbClient, ctx: ExecContext) => Promise<ExecResult>;

interface Row {
  id: string;
  action: ApprovalAction;
  payload: Record<string, unknown>;
  summary: string;
  requested_by: string;
  requested_label: string;
  reason: string;
  status: ApprovalView['status'];
  reviewed_label: string | null;
  review_note: string | null;
  expires_at: Date;
  created_at: Date;
  reviewed_at: Date | null;
}

export class ApprovalService {
  readonly executors: Partial<Record<ApprovalAction, Executor>> = {};

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private canReview(actor: AdminActor, action: ApprovalAction) {
    return can(actor, 'approvals.review') || can(actor, APPROVAL_PERMISSION[action]);
  }

  private view(r: Row, actor: AdminActor): ApprovalView {
    const now = this.now().getTime();
    const status = r.status === 'pending' && r.expires_at.getTime() <= now ? 'expired' : r.status;
    const mine = r.requested_by === actor.userId;
    return {
      id: Number(r.id),
      action: r.action,
      summary: r.summary,
      reason: r.reason,
      requestedBy: r.requested_label,
      status,
      reviewedBy: r.reviewed_label,
      reviewNote: r.review_note,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
      reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
      canReview: status === 'pending' && !mine && this.canReview(actor, r.action),
      mine,
    };
  }

  /** Talep oluşturur (çağıranın transaction'ında). Denetim kaydına "onay bekliyor" olarak yazılır. */
  async create(
    c: Queryable,
    actor: AdminActor,
    action: ApprovalAction,
    payload: Record<string, unknown>,
    summary: string,
    reason: string,
  ): Promise<ApprovalView> {
    const hours = Math.max(1, Math.min(720, Number((await getSetting<{ approval_hours?: number }>(c, 'admin'))?.approval_hours) || 72));
    const now = this.now();
    const r = await c.query<Row>(
      `INSERT INTO approval_requests (action, payload, summary, requested_by, requested_label, reason, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id::text, action, payload, summary, requested_by, requested_label, reason, status, reviewed_label, review_note, expires_at, created_at, reviewed_at`,
      [action, JSON.stringify(payload), summary.slice(0, 200), actor.userId, actor.label, reason, new Date(now.getTime() + hours * 3_600_000), now],
    );
    await audit(c, actor, {
      action: `approval.request`,
      targetType: 'approval',
      targetId: r.rows[0]!.id,
      after: { action, payload, summary },
      reason,
      result: 'pending_approval',
    });
    return this.view(r.rows[0]!, actor);
  }

  async list(actor: AdminActor): Promise<ApprovalView[]> {
    const r = await this.db.query<Row>(
      `SELECT id::text, action, payload, summary, requested_by, requested_label, reason, status, reviewed_label, review_note,
              expires_at, created_at, reviewed_at
       FROM approval_requests ORDER BY (status = 'pending') DESC, id DESC LIMIT 100`,
    );
    return r.rows
      .map((x) => this.view(x, actor))
      .filter((v) => v.mine || this.canReview(actor, v.action));
  }

  async pendingCount(actor: AdminActor): Promise<number> {
    return (await this.list(actor)).filter((v) => v.status === 'pending' && v.canReview).length;
  }

  async review(actor: AdminActor, id: number, input: unknown): Promise<ApprovalView> {
    const b = adminReviewSchema.parse(input);
    let after: (() => Promise<void>) | undefined;
    const out = await withTransaction(this.db, async (c) => {
      const r = await c.query<Row>(
        `SELECT id::text, action, payload, summary, requested_by, requested_label, reason, status, reviewed_label, review_note,
                expires_at, created_at, reviewed_at
         FROM approval_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = r.rows[0];
      if (!row) throw notFound('APPROVAL_NOT_FOUND', 'Onay talebi');
      if (!this.canReview(actor, row.action) && row.requested_by !== actor.userId) throw Errors.forbidden();
      if (row.requested_by === actor.userId) {
        throw new AppError('APPROVAL_SELF', 403, 'Kendi talebini onaylayamaz veya reddedemezsin; başka bir yetkili incelemeli.');
      }
      if (!this.canReview(actor, row.action)) throw Errors.forbidden();
      if (row.status !== 'pending') throw new AppError('APPROVAL_CLOSED', 409, 'Bu talep zaten sonuçlandı.');
      const now = this.now();
      if (row.expires_at.getTime() <= now.getTime()) {
        await c.query(`UPDATE approval_requests SET status = 'expired' WHERE id = $1`, [id]);
        return { expired: true as const };
      }
      const base = { approvalId: Number(row.id), action: row.action, requestedBy: row.requested_label };
      if (!b.approve) {
        await c.query(
          `UPDATE approval_requests SET status = 'rejected', reviewed_by = $2, reviewed_label = $3, reviewed_at = $4, review_note = $5 WHERE id = $1`,
          [id, actor.userId, actor.label, now, b.note ?? null],
        );
        await audit(c, actor, { action: 'approval.reject', targetType: 'approval', targetId: row.id, after: base, reason: b.note ?? null });
        return { expired: false as const };
      }
      const exec = this.executors[row.action];
      if (!exec) throw new AppError('INTERNAL_ERROR', 500, 'Bu işlem için yürütücü tanımlı değil.');
      await c.query('SAVEPOINT approval_exec');
      try {
        const res = await exec(c, { approver: actor, requestedBy: { id: row.requested_by, label: row.requested_label }, payload: row.payload, approvalId: Number(row.id) });
        after = res.after;
        await c.query(
          `UPDATE approval_requests SET status = 'executed', reviewed_by = $2, reviewed_label = $3, reviewed_at = $4, review_note = $5, result = $6 WHERE id = $1`,
          [id, actor.userId, actor.label, now, b.note ?? null, JSON.stringify(res.result)],
        );
        await audit(c, actor, { action: 'approval.approve', targetType: 'approval', targetId: row.id, after: { ...base, result: res.result }, reason: b.note ?? row.reason });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        // Çıkar çatışması bir yürütme hatası değil, inceleme reddidir: talep açık kalır
        if (err.code === 'APPROVAL_SELF') throw err;
        await c.query('ROLLBACK TO SAVEPOINT approval_exec');
        await c.query(
          `UPDATE approval_requests SET status = 'failed', reviewed_by = $2, reviewed_label = $3, reviewed_at = $4, review_note = $5, result = $6 WHERE id = $1`,
          [id, actor.userId, actor.label, now, b.note ?? null, JSON.stringify({ error: err.message })],
        );
        await audit(c, actor, { action: 'approval.approve', targetType: 'approval', targetId: row.id, after: { ...base, error: err.message }, reason: b.note ?? row.reason, result: 'failure' });
      }
      return { expired: false as const };
    });
    if (out.expired) throw new AppError('APPROVAL_CLOSED', 409, 'Bu talebin onay süresi doldu.');
    if (after) await after().catch((err: unknown) => this.log.warn({ err, id }, 'onay sonrası yan etki uygulanamadı'));
    const r = await this.db.query<Row>(
      `SELECT id::text, action, payload, summary, requested_by, requested_label, reason, status, reviewed_label, review_note,
              expires_at, created_at, reviewed_at FROM approval_requests WHERE id = $1`,
      [id],
    );
    return this.view(r.rows[0]!, actor);
  }
}
