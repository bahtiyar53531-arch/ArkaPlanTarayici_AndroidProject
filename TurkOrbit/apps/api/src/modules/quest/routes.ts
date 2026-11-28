import type { FastifyInstance } from 'fastify';
import type { AuthGuards } from '../auth/guards.js';
import type { AuthenticatedContext } from '../auth/service.js';
import type { QuestService } from './service.js';

type Q = { Querystring: { server?: string } };

/**
 * Görev uçları (Aşama 10). İlerleme yazan bir uç YOKTUR: ilerleme yalnızca oyun sunucusu ve hangar
 * olaylarıyla sunucuda hesaplanır.
 */
export function questRoutes(app: FastifyInstance, opts: { service: QuestService; guards: AuthGuards }) {
  const { service, guards } = opts;
  const pre = { preHandler: guards.requireAuth };
  const owner = (a: AuthenticatedContext) => ({ id: a.user.id });

  app.get<Q>('/quests', pre, async (r) => ({ quests: await service.list(owner(r.auth!), r.query.server ?? 'TR1') }));
  app.post('/quests/accept', pre, async (r) => ({ quests: (await service.accept(owner(r.auth!), r.body)).list }));
  app.post('/quests/abandon', pre, async (r) => ({ quests: (await service.abandon(owner(r.auth!), r.body)).list }));
  app.post('/quests/reroll', pre, async (r) => {
    const x = await service.reroll(owner(r.auth!), r.body);
    return { replacedBy: x.value.replacedBy, quests: x.list };
  });
  app.post('/quests/claim', pre, async (r) => {
    const x = await service.claim(owner(r.auth!), r.body);
    return { quest: x.quest, reward: x.reward, replay: x.replay, quests: x.list };
  });
}
