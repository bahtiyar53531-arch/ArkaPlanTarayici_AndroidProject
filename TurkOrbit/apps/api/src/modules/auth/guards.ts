import type { PermissionKey } from '@turkorbit/shared';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError, Errors } from '../../lib/errors.js';
import type { AuthenticatedContext, AuthService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthenticatedContext | null;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Oturumu çözer:
 *  - "Authorization: Bearer <anahtar>" → mobil/masaüstü uygulama oturumu (CSRF gerekmez, tarayıcı otomatik eklemez)
 *  - HttpOnly çerez → web oturumu (durum değiştiren isteklerde X-CSRF-Token zorunlu)
 */
export function createAuthGuards(service: AuthService, cookieName: string) {
  async function resolve(request: FastifyRequest): Promise<AuthenticatedContext | null> {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return service.authenticate(header.slice(7).trim(), 'token');
    }
    const cookie = request.cookies[cookieName];
    if (cookie) {
      const auth = await service.authenticate(cookie, 'cookie');
      if (auth && UNSAFE_METHODS.has(request.method)) {
        const csrf = request.headers['x-csrf-token'];
        if (!service.verifyCsrf(auth.session, typeof csrf === 'string' ? csrf : undefined)) {
          throw Errors.csrf();
        }
      }
      return auth;
    }
    return null;
  }

  const requireAuth: preHandlerAsyncHookHandler = async (request: FastifyRequest, _reply: FastifyReply) => {
    request.auth = await resolve(request);
    if (!request.auth) throw Errors.unauthenticated();
  };

  const requireVerifiedEmail: preHandlerAsyncHookHandler = async (request) => {
    if (!request.auth) throw Errors.unauthenticated();
    if (!request.auth.user.email_verified_at) {
      throw new AppError('EMAIL_NOT_VERIFIED', 403, 'Bu işlem için önce e-posta adresini doğrulamalısın.');
    }
  };

  /** Yetki kontrolü HER ZAMAN sunucuda, veritabanındaki rol-yetki eşlemesinden yapılır. */
  function requirePermission(permission: PermissionKey): preHandlerAsyncHookHandler {
    return async (request) => {
      if (!request.auth) throw Errors.unauthenticated();
      if (!(await service.hasPermission(request.auth, permission))) throw Errors.forbidden();
    };
  }

  return { requireAuth, requireVerifiedEmail, requirePermission };
}

export type AuthGuards = ReturnType<typeof createAuthGuards>;
