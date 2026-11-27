-- =====================================================================================
-- TÜRK ORBIT — TAM VERİTABANI TASLAĞI (Aşama 2-17)
--
-- Bu dosya bir MIGRATION DEĞİLDİR. Hedef şemayı tek yerde göstermek ve tasarımı erkenden
-- doğrulamak için yazılmıştır. Aşama 1 tabloları database/migrations/0001_auth.sql içindedir
-- (users, roles, permissions, role_permissions, user_roles, sessions, email_verification_tokens,
-- password_reset_tokens, login_events, user_known_devices, game_settings, admin_audit_log).
--
-- Doğrulama: 0001 uygulanmış boş bir veritabanına bu dosya hatasız yüklenir:
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

-- ============================================================ 1. EVREN, SUNUCU, ŞİRKET
CREATE TABLE game_servers (
  id            smallint PRIMARY KEY,
  code          text NOT NULL UNIQUE,            -- ör. 'TR1'
  name          text NOT NULL,                   -- ör. 'Anadolu-1'
  region        text NOT NULL DEFAULT 'eu-tr',
  is_open       boolean NOT NULL DEFAULT true,
  is_maintenance boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id          smallint PRIMARY KEY,
  code        text NOT NULL UNIQUE,              -- 'KZL', 'GKB', 'ALT'
  name        text NOT NULL,
  description text,
  color_hex   text NOT NULL,
  home_map_id integer                            -- FK aşağıda (maps oluşturulduktan sonra)
);

-- ============================================================ 2. OYUNCU PROFİLİ (Aşama 5)
CREATE TABLE players (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id        smallint NOT NULL REFERENCES game_servers(id),
  pilot_name       citext NOT NULL,
  company_id       smallint REFERENCES companies(id),
  level            smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  experience       bigint NOT NULL DEFAULT 0 CHECK (experience >= 0),
  honor            bigint NOT NULL DEFAULT 0,
  rank_points      bigint NOT NULL DEFAULT 0,
  rank_id          smallint,
  active_ship_id   uuid,                         -- FK aşağıda
  active_loadout   smallint NOT NULL DEFAULT 1 CHECK (active_loadout IN (1, 2)),
  map_id           integer,                      -- son kalıcı konum (oturum kapanınca yazılır)
  pos_x            real,
  pos_y            real,
  playtime_seconds bigint NOT NULL DEFAULT 0,
  clan_id          uuid,                         -- FK aşağıda
  last_online_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, server_id),
  UNIQUE (server_id, pilot_name)
);

CREATE TABLE player_stats (
  player_id        uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  npc_kills        bigint NOT NULL DEFAULT 0,
  player_kills     bigint NOT NULL DEFAULT 0,
  deaths           bigint NOT NULL DEFAULT 0,
  gates_completed  integer NOT NULL DEFAULT 0,
  cargo_collected  bigint NOT NULL DEFAULT 0,
  damage_dealt     bigint NOT NULL DEFAULT 0,
  damage_taken     bigint NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ranks (
  id          smallint PRIMARY KEY,
  name        text NOT NULL,
  min_points  bigint NOT NULL,
  icon_url    text
);

CREATE TABLE achievements (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL,
  category    text NOT NULL,
  target      bigint NOT NULL DEFAULT 1,
  reward_table_id integer,
  is_hidden   boolean NOT NULL DEFAULT false
);

CREATE TABLE player_achievements (
  player_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id integer NOT NULL REFERENCES achievements(id),
  progress       bigint NOT NULL DEFAULT 0,
  completed_at   timestamptz,
  PRIMARY KEY (player_id, achievement_id)
);

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

-- ============================================================ 4. EŞYA TANIMLARI (Aşama 6)
CREATE TABLE item_types (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,          -- ör. 'laser.ok1', 'ammo.isk2', 'shield.kalkan3'
  category       text NOT NULL CHECK (category IN (
                   'laser', 'rocket_launcher', 'rocket', 'ammo', 'shield_generator', 'speed_generator',
                   'drone', 'drone_design', 'pet', 'pet_module', 'ship_design', 'booster', 'resource',
                   'gate_part', 'key', 'cosmetic', 'consumable')),
  name           text NOT NULL,
  description    text,
  icon_url       text,
  rarity         text NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  stackable      boolean NOT NULL DEFAULT false,
  max_stack      integer,
  tradable       boolean NOT NULL DEFAULT true,
  -- Kategoriye göre istatistikler: {"damage":150,"rate_ms":1000,"range":650} / {"shield":4000,"absorb":0.8} ...
  stats          jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_upgrade_level smallint NOT NULL DEFAULT 0,
  -- Kullanım koşulları: {"min_level":5,"company":null,"ship_classes":["fighter"]}
  requirements   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_archived    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ship_types (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  description    text,
  ship_class     text NOT NULL,                 -- 'starter', 'fighter', 'tank', 'support', 'stealth'
  sprite_key     text NOT NULL,                 -- istemci varlık anahtarı
  hitpoints      integer NOT NULL CHECK (hitpoints > 0),
  base_speed     integer NOT NULL CHECK (base_speed > 0),
  cargo_capacity integer NOT NULL DEFAULT 0,
  laser_slots    smallint NOT NULL,
  generator_slots smallint NOT NULL,
  extra_slots    smallint NOT NULL DEFAULT 0,
  drone_slots    smallint NOT NULL DEFAULT 0,
  min_level      smallint NOT NULL DEFAULT 1,
  is_for_sale    boolean NOT NULL DEFAULT true,
  is_archived    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE upgrade_levels (
  item_type_id   integer NOT NULL REFERENCES item_types(id) ON DELETE CASCADE,
  level          smallint NOT NULL CHECK (level >= 1),
  stat_multiplier numeric(6,3) NOT NULL,
  success_chance numeric(4,3) NOT NULL CHECK (success_chance > 0 AND success_chance <= 1),
  cost           jsonb NOT NULL,                -- {"credits":10000,"resources":{"kuvars":50}}
  PRIMARY KEY (item_type_id, level)
);

-- ============================================================ 5. OYUNCU ENVANTERİ, GEMİLER, KONFİGÜRASYON
CREATE TABLE player_ships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ship_type_id integer NOT NULL REFERENCES ship_types(id),
  design_item_type_id integer REFERENCES item_types(id),  -- görünüm tasarımı
  hitpoints    integer NOT NULL,               -- son kalıcı can (tamir ile dolar)
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, ship_type_id)
);

-- Eşya örnekleri. Yığınlanabilir eşyalarda (mermi, kaynak) quantity kullanılır.
CREATE TABLE player_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_type_id  integer NOT NULL REFERENCES item_types(id),
  quantity      bigint NOT NULL DEFAULT 1 CHECK (quantity > 0),
  upgrade_level smallint NOT NULL DEFAULT 0,
  bound         boolean NOT NULL DEFAULT false, -- satılamaz/takas edilemez
  acquired_at   timestamptz NOT NULL DEFAULT now(),
  source        text NOT NULL                   -- 'shop', 'npc_drop', 'quest', 'auction', 'admin_grant' ...
);
CREATE INDEX player_items_player_idx ON player_items(player_id, item_type_id);

-- Her gemi için 2 ayrı ekipman konfigürasyonu
CREATE TABLE loadout_slots (
  player_ship_id uuid NOT NULL REFERENCES player_ships(id) ON DELETE CASCADE,
  loadout        smallint NOT NULL CHECK (loadout IN (1, 2)),
  slot_type      text NOT NULL CHECK (slot_type IN ('laser', 'generator', 'extra', 'drone')),
  slot_index     smallint NOT NULL,
  player_item_id uuid REFERENCES player_items(id) ON DELETE SET NULL,
  PRIMARY KEY (player_ship_id, loadout, slot_type, slot_index)
);
-- Aynı eşya aynı konfigürasyonda iki slota takılamaz (iki konfigürasyonda ortak kullanılabilir)
CREATE UNIQUE INDEX loadout_slots_item_once ON loadout_slots(player_ship_id, loadout, player_item_id)
  WHERE player_item_id IS NOT NULL;

CREATE TABLE player_drones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_type_id   integer NOT NULL REFERENCES item_types(id),
  level          smallint NOT NULL DEFAULT 1,
  experience     integer NOT NULL DEFAULT 0,
  damage_percent smallint NOT NULL DEFAULT 0 CHECK (damage_percent BETWEEN 0 AND 100),
  design_item_type_id integer REFERENCES item_types(id)
);

CREATE TABLE player_pets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  name         text NOT NULL,
  level        smallint NOT NULL DEFAULT 1,
  experience   bigint NOT NULL DEFAULT 0,
  fuel         integer NOT NULL DEFAULT 0,
  hitpoints    integer NOT NULL
);

CREATE TABLE player_pet_modules (
  pet_id         uuid NOT NULL REFERENCES player_pets(id) ON DELETE CASCADE,
  slot_index     smallint NOT NULL,
  player_item_id uuid NOT NULL REFERENCES player_items(id) ON DELETE CASCADE,
  PRIMARY KEY (pet_id, slot_index)
);

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

-- ============================================================ 7. HARİTALAR VE KAPILAR (Aşama 7)
CREATE TABLE maps (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,          -- ör. 'K-1', 'S-3', 'KAPI-ERGENEKON'
  name           text NOT NULL,
  map_type       text NOT NULL CHECK (map_type IN ('starter', 'company', 'border', 'pvp', 'special', 'event', 'gate')),
  company_id     smallint REFERENCES companies(id),
  width          integer NOT NULL,
  height         integer NOT NULL,
  background_key text NOT NULL,
  min_level      smallint NOT NULL DEFAULT 1,
  entry_rules    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"enemy_company_min_level":12,"requires_item":"key.x"}
  pvp_enabled    boolean NOT NULL DEFAULT true,
  max_players    integer,
  is_closed      boolean NOT NULL DEFAULT false,      -- bakım nedeniyle kapalı
  closed_reason  text,
  is_archived    boolean NOT NULL DEFAULT false
);
ALTER TABLE companies ADD CONSTRAINT companies_home_map_fk FOREIGN KEY (home_map_id) REFERENCES maps(id);

CREATE TABLE map_portals (
  id           serial PRIMARY KEY,
  map_id       integer NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  x            integer NOT NULL,
  y            integer NOT NULL,
  target_map_id integer NOT NULL REFERENCES maps(id),
  target_x     integer NOT NULL,
  target_y     integer NOT NULL,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE map_zones (
  id         serial PRIMARY KEY,
  map_id     integer NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  zone_type  text NOT NULL CHECK (zone_type IN ('safe', 'radiation', 'resource', 'no_pvp', 'spawn_protection', 'station')),
  shape      jsonb NOT NULL                     -- {"type":"circle","x":1000,"y":800,"r":600} veya çokgen
);

CREATE TABLE resource_nodes (
  id           serial PRIMARY KEY,
  map_id       integer NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  item_type_id integer NOT NULL REFERENCES item_types(id),
  area         jsonb NOT NULL,
  max_count    smallint NOT NULL,
  respawn_seconds integer NOT NULL
);

-- ============================================================ 8. NPC VE YAPAY ZEKÂ (Aşama 9)
CREATE TABLE npc_types (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  family         text NOT NULL,                 -- NPC ailesi (aynı aile farklı haritalarda yeniden kullanılır)
  sprite_key     text NOT NULL,
  hitpoints      integer NOT NULL CHECK (hitpoints > 0),
  shield         integer NOT NULL DEFAULT 0,
  shield_absorb  numeric(3,2) NOT NULL DEFAULT 0.5,
  damage         integer NOT NULL,
  attack_rate_ms integer NOT NULL DEFAULT 1000,
  attack_range   integer NOT NULL DEFAULT 600,
  speed          integer NOT NULL,
  -- {"behavior":"aggressive|passive|defensive","aggro_range":700,"flee_hp":0.1,"patrol_radius":900}
  ai             jsonb NOT NULL,
  is_boss        boolean NOT NULL DEFAULT false,
  boss_abilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  reward_table_id integer,                      -- FK aşağıda
  experience     integer NOT NULL DEFAULT 0,
  honor          integer NOT NULL DEFAULT 0,
  is_archived    boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE npc_spawns (
  id              serial PRIMARY KEY,
  map_id          integer NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  npc_type_id     integer NOT NULL REFERENCES npc_types(id),
  area            jsonb NOT NULL,
  max_alive       smallint NOT NULL,
  respawn_seconds integer NOT NULL,
  -- Haritaya özel değişiklikler: {"hitpoints_mult":1.2,"damage_mult":1.1}
  overrides       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled      boolean NOT NULL DEFAULT true
);

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

-- ============================================================ 9. ÖDÜL TABLOLARI
CREATE TABLE reward_tables (
  id    serial PRIMARY KEY,
  code  text NOT NULL UNIQUE,
  name  text NOT NULL
);
CREATE TABLE reward_entries (
  id              serial PRIMARY KEY,
  reward_table_id integer NOT NULL REFERENCES reward_tables(id) ON DELETE CASCADE,
  reward_type     text NOT NULL CHECK (reward_type IN ('currency', 'item', 'experience', 'honor', 'resource')),
  ref_code        text NOT NULL,                -- para birimi kodu veya item_types.code
  min_amount      bigint NOT NULL,
  max_amount      bigint NOT NULL,
  chance          numeric(6,5) NOT NULL CHECK (chance > 0 AND chance <= 1),
  CHECK (max_amount >= min_amount)
);
ALTER TABLE npc_types ADD CONSTRAINT npc_types_reward_fk FOREIGN KEY (reward_table_id) REFERENCES reward_tables(id);
ALTER TABLE gates ADD CONSTRAINT gates_reward_fk FOREIGN KEY (completion_reward_table_id) REFERENCES reward_tables(id);
ALTER TABLE achievements ADD CONSTRAINT achievements_reward_fk FOREIGN KEY (reward_table_id) REFERENCES reward_tables(id);

-- ============================================================ 10. GÖREVLER (Aşama 10)
CREATE TABLE quests (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  category       text NOT NULL CHECK (category IN ('main', 'daily', 'weekly', 'event')),
  title          text NOT NULL,
  description    text NOT NULL,
  min_level      smallint NOT NULL DEFAULT 1,
  company_id     smallint REFERENCES companies(id),
  prerequisite_quest_id integer REFERENCES quests(id),   -- görev zinciri
  chain_code     text,
  chain_order    smallint,
  time_limit_seconds integer,
  reward_table_id integer REFERENCES reward_tables(id),
  starts_at      timestamptz,
  ends_at        timestamptz,
  is_published   boolean NOT NULL DEFAULT false,
  is_archived    boolean NOT NULL DEFAULT false
);

CREATE TABLE quest_objectives (
  id          serial PRIMARY KEY,
  quest_id    integer NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  sort_order  smallint NOT NULL,
  objective_type text NOT NULL CHECK (objective_type IN (
                'kill_npc', 'kill_player', 'collect_resource', 'collect_cargo', 'visit_map', 'complete_gate',
                'upgrade_item', 'survive', 'deal_damage', 'travel_distance')),
  -- {"npc_family":"akrep","map_codes":["K-2","K-3"]} / {"seconds":600,"map_type":"pvp"}
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  target      bigint NOT NULL CHECK (target > 0)
);

CREATE TABLE player_quests (
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_id    integer NOT NULL REFERENCES quests(id),
  cycle_key   text NOT NULL DEFAULT 'once',    -- günlük: '2026-11-27', haftalık: '2026-W48'
  status      text NOT NULL CHECK (status IN ('active', 'completed', 'claimed', 'failed', 'abandoned')),
  progress    jsonb NOT NULL DEFAULT '{}'::jsonb, -- {"<objective_id>": 12}
  accepted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  claimed_at  timestamptz,
  PRIMARY KEY (player_id, quest_id, cycle_key)
);

-- ============================================================ 11. EKONOMİ (Aşama 11)
CREATE TABLE currencies (
  code        text PRIMARY KEY,                -- 'KREDI', 'AKCE', 'SEREF_JETONU'
  name        text NOT NULL,
  is_premium  boolean NOT NULL DEFAULT false,
  tradable    boolean NOT NULL DEFAULT true
);

CREATE TABLE wallets (
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES currencies(code),
  balance       bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),   -- negatif bakiye veritabanı seviyesinde imkânsız
  version       bigint NOT NULL DEFAULT 0,                         -- iyimser kilit
  PRIMARY KEY (player_id, currency_code)
);

-- Yalnızca eklenebilir para defteri. Her bakiye değişikliği tek transaction içinde wallets + ledger.
CREATE TABLE currency_ledger (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  currency_code   text NOT NULL REFERENCES currencies(code),
  delta           bigint NOT NULL CHECK (delta <> 0),
  balance_after   bigint NOT NULL CHECK (balance_after >= 0),
  reason          text NOT NULL,               -- 'npc_reward', 'shop_purchase', 'auction_bid', 'admin_grant' ...
  ref_type        text,
  ref_id          text,
  -- Aynı işlemin iki kez uygulanmasını engeller (çift harcama / tekrar gönderim)
  idempotency_key text UNIQUE,
  actor_user_id   uuid REFERENCES users(id),   -- yönetici işlemlerinde
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX currency_ledger_player_idx ON currency_ledger(player_id, created_at DESC);

CREATE TABLE item_ledger (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_type_id    integer NOT NULL REFERENCES item_types(id),
  player_item_id  uuid,
  delta           bigint NOT NULL CHECK (delta <> 0),
  reason          text NOT NULL,
  idempotency_key text UNIQUE,
  actor_user_id   uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop_categories (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true
);

CREATE TABLE shop_offers (
  id            serial PRIMARY KEY,
  category_id   integer NOT NULL REFERENCES shop_categories(id),
  offer_type    text NOT NULL CHECK (offer_type IN ('item', 'ship', 'bundle')),
  item_type_id  integer REFERENCES item_types(id),
  ship_type_id  integer REFERENCES ship_types(id),
  bundle        jsonb,                          -- paket içeriği
  quantity      bigint NOT NULL DEFAULT 1,
  currency_code text NOT NULL REFERENCES currencies(code),
  price         bigint NOT NULL CHECK (price >= 0),
  discount_percent smallint NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90),
  discount_ends_at timestamptz,
  per_player_limit integer,
  starts_at     timestamptz,
  ends_at       timestamptz,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE auctions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id      smallint NOT NULL REFERENCES game_servers(id),
  item_type_id   integer NOT NULL REFERENCES item_types(id),
  quantity       bigint NOT NULL DEFAULT 1,
  auction_type   text NOT NULL CHECK (auction_type IN ('hourly', 'daily', 'weekly')),
  currency_code  text NOT NULL REFERENCES currencies(code),
  min_bid        bigint NOT NULL,
  current_bid    bigint,
  current_bidder uuid REFERENCES players(id),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('scheduled', 'open', 'settled', 'cancelled'))
);
CREATE TABLE auction_bids (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_id  bigint NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES players(id),
  amount      bigint NOT NULL CHECK (amount > 0),
  refunded    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crafting_recipes (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  output_item_type_id integer NOT NULL REFERENCES item_types(id),
  output_quantity integer NOT NULL DEFAULT 1,
  inputs        jsonb NOT NULL,                 -- [{"item":"res.kuvars","qty":20},{"currency":"KREDI","qty":500}]
  duration_seconds integer NOT NULL DEFAULT 0
);

CREATE TABLE daily_login_rewards (
  day_number      smallint PRIMARY KEY,
  reward_table_id integer NOT NULL REFERENCES reward_tables(id)
);
CREATE TABLE player_daily_logins (
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  login_date date NOT NULL,
  streak     smallint NOT NULL,
  claimed    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (player_id, login_date)
);

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
ALTER TABLE players ADD CONSTRAINT players_clan_fk FOREIGN KEY (clan_id) REFERENCES clans(id) ON DELETE SET NULL;

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
-- Oyuncunun kontrol/HUD/grafik ayarları: cihaz sınıfına göre ayrı, tüm cihazlarda senkron (16.2-16.5)
CREATE TABLE player_settings (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_class text NOT NULL CHECK (device_class IN ('desktop', 'phone', 'tablet')),
  -- {"keybinds":{...},"joystick":{"x":0.12,"y":0.78,"size":1.0,"opacity":0.6},"graphics":"medium","fps":60,"hud_scale":1.0}
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_class)
);

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

-- Son kalan FK'ler
ALTER TABLE players ADD CONSTRAINT players_active_ship_fk FOREIGN KEY (active_ship_id) REFERENCES player_ships(id) ON DELETE SET NULL;
ALTER TABLE players ADD CONSTRAINT players_map_fk FOREIGN KEY (map_id) REFERENCES maps(id);
ALTER TABLE players ADD CONSTRAINT players_rank_fk FOREIGN KEY (rank_id) REFERENCES ranks(id);
