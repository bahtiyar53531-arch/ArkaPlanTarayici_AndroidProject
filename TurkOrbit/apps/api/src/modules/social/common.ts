/** Sosyal modüllerin ortak yardımcıları (Aşama 12). */
import { levelForXp } from '@turkorbit/shared';
import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

export const err = (code: ConstructorParameters<typeof AppError>[0], status: number, message: string) => new AppError(code, status, message);
export const fmt = (n: number) => n.toLocaleString('tr-TR');

export interface Pilot {
  id: string;
  userId: string;
  name: string;
  level: number;
  serverId: number;
  serverCode: string;
  company: string;
  color: string;
}

interface PilotRow {
  id: string;
  user_id: string;
  pilot_name: string;
  experience: string;
  server_id: number;
  server_code: string;
  company_code: string;
  color_hex: string;
}

const SELECT = `SELECT p.id, p.user_id, p.pilot_name, p.experience, p.server_id, s.code AS server_code, co.code AS company_code, co.color_hex
  FROM players p JOIN game_servers s ON s.id = p.server_id JOIN companies co ON co.id = p.company_id`;

const toPilot = (r: PilotRow): Pilot => ({
  id: r.id,
  userId: r.user_id,
  name: r.pilot_name,
  level: levelForXp(Number(r.experience)),
  serverId: r.server_id,
  serverCode: r.server_code,
  company: r.company_code,
  color: r.color_hex,
});

/** Oturum sahibinin bu sunucudaki pilotu. lock: pilot satırı kilitlenir (aynı pilotun eşzamanlı işlemleri sıraya girer). */
export async function myPilot(c: Queryable, userId: string, serverCode: string, lock = false): Promise<Pilot> {
  const r = await c.query<PilotRow>(`${SELECT} WHERE p.user_id = $1 AND s.code = $2 ${lock ? 'FOR UPDATE OF p' : ''}`, [userId, serverCode.toUpperCase()]);
  if (!r.rows[0]) throw err('PILOT_NOT_FOUND', 404, 'Bu sunucuda henüz bir pilotun yok.');
  return toPilot(r.rows[0]);
}

/** Aynı sunucuda adı verilen pilot (büyük/küçük harf duyarsız). */
export async function pilotByName(c: Queryable, serverId: number, name: string): Promise<Pilot> {
  const r = await c.query<PilotRow>(`${SELECT} WHERE p.server_id = $1 AND p.pilot_name = $2`, [serverId, name]);
  if (!r.rows[0]) throw err('PILOT_NOT_FOUND', 404, `"${name}" adlı pilot bulunamadı.`);
  return toPilot(r.rows[0]);
}

export async function pilotById(c: Queryable, id: string): Promise<Pilot> {
  const r = await c.query<PilotRow>(`${SELECT} WHERE p.id = $1`, [id]);
  if (!r.rows[0]) throw err('PILOT_NOT_FOUND', 404, 'Pilot bulunamadı.');
  return toPilot(r.rows[0]);
}

/** a, b'yi engellemiş mi (veya tersi, both=true ise) */
export async function isBlocked(c: Queryable, a: string, b: string, both = false): Promise<boolean> {
  const r = await c.query(
    both
      ? `SELECT 1 FROM player_blocks WHERE (player_id = $1 AND blocked_id = $2) OR (player_id = $2 AND blocked_id = $1)`
      : `SELECT 1 FROM player_blocks WHERE player_id = $1 AND blocked_id = $2`,
    [a, b],
  );
  return (r.rowCount ?? 0) > 0;
}
