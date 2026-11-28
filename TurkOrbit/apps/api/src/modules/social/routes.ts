import type { FastifyInstance } from 'fastify';
import { safeIp } from '../../lib/client-info.js';
import { Errors } from '../../lib/errors.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import type { AuthGuards } from '../auth/guards.js';
import type { AuthenticatedContext } from '../auth/service.js';
import type { ClanService } from './clan.js';
import type { SocialService } from './service.js';

type Q = { Querystring: { server?: string } };

/** Klan ve sosyal uçları (Aşama 12). Tüm denetimler serviste; burada yalnızca oturum ve hız sınırı. */
export function socialRoutes(app: FastifyInstance, opts: { clans: ClanService; social: SocialService; guards: AuthGuards; limiter: RateLimiter }) {
  const { clans, social, guards, limiter } = opts;
  const pre = { preHandler: guards.requireAuth };
  const owner = (a: AuthenticatedContext) => ({ id: a.user.id });
  const server = (q: { server?: string }) => q.server ?? 'TR1';
  /** Kullanıcı başına sabit pencereli sınır */
  const limit = async (a: AuthenticatedContext, action: string, n: number, windowSeconds: number, message?: string) => {
    const rl = await limiter.hit(`${action}:user:${a.user.id}`, n, windowSeconds);
    if (!rl.allowed) throw Errors.rateLimited(rl.retryAfterSeconds, message);
  };

  // ---------------------------------------------------------------- klan
  app.get<Q>('/clan', pre, async (r) => clans.me(owner(r.auth!), server(r.query)));
  app.get<{ Querystring: { server?: string; q?: string } }>('/clans', async (r) => {
    const rl = await limiter.hit(`clan-list:ip:${safeIp(r.ip) ?? 'unknown'}`, 120, 60);
    if (!rl.allowed) throw Errors.rateLimited(rl.retryAfterSeconds);
    return { clans: await clans.list(server(r.query), r.query.q) };
  });
  app.get<{ Params: { server: string; tag: string } }>('/clans/:server/:tag', async (r) => {
    const rl = await limiter.hit(`clan-view:ip:${safeIp(r.ip) ?? 'unknown'}`, 120, 60);
    if (!rl.allowed) throw Errors.rateLimited(rl.retryAfterSeconds);
    return { clan: await clans.publicView(r.params.server, r.params.tag) };
  });
  app.post('/clan/create', pre, async (r) => {
    await limit(r.auth!, 'clan-create', 5, 3600);
    return clans.create(owner(r.auth!), r.body);
  });
  app.post('/clan/update', pre, async (r) => clans.update(owner(r.auth!), r.body));
  app.post('/clan/apply', pre, async (r) => {
    await limit(r.auth!, 'clan-apply', 20, 3600);
    return clans.apply(owner(r.auth!), r.body);
  });
  app.post('/clan/applications/withdraw', pre, async (r) => clans.withdrawApplication(owner(r.auth!), r.body));
  app.post('/clan/applications/decide', pre, async (r) => clans.decideApplication(owner(r.auth!), r.body));
  app.post('/clan/invite', pre, async (r) => {
    await limit(r.auth!, 'clan-invite', 60, 3600);
    return clans.invite(owner(r.auth!), r.body);
  });
  app.post('/clan/invitations/cancel', pre, async (r) => clans.cancelInvitation(owner(r.auth!), r.body));
  app.post('/clan/invitations/respond', pre, async (r) => clans.respondInvitation(owner(r.auth!), r.body));
  app.post('/clan/leave', pre, async (r) => clans.leave(owner(r.auth!), r.body));
  app.post('/clan/kick', pre, async (r) => clans.kick(owner(r.auth!), r.body));
  app.post('/clan/members/rank', pre, async (r) => clans.setRank(owner(r.auth!), r.body));
  app.post('/clan/ranks/update', pre, async (r) => clans.updateRank(owner(r.auth!), r.body));
  app.post('/clan/transfer', pre, async (r) => clans.transfer(owner(r.auth!), r.body));
  app.post('/clan/disband', pre, async (r) => clans.disband(owner(r.auth!), r.body));
  app.post('/clan/treasury/deposit', pre, async (r) => clans.deposit(owner(r.auth!), r.body));
  app.post('/clan/treasury/withdraw', pre, async (r) => clans.withdraw(owner(r.auth!), r.body));
  app.post('/clan/diplomacy/propose', pre, async (r) => {
    await limit(r.auth!, 'clan-diplomacy', 30, 3600);
    return clans.propose(owner(r.auth!), r.body);
  });
  app.post('/clan/diplomacy/respond', pre, async (r) => clans.respond(owner(r.auth!), r.body));
  app.post('/clan/diplomacy/war', pre, async (r) => {
    await limit(r.auth!, 'clan-diplomacy', 30, 3600);
    return clans.declareWar(owner(r.auth!), r.body);
  });
  app.post('/clan/diplomacy/end', pre, async (r) => clans.end(owner(r.auth!), r.body));

  // ---------------------------------------------------------------- arkadaşlar, engel, gizlilik
  app.get<Q>('/social/friends', pre, async (r) => social.friends(owner(r.auth!), server(r.query)));
  app.post('/social/friends/request', pre, async (r) => {
    await limit(r.auth!, 'friend-request', 30, 3600, 'Çok fazla arkadaşlık isteği gönderdin. Biraz sonra tekrar dene.');
    return social.request(owner(r.auth!), r.body);
  });
  app.post('/social/friends/respond', pre, async (r) => social.respond(owner(r.auth!), r.body));
  app.post('/social/friends/remove', pre, async (r) => social.remove(owner(r.auth!), r.body));
  app.post('/social/block', pre, async (r) => {
    await limit(r.auth!, 'block', 60, 3600);
    return social.block(owner(r.auth!), r.body);
  });
  app.post('/social/unblock', pre, async (r) => social.unblock(owner(r.auth!), r.body));
  app.put('/social/settings', pre, async (r) => social.updateSettings(owner(r.auth!), r.body));
  app.get<{ Querystring: { server?: string; name?: string } }>('/social/relation', pre, async (r) =>
    social.relationTo(owner(r.auth!), server(r.query), String(r.query.name ?? '').slice(0, 20)),
  );

  // ---------------------------------------------------------------- bildirimler
  app.get<Q>('/notifications', pre, async (r) => social.notifications(owner(r.auth!), server(r.query)));
  app.get<Q>('/notifications/unread', pre, async (r) => ({ unread: await social.unreadCount(owner(r.auth!), server(r.query)) }));
  app.post('/notifications/read', pre, async (r) => social.markRead(owner(r.auth!), r.body));

  // ---------------------------------------------------------------- şikâyet
  app.post('/reports', pre, async (r, reply) => {
    await limit(r.auth!, 'report', 10, 3600, 'Çok fazla şikâyet gönderdin. Biraz sonra tekrar dene.');
    return reply.code(201).send({ report: await social.report(owner(r.auth!), r.body) });
  });

  // ---------------------------------------------------------------- sohbet geçmişi
  app.get<{ Querystring: { server?: string; channel?: string; with?: string; before?: string } }>('/chat/history', pre, async (r) => {
    await limit(r.auth!, 'chat-history', 120, 60);
    return social.chatHistory(owner(r.auth!), r.query);
  });
  app.get<Q>('/chat/conversations', pre, async (r) => social.conversations(owner(r.auth!), server(r.query)));
}
