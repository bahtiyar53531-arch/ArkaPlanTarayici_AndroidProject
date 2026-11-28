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
-- content_revisions ve approval_requests: ✅ Aşama 14'te uygulandı → database/migrations/0010_admin.sql

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

-- ============================================================ 12. KLAN, GRUP, SOSYAL (0008'de uygulandı)
-- (Aşama 12 → 0008_social.sql: clans, clan_ranks, clan_members, clan_applications, clan_invitations, clan_diplomacy,
--  clan_wallets, clan_treasury_ledger, clan_events, friendships, player_blocks, player_social_settings, chat_messages,
--  reports, notifications. Gruplar (party) Redis'tedir.)

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

-- ============================================================ 14–15. FORUM VE DESTEK (0009'da uygulandı)
-- (Aşama 13 → 0009_forum_support.sql: forum_categories, forum_moderators, forum_threads, forum_posts, forum_likes,
--  forum_follows, support_tickets, support_messages, support_attachments; support_ticket_seq.)

-- ============================================================ 16. MODERASYON VE GÜVENLİK
-- sanctions: ✅ Aşama 14'te uygulandı → database/migrations/0010_admin.sql

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

