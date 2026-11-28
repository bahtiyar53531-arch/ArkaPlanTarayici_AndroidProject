/**
 * Başarım değerlendirmesi (Aşama 5; Aşama 10'dan itibaren oyun olaylarında da anında çalışır).
 * İlerleme istatistiklerden hesaplanır; hedefe ulaşılmış ama verilmemiş başarımlar verilir. İdempotenttir:
 * aynı başarım iki kez verilemez (birincil anahtar), "yeni kazanılanlar" yalnızca gerçekten eklenenlerdir.
 */
import { levelForXp, type AchievementProgress } from '@turkorbit/shared';
import type { Queryable } from '../../db/pool.js';
import { listAchievementsForPlayer } from './repository.js';

const STAT_KEYS: Record<string, string> = {
  npc_kills: 'npcKills',
  player_kills: 'playerKills',
  gates_completed: 'gatesCompleted',
  cargo_collected: 'cargoCollected',
  playtime_seconds: 'playtimeSeconds',
  level: 'level',
};

export interface AchievementSync {
  earned: number;
  total: number;
  items: AchievementProgress[];
  /** Bu çağrıda yeni verilenler */
  newlyEarned: Array<{ code: string; name: string }>;
}

/** İstatistikleri veritabanından okur (oyun sunucusu ve görev servisi için). */
export async function achievementValues(db: Queryable, playerId: string): Promise<Record<string, number>> {
  const r = await db.query<{ experience: string; playtime_seconds: string; npc_kills: string | null; player_kills: string | null; gates_completed: string | null; cargo_collected: string | null }>(
    `SELECT p.experience, p.playtime_seconds, s.npc_kills, s.player_kills, s.gates_completed, s.cargo_collected
     FROM players p LEFT JOIN player_stats s ON s.player_id = p.id WHERE p.id = $1`,
    [playerId],
  );
  const row = r.rows[0];
  if (!row) return {};
  return {
    level: levelForXp(Number(row.experience)),
    playtimeSeconds: Number(row.playtime_seconds),
    npcKills: Number(row.npc_kills ?? 0),
    playerKills: Number(row.player_kills ?? 0),
    gatesCompleted: Number(row.gates_completed ?? 0),
    cargoCollected: Number(row.cargo_collected ?? 0),
  };
}

export async function syncAchievements(db: Queryable, playerId: string, values?: Record<string, number>): Promise<AchievementSync> {
  const v = values ?? (await achievementValues(db, playerId));
  const rows = await listAchievementsForPlayer(db, playerId);
  const toAward: number[] = [];
  const items: AchievementProgress[] = rows.map((a) => {
    const target = Number(a.target);
    const statKey = STAT_KEYS[a.stat_key];
    const raw = a.completed_at ? target : statKey ? (v[statKey] ?? 0) : 0;
    let completedAt = a.completed_at?.toISOString() ?? null;
    if (!completedAt && statKey && raw >= target) {
      toAward.push(a.id);
      completedAt = new Date().toISOString();
    }
    return { code: a.code, name: a.name, description: a.description, category: a.category, target, progress: Math.min(target, raw), completedAt };
  });
  let newlyEarned: AchievementSync['newlyEarned'] = [];
  if (toAward.length) {
    const ins = await db.query<{ achievement_id: number }>(
      `INSERT INTO player_achievements (player_id, achievement_id)
       SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING RETURNING achievement_id`,
      [playerId, toAward],
    );
    const added = new Set(ins.rows.map((x) => x.achievement_id));
    newlyEarned = rows.filter((a) => added.has(a.id)).map((a) => ({ code: a.code, name: a.name }));
  }
  return { earned: items.filter((i) => i.completedAt).length, total: items.length, items, newlyEarned };
}
