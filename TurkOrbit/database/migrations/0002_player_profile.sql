-- =====================================================================================
-- TÜRK ORBIT — Migration 0002: Oyuncu profili (Aşama 5)
-- Sunucular, şirketler, haritalar (temel), rütbeler, başlangıç gemisi, pilotlar, istatistikler,
-- başarımlar, para birimleri, cüzdanlar ve yalnızca eklenebilir para defteri.
--
-- Tasarım notları:
--  * Seviye ve rütbe puanı SAKLANMAZ; deneyim/şeref/istatistiklerden sunucuda hesaplanır
--    (packages/shared/src/progression.ts). Böylece tek doğruluk kaynağı vardır.
--  * Bakiye değişiklikleri yalnızca apps/api/src/modules/economy/wallet.ts üzerinden yapılır:
--    satır kilidi + defter kaydı + idempotency_key (çift uygulama engeli).
-- =====================================================================================

-- ---------------------------------------------------------------- Oyun sunucuları
CREATE TABLE game_servers (
  id             smallint PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  region         text NOT NULL DEFAULT 'eu-tr',
  is_open        boolean NOT NULL DEFAULT true,       -- yeni pilot kabul ediyor mu
  is_maintenance boolean NOT NULL DEFAULT false,
  sort_order     smallint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO game_servers (id, code, name, region, sort_order) VALUES
  (1, 'TR1', 'Anadolu-1', 'eu-tr', 1);

-- ---------------------------------------------------------------- Şirketler
CREATE TABLE companies (
  id          smallint PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  motto       text NOT NULL,
  description text NOT NULL,
  focus       text NOT NULL,
  color_hex   text NOT NULL CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  home_map_id integer,
  sort_order  smallint NOT NULL DEFAULT 0
);
INSERT INTO companies (id, code, name, motto, description, focus, color_hex, sort_order) VALUES
  (1, 'KZL', 'Kızılelma Konsorsiyumu', 'Ufkun ötesi bizimdir.',
   'Keşif ve fetih idealini taşıyan, Çekirdek''e ilk ulaşmayı hedefleyen saldırgan filo.',
   'Saldırı ve PvP', '#E30A17', 1),
  (2, 'GKB', 'Gökbörü Filosu', 'Sürü güçlüdür, yol gösteren kurttur.',
   'Bozkır geleneğinden gelen, düzen ve dayanıklılığıyla bilinen disiplinli savunma birliği.',
   'Savunma ve dayanıklılık', '#29C5FF', 2),
  (3, 'ALT', 'Altay Madencilik Birliği', 'Yıldızların altını bizim ocağımızda dövülür.',
   'Geçit ağının kaynaklarını işleyen, teknoloji ve üretimde öncü sanayi birliği.',
   'Ekonomi ve üretim', '#F5B700', 3);

-- ---------------------------------------------------------------- Haritalar (temel kayıtlar)
-- Portallar, bölgeler, NPC yerleşimi ve kaynaklar Aşama 7'de eklenecek.
CREATE TABLE maps (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  map_type       text NOT NULL CHECK (map_type IN ('starter', 'company', 'border', 'core', 'special', 'event', 'gate')),
  company_id     smallint REFERENCES companies(id),
  width          integer NOT NULL DEFAULT 20000,
  height         integer NOT NULL DEFAULT 12500,
  spawn_x        integer NOT NULL DEFAULT 10000,
  spawn_y        integer NOT NULL DEFAULT 6250,
  background_key text NOT NULL,
  min_level      smallint NOT NULL DEFAULT 1,
  entry_rules    jsonb NOT NULL DEFAULT '{}'::jsonb,
  pvp_enabled    boolean NOT NULL DEFAULT true,
  is_closed      boolean NOT NULL DEFAULT false,
  closed_reason  text,
  is_archived    boolean NOT NULL DEFAULT false,
  CHECK (spawn_x BETWEEN 0 AND width AND spawn_y BETWEEN 0 AND height)
);
INSERT INTO maps (code, name, map_type, company_id, background_key, min_level, pvp_enabled, spawn_x, spawn_y, entry_rules) VALUES
  ('K-1', 'Kızılelma Limanı',       'starter', 1, 'bg-k1', 1,  false, 1800, 1800, '{"enemy_company_min_level":15}'),
  ('K-2', 'Kızıl Kuşak',            'company', 1, 'bg-k2', 1,  true,  10000, 6250, '{"enemy_company_min_level":15}'),
  ('K-3', 'Akkor Bulutsusu',        'company', 1, 'bg-k3', 5,  true,  10000, 6250, '{"enemy_company_min_level":15}'),
  ('K-4', 'Fetih Hattı',            'company', 1, 'bg-k4', 5,  true,  10000, 6250, '{"enemy_company_min_level":15}'),
  ('G-1', 'Gökbörü Üssü',           'starter', 2, 'bg-g1', 1,  false, 18200, 1800, '{"enemy_company_min_level":15}'),
  ('G-2', 'Bozkır Yıldızları',      'company', 2, 'bg-g2', 1,  true,  10000, 6250, '{"enemy_company_min_level":15}'),
  ('G-3', 'Kurt Takımyıldızı',      'company', 2, 'bg-g3', 5,  true,  10000, 6250, '{"enemy_company_min_level":15}'),
  ('G-4', 'Gök Sınırı',             'company', 2, 'bg-g4', 5,  true,  10000, 6250, '{"enemy_company_min_level":15}'),
  ('A-1', 'Altay Madenleri',        'starter', 3, 'bg-a1', 1,  false, 1800, 10700, '{"enemy_company_min_level":15}'),
  ('A-2', 'Altın Damar',            'company', 3, 'bg-a2', 1,  true,  10000, 6250, '{"enemy_company_min_level":15}'),
  ('A-3', 'Demir Dağları',          'company', 3, 'bg-a3', 5,  true,  10000, 6250, '{"enemy_company_min_level":15}'),
  ('A-4', 'Ocak Sınırı',            'company', 3, 'bg-a4', 5,  true,  10000, 6250, '{"enemy_company_min_level":15}'),
  ('S-1', 'Kuzey Geçidi',           'border',  NULL, 'bg-s1', 8,  true, 10000, 6250, '{}'),
  ('S-2', 'Doğu Geçidi',            'border',  NULL, 'bg-s2', 8,  true, 10000, 6250, '{}'),
  ('S-3', 'Göktaşı Tarlası',        'border',  NULL, 'bg-s3', 8,  true, 10000, 6250, '{}'),
  ('S-4', 'Güney Geçidi',           'border',  NULL, 'bg-s4', 8,  true, 10000, 6250, '{}'),
  ('S-5', 'Batı Geçidi',            'border',  NULL, 'bg-s5', 8,  true, 10000, 6250, '{}'),
  ('S-6', 'Sis Koridoru',           'border',  NULL, 'bg-s6', 8,  true, 10000, 6250, '{}'),
  ('Ç-1', 'Çekirdek: Merkez',       'core',    NULL, 'bg-c1', 12, true, 10000, 6250, '{}'),
  ('Ç-2', 'Çekirdek: Kuzgun Halkası','core',   NULL, 'bg-c2', 12, true, 10000, 6250, '{}'),
  ('Ç-3', 'Çekirdek: Ateş Çemberi', 'core',    NULL, 'bg-c3', 12, true, 10000, 6250, '{}');

ALTER TABLE companies ADD CONSTRAINT companies_home_map_fk FOREIGN KEY (home_map_id) REFERENCES maps(id);
UPDATE companies c SET home_map_id = m.id FROM maps m
  WHERE m.map_type = 'starter' AND m.company_id = c.id;
ALTER TABLE companies ALTER COLUMN home_map_id SET NOT NULL;

-- ---------------------------------------------------------------- Rütbeler
CREATE TABLE ranks (
  id         smallint PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  min_points bigint NOT NULL UNIQUE CHECK (min_points >= 0),
  icon_key   text NOT NULL
);
INSERT INTO ranks (id, name, min_points, icon_key) VALUES
  (1,  'Pilot Adayı',          0,       'rank-01'),
  (2,  'Uzay Pilotu',          100,     'rank-02'),
  (3,  'Kıdemli Uzay Pilotu',  400,     'rank-03'),
  (4,  'Onbaşı',               1000,    'rank-04'),
  (5,  'Çavuş',                2500,    'rank-05'),
  (6,  'Başçavuş',             5000,    'rank-06'),
  (7,  'Astsubay',             10000,   'rank-07'),
  (8,  'Asteğmen',             20000,   'rank-08'),
  (9,  'Teğmen',               40000,   'rank-09'),
  (10, 'Üsteğmen',             75000,   'rank-10'),
  (11, 'Yüzbaşı',              125000,  'rank-11'),
  (12, 'Binbaşı',              200000,  'rank-12'),
  (13, 'Yarbay',               300000,  'rank-13'),
  (14, 'Albay',                450000,  'rank-14'),
  (15, 'Tuğgeneral',           650000,  'rank-15'),
  (16, 'Tümgeneral',           900000,  'rank-16'),
  (17, 'Korgeneral',           1250000, 'rank-17'),
  (18, 'Orgeneral',            1750000, 'rank-18');

-- ---------------------------------------------------------------- Gemi türleri (Aşama 6 genişletecek)
CREATE TABLE ship_types (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  ship_class      text NOT NULL,
  sprite_key      text NOT NULL,
  hitpoints       integer NOT NULL CHECK (hitpoints > 0),
  base_speed      integer NOT NULL CHECK (base_speed > 0),
  cargo_capacity  integer NOT NULL DEFAULT 0 CHECK (cargo_capacity >= 0),
  laser_slots     smallint NOT NULL CHECK (laser_slots >= 0),
  generator_slots smallint NOT NULL CHECK (generator_slots >= 0),
  extra_slots     smallint NOT NULL DEFAULT 0 CHECK (extra_slots >= 0),
  drone_slots     smallint NOT NULL DEFAULT 0 CHECK (drone_slots >= 0),
  min_level       smallint NOT NULL DEFAULT 1,
  is_starter      boolean NOT NULL DEFAULT false,
  is_for_sale     boolean NOT NULL DEFAULT true,
  is_archived     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Aynı anda yalnızca bir başlangıç gemisi olabilir
CREATE UNIQUE INDEX ship_types_single_starter ON ship_types (is_starter) WHERE is_starter;
CREATE TRIGGER ship_types_set_updated_at BEFORE UPDATE ON ship_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO ship_types (code, name, description, ship_class, sprite_key, hitpoints, base_speed, cargo_capacity,
                        laser_slots, generator_slots, extra_slots, drone_slots, min_level, is_starter, is_for_sale) VALUES
  ('kirlangic', 'Kırlangıç', 'Her pilotun ilk gemisi. Hafif, çevik ve affedici bir eğitim gemisi.',
   'starter', 'ship-kirlangic', 4000, 320, 100, 1, 1, 1, 0, 1, true, false);

-- ---------------------------------------------------------------- Pilotlar
CREATE TABLE players (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id          smallint NOT NULL REFERENCES game_servers(id),
  pilot_name         citext NOT NULL,
  company_id         smallint NOT NULL REFERENCES companies(id),
  experience         bigint NOT NULL DEFAULT 0 CHECK (experience >= 0),
  honor              bigint NOT NULL DEFAULT 0,
  active_ship_id     uuid,
  map_id             integer NOT NULL REFERENCES maps(id),
  pos_x              real NOT NULL,
  pos_y              real NOT NULL,
  playtime_seconds   bigint NOT NULL DEFAULT 0 CHECK (playtime_seconds >= 0),
  motto              text CHECK (motto IS NULL OR char_length(motto) <= 80),
  company_changed_at timestamptz,
  last_online_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, server_id),
  UNIQUE (server_id, pilot_name)
);
CREATE INDEX players_company_idx ON players(server_id, company_id);
CREATE TRIGGER players_set_updated_at BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE player_stats (
  player_id        uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  npc_kills        bigint NOT NULL DEFAULT 0 CHECK (npc_kills >= 0),
  player_kills     bigint NOT NULL DEFAULT 0 CHECK (player_kills >= 0),
  deaths           bigint NOT NULL DEFAULT 0 CHECK (deaths >= 0),
  gates_completed  integer NOT NULL DEFAULT 0 CHECK (gates_completed >= 0),
  cargo_collected  bigint NOT NULL DEFAULT 0 CHECK (cargo_collected >= 0),
  damage_dealt     bigint NOT NULL DEFAULT 0 CHECK (damage_dealt >= 0),
  damage_taken     bigint NOT NULL DEFAULT 0 CHECK (damage_taken >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player_ships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ship_type_id integer NOT NULL REFERENCES ship_types(id),
  hitpoints    integer NOT NULL CHECK (hitpoints >= 0),
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL,
  UNIQUE (player_id, ship_type_id)
);
ALTER TABLE players ADD CONSTRAINT players_active_ship_fk
  FOREIGN KEY (active_ship_id) REFERENCES player_ships(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- Başarımlar
CREATE TABLE achievements (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL,
  category    text NOT NULL CHECK (category IN ('genel', 'savas', 'kesif', 'ekonomi', 'sosyal')),
  -- İlerleme kaynağı: 'event' (olayla verilir) veya bir istatistik anahtarı
  stat_key    text NOT NULL CHECK (stat_key IN ('event', 'npc_kills', 'player_kills', 'level', 'gates_completed',
                                                 'cargo_collected', 'playtime_seconds')),
  target      bigint NOT NULL DEFAULT 1 CHECK (target > 0),
  icon_key    text NOT NULL,
  sort_order  smallint NOT NULL DEFAULT 0,
  is_hidden   boolean NOT NULL DEFAULT false
);
INSERT INTO achievements (code, name, description, category, stat_key, target, icon_key, sort_order) VALUES
  ('pilot_created',  'Galaksiye Hoş Geldin', 'Pilotunu oluştur ve şirketine katıl.',          'genel', 'event',            1,      'ach-welcome', 1),
  ('level_5',        'Kanatlandın',          'Seviye 5''e ulaş.',                              'genel', 'level',            5,      'ach-level',   2),
  ('level_10',       'Tecrübeli Pilot',      'Seviye 10''a ulaş.',                             'genel', 'level',            10,     'ach-level',   3),
  ('level_20',       'Usta Pilot',           'Seviye 20''ye ulaş.',                            'genel', 'level',            20,     'ach-level',   4),
  ('npc_100',        'Sürü Avcısı',          '100 Sızıntı canlısını yok et.',                  'savas', 'npc_kills',        100,    'ach-npc',     5),
  ('npc_1000',       'Sızıntı Kıran',        '1.000 Sızıntı canlısını yok et.',                'savas', 'npc_kills',        1000,   'ach-npc',     6),
  ('pvp_10',         'Düello Ustası',        'Düşman şirketlerden 10 pilot yen.',              'savas', 'player_kills',     10,     'ach-pvp',     7),
  ('gate_1',         'Kapı Kâşifi',          'İlk Yıldız Kapını tamamla.',                     'kesif', 'gates_completed',  1,      'ach-gate',    8),
  ('cargo_500',      'Toplayıcı',            '500 kargo kutusu topla.',                        'ekonomi','cargo_collected', 500,    'ach-cargo',   9),
  ('playtime_10h',   'Gezgin',               'Galakside toplam 10 saat geçir.',                'kesif', 'playtime_seconds', 36000,  'ach-time',    10);

CREATE TABLE player_achievements (
  player_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id integer NOT NULL REFERENCES achievements(id),
  completed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, achievement_id)
);

-- ---------------------------------------------------------------- Para birimleri, cüzdan, defter
CREATE TABLE currencies (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  is_premium boolean NOT NULL DEFAULT false,
  tradable   boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0
);
INSERT INTO currencies (code, name, is_premium, tradable, sort_order) VALUES
  ('KREDI', 'Kredi', false, true, 1),
  ('AKCE',  'Akçe',  true,  false, 2);

CREATE TABLE wallets (
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES currencies(code),
  balance       bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),   -- negatif bakiye veritabanı seviyesinde imkânsız
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, currency_code)
);

CREATE TABLE currency_ledger (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  currency_code   text NOT NULL REFERENCES currencies(code),
  delta           bigint NOT NULL CHECK (delta <> 0),
  balance_after   bigint NOT NULL CHECK (balance_after >= 0),
  reason          text NOT NULL,
  ref_type        text,
  ref_id          text,
  idempotency_key text UNIQUE,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX currency_ledger_player_idx ON currency_ledger(player_id, created_at DESC, id DESC);

-- Defter yalnızca eklenebilir (oyuncu silinirse CASCADE ile birlikte silinir).
-- Tek istisna: işlemi yapan yöneticinin hesabı silinirse actor_user_id'nin NULL yapılması.
CREATE OR REPLACE FUNCTION forbid_ledger_update() RETURNS trigger AS $$
BEGIN
  IF OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'currency_ledger kayıtları değiştirilemez';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER currency_ledger_immutable BEFORE UPDATE ON currency_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();

-- ---------------------------------------------------------------- Oyun ayarları (Yönetim Merkezi 15.11)
INSERT INTO game_settings (key, value) VALUES
  ('starter.currencies', '{"KREDI": 25000, "AKCE": 1000}'::jsonb),
  ('company.change', '{"cooldown_days": 30, "cost": {"currency": "AKCE", "amount": 2000}}'::jsonb);
