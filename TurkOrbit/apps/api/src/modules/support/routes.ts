import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizePlatform } from '../../lib/client-info.js';
import { AppError, Errors } from '../../lib/errors.js';
import type { OneTimeLinks } from '../../lib/one-time.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import type { AuthGuards } from '../auth/guards.js';
import type { SupportService, SupportUser } from './service.js';

const ticketNo = (v: unknown) => String(v ?? '').slice(0, 24);
const idParam = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/** Ham gövde sınırı (veritabanındaki en büyük izin: 10 MB). Asıl sınır ayardan (varsayılan 5 MB) serviste denetlenir. */
const UPLOAD_BODY_LIMIT = 10 * 1024 * 1024;

/** Destek uçları (Aşama 13). Personel uçları veritabanındaki rol-yetki eşlemesiyle korunur. */
/** Tek kullanımlık ek indirme bağlantısının taşıdığı veri (Aşama 15). */
export interface AttachmentLink {
  userId: string;
  username: string;
  attachmentId: number;
}

export function supportRoutes(
  app: FastifyInstance,
  opts: { service: SupportService; guards: AuthGuards; limiter: RateLimiter; links: OneTimeLinks<AttachmentLink> },
) {
  const { service, guards, limiter, links } = opts;
  const me = (r: FastifyRequest): SupportUser => ({ id: r.auth!.user.id, username: r.auth!.user.username });
  const auth = { preHandler: guards.requireAuth };
  const limit = async (r: FastifyRequest, action: string, n: number, w: number, message?: string) => {
    const rl = await limiter.hit(`${action}:user:${r.auth!.user.id}`, n, w);
    if (!rl.allowed) throw Errors.rateLimited(rl.retryAfterSeconds, message);
  };

  app.get('/support/meta', auth, async () => ({ limits: await service.limits() }));
  app.get('/support/tickets', auth, async (r) => ({ tickets: await service.myTickets(me(r)) }));
  // 5.000 karakterlik mesaj UTF-8'de ~20 KB olabilir: genel 16 KB sınırı yerine 64 KB
  const text = { bodyLimit: 64 * 1024 };
  app.post('/support/tickets', { preHandler: [guards.requireAuth, guards.requireVerifiedEmail], ...text }, async (r, reply) => {
    await limit(r, 'support-ticket', 10, 86400, 'Bugün çok fazla destek talebi oluşturdun. Mevcut taleplerine yanıt verebilirsin.');
    const platform = r.headers['x-client-platform'];
    const version = r.headers['x-client-version'];
    return reply.code(201).send(
      await service.create(me(r), r.body, {
        platform: platform ? normalizePlatform(platform) : null,
        version: typeof version === 'string' ? version.replace(/[^\w.+-]/g, '').slice(0, 40) || null : null,
      }),
    );
  });
  app.get<{ Params: { no: string } }>('/support/tickets/:no', auth, async (r) => ({ ticket: await service.ticket(me(r), ticketNo(r.params.no)) }));
  app.post<{ Params: { no: string } }>('/support/tickets/:no/replies', { ...auth, ...text }, async (r, reply) => {
    await limit(r, 'support-reply', 30, 3600);
    return reply.code(201).send(await service.reply(me(r), ticketNo(r.params.no), r.body));
  });
  app.post<{ Params: { no: string } }>('/support/tickets/:no/close', auth, async (r) => ({ ticket: await service.close(me(r), ticketNo(r.params.no)) }));

  // Ek dosya: ham gövde (application/octet-stream), dosya adı X-File-Name başlığında. Tür içerikten belirlenir.
  // Tarayıcı formları bu türü gönderemez; çerezli istekte ayrıca CSRF anahtarı zorunludur.
  app.register(async (sub) => {
    sub.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: UPLOAD_BODY_LIMIT }, (_req, body, done) => done(null, body));
    const upload = (staff: boolean) => async (r: FastifyRequest<{ Params: { no: string; mid: string } }>, reply: import('fastify').FastifyReply) => {
      await limit(r, 'support-upload', 30, 3600);
      if (!Buffer.isBuffer(r.body)) throw Errors.notFound('Dosya');
      const raw = r.headers['x-file-name'];
      let name = 'dosya';
      try {
        name = typeof raw === 'string' ? decodeURIComponent(raw).slice(0, 200) : 'dosya';
      } catch {
        /* bozuk kodlama: varsayılan ad */
      }
      return reply.code(201).send({ attachment: await service.attach(me(r), ticketNo(r.params.no), idParam.parse(r.params.mid), { name, bytes: r.body }, staff) });
    };
    sub.post<{ Params: { no: string; mid: string } }>('/support/tickets/:no/messages/:mid/attachments', { preHandler: guards.requireAuth, bodyLimit: UPLOAD_BODY_LIMIT }, upload(false));
    sub.post<{ Params: { no: string; mid: string } }>(
      '/support/staff/tickets/:no/messages/:mid/attachments',
      { preHandler: [guards.requireAuth, guards.requirePermission('support.reply')], bodyLimit: UPLOAD_BODY_LIMIT },
      upload(true),
    );
  });

  /**
   * Aşama 15 — mobil uygulama: WebView, indirme bağlantısına Bearer anahtarı ekleyemez. Oturumlu istekle 60 sn geçerli,
   * tek kullanımlık ve yalnızca bu eke bağlı bir bağlantı üretilir; uygulama onu cihazın tarayıcısında açar.
   */
  app.post<{ Params: { id: string } }>('/support/attachments/:id/link', auth, async (r) => {
    await limit(r, 'support-link', 60, 3600);
    const id = idParam.parse(r.params.id);
    await service.assertCanDownload(me(r), id);
    const token = await links.create({ userId: r.auth!.user.id, username: r.auth!.user.username, attachmentId: id });
    return { path: `/support/attachments/${id}?dl=${token}`, expiresInSeconds: 60 };
  });

  app.get<{ Params: { id: string }; Querystring: { dl?: string } }>('/support/attachments/:id', { preHandler: guards.optionalAuth }, async (r, reply) => {
    const id = idParam.parse(r.params.id);
    let user: SupportUser;
    if (typeof r.query.dl === 'string') {
      const link = await links.consume(r.query.dl);
      if (!link || link.attachmentId !== id) {
        throw new AppError('LINK_INVALID', 410, 'İndirme bağlantısının süresi dolmuş veya daha önce kullanılmış. Uygulamadan yeniden dene.');
      }
      // Yetki indirme anında yeniden denetlenir (ör. bu arada personel yetkisi alındıysa)
      user = { id: link.userId, username: link.username };
    } else {
      if (!r.auth) throw Errors.unauthenticated();
      user = me(r);
    }
    const f = await service.download(user, id);
    return reply
      .header('Content-Type', f.mimeType === 'text/plain' ? 'text/plain; charset=utf-8' : f.mimeType)
      .header('Content-Disposition', `attachment; filename="${f.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(f.bytes);
  });

  // ---------------------------------------------------------------- personel (destek masası)
  const staffRead = { preHandler: [guards.requireAuth, guards.requirePermission('support.read')] };
  app.get<{ Querystring: { status?: string; category?: string; mine?: string } }>('/support/staff/tickets', staffRead, async (r) => ({
    tickets: await service.queue({ ...(r.query.status ? { status: r.query.status } : {}), ...(r.query.category ? { category: r.query.category } : {}), mine: r.query.mine === '1' }, me(r)),
  }));
  app.get<{ Params: { no: string } }>('/support/staff/tickets/:no', staffRead, async (r) => ({ ticket: await service.staffTicket(me(r), ticketNo(r.params.no)) }));
  app.post<{ Params: { no: string } }>(
    '/support/staff/tickets/:no/replies',
    { preHandler: [guards.requireAuth, guards.requirePermission('support.reply')], ...text },
    async (r, reply) => reply.code(201).send(await service.staffReply(me(r), ticketNo(r.params.no), r.body)),
  );
  app.post<{ Params: { no: string } }>(
    '/support/staff/tickets/:no/update',
    { preHandler: [guards.requireAuth, guards.requirePermission('support.manage')] },
    async (r) => ({ ticket: await service.staffUpdate(me(r), ticketNo(r.params.no), r.body) }),
  );
}
