-- =====================================================================================
-- TÜRK ORBIT — TAM VERİTABANI TASLAĞI (Aşama 2-17)
--
-- Bu dosya bir MIGRATION DEĞİLDİR. Hedef şemayı tek yerde göstermek ve tasarımı erkenden
-- doğrulamak için yazılmıştır. Aşama 1 tabloları database/migrations/0001_auth.sql içindedir
-- (users, roles, permissions, role_permissions, user_roles, sessions, email_verification_tokens,
-- password_reset_tokens, login_events, user_known_devices, game_settings, admin_audit_log).
--
-- Aşama 5 ve 6'da uygulanan tablolar 0002_player_profile.sql ve 0003_hangar.sql içindedir
-- (game_servers, companies, maps, ranks, ship_types, players, player_stats, player_ships, achievements,
-- player_achievements, currencies, wallets, currency_ledger). Bu dosya onları yalnızca genişletir.
--
-- (Aşama 6: item_types, upgrade_levels, player_items, item_ledger, loadout_slots, player_pets,
-- player_pet_modules, shop_categories, shop_offers, shop_purchases.)
-- (Aşama 7 → 0004_world.sql: map_portals, map_zones, map_transitions, position_rejections, player_settings.)
--
-- Doğrulama: 0001–0004 uygulanmış boş bir veritabanına bu dosya hatasız yüklenir:
--   psql -v ON_ERROR_STOP=1 -1 -f database/schema-draft.sql
-- Her aşamada ilgili bölüm gözden geçirilip numaralı bir migration'a dönüştürülecektir.
--
-- Tasarım ilkeleri:
--  * İçerik (gemi, ekipman, NPC, harita, görev...) "tanım" tablolarındadır ve Yönetim Merkezi'nden
--    düzenlenir; oyuncuya ait durum (envanter, cüzdan, ilerleme) ayrı tablolardadır.
--  * Para ve eşya hareketleri yalnızca eklenebilir defterlere (ledger) yazılır; bakiye = defter toplamı.
--  * İçerik değişiklikleri content_revisions ile sürümlenir: önizleme → yayın → geri alma.
--  * Anlık oyun durumu (konum, can, mermi) PostgreSQL'e değil oyun sunucusu belleğine/Redis'e yazılır;
--    veritabanına yalnızca kalıcı sonuçlar (ödül, ölüm istatistiği, çıkış konumu) işlenir.
-- =====================================================================================

-- ============================================================ 1-2. EVREN VE OYUNCU PROFİLİ
-- ✅ Aşama 5'te uygulandı → database/migrations/0002_player_profile.sql

-- ============================================================ 3. İÇERİK SÜRÜMLEME (15.13)
-- Yönetim Merkezi'nde düzenlenen her içerik kaydı için önizleme/yayın/geri alma geçmişi.
CREATE TABLE content_revisions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type   text NOT NULL,                  -- 'ship_type', 'npc_type', 'map', 'quest', 'shop_offer' ...
  entity_id     text NOT NULL,
  version       integer NOT NULL,
  data          jsonb NOT NULL,                 -- kaydın o sürümdeki tam hali
  status        text NOT NULL CHECK (status IN ('draft', 'published', 'superseded', 'rolled_back')),
  hot_reloadable boolean NOT NULL DEFAULT true, -- false: oyun sunucusunun yeniden başlatılması gerekir
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  published_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  note          text,
  UNIQUE (entity_type, entity_id, version)
);

-- İki yetkili onayı gerektiren kritik işlemler (15.14)
CREATE TABLE approval_requests (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action        text NOT NULL,                  -- ör. 'economy.grant', 'player.ban.permanent', 'content.publish'
  payload       jsonb NOT NULL,
  requested_by  uuid NOT NULL REFERENCES users(id),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed')),
  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by)
);

-- ============================================================ 4-5. EŞYA, ENVANTER, KONFİGÜRASYON, PET
-- ✅ Aşama 6'da uygulandı → database/migrations/0003_hangar.sql
-- Aşama 7'de haritalara eklenecek:
ALTER TABLE maps ADD COLUMN max_players integer;

-- ============================================================ 6. PİLOT YETENEKLERİ
CREATE TABLE skill_nodes (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  branch        text NOT NULL,                  -- 'savas', 'savunma', 'ekonomi', 'kesif'
  name          text NOT NULL,
  description   text NOT NULL,
  max_rank      smallint NOT NULL,
  effect        jsonb NOT NULL,                 -- {"stat":"laser_damage","per_rank":0.02}
  prerequisite_id integer REFERENCES skill_nodes(id),
  cost_per_rank integer NOT NULL
);

CREATE TABLE player_skills (
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  skill_node_id integer NOT NULL REFERENCES skill_nodes(id),
  rank          smallint NOT NULL CHECK (rank >= 1),
  PRIMARY KEY (player_id, skill_node_id)
);

-- ============================================================ 7. HARİTALAR VE KAPILAR
-- ✅ Portallar ve bölgeler Aşama 7 → 0004_world.sql. Kaynak düğümleri (Aşama 11) ve kapılar (Aşama 9) aşağıda.

-- resource_nodes → 0007_economy.sql (Aşama 11)

-- ============================================================ 8. NPC VE YAPAY ZEKÂ
-- (Aşama 9 → 0005_combat.sql: npc_types, npc_spawns, reward_tables, reward_entries, combat_deaths, npc_kill_log.)

-- Yıldız Kapıları (Galaxy Gate muadili)
CREATE TABLE gates (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text NOT NULL,
  map_id        integer NOT NULL REFERENCES maps(id),
  parts_required smallint NOT NULL,
  part_item_type_id integer REFERENCES item_types(id),
  min_level     smallint NOT NULL DEFAULT 1,
  lives         smallint NOT NULL DEFAULT 3,
  completion_reward_table_id integer,
  is_enabled    boolean NOT NULL DEFAULT true
);

CREATE TABLE gate_waves (
  gate_id     integer NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  wave_number smallint NOT NULL,
  -- [{"npc_type":"akrep-avci","count":20,"overrides":{"hitpoints_mult":1.5}}]  — mevcut NPC türleri yeniden kullanılır
  composition jsonb NOT NULL,
  delay_seconds smallint NOT NULL DEFAULT 5,
  PRIMARY KEY (gate_id, wave_number)
);

CREATE TABLE player_gates (
  player_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  gate_id        integer NOT NULL REFERENCES gates(id),
  parts_collected smallint NOT NULL DEFAULT 0,
  current_wave   smallint,
  lives_left     smallint,
  times_completed integer NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, gate_id)
);

-- ============================================================ 9. ÖDÜL TABLOLARI (0005'te uygulandı)
ALTER TABLE gates ADD CONSTRAINT gates_reward_fk FOREIGN KEY (completion_reward_table_id) REFERENCES reward_tables(id);
ALTER TABLE achievements ADD COLUMN reward_table_id integer REFERENCES reward_tables(id);

-- ============================================================ 10. GÖREVLER (0006'da uygulandı)
-- (Aşama 10 → 0006_quests.sql: quests, quest_objectives, player_quests, player_quest_cycles.)

-- ============================================================ 11. EKONOMİ (0007'de uygulandı)
-- (Aşama 11 → 0007_economy.sql: resource_nodes, crafting_recipes, player_crafting_jobs, auction_lots, auctions,
--  auction_bids, daily_login_rewards, player_daily_logins; shop_offers paket sütunları.)

-- ============================================================ 12. KLAN, GRUP, SOSYAL (Aşama 12)
CREATE TABLE clans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id    smallint NOT NULL REFERENCES game_servers(id),
  tag          citext NOT NULL,
  name         citext NOT NULL,
  description  text,
  company_id   smallint REFERENCES companies(id),
  leader_id    uuid NOT NULL REFERENCES players(id),
  tax_percent  smallint NOT NULL DEFAULT 0 CHECK (tax_percent BETWEEN 0 AND 10),
  is_recruiting boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, tag),
  UNIQUE (server_id, name)
);

ALTER TABLE players ADD COLUMN clan_id uuid REFERENCES clans(id) ON DELETE SET NULL;

CREATE TABLE clan_ranks (
  id          serial PRIMARY KEY,
  clan_id     uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  smallint NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}'      -- 'invite', 'kick', 'diplomacy', 'treasury', 'edit_info'
);

CREATE TABLE clan_members (
  clan_id   uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  player_id uuid NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  rank_id   integer REFERENCES clan_ranks(id) ON DELETE SET NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_id, player_id)
);

CREATE TABLE clan_applications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clan_id    uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  message    text,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clan_diplomacy (
  clan_id       uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  other_clan_id uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  relation      text NOT NULL CHECK (relation IN ('alliance', 'non_aggression', 'war')),
  status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'ended')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_id, other_clan_id),
  CHECK (clan_id <> other_clan_id)
);

CREATE TABLE clan_treasury_ledger (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clan_id       uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES currencies(code),
  delta         bigint NOT NULL,
  reason        text NOT NULL,
  player_id     uuid REFERENCES players(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE friendships (
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, friend_id),
  CHECK (player_id <> friend_id)
);

CREATE TABLE player_blocks (
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, blocked_id)
);
-- Not: Gruplar (party) kısa ömürlüdür; canlı durum Redis'te tutulur, yalnızca istatistik/denetim için kayıt düşülür.

CREATE TABLE chat_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id   smallint NOT NULL REFERENCES game_servers(id),
  channel     text NOT NULL,                   -- 'global', 'company:KZL', 'clan:<id>', 'group:<id>', 'dm:<a>:<b>', 'map:<id>'
  sender_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (char_length(body) <= 300),
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_channel_idx ON chat_messages(channel, created_at DESC);

CREATE TABLE reports (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id  uuid NOT NULL REFERENCES users(id),
  target_type  text NOT NULL CHECK (target_type IN ('player', 'chat_message', 'forum_post', 'forum_thread', 'clan')),
  target_id    text NOT NULL,
  reason       text NOT NULL,
  details      text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'actioned', 'dismissed')),
  handled_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- ============================================================ 13. ETKİNLİK VE SIRALAMA
CREATE TABLE events (
  id           serial PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text,
  event_type   text NOT NULL,                  -- 'invasion', 'boss_hunt', 'double_xp', 'seasonal'
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  is_published boolean NOT NULL DEFAULT false,
  CHECK (ends_at > starts_at)
);

CREATE TABLE leaderboard_snapshots (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id   smallint NOT NULL REFERENCES game_servers(id),
  board       text NOT NULL,                   -- 'rank_points', 'experience', 'honor', 'event:<code>', 'clan'
  period      text NOT NULL,                   -- 'all', '2026-11', '2026-W48'
  entries     jsonb NOT NULL,                  -- ilk N kayıt
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ 14. FORUM (Aşama 13)
CREATE TABLE forum_categories (
  id          serial PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  sort_order  smallint NOT NULL DEFAULT 0,
  -- Yazma yetkisi: duyurular gibi bölümlerde yalnızca personel konu açar
  min_role_to_post text NOT NULL DEFAULT 'player' REFERENCES roles(key),
  is_archived boolean NOT NULL DEFAULT false
);

CREATE TABLE forum_moderators (
  category_id integer NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, user_id)
);

CREATE TABLE forum_threads (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id  integer NOT NULL REFERENCES forum_categories(id),
  author_id    uuid NOT NULL REFERENCES users(id),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 140),
  is_pinned    boolean NOT NULL DEFAULT false,
  is_locked    boolean NOT NULL DEFAULT false,
  is_deleted   boolean NOT NULL DEFAULT false,
  reply_count  integer NOT NULL DEFAULT 0,
  last_post_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  search       tsvector GENERATED ALWAYS AS (to_tsvector('simple', title)) STORED
);
CREATE INDEX forum_threads_list_idx ON forum_threads(category_id, is_pinned DESC, last_post_at DESC);
CREATE INDEX forum_threads_search_idx ON forum_threads USING gin(search);

CREATE TABLE forum_posts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id   bigint NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  quoted_post_id bigint REFERENCES forum_posts(id) ON DELETE SET NULL,
  is_deleted  boolean NOT NULL DEFAULT false,
  edited_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  search      tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);
CREATE INDEX forum_posts_thread_idx ON forum_posts(thread_id, created_at);
CREATE INDEX forum_posts_search_idx ON forum_posts USING gin(search);

CREATE TABLE forum_likes (
  post_id    bigint NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE forum_follows (
  thread_id  bigint NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, user_id)
);

-- ============================================================ 15. DESTEK (Aşama 13)
CREATE TABLE support_tickets (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Oyuncuya gösterilen benzersiz numara, ör. TO-2026-000123
  ticket_no    text NOT NULL UNIQUE,
  user_id      uuid NOT NULL REFERENCES users(id),
  category     text NOT NULL CHECK (category IN ('account', 'payment', 'bug', 'cheat_report', 'ban_appeal', 'gameplay', 'other')),
  subject      text NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting_staff', 'waiting_player', 'resolved', 'closed')),
  priority     text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to  uuid REFERENCES users(id),
  platform     text,
  app_version  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);

CREATE TABLE support_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id   bigint NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id),
  is_staff    boolean NOT NULL,
  is_internal_note boolean NOT NULL DEFAULT false,  -- oyuncuya görünmeyen personel notu
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_attachments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id   bigint NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  storage_key  text NOT NULL,                   -- nesne depolama anahtarı (dosya diske/DB'ye gömülmez)
  file_name    text NOT NULL,
  mime_type    text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/pdf')),
  size_bytes   integer NOT NULL CHECK (size_bytes <= 10485760),
  sha256       bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ 16. MODERASYON VE GÜVENLİK
CREATE TABLE sanctions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('warning', 'mute', 'suspension', 'ban', 'lock')),
  reason       text NOT NULL,
  public_reason text,                           -- oyuncuya gösterilen metin
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz,                     -- NULL = kalıcı
  issued_by    uuid REFERENCES users(id),
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES users(id),
  revoke_reason text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sanctions_user_idx ON sanctions(user_id, created_at DESC);

-- Oyun sunucusunun hile/anomali tespitleri (hız aşımı, imkânsız atış hızı, şüpheli ödül kazancı ...)
CREATE TABLE anticheat_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id   uuid REFERENCES players(id) ON DELETE SET NULL,
  rule        text NOT NULL,
  severity    smallint NOT NULL CHECK (severity BETWEEN 1 AND 5),
  details     jsonb NOT NULL,
  map_id      integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anticheat_events_player_idx ON anticheat_events(player_id, created_at DESC);

-- ============================================================ 17. SİSTEM, PLATFORM, SÜRÜM (15.10, 16.7)

CREATE TABLE feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  rollout_percent smallint NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  platforms   text[],                           -- NULL = tüm platformlar
  description text,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE client_releases (
  id             serial PRIMARY KEY,
  platform       text NOT NULL CHECK (platform IN ('web', 'android', 'ios', 'windows', 'macos', 'linux')),
  version        text NOT NULL,
  build_number   integer NOT NULL,
  min_supported  boolean NOT NULL DEFAULT false, -- bunun altındaki sürümler bağlanamaz
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'testing', 'live', 'deprecated')),
  release_notes  text,
  store_url      text,
  released_at    timestamptz,
  UNIQUE (platform, version)
);

CREATE TABLE maintenance_windows (
  id          serial PRIMARY KEY,
  scope       text NOT NULL,                    -- 'global', 'server:TR1', 'map:K-4'
  message     text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE server_nodes (
  id            text PRIMARY KEY,               -- ör. 'game-tr1-01'
  role          text NOT NULL CHECK (role IN ('api', 'game', 'worker')),
  host          text NOT NULL,
  version       text NOT NULL,
  started_at    timestamptz NOT NULL,
  last_heartbeat timestamptz NOT NULL,
  metrics       jsonb NOT NULL DEFAULT '{}'::jsonb   -- {"cpu":0.31,"ram_mb":812,"ws":412,"avg_ping_ms":48,"maps":["K-1"]}
);

CREATE TABLE client_error_reports (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  platform    text NOT NULL,
  app_version text,
  os_version  text,
  device_model text,
  message     text NOT NULL,
  stack       text,
  context     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_error_reports_idx ON client_error_reports(platform, created_at DESC);

CREATE TABLE backups (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('full', 'incremental', 'wal')),
  location    text NOT NULL,
  size_bytes  bigint,
  checksum    text,
  status      text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'verified')),
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  triggered_by uuid REFERENCES users(id)
);

