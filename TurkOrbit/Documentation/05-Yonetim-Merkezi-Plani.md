# 05 — TÜRK ORBIT YÖNETİM MERKEZİ: Modül Planı

**Uygulama:** `apps/admin` (React, koyu uzay teması, Türkçe, sol menü + üst sistem durum çubuğu, mobil/tablet uyumlu)
**API:** `/api/v1/admin/*`. Her uç nokta `requireAuth` + `requirePermission('<yetki>')` korumasıyla çalışır (koruma Aşama 1'de yazıldı ve test edildi).
**Altın kural:** Panelde değiştirilen her değer gerçek oyuna yansır. Sahte veya işlevsiz buton bırakılmaz: bir özelliğin backend'i hazır değilse menüde **gösterilmez**.

## 1. Rol → yetki matrisi (uygulandı: `packages/shared/src/roles.ts` + veritabanı tohumu)

| Yetki grubu | Süper | Sistem | Oyun | Topluluk | Moderatör | Destek | İçerik | Salt okunur |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Pano (`dashboard.view`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Oyuncu görüntüleme | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ |
| Uyarı / geçici ban | ✔ | – | ✔ | ✔ | ✔ | – | – | – |
| Ban kaldırma / oturum sonlandırma | ✔ | oturum | ✔ | ✔ | – | – | – | – |
| Hesap kilitleme, envanter düzenleme | ✔ | – | ✔ | – | – | – | – | – |
| Gemi/ekipman/NPC/harita/görev/etkinlik yazma | ✔ | – | ✔ | – | – | – | ✔ | – |
| Ekonomi yazma, para/eşya verme | ✔ | – | ✔ | – | – | – | – | – |
| Klan / forum yönetimi | ✔ | – | klan + forum moderasyonu | ✔ | forum moderasyonu | – | – | – |
| Destek talepleri | ✔ | – | okuma | ✔ | okuma | ✔ | – | ✔ (okuma) |
| Sistem, bakım, yedek, bildirim | ✔ | ✔ | – | bildirim | – | – | – | ✔ (okuma) |
| Oyun ayarları, platform/sürüm | ✔ | ✔ | okuma | – | – | – | – | ✔ (okuma) |
| Rol atama (`roles.assign`) | ✔ | – | – | – | – | – | – | – |
| Yayınlama / geri alma | ✔ | – | ✔ | – | – | – | yayın | – |
| Onay inceleme (`approvals.review`) | ✔ | – | – | – | – | – | – | – |
| Denetim kaydı (`audit.read`) | ✔ | ✔ | ✔ | – | – | – | – | ✔ |

Yetkiler **yalnızca sunucuda** denetlenir. Arayüz, `/auth/me` yanıtındaki `permissions` listesine göre menü öğelerini gösterir veya gizler; bu sadece kolaylık içindir, güvenlik sunucudadır.

## 2. Modüller

### 15.1 Ana pano
Toplam/çevrimiçi oyuncu (Redis `online:*` + `server_nodes`), günlük kayıt (`users.created_at`), aktif sunucular, harita başına oyuncu, canlı NPC sayısı (oyun sunucusu metrikleri), aktif etkinlikler, açık destek talepleri, son yönetici işlemleri (`admin_audit_log`), CPU/RAM/WebSocket/ortalama ping (`server_nodes.metrics`), veritabanı durumu (`/health`), sistem hataları (`client_error_reports` + sunucu logları). Veriler 5 sn'de bir yenilenir (SSE/WebSocket).

### 15.2 Oyuncu yönetimi
Arama (kullanıcı adı, e-posta, Oyuncu ID, IP), profil, giriş geçmişi (`login_events`), aktif harita ve çevrimiçi durum (Redis), seviye/şeref/istatistik, gemi/ekipman/envanter, klan, görevler. **İşlemler:** uyarı, geçici ban, kalıcı ban, ban kaldırma, oturum sonlandırma, hesap kilitleme. Her işlem `sanctions` + `admin_audit_log` kaydı oluşturur, oturumları iptal eder ve Redis oturum önbelleğini temizler. Ban, hesabın açık oturumlarını anında düşürür (Aşama 1'de oturum doğrulaması ban durumunu zaten denetliyor).

### 15.3 Gemi yönetimi · 15.4 Ekipman yönetimi
`ship_types` / `item_types` için ekleme, düzenleme, arşivleme, görsel değiştirme (varlık yükleme), can/kalkan/hız/slot, fiyat, satışa açma/kapama, yükseltme seviyeleri (`upgrade_levels`), kullanım koşulları. Önizleme → yayın → geri alma (`content_revisions`). Yayında oyun sunucularına `content:updated` gönderilir. Mağaza fiyatı değişikliği bir sonraki mağaza isteğinde yansır.

### 15.5 NPC yönetimi
`npc_types` (görsel, can, kalkan, hasar, hız, yapay zekâ parametreleri, boss yetenekleri, ödül tablosu) ve `npc_spawns` (harita yerleşimi, doğma sıklığı, maksimum sayı, haritaya özel çarpanlar). **Canlı yansıma:** Yayınlanan can değeri yeni doğan NPC'lere doğrudan uygulanır. Yaşayan NPC'lerin canı oransal ölçeklenir (seçenekle "yeniden doğur" da yapılabilir).

### 15.6 Harita yönetimi
Harita oluşturma/düzenleme/arşivleme, arka plan, NPC/kaynak yerleştirme (görsel harita düzenleyici: sürükle-bırak alanlar), portal ekleme, güvenli alanlar (`map_zones`), sınırlar, giriş şartları, **bakım için haritayı kapatma** (`maps.is_closed`: oyuncular en yakın açık haritaya taşınır). Boyut/topoloji değişikliği "yeniden başlatma gerekir" olarak işaretlenir.

### 15.7 Görev ve etkinlik yönetimi
Görev oluşturma/düzenleme, hedefler (`quest_objectives`), ödül tablosu, zincir (`prerequisite_quest_id`), başlangıç/bitiş, günlük/haftalık/etkinlik kategorileri, etkinlik haritaları, özel NPC'ler, duyurular. Yayımlanan görev oyuncunun görev ekranında bir sonraki listelemede görünür.

### 15.8 Ekonomi ve mağaza yönetimi
Para birimleri, kaynaklar, fiyatlar, mağaza kategorileri, indirimler, paketler, ödül tabloları, açık artırma programı, üretim tarifleri, günlük bonuslar. **Oyuncuya para/eşya verme** (`economy.grant`) her zaman gerekçe ister, deftere `actor_user_id` ile yazılır ve eşik üstü tutarlarda **iki yetkili onayı** (`approval_requests`) gerektirir.

### 15.9 Klan, forum ve destek yönetimi
Klan listesi/üyeleri/liderlik devri, grup gözlemi, sohbet raporları (`reports`), şikâyetler, forum kategorileri, konu yönetimi (sabitle/kilitle/taşı/sil), moderatör atama (`forum_moderators`), destek talepleri (atama, yanıt, iç not, durum).

### 15.10 Sunucu ve sistem yönetimi
Sunucu durumları (`server_nodes`), bağlantı sayısı, WebSocket durumu, ortalama ping, CPU/RAM, veritabanı durumu, hata kayıtları, sistem logları, yedekleme başlatma/listeleme (`backups`), geri yükleme talimatı (geri yükleme **iki yetkili onayı** ve bakım modu ister), bakım modu (`maintenance_windows`), bildirim gönderme. Sunucu başlatma/durdurma yalnızca desteklenen altyapı üzerinden yapılır (systemd/PM2 API'si, yetkili ve denetimli). Panelden keyfi kabuk komutu çalıştırılmaz.

### 15.11 Oyun ayarları
Oyun adı, web sitesi, **kayıt açık/kapalı** (✅ `game_settings.registration.enabled` Aşama 1'de API tarafından uygulanıyor ve test edildi), **başlangıç paraları** (✅ `starter.currencies`, Aşama 5), **şirket değiştirme bekleme süresi ve ücreti** (✅ `company.change`, Aşama 5), sunucu seçimi, başlangıç değerleri, deneyim/ödül/NPC doğma çarpanları, etkinlik ve sohbet ayarları, bildirimler, özellik bayrakları (`feature_flags`), sürüm bilgileri.

### 15.12 Yetki sistemi
8 personel rolü + oyuncu (uygulandı). Rol atama Aşama 1'de **yalnızca sunucu tarafı CLI** ile yapılabiliyor. Aşama 14'te panelden atama eklenecek. Bu atama `roles.assign` yetkisi ister. Bir yönetici kendi rütbesinden yüksek bir rolü atayamaz (`ROLE_RANK`). `super_admin` ataması iki yetkili onayı ister.

### 15.13 Değişiklik yayınlama ve geri alma
Her içerik düzenlemesi taslak olarak kaydedilir (`content_revisions.status='draft'`). **Önizleme:** fark görünümü (önceki ↔ yeni) ve etkilenen oyuncu tahmini (ör. bu eşyaya sahip oyuncu sayısı, bu haritadaki oyuncular). **Yayın:** tek transaction'da tablo güncellemesi + sürüm `published` + denetim kaydı + `content:updated` yayını. **Geri alma:** önceki sürümü yeniden yayımlama. Sıcak uygulanamayan değişiklikler ekranda açıkça "yeniden başlatma gerekir" olarak işaretlenir ve bakım modu önerilir.

### 15.14 Yönetici işlem geçmişi
`admin_audit_log` (✅ uygulandı): yönetici ID ve etiketi, işlem türü, tarih, önceki/yeni değer (JSON), gerekçe, sonuç, IP. Kayıtlar değiştirilemez ve silinemez (veritabanı tetikleyicisi, test edildi). Kritik işlemler onay penceresi + gerekçe ister. Tanımlı işlemler `approval_requests` ile ikinci bir yetkiliye gider; talep eden kişi kendi talebini onaylayamaz (veritabanı CHECK kısıtı).

### 15.15 Tasarım
Koyu uzay teması (oyun istemcisiyle ortak tasarım değişkenleri), sol menü, üst durum çubuğu (çevrimiçi oyuncu, sunucu sağlığı, bakım modu), genel arama, filtreleme, sayfalama, tablolar, grafikler (zaman serisi), düzenleme pencereleri, mobil/tablet uyumu.

### 16.7 Platform yönetimi
PC/Android/iOS sürüm durumu (`client_releases`), platform bazlı oyuncu sayısı (`sessions.platform`), cihaz/işletim sistemi istatistikleri (`sessions.os`, `client_error_reports`), platform bazlı hatalar, minimum desteklenen sürüm, güncelleme duyuruları, bakım yönetimi.

## 3. Aşama 14 kabul ölçütleri (özet)
- Her modül için: yetkisiz rol → 403 (otomatik test), yetkili rol → işlem + denetim kaydı (otomatik test).
- "NPC canı değişince oyunda değişir", "fiyat değişince mağazada değişir", "görev yayımlanınca oyuncu görür" senaryoları **iki hesapla** (yönetici + oyuncu) uçtan uca test edilir.
