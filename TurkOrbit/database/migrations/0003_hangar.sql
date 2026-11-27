-- =====================================================================================
-- TÜRK ORBIT — Migration 0003: Hangar ve ekipman (Aşama 6)
-- Eşya kataloğu, yükseltme tablosu, envanter, eşya defteri, iki ekipman konfigürasyonu,
-- PET ve modülleri, gemi tasarımları, mağaza; 9 yeni gemi ve özgün ekipman tohumu.
--
-- Kurallar:
--  * Eşya istatistikleri (stats jsonb) kategoriye göre sunucuda doğrulanır
--    (packages/shared/src/items.ts → ITEM_STATS_SCHEMAS). Admin düzenlemesi de aynı doğrulamadan geçecek.
--  * Tüm eşya hareketleri item_ledger'a yazılır; para hareketleri currency_ledger'a (0002).
--  * Hangar işlemleri oyuncu satırı kilitlenerek (FOR UPDATE) sıraya sokulur.
-- =====================================================================================

-- ---------------------------------------------------------------- Eşya kataloğu
CREATE TABLE item_types (
  id                serial PRIMARY KEY,
  code              text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_.-]+$'),
  category          text NOT NULL CHECK (category IN (
                      'laser', 'ammo', 'rocket', 'rocket_launcher', 'shield_generator', 'speed_generator',
                      'extra', 'drone', 'pet', 'pet_module', 'ship_design')),
  name              text NOT NULL,
  description       text NOT NULL,
  icon_key          text NOT NULL,
  rarity            text NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  stackable         boolean NOT NULL DEFAULT false,
  stats             jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_upgrade_level smallint NOT NULL DEFAULT 0 CHECK (max_upgrade_level BETWEEN 0 AND 20),
  min_level         smallint NOT NULL DEFAULT 1 CHECK (min_level >= 1),
  -- ship_design için: {"ship": "<ship_types.code>"}
  requirements      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Oyuncunun eşyayı geri satarken alacağı Kredi (birim başına). 0 = satılamaz.
  sell_price        bigint NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT stackable OR category IN ('ammo', 'rocket'))
);
CREATE TRIGGER item_types_set_updated_at BEFORE UPDATE ON item_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Kategori bazlı yükseltme tablosu (seviye L: istatistik × (1 + stat_bonus))
CREATE TABLE upgrade_levels (
  category       text NOT NULL CHECK (category IN ('laser', 'shield_generator', 'speed_generator', 'drone')),
  level          smallint NOT NULL CHECK (level BETWEEN 1 AND 20),
  stat_bonus     numeric(5,3) NOT NULL CHECK (stat_bonus > 0),
  success_chance numeric(4,3) NOT NULL CHECK (success_chance > 0 AND success_chance <= 1),
  cost_currency  text NOT NULL REFERENCES currencies(code),
  cost_amount    bigint NOT NULL CHECK (cost_amount > 0),
  PRIMARY KEY (category, level)
);

-- ---------------------------------------------------------------- Envanter ve eşya defteri
CREATE TABLE player_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_type_id  integer NOT NULL REFERENCES item_types(id),
  -- Yığın (mermi/roket) satırı mı? Kısmi benzersiz dizin için eşya türünden kopyalanır.
  is_stack      boolean NOT NULL,
  quantity      bigint NOT NULL DEFAULT 1 CHECK (quantity > 0),
  upgrade_level smallint NOT NULL DEFAULT 0 CHECK (upgrade_level >= 0),
  bound         boolean NOT NULL DEFAULT false,
  source        text NOT NULL,
  acquired_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (is_stack OR quantity = 1),
  CHECK (NOT is_stack OR upgrade_level = 0)
);
CREATE INDEX player_items_player_idx ON player_items(player_id, item_type_id);
-- Yığınlanabilir eşyalar oyuncu başına tek satırdır
CREATE UNIQUE INDEX player_items_one_stack ON player_items(player_id, item_type_id) WHERE is_stack;
CREATE TRIGGER player_items_set_updated_at BEFORE UPDATE ON player_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE item_ledger (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_type_id    integer NOT NULL REFERENCES item_types(id),
  player_item_id  uuid,                         -- eşya satılınca silinebileceği için FK yok
  delta           bigint NOT NULL CHECK (delta <> 0),
  reason          text NOT NULL,                -- starter_kit, shop_purchase, item_sell, admin_grant ...
  ref_type        text,
  ref_id          text,
  idempotency_key text UNIQUE,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_ledger_player_idx ON item_ledger(player_id, created_at DESC, id DESC);
CREATE TRIGGER item_ledger_immutable BEFORE UPDATE ON item_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();

-- Yükseltme denemeleri (sunucu tarafı rastgelelik denetlenebilir olsun diye zar sonucu da saklanır)
CREATE TABLE item_upgrade_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_item_id  uuid NOT NULL,
  item_type_id    integer NOT NULL REFERENCES item_types(id),
  from_level      smallint NOT NULL,
  to_level        smallint NOT NULL,
  success         boolean NOT NULL,
  chance          numeric(4,3) NOT NULL,
  roll            integer NOT NULL,             -- 0..999999
  cost_currency   text NOT NULL,
  cost_amount     bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Gemiler: tasarım ve iki konfigürasyon
ALTER TABLE players ADD COLUMN active_loadout smallint NOT NULL DEFAULT 1 CHECK (active_loadout IN (1, 2));
ALTER TABLE player_ships ADD COLUMN design_item_id uuid UNIQUE REFERENCES player_items(id) ON DELETE SET NULL;

CREATE TABLE loadout_slots (
  player_ship_id uuid NOT NULL REFERENCES player_ships(id) ON DELETE CASCADE,
  loadout        smallint NOT NULL CHECK (loadout IN (1, 2)),
  slot_type      text NOT NULL CHECK (slot_type IN ('laser', 'generator', 'extra', 'drone', 'drone_gear')),
  slot_index     smallint NOT NULL CHECK (slot_index >= 0),
  player_item_id uuid NOT NULL REFERENCES player_items(id) ON DELETE CASCADE,
  PRIMARY KEY (player_ship_id, loadout, slot_type, slot_index)
);
-- Bir eşya aynı konfigürasyonda yalnızca bir slotta olabilir (iki konfigürasyonda ortak kullanılabilir)
CREATE UNIQUE INDEX loadout_slots_item_once ON loadout_slots(player_ship_id, loadout, player_item_id);
CREATE INDEX loadout_slots_item_idx ON loadout_slots(player_item_id);

-- ---------------------------------------------------------------- PET
CREATE TABLE player_pets (
  player_id      uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  player_item_id uuid NOT NULL UNIQUE REFERENCES player_items(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 20),
  level          smallint NOT NULL DEFAULT 1,
  experience     bigint NOT NULL DEFAULT 0,
  fuel           integer NOT NULL DEFAULT 0 CHECK (fuel >= 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player_pet_modules (
  player_id      uuid NOT NULL REFERENCES player_pets(player_id) ON DELETE CASCADE,
  slot_index     smallint NOT NULL CHECK (slot_index >= 0),
  player_item_id uuid NOT NULL UNIQUE REFERENCES player_items(id) ON DELETE CASCADE,
  PRIMARY KEY (player_id, slot_index)
);

-- ---------------------------------------------------------------- Mağaza
CREATE TABLE shop_categories (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true
);

CREATE TABLE shop_offers (
  id               serial PRIMARY KEY,
  category_id      integer NOT NULL REFERENCES shop_categories(id),
  offer_type       text NOT NULL CHECK (offer_type IN ('item', 'ship')),
  item_type_id     integer REFERENCES item_types(id),
  ship_type_id     integer REFERENCES ship_types(id),
  quantity         bigint NOT NULL DEFAULT 1 CHECK (quantity > 0),       -- paket başına adet
  currency_code    text NOT NULL REFERENCES currencies(code),
  price            bigint NOT NULL CHECK (price >= 0),                   -- paket fiyatı
  discount_percent smallint NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90),
  discount_ends_at timestamptz,
  max_per_purchase integer NOT NULL DEFAULT 1 CHECK (max_per_purchase BETWEEN 1 AND 1000),
  per_player_limit integer CHECK (per_player_limit > 0),
  starts_at        timestamptz,
  ends_at          timestamptz,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       smallint NOT NULL DEFAULT 0,
  CHECK ((offer_type = 'item' AND item_type_id IS NOT NULL AND ship_type_id IS NULL)
      OR (offer_type = 'ship' AND ship_type_id IS NOT NULL AND item_type_id IS NULL))
);
CREATE INDEX shop_offers_category_idx ON shop_offers(category_id, sort_order);

CREATE TABLE shop_purchases (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  offer_id        integer NOT NULL REFERENCES shop_offers(id),
  packs           integer NOT NULL CHECK (packs > 0),
  unit_price      bigint NOT NULL,
  total_price     bigint NOT NULL,
  currency_code   text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_purchases_player_offer_idx ON shop_purchases(player_id, offer_id);

-- =====================================================================================
-- TOHUM VERİSİ (Türk Orbit'e özgü adlar ve değerler; Yönetim Merkezi'nden ayarlanacak)
-- =====================================================================================

-- ---------------------------------------------------------------- 9 yeni gemi (Kırlangıç 0002'de)
INSERT INTO ship_types (code, name, description, ship_class, sprite_key, hitpoints, base_speed, cargo_capacity,
                        laser_slots, generator_slots, extra_slots, drone_slots, min_level, is_for_sale) VALUES
  ('dogan',  'Doğan',  'Hızlı ve hafif avcı. Yeni pilotların ilk gerçek savaş gemisi.',                 'light',     'ship-dogan',  16000,  380, 300,  3,  3,  1, 1, 3,  true),
  ('atmaca', 'Atmaca', 'Öne süpürülmüş kanatlarıyla çevik, dengeli bir avcı.',                          'fighter',   'ship-atmaca', 64000,  340, 600,  6,  6,  2, 2, 6,  true),
  ('sahin',  'Şahin',  'Çift delta kanatlı, her işe uygun çok yönlü gemi.',                             'multirole', 'ship-sahin',  120000, 320, 1000, 10, 10, 3, 3, 10, true),
  ('tulpar', 'Tulpar', 'Kanatlı efsanevi attan adını alan, galaksinin en hızlı keşif gemisi.',          'scout',     'ship-tulpar', 90000,  420, 800,  8,  12, 3, 2, 12, true),
  ('kartal', 'Kartal', 'Geniş kanatlı ağır avcı; yüksek lazer kapasitesiyle cephe hattının gücü.',      'heavy',     'ship-kartal', 200000, 300, 1500, 15, 12, 3, 4, 15, true),
  ('umay',   'Umay',   'Koruyucu halkasıyla grubunu kollayan destek gemisi.',                           'support',   'ship-umay',   220000, 300, 1200, 12, 15, 4, 4, 15, true),
  ('kale',   'Kale',   'Kalın zırhlı, en yüksek dayanıklılığa sahip tank gemisi.',                      'tank',      'ship-kale',   300000, 270, 2000, 13, 18, 3, 4, 18, true),
  ('akinci', 'Akıncı', 'Roket ve hasar odaklı, akın düzeninde saldırı gemisi.',                         'assault',   'ship-akinci', 250000, 300, 1500, 16, 14, 4, 5, 20, true),
  ('boru',   'Börü',   'Bozkurdun pençesi: uç seviye amiral gemisi.',                                   'elite',     'ship-boru',   320000, 300, 2500, 16, 16, 4, 6, 25, true);

-- ---------------------------------------------------------------- Ekipman
INSERT INTO item_types (code, category, name, description, icon_key, rarity, stackable, stats, max_upgrade_level, min_level, requirements, sell_price) VALUES
  -- Lazer topları (OK = Odaklı Kiriş)
  ('laser.ok1', 'laser', 'OK-1 Lazer Topu', 'Temel odaklı kiriş topu.', 'laser', 'common', false, '{"damage": 40, "rateMs": 1000, "range": 600}', 10, 1, '{}', 2500),
  ('laser.ok2', 'laser', 'OK-2 Lazer Topu', 'Geliştirilmiş kiriş odaklayıcı.', 'laser', 'uncommon', false, '{"damage": 60, "rateMs": 1000, "range": 620}', 10, 4, '{}', 10000),
  ('laser.ok3', 'laser', 'OK-3 Lazer Topu', 'Yüksek enerjili askerî lazer.', 'laser', 'rare', false, '{"damage": 100, "rateMs": 1000, "range": 640}', 10, 8, '{}', 37500),
  ('laser.ok4', 'laser', 'OK-4 Lazer Topu', 'Çekirdek teknolojisiyle üretilmiş elit lazer.', 'laser', 'epic', false, '{"damage": 150, "rateMs": 1000, "range": 650}', 10, 12, '{}', 60000),
  -- Lazer mermileri (IŞK)
  ('ammo.isk1', 'ammo', 'IŞK-1 Batarya', 'Standart lazer bataryası (×1 hasar).', 'ammo', 'common', true, '{"multiplier": 1}', 0, 1, '{}', 1),
  ('ammo.isk2', 'ammo', 'IŞK-2 Batarya', 'Çift yoğunluklu batarya (×2 hasar).', 'ammo', 'uncommon', true, '{"multiplier": 2}', 0, 1, '{}', 2),
  ('ammo.isk3', 'ammo', 'IŞK-3 Batarya', 'Üç kat yoğunluklu batarya (×3 hasar).', 'ammo', 'rare', true, '{"multiplier": 3}', 0, 5, '{}', 4),
  ('ammo.isk4', 'ammo', 'IŞK-4 Batarya', 'Nadir dört kat yoğunluklu batarya (×4 hasar). Yalnızca kapılardan ve etkinliklerden.', 'ammo', 'epic', true, '{"multiplier": 4}', 0, 10, '{}', 0),
  ('ammo.se50', 'ammo', 'SE-50 Kalkan Emici', 'Verdiği hasarın bir kısmını kalkana aktarır (×2 hasar).', 'ammo', 'rare', true, '{"multiplier": 2, "shieldLeech": 0.25}', 0, 8, '{}', 3),
  -- Roketler ve roket atar
  ('rocket.yildirim', 'rocket', 'Yıldırım R-1', 'Temel güdümlü roket.', 'rocket', 'common', true, '{"damage": 1000, "cooldownMs": 2000, "range": 700}', 0, 1, '{}', 10),
  ('rocket.simsek', 'rocket', 'Şimşek R-2', 'Ağır savaş başlıklı roket.', 'rocket', 'uncommon', true, '{"damage": 2000, "cooldownMs": 2000, "range": 700}', 0, 6, '{}', 25),
  ('rocket.tufan', 'rocket', 'Tufan R-3', 'Alan hasarı veren parçalı roket.', 'rocket', 'rare', true, '{"damage": 1500, "cooldownMs": 3000, "range": 650, "aoeRadius": 200}', 0, 10, '{}', 40),
  ('rocket.buz', 'rocket', 'Buz-R', 'Hedefi 2 saniye yavaşlatan dondurucu roket.', 'rocket', 'rare', true, '{"damage": 500, "cooldownMs": 4000, "range": 650, "slowMs": 2000}', 0, 8, '{}', 30),
  ('launcher.saganak', 'rocket_launcher', 'Sağanak Roket Atar', 'Ekstra slota takılır; roketleri 5''li yaylım halinde ateşler.', 'launcher', 'rare', false, '{"volley": 5, "reloadMs": 6000}', 0, 8, '{}', 12500),
  -- Kalkan jeneratörleri (Siper)
  ('shield.siper1', 'shield_generator', 'Siper-1 Kalkan', 'Temel kalkan jeneratörü.', 'shield', 'common', false, '{"shield": 1000, "absorb": 0.5}', 10, 1, '{}', 2000),
  ('shield.siper2', 'shield_generator', 'Siper-2 Kalkan', 'Güçlendirilmiş kalkan jeneratörü.', 'shield', 'uncommon', false, '{"shield": 2500, "absorb": 0.6}', 10, 4, '{}', 8000),
  ('shield.siper3', 'shield_generator', 'Siper-3 Kalkan', 'Askerî sınıf kalkan jeneratörü.', 'shield', 'rare', false, '{"shield": 4000, "absorb": 0.7}', 10, 8, '{}', 25000),
  ('shield.siper4', 'shield_generator', 'Siper-4 Kalkan', 'Elit katmanlı kalkan jeneratörü.', 'shield', 'epic', false, '{"shield": 6000, "absorb": 0.8}', 10, 12, '{}', 48000),
  -- Hız jeneratörleri (İtki)
  ('speed.itki1', 'speed_generator', 'İtki-1 Motor', 'Temel hız jeneratörü.', 'speed', 'common', false, '{"speed": 2}', 10, 1, '{}', 1250),
  ('speed.itki2', 'speed_generator', 'İtki-2 Motor', 'Geliştirilmiş hız jeneratörü.', 'speed', 'uncommon', false, '{"speed": 5}', 10, 4, '{}', 5000),
  ('speed.itki3', 'speed_generator', 'İtki-3 Motor', 'Yüksek verimli hız jeneratörü.', 'speed', 'rare', false, '{"speed": 7}', 10, 8, '{}', 15000),
  ('speed.itki4', 'speed_generator', 'İtki-4 Motor', 'Elit hız jeneratörü.', 'speed', 'epic', false, '{"speed": 10}', 10, 12, '{}', 32000),
  -- Ekstra modüller
  ('extra.kargo', 'extra', 'Kargo Genişletici', 'Kargo kapasitesini artırır.', 'cargo', 'common', false, '{"kind": "cargo", "value": 200}', 0, 1, '{}', 2500),
  ('extra.tamir', 'extra', 'Tamir Robotu TR-1', 'Savaş dışında gemiyi saniyede onarır (Aşama 9''da etkin).', 'repair', 'uncommon', false, '{"kind": "repair", "value": 150}', 0, 3, '{}', 7500),
  ('extra.radar', 'extra', 'Uzun Menzil Radar', 'Düşman ve kargo algılama mesafesini artırır (Aşama 7-8''de etkin).', 'radar', 'rare', false, '{"kind": "radar", "value": 300}', 0, 6, '{}', 15000),
  -- Drone'lar
  ('drone.ari', 'drone', 'Arı Drone', 'Temel drone: bir lazer veya kalkan taşır.', 'drone', 'common', false, '{"gearSlots": 1, "bonus": 0}', 10, 3, '{}', 6000),
  ('drone.yaban', 'drone', 'Yaban Drone', 'Gelişmiş drone: taşıdığı ekipmana %5 güç katar.', 'drone', 'rare', false, '{"gearSlots": 1, "bonus": 0.05}', 10, 8, '{}', 0),
  ('drone.alkim', 'drone', 'Alkım Drone', 'Yıldız Kapısı ödülü elit drone: taşıdığı ekipmana %10 güç katar.', 'drone', 'legendary', false, '{"gearSlots": 1, "bonus": 0.10}', 10, 12, '{}', 0),
  -- PET ve modülleri
  ('pet.yoldas', 'pet', 'Yoldaş PET', 'Seni takip eden yardımcı robot. Modülleriyle kargo toplar, korur ve onarır.', 'pet', 'epic', false, '{"moduleSlots": 2, "hitpoints": 20000}', 0, 5, '{}', 0),
  ('petmod.toplayici', 'pet_module', 'Toplayıcı Modül', 'PET yakındaki kargo kutularını toplar.', 'petmod', 'uncommon', false, '{"kind": "collector", "value": 1}', 0, 5, '{}', 2500),
  ('petmod.onarici', 'pet_module', 'Onarıcı Dişli', 'PET''in kendi gövdesini onarır.', 'petmod', 'uncommon', false, '{"kind": "repair", "value": 1}', 0, 5, '{}', 2500),
  ('petmod.koruyucu', 'pet_module', 'Koruyucu Modül', 'PET seni koruma modunda yakındaki tehditlere ateş eder.', 'petmod', 'rare', false, '{"kind": "guard", "value": 1}', 0, 5, '{}', 5000),
  ('petmod.takipci', 'pet_module', 'Takipçi Modül', 'PET seçtiğin hedefi izler ve konumunu bildirir.', 'petmod', 'uncommon', false, '{"kind": "follow", "value": 1}', 0, 5, '{}', 2500),
  -- Gemi tasarımları (yalnızca görünüm)
  ('design.kirlangic-gece', 'ship_design', 'Gece Kırlangıcı', 'Kırlangıç için koyu gece tasarımı.', 'design', 'uncommon', false, '{"spriteKey": "ship-kirlangic-gece"}', 0, 1, '{"ship": "kirlangic"}', 0),
  ('design.atmaca-bozkir', 'ship_design', 'Bozkır Atmacası', 'Atmaca için kum ve toprak tonlarında tasarım.', 'design', 'rare', false, '{"spriteKey": "ship-atmaca-bozkir"}', 0, 6, '{"ship": "atmaca"}', 0),
  ('design.kartal-altin', 'ship_design', 'Altın Kartal', 'Kartal için altın kaplama tören tasarımı.', 'design', 'epic', false, '{"spriteKey": "ship-kartal-altin"}', 0, 15, '{"ship": "kartal"}', 0);

-- ---------------------------------------------------------------- Yükseltme tablosu (seviye başına +%2, 1-5 Kredi, 6-10 Akçe)
INSERT INTO upgrade_levels (category, level, stat_bonus, success_chance, cost_currency, cost_amount)
SELECT c.category, l.level, l.level * 0.02, l.chance, l.currency, l.amount
FROM (VALUES ('laser'), ('shield_generator'), ('speed_generator'), ('drone')) AS c(category)
CROSS JOIN (VALUES
  (1, 1.000, 'KREDI', 2000), (2, 0.950, 'KREDI', 5000), (3, 0.900, 'KREDI', 10000), (4, 0.850, 'KREDI', 20000),
  (5, 0.800, 'KREDI', 40000), (6, 0.700, 'AKCE', 200), (7, 0.600, 'AKCE', 400), (8, 0.500, 'AKCE', 700),
  (9, 0.400, 'AKCE', 1000), (10, 0.300, 'AKCE', 1500)
) AS l(level, chance, currency, amount);

-- ---------------------------------------------------------------- Mağaza
INSERT INTO shop_categories (code, name, sort_order) VALUES
  ('gemiler', 'Gemiler', 1), ('lazerler', 'Lazerler', 2), ('mermiler', 'Mermiler', 3), ('roketler', 'Roketler', 4),
  ('jeneratorler', 'Jeneratörler', 5), ('ekstralar', 'Ekstralar', 6), ('droneler', 'Drone''lar', 7),
  ('pet', 'PET', 8), ('tasarimlar', 'Tasarımlar', 9);

INSERT INTO shop_offers (category_id, offer_type, ship_type_id, currency_code, price, per_player_limit, sort_order)
SELECT (SELECT id FROM shop_categories WHERE code = 'gemiler'), 'ship', s.id, o.currency, o.price, 1, o.sort
FROM ship_types s JOIN (VALUES
  ('dogan', 'KREDI', 40000, 1), ('atmaca', 'KREDI', 160000, 2), ('sahin', 'KREDI', 450000, 3),
  ('tulpar', 'AKCE', 20000, 4), ('kartal', 'AKCE', 35000, 5), ('umay', 'AKCE', 40000, 6),
  ('kale', 'AKCE', 50000, 7), ('akinci', 'AKCE', 60000, 8), ('boru', 'AKCE', 80000, 9)
) AS o(code, currency, price, sort) ON o.code = s.code;

INSERT INTO shop_offers (category_id, offer_type, item_type_id, quantity, currency_code, price, max_per_purchase, per_player_limit, sort_order)
SELECT (SELECT id FROM shop_categories WHERE code = o.cat), 'item', i.id, o.qty, o.currency, o.price, o.maxp, o.lim, o.sort
FROM item_types i JOIN (VALUES
  ('laser.ok1', 'lazerler', 1, 'KREDI', 10000, 10, NULL::int, 1),
  ('laser.ok2', 'lazerler', 1, 'KREDI', 40000, 10, NULL, 2),
  ('laser.ok3', 'lazerler', 1, 'KREDI', 150000, 10, NULL, 3),
  ('laser.ok4', 'lazerler', 1, 'AKCE', 10000, 10, NULL, 4),
  ('ammo.isk1', 'mermiler', 1000, 'KREDI', 10000, 100, NULL, 1),
  ('ammo.isk2', 'mermiler', 100, 'AKCE', 50, 100, NULL, 2),
  ('ammo.isk3', 'mermiler', 100, 'AKCE', 100, 100, NULL, 3),
  ('ammo.se50', 'mermiler', 100, 'AKCE', 150, 100, NULL, 4),
  ('rocket.yildirim', 'roketler', 10, 'KREDI', 1000, 100, NULL, 1),
  ('rocket.simsek', 'roketler', 10, 'KREDI', 2500, 100, NULL, 2),
  ('rocket.tufan', 'roketler', 10, 'AKCE', 40, 100, NULL, 3),
  ('rocket.buz', 'roketler', 10, 'AKCE', 30, 100, NULL, 4),
  ('launcher.saganak', 'roketler', 1, 'KREDI', 50000, 1, NULL, 5),
  ('shield.siper1', 'jeneratorler', 1, 'KREDI', 8000, 10, NULL, 1),
  ('shield.siper2', 'jeneratorler', 1, 'KREDI', 32000, 10, NULL, 2),
  ('shield.siper3', 'jeneratorler', 1, 'KREDI', 100000, 10, NULL, 3),
  ('shield.siper4', 'jeneratorler', 1, 'AKCE', 12000, 10, NULL, 4),
  ('speed.itki1', 'jeneratorler', 1, 'KREDI', 5000, 10, NULL, 5),
  ('speed.itki2', 'jeneratorler', 1, 'KREDI', 20000, 10, NULL, 6),
  ('speed.itki3', 'jeneratorler', 1, 'KREDI', 60000, 10, NULL, 7),
  ('speed.itki4', 'jeneratorler', 1, 'AKCE', 8000, 10, NULL, 8),
  ('extra.kargo', 'ekstralar', 1, 'KREDI', 10000, 4, NULL, 1),
  ('extra.tamir', 'ekstralar', 1, 'KREDI', 30000, 4, NULL, 2),
  ('extra.radar', 'ekstralar', 1, 'AKCE', 3000, 1, NULL, 3),
  ('drone.ari', 'droneler', 1, 'KREDI', 25000, 6, NULL, 1),
  ('drone.yaban', 'droneler', 1, 'AKCE', 15000, 6, NULL, 2),
  ('pet.yoldas', 'pet', 1, 'AKCE', 25000, 1, 1, 1),
  ('petmod.toplayici', 'pet', 1, 'KREDI', 10000, 1, NULL, 2),
  ('petmod.onarici', 'pet', 1, 'KREDI', 10000, 1, NULL, 3),
  ('petmod.koruyucu', 'pet', 1, 'AKCE', 2000, 1, NULL, 4),
  ('petmod.takipci', 'pet', 1, 'KREDI', 10000, 1, NULL, 5),
  ('design.kirlangic-gece', 'tasarimlar', 1, 'AKCE', 500, 1, 1, 1),
  ('design.atmaca-bozkir', 'tasarimlar', 1, 'AKCE', 3000, 1, 1, 2),
  ('design.kartal-altin', 'tasarimlar', 1, 'AKCE', 10000, 1, 1, 3)
) AS o(code, cat, qty, currency, price, maxp, lim, sort) ON o.code = i.code;

-- ---------------------------------------------------------------- Ayarlar (Yönetim Merkezi 15.8 / 15.11)
INSERT INTO game_settings (key, value) VALUES
  ('starter.kit', '{"items": [{"code": "laser.ok1", "quantity": 1}, {"code": "shield.siper1", "quantity": 1},
                              {"code": "speed.itki1", "quantity": 1}, {"code": "ammo.isk1", "quantity": 2000},
                              {"code": "rocket.yildirim", "quantity": 50}]}'::jsonb),
  ('repair', '{"currency": "KREDI", "per_1000_hp": 250}'::jsonb),
  ('inventory', '{"max_items": 300}'::jsonb);
