-- =====================================================================================
-- TÜRK ORBIT — Migration 0011: Mobil uygulama (Aşama 15)
--
--  * Ayar 'client': Android/iOS uygulamasının desteklenen en düşük sürümü ve mağaza bağlantıları.
--    API, X-Client-Platform android/ios olan ve X-Client-Version'ı bu sürümden eski istekleri 426 (CLIENT_OUTDATED)
--    ile reddeder; uygulama "Güncelleme gerekli" ekranını açar. Web istemcisi etkilenmez.
--    Yönetim Merkezi → İçerik → Ayarlar → "Mobil uygulama sürümü" ile taslak/yayın/geri alma akışıyla değiştirilir.
--  * Yeni tablo yok. Mobil oturumlar Aşama 1'deki sessions tablosunu kullanır (transport = 'token',
--    platform = 'android' | 'ios', device_name, app_version).
-- =====================================================================================

INSERT INTO game_settings (key, value) VALUES
  ('client', '{"min_version": {"android": "0.15.0", "ios": "0.15.0"}, "store_url": {"android": null, "ios": null}, "message": "Türk Orbit''in yeni sürümü yayında. Oynamaya devam etmek için uygulamayı güncelle."}')
ON CONFLICT (key) DO NOTHING;
