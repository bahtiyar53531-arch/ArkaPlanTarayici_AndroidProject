import { PROTOCOL_VERSION, ticketRequestSchema } from '@turkorbit/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/pool.js';
import { AppError, Errors } from '../../lib/errors.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import type { AuthGuards } from '../auth/guards.js';
import type { GameBridge } from './bridge.js';

/**
 * Oyun bileti: oyun sunucusuna (WebSocket) bağlanmak için 60 sn geçerli, tek kullanımlık anahtar.
 * Oturum anahtarı WebSocket'e hiç gönderilmez; oyun sunucusu yalnızca bileti görür.
 */
export function gameRoutes(app: FastifyInstance, opts: { bridge: GameBridge; guards: AuthGuards; limiter: RateLimiter; db: Db }) {
  const { bridge, guards, limiter, db } = opts;

  app.post('/game/ticket', { preHandler: [guards.requireAuth, guards.requireVerifiedEmail] }, async (request) => {
    const auth = request.auth!;
    const d = ticketRequestSchema.parse(request.body ?? {});
    const rl = await limiter.hit(`game-ticket:user:${auth.user.id}`, 30, 60);
    if (!rl.allowed) throw Errors.rateLimited(rl.retryAfterSeconds, 'Çok sık bağlanmaya çalıştın. Biraz bekleyip tekrar dene.');
    const r = await db.query<{ id: string; is_maintenance: boolean; server_name: string }>(
      `SELECT p.id, s.is_maintenance, s.name AS server_name FROM players p JOIN game_servers s ON s.id = p.server_id
       WHERE p.user_id = $1 AND s.code = $2`,
      [auth.user.id, d.serverCode],
    );
    const p = r.rows[0];
    if (!p) throw new AppError('PILOT_NOT_FOUND', 404, 'Bu sunucuda henüz bir pilotun yok.');
    if (p.is_maintenance) throw new AppError('SERVER_CLOSED', 503, `${p.server_name} sunucusu bakımda. Kısa süre sonra tekrar dene.`);
    const t = await bridge.issueTicket({ userId: auth.user.id, sessionId: auth.session.id, playerId: p.id, serverCode: d.serverCode });
    return { ...t, protocol: PROTOCOL_VERSION };
  });
}
