-- =====================================================================================
-- TÜRK ORBIT — Migration 0007: Ekonomi (Aşama 11)
--
--  * Kaynaklar (eşya kategorisi 'resource', yığınlanabilir): Kuvarsit, Ferrolit, Titanyum Tozu (cevher),
--    Nebulit, Kristalyum (2. kademe), Kozmit (3. kademe), Yıldız Özü (4. kademe, satılamaz).
--  * Maden noktaları: Aşama 7'deki kaynak bölgelerinden (map_zones.zone_type = 'resource') üretilir.
--    Toplama oyun sunucusunda, gemi ambarı kapasitesiyle sınırlı.
--  * Rafineri ve üretim: tarifler + süreli üretim kuyruğu (girdiler başlatırken düşülür, çıktı süre sonunda alınır).
--  * Açık artırma: saatlik/günlük/haftalık sistem açık artırmaları; teklif emanete alınır, geçilen teklif iade edilir,
--    son saniye teklifi süreyi uzatır; kapanışta kazanan eşyayı alır.
--  * Günlük giriş ödülü: 7 günlük takvim, art arda giriş serisi (05:00 TSİ).
--  * Mağaza paketleri (birden çok eşya tek teklifte).
--  Tüm para/eşya hareketleri mevcut defterlere (currency_ledger, item_ledger) idempotent anahtarla yazılır.
-- =====================================================================================

-- ---------------------------------------------------------------- kaynak eşyaları
ALTER TABLE item_types DROP CONSTRAINT item_types_category_check;
ALTER TABLE item_types ADD CONSTRAINT item_types_category_check CHECK (category IN (
  'laser', 'ammo', 'rocket', 'rocket_launcher', 'shield_generator', 'speed_generator',
  'extra', 'drone', 'pet', 'pet_module', 'ship_design', 'resource'));
ALTER TABLE item_types DROP CONSTRAINT item_types_check;
ALTER TABLE item_types ADD CONSTRAINT item_types_stackable_check CHECK (NOT stackable OR category IN ('ammo', 'rocket', 'resource'));

INSERT INTO item_types (code, category, name, description, icon_key, rarity, stackable, stats, min_level, sell_price) VALUES
  ('res.kuvarsit',   'resource', 'Kuvarsit',      'Kaynak bölgelerinden toplanan temel cevher. Ferrolit ile birleşince Nebulit olur.',              'res-kuvarsit',   'common',    true, '{"tier": 1}', 1, 8),
  ('res.ferrolit',   'resource', 'Ferrolit',      'Demir yüklü temel cevher. Kuvarsit ile Nebulit, Titanyum Tozu ile Kristalyum olur.',            'res-ferrolit',   'common',    true, '{"tier": 1}', 1, 10),
  ('res.titanyum',   'resource', 'Titanyum Tozu', 'Toz bulutlarından toplanan hafif cevher. Ferrolit ile birleşince Kristalyum olur.',             'res-titanyum',   'common',    true, '{"tier": 1}', 1, 14),
  ('res.nebulit',    'resource', 'Nebulit',       'Rafineride işlenmiş ikinci kademe kaynak. Mühimmat ve Kozmit üretiminde kullanılır.',           'res-nebulit',    'uncommon',  true, '{"tier": 2}', 1, 260),
  ('res.kristalyum', 'resource', 'Kristalyum',    'Rafineride işlenmiş ikinci kademe kaynak. Kalkan emici mühimmat ve roket üretiminde kullanılır.', 'res-kristalyum', 'uncommon',  true, '{"tier": 2}', 1, 300),
  ('res.kozmit',     'resource', 'Kozmit',        'Nebulit ve Kristalyum''dan elde edilen üçüncü kademe kaynak.',                                   'res-kozmit',     'rare',      true, '{"tier": 3}', 1, 2400),
  ('res.yildiz-ozu', 'resource', 'Yıldız Özü',    'Kozmit''ten çıkarılan değerli öz. Satılamaz; en güçlü mühimmatın üretiminde kullanılır.',          'res-yildiz-ozu', 'legendary', true, '{"tier": 4}', 1, 0);

-- ---------------------------------------------------------------- maden noktaları
CREATE TABLE resource_nodes (
  id              serial PRIMARY KEY,
  map_id          integer NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  zone_id         integer REFERENCES map_zones(id) ON DELETE SET NULL,
  item_type_id    integer NOT NULL REFERENCES item_types(id),
  area            jsonb NOT NULL CHECK (area->>'type' = 'circle'),
  max_count       smallint NOT NULL CHECK (max_count BETWEEN 1 AND 100),
  respawn_seconds integer NOT NULL CHECK (respawn_seconds >= 1),
  yield_min       integer NOT NULL CHECK (yield_min > 0),
  yield_max       integer NOT NULL,
  is_enabled      boolean NOT NULL DEFAULT true,
  CHECK (yield_max >= yield_min)
);
CREATE INDEX resource_nodes_map_idx ON resource_nodes(map_id);

-- Her kaynak bölgesi bir maden noktası grubudur; cevher türü bölge adından, miktarlar harita türünden
INSERT INTO resource_nodes (map_id, zone_id, item_type_id, area, max_count, respawn_seconds, yield_min, yield_max)
SELECT z.map_id, z.id, it.id, z.shape,
       CASE m.map_type WHEN 'starter' THEN 6 WHEN 'company' THEN 8 WHEN 'border' THEN 10 ELSE 12 END,
       CASE m.map_type WHEN 'starter' THEN 60 WHEN 'company' THEN 75 WHEN 'border' THEN 90 ELSE 120 END,
       CASE m.map_type WHEN 'starter' THEN 3 WHEN 'company' THEN 4 WHEN 'border' THEN 6 ELSE 8 END,
       CASE m.map_type WHEN 'starter' THEN 6 WHEN 'company' THEN 8 WHEN 'border' THEN 12 ELSE 15 END
FROM map_zones z
JOIN maps m ON m.id = z.map_id
JOIN item_types it ON it.code = CASE WHEN z.name LIKE 'Kuvarsit%' THEN 'res.kuvarsit'
                                     WHEN z.name LIKE 'Ferrolit%' THEN 'res.ferrolit'
                                     ELSE 'res.titanyum' END
WHERE z.zone_type = 'resource';

-- ---------------------------------------------------------------- rafineri ve üretim
CREATE TABLE crafting_recipes (
  id                  serial PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  category            text NOT NULL CHECK (category IN ('refine', 'craft')),
  output_item_type_id integer NOT NULL REFERENCES item_types(id),
  output_quantity     integer NOT NULL CHECK (output_quantity > 0),
  -- [{"item": "res.kuvarsit", "qty": 10}, {"currency": "KREDI", "qty": 50}] (bir üretim adedi için)
  inputs              jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'array' AND jsonb_array_length(inputs) > 0),
  duration_seconds    integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  min_level           smallint NOT NULL DEFAULT 1 CHECK (min_level >= 1),
  sort_order          smallint NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE player_crafting_jobs (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id           uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recipe_id           integer NOT NULL REFERENCES crafting_recipes(id),
  batches             integer NOT NULL CHECK (batches BETWEEN 1 AND 100),
  -- Başlatma anındaki çıktı (tarif sonradan değişse de iş etkilenmez)
  output_item_type_id integer NOT NULL REFERENCES item_types(id),
  output_quantity     bigint NOT NULL CHECK (output_quantity > 0),
  status              text NOT NULL CHECK (status IN ('running', 'claimed')),
  started_at          timestamptz NOT NULL,
  ready_at            timestamptz NOT NULL,
  claimed_at          timestamptz,
  idempotency_key     text NOT NULL UNIQUE,
  CHECK (ready_at >= started_at),
  CHECK (status <> 'claimed' OR claimed_at IS NOT NULL)
);
CREATE INDEX player_crafting_jobs_player_idx ON player_crafting_jobs(player_id, status);

INSERT INTO crafting_recipes (code, name, category, output_item_type_id, output_quantity, inputs, duration_seconds, min_level, sort_order) VALUES
  ('nebulit',    'Nebulit',            'refine', (SELECT id FROM item_types WHERE code = 'res.nebulit'),     1,   '[{"item":"res.kuvarsit","qty":10},{"item":"res.ferrolit","qty":10},{"currency":"KREDI","qty":50}]', 30, 1, 1),
  ('kristalyum', 'Kristalyum',         'refine', (SELECT id FROM item_types WHERE code = 'res.kristalyum'),  1,   '[{"item":"res.ferrolit","qty":10},{"item":"res.titanyum","qty":10},{"currency":"KREDI","qty":60}]', 30, 1, 2),
  ('kozmit',     'Kozmit',             'refine', (SELECT id FROM item_types WHERE code = 'res.kozmit'),      1,   '[{"item":"res.nebulit","qty":4},{"item":"res.kristalyum","qty":4},{"currency":"KREDI","qty":500}]', 120, 5, 3),
  ('yildiz-ozu', 'Yıldız Özü',         'refine', (SELECT id FROM item_types WHERE code = 'res.yildiz-ozu'),  1,   '[{"item":"res.kozmit","qty":3},{"currency":"KREDI","qty":2000}]', 300, 10, 4),
  ('isk2',       'IŞK-2 Batarya ×200', 'craft',  (SELECT id FROM item_types WHERE code = 'ammo.isk2'),       200, '[{"item":"res.nebulit","qty":3},{"currency":"KREDI","qty":500}]', 90, 1, 10),
  ('isk3',       'IŞK-3 Batarya ×100', 'craft',  (SELECT id FROM item_types WHERE code = 'ammo.isk3'),       100, '[{"item":"res.kristalyum","qty":3},{"item":"res.nebulit","qty":2},{"currency":"KREDI","qty":1000}]', 180, 5, 11),
  ('isk4',       'IŞK-4 Batarya ×50',  'craft',  (SELECT id FROM item_types WHERE code = 'ammo.isk4'),       50,  '[{"item":"res.yildiz-ozu","qty":1},{"item":"res.kozmit","qty":2},{"currency":"KREDI","qty":5000}]', 300, 10, 12),
  ('se50',       'SE-50 ×100',         'craft',  (SELECT id FROM item_types WHERE code = 'ammo.se50'),       100, '[{"item":"res.kristalyum","qty":2},{"item":"res.kozmit","qty":1},{"currency":"KREDI","qty":2000}]', 240, 8, 13),
  ('yildirim',   'Yıldırım R-1 ×20',   'craft',  (SELECT id FROM item_types WHERE code = 'rocket.yildirim'), 20,  '[{"item":"res.ferrolit","qty":20},{"currency":"KREDI","qty":300}]', 30, 1, 14),
  ('simsek',     'Şimşek R-2 ×20',     'craft',  (SELECT id FROM item_types WHERE code = 'rocket.simsek'),   20,  '[{"item":"res.nebulit","qty":2},{"currency":"KREDI","qty":400}]', 60, 6, 15),
  ('buz',        'Buz-R ×10',          'craft',  (SELECT id FROM item_types WHERE code = 'rocket.buz'),      10,  '[{"item":"res.kristalyum","qty":2},{"item":"res.titanyum","qty":20},{"currency":"KREDI","qty":800}]', 120, 8, 16),
  ('tufan',      'Tufan R-3 ×10',      'craft',  (SELECT id FROM item_types WHERE code = 'rocket.tufan'),    10,  '[{"item":"res.kozmit","qty":1},{"item":"res.kristalyum","qty":2},{"currency":"KREDI","qty":1500}]', 180, 10, 17);

-- ---------------------------------------------------------------- açık artırma
CREATE TABLE auction_lots (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  auction_type  text NOT NULL CHECK (auction_type IN ('hourly', 'daily', 'weekly')),
  item_type_id  integer NOT NULL REFERENCES item_types(id),
  quantity      bigint NOT NULL CHECK (quantity > 0),
  currency_code text NOT NULL REFERENCES currencies(code),
  min_bid       bigint NOT NULL CHECK (min_bid > 0),
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    smallint NOT NULL DEFAULT 0
);

CREATE TABLE auctions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id      smallint NOT NULL REFERENCES game_servers(id),
  lot_id         integer NOT NULL REFERENCES auction_lots(id),
  -- saatlik: '2026-11-28T14' (UTC saat) · günlük: '2026-11-28' · haftalık: '2026-W48' (05:00 TSİ)
  period_key     text NOT NULL,
  auction_type   text NOT NULL CHECK (auction_type IN ('hourly', 'daily', 'weekly')),
  item_type_id   integer NOT NULL REFERENCES item_types(id),
  quantity       bigint NOT NULL CHECK (quantity > 0),
  currency_code  text NOT NULL REFERENCES currencies(code),
  min_bid        bigint NOT NULL CHECK (min_bid > 0),
  current_bid    bigint CHECK (current_bid > 0),
  current_bidder uuid REFERENCES players(id) ON DELETE SET NULL,
  bid_count      integer NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'cancelled')),
  winner_id      uuid REFERENCES players(id) ON DELETE SET NULL,
  settled_at     timestamptz,
  UNIQUE (server_id, lot_id, period_key),
  CHECK (ends_at > starts_at),
  CHECK (current_bid IS NULL OR current_bid >= min_bid)
);
CREATE INDEX auctions_open_idx ON auctions(status, ends_at);

CREATE TABLE auction_bids (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_id      bigint NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  amount          bigint NOT NULL CHECK (amount > 0),
  refunded        boolean NOT NULL DEFAULT false,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auction_bids_auction_idx ON auction_bids(auction_id, id DESC);
CREATE INDEX auction_bids_player_idx ON auction_bids(player_id, created_at DESC);

INSERT INTO auction_lots (code, auction_type, item_type_id, quantity, currency_code, min_bid, sort_order) VALUES
  ('saatlik-isk2',    'hourly', (SELECT id FROM item_types WHERE code = 'ammo.isk2'),            1000, 'KREDI', 20000,  1),
  ('saatlik-simsek',  'hourly', (SELECT id FROM item_types WHERE code = 'rocket.simsek'),        50,   'KREDI', 8000,   2),
  ('saatlik-nebulit', 'hourly', (SELECT id FROM item_types WHERE code = 'res.nebulit'),          10,   'KREDI', 4000,   3),
  ('gunluk-ok3',      'daily',  (SELECT id FROM item_types WHERE code = 'laser.ok3'),            1,    'KREDI', 60000,  10),
  ('gunluk-siper3',   'daily',  (SELECT id FROM item_types WHERE code = 'shield.siper3'),        1,    'KREDI', 50000,  11),
  ('gunluk-kozmit',   'daily',  (SELECT id FROM item_types WHERE code = 'res.kozmit'),           5,    'KREDI', 15000,  12),
  ('haftalik-ok4',    'weekly', (SELECT id FROM item_types WHERE code = 'laser.ok4'),            1,    'KREDI', 500000, 20),
  ('haftalik-atmaca', 'weekly', (SELECT id FROM item_types WHERE code = 'design.atmaca-bozkir'), 1,    'KREDI', 300000, 21),
  ('haftalik-yaban',  'weekly', (SELECT id FROM item_types WHERE code = 'drone.yaban'),          1,    'KREDI', 800000, 22);

-- ---------------------------------------------------------------- günlük giriş ödülü
CREATE TABLE daily_login_rewards (
  day_number      smallint PRIMARY KEY CHECK (day_number BETWEEN 1 AND 28),
  reward_table_id integer NOT NULL REFERENCES reward_tables(id)
);
CREATE TABLE player_daily_logins (
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- 05:00 TSİ'de başlayan oyun günü
  cycle_date date NOT NULL,
  streak     smallint NOT NULL CHECK (streak >= 1),
  day_number smallint NOT NULL CHECK (day_number >= 1),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, cycle_date)
);

INSERT INTO reward_tables (code, name) VALUES
  ('daily.1', 'Günlük ödül: 1. gün'), ('daily.2', 'Günlük ödül: 2. gün'), ('daily.3', 'Günlük ödül: 3. gün'), ('daily.4', 'Günlük ödül: 4. gün'),
  ('daily.5', 'Günlük ödül: 5. gün'), ('daily.6', 'Günlük ödül: 6. gün'), ('daily.7', 'Günlük ödül: 7. gün');
INSERT INTO reward_entries (reward_table_id, reward_type, ref_code, min_amount, max_amount, chance, delivery) VALUES
  ((SELECT id FROM reward_tables WHERE code = 'daily.1'), 'currency', 'KREDI',           2000,  2000,  1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'daily.2'), 'item',     'ammo.isk1',       500,   500,   1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'daily.3'), 'currency', 'KREDI',           5000,  5000,  1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'daily.4'), 'item',     'rocket.yildirim', 30,    30,    1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'daily.5'), 'currency', 'KREDI',           10000, 10000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'daily.5'), 'item',     'res.titanyum',    20,    20,    1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'daily.6'), 'item',     'ammo.isk2',       300,   300,   1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'daily.7'), 'currency', 'AKCE',            25,    25,    1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'daily.7'), 'item',     'res.nebulit',     2,     2,     1, 'direct');
INSERT INTO daily_login_rewards (day_number, reward_table_id)
SELECT d, (SELECT id FROM reward_tables WHERE code = 'daily.' || d) FROM generate_series(1, 7) AS d;

-- ---------------------------------------------------------------- mağaza paketleri
ALTER TABLE shop_offers ADD COLUMN title text, ADD COLUMN description text, ADD COLUMN bundle_items jsonb;
ALTER TABLE shop_offers DROP CONSTRAINT shop_offers_offer_type_check, DROP CONSTRAINT shop_offers_check;
ALTER TABLE shop_offers ADD CONSTRAINT shop_offers_offer_type_check CHECK (offer_type IN ('item', 'ship', 'bundle'));
ALTER TABLE shop_offers ADD CONSTRAINT shop_offers_target_check CHECK (
     (offer_type = 'item' AND item_type_id IS NOT NULL AND ship_type_id IS NULL AND bundle_items IS NULL)
  OR (offer_type = 'ship' AND ship_type_id IS NOT NULL AND item_type_id IS NULL AND bundle_items IS NULL)
  OR (offer_type = 'bundle' AND item_type_id IS NULL AND ship_type_id IS NULL AND title IS NOT NULL
      AND jsonb_typeof(bundle_items) = 'array' AND jsonb_array_length(bundle_items) > 0));

INSERT INTO shop_categories (code, name, sort_order) VALUES ('paketler', 'Paketler', 0);
INSERT INTO shop_offers (category_id, offer_type, quantity, currency_code, price, discount_percent, max_per_purchase, per_player_limit, title, description, bundle_items, sort_order) VALUES
  ((SELECT id FROM shop_categories WHERE code = 'paketler'), 'bundle', 1, 'AKCE', 500, 40, 1, 1,
   'Acemi Pilot Paketi', 'İlk seferin için mühimmat, roket ve kargo genişletici. Hesap başına bir kez.',
   '[{"item":"ammo.isk1","qty":3000},{"item":"ammo.isk2","qty":500},{"item":"rocket.yildirim","qty":50},{"item":"extra.kargo","qty":1}]', 1),
  ((SELECT id FROM shop_categories WHERE code = 'paketler'), 'bundle', 1, 'KREDI', 45000, 0, 1, NULL,
   'Madenci Paketi', 'Kargo genişletici ve rafineriye hızlı başlangıç için ikinci kademe kaynaklar.',
   '[{"item":"extra.kargo","qty":1},{"item":"res.nebulit","qty":4},{"item":"res.kristalyum","qty":4}]', 2),
  ((SELECT id FROM shop_categories WHERE code = 'paketler'), 'bundle', 1, 'AKCE', 600, 0, 5, NULL,
   'Avcı Paketi', 'Sınır kuşağı için ağır mühimmat ve Şimşek roketleri.',
   '[{"item":"ammo.isk2","qty":1000},{"item":"ammo.isk3","qty":300},{"item":"rocket.simsek","qty":30}]', 3);

-- ---------------------------------------------------------------- görevler: madencilik ve üretim hedefleri
ALTER TABLE quest_objectives DROP CONSTRAINT quest_objectives_objective_type_check;
ALTER TABLE quest_objectives ADD CONSTRAINT quest_objectives_objective_type_check CHECK (objective_type IN (
  'kill_npc', 'kill_player', 'collect_cargo', 'visit_map', 'deal_damage', 'travel_distance',
  'fire_rockets', 'jump_portal', 'upgrade_item', 'buy_item', 'reach_level', 'collect_resource', 'craft_item'));

-- ---------------------------------------------------------------- ayarlar
INSERT INTO game_settings (key, value) VALUES
  ('crafting', '{"slots": 3, "max_batches": 50}'::jsonb),
  ('auction', '{"min_increment_pct": 5, "min_increment": 100, "snipe_window_seconds": 60, "extend_seconds": 60}'::jsonb),
  ('mining', '{"pickup_radius": 90}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Üretildi: gen_economy_quests.py · 18 görev
INSERT INTO reward_tables (code, name) VALUES
  ('quest.altayin-mirasi-01', 'Görev: İlk Cevher'),
  ('quest.altayin-mirasi-02', 'Görev: Dolu Ambar'),
  ('quest.altayin-mirasi-03', 'Görev: Usta Madenci'),
  ('quest.altayin-mirasi-04', 'Görev: İki Cevher'),
  ('quest.altayin-mirasi-05', 'Görev: Rafineri'),
  ('quest.altayin-mirasi-06', 'Görev: Kristal İşçiliği'),
  ('quest.altayin-mirasi-07', 'Görev: Kozmit'),
  ('quest.altayin-mirasi-08', 'Görev: Yıldız Özü'),
  ('quest.gunluk-m01', 'Görev: Maden Turu'),
  ('quest.gunluk-m02', 'Görev: Ambar Dolusu'),
  ('quest.gunluk-m03', 'Görev: Rafineri Mesaisi'),
  ('quest.gunluk-m04', 'Görev: Cevher Avı'),
  ('quest.gunluk-m05', 'Görev: Sınır Madenciliği'),
  ('quest.gunluk-m06', 'Görev: Çekirdek Madenciliği'),
  ('quest.haftalik-m01', 'Görev: Haftalık Madencilik'),
  ('quest.haftalik-m02', 'Görev: Usta Rafineri'),
  ('quest.haftalik-m03', 'Görev: Kozmit Haftası'),
  ('quest.haftalik-m04', 'Görev: Yıldız Özü Haftası');
INSERT INTO reward_entries (reward_table_id, reward_type, ref_code, min_amount, max_amount, chance, delivery) VALUES
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-01'), 'experience', 'XP', 1500, 1500, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-01'), 'currency', 'KREDI', 2000, 2000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-02'), 'experience', 'XP', 4000, 4000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-02'), 'currency', 'KREDI', 5000, 5000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-03'), 'experience', 'XP', 12000, 12000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-03'), 'currency', 'KREDI', 15000, 15000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-03'), 'currency', 'AKCE', 5, 5, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-04'), 'experience', 'XP', 20000, 20000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-04'), 'currency', 'KREDI', 18000, 18000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-05'), 'experience', 'XP', 15000, 15000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-05'), 'currency', 'KREDI', 12000, 12000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-06'), 'experience', 'XP', 15000, 15000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-06'), 'currency', 'KREDI', 12000, 12000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-07'), 'experience', 'XP', 40000, 40000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-07'), 'currency', 'KREDI', 30000, 30000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-07'), 'currency', 'AKCE', 20, 20, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-08'), 'experience', 'XP', 120000, 120000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-08'), 'currency', 'KREDI', 80000, 80000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-08'), 'currency', 'AKCE', 100, 100, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m01'), 'experience', 'XP', 2500, 2500, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m01'), 'currency', 'KREDI', 2000, 2000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m02'), 'experience', 'XP', 3500, 3500, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m02'), 'currency', 'KREDI', 3000, 3000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m03'), 'experience', 'XP', 9000, 9000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m03'), 'currency', 'KREDI', 8000, 8000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m04'), 'experience', 'XP', 12000, 12000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m04'), 'currency', 'KREDI', 10000, 10000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m05'), 'experience', 'XP', 30000, 30000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m05'), 'currency', 'KREDI', 25000, 25000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m06'), 'experience', 'XP', 60000, 60000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m06'), 'currency', 'KREDI', 50000, 50000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m01'), 'experience', 'XP', 25000, 25000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m01'), 'currency', 'KREDI', 25000, 25000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m01'), 'currency', 'AKCE', 10, 10, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m02'), 'experience', 'XP', 60000, 60000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m02'), 'currency', 'KREDI', 50000, 50000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m02'), 'currency', 'AKCE', 20, 20, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m03'), 'experience', 'XP', 150000, 150000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m03'), 'currency', 'KREDI', 120000, 120000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m03'), 'currency', 'AKCE', 30, 30, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m04'), 'experience', 'XP', 400000, 400000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m04'), 'currency', 'KREDI', 300000, 300000, 1, 'direct'),
  ((SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m04'), 'currency', 'AKCE', 50, 50, 1, 'direct');
INSERT INTO quests (code, category, title, description, min_level, max_level, chain_code, chain_order, reward_table_id, sort_order) VALUES
  ('altayin-mirasi-01', 'main', 'İlk Cevher', 'Kaynak bölgelerindeki cevher kümelerine yaklaş ve topla. Ambarın gemine göre sınırlıdır.', 1, NULL, 'altayin-mirasi', 1, (SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-01'), 1001),
  ('altayin-mirasi-02', 'main', 'Dolu Ambar', 'Pazarda satmak veya rafineride işlemek için kaynak biriktir.', 1, NULL, 'altayin-mirasi', 2, (SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-02'), 1002),
  ('altayin-mirasi-03', 'main', 'Usta Madenci', 'Kaynak toplamayı alışkanlık haline getir.', 3, NULL, 'altayin-mirasi', 3, (SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-03'), 1003),
  ('altayin-mirasi-04', 'main', 'İki Cevher', 'Nebulit için gereken Kuvarsit ve Ferrolit''i topla.', 5, NULL, 'altayin-mirasi', 4, (SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-04'), 1004),
  ('altayin-mirasi-05', 'main', 'Rafineri', 'Pazar > Üretim bölümünde Nebulit üret.', 5, NULL, 'altayin-mirasi', 5, (SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-05'), 1005),
  ('altayin-mirasi-06', 'main', 'Kristal İşçiliği', 'Ferrolit ve Titanyum Tozu''ndan Kristalyum üret.', 5, NULL, 'altayin-mirasi', 6, (SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-06'), 1006),
  ('altayin-mirasi-07', 'main', 'Kozmit', 'Nebulit ile Kristalyum''u birleştirip Kozmit üret.', 6, NULL, 'altayin-mirasi', 7, (SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-07'), 1007),
  ('altayin-mirasi-08', 'main', 'Yıldız Özü', 'Kozmit''ten satılamayan değerli Yıldız Özü''nü çıkar. Altay''ın mirası artık senin.', 10, NULL, 'altayin-mirasi', 8, (SELECT id FROM reward_tables WHERE code = 'quest.altayin-mirasi-08'), 1008),
  ('gunluk-m01', 'daily', 'Maden Turu', 'Kaynak topla.', 1, 6, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m01'), 1009),
  ('gunluk-m02', 'daily', 'Ambar Dolusu', 'Ambarını kaynakla doldur.', 1, 6, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m02'), 1010),
  ('gunluk-m03', 'daily', 'Rafineri Mesaisi', 'Rafineride veya atölyede üretim tamamla.', 5, 50, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m03'), 1011),
  ('gunluk-m04', 'daily', 'Cevher Avı', 'Kaynak topla.', 5, 10, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m04'), 1012),
  ('gunluk-m05', 'daily', 'Sınır Madenciliği', 'Sınır haritalarında kaynak topla.', 8, 50, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m05'), 1013),
  ('gunluk-m06', 'daily', 'Çekirdek Madenciliği', 'Çekirdek haritalarında kaynak topla.', 12, 50, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.gunluk-m06'), 1014),
  ('haftalik-m01', 'weekly', 'Haftalık Madencilik', 'Kaynak topla.', 1, 50, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m01'), 1015),
  ('haftalik-m02', 'weekly', 'Usta Rafineri', 'Rafineride veya atölyede 10 üretim tamamla.', 5, 50, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m02'), 1016),
  ('haftalik-m03', 'weekly', 'Kozmit Haftası', 'Kozmit üret.', 8, 50, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m03'), 1017),
  ('haftalik-m04', 'weekly', 'Yıldız Özü Haftası', 'Yıldız Özü üret.', 12, 50, NULL, NULL, (SELECT id FROM reward_tables WHERE code = 'quest.haftalik-m04'), 1018);
UPDATE quests SET prerequisite_quest_id = (SELECT id FROM quests WHERE code = 'altayin-mirasi-01') WHERE code = 'altayin-mirasi-02';
UPDATE quests SET prerequisite_quest_id = (SELECT id FROM quests WHERE code = 'altayin-mirasi-02') WHERE code = 'altayin-mirasi-03';
UPDATE quests SET prerequisite_quest_id = (SELECT id FROM quests WHERE code = 'altayin-mirasi-03') WHERE code = 'altayin-mirasi-04';
UPDATE quests SET prerequisite_quest_id = (SELECT id FROM quests WHERE code = 'altayin-mirasi-04') WHERE code = 'altayin-mirasi-05';
UPDATE quests SET prerequisite_quest_id = (SELECT id FROM quests WHERE code = 'altayin-mirasi-05') WHERE code = 'altayin-mirasi-06';
UPDATE quests SET prerequisite_quest_id = (SELECT id FROM quests WHERE code = 'altayin-mirasi-06') WHERE code = 'altayin-mirasi-07';
UPDATE quests SET prerequisite_quest_id = (SELECT id FROM quests WHERE code = 'altayin-mirasi-07') WHERE code = 'altayin-mirasi-08';
INSERT INTO quest_objectives (quest_id, sort_order, objective_type, params, target, label) VALUES
  ((SELECT id FROM quests WHERE code = 'altayin-mirasi-01'), 1, 'collect_resource', '{}'::jsonb, 10, 'Kaynak topla'),
  ((SELECT id FROM quests WHERE code = 'altayin-mirasi-02'), 1, 'collect_resource', '{}'::jsonb, 50, 'Kaynak topla'),
  ((SELECT id FROM quests WHERE code = 'altayin-mirasi-03'), 1, 'collect_resource', '{}'::jsonb, 150, 'Kaynak topla'),
  ((SELECT id FROM quests WHERE code = 'altayin-mirasi-04'), 1, 'collect_resource', '{"resource": ["res.kuvarsit"]}'::jsonb, 30, 'Kuvarsit topla'),
  ((SELECT id FROM quests WHERE code = 'altayin-mirasi-04'), 2, 'collect_resource', '{"resource": ["res.ferrolit"]}'::jsonb, 30, 'Ferrolit topla'),
  ((SELECT id FROM quests WHERE code = 'altayin-mirasi-05'), 1, 'craft_item', '{"item": ["res.nebulit"]}'::jsonb, 2, 'Nebulit üret'),
  ((SELECT id FROM quests WHERE code = 'altayin-mirasi-06'), 1, 'craft_item', '{"item": ["res.kristalyum"]}'::jsonb, 2, 'Kristalyum üret'),
  ((SELECT id FROM quests WHERE code = 'altayin-mirasi-07'), 1, 'craft_item', '{"item": ["res.kozmit"]}'::jsonb, 1, 'Kozmit üret'),
  ((SELECT id FROM quests WHERE code = 'altayin-mirasi-08'), 1, 'craft_item', '{"item": ["res.yildiz-ozu"]}'::jsonb, 1, 'Yıldız Özü üret'),
  ((SELECT id FROM quests WHERE code = 'gunluk-m01'), 1, 'collect_resource', '{}'::jsonb, 40, 'Kaynak topla'),
  ((SELECT id FROM quests WHERE code = 'gunluk-m02'), 1, 'collect_resource', '{}'::jsonb, 60, 'Kaynak topla'),
  ((SELECT id FROM quests WHERE code = 'gunluk-m03'), 1, 'craft_item', '{}'::jsonb, 2, 'Üretim tamamla (adet)'),
  ((SELECT id FROM quests WHERE code = 'gunluk-m04'), 1, 'collect_resource', '{}'::jsonb, 120, 'Kaynak topla'),
  ((SELECT id FROM quests WHERE code = 'gunluk-m05'), 1, 'collect_resource', '{"map_types": ["border"]}'::jsonb, 150, 'Kaynak topla (sınır haritaları)'),
  ((SELECT id FROM quests WHERE code = 'gunluk-m06'), 1, 'collect_resource', '{"map_types": ["core"]}'::jsonb, 150, 'Kaynak topla (Çekirdek haritaları)'),
  ((SELECT id FROM quests WHERE code = 'haftalik-m01'), 1, 'collect_resource', '{}'::jsonb, 300, 'Kaynak topla'),
  ((SELECT id FROM quests WHERE code = 'haftalik-m02'), 1, 'craft_item', '{}'::jsonb, 10, 'Üretim tamamla (adet)'),
  ((SELECT id FROM quests WHERE code = 'haftalik-m03'), 1, 'craft_item', '{"item": ["res.kozmit"]}'::jsonb, 3, 'Kozmit üret'),
  ((SELECT id FROM quests WHERE code = 'haftalik-m04'), 1, 'craft_item', '{"item": ["res.yildiz-ozu"]}'::jsonb, 2, 'Yıldız Özü üret');
