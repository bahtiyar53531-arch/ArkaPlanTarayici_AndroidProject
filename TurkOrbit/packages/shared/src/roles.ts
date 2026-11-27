/**
 * Türk Orbit rol ve yetki kataloğu.
 *
 * ÖNEMLİ: Bu liste istemcide yalnızca görüntüleme amaçlıdır. Yetki kontrolü HER ZAMAN
 * sunucuda, veritabanındaki role_permissions tablosu üzerinden yapılır.
 * database/migrations/0001_auth.sql içindeki tohum (seed) verisi bu dosyayla aynı olmalıdır;
 * apps/api/test/rbac-seed.test.ts bu eşleşmeyi doğrular.
 */

export const ROLES = [
  'player',
  'read_only',
  'support_staff',
  'content_manager',
  'moderator',
  'community_admin',
  'game_admin',
  'system_admin',
  'super_admin',
] as const;
export type RoleKey = (typeof ROLES)[number];

/** Yeni kayıt olan herkesin aldığı tek rol. */
export const DEFAULT_ROLE: RoleKey = 'player';

export const ROLE_LABELS_TR: Record<RoleKey, string> = {
  player: 'Oyuncu',
  read_only: 'Salt Okunur',
  support_staff: 'Destek Personeli',
  content_manager: 'İçerik Yöneticisi',
  moderator: 'Moderatör',
  community_admin: 'Topluluk Yöneticisi',
  game_admin: 'Oyun Yöneticisi',
  system_admin: 'Sistem Yöneticisi',
  super_admin: 'Süper Yönetici',
};

/** Rütbe: yüksek olan, düşük olanı yönetebilir (ör. rol atama sınırları). */
export const ROLE_RANK: Record<RoleKey, number> = {
  player: 0,
  read_only: 10,
  support_staff: 20,
  content_manager: 30,
  moderator: 30,
  community_admin: 40,
  game_admin: 50,
  system_admin: 60,
  super_admin: 100,
};

export const PERMISSIONS = [
  'dashboard.view',
  'players.read',
  'players.warn',
  'players.ban',
  'players.unban',
  'players.lock',
  'players.sessions.revoke',
  'players.inventory.write',
  'ships.read',
  'ships.write',
  'items.read',
  'items.write',
  'npcs.read',
  'npcs.write',
  'maps.read',
  'maps.write',
  'quests.read',
  'quests.write',
  'events.read',
  'events.write',
  'economy.read',
  'economy.write',
  'economy.grant',
  'clans.read',
  'clans.write',
  'chat.reports.read',
  'chat.moderate',
  'forum.read',
  'forum.moderate',
  'forum.categories.write',
  'forum.moderators.assign',
  'support.read',
  'support.reply',
  'support.manage',
  'system.read',
  'system.maintenance',
  'system.backups',
  'system.notifications',
  'settings.read',
  'settings.write',
  'platforms.read',
  'platforms.write',
  'roles.read',
  'roles.assign',
  'audit.read',
  'content.publish',
  'content.rollback',
  'approvals.review',
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number];

const READ_PERMISSIONS = PERMISSIONS.filter(
  (p) => p.endsWith('.read') || p === 'dashboard.view',
) as PermissionKey[];

const MODERATOR: PermissionKey[] = [
  'dashboard.view',
  'players.read',
  'players.warn',
  'players.ban',
  'chat.reports.read',
  'chat.moderate',
  'forum.read',
  'forum.moderate',
  'support.read',
  'clans.read',
];

const CONTENT_MANAGER: PermissionKey[] = [
  'dashboard.view',
  'ships.read',
  'ships.write',
  'items.read',
  'items.write',
  'npcs.read',
  'npcs.write',
  'maps.read',
  'maps.write',
  'quests.read',
  'quests.write',
  'events.read',
  'events.write',
  'economy.read',
  'content.publish',
];

export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  player: [],
  read_only: READ_PERMISSIONS,
  support_staff: [
    'dashboard.view',
    'players.read',
    'support.read',
    'support.reply',
    'support.manage',
    'chat.reports.read',
  ],
  content_manager: CONTENT_MANAGER,
  moderator: MODERATOR,
  community_admin: [
    ...MODERATOR,
    'players.unban',
    'players.sessions.revoke',
    'clans.write',
    'forum.categories.write',
    'forum.moderators.assign',
    'support.reply',
    'support.manage',
    'system.notifications',
  ],
  game_admin: [
    ...new Set<PermissionKey>([
      ...CONTENT_MANAGER,
      ...MODERATOR,
      'players.unban',
      'players.lock',
      'players.sessions.revoke',
      'players.inventory.write',
      'economy.write',
      'economy.grant',
      'content.rollback',
      'clans.write',
      'settings.read',
      'audit.read',
    ]),
  ],
  system_admin: [
    'dashboard.view',
    'system.read',
    'system.maintenance',
    'system.backups',
    'system.notifications',
    'settings.read',
    'settings.write',
    'platforms.read',
    'platforms.write',
    'audit.read',
    'roles.read',
    'players.read',
    'players.sessions.revoke',
  ],
  super_admin: [...PERMISSIONS],
};

export function isStaffRole(role: RoleKey): boolean {
  return role !== 'player';
}
