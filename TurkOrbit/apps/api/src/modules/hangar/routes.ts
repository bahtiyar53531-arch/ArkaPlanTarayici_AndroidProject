import type { FastifyInstance } from 'fastify';
import type { AuthGuards } from '../auth/guards.js';
import type { AuthenticatedContext } from '../auth/service.js';
import type { HangarService } from './service.js';

type Q = { Querystring: { server?: string } };
type ShipP = { Params: { shipId: string } };
type ItemP = { Params: { itemId: string } };

export function hangarRoutes(app: FastifyInstance, opts: { service: HangarService; guards: AuthGuards }) {
  const { service, guards } = opts;
  const pre = { preHandler: guards.requireAuth };
  const owner = (a: AuthenticatedContext) => ({ id: a.user.id });
  const server = (q: { server?: string }) => q.server ?? 'TR1';

  // ---------------------------------------------------------------- hangar
  app.get<Q>('/hangar', pre, async (r) => ({ hangar: await service.hangar(owner(r.auth!), server(r.query)) }));
  app.get<Q>('/hangar/ledger', pre, async (r) => ({ entries: await service.itemLedger(owner(r.auth!), server(r.query)) }));

  app.post('/hangar/equip', pre, async (r) => ({ hangar: (await service.equip(owner(r.auth!), r.body)).hangar }));
  app.post('/hangar/unequip', pre, async (r) => ({ hangar: (await service.unequip(owner(r.auth!), r.body)).hangar }));
  app.post('/hangar/loadout', pre, async (r) => ({ hangar: (await service.setActiveLoadout(owner(r.auth!), r.body)).hangar }));

  app.post<ShipP>('/hangar/ships/:shipId/activate', pre, async (r) => ({
    hangar: (await service.activateShip(owner(r.auth!), r.params.shipId, r.body)).hangar,
  }));
  app.post<ShipP>('/hangar/ships/:shipId/design', pre, async (r) => ({
    hangar: (await service.setDesign(owner(r.auth!), r.params.shipId, r.body)).hangar,
  }));
  app.post<ShipP>('/hangar/ships/:shipId/repair', pre, async (r) => {
    const x = await service.repair(owner(r.auth!), r.params.shipId, r.body);
    return { result: x.result, hangar: x.hangar };
  });

  app.post<ItemP>('/hangar/items/:itemId/sell', pre, async (r) => {
    const x = await service.sell(owner(r.auth!), r.params.itemId, r.body);
    return { result: x.result, hangar: x.hangar };
  });
  app.post<ItemP>('/hangar/items/:itemId/upgrade', pre, async (r) => {
    const x = await service.upgrade(owner(r.auth!), r.params.itemId, r.body);
    return { result: x.result, hangar: x.hangar };
  });

  app.post('/hangar/pet/name', pre, async (r) => ({ hangar: (await service.renamePet(owner(r.auth!), r.body)).hangar }));
  app.post('/hangar/pet/modules', pre, async (r) => ({ hangar: (await service.setPetModule(owner(r.auth!), r.body)).hangar }));

  // ---------------------------------------------------------------- mağaza
  app.get<Q>('/shop', pre, async (r) => ({ shop: await service.shop(owner(r.auth!), server(r.query)) }));
  app.post('/shop/purchase', pre, async (r) => service.purchase(owner(r.auth!), r.body));
}
