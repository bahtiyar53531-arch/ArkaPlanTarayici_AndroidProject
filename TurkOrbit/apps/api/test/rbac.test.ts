import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, ROLE_RANK } from '@turkorbit/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { changeRole } from '../src/scripts/role-cli.js';
import { call, createTestContext, registerAndLogin, resetDatabase, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  // Yalnızca testte kullanılan, yetki korumalı örnek uç nokta (Aşama 14'teki /admin rotaları aynı korumayı kullanacak).
  ctx = await createTestContext({}, ({ app, guards }) => {
    app.get(
      '/api/v1/__test/admin-only',
      { preHandler: [guards.requireAuth, guards.requirePermission('players.ban')] },
      async () => ({ ok: true }),
    );
  });
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await resetDatabase(ctx.rt);
});

describe('rol ve yetki (RBAC)', () => {
  it('veritabanı tohum verisi paylaşılan rol kataloğuyla birebir aynıdır', async () => {
    const roles = await ctx.rt.db.query<{ key: string; rank: number }>('SELECT key, rank FROM roles');
    expect(roles.rows.map((r) => r.key).sort()).toEqual([...ROLES].sort());
    for (const r of roles.rows) expect(r.rank).toBe(ROLE_RANK[r.key as keyof typeof ROLE_RANK]);

    const perms = await ctx.rt.db.query<{ key: string }>('SELECT key FROM permissions');
    expect(perms.rows.map((r) => r.key).sort()).toEqual([...PERMISSIONS].sort());

    const rp = await ctx.rt.db.query<{ role_key: string; permission_key: string }>(
      'SELECT role_key, permission_key FROM role_permissions',
    );
    for (const role of ROLES) {
      const db = rp.rows.filter((r) => r.role_key === role).map((r) => r.permission_key).sort();
      expect(db, role).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('oyuncu yönetim uç noktasına erişemez (yetki sunucuda denetlenir)', async () => {
    const { client } = await registerAndLogin(ctx, 'SiradanPilot');
    const r = await call(ctx.app, client, 'GET', '/__test/admin-only');
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('FORBIDDEN');
  });

  it('sunucu tarafı rol aracı yetkiyi verir/geri alır ve her işlemi denetim kaydına yazar', async () => {
    const { client } = await registerAndLogin(ctx, 'GorevliPilot');
    const grant = await changeRole(ctx.rt.db, {
      action: 'grant',
      user: 'gorevlipilot',
      role: 'moderator',
      reason: 'Topluluk moderatörü olarak atandı',
      actorLabel: 'cli:test@ci',
    });
    expect(grant.changed).toBe(true);
    expect(grant.after).toEqual(['moderator', 'player']);

    const allowed = await call(ctx.app, client, 'GET', '/__test/admin-only');
    expect(allowed.statusCode).toBe(200);
    const me = (await call(ctx.app, client, 'GET', '/auth/me')).json();
    expect(me.permissions).toContain('players.ban');

    await changeRole(ctx.rt.db, { action: 'revoke', user: 'GorevliPilot', role: 'moderator', reason: 'Görev sona erdi', actorLabel: 'cli:test@ci' });
    expect((await call(ctx.app, client, 'GET', '/__test/admin-only')).statusCode).toBe(403);

    const audit = await ctx.rt.db.query(
      `SELECT actor_label, action, reason, before_value, after_value, result FROM admin_audit_log ORDER BY id`,
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[0]).toMatchObject({ actor_label: 'cli:test@ci', action: 'role.grant', result: 'success' });
    expect(audit.rows[0].before_value).toEqual({ roles: ['player'] });
    expect(audit.rows[1].action).toBe('role.revoke');
  });

  it('rol aracı geçersiz rol, gerekçesiz işlem ve "player" rolü değişikliğini reddeder', async () => {
    await registerAndLogin(ctx, 'HataPilot');
    await expect(changeRole(ctx.rt.db, { action: 'grant', user: 'HataPilot', role: 'tanri', reason: 'x'.repeat(5) })).rejects.toThrow(/Bilinmeyen rol/);
    await expect(changeRole(ctx.rt.db, { action: 'grant', user: 'HataPilot', role: 'super_admin', reason: '' })).rejects.toThrow(/gerekçe/);
    await expect(changeRole(ctx.rt.db, { action: 'revoke', user: 'HataPilot', role: 'player', reason: 'deneme' })).rejects.toThrow(/varsayılan/);
    await expect(changeRole(ctx.rt.db, { action: 'grant', user: 'YokBoyle', role: 'moderator', reason: 'deneme' })).rejects.toThrow(/bulunamadı/);
  });

  it('denetim kaydı değiştirilemez ve silinemez', async () => {
    await registerAndLogin(ctx, 'DenetimPilot');
    await changeRole(ctx.rt.db, { action: 'grant', user: 'DenetimPilot', role: 'read_only', reason: 'Raporlama' });
    await expect(ctx.rt.db.query(`UPDATE admin_audit_log SET reason = 'değiştirildi'`)).rejects.toThrow(/değiştirilemez/);
    await expect(ctx.rt.db.query(`DELETE FROM admin_audit_log`)).rejects.toThrow(/değiştirilemez/);
  });

  it('veritabanı seviyesinde de her yeni kullanıcıya otomatik "player" rolü atanır', async () => {
    await ctx.rt.db.query(
      `INSERT INTO users (username, email, password_hash, terms_accepted_at, terms_version)
       VALUES ('DogrudanSql', 'sql@ornek.com', 'x', now(), 'test')`,
    );
    const { rows } = await ctx.rt.db.query(
      `SELECT role_key FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.username = 'DogrudanSql'`,
    );
    expect(rows.map((r) => r.role_key)).toEqual(['player']);
  });
});

describe('migration çalıştırıcısı', () => {
  it('tekrar çalıştırıldığında hiçbir şey uygulamaz (idempotent)', async () => {
    const r = await runMigrations(ctx.rt.db);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toContain('0001_auth.sql');
  });

  it('uygulanmış dosya değiştirilirse çalışmayı durdurur', async () => {
    await ctx.rt.db.query(`UPDATE schema_migrations SET checksum = 'eski' WHERE filename = '0001_auth.sql'`);
    await expect(runMigrations(ctx.rt.db)).rejects.toThrow(/checksum/);
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    const { DEFAULT_MIGRATIONS_DIR } = await import('../src/db/migrate.js');
    const sql = await readFile(`${DEFAULT_MIGRATIONS_DIR}/0001_auth.sql`, 'utf8');
    await ctx.rt.db.query(`UPDATE schema_migrations SET checksum = $1 WHERE filename = '0001_auth.sql'`, [
      createHash('sha256').update(sql).digest('hex'),
    ]);
  });
});
