import type { FastifyInstance } from 'fastify';
import type { AuthenticatedContext } from '../auth/service.js';
import { safeIp } from '../../lib/client-info.js';
import { Errors } from '../../lib/errors.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import type { AuthGuards } from '../auth/guards.js';
import type { PlayerService } from './service.js';

export function playerRoutes(
  app: FastifyInstance,
  opts: { service: PlayerService; guards: AuthGuards; limiter: RateLimiter },
) {
  const { service, guards, limiter } = opts;
  const owner = (auth: AuthenticatedContext) => ({ id: auth.user.id, username: auth.user.username });

  // ---------------------------------------------------------------- herkese açık listeler
  app.get('/game/servers', { preHandler: guards.optionalAuth }, async (request) => ({
    servers: await service.listServers(request.auth?.user.id ?? null),
  }));

  app.get<{ Querystring: { server?: string } }>('/game/companies', async (request) => ({
    companies: await service.listCompanies(request.query.server),
  }));

  // ---------------------------------------------------------------- pilot (sahibi)
  // Oyun dünyasına giriş sayılır: e-posta doğrulaması zorunlu.
  app.post(
    '/players',
    { preHandler: [guards.requireAuth, guards.requireVerifiedEmail] },
    async (request, reply) => reply.code(201).send({ pilot: await service.createPilot(owner(request.auth!), request.body) }),
  );

  app.get('/players/me', { preHandler: guards.requireAuth }, async (request) => ({
    pilots: await service.myPilots(owner(request.auth!)),
  }));

  app.patch('/players/me', { preHandler: guards.requireAuth }, async (request) => ({
    pilot: await service.updatePilot(owner(request.auth!), request.body),
  }));

  app.post('/players/me/company', { preHandler: guards.requireAuth }, async (request) => ({
    pilot: await service.changeCompany(owner(request.auth!), request.body),
  }));

  app.get<{ Querystring: { server?: string } }>(
    '/players/me/ledger',
    { preHandler: guards.requireAuth },
    async (request) => ({ entries: await service.ledger(owner(request.auth!), request.query.server ?? 'TR1') }),
  );

  // ---------------------------------------------------------------- herkese açık pilot profili
  app.get<{ Params: { server: string; name: string } }>('/pilots/:server/:name', async (request, reply) => {
    const rl = await limiter.hit(`pilot-view:ip:${safeIp(request.ip) ?? 'unknown'}`, 120, 60);
    if (!rl.allowed) throw Errors.rateLimited(rl.retryAfterSeconds);
    reply.header('Cache-Control', 'public, max-age=30');
    return { pilot: await service.publicProfile(request.params.server, request.params.name) };
  });
}
