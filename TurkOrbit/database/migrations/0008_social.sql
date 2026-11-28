-- =====================================================================================
-- TÜRK ORBIT — Migration 0008: Klan ve sosyal (Aşama 12)
--
--  * Klan: rütbeler (yetki listesiyle), üyeler, başvurular, davetler, etkinlik kaydı.
--  * Klan hazinesi: ayrı cüzdan + yalnızca eklenebilir defter (idempotent anahtar), negatif bakiye imkânsız.
--  * Diplomasi: ittifak ve saldırmazlık (karşı klan onaylar), savaş (tek taraflı ilan, barış iki tarafın onayıyla).
--    Etkin ilişkiler oyun sunucusunda saldırı iznini belirler.
--  * Arkadaşlık (istek → kabul), engelleme, gizlilik ayarları (konum paylaşımı, özel mesaj ve davet izinleri).
--  * Sohbet mesajları (genel, şirket, harita, klan, grup, özel), şikâyetler (moderasyon kuyruğu), bildirimler.
--  * Gruplar (party) kısa ömürlüdür: canlı durumu Redis'te tutulur (tablo yok), mesajları chat_messages'a yazılır.
-- =====================================================================================

-- ---------------------------------------------------------------- klanlar
CREATE TABLE clans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id     smallint NOT NULL REFERENCES game_servers(id),
  tag           citext NOT NULL CHECK (tag::text ~ '^[A-Z0-9ÇĞİÖŞÜ]{2,5}$'),
  name          citext NOT NULL CHECK (char_length(name) BETWEEN 3 AND 30),
  description   text CHECK (description IS NULL OR char_length(description) <= 500),
  -- Lider pilotu silinirse (hesap silme) NULL olur; servis bu durumda en kıdemli üst rütbeyi lider sayar.
  leader_id     uuid REFERENCES players(id) ON DELETE SET NULL,
  tax_percent   smallint NOT NULL DEFAULT 0 CHECK (tax_percent BETWEEN 0 AND 5),
  is_recruiting boolean NOT NULL DEFAULT true,
  min_level     smallint NOT NULL DEFAULT 1 CHECK (min_level BETWEEN 1 AND 50),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, tag),
  UNIQUE (server_id, name)
);
CREATE TRIGGER clans_set_updated_at BEFORE UPDATE ON clans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE clan_ranks (
  id          serial PRIMARY KEY,
  clan_id     uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 20),
  sort_order  smallint NOT NULL CHECK (sort_order BETWEEN 0 AND 9),
  is_leader   boolean NOT NULL DEFAULT false,
  permissions text[] NOT NULL DEFAULT '{}'
    CHECK (permissions <@ ARRAY['invite', 'kick', 'promote', 'diplomacy', 'treasury', 'edit_info']::text[]),
  UNIQUE (clan_id, sort_order),
  UNIQUE (clan_id, id),
  CHECK (NOT is_leader OR sort_order = 0)
);

CREATE TABLE clan_members (
  clan_id   uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  -- Bir pilot aynı anda yalnızca bir klanda olabilir (veritabanı seviyesinde)
  player_id uuid NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  rank_id   integer NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_id, player_id),
  -- Rütbe aynı klana ait olmalı
  FOREIGN KEY (clan_id, rank_id) REFERENCES clan_ranks(clan_id, id)
);
CREATE INDEX clan_members_rank_idx ON clan_members(rank_id);

CREATE TABLE clan_applications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clan_id     uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  message     text CHECK (message IS NULL OR char_length(message) <= 200),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'cancelled')),
  decided_by  uuid REFERENCES players(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE UNIQUE INDEX clan_applications_pending_idx ON clan_applications(clan_id, player_id) WHERE status = 'pending';
CREATE INDEX clan_applications_player_idx ON clan_applications(player_id, created_at DESC);

CREATE TABLE clan_invitations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clan_id     uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  invited_by  uuid REFERENCES players(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  decided_at  timestamptz
);
CREATE UNIQUE INDEX clan_invitations_pending_idx ON clan_invitations(clan_id, player_id) WHERE status = 'pending';
CREATE INDEX clan_invitations_player_idx ON clan_invitations(player_id, created_at DESC);

-- ---------------------------------------------------------------- diplomasi
-- Çift başına tek satır (clan_a < clan_b). İttifak/saldırmazlık: 'proposed' → karşı taraf onaylarsa 'active'.
-- Savaş: ilan edilince hemen 'active'. Barış: iki taraf da önerdiğinde satır silinir.
CREATE TABLE clan_diplomacy (
  clan_a            uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  clan_b            uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  relation          text NOT NULL CHECK (relation IN ('alliance', 'non_aggression', 'war')),
  status            text NOT NULL CHECK (status IN ('proposed', 'active')),
  proposed_by       uuid NOT NULL,
  peace_proposed_by uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  activated_at      timestamptz,
  PRIMARY KEY (clan_a, clan_b),
  CHECK (clan_a < clan_b),
  CHECK (proposed_by IN (clan_a, clan_b)),
  CHECK (peace_proposed_by IS NULL OR (relation = 'war' AND peace_proposed_by IN (clan_a, clan_b))),
  CHECK (relation <> 'war' OR status = 'active')
);
CREATE INDEX clan_diplomacy_b_idx ON clan_diplomacy(clan_b);

-- ---------------------------------------------------------------- klan hazinesi
CREATE TABLE clan_wallets (
  clan_id       uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES currencies(code),
  balance       bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_id, currency_code)
);

CREATE TABLE clan_treasury_ledger (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clan_id         uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  currency_code   text NOT NULL REFERENCES currencies(code),
  delta           bigint NOT NULL CHECK (delta <> 0),
  balance_after   bigint NOT NULL CHECK (balance_after >= 0),
  reason          text NOT NULL,
  -- Hareketin ilgili olduğu pilot (yatıran, ödeme alan, vergi veren) ve işlemi yapan pilot
  player_id       uuid REFERENCES players(id) ON DELETE SET NULL,
  actor_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  ref_type        text,
  ref_id          text,
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clan_treasury_ledger_clan_idx ON clan_treasury_ledger(clan_id, id DESC);

-- Defter yalnızca eklenebilir; tek istisna ilgili pilotun silinmesiyle (FK) NULL'a dönen pilot sütunları.
CREATE OR REPLACE FUNCTION forbid_clan_ledger_update() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'player_id' - 'actor_player_id') = (to_jsonb(OLD) - 'player_id' - 'actor_player_id')
     AND (NEW.player_id IS NULL OR NEW.player_id = OLD.player_id)
     AND (NEW.actor_player_id IS NULL OR NEW.actor_player_id = OLD.actor_player_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'clan_treasury_ledger kayıtları değiştirilemez';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER clan_treasury_ledger_immutable BEFORE UPDATE ON clan_treasury_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_clan_ledger_update();

-- ---------------------------------------------------------------- klan etkinlik kaydı (adlar o anki haliyle saklanır)
CREATE TABLE clan_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clan_id     uuid NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  actor_name  text,
  target_name text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clan_events_clan_idx ON clan_events(clan_id, id DESC);

-- ---------------------------------------------------------------- arkadaşlık, engelleme, gizlilik
-- İstek: (gönderen → alan, 'pending'). Kabulde iki yönlü 'accepted' satırı bulunur.
CREATE TABLE friendships (
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  PRIMARY KEY (player_id, friend_id),
  CHECK (player_id <> friend_id)
);
CREATE INDEX friendships_friend_idx ON friendships(friend_id, status);

CREATE TABLE player_blocks (
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, blocked_id),
  CHECK (player_id <> blocked_id)
);
CREATE INDEX player_blocks_blocked_idx ON player_blocks(blocked_id);

CREATE TABLE player_social_settings (
  player_id         uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  -- Grup üyeleri senin konumunu nasıl görür: harita + koordinat / yalnızca harita adı / gizli
  location_sharing  text NOT NULL DEFAULT 'group' CHECK (location_sharing IN ('group', 'map', 'none')),
  -- Arkadaşların çevrimiçi durumunu ve bulunduğun haritayı görebilir mi
  friends_see_online boolean NOT NULL DEFAULT true,
  dm_policy         text NOT NULL DEFAULT 'everyone' CHECK (dm_policy IN ('everyone', 'friends', 'nobody')),
  group_invites     text NOT NULL DEFAULT 'everyone' CHECK (group_invites IN ('everyone', 'friends_clan', 'nobody')),
  friend_requests   boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- sohbet
-- channel: 'global' · 'company:<KOD>' · 'map:<KOD>' · 'clan:<uuid>' · 'group:<id>' · 'dm:<küçük uuid>:<büyük uuid>'
CREATE TABLE chat_messages (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id    smallint NOT NULL REFERENCES game_servers(id),
  channel      text NOT NULL CHECK (channel ~ '^(global|company:[A-Z]{2,5}|map:[A-Z0-9-]{1,12}|clan:[0-9a-f-]{36}|group:[A-Za-z0-9-]{1,40}|dm:[0-9a-f-]{36}:[0-9a-f-]{36})$'),
  sender_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES players(id) ON DELETE CASCADE,
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  -- Filtre bir kelimeyi maskelediyse true (moderasyon için; gönderilen metin zaten maskelidir)
  filtered     boolean NOT NULL DEFAULT false,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((channel LIKE 'dm:%') = (recipient_id IS NOT NULL))
);
CREATE INDEX chat_messages_channel_idx ON chat_messages(server_id, channel, id DESC);
CREATE INDEX chat_messages_sender_idx ON chat_messages(sender_id, id DESC);

-- ---------------------------------------------------------------- şikâyetler (moderasyon kuyruğu; yönetim ekranı Aşama 14)
CREATE TABLE reports (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reporter_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  target_type        text NOT NULL CHECK (target_type IN ('player', 'chat_message', 'clan', 'forum_post', 'forum_thread')),
  target_id          text NOT NULL,
  target_player_id   uuid REFERENCES players(id) ON DELETE SET NULL,
  reason             text NOT NULL CHECK (reason IN ('spam', 'insult', 'cheating', 'inappropriate_name', 'scam', 'other')),
  details            text CHECK (details IS NULL OR char_length(details) <= 500),
  -- Şikâyet anındaki içerik (mesaj metni, pilot/klan adı): içerik sonradan değişse de kanıt korunur
  snapshot           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'actioned', 'dismissed')),
  handled_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- Aynı kişi aynı içeriği açık bir şikâyet varken tekrar şikâyet edemez
CREATE UNIQUE INDEX reports_open_unique_idx ON reports(reporter_user_id, target_type, target_id) WHERE status IN ('open', 'in_review');
CREATE INDEX reports_queue_idx ON reports(status, created_at);

-- ---------------------------------------------------------------- bildirimler
CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL CHECK (char_length(title) <= 120),
  body       text CHECK (body IS NULL OR char_length(body) <= 300),
  link       text CHECK (link IS NULL OR link ~ '^/[A-Za-z0-9/_?=&%.-]*$'),
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_player_idx ON notifications(player_id, id DESC);
CREATE INDEX notifications_unread_idx ON notifications(player_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------- ayarlar (Yönetim Merkezi'nden düzenlenecek)
INSERT INTO game_settings (key, value) VALUES
  ('clan', '{"create_cost": {"currency": "KREDI", "amount": 50000}, "create_min_level": 5, "max_members": 50,
             "invitation_days": 7, "max_relations": 10}'::jsonb),
  ('social', '{"max_friends": 200, "max_blocks": 500, "party_max": 8, "party_invite_seconds": 60,
               "notification_keep": 200}'::jsonb),
  ('chat', '{"max_length": 300, "rate_count": 5, "rate_window_seconds": 10, "history": 50, "mute_seconds": 60,
             "banned_words": ["amk", "aq", "amq", "amına", "amina", "orospu", "orosbu", "piç", "pic", "siktir", "sikerim",
                              "sikeyim", "yarrak", "yarak", "pezevenk", "kahpe", "gavat", "ibne", "götveren", "oç", "oc",
                              "ananı", "anani", "şerefsiz", "serefsiz"]}'::jsonb)
ON CONFLICT (key) DO NOTHING;
