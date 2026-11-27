import { BRAND } from '@turkorbit/shared';
import type { FastifyInstance } from 'fastify';
import type { Runtime } from '../../runtime.js';

const startedAt = Date.now();

/** Yük dengeleyici / izleme için durum uç noktası. Hassas bilgi döndürmez. */
export function healthRoutes(app: FastifyInstance, rt: Runtime) {
  app.get('/health', async (_request, reply) => {
    const check = async (fn: () => Promise<unknown>) => {
      const t = performance.now();
      try {
        await fn();
        return { ok: true, latencyMs: Math.round((performance.now() - t) * 10) / 10 };
      } catch {
        return { ok: false, latencyMs: null };
      }
    };
    const [database, redis] = await Promise.all([
      check(() => rt.db.query('SELECT 1')),
      rt.redis ? check(() => rt.redis!.ping()) : Promise.resolve({ ok: true, latencyMs: null, disabled: true }),
    ]);
    const ok = database.ok && redis.ok;
    return reply.code(ok ? 200 : 503).send({
      service: `${BRAND.shortName} API`,
      status: ok ? 'ok' : 'degraded',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      database,
      redis,
      time: new Date().toISOString(),
    });
  });
}
