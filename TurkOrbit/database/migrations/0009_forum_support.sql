-- =====================================================================================
-- TÜRK ORBIT — Migration 0009: Forum ve destek (Aşama 13)
--
--  * Forum: oyun hesabıyla ortak (users). Bölümler, konular, mesajlar, beğeni, takip, bölüm moderatörleri.
--    Tam metin arama (tsvector + GIN). Türkçe eklemeli olduğundan kelime başı (önek) eşleşmesi kullanılır:
--    "gemi" → "gemileri", "taktik" → "taktikleri". (Snowball 'turkish' kök bulucusu kısa kelimeleri bozuyor:
--    "gemi" → "ge".) Silme yumuşaktır (kanıt korunur).
--  * Destek: benzersiz talep numarası (TO-YYYY-000123, veritabanı dizisinden), durum akışı, personel iç notları,
--    ek dosyalar (tür ve boyut veritabanı seviyesinde de sınırlı; dosya içeriği veritabanına gömülmez).
--  * Şikâyetler Aşama 12'deki `reports` tablosuna (forum_post / forum_thread hedefleri) yazılır.
-- =====================================================================================

-- ---------------------------------------------------------------- forum
CREATE TABLE forum_categories (
  id              serial PRIMARY KEY,
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  description     text CHECK (description IS NULL OR char_length(description) <= 300),
  sort_order      smallint NOT NULL DEFAULT 0,
  -- Konu açmak için gereken yetki (NULL: e-postası doğrulanmış her oyuncu). Ör. Duyurular → forum.moderate
  post_permission text REFERENCES permissions(key),
  is_archived     boolean NOT NULL DEFAULT false
);

-- Bölüm moderatörü: o bölümde sabitleme, kilitleme, taşıma ve silme yapabilir (genel yetki: forum.moderate)
CREATE TABLE forum_moderators (
  category_id integer NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, user_id)
);

CREATE TABLE forum_threads (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id    integer NOT NULL REFERENCES forum_categories(id),
  -- Hesap silinirse NULL ("Silinmiş hesap"); sistem tarafından açılan konularda da NULL ("Türk Orbit Ekibi")
  author_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  title          text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 140),
  is_pinned      boolean NOT NULL DEFAULT false,
  is_locked      boolean NOT NULL DEFAULT false,
  is_deleted     boolean NOT NULL DEFAULT false,
  deleted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_reason text CHECK (deleted_reason IS NULL OR char_length(deleted_reason) <= 200),
  reply_count    integer NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  view_count     integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_post_at   timestamptz NOT NULL DEFAULT now(),
  last_poster_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  search         tsvector GENERATED ALWAYS AS (to_tsvector('simple', title)) STORED
);
CREATE INDEX forum_threads_list_idx ON forum_threads(category_id, is_pinned DESC, last_post_at DESC) WHERE NOT is_deleted;
CREATE INDEX forum_threads_search_idx ON forum_threads USING gin(search);
CREATE INDEX forum_threads_author_idx ON forum_threads(author_id);

CREATE TABLE forum_posts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id      bigint NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  body           text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  quoted_post_id bigint REFERENCES forum_posts(id) ON DELETE SET NULL,
  is_first       boolean NOT NULL DEFAULT false,
  is_deleted     boolean NOT NULL DEFAULT false,
  deleted_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_reason text CHECK (deleted_reason IS NULL OR char_length(deleted_reason) <= 200),
  like_count     integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  edit_count     integer NOT NULL DEFAULT 0 CHECK (edit_count >= 0),
  edited_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  search         tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);
CREATE INDEX forum_posts_thread_idx ON forum_posts(thread_id, id);
CREATE INDEX forum_posts_search_idx ON forum_posts USING gin(search);
CREATE INDEX forum_posts_author_idx ON forum_posts(author_id);
-- Bir konunun tek ilk mesajı olur
CREATE UNIQUE INDEX forum_posts_first_idx ON forum_posts(thread_id) WHERE is_first;

CREATE TABLE forum_likes (
  post_id    bigint NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE forum_follows (
  thread_id  bigint NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX forum_follows_user_idx ON forum_follows(user_id);

-- ---------------------------------------------------------------- destek
CREATE SEQUENCE support_ticket_seq START 1;

CREATE TABLE support_tickets (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Oyuncuya gösterilen benzersiz numara: TO-<yıl>-<6 hane>, dizi değerinden üretilir (eşzamanlı istekte çakışmaz)
  ticket_no    text NOT NULL UNIQUE CHECK (ticket_no ~ '^TO-[0-9]{4}-[0-9]{6,}$'),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN ('account', 'payment', 'bug', 'cheat_report', 'ban_appeal', 'gameplay', 'other')),
  subject      text NOT NULL CHECK (char_length(subject) BETWEEN 5 AND 120),
  status       text NOT NULL DEFAULT 'waiting_staff' CHECK (status IN ('waiting_staff', 'waiting_player', 'resolved', 'closed')),
  priority     text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to  uuid REFERENCES users(id) ON DELETE SET NULL,
  platform     text CHECK (platform IS NULL OR char_length(platform) <= 20),
  app_version  text CHECK (app_version IS NULL OR char_length(app_version) <= 40),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  closed_at    timestamptz
);
CREATE INDEX support_tickets_user_idx ON support_tickets(user_id, updated_at DESC);
CREATE INDEX support_tickets_queue_idx ON support_tickets(status, priority, updated_at);
CREATE TRIGGER support_tickets_set_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE support_messages (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id        bigint NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  is_staff         boolean NOT NULL,
  -- Oyuncuya görünmeyen personel notu (yalnızca personel yazabilir)
  is_internal_note boolean NOT NULL DEFAULT false,
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_internal_note OR is_staff)
);
CREATE INDEX support_messages_ticket_idx ON support_messages(ticket_id, id);

CREATE TABLE support_attachments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id    bigint NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id   bigint NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Depolama anahtarı (dosya içeriği veritabanına gömülmez; yerel disk veya nesne depolama)
  storage_key  text NOT NULL UNIQUE CHECK (storage_key ~ '^[a-f0-9]{2}/[a-f0-9]{64}$'),
  file_name    text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 120),
  mime_type    text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/pdf')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256       bytea NOT NULL CHECK (octet_length(sha256) = 32),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_attachments_message_idx ON support_attachments(message_id);

-- ---------------------------------------------------------------- ayarlar
INSERT INTO game_settings (key, value) VALUES
  ('forum', '{"threads_per_page": 20, "posts_per_page": 20, "edit_window_minutes": 1440, "max_body": 20000}'::jsonb),
  ('support', '{"max_attachment_bytes": 5242880, "max_attachments_per_message": 3, "attach_window_minutes": 30,
                "max_open_tickets": 5, "auto_close_days": 7}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- forum bölümleri ve kurallar
INSERT INTO forum_categories (slug, name, description, sort_order, post_permission) VALUES
  ('duyurular',   'Duyurular',              'Güncellemeler, bakım ve etkinlik duyuruları. Konuları yalnızca ekip açar; yanıt yazabilirsin.', 1, 'forum.moderate'),
  ('genel',       'Genel Sohbet',           'Türk Orbit hakkında her şey.',                                                              2, NULL),
  ('rehberler',   'Rehberler ve Taktikler', 'Gemi kurulumları, görev ve madencilik rehberleri, PvP taktikleri.',                         3, NULL),
  ('klanlar',     'Klanlar ve İttifaklar',  'Klan tanıtımları, üye arayan klanlar, diplomasi.',                                          4, NULL),
  ('oneriler',    'Öneriler',               'Oyunu nasıl geliştirelim? Fikirlerini paylaş.',                                             5, NULL),
  ('hatalar',     'Hata Bildirimleri',      'Karşılaştığın hataları cihaz ve adım bilgisiyle yaz. Hesabına özel sorunlar için Destek talebi aç.', 6, NULL);

WITH t AS (
  INSERT INTO forum_threads (category_id, author_id, title, is_pinned, is_locked)
  VALUES ((SELECT id FROM forum_categories WHERE slug = 'duyurular'), NULL, 'Topluluk Kuralları', true, true)
  RETURNING id
)
INSERT INTO forum_posts (thread_id, author_id, body, is_first)
SELECT id, NULL, E'Türk Orbit forumuna hoş geldin, pilot! Herkesin keyifle yazabilmesi için birkaç kural:\n\n'
  || E'1. Saygılı ol. Hakaret, küfür, nefret söylemi ve kişisel saldırı yasaktır.\n'
  || E'2. Kişisel bilgilerini (e-posta, telefon, parola) ve başkalarınınkini paylaşma. Ekip senden asla parolanı istemez.\n'
  || E'3. Hile, hata istismarı ve hesap satışı paylaşımı yasaktır. Bulduğun hataları Hata Bildirimleri bölümüne veya Destek''e yaz.\n'
  || E'4. Konuyu doğru bölümde aç, başlığı açıklayıcı yaz. Aynı konuyu tekrar tekrar açma.\n'
  || E'5. Reklam ve spam yasaktır.\n'
  || E'6. Hesabına özel sorunlar (ödeme, ban itirazı, kayıp eşya) için forum yerine Destek talebi oluştur.\n\n'
  || E'Kurallara uymayan içerikleri "Şikâyet et" ile bildirebilirsin. Moderatörler konuları kilitleyebilir, taşıyabilir veya silebilir.\nİyi uçuşlar!',
  true
FROM t;
