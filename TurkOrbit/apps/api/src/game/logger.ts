import type { Logger } from '../modules/auth/service.js';

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 100 } as const;

/** API'nin (pino) biçimiyle uyumlu, tek satır JSON günlük. */
export function createLogger(level: string): Logger {
  const min = LEVELS[level as keyof typeof LEVELS] ?? LEVELS.info;
  const write = (lvl: number, obj: object, msg?: string) => {
    if (lvl < min) return;
    const o = obj as { err?: unknown };
    const err = o.err instanceof Error ? { type: o.err.name, message: o.err.message, stack: o.err.stack } : o.err;
    const line = JSON.stringify({ level: lvl, time: Date.now(), pid: process.pid, svc: 'game', ...obj, ...(err ? { err } : {}), msg });
    (lvl >= LEVELS.warn ? process.stderr : process.stdout).write(line + '\n');
  };
  return {
    info: (obj, msg) => write(LEVELS.info, obj, msg),
    warn: (obj, msg) => write(LEVELS.warn, obj, msg),
    error: (obj, msg) => write(LEVELS.error, obj, msg),
  };
}
