/**
 * Sunucu tarafı rol atama aracı (Aşama 1).
 *
 * Yönetici yetkisi API üzerinden VERİLEMEZ. İlk Süper Yönetici, sunucuya SSH ile erişimi ve
 * veritabanı bilgileri olan kişi tarafından bu araçla atanır; her işlem admin_audit_log'a yazılır.
 * Aşama 14'te Yönetim Merkezi'nden rol atama (roles.assign yetkisi + gerekirse iki yetkili onayı) eklenecek.
 *
 * Kullanım:
 *   npm run admin:grant-role  -- --user <kullanıcıadı|e-posta|oyuncuID> --role super_admin --reason "İlk kurulum"
 *   npm run admin:revoke-role -- --user <...> --role moderator --reason "Görev değişikliği"
 */
import os from 'node:os';
import { parseArgs } from 'node:util';
import { ROLES, type RoleKey } from '@turkorbit/shared';
import { loadConfig } from '../config/env.js';
import { createPool, withTransaction, type Db } from '../db/pool.js';
import { getUserRoles } from '../modules/auth/repository.js';

export interface RoleChangeInput {
  action: 'grant' | 'revoke';
  user: string;
  role: string;
  reason: string;
  actorLabel?: string;
}

export interface RoleChangeResult {
  userId: string;
  username: string;
  before: RoleKey[];
  after: RoleKey[];
  changed: boolean;
}

export async function changeRole(db: Db, input: RoleChangeInput): Promise<RoleChangeResult> {
  if (!(ROLES as readonly string[]).includes(input.role)) {
    throw new Error(`Bilinmeyen rol: ${input.role}. Geçerli roller: ${ROLES.join(', ')}`);
  }
  if (input.role === 'player') throw new Error('"player" rolü varsayılandır; atanamaz veya kaldırılamaz.');
  if (!input.reason || input.reason.trim().length < 3) throw new Error('--reason (gerekçe) zorunludur.');
  const actorLabel = input.actorLabel ?? `cli:${os.userInfo().username}@${os.hostname()}`;

  return withTransaction(db, async (c) => {
    const isNumeric = /^\d+$/.test(input.user);
    const { rows } = await c.query<{ id: string; username: string }>(
      `SELECT id, username::text AS username FROM users
       WHERE ${isNumeric ? 'public_id = $1::bigint' : 'username = $1 OR email = $1'} FOR UPDATE`,
      [input.user],
    );
    const user = rows[0];
    if (!user) throw new Error(`Kullanıcı bulunamadı: ${input.user}`);

    const before = await getUserRoles(c, user.id);
    if (input.action === 'grant') {
      await c.query(
        `INSERT INTO user_roles (user_id, role_key, reason) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, role_key) DO NOTHING`,
        [user.id, input.role, input.reason],
      );
    } else {
      await c.query('DELETE FROM user_roles WHERE user_id = $1 AND role_key = $2', [user.id, input.role]);
    }
    const after = await getUserRoles(c, user.id);
    const changed = before.join() !== after.join();
    await c.query(
      `INSERT INTO admin_audit_log (actor_user_id, actor_label, action, target_type, target_id,
         before_value, after_value, reason, result)
       VALUES (NULL, $1, $2, 'user', $3, $4, $5, $6, 'success')`,
      [
        actorLabel,
        input.action === 'grant' ? 'role.grant' : 'role.revoke',
        user.id,
        JSON.stringify({ roles: before }),
        JSON.stringify({ roles: after, role: input.role, changed }),
        input.reason,
      ],
    );
    return { userId: user.id, username: user.username, before, after, changed };
  });
}

async function main() {
  const action = process.argv[2];
  if (action !== 'grant' && action !== 'revoke') {
    console.error('Kullanım: role-cli.ts <grant|revoke> --user <...> --role <rol> --reason "<gerekçe>"');
    process.exit(2);
  }
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { user: { type: 'string' }, role: { type: 'string' }, reason: { type: 'string' } },
  });
  if (!values.user || !values.role) {
    console.error('--user ve --role zorunludur.');
    process.exit(2);
  }
  const pool = createPool(loadConfig().databaseUrl, 2);
  try {
    const r = await changeRole(pool, {
      action,
      user: values.user,
      role: values.role,
      reason: values.reason ?? '',
    });
    console.log(
      `${r.changed ? '✔' : '•'} ${r.username}: [${r.before.join(', ')}] → [${r.after.join(', ')}]` +
        (r.changed ? '' : ' (değişiklik yok)'),
    );
    console.log('İşlem admin_audit_log tablosuna kaydedildi.');
  } catch (err) {
    console.error(`✖ ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Doğrudan çalıştırıldığında CLI; testlerde changeRole() içe aktarılır.
if (process.argv[1] && /role-cli\.(ts|js)$/.test(process.argv[1])) {
  await main();
}
