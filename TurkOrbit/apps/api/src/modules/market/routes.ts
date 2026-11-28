import type { FastifyInstance } from 'fastify';
import type { AuthGuards } from '../auth/guards.js';
import type { AuthenticatedContext } from '../auth/service.js';
import type { MarketService } from './service.js';

type Q = { Querystring: { server?: string } };

/** Pazar uçları (Aşama 11): rafineri/üretim, günlük ödül, açık artırma. Kaynak satışı hangar satış ucunu kullanır. */
export function marketRoutes(app: FastifyInstance, opts: { service: MarketService; guards: AuthGuards }) {
  const { service, guards } = opts;
  const pre = { preHandler: guards.requireAuth };
  const owner = (a: AuthenticatedContext) => ({ id: a.user.id });
  const server = (q: { server?: string }) => q.server ?? 'TR1';

  app.get<Q>('/market/crafting', pre, async (r) => ({ crafting: await service.crafting(owner(r.auth!), server(r.query)) }));
  app.post('/market/crafting/start', pre, async (r) => service.craftStart(owner(r.auth!), r.body));
  app.post('/market/crafting/claim', pre, async (r) => service.craftClaim(owner(r.auth!), r.body));

  app.get<Q>('/market/daily', pre, async (r) => ({ daily: await service.daily(owner(r.auth!), server(r.query)) }));
  app.post('/market/daily/claim', pre, async (r) => service.dailyClaim(owner(r.auth!), r.body));

  app.get<Q>('/market/auctions', pre, async (r) => ({ auctions: await service.auctions(owner(r.auth!), server(r.query)) }));
  app.post('/market/auctions/bid', pre, async (r) => service.bid(owner(r.auth!), r.body));
}
