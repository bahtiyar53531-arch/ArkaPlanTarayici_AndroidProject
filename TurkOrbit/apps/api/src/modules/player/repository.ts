import type { Queryable } from '../../db/pool.js';

export interface ServerRow {
  id: number;
  code: string;
  name: string;
  region: string;
  is_open: boolean;
  is_maintenance: boolean;
}

export interface CompanyRow {
  id: number;
  code: string;
  name: string;
  motto: string;
  description: string;
  focus: string;
  color_hex: string;
  home_map_id: number;
  home_map_code: string;
  home_map_name: string;
  spawn_x: number;
  spawn_y: number;
}

export interface PilotRow {
  id: string;
  user_id: string;
  public_id: string;
  pilot_name: string;
  server_code: string;
  server_name: string;
  company_id: number;
  company_code: string;
  company_name: string;
  company_color: string;
  experience: string;
  honor: string;
  map_code: string;
  map_name: string;
  map_type: string;
  pvp_enabled: boolean;
  pos_x: number;
  pos_y: number;
  playtime_seconds: string;
  motto: string | null;
  company_changed_at: Date | null;
  last_online_at: Date | null;
  created_at: Date;
  ship_code: string | null;
  ship_name: string | null;
  ship_class: string | null;
  ship_sprite: string | null;
  ship_hp: number | null;
  ship_max_hp: number | null;
  ship_speed: number | null;
  ship_cargo: number | null;
  slots_laser: number | null;
  slots_generator: number | null;
  slots_extra: number | null;
  slots_drone: number | null;
  npc_kills: string;
  player_kills: string;
  deaths: string;
  gates_completed: number;
  cargo_collected: string;
  damage_dealt: string;
  damage_taken: string;
}

export async function listServers(db: Queryable, userId: string | null) {
  const { rows } = await db.query<ServerRow & { pilot_count: string; has_my_pilot: boolean }>(
    `SELECT s.id, s.code, s.name, s.region, s.is_open, s.is_maintenance,
            (SELECT count(*) FROM players p WHERE p.server_id = s.id) AS pilot_count,
            EXISTS (SELECT 1 FROM players p WHERE p.server_id = s.id AND p.user_id = $1) AS has_my_pilot
     FROM game_servers s ORDER BY s.sort_order, s.id`,
    [userId],
  );
  return rows;
}

export async function findServer(db: Queryable, code: string): Promise<ServerRow | null> {
  const { rows } = await db.query<ServerRow>(
    'SELECT id, code, name, region, is_open, is_maintenance FROM game_servers WHERE code = $1',
    [code],
  );
  return rows[0] ?? null;
}

const COMPANY_SELECT = `SELECT c.id, c.code, c.name, c.motto, c.description, c.focus, c.color_hex, c.home_map_id,
  m.code AS home_map_code, m.name AS home_map_name, m.spawn_x, m.spawn_y
  FROM companies c JOIN maps m ON m.id = c.home_map_id`;

export async function listCompanies(db: Queryable, serverId: number | null) {
  const { rows } = await db.query<CompanyRow & { pilot_count: string }>(
    `SELECT x.*, (SELECT count(*) FROM players p WHERE p.company_id = x.id AND ($1::smallint IS NULL OR p.server_id = $1)) AS pilot_count
     FROM (${COMPANY_SELECT}) x ORDER BY x.id`,
    [serverId],
  );
  return rows;
}

export async function findCompany(db: Queryable, code: string): Promise<CompanyRow | null> {
  const { rows } = await db.query<CompanyRow>(`${COMPANY_SELECT} WHERE c.code = $1`, [code]);
  return rows[0] ?? null;
}

export async function findStarterShip(db: Queryable) {
  const { rows } = await db.query<{ id: number; hitpoints: number }>(
    'SELECT id, hitpoints FROM ship_types WHERE is_starter AND NOT is_archived LIMIT 1',
  );
  return rows[0] ?? null;
}

const PILOT_SELECT = `
  SELECT p.id, p.user_id, u.public_id::text AS public_id, p.pilot_name::text AS pilot_name,
         s.code AS server_code, s.name AS server_name,
         c.id AS company_id, c.code AS company_code, c.name AS company_name, c.color_hex AS company_color,
         p.experience, p.honor, m.code AS map_code, m.name AS map_name, m.map_type, m.pvp_enabled,
         p.pos_x, p.pos_y, p.playtime_seconds, p.motto, p.company_changed_at, p.last_online_at, p.created_at,
         st.code AS ship_code, st.name AS ship_name, st.ship_class, st.sprite_key AS ship_sprite,
         ps.hitpoints AS ship_hp, st.hitpoints AS ship_max_hp, st.base_speed AS ship_speed,
         st.cargo_capacity AS ship_cargo, st.laser_slots AS slots_laser, st.generator_slots AS slots_generator,
         st.extra_slots AS slots_extra, st.drone_slots AS slots_drone,
         COALESCE(x.npc_kills, 0) AS npc_kills, COALESCE(x.player_kills, 0) AS player_kills,
         COALESCE(x.deaths, 0) AS deaths, COALESCE(x.gates_completed, 0) AS gates_completed,
         COALESCE(x.cargo_collected, 0) AS cargo_collected, COALESCE(x.damage_dealt, 0) AS damage_dealt,
         COALESCE(x.damage_taken, 0) AS damage_taken
  FROM players p
  JOIN users u ON u.id = p.user_id
  JOIN game_servers s ON s.id = p.server_id
  JOIN companies c ON c.id = p.company_id
  JOIN maps m ON m.id = p.map_id
  LEFT JOIN player_ships ps ON ps.id = p.active_ship_id
  LEFT JOIN ship_types st ON st.id = ps.ship_type_id
  LEFT JOIN player_stats x ON x.player_id = p.id`;

export async function findPilotsByUser(db: Queryable, userId: string): Promise<PilotRow[]> {
  const { rows } = await db.query<PilotRow>(`${PILOT_SELECT} WHERE p.user_id = $1 ORDER BY s.id`, [userId]);
  return rows;
}

export async function findPilotByUserAndServer(db: Queryable, userId: string, serverCode: string) {
  const { rows } = await db.query<PilotRow>(`${PILOT_SELECT} WHERE p.user_id = $1 AND s.code = $2`, [
    userId,
    serverCode,
  ]);
  return rows[0] ?? null;
}

export async function findPilotById(db: Queryable, playerId: string) {
  const { rows } = await db.query<PilotRow>(`${PILOT_SELECT} WHERE p.id = $1`, [playerId]);
  return rows[0] ?? null;
}

export async function findPublicPilot(db: Queryable, serverCode: string, pilotName: string) {
  const { rows } = await db.query<PilotRow>(
    `${PILOT_SELECT} WHERE s.code = $1 AND p.pilot_name = $2 AND u.status <> 'deleted'`,
    [serverCode, pilotName],
  );
  return rows[0] ?? null;
}

export interface RankRow {
  id: number;
  name: string;
  minPoints: number;
}

export async function listRanks(db: Queryable): Promise<RankRow[]> {
  const { rows } = await db.query<{ id: number; name: string; min_points: string }>(
    'SELECT id, name, min_points FROM ranks ORDER BY min_points',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, minPoints: Number(r.min_points) }));
}

export interface AchievementRow {
  id: number;
  code: string;
  name: string;
  description: string;
  category: string;
  stat_key: string;
  target: string;
  completed_at: Date | null;
}

export async function listAchievementsForPlayer(db: Queryable, playerId: string) {
  const { rows } = await db.query<AchievementRow>(
    `SELECT a.id, a.code, a.name, a.description, a.category, a.stat_key, a.target, pa.completed_at
     FROM achievements a
     LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
     WHERE NOT a.is_hidden OR pa.completed_at IS NOT NULL
     ORDER BY a.sort_order, a.id`,
    [playerId],
  );
  return rows;
}

export async function awardAchievements(db: Queryable, playerId: string, achievementIds: number[]) {
  if (achievementIds.length === 0) return;
  await db.query(
    `INSERT INTO player_achievements (player_id, achievement_id)
     SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
    [playerId, achievementIds],
  );
}
