/**
 * Yönetim Merkezi uçları (Aşama 14): /api/v1/admin/*
 *
 * TÜM uçlar ve gereken yetkileri tek bir bildirimsel tabloda (ADMIN_ROUTE_SPECS) durur. Rota kaydı bu tablodan yapılır;
 * tabloda olup işleyicisi olmayan veya işleyicisi olup tabloda olmayan uç sunucuyu başlatmaz. Yetki testi
 * (test/admin.test.ts) aynı tablodan üretilir: yeni bir uç eklenip 403 testinin dışında kalamaz.
 *
 * Her uç: oturum + rota yetkisi (requirePermission). Servisler işlemin ayrıntısına göre ikinci kez denetler
 * (hedefin rütbesi, onaylayanın yetkisi, yayın için türün yazma yetkisi).
 */
import { CONTENT_TYPES, CONTENT_TYPE_DEFS, type ContentType, type PermissionKey, type SanctionKind } from '@turkorbit/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/pool.js';
import { safeIp } from '../../lib/client-info.js';
import { Errors } from '../../lib/errors.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import type { AuthGuards } from '../auth/guards.js';
import type { ForumService } from '../forum/service.js';
import type { ApprovalService } from './approvals.js';
import { loadActor, must, type AdminActor } from './common.js';
import type { ContentService } from './content.js';
import type { AdminOverviewService } from './overview.js';
import type { AdminPlayerService } from './players.js';

export interface AdminRouteSpec {
  method: 'GET' | 'POST';
  url: string;
  permission: PermissionKey;
}

const contentSpecs = (t: ContentType): AdminRouteSpec[] => {
  const d = CONTENT_TYPE_DEFS[t];
  return [
    { method: 'GET', url: `/admin/content/${t}`, permission: d.read },
    { method: 'GET', url: `/admin/content/${t}/:id`, permission: d.read },
    { method: 'POST', url: `/admin/content/${t}/:id/drafts`, permission: d.write },
    { method: 'POST', url: `/admin/content/${t}/revisions/:rid/publish`, permission: d.publish },
    { method: 'POST', url: `/admin/content/${t}/revisions/:rid/rollback`, permission: d.rollback },
    { method: 'POST', url: `/admin/content/${t}/revisions/:rid/discard`, permission: d.write },
  ];
};

const SANCTION_ROUTES: Array<{ path: string; kind: SanctionKind; permission: PermissionKey }> = [
  { path: 'warn', kind: 'warning', permission: 'players.warn' },
  { path: 'mute', kind: 'mute', permission: 'chat.moderate' },
  { path: 'suspend', kind: 'suspension', permission: 'players.ban' },
  { path: 'ban', kind: 'ban', permission: 'players.ban' },
  { path: 'lock', kind: 'lock', permission: 'players.lock' },
];
const REVOKE_ROUTES: Array<{ path: string; what: 'mute' | 'ban' | 'lock'; permission: PermissionKey }> = [
  { path: 'unmute', what: 'mute', permission: 'chat.moderate' },
  { path: 'unban', what: 'ban', permission: 'players.unban' },
  { path: 'unlock', what: 'lock', permission: 'players.lock' },
];

export const ADMIN_ROUTE_SPECS: AdminRouteSpec[] = [
  // pano ve sistem
  { method: 'GET', url: '/admin/dashboard', permission: 'dashboard.view' },
  { method: 'GET', url: '/admin/system', permission: 'system.read' },
  { method: 'POST', url: '/admin/system/maintenance', permission: 'system.maintenance' },
  { method: 'POST', url: '/admin/system/broadcast', permission: 'system.notifications' },
  // oyuncular
  { method: 'GET', url: '/admin/players', permission: 'players.read' },
  { method: 'GET', url: '/admin/players/:userId', permission: 'players.read' },
  ...SANCTION_ROUTES.map((s): AdminRouteSpec => ({ method: 'POST', url: `/admin/players/:userId/${s.path}`, permission: s.permission })),
  ...REVOKE_ROUTES.map((s): AdminRouteSpec => ({ method: 'POST', url: `/admin/players/:userId/${s.path}`, permission: s.permission })),
  { method: 'POST', url: '/admin/players/:userId/sessions/revoke', permission: 'players.sessions.revoke' },
  { method: 'POST', url: '/admin/players/:userId/roles', permission: 'roles.assign' },
  // ekonomi
  { method: 'GET', url: '/admin/economy/catalog', permission: 'economy.grant' },
  { method: 'POST', url: '/admin/economy/grant', permission: 'economy.grant' },
  // onaylar (servis: onaylayan işlemin yetkisine veya approvals.review yetkisine sahip olmalı; talep eden onaylayamaz)
  { method: 'GET', url: '/admin/approvals', permission: 'dashboard.view' },
  { method: 'POST', url: '/admin/approvals/:id/review', permission: 'dashboard.view' },
  // roller
  { method: 'GET', url: '/admin/roles', permission: 'roles.read' },
  { method: 'GET', url: '/admin/roles/:role/members', permission: 'roles.read' },
  // şikâyetler
  { method: 'GET', url: '/admin/reports', permission: 'chat.reports.read' },
  { method: 'POST', url: '/admin/reports/:id/resolve', permission: 'chat.moderate' },
  // denetim kaydı
  { method: 'GET', url: '/admin/audit', permission: 'audit.read' },
  // içerik (taslak / yayın / geri alma) + yeni görev
  ...CONTENT_TYPES.flatMap(contentSpecs),
  { method: 'POST', url: '/admin/quests', permission: 'quests.write' },
  // klanlar ve forum
  { method: 'GET', url: '/admin/clans', permission: 'clans.read' },
  { method: 'GET', url: '/admin/clans/:id', permission: 'clans.read' },
  { method: 'GET', url: '/admin/forum/categories', permission: 'forum.read' },
  { method: 'POST', url: '/admin/forum/categories', permission: 'forum.categories.write' },
  { method: 'POST', url: '/admin/forum/categories/:id', permission: 'forum.categories.write' },
  { method: 'POST', url: '/admin/forum/moderators', permission: 'forum.moderators.assign' },
];

type Handler = (r: FastifyRequest, actor: AdminActor) => Promise<unknown>;

const uuid = z.string().uuid();
const intId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const entityId = z.string().min(1).max(60).regex(/^[A-Za-z0-9._-]+$/);
const P = (r: FastifyRequest) => r.params as Record<string, string>;
const Q = (r: FastifyRequest) => r.query as Record<string, string | undefined>;
const userId = (r: FastifyRequest) => {
  const v = uuid.safeParse(P(r).userId);
  if (!v.success) throw Errors.notFound('Kullanıcı');
  return v.data;
};
const num = (v: string | undefined, what: string) => {
  const p = intId.safeParse(v);
  if (!p.success) throw Errors.notFound(what);
  return p.data;
};

export function adminRoutes(
  app: FastifyInstance,
  o: {
    guards: AuthGuards;
    db: Db;
    limiter: RateLimiter;
    players: AdminPlayerService;
    content: ContentService;
    overview: AdminOverviewService;
    approvals: ApprovalService;
    forum: ForumService;
  },
) {
  const h: Record<string, Handler> = {};
  const on = (method: AdminRouteSpec['method'], url: string, fn: Handler) => {
    h[`${method} ${url}`] = fn;
  };

  on('GET', '/admin/dashboard', (_r, a) => o.overview.dashboard(a));
  on('GET', '/admin/system', () => o.overview.system());
  on('POST', '/admin/system/maintenance', (r, a) => o.overview.setMaintenance(a, r.body));
  on('POST', '/admin/system/broadcast', (r, a) => o.overview.broadcast(a, r.body));

  on('GET', '/admin/players', async (r) => ({ players: await o.players.search(String(Q(r).q ?? '')) }));
  on('GET', '/admin/players/:userId', async (r) => ({ player: await o.players.detail(userId(r)) }));
  for (const s of SANCTION_ROUTES) on('POST', `/admin/players/:userId/${s.path}`, (r, a) => o.players.sanction(a, userId(r), s.kind, r.body ?? {}));
  for (const s of REVOKE_ROUTES) on('POST', `/admin/players/:userId/${s.path}`, (r, a) => o.players.revoke(a, userId(r), s.what, r.body ?? {}));
  on('POST', '/admin/players/:userId/sessions/revoke', (r, a) => o.players.revokeSessions(a, userId(r), r.body ?? {}));
  on('POST', '/admin/players/:userId/roles', (r, a) => o.players.changeRole(a, userId(r), r.body ?? {}));

  on('GET', '/admin/economy/catalog', () => o.players.catalog());
  on('POST', '/admin/economy/grant', (r, a) => o.players.grant(a, r.body ?? {}));

  on('GET', '/admin/approvals', async (_r, a) => ({ approvals: await o.approvals.list(a) }));
  on('POST', '/admin/approvals/:id/review', async (r, a) => ({ approval: await o.approvals.review(a, num(P(r).id, 'Onay talebi'), r.body ?? {}) }));

  on('GET', '/admin/roles', () => o.overview.roles());
  on('GET', '/admin/roles/:role/members', async (r) => ({ members: await o.overview.roleMembers(String(P(r).role)) }));

  on('GET', '/admin/reports', async (r) => ({ reports: await o.overview.reports(String(Q(r).status ?? 'open')) }));
  on('POST', '/admin/reports/:id/resolve', (r, a) => o.overview.resolveReport(a, num(P(r).id, 'Şikâyet'), r.body ?? {}));

  on('GET', '/admin/audit', (r) => {
    const q = Q(r);
    return o.overview.audit({
      ...(q.actor ? { actor: q.actor } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.targetId ? { targetId: q.targetId } : {}),
      ...(q.before ? { before: Number(q.before) } : {}),
    });
  });

  for (const t of CONTENT_TYPES) {
    const def = CONTENT_TYPE_DEFS[t];
    const eid = (r: FastifyRequest) => {
      const v = entityId.safeParse(P(r).id);
      if (!v.success) throw Errors.notFound(def.label);
      return v.data;
    };
    on('GET', `/admin/content/${t}`, async () => ({ items: await o.content.list(t), fields: def.fields, columns: def.columns, label: def.plural }));
    on('GET', `/admin/content/${t}/:id`, async (r, a) => ({ content: await o.content.detail(a, t, eid(r)) }));
    on('POST', `/admin/content/${t}/:id/drafts`, async (r, a) => ({ content: await o.content.draft(a, t, eid(r), r.body ?? {}) }));
    on('POST', `/admin/content/${t}/revisions/:rid/publish`, async (r, a) => {
      must(a, def.write);
      return { content: await o.content.publish(a, t, num(P(r).rid, 'Sürüm')) };
    });
    on('POST', `/admin/content/${t}/revisions/:rid/rollback`, async (r, a) => {
      must(a, def.write);
      const b = z.strictObject({ reason: z.string().trim().max(200).optional() }).parse(r.body ?? {});
      return { content: await o.content.rollback(a, t, num(P(r).rid, 'Sürüm'), b) };
    });
    on('POST', `/admin/content/${t}/revisions/:rid/discard`, async (r, a) => ({ content: await o.content.discard(a, t, num(P(r).rid, 'Sürüm')) }));
  }
  on('POST', '/admin/quests', (r, a) => o.content.createQuest(a, r.body ?? {}));

  on('GET', '/admin/clans', async (r) => ({ clans: await o.overview.clans(String(Q(r).q ?? '')) }));
  on('GET', '/admin/clans/:id', async (r) => ({ clan: await o.overview.clan(String(P(r).id)) }));
  on('GET', '/admin/forum/categories', async () => ({ categories: await o.overview.forumCategories() }));
  on('POST', '/admin/forum/categories', (r, a) => o.overview.createForumCategory(a, r.body ?? {}));
  on('POST', '/admin/forum/categories/:id', (r, a) => o.overview.updateForumCategory(a, num(P(r).id, 'Forum bölümü'), r.body ?? {}));
  on('POST', '/admin/forum/moderators', (r, a) => o.forum.assignModerator({ id: a.userId, username: a.label, verified: true }, r.body ?? {}));

  // Tablo ↔ işleyici eşleşmesi: eksik veya fazlalık başlangıçta yakalanır
  const specKeys = new Set(ADMIN_ROUTE_SPECS.map((s) => `${s.method} ${s.url}`));
  for (const k of Object.keys(h)) if (!specKeys.has(k)) throw new Error(`Yönetim ucu tabloda yok: ${k}`);
  for (const s of ADMIN_ROUTE_SPECS) {
    const fn = h[`${s.method} ${s.url}`];
    if (!fn) throw new Error(`Yönetim ucunun işleyicisi yok: ${s.method} ${s.url}`);
    const opts = {
      preHandler: [o.guards.requireAuth, o.guards.requirePermission(s.permission)],
      bodyLimit: s.url.endsWith('/drafts') ? 64 * 1024 : 16 * 1024,
    };
    const handler = async (r: FastifyRequest) => {
      const auth = r.auth!;
      if (s.method === 'POST') {
        const rl = await o.limiter.hit(`admin-write:user:${auth.user.id}`, 120, 60);
        if (!rl.allowed) throw Errors.rateLimited(rl.retryAfterSeconds, 'Çok hızlı işlem yapıyorsun. Biraz bekle.');
      }
      const actor = await loadActor(o.db, { id: auth.user.id, username: auth.user.username }, safeIp(r.ip) ?? null);
      return fn(r, actor);
    };
    if (s.method === 'GET') app.get(s.url, opts, handler);
    else app.post(s.url, opts, handler);
  }
}
