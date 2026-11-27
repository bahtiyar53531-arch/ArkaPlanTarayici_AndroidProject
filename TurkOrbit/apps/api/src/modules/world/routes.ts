import type { FastifyInstance } from 'fastify';
import type { AuthGuards } from '../auth/guards.js';
import type { AuthenticatedContext } from '../auth/service.js';
import type { WorldService } from './service.js';

export function worldRoutes(app: FastifyInstance, opts: { service: WorldService; guards: AuthGuards }) {
  const { service, guards } = opts;
  const pre = { preHandler: guards.requireAuth };
  const owner = (a: AuthenticatedContext) => ({ id: a.user.id });
  type Q = { Querystring: { server?: string } };

  app.get<Q>('/world/galaxy', pre, async (r) => ({ galaxy: await service.galaxy(owner(r.auth!), r.query.server ?? 'TR1') }));
  app.get<Q>('/world/map', pre, async (r) => ({ map: await service.currentMap(owner(r.auth!), r.query.server ?? 'TR1') }));
  // Aşama 8: konum ve geçit REST uç noktaları kaldırıldı; hareket ve geçiş yalnızca oyun sunucusunda (WebSocket).

  app.get<{ Querystring: { deviceClass?: string } }>('/settings', pre, async (r) => service.getSettings(owner(r.auth!), r.query.deviceClass));
  app.put('/settings', pre, async (r) => service.saveSettings(owner(r.auth!), r.body));
}
