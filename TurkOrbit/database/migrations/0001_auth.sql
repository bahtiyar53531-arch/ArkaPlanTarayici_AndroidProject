-- =====================================================================================
-- TÜRK ORBIT — Migration 0001: Hesap, kimlik doğrulama, oturum, rol/yetki ve denetim kaydı
-- Aşama 1 (Kayıt ve Giriş). Bu dosya apps/api/src/db/migrate.ts tarafından tek transaction
-- içinde uygulanır. Uygulanmış bir migration dosyası DEĞİŞTİRİLMEZ; değişiklik için yeni
-- numaralı migration eklenir (çalıştırıcı checksum ile bunu denetler).
-- =====================================================================================

CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- Kullanıcı hesapları
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Oyuncuya gösterilen sayısal Oyuncu ID'si (iç uuid asla tahmin edilebilir şekilde ifşa edilmez)
  public_id           bigint GENERATED ALWAYS AS IDENTITY (START WITH 100001) UNIQUE,
  username            citext NOT NULL UNIQUE,
  email               citext NOT NULL UNIQUE,
  email_verified_at   timestamptz,
  password_hash       text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended', 'banned', 'deleted')),
  suspended_until     timestamptz,
  status_reason       text,
  -- Yönetici tarafından konan güvenlik kilidi (Yönetim Merkezi > Oyuncu Yönetimi > Hesap kilitleme)
  locked_until        timestamptz,
  locale              text NOT NULL DEFAULT 'tr' CHECK (locale IN ('tr', 'en')),
  terms_accepted_at   timestamptz NOT NULL,
  terms_version       text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_length CHECK (char_length(username::text) BETWEEN 3 AND 20),
  CONSTRAINT users_suspension_has_end CHECK (status <> 'suspended' OR suspended_until IS NOT NULL)
);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- Rol ve yetkiler (RBAC)
CREATE TABLE roles (
  key        text PRIMARY KEY,
  name_tr    text NOT NULL,
  rank       integer NOT NULL,
  is_staff   boolean NOT NULL
);

CREATE TABLE permissions (
  key text PRIMARY KEY
);

CREATE TABLE role_permissions (
  role_key       text NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_key   text NOT NULL REFERENCES roles(key),
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  reason     text,
  PRIMARY KEY (user_id, role_key)
);
CREATE INDEX user_roles_role_idx ON user_roles(role_key);

-- Her yeni hesap veritabanı seviyesinde de yalnızca 'player' rolüyle başlar.
-- Uygulama kodu kayıt sırasında rol EKLEMEZ; bu tetikleyici tek kaynaktır.
CREATE OR REPLACE FUNCTION assign_default_player_role() RETURNS trigger AS $$
BEGIN
  INSERT INTO user_roles (user_id, role_key, reason)
  VALUES (NEW.id, 'player', 'Varsayılan kayıt rolü');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER users_assign_default_role AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION assign_default_player_role();

-- ---------------------------------------------------------------- Oturumlar
CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Oturum anahtarının SHA-256 özeti. Anahtarın kendisi hiçbir zaman saklanmaz.
  token_hash     bytea NOT NULL UNIQUE,
  transport      text NOT NULL CHECK (transport IN ('cookie', 'token')),
  platform       text NOT NULL DEFAULT 'unknown',
  device_name    text,
  app_version    text,
  user_agent     text,
  browser        text,
  os             text,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

-- ---------------------------------------------------------------- Tek kullanımlık e-posta anahtarları
CREATE TABLE email_verification_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  email      citext NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_tokens_user_idx ON email_verification_tokens(user_id);

CREATE TABLE password_reset_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  requested_ip inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens(user_id);

-- ---------------------------------------------------------------- Giriş geçmişi ve şüpheli giriş
CREATE TABLE login_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Denenen kullanıcı adı/e-posta (küçük harf, en fazla 254 karakter). Parola ASLA kaydedilmez.
  identifier         text NOT NULL,
  success            boolean NOT NULL,
  failure_reason     text,
  ip                 inet,
  user_agent         text,
  platform           text NOT NULL DEFAULT 'unknown',
  browser            text,
  os                 text,
  suspicious         boolean NOT NULL DEFAULT false,
  suspicious_reasons text[] NOT NULL DEFAULT '{}',
  session_id         uuid REFERENCES sessions(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_events_user_time_idx ON login_events(user_id, created_at DESC);
CREATE INDEX login_events_ip_time_idx ON login_events(ip, created_at DESC);
CREATE INDEX login_events_suspicious_idx ON login_events(created_at DESC) WHERE suspicious;

CREATE TABLE user_known_devices (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- platform + tarayıcı ailesi + işletim sistemi özetinden üretilen cihaz parmak izi
  fingerprint   bytea NOT NULL,
  label         text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_ip       inet,
  PRIMARY KEY (user_id, fingerprint)
);

-- ---------------------------------------------------------------- Oyun ayarları (Yönetim Merkezi 15.11)
CREATE TABLE game_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO game_settings (key, value) VALUES
  ('registration.enabled', 'true'::jsonb),
  ('terms.version', '"2026-11"'::jsonb);

-- ---------------------------------------------------------------- Yönetici işlem geçmişi (15.14)
CREATE TABLE admin_audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- ör. 'cli:root@sunucu' veya yöneticinin kullanıcı adı (silinse bile kayıt okunabilir kalsın diye)
  actor_label   text NOT NULL,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  before_value  jsonb,
  after_value   jsonb,
  reason        text,
  result        text NOT NULL CHECK (result IN ('success', 'failure', 'pending_approval')),
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_time_idx ON admin_audit_log(created_at DESC);
CREATE INDEX admin_audit_log_target_idx ON admin_audit_log(target_type, target_id);
CREATE INDEX admin_audit_log_actor_idx ON admin_audit_log(actor_user_id, created_at DESC);

-- Denetim kaydı yalnızca eklenebilir: güncelleme ve silme veritabanı seviyesinde engellenir.
-- Tek istisna: yöneticinin hesabı kalıcı silinirse (KVKK) FK'nin actor_user_id'yi NULL yapmasıdır;
-- actor_label korunduğu için kayıt okunabilir kalır.
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'admin_audit_log kayıtları değiştirilemez veya silinemez';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER admin_audit_log_immutable BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- ---------------------------------------------------------------- RBAC tohum verisi
-- packages/shared/src/roles.ts ile birebir aynıdır (apps/api/test/rbac-seed.test.ts doğrular).
INSERT INTO roles (key, name_tr, rank, is_staff) VALUES
  ('player', 'Oyuncu', 0, false),
  ('read_only', 'Salt Okunur', 10, true),
  ('support_staff', 'Destek Personeli', 20, true),
  ('content_manager', 'İçerik Yöneticisi', 30, true),
  ('moderator', 'Moderatör', 30, true),
  ('community_admin', 'Topluluk Yöneticisi', 40, true),
  ('game_admin', 'Oyun Yöneticisi', 50, true),
  ('system_admin', 'Sistem Yöneticisi', 60, true),
  ('super_admin', 'Süper Yönetici', 100, true);

INSERT INTO permissions (key) VALUES
  ('dashboard.view'),
  ('players.read'),
  ('players.warn'),
  ('players.ban'),
  ('players.unban'),
  ('players.lock'),
  ('players.sessions.revoke'),
  ('players.inventory.write'),
  ('ships.read'),
  ('ships.write'),
  ('items.read'),
  ('items.write'),
  ('npcs.read'),
  ('npcs.write'),
  ('maps.read'),
  ('maps.write'),
  ('quests.read'),
  ('quests.write'),
  ('events.read'),
  ('events.write'),
  ('economy.read'),
  ('economy.write'),
  ('economy.grant'),
  ('clans.read'),
  ('clans.write'),
  ('chat.reports.read'),
  ('chat.moderate'),
  ('forum.read'),
  ('forum.moderate'),
  ('forum.categories.write'),
  ('forum.moderators.assign'),
  ('support.read'),
  ('support.reply'),
  ('support.manage'),
  ('system.read'),
  ('system.maintenance'),
  ('system.backups'),
  ('system.notifications'),
  ('settings.read'),
  ('settings.write'),
  ('platforms.read'),
  ('platforms.write'),
  ('roles.read'),
  ('roles.assign'),
  ('audit.read'),
  ('content.publish'),
  ('content.rollback'),
  ('approvals.review');

INSERT INTO role_permissions (role_key, permission_key) VALUES
  ('read_only', 'dashboard.view'),
  ('read_only', 'players.read'),
  ('read_only', 'ships.read'),
  ('read_only', 'items.read'),
  ('read_only', 'npcs.read'),
  ('read_only', 'maps.read'),
  ('read_only', 'quests.read'),
  ('read_only', 'events.read'),
  ('read_only', 'economy.read'),
  ('read_only', 'clans.read'),
  ('read_only', 'chat.reports.read'),
  ('read_only', 'forum.read'),
  ('read_only', 'support.read'),
  ('read_only', 'system.read'),
  ('read_only', 'settings.read'),
  ('read_only', 'platforms.read'),
  ('read_only', 'roles.read'),
  ('read_only', 'audit.read'),
  ('support_staff', 'dashboard.view'),
  ('support_staff', 'players.read'),
  ('support_staff', 'support.read'),
  ('support_staff', 'support.reply'),
  ('support_staff', 'support.manage'),
  ('support_staff', 'chat.reports.read'),
  ('content_manager', 'dashboard.view'),
  ('content_manager', 'ships.read'),
  ('content_manager', 'ships.write'),
  ('content_manager', 'items.read'),
  ('content_manager', 'items.write'),
  ('content_manager', 'npcs.read'),
  ('content_manager', 'npcs.write'),
  ('content_manager', 'maps.read'),
  ('content_manager', 'maps.write'),
  ('content_manager', 'quests.read'),
  ('content_manager', 'quests.write'),
  ('content_manager', 'events.read'),
  ('content_manager', 'events.write'),
  ('content_manager', 'economy.read'),
  ('content_manager', 'content.publish'),
  ('moderator', 'dashboard.view'),
  ('moderator', 'players.read'),
  ('moderator', 'players.warn'),
  ('moderator', 'players.ban'),
  ('moderator', 'chat.reports.read'),
  ('moderator', 'chat.moderate'),
  ('moderator', 'forum.read'),
  ('moderator', 'forum.moderate'),
  ('moderator', 'support.read'),
  ('moderator', 'clans.read'),
  ('community_admin', 'dashboard.view'),
  ('community_admin', 'players.read'),
  ('community_admin', 'players.warn'),
  ('community_admin', 'players.ban'),
  ('community_admin', 'chat.reports.read'),
  ('community_admin', 'chat.moderate'),
  ('community_admin', 'forum.read'),
  ('community_admin', 'forum.moderate'),
  ('community_admin', 'support.read'),
  ('community_admin', 'clans.read'),
  ('community_admin', 'players.unban'),
  ('community_admin', 'players.sessions.revoke'),
  ('community_admin', 'clans.write'),
  ('community_admin', 'forum.categories.write'),
  ('community_admin', 'forum.moderators.assign'),
  ('community_admin', 'support.reply'),
  ('community_admin', 'support.manage'),
  ('community_admin', 'system.notifications'),
  ('game_admin', 'dashboard.view'),
  ('game_admin', 'ships.read'),
  ('game_admin', 'ships.write'),
  ('game_admin', 'items.read'),
  ('game_admin', 'items.write'),
  ('game_admin', 'npcs.read'),
  ('game_admin', 'npcs.write'),
  ('game_admin', 'maps.read'),
  ('game_admin', 'maps.write'),
  ('game_admin', 'quests.read'),
  ('game_admin', 'quests.write'),
  ('game_admin', 'events.read'),
  ('game_admin', 'events.write'),
  ('game_admin', 'economy.read'),
  ('game_admin', 'content.publish'),
  ('game_admin', 'players.read'),
  ('game_admin', 'players.warn'),
  ('game_admin', 'players.ban'),
  ('game_admin', 'chat.reports.read'),
  ('game_admin', 'chat.moderate'),
  ('game_admin', 'forum.read'),
  ('game_admin', 'forum.moderate'),
  ('game_admin', 'support.read'),
  ('game_admin', 'clans.read'),
  ('game_admin', 'players.unban'),
  ('game_admin', 'players.lock'),
  ('game_admin', 'players.sessions.revoke'),
  ('game_admin', 'players.inventory.write'),
  ('game_admin', 'economy.write'),
  ('game_admin', 'economy.grant'),
  ('game_admin', 'content.rollback'),
  ('game_admin', 'clans.write'),
  ('game_admin', 'settings.read'),
  ('game_admin', 'audit.read'),
  ('system_admin', 'dashboard.view'),
  ('system_admin', 'system.read'),
  ('system_admin', 'system.maintenance'),
  ('system_admin', 'system.backups'),
  ('system_admin', 'system.notifications'),
  ('system_admin', 'settings.read'),
  ('system_admin', 'settings.write'),
  ('system_admin', 'platforms.read'),
  ('system_admin', 'platforms.write'),
  ('system_admin', 'audit.read'),
  ('system_admin', 'roles.read'),
  ('system_admin', 'players.read'),
  ('system_admin', 'players.sessions.revoke'),
  ('super_admin', 'dashboard.view'),
  ('super_admin', 'players.read'),
  ('super_admin', 'players.warn'),
  ('super_admin', 'players.ban'),
  ('super_admin', 'players.unban'),
  ('super_admin', 'players.lock'),
  ('super_admin', 'players.sessions.revoke'),
  ('super_admin', 'players.inventory.write'),
  ('super_admin', 'ships.read'),
  ('super_admin', 'ships.write'),
  ('super_admin', 'items.read'),
  ('super_admin', 'items.write'),
  ('super_admin', 'npcs.read'),
  ('super_admin', 'npcs.write'),
  ('super_admin', 'maps.read'),
  ('super_admin', 'maps.write'),
  ('super_admin', 'quests.read'),
  ('super_admin', 'quests.write'),
  ('super_admin', 'events.read'),
  ('super_admin', 'events.write'),
  ('super_admin', 'economy.read'),
  ('super_admin', 'economy.write'),
  ('super_admin', 'economy.grant'),
  ('super_admin', 'clans.read'),
  ('super_admin', 'clans.write'),
  ('super_admin', 'chat.reports.read'),
  ('super_admin', 'chat.moderate'),
  ('super_admin', 'forum.read'),
  ('super_admin', 'forum.moderate'),
  ('super_admin', 'forum.categories.write'),
  ('super_admin', 'forum.moderators.assign'),
  ('super_admin', 'support.read'),
  ('super_admin', 'support.reply'),
  ('super_admin', 'support.manage'),
  ('super_admin', 'system.read'),
  ('super_admin', 'system.maintenance'),
  ('super_admin', 'system.backups'),
  ('super_admin', 'system.notifications'),
  ('super_admin', 'settings.read'),
  ('super_admin', 'settings.write'),
  ('super_admin', 'platforms.read'),
  ('super_admin', 'platforms.write'),
  ('super_admin', 'roles.read'),
  ('super_admin', 'roles.assign'),
  ('super_admin', 'audit.read'),
  ('super_admin', 'content.publish'),
  ('super_admin', 'content.rollback'),
  ('super_admin', 'approvals.review');
