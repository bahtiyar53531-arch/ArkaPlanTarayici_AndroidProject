-- =====================================================================================
-- TÜRK ORBIT — Migration 0005: NPC'ler, savaş, ödüller ve kargo (Aşama 9)
--
--  * NPC türleri (08-Ozgun-Dunya-Taslagi §6: Çakal, Akrep, Örümcek, Yarasa aileleri; 11 kademe).
--    Davranış ai alanında: passive (sürü), aggressive, kite (vur-kaç); zehir ve yavaşlatma etkileri.
--  * Ödül tabloları: delivery = 'direct' (öldürene doğrudan, defterli) veya 'cargo' (kargo kutusuna düşer).
--  * Doğma noktaları: 21 haritada daire alanlar, en fazla canlı sayısı ve yeniden doğma süresi.
--  * Ölüm ve NPC öldürme kayıtları (görevler Aşama 10'da bu kayıtları kullanacak).
--  Tüm değerler Yönetim Merkezi'nden (Aşama 14) değiştirilebilecek şekilde veritabanındadır.
-- =====================================================================================

CREATE TABLE npc_types (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  family         text NOT NULL,                 -- NPC ailesi (aynı aile farklı haritalarda yeniden kullanılır)
  level          smallint NOT NULL DEFAULT 1,   -- göstergede kademe/seviye
  sprite_key     text NOT NULL,
  scale          real NOT NULL DEFAULT 1 CHECK (scale BETWEEN 0.3 AND 4),
  color_hex      text NOT NULL DEFAULT '#E0533D' CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  hitpoints      integer NOT NULL CHECK (hitpoints > 0),
  shield         integer NOT NULL DEFAULT 0 CHECK (shield >= 0),
  shield_absorb  numeric(3,2) NOT NULL DEFAULT 0.5 CHECK (shield_absorb BETWEEN 0 AND 1),
  damage         integer NOT NULL CHECK (damage >= 0),
  attack_rate_ms integer NOT NULL DEFAULT 1000 CHECK (attack_rate_ms >= 250),
  attack_range   integer NOT NULL DEFAULT 600 CHECK (attack_range > 0),
  speed          integer NOT NULL CHECK (speed > 0),
  -- {"behavior":"passive|aggressive|kite","pack":true,"aggro_range":700,"patrol_radius":1400,"leash":2800,
  --  "poison":{"ratio":0.3,"ms":3000},"slow":{"factor":0.6,"ms":1500}}
  ai             jsonb NOT NULL CHECK (ai->>'behavior' IN ('passive', 'aggressive', 'kite')),
  is_boss        boolean NOT NULL DEFAULT false,
  reward_table_id integer,
  experience     integer NOT NULL DEFAULT 0 CHECK (experience >= 0),
  honor          integer NOT NULL DEFAULT 0,
  is_archived    boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

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
  min_amount      bigint NOT NULL CHECK (min_amount > 0),
  max_amount      bigint NOT NULL,
  chance          numeric(6,5) NOT NULL CHECK (chance > 0 AND chance <= 1),
  -- direct: öldürene doğrudan · cargo: ölüm yerine kargo kutusu olarak düşer (toplanınca verilir)
  delivery        text NOT NULL DEFAULT 'direct' CHECK (delivery IN ('direct', 'cargo')),
  CHECK (max_amount >= min_amount)
);
CREATE INDEX reward_entries_table_idx ON reward_entries(reward_table_id);
ALTER TABLE npc_types ADD CONSTRAINT npc_types_reward_fk FOREIGN KEY (reward_table_id) REFERENCES reward_tables(id);

CREATE TABLE npc_spawns (
  id              serial PRIMARY KEY,
  map_id          integer NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  npc_type_id     integer NOT NULL REFERENCES npc_types(id),
  -- {"type":"circle","x":9000,"y":6000,"r":1600}
  area            jsonb NOT NULL CHECK (area->>'type' = 'circle'),
  max_alive       smallint NOT NULL CHECK (max_alive BETWEEN 1 AND 100),
  respawn_seconds integer NOT NULL CHECK (respawn_seconds >= 1),
  -- Haritaya özel değişiklikler: {"hitpoints_mult":1.2,"damage_mult":1.1}
  overrides       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled      boolean NOT NULL DEFAULT true
);
CREATE INDEX npc_spawns_map_idx ON npc_spawns(map_id);

-- Ölüm kaydı (analiz, şikâyet incelemesi; PvP şerefi ve görevler bu kaydı kullanır)
CREATE TABLE combat_deaths (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id         uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  map_id            integer NOT NULL REFERENCES maps(id),
  x                 real NOT NULL,
  y                 real NOT NULL,
  killer_kind       text NOT NULL CHECK (killer_kind IN ('npc', 'player', 'other')),
  killer_npc_type_id integer REFERENCES npc_types(id),
  killer_player_id  uuid REFERENCES players(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX combat_deaths_player_idx ON combat_deaths(player_id, created_at DESC);

-- NPC öldürme kaydı (Aşama 10 görev hedefleri: "30 Çakal yok et")
CREATE TABLE npc_kill_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kill_id     uuid NOT NULL UNIQUE,              -- ödül defterindeki ref_id ile aynı (çift ödül imkânsız)
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  npc_type_id integer NOT NULL REFERENCES npc_types(id),
  map_id      integer NOT NULL REFERENCES maps(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX npc_kill_log_player_idx ON npc_kill_log(player_id, created_at DESC);

INSERT INTO game_settings (key, value) VALUES
  -- Savaş kuralları (sunucu otoriteli). Süreler ms.
  ('combat', '{"respawn_hp_ratio": 0.1, "shield_regen_delay_ms": 4000, "shield_regen_ratio_per_sec": 0.08,
               "repair_delay_ms": 5000, "loot_owner_ms": 15000, "loot_ttl_ms": 60000, "loot_pickup_radius": 90,
               "pvp_honor": 100, "damage_variance": 0.1, "out_of_combat_ms": 5000}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- NPC türleri (üretildi: gen_combat.py)
INSERT INTO npc_types (code, name, family, level, sprite_key, scale, color_hex, hitpoints, shield, shield_absorb, damage, attack_rate_ms, attack_range, speed, ai, is_boss, experience) VALUES
  ('cakal', 'Çakal', 'cakal', 1, 'npc-cakal', 0.85, '#E0A93B', 400, 200, 0.5, 15, 1000, 450, 280, '{"behavior": "passive", "pack": true, "patrol_radius": 1400, "leash": 2600}'::jsonb, false, 400),
  ('cakal-avci', 'Çakal Avcı', 'cakal', 2, 'npc-cakal', 1.0, '#E0A93B', 1200, 600, 0.5, 40, 1000, 500, 290, '{"behavior": "passive", "pack": true, "patrol_radius": 1400, "leash": 2600}'::jsonb, false, 1200),
  ('suru-basi', 'Sürü Başı', 'cakal', 3, 'npc-cakal', 1.35, '#E0A93B', 4000, 2000, 0.6, 100, 1000, 550, 260, '{"behavior": "aggressive", "pack": true, "aggro_range": 600, "patrol_radius": 1200, "leash": 2600}'::jsonb, false, 4000),
  ('akrep', 'Akrep', 'akrep', 3, 'npc-akrep', 0.95, '#E0533D', 2000, 1000, 0.5, 60, 1000, 550, 300, '{"behavior": "aggressive", "aggro_range": 600, "patrol_radius": 1500, "leash": 2800, "poison": {"ratio": 0.3, "ms": 3000}}'::jsonb, false, 2400),
  ('kara-akrep', 'Kara Akrep', 'akrep', 5, 'npc-akrep', 1.15, '#E0533D', 6000, 3000, 0.6, 150, 1000, 600, 300, '{"behavior": "aggressive", "aggro_range": 700, "patrol_radius": 1500, "leash": 3000, "poison": {"ratio": 0.3, "ms": 3000}}'::jsonb, false, 7200),
  ('akrep-kralice', 'Akrep Kraliçe', 'akrep', 9, 'npc-akrep', 1.8, '#E0533D', 40000, 20000, 0.7, 500, 1000, 650, 240, '{"behavior": "aggressive", "aggro_range": 800, "patrol_radius": 1000, "leash": 3200, "poison": {"ratio": 0.4, "ms": 4000}}'::jsonb, true, 50000),
  ('orumcek', 'Örümcek', 'orumcek', 4, 'npc-orumcek', 0.95, '#9B6BD6', 3000, 1500, 0.5, 80, 1000, 550, 280, '{"behavior": "aggressive", "aggro_range": 600, "patrol_radius": 1400, "leash": 2800, "slow": {"factor": 0.6, "ms": 1500}}'::jsonb, false, 3200),
  ('ag-oren', 'Ağ Ören', 'orumcek', 6, 'npc-orumcek', 1.15, '#9B6BD6', 9000, 4500, 0.6, 200, 1000, 600, 270, '{"behavior": "aggressive", "aggro_range": 700, "patrol_radius": 1400, "leash": 3000, "slow": {"factor": 0.5, "ms": 2000}}'::jsonb, false, 10000),
  ('ana-orumcek', 'Ana Örümcek', 'orumcek', 10, 'npc-orumcek', 1.8, '#9B6BD6', 60000, 30000, 0.7, 700, 1000, 650, 230, '{"behavior": "aggressive", "aggro_range": 800, "patrol_radius": 1000, "leash": 3200, "slow": {"factor": 0.5, "ms": 2500}}'::jsonb, true, 70000),
  ('yarasa', 'Yarasa', 'yarasa', 7, 'npc-yarasa', 0.95, '#4FB3A9', 5000, 2500, 0.5, 150, 1000, 500, 420, '{"behavior": "kite", "aggro_range": 700, "patrol_radius": 1800, "leash": 3200}'::jsonb, false, 6000),
  ('gece-yarasasi', 'Gece Yarasası', 'yarasa', 11, 'npc-yarasa', 1.2, '#4FB3A9', 15000, 7500, 0.6, 400, 1000, 550, 440, '{"behavior": "kite", "aggro_range": 800, "patrol_radius": 1800, "leash": 3400}'::jsonb, false, 18000);

-- ---------------------------------------------------------------- Ödül tabloları
INSERT INTO reward_tables (code, name) VALUES
  ('npc.cakal', 'Çakal ödülü'),
  ('npc.cakal-avci', 'Çakal Avcı ödülü'),
  ('npc.suru-basi', 'Sürü Başı ödülü'),
  ('npc.akrep', 'Akrep ödülü'),
  ('npc.kara-akrep', 'Kara Akrep ödülü'),
  ('npc.akrep-kralice', 'Akrep Kraliçe ödülü'),
  ('npc.orumcek', 'Örümcek ödülü'),
  ('npc.ag-oren', 'Ağ Ören ödülü'),
  ('npc.ana-orumcek', 'Ana Örümcek ödülü'),
  ('npc.yarasa', 'Yarasa ödülü'),
  ('npc.gece-yarasasi', 'Gece Yarasası ödülü');
UPDATE npc_types n SET reward_table_id = r.id FROM reward_tables r WHERE r.code = 'npc.' || n.code;
INSERT INTO reward_entries (reward_table_id, reward_type, ref_code, min_amount, max_amount, chance, delivery)
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.cakal'), 'currency', 'KREDI', 400, 400, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.cakal'), 'item', 'ammo.isk1', 20, 60, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.cakal-avci'), 'currency', 'KREDI', 1000, 1000, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.cakal-avci'), 'item', 'ammo.isk1', 40, 120, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.cakal-avci'), 'item', 'ammo.isk2', 20, 50, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.suru-basi'), 'currency', 'KREDI', 3000, 3000, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.suru-basi'), 'currency', 'AKCE', 2, 2, 0.3, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.suru-basi'), 'item', 'ammo.isk1', 60, 180, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.suru-basi'), 'item', 'ammo.isk2', 30, 75, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.suru-basi'), 'item', 'rocket.yildirim', 2, 5, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep'), 'currency', 'KREDI', 2000, 2000, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep'), 'item', 'ammo.isk1', 60, 180, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep'), 'item', 'ammo.isk2', 30, 75, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep'), 'item', 'rocket.yildirim', 2, 5, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.kara-akrep'), 'currency', 'KREDI', 6000, 6000, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.kara-akrep'), 'currency', 'AKCE', 5, 5, 0.3, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.kara-akrep'), 'item', 'ammo.isk1', 100, 300, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.kara-akrep'), 'item', 'ammo.isk2', 50, 125, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.kara-akrep'), 'item', 'rocket.yildirim', 2, 7, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep-kralice'), 'currency', 'KREDI', 40000, 40000, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep-kralice'), 'currency', 'AKCE', 40, 40, 1.0, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep-kralice'), 'item', 'ammo.isk1', 180, 540, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep-kralice'), 'item', 'ammo.isk2', 90, 225, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep-kralice'), 'item', 'rocket.yildirim', 2, 11, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.akrep-kralice'), 'item', 'ammo.isk3', 45, 135, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.orumcek'), 'currency', 'KREDI', 2600, 2600, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.orumcek'), 'item', 'ammo.isk1', 80, 240, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.orumcek'), 'item', 'ammo.isk2', 40, 100, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.orumcek'), 'item', 'rocket.yildirim', 2, 6, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ag-oren'), 'currency', 'KREDI', 8000, 8000, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ag-oren'), 'currency', 'AKCE', 6, 6, 0.3, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ag-oren'), 'item', 'ammo.isk1', 120, 360, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ag-oren'), 'item', 'ammo.isk2', 60, 150, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ag-oren'), 'item', 'rocket.yildirim', 2, 8, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ag-oren'), 'item', 'ammo.isk3', 30, 90, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ana-orumcek'), 'currency', 'KREDI', 60000, 60000, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ana-orumcek'), 'currency', 'AKCE', 60, 60, 1.0, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ana-orumcek'), 'item', 'ammo.isk1', 200, 600, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ana-orumcek'), 'item', 'ammo.isk2', 100, 250, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ana-orumcek'), 'item', 'rocket.yildirim', 2, 12, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.ana-orumcek'), 'item', 'ammo.isk3', 50, 150, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.yarasa'), 'currency', 'KREDI', 5000, 5000, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.yarasa'), 'item', 'ammo.isk1', 140, 420, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.yarasa'), 'item', 'ammo.isk2', 70, 175, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.yarasa'), 'item', 'rocket.yildirim', 2, 9, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.yarasa'), 'item', 'ammo.isk3', 35, 105, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.gece-yarasasi'), 'currency', 'KREDI', 15000, 15000, 1, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.gece-yarasasi'), 'currency', 'AKCE', 12, 12, 0.5, 'direct'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.gece-yarasasi'), 'item', 'ammo.isk1', 220, 660, 0.6, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.gece-yarasasi'), 'item', 'ammo.isk2', 110, 275, 0.2, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.gece-yarasasi'), 'item', 'rocket.yildirim', 2, 13, 0.15, 'cargo'
  UNION ALL
  SELECT (SELECT id FROM reward_tables WHERE code = 'npc.gece-yarasasi'), 'item', 'ammo.isk3', 55, 165, 0.15, 'cargo';

-- ---------------------------------------------------------------- Doğma noktaları (21 harita)
INSERT INTO npc_spawns (map_id, npc_type_id, area, max_alive, respawn_seconds) VALUES
  ((SELECT id FROM maps WHERE code = 'K-1'), (SELECT id FROM npc_types WHERE code = 'cakal'), '{"type": "circle", "x": 2804, "y": 7054, "r": 1600}'::jsonb, 7, 20),
  ((SELECT id FROM maps WHERE code = 'K-1'), (SELECT id FROM npc_types WHERE code = 'cakal'), '{"type": "circle", "x": 6486, "y": 8895, "r": 1600}'::jsonb, 7, 20),
  ((SELECT id FROM maps WHERE code = 'K-1'), (SELECT id FROM npc_types WHERE code = 'cakal-avci'), '{"type": "circle", "x": 7153, "y": 6632, "r": 1600}'::jsonb, 4, 30),
  ((SELECT id FROM maps WHERE code = 'K-2'), (SELECT id FROM npc_types WHERE code = 'cakal-avci'), '{"type": "circle", "x": 15927, "y": 3405, "r": 1600}'::jsonb, 5, 30),
  ((SELECT id FROM maps WHERE code = 'K-2'), (SELECT id FROM npc_types WHERE code = 'cakal-avci'), '{"type": "circle", "x": 4935, "y": 4524, "r": 1600}'::jsonb, 5, 30),
  ((SELECT id FROM maps WHERE code = 'K-2'), (SELECT id FROM npc_types WHERE code = 'suru-basi'), '{"type": "circle", "x": 8648, "y": 4143, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'K-2'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 17647, "y": 4395, "r": 1600}'::jsonb, 4, 40),
  ((SELECT id FROM maps WHERE code = 'K-2'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 17346, "y": 2908, "r": 1600}'::jsonb, 4, 40),
  ((SELECT id FROM maps WHERE code = 'K-3'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 15240, "y": 3524, "r": 1600}'::jsonb, 5, 40),
  ((SELECT id FROM maps WHERE code = 'K-3'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 9810, "y": 2479, "r": 1600}'::jsonb, 5, 40),
  ((SELECT id FROM maps WHERE code = 'K-3'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 17229, "y": 3541, "r": 1600}'::jsonb, 5, 60),
  ((SELECT id FROM maps WHERE code = 'K-3'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 14412, "y": 3871, "r": 1600}'::jsonb, 3, 45),
  ((SELECT id FROM maps WHERE code = 'K-3'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 2868, "y": 6986, "r": 1600}'::jsonb, 3, 45),
  ((SELECT id FROM maps WHERE code = 'K-4'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 14347, "y": 7519, "r": 1600}'::jsonb, 4, 45),
  ((SELECT id FROM maps WHERE code = 'K-4'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 10230, "y": 3434, "r": 1600}'::jsonb, 4, 45),
  ((SELECT id FROM maps WHERE code = 'K-4'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 13951, "y": 8045, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'K-4'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 15295, "y": 9148, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'K-4'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 2657, "y": 2647, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'K-4'), (SELECT id FROM npc_types WHERE code = 'ana-orumcek'), '{"type": "circle", "x": 16128, "y": 9966, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'G-1'), (SELECT id FROM npc_types WHERE code = 'cakal'), '{"type": "circle", "x": 16619, "y": 6925, "r": 1600}'::jsonb, 7, 20),
  ((SELECT id FROM maps WHERE code = 'G-1'), (SELECT id FROM npc_types WHERE code = 'cakal'), '{"type": "circle", "x": 14243, "y": 7492, "r": 1600}'::jsonb, 7, 20),
  ((SELECT id FROM maps WHERE code = 'G-1'), (SELECT id FROM npc_types WHERE code = 'cakal-avci'), '{"type": "circle", "x": 13310, "y": 6667, "r": 1600}'::jsonb, 4, 30),
  ((SELECT id FROM maps WHERE code = 'G-2'), (SELECT id FROM npc_types WHERE code = 'cakal-avci'), '{"type": "circle", "x": 14453, "y": 4446, "r": 1600}'::jsonb, 5, 30),
  ((SELECT id FROM maps WHERE code = 'G-2'), (SELECT id FROM npc_types WHERE code = 'cakal-avci'), '{"type": "circle", "x": 9971, "y": 7907, "r": 1600}'::jsonb, 5, 30),
  ((SELECT id FROM maps WHERE code = 'G-2'), (SELECT id FROM npc_types WHERE code = 'suru-basi'), '{"type": "circle", "x": 2764, "y": 6509, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'G-2'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 2713, "y": 6097, "r": 1600}'::jsonb, 4, 40),
  ((SELECT id FROM maps WHERE code = 'G-2'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 15074, "y": 4175, "r": 1600}'::jsonb, 4, 40),
  ((SELECT id FROM maps WHERE code = 'G-3'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 15079, "y": 6388, "r": 1600}'::jsonb, 5, 40),
  ((SELECT id FROM maps WHERE code = 'G-3'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 4968, "y": 5351, "r": 1600}'::jsonb, 5, 40),
  ((SELECT id FROM maps WHERE code = 'G-3'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 17577, "y": 4264, "r": 1600}'::jsonb, 5, 60),
  ((SELECT id FROM maps WHERE code = 'G-3'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 15735, "y": 9670, "r": 1600}'::jsonb, 3, 45),
  ((SELECT id FROM maps WHERE code = 'G-3'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 4736, "y": 4453, "r": 1600}'::jsonb, 3, 45),
  ((SELECT id FROM maps WHERE code = 'G-4'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 13915, "y": 5550, "r": 1600}'::jsonb, 4, 45),
  ((SELECT id FROM maps WHERE code = 'G-4'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 10581, "y": 3327, "r": 1600}'::jsonb, 4, 45),
  ((SELECT id FROM maps WHERE code = 'G-4'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 9700, "y": 7333, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'G-4'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 16809, "y": 4130, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'G-4'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 6837, "y": 8511, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'G-4'), (SELECT id FROM npc_types WHERE code = 'ana-orumcek'), '{"type": "circle", "x": 18186, "y": 10131, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'A-1'), (SELECT id FROM npc_types WHERE code = 'cakal'), '{"type": "circle", "x": 13731, "y": 9452, "r": 1600}'::jsonb, 7, 20),
  ((SELECT id FROM maps WHERE code = 'A-1'), (SELECT id FROM npc_types WHERE code = 'cakal'), '{"type": "circle", "x": 13222, "y": 4382, "r": 1600}'::jsonb, 7, 20),
  ((SELECT id FROM maps WHERE code = 'A-1'), (SELECT id FROM npc_types WHERE code = 'cakal-avci'), '{"type": "circle", "x": 4459, "y": 4769, "r": 1600}'::jsonb, 4, 30),
  ((SELECT id FROM maps WHERE code = 'A-2'), (SELECT id FROM npc_types WHERE code = 'cakal-avci'), '{"type": "circle", "x": 13314, "y": 2852, "r": 1600}'::jsonb, 5, 30),
  ((SELECT id FROM maps WHERE code = 'A-2'), (SELECT id FROM npc_types WHERE code = 'cakal-avci'), '{"type": "circle", "x": 10183, "y": 3578, "r": 1600}'::jsonb, 5, 30),
  ((SELECT id FROM maps WHERE code = 'A-2'), (SELECT id FROM npc_types WHERE code = 'suru-basi'), '{"type": "circle", "x": 11622, "y": 2879, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'A-2'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 3365, "y": 2401, "r": 1600}'::jsonb, 4, 40),
  ((SELECT id FROM maps WHERE code = 'A-2'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 16362, "y": 7694, "r": 1600}'::jsonb, 4, 40),
  ((SELECT id FROM maps WHERE code = 'A-3'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 15950, "y": 7112, "r": 1600}'::jsonb, 5, 40),
  ((SELECT id FROM maps WHERE code = 'A-3'), (SELECT id FROM npc_types WHERE code = 'akrep'), '{"type": "circle", "x": 13684, "y": 2533, "r": 1600}'::jsonb, 5, 40),
  ((SELECT id FROM maps WHERE code = 'A-3'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 15673, "y": 4630, "r": 1600}'::jsonb, 5, 60),
  ((SELECT id FROM maps WHERE code = 'A-3'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 5788, "y": 4473, "r": 1600}'::jsonb, 3, 45),
  ((SELECT id FROM maps WHERE code = 'A-3'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 7639, "y": 5835, "r": 1600}'::jsonb, 3, 45),
  ((SELECT id FROM maps WHERE code = 'A-4'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 12383, "y": 4276, "r": 1600}'::jsonb, 4, 45),
  ((SELECT id FROM maps WHERE code = 'A-4'), (SELECT id FROM npc_types WHERE code = 'orumcek'), '{"type": "circle", "x": 6206, "y": 2298, "r": 1600}'::jsonb, 4, 45),
  ((SELECT id FROM maps WHERE code = 'A-4'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 3721, "y": 7181, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'A-4'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 7322, "y": 3114, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'A-4'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 14752, "y": 8539, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'A-4'), (SELECT id FROM npc_types WHERE code = 'ana-orumcek'), '{"type": "circle", "x": 17473, "y": 10210, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'S-1'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 10631, "y": 6042, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-1'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 15208, "y": 7902, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-1'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 7056, "y": 3613, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-1'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 9185, "y": 4062, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-1'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 16579, "y": 9291, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-1'), (SELECT id FROM npc_types WHERE code = 'akrep-kralice'), '{"type": "circle", "x": 9916, "y": 3135, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'S-2'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 3823, "y": 4863, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-2'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 2860, "y": 9638, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-2'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 13549, "y": 8026, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-2'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 12241, "y": 4547, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-2'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 2882, "y": 7034, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-2'), (SELECT id FROM npc_types WHERE code = 'akrep-kralice'), '{"type": "circle", "x": 4010, "y": 4451, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'S-3'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 12952, "y": 2655, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-3'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 14261, "y": 6762, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-3'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 5845, "y": 6885, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-3'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 3477, "y": 4394, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-3'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 8779, "y": 4608, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-3'), (SELECT id FROM npc_types WHERE code = 'akrep-kralice'), '{"type": "circle", "x": 3199, "y": 9265, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'S-4'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 3136, "y": 4455, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-4'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 13560, "y": 8803, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-4'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 6589, "y": 9326, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-4'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 11905, "y": 3399, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-4'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 8543, "y": 5415, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-4'), (SELECT id FROM npc_types WHERE code = 'akrep-kralice'), '{"type": "circle", "x": 11311, "y": 2567, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'S-5'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 11031, "y": 9848, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-5'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 7091, "y": 6024, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-5'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 11600, "y": 7506, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-5'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 2720, "y": 5613, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-5'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 3829, "y": 3554, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-5'), (SELECT id FROM npc_types WHERE code = 'akrep-kralice'), '{"type": "circle", "x": 11858, "y": 4228, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'S-6'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 17751, "y": 9616, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-6'), (SELECT id FROM npc_types WHERE code = 'kara-akrep'), '{"type": "circle", "x": 14203, "y": 6886, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-6'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 15006, "y": 7827, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-6'), (SELECT id FROM npc_types WHERE code = 'yarasa'), '{"type": "circle", "x": 8156, "y": 3440, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-6'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 14577, "y": 6024, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'S-6'), (SELECT id FROM npc_types WHERE code = 'akrep-kralice'), '{"type": "circle", "x": 15915, "y": 9379, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), (SELECT id FROM npc_types WHERE code = 'gece-yarasasi'), '{"type": "circle", "x": 9518, "y": 6704, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), (SELECT id FROM npc_types WHERE code = 'gece-yarasasi'), '{"type": "circle", "x": 14588, "y": 10220, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 10934, "y": 8508, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 13337, "y": 5797, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), (SELECT id FROM npc_types WHERE code = 'akrep-kralice'), '{"type": "circle", "x": 11526, "y": 7648, "r": 900}'::jsonb, 2, 300),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), (SELECT id FROM npc_types WHERE code = 'ana-orumcek'), '{"type": "circle", "x": 5878, "y": 1987, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), (SELECT id FROM npc_types WHERE code = 'gece-yarasasi'), '{"type": "circle", "x": 14676, "y": 6234, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), (SELECT id FROM npc_types WHERE code = 'gece-yarasasi'), '{"type": "circle", "x": 16729, "y": 10191, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 5223, "y": 6456, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 16911, "y": 8812, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), (SELECT id FROM npc_types WHERE code = 'akrep-kralice'), '{"type": "circle", "x": 10868, "y": 5574, "r": 900}'::jsonb, 2, 300),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), (SELECT id FROM npc_types WHERE code = 'ana-orumcek'), '{"type": "circle", "x": 9025, "y": 9829, "r": 900}'::jsonb, 1, 300),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), (SELECT id FROM npc_types WHERE code = 'gece-yarasasi'), '{"type": "circle", "x": 9810, "y": 2956, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), (SELECT id FROM npc_types WHERE code = 'gece-yarasasi'), '{"type": "circle", "x": 3646, "y": 3416, "r": 1600}'::jsonb, 4, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 15677, "y": 6474, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), (SELECT id FROM npc_types WHERE code = 'ag-oren'), '{"type": "circle", "x": 3294, "y": 6056, "r": 1600}'::jsonb, 3, 60),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), (SELECT id FROM npc_types WHERE code = 'akrep-kralice'), '{"type": "circle", "x": 6213, "y": 5946, "r": 900}'::jsonb, 2, 300),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), (SELECT id FROM npc_types WHERE code = 'ana-orumcek'), '{"type": "circle", "x": 10616, "y": 3290, "r": 900}'::jsonb, 1, 300);
