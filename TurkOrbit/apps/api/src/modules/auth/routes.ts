import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/env.js';
import { normalizePlatform, safeIp } from '../../lib/client-info.js';
import type { AuthGuards } from './guards.js';
import type { AuthService, RequestContext } from './service.js';

function ctxOf(request: FastifyRequest): RequestContext {
  const ua = request.headers['user-agent'];
  const platform = request.headers['x-client-platform'];
  return {
    ip: safeIp(request.ip),
    userAgent: typeof ua === 'string' ? ua : null,
    platformHint: normalizePlatform(typeof platform === 'string' ? platform : undefined),
  };
}

export function authRoutes(app: FastifyInstance, opts: { service: AuthService; guards: AuthGuards; config: AppConfig }) {
  const { service, guards, config } = opts;
  const cookie = config.session;

  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(cookie.cookieName, token, {
      httpOnly: true,
      secure: cookie.cookieSecure,
      sameSite: 'strict',
      path: '/',
      maxAge: cookie.ttlSeconds,
    });
  const clearSessionCookie = (reply: FastifyReply) =>
    reply.clearCookie(cookie.cookieName, { path: '/', httpOnly: true, secure: cookie.cookieSecure, sameSite: 'strict' });

  // ---------------------------------------------------------------- kayıt ve doğrulama
  app.post('/auth/register', async (request, reply) => {
    await service.register(request.body, ctxOf(request));
    return reply.code(201).send({
      status: 'pending_verification',
      message:
        'Kayıt isteğin alındı. Hesabını etkinleştirmek için e-posta adresine gönderdiğimiz bağlantıyı aç.',
    });
  });

  app.post('/auth/verify-email', async (request) => {
    const r = await service.verifyEmail(request.body);
    return { status: 'verified', username: r.username, message: 'E-posta adresin doğrulandı. İyi uçuşlar pilot!' };
  });

  app.post('/auth/resend-verification', { preHandler: guards.requireAuth }, async (request) => {
    const r = await service.resendVerification(request.auth!);
    return r.alreadyVerified
      ? { status: 'already_verified', message: 'E-posta adresin zaten doğrulanmış.' }
      : { status: 'sent', message: 'Yeni doğrulama bağlantısı e-posta adresine gönderildi.' };
  });

  // ---------------------------------------------------------------- giriş / çıkış
  app.post('/auth/login', async (request, reply) => {
    const r = await service.login(request.body, ctxOf(request));
    const { sessionToken, transport, ...body } = r;
    if (transport === 'cookie') {
      setSessionCookie(reply, sessionToken);
      return body;
    }
    // Mobil/masaüstü uygulama: anahtar yanıt gövdesinde döner, cihazın güvenli deposunda saklanır.
    return { ...body, sessionToken };
  });

  app.post('/auth/logout', { preHandler: guards.requireAuth }, async (request, reply) => {
    await service.logout(request.auth!);
    clearSessionCookie(reply);
    return { status: 'logged_out' };
  });

  app.get('/auth/me', { preHandler: guards.requireAuth }, async (request) => service.me(request.auth!));

  // ---------------------------------------------------------------- parola
  app.post('/auth/password/forgot', async (request, reply) => {
    await service.forgotPassword(request.body, ctxOf(request));
    return reply.code(202).send({
      status: 'accepted',
      message: 'Bu e-posta adresine kayıtlı bir hesap varsa parola sıfırlama bağlantısı gönderildi.',
    });
  });

  app.post('/auth/password/reset', async (request) => {
    await service.resetPassword(request.body);
    return {
      status: 'password_reset',
      message: 'Parolan güncellendi ve tüm cihazlardaki oturumların kapatıldı. Yeni parolanla giriş yapabilirsin.',
    };
  });

  app.post('/auth/password/change', { preHandler: guards.requireAuth }, async (request) => {
    const r = await service.changePassword(request.auth!, request.body);
    return {
      status: 'password_changed',
      revokedOtherSessions: r.revokedOtherSessions,
      message: 'Parolan değiştirildi. Diğer cihazlardaki oturumların kapatıldı.',
    };
  });

  // ---------------------------------------------------------------- oturumlar ve geçmiş
  app.get('/auth/sessions', { preHandler: guards.requireAuth }, async (request) => ({
    sessions: await service.listSessions(request.auth!),
  }));

  app.delete<{ Params: { id: string } }>(
    '/auth/sessions/:id',
    { preHandler: guards.requireAuth },
    async (request, reply) => {
      const r = await service.revokeSession(request.auth!, request.params.id);
      if (r.current) clearSessionCookie(reply);
      return { status: 'revoked', current: r.current };
    },
  );

  app.post('/auth/sessions/revoke-others', { preHandler: guards.requireAuth }, async (request) => {
    const r = await service.revokeOtherSessions(request.auth!);
    return { status: 'revoked', revoked: r.revoked };
  });

  app.get('/auth/login-history', { preHandler: guards.requireAuth }, async (request) => ({
    events: await service.loginHistory(request.auth!),
  }));
}
