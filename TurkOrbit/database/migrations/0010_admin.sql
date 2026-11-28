-- =====================================================================================
-- TÜRK ORBIT — Migration 0010: Yönetim Merkezi (Aşama 14)
--
--  * Yaptırımlar (sanctions): uyarı, susturma, askıya alma, kalıcı ban, hesap kilidi. Hesap durumu (users.status,
--    suspended_until, locked_until) yine tek doğruluk kaynağıdır; yaptırım kaydı geçmişi ve gerekçeyi tutar.
--  * İçerik sürümleri (content_revisions): taslak → yayın → geri alma. Her sürüm kaydın o anki tam halini taşır.
--    İlk düzenlemede kaydın mevcut hali "sürüm 1" olarak yazılır; böylece ilk değişiklik de geri alınabilir.
--    Aynı kayıtta aynı anda tek taslak ve tek yayındaki sürüm olabilir (kısmi benzersiz dizinler).
--  * Onay talepleri (approval_requests): iki yetkili onayı. Talep eden kendi talebini onaylayamaz (CHECK).
--  * Ayarlar: bakım modu ve yönetim eşikleri.
-- =====================================================================================

-- ---------------------------------------------------------------- yaptırımlar
CREATE TABLE sanctions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('warning', 'mute', 'suspension', 'ban', 'lock')),
  -- Personelin gördüğü gerekçe (denetim için) ve oyuncuya gösterilen metin
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  public_reason text CHECK (public_reason IS NULL OR char_length(public_reason) <= 300),
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz,                               -- NULL = kalıcı (uyarıda anlamsız)
  issued_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_label  text NOT NULL,
  -- Kaynak şikâyet (şikâyet kuyruğundan verildiyse)
  report_id     bigint REFERENCES reports(id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  -- Süreli olması gerekenler: susturma, askı ve kilit
  CHECK (kind NOT IN ('mute', 'suspension', 'lock') OR ends_at IS NOT NULL),
  CHECK (kind <> 'ban' OR ends_at IS NULL),
  CHECK (revoked_at IS NOT NULL OR (revoked_by IS NULL AND revoke_reason IS NULL))
);
CREATE INDEX sanctions_user_idx ON sanctions(user_id, created_at DESC);
-- Oyun sunucusunun ve forumun susturma sorgusu
CREATE INDEX sanctions_active_mute_idx ON sanctions(user_id, ends_at) WHERE kind = 'mute' AND revoked_at IS NULL;

-- Şikâyet kuyruğu: karar notu
ALTER TABLE reports ADD COLUMN resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500);

-- ---------------------------------------------------------------- içerik sürümleri
CREATE TABLE content_revisions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type    text NOT NULL CHECK (entity_type IN ('npc_type', 'ship_type', 'shop_offer', 'quest', 'map', 'setting')),
  entity_id      text NOT NULL CHECK (char_length(entity_id) BETWEEN 1 AND 60),
  version        integer NOT NULL CHECK (version > 0),
  -- Taslağın üzerine kurulduğu yayındaki sürüm: yayın anında güncel değilse (başkası araya girdiyse) reddedilir
  base_version   integer,
  data           jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  status         text NOT NULL CHECK (status IN ('draft', 'published', 'superseded', 'rolled_back', 'discarded')),
  -- false: değişiklik oyun sunucusu yeniden başlatılınca etkili olur
  hot_reloadable boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_label  text NOT NULL,
  published_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  note           text CHECK (note IS NULL OR char_length(note) <= 300),
  UNIQUE (entity_type, entity_id, version),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE UNIQUE INDEX content_revisions_one_draft ON content_revisions(entity_type, entity_id) WHERE status = 'draft';
CREATE UNIQUE INDEX content_revisions_one_published ON content_revisions(entity_type, entity_id) WHERE status = 'published';
CREATE INDEX content_revisions_entity_idx ON content_revisions(entity_type, entity_id, version DESC);

-- ---------------------------------------------------------------- onay talepleri
CREATE TABLE approval_requests (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action          text NOT NULL CHECK (action IN ('economy.grant', 'player.ban.permanent', 'role.grant.super_admin')),
  payload         jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  -- Listede gösterilecek kısa özet (ör. "AnadoluKartali → 5.000.000 Kredi")
  summary         text NOT NULL CHECK (char_length(summary) <= 200),
  requested_by    uuid NOT NULL REFERENCES users(id),
  requested_label text NOT NULL,
  reason          text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rejected', 'expired', 'executed', 'failed')),
  reviewed_by     uuid REFERENCES users(id),
  reviewed_label  text,
  reviewed_at     timestamptz,
  review_note     text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  result          jsonb,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- İki yetkili kuralı veritabanı seviyesinde: talep eden kendi talebini onaylayamaz/reddedemez
  CONSTRAINT approval_two_person CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by),
  CHECK (expires_at > created_at),
  CHECK (status = 'pending' OR status = 'expired' OR reviewed_by IS NOT NULL)
);
CREATE INDEX approval_requests_pending_idx ON approval_requests(status, created_at) WHERE status = 'pending';

-- ---------------------------------------------------------------- ayarlar
INSERT INTO game_settings (key, value) VALUES
  -- Bakım modu: açıkken oyuna yalnızca personel girebilir; site, forum ve destek açık kalır
  ('maintenance', '{"enabled": false, "message": "Türk Orbit bakımda. Kısa süre içinde geri döneceğiz."}'),
  -- Yönetim eşikleri: bu tutarın üstündeki para/eşya verme işlemleri ikinci bir yetkilinin onayını ister
  ('admin', '{"grant_approval_threshold": {"KREDI": 1000000, "AKCE": 5000}, "grant_item_approval_threshold": 50, "approval_hours": 72}')
ON CONFLICT (key) DO NOTHING;
