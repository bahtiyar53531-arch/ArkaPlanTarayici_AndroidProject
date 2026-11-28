import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { safeIp } from '../../lib/client-info.js';
import { Errors } from '../../lib/errors.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import type { AuthGuards } from '../auth/guards.js';
import type { ForumService, ForumUser } from './service.js';

const idParam = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const page = (q: { page?: string }) => Math.max(1, Math.min(10_000, Number(q.page) || 1));

/** Forum uçları (Aşama 13): okuma herkese açık, yazma oturum + doğrulanmış e-posta ister. */
export function forumRoutes(app: FastifyInstance, opts: { service: ForumService; guards: AuthGuards; limiter: RateLimiter }) {
  const { service, guards, limiter } = opts;
  const user = (r: FastifyRequest): ForumUser | null =>
    r.auth ? { id: r.auth.user.id, username: r.auth.user.username, verified: r.auth.user.email_verified_at !== null } : null;
  const must = (r: FastifyRequest) => user(r)!;
  const read = { preHandler: guards.optionalAuth };
  // 20.000 karakterlik mesaj UTF-8'de ~80 KB olabilir: yazma uçlarında genel 16 KB sınırı yerine 128 KB
  const write = { preHandler: [guards.requireAuth, guards.requireVerifiedEmail], bodyLimit: 128 * 1024 };
  const auth = { preHandler: guards.requireAuth };
  const ipLimit = async (r: FastifyRequest, action: string, n: number, w: number) => {
    const rl = await limiter.hit(`${action}:ip:${safeIp(r.ip) ?? 'unknown'}`, n, w);
    if (!rl.allowed) throw Errors.rateLimited(rl.retryAfterSeconds);
  };
  const userLimit = async (r: FastifyRequest, action: string, n: number, w: number, message?: string) => {
    const rl = await limiter.hit(`${action}:user:${r.auth!.user.id}`, n, w);
    if (!rl.allowed) throw Errors.rateLimited(rl.retryAfterSeconds, message);
  };

  app.get('/forum/categories', read, async (r) => {
    await ipLimit(r, 'forum-read', 240, 60);
    return { categories: await service.categories(user(r)) };
  });
  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>('/forum/c/:slug', read, async (r) => {
    await ipLimit(r, 'forum-read', 240, 60);
    return service.listThreads(String(r.params.slug).slice(0, 40), page(r.query), user(r));
  });
  app.get<{ Params: { id: string }; Querystring: { page?: string } }>('/forum/t/:id', read, async (r) => {
    await ipLimit(r, 'forum-read', 240, 60);
    const viewer = r.auth ? `u:${r.auth.user.id}` : `ip:${safeIp(r.ip) ?? 'x'}`;
    return { thread: await service.thread(idParam.parse(r.params.id), page(r.query), user(r), viewer) };
  });
  app.get<{ Querystring: { q?: string; page?: string } }>('/forum/search', read, async (r) => {
    await ipLimit(r, 'forum-search', 30, 60);
    return service.search(String(r.query.q ?? ''), page(r.query));
  });

  app.post('/forum/threads', write, async (r, reply) => {
    await userLimit(r, 'forum-thread', 5, 3600, 'Çok fazla konu açtın. Biraz sonra tekrar dene.');
    return reply.code(201).send(await service.createThread(must(r), r.body));
  });
  app.post<{ Params: { id: string } }>('/forum/t/:id/replies', write, async (r, reply) => {
    await userLimit(r, 'forum-reply', 30, 600, 'Çok hızlı yanıt yazıyorsun. Biraz bekleyip tekrar dene.');
    return reply.code(201).send(await service.reply(must(r), idParam.parse(r.params.id), r.body));
  });
  app.patch<{ Params: { id: string } }>('/forum/posts/:id', write, async (r) => service.edit(must(r), idParam.parse(r.params.id), r.body));
  app.post<{ Params: { id: string } }>('/forum/posts/:id/delete', auth, async (r) => service.deletePost(must(r), idParam.parse(r.params.id), r.body));
  app.post<{ Params: { id: string }; Body: { on?: unknown } }>('/forum/posts/:id/like', auth, async (r) => {
    await userLimit(r, 'forum-like', 120, 60);
    return service.like(must(r), idParam.parse(r.params.id), z.strictObject({ on: z.boolean() }).parse(r.body).on);
  });
  app.post<{ Params: { id: string } }>('/forum/t/:id/follow', auth, async (r) =>
    service.follow(must(r), idParam.parse(r.params.id), z.strictObject({ on: z.boolean() }).parse(r.body).on),
  );
  app.post<{ Params: { id: string } }>('/forum/t/:id/moderate', auth, async (r) => service.moderate(must(r), idParam.parse(r.params.id), r.body));
  app.post<{ Params: { id: string } }>('/forum/posts/:id/report', auth, async (r, reply) => {
    await userLimit(r, 'report', 10, 3600, 'Çok fazla şikâyet gönderdin. Biraz sonra tekrar dene.');
    return reply.code(201).send({ report: await service.report(must(r), { type: 'forum_post', id: idParam.parse(r.params.id) }, r.body) });
  });
  app.post<{ Params: { id: string } }>('/forum/t/:id/report', auth, async (r, reply) => {
    await userLimit(r, 'report', 10, 3600, 'Çok fazla şikâyet gönderdin. Biraz sonra tekrar dene.');
    return reply.code(201).send({ report: await service.report(must(r), { type: 'forum_thread', id: idParam.parse(r.params.id) }, r.body) });
  });
  app.post('/forum/moderators', { preHandler: [guards.requireAuth, guards.requirePermission('forum.moderators.assign')] }, async (r) =>
    service.assignModerator(must(r), r.body),
  );
}
