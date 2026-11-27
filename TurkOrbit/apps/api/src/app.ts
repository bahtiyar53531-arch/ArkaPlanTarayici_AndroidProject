import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, Errors } from './lib/errors.js';
import { createAuthGuards, type AuthGuards } from './modules/auth/guards.js';
import { authRoutes } from './modules/auth/routes.js';
import { AuthService, type AuthLimits } from './modules/auth/service.js';
import { healthRoutes } from './modules/health/routes.js';
import { hangarRoutes } from './modules/hangar/routes.js';
import { HangarService, type Rng } from './modules/hangar/service.js';
import { playerRoutes } from './modules/player/routes.js';
import { PlayerService } from './modules/player/service.js';
import type { Runtime } from './runtime.js';

export interface BuiltApp {
  app: FastifyInstance;
  auth: AuthService;
  players: PlayerService;
  hangar: HangarService;
  guards: AuthGuards;
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(
  rt: Runtime,
  options: { limits?: Partial<AuthLimits>; rng?: Rng } = {},
): Promise<BuiltApp> {
  const { config } = rt;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]'],
        censor: '[gizli]',
      },
    },
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024,
  });

  // Yalnızca application/json kabul edilir: tarayıcı formları (text/plain, form-urlencoded) ile
  // siteler arası istek sahteciliği (CSRF) yapılamaz; JSON istekleri CORS ön kontrolüne takılır.
  app.removeContentTypeParser('text/plain');

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Client-Platform', 'X-Client-Version'],
    maxAge: 600,
  });
  await app.register(cookie);
  app.decorateRequest('auth', null);

  // Durum değiştiren isteklerde Origin denetimi (CSRF'ye karşı ek katman).
  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) throw Errors.origin();
    if (!origin && request.headers['sec-fetch-site'] === 'cross-site') throw Errors.origin();
  });

  app.setErrorHandler((err: FastifyError | AppError | ZodError, request, reply) => {
    if (err instanceof AppError) {
      if (err.extra.retryAfterSeconds) reply.header('Retry-After', String(err.extra.retryAfterSeconds));
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, ...err.extra },
      });
    }
    if (err instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of err.issues) {
        let key = issue.path.map(String).join('.') || '_';
        let message = issue.message;
        if (issue.code === 'unrecognized_keys') {
          key = '_';
          message = `İzin verilmeyen alan: ${issue.keys.join(', ')}`;
        }
        (fields[key] ??= []).push(message);
      }
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Gönderilen bilgiler geçersiz.', fields },
      });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status === 415) {
      return reply.code(415).send({
        error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'İstek gövdesi application/json olmalı.' },
      });
    }
    if (status === 413) {
      return reply.code(413).send({ error: { code: 'VALIDATION_ERROR', message: 'İstek gövdesi çok büyük.' } });
    }
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz istek.' } });
    }
    request.log.error({ err }, 'beklenmeyen hata');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar dene.' },
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'İstenen adres bulunamadı.' } }),
  );

  const auth = new AuthService({
    db: rt.db,
    config,
    hasher: rt.hasher,
    mailer: rt.mailer,
    limiter: rt.limiter,
    cache: rt.cache,
    log: app.log,
    ...(options.limits ? { limits: options.limits } : {}),
  });
  const guards = createAuthGuards(auth, config.session.cookieName);
  const players = new PlayerService(rt.db, app.log);
  const hangar = new HangarService(rt.db, app.log, options.rng);

  await app.register(
    async (api) => {
      healthRoutes(api, rt);
      authRoutes(api, { service: auth, guards, config });
      playerRoutes(api, { service: players, guards, limiter: rt.limiter });
      hangarRoutes(api, { service: hangar, guards });
    },
    { prefix: '/api/v1' },
  );

  return { app, auth, players, hangar, guards };
}
