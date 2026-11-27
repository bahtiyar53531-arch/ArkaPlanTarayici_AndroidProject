-- =====================================================================================
-- TÜRK ORBIT — Migration 0004: Galaksi, portallar, bölgeler ve oyuncu ayarları (Aşama 7)
--
--  * 21 harita arasında 30 çift yönlü bağlantı (60 portal). Konumlar, galaksi düzenindeki yöne göre
--    harita kenarına yerleştirildi; varış noktası karşı portalın 700 birim içeriye doğru yanıdır.
--  * Bölgeler: istasyon, güvenli bölge, kaynak alanı (Aşama 11 madenciliği bu alanları kullanacak).
--  * Konum güncellemeleri sunucuda hız doğrulamasından geçer (players.pos_updated_at).
--  * Oyuncu ayarları cihaz sınıfına göre (masaüstü/telefon/tablet) saklanır ve senkronize olur.
-- =====================================================================================

ALTER TABLE maps ADD COLUMN galaxy_x smallint CHECK (galaxy_x BETWEEN 0 AND 100);
ALTER TABLE maps ADD COLUMN galaxy_y smallint CHECK (galaxy_y BETWEEN 0 AND 100);

ALTER TABLE players ADD COLUMN pos_updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE map_portals (
  id            serial PRIMARY KEY,
  map_id        integer NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  x             integer NOT NULL,
  y             integer NOT NULL,
  target_map_id integer NOT NULL REFERENCES maps(id),
  target_x      integer NOT NULL,
  target_y      integer NOT NULL,
  -- Ek geçiş koşulları (ör. {"min_level": 10}); hedef haritanın kendi koşulları ayrıca uygulanır.
  requirements  jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled    boolean NOT NULL DEFAULT true,
  CHECK (map_id <> target_map_id)
);
CREATE INDEX map_portals_map_idx ON map_portals(map_id);
CREATE UNIQUE INDEX map_portals_pair ON map_portals(map_id, target_map_id);

CREATE TABLE map_zones (
  id         serial PRIMARY KEY,
  map_id     integer NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  zone_type  text NOT NULL CHECK (zone_type IN ('station', 'safe', 'resource', 'no_pvp')),
  name       text NOT NULL,
  -- {"type":"circle","x":1800,"y":1800,"r":2200}
  shape      jsonb NOT NULL CHECK (shape->>'type' = 'circle'),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX map_zones_map_idx ON map_zones(map_id);

-- Harita geçiş kaydı (analiz + hile tespiti için)
CREATE TABLE map_transitions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  from_map_id integer NOT NULL REFERENCES maps(id),
  to_map_id   integer NOT NULL REFERENCES maps(id),
  portal_id   integer REFERENCES map_portals(id) ON DELETE SET NULL,
  reason      text NOT NULL DEFAULT 'portal',  -- portal | map_closed | company_change
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX map_transitions_player_idx ON map_transitions(player_id, created_at DESC);

-- Hız doğrulamasında reddedilen konum güncellemeleri (Aşama 8'de anticheat_events'e taşınacak)
CREATE TABLE position_rejections (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  map_id      integer NOT NULL REFERENCES maps(id),
  from_x      real NOT NULL,
  from_y      real NOT NULL,
  to_x        real NOT NULL,
  to_y        real NOT NULL,
  distance    real NOT NULL,
  allowed     real NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX position_rejections_player_idx ON position_rejections(player_id, created_at DESC);

-- Kontrol/HUD/grafik ayarları: cihaz sınıfı başına, aynı sınıftaki tüm cihazlarda senkron (madde 16.2–16.5)
CREATE TABLE player_settings (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_class text NOT NULL CHECK (device_class IN ('desktop', 'phone', 'tablet')),
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_class)
);

-- =====================================================================================
-- TOHUM VERİSİ (scripts tarafından üretildi; galaksi düzeni Documentation/08 ile aynı)
-- =====================================================================================
INSERT INTO map_portals (map_id, x, y, target_map_id, target_x, target_y) VALUES
  ((SELECT id FROM maps WHERE code = 'A-1'), 18500, 6250, (SELECT id FROM maps WHERE code = 'A-2'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'A-1'), 10000, 1300, (SELECT id FROM maps WHERE code = 'A-3'), 10000, 10500),
  ((SELECT id FROM maps WHERE code = 'A-2'), 1500, 6250, (SELECT id FROM maps WHERE code = 'A-1'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'A-2'), 10000, 1300, (SELECT id FROM maps WHERE code = 'A-4'), 10000, 10500),
  ((SELECT id FROM maps WHERE code = 'A-3'), 10000, 11200, (SELECT id FROM maps WHERE code = 'A-1'), 10000, 2000),
  ((SELECT id FROM maps WHERE code = 'A-3'), 18500, 6250, (SELECT id FROM maps WHERE code = 'A-4'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'A-4'), 10000, 11200, (SELECT id FROM maps WHERE code = 'A-2'), 10000, 2000),
  ((SELECT id FROM maps WHERE code = 'A-4'), 1500, 6250, (SELECT id FROM maps WHERE code = 'A-3'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'A-4'), 18500, 6250, (SELECT id FROM maps WHERE code = 'S-5'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'A-4'), 12062, 1448, (SELECT id FROM maps WHERE code = 'S-6'), 8214, 10409),
  ((SELECT id FROM maps WHERE code = 'G-1'), 18500, 6250, (SELECT id FROM maps WHERE code = 'G-2'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'G-1'), 10000, 11200, (SELECT id FROM maps WHERE code = 'G-4'), 10000, 2000),
  ((SELECT id FROM maps WHERE code = 'G-2'), 1500, 6250, (SELECT id FROM maps WHERE code = 'G-1'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'G-2'), 10000, 11200, (SELECT id FROM maps WHERE code = 'G-3'), 10000, 2000),
  ((SELECT id FROM maps WHERE code = 'G-3'), 10000, 1300, (SELECT id FROM maps WHERE code = 'G-2'), 10000, 10500),
  ((SELECT id FROM maps WHERE code = 'G-3'), 1500, 6250, (SELECT id FROM maps WHERE code = 'G-4'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'G-3'), 6731, 10819, (SELECT id FROM maps WHERE code = 'S-3'), 12862, 2250),
  ((SELECT id FROM maps WHERE code = 'G-4'), 10000, 1300, (SELECT id FROM maps WHERE code = 'G-1'), 10000, 10500),
  ((SELECT id FROM maps WHERE code = 'G-4'), 18500, 6250, (SELECT id FROM maps WHERE code = 'G-3'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'G-4'), 1500, 6250, (SELECT id FROM maps WHERE code = 'S-2'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'K-1'), 18500, 6250, (SELECT id FROM maps WHERE code = 'K-2'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'K-1'), 10000, 11200, (SELECT id FROM maps WHERE code = 'K-3'), 10000, 2000),
  ((SELECT id FROM maps WHERE code = 'K-2'), 1500, 6250, (SELECT id FROM maps WHERE code = 'K-1'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'K-2'), 10000, 11200, (SELECT id FROM maps WHERE code = 'K-4'), 10000, 2000),
  ((SELECT id FROM maps WHERE code = 'K-3'), 10000, 1300, (SELECT id FROM maps WHERE code = 'K-1'), 10000, 10500),
  ((SELECT id FROM maps WHERE code = 'K-3'), 18500, 6250, (SELECT id FROM maps WHERE code = 'K-4'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'K-4'), 10000, 1300, (SELECT id FROM maps WHERE code = 'K-2'), 10000, 10500),
  ((SELECT id FROM maps WHERE code = 'K-4'), 1500, 6250, (SELECT id FROM maps WHERE code = 'K-3'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'K-4'), 18500, 6250, (SELECT id FROM maps WHERE code = 'S-1'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'K-4'), 12062, 11052, (SELECT id FROM maps WHERE code = 'S-6'), 8214, 2091),
  ((SELECT id FROM maps WHERE code = 'S-1'), 1500, 6250, (SELECT id FROM maps WHERE code = 'K-4'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'S-1'), 18500, 6250, (SELECT id FROM maps WHERE code = 'S-2'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'S-1'), 12062, 11052, (SELECT id FROM maps WHERE code = 'Ç-1'), 8214, 2091),
  ((SELECT id FROM maps WHERE code = 'S-2'), 18500, 6250, (SELECT id FROM maps WHERE code = 'G-4'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'S-2'), 1500, 6250, (SELECT id FROM maps WHERE code = 'S-1'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'S-2'), 11397, 11133, (SELECT id FROM maps WHERE code = 'Ç-2'), 8796, 2040),
  ((SELECT id FROM maps WHERE code = 'S-3'), 13269, 1681, (SELECT id FROM maps WHERE code = 'G-3'), 7138, 10250),
  ((SELECT id FROM maps WHERE code = 'S-3'), 6199, 10677, (SELECT id FROM maps WHERE code = 'S-4'), 13345, 2354),
  ((SELECT id FROM maps WHERE code = 'S-3'), 1500, 6250, (SELECT id FROM maps WHERE code = 'Ç-2'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'S-4'), 13801, 1823, (SELECT id FROM maps WHERE code = 'S-3'), 6655, 10146),
  ((SELECT id FROM maps WHERE code = 'S-4'), 1500, 6250, (SELECT id FROM maps WHERE code = 'Ç-3'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'S-5'), 1500, 6250, (SELECT id FROM maps WHERE code = 'A-4'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'S-5'), 12062, 1448, (SELECT id FROM maps WHERE code = 'Ç-1'), 8214, 10409),
  ((SELECT id FROM maps WHERE code = 'S-5'), 18500, 6250, (SELECT id FROM maps WHERE code = 'Ç-3'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'S-6'), 7938, 11052, (SELECT id FROM maps WHERE code = 'A-4'), 11786, 2091),
  ((SELECT id FROM maps WHERE code = 'S-6'), 7938, 1448, (SELECT id FROM maps WHERE code = 'K-4'), 11786, 10409),
  ((SELECT id FROM maps WHERE code = 'S-6'), 18500, 6250, (SELECT id FROM maps WHERE code = 'Ç-1'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), 7938, 1448, (SELECT id FROM maps WHERE code = 'S-1'), 11786, 10409),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), 7938, 11052, (SELECT id FROM maps WHERE code = 'S-5'), 11786, 2091),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), 1500, 6250, (SELECT id FROM maps WHERE code = 'S-6'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), 18500, 6250, (SELECT id FROM maps WHERE code = 'Ç-2'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), 12985, 10885, (SELECT id FROM maps WHERE code = 'Ç-3'), 7394, 2204),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), 8603, 1367, (SELECT id FROM maps WHERE code = 'S-2'), 11204, 10460),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), 18500, 6250, (SELECT id FROM maps WHERE code = 'S-3'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), 1500, 6250, (SELECT id FROM maps WHERE code = 'Ç-1'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), 7015, 10885, (SELECT id FROM maps WHERE code = 'Ç-3'), 12606, 2204),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), 18500, 6250, (SELECT id FROM maps WHERE code = 'S-4'), 2200, 6250),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), 1500, 6250, (SELECT id FROM maps WHERE code = 'S-5'), 17800, 6250),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), 7015, 1615, (SELECT id FROM maps WHERE code = 'Ç-1'), 12606, 10296),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), 12985, 1615, (SELECT id FROM maps WHERE code = 'Ç-2'), 7394, 10296);

UPDATE maps m SET galaxy_x = v.gx, galaxy_y = v.gy FROM (VALUES
  ('K-1', 8, 8),
  ('K-2', 24, 8),
  ('K-3', 8, 26),
  ('K-4', 24, 26),
  ('G-1', 76, 8),
  ('G-2', 92, 8),
  ('G-4', 76, 26),
  ('G-3', 92, 26),
  ('A-3', 8, 74),
  ('A-4', 24, 74),
  ('A-1', 8, 92),
  ('A-2', 24, 92),
  ('S-1', 40, 26),
  ('S-2', 60, 26),
  ('S-6', 30, 50),
  ('S-3', 82, 50),
  ('S-5', 40, 74),
  ('S-4', 70, 74),
  ('Ç-1', 46, 50),
  ('Ç-2', 64, 50),
  ('Ç-3', 55, 74)
) AS v(code, gx, gy) WHERE m.code = v.code;

INSERT INTO map_zones (map_id, zone_type, name, shape, properties) VALUES
  ((SELECT id FROM maps WHERE code = 'K-1'), 'station', 'Kızılelma Limanı İstasyonu', '{"type": "circle", "x": 1800, "y": 1800, "r": 700}'::jsonb, '{}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'K-1'), 'safe', 'Güvenli bölge', '{"type": "circle", "x": 1800, "y": 1800, "r": 2200}'::jsonb, '{}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'G-1'), 'station', 'Gökbörü Üssü İstasyonu', '{"type": "circle", "x": 18200, "y": 1800, "r": 700}'::jsonb, '{}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'G-1'), 'safe', 'Güvenli bölge', '{"type": "circle", "x": 18200, "y": 1800, "r": 2200}'::jsonb, '{}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'A-1'), 'station', 'Altay Madenleri İstasyonu', '{"type": "circle", "x": 1800, "y": 10700, "r": 700}'::jsonb, '{}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'A-1'), 'safe', 'Güvenli bölge', '{"type": "circle", "x": 1800, "y": 10700, "r": 2200}'::jsonb, '{}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'K-1'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 15999, "y": 9636, "r": 1345}'::jsonb, '{"resource": "ferrolit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'K-2'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 16865, "y": 2051, "r": 1017}'::jsonb, '{"resource": "titanyum", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'K-2'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 4703, "y": 5343, "r": 1129}'::jsonb, '{"resource": "titanyum", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'K-3'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 3314, "y": 2510, "r": 1370}'::jsonb, '{"resource": "kuvarsit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'K-3'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 11467, "y": 4352, "r": 1348}'::jsonb, '{"resource": "ferrolit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'K-4'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 16033, "y": 3185, "r": 990}'::jsonb, '{"resource": "titanyum", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'K-4'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 9413, "y": 5030, "r": 1106}'::jsonb, '{"resource": "ferrolit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'G-1'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 9541, "y": 7510, "r": 1365}'::jsonb, '{"resource": "titanyum", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'G-2'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 17623, "y": 4319, "r": 1371}'::jsonb, '{"resource": "titanyum", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'G-2'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 13252, "y": 4486, "r": 944}'::jsonb, '{"resource": "kuvarsit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'G-4'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 17218, "y": 2857, "r": 944}'::jsonb, '{"resource": "titanyum", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'G-4'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 3431, "y": 10016, "r": 1493}'::jsonb, '{"resource": "titanyum", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'G-3'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 13565, "y": 9129, "r": 1187}'::jsonb, '{"resource": "kuvarsit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'G-3'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 8162, "y": 3845, "r": 1303}'::jsonb, '{"resource": "ferrolit", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'A-3'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 13991, "y": 7281, "r": 1280}'::jsonb, '{"resource": "titanyum", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'A-3'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 10175, "y": 2048, "r": 1030}'::jsonb, '{"resource": "kuvarsit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'A-4'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 16843, "y": 3329, "r": 1167}'::jsonb, '{"resource": "titanyum", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'A-4'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 5179, "y": 2170, "r": 1185}'::jsonb, '{"resource": "ferrolit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'A-1'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 5270, "y": 10304, "r": 1075}'::jsonb, '{"resource": "ferrolit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'A-2'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 7931, "y": 7436, "r": 1028}'::jsonb, '{"resource": "kuvarsit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'A-2'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 8898, "y": 4326, "r": 1389}'::jsonb, '{"resource": "ferrolit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-1'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 13025, "y": 2582, "r": 1283}'::jsonb, '{"resource": "ferrolit", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-1'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 5800, "y": 9919, "r": 1230}'::jsonb, '{"resource": "kuvarsit", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-1'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 7838, "y": 3470, "r": 1281}'::jsonb, '{"resource": "titanyum", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-2'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 10492, "y": 2121, "r": 1363}'::jsonb, '{"resource": "titanyum", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-2'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 6958, "y": 7525, "r": 1126}'::jsonb, '{"resource": "ferrolit", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-2'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 5311, "y": 4337, "r": 1139}'::jsonb, '{"resource": "ferrolit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-6'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 15407, "y": 1809, "r": 1462}'::jsonb, '{"resource": "kuvarsit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-6'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 8051, "y": 5809, "r": 1199}'::jsonb, '{"resource": "ferrolit", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-6'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 11583, "y": 9604, "r": 1367}'::jsonb, '{"resource": "ferrolit", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-3'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 5509, "y": 1982, "r": 1369}'::jsonb, '{"resource": "titanyum", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-3'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 17981, "y": 8094, "r": 910}'::jsonb, '{"resource": "kuvarsit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-3'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 12016, "y": 9873, "r": 1424}'::jsonb, '{"resource": "ferrolit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-5'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 16399, "y": 3451, "r": 1381}'::jsonb, '{"resource": "kuvarsit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-5'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 6012, "y": 9615, "r": 1135}'::jsonb, '{"resource": "kuvarsit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-5'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 15036, "y": 7875, "r": 1440}'::jsonb, '{"resource": "ferrolit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-4'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 17964, "y": 6666, "r": 1401}'::jsonb, '{"resource": "ferrolit", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-4'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 9580, "y": 2612, "r": 1144}'::jsonb, '{"resource": "ferrolit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'S-4'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 14138, "y": 8325, "r": 963}'::jsonb, '{"resource": "titanyum", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 15106, "y": 7058, "r": 1231}'::jsonb, '{"resource": "kuvarsit", "density": 1}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'Ç-1'), 'resource', 'Titanyum tozu bulutu', '{"type": "circle", "x": 4528, "y": 7897, "r": 1489}'::jsonb, '{"resource": "titanyum", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 13139, "y": 3649, "r": 1383}'::jsonb, '{"resource": "kuvarsit", "density": 3}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'Ç-2'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 13589, "y": 10450, "r": 1196}'::jsonb, '{"resource": "kuvarsit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), 'resource', 'Kuvarsit kuşağı', '{"type": "circle", "x": 10894, "y": 8480, "r": 1419}'::jsonb, '{"resource": "kuvarsit", "density": 2}'::jsonb),
  ((SELECT id FROM maps WHERE code = 'Ç-3'), 'resource', 'Ferrolit kuşağı', '{"type": "circle", "x": 9151, "y": 5339, "r": 1079}'::jsonb, '{"resource": "ferrolit", "density": 3}'::jsonb);

ALTER TABLE maps ALTER COLUMN galaxy_x SET NOT NULL;
ALTER TABLE maps ALTER COLUMN galaxy_y SET NOT NULL;

INSERT INTO game_settings (key, value) VALUES
  -- Konum doğrulaması: izin verilen mesafe = hız × geçen süre × tolerans + sabit pay
  ('movement', '{"tolerance": 1.25, "slack": 300, "max_elapsed_seconds": 10}'::jsonb),
  ('portal', '{"jump_radius": 450}'::jsonb);
