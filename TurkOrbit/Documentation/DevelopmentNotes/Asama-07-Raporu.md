# Aşama Raporu — Aşama 7: Harita ve Oyun Motoru

**Tarih:** 27.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-07-Harita-Oyun-Motoru.zip`

> **Kapsam notu:** Bu aşama **tek oyunculu** harita ve oyun motorudur.
> - Pilot kendi gemisini uçurur, haritalar arasında geçer. Diğer oyuncular, NPC'ler ve savaş henüz yoktur.
> - Hareket istemcide simüle edilir; sunucu her konum bildirimini hız denetiminden geçirir.
> - Gerçek zamanlı çok oyunculu dünya (WebSocket, sunucu tarafı hareket, diğer oyuncuları görme) **Aşama 8**'dir.

## 1. Tamamlanan işler

| İstenen | Durum | Ayrıntı |
|---|---|---|
| Oyun motoru | ✅ | Phaser 3.90 (WebGL, Canvas yedeği); ayrı parça olarak yalnızca `/oyna` açılınca indirilir |
| Haritalar | ✅ | 21 harita; 30 çift yönlü bağlantı (60 geçit), 51 bölge (istasyon, güvenli bölge, kaynak alanı), galaksi koordinatları |
| Harita görünümü | ✅ | Paralaks yıldız katmanları, bulutsu ışıltısı, ızgara ve harita sınırı, dönen istasyon, asteroit alanları, geçitler ve atlama yarıçapı halkası |
| Gemi | ✅ | Hangardaki gemi çizimi uzayda kullanılır (aynı tasarım, şirket rengi); motor izi parçacıkları; yöne dönüş |
| Hareket (PC) | ✅ | WASD + ok tuşları, fare ile tıkla-git, fare tekerleğiyle yakınlaştırma |
| Hareket (mobil/tablet) | ✅ | Sanal joystick veya dokun-git; iki parmakla ve ＋/－ ile yakınlaştırma; mini haritaya dokunarak hedef |
| Sunucu doğrulaması | ✅ | Konum aktif geminin **sunucuda hesaplanan hızına** göre denetlenir. Aşan konum kaydedilmez, istemci sunucu konumuna çekilir, ret kaydı yazılır |
| Geçitler | ✅ | Sunucu sırayla denetler: geçit bu haritada mı, konum doğrulanıyor mu, atlama yarıçapı içinde mi, hedef haritanın seviye/şirket/bakım koşulu sağlanıyor mu. Her geçiş kaydedilir |
| Kilitli haritalar | ✅ | Seviye şartı ve düşman şirket bölgesi (seviye 15) Türkçe sebeple gösterilir; buton pasif |
| Harita bakımı | ✅ | Kapatılan haritadaki pilot, bağlandığında şirketinin ana haritasına taşınır ve bildirim alır |
| HUD | ✅ | Pilot paneli (can, kalkan, harita, PvP/güvenli, koordinat, FPS), mini harita, geçit kutusu, bildirimler, üst çubuk (galaksi, ayarlar, tam ekran, hangar) |
| Mini harita | ✅ | İstasyon, bölgeler, geçitler (kilitli olanlar kırmızı), gemi yönü ve hedef çizgisi. Madde 18 gereği NPC ve düşmanlar sürekli gösterilmez (Aşama 8-9'da algılama menziliyle eklenecek) |
| Galaksi haritası | ✅ | 21 harita ve bağlantılar, bulunulan harita, erişim ve kilit sebebi |
| Ayarlar | ✅ | Kontroller (joystick tarafı/boyutu/şeffaflığı/yüksekliği, dokun-git, klavye), tuş atamaları, grafik kalitesi, FPS sınırı (30/60/120), FPS göstergesi, arayüz ölçeği, mini harita boyutu, koordinatlar. Hesap ve cihaz sınıfı başına sunucuda saklanır |
| Ekran uyumu | ✅ | Telefon dikey/yatay, tablet, masaüstü düzenleri; çentik ve gezinme çubuğu için güvenli alanlar; telefonda dikey tutuşta yatay mod önerisi |
| Geçiş yolları | ✅ | Menüde **Oyna**, pilot ve hangar sayfalarında **Uzaya çık** |

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0004_world.sql` |
| Ortak paket | `packages/shared/src/world.ts`, `world.test.ts` |
| API | `apps/api/src/modules/world/{service,routes}.ts`, `apps/api/src/modules/hangar/stats.ts` |
| API testleri | `apps/api/test/world.test.ts` (13 test) |
| İstemci | `apps/client/src/game/{SpaceScene,controller,textures}.ts`, `apps/client/src/pages/GamePage.tsx`, `apps/client/src/components/game/{GameHud,SettingsPanel}.tsx`, `apps/client/src/styles/game.css` |
| Belgeler | `Documentation/Asama-07-Harita-Oyun-Motoru/{API-Referansi,Kurulum-ve-Dosya-Yerlestirme-Rehberi}.md`, bu rapor, 9 ekran görüntüsü |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/app.ts` | Dünya ve ayar rotaları; CORS'a PUT |
| `apps/api/src/modules/player/service.ts` | Şirket değişiminde konum zamanı güncellenir (hız denetimi için) |
| `apps/api/test/helpers.ts` | Hareket/geçit ayarlarının tohumlanması, harita durumunun sıfırlanması, PUT desteği |
| `packages/shared/src/{api-types,index}.ts` | Yeni hata kodları ve dışa aktarımlar |
| `apps/client/src/{App.tsx, api/client.ts, components/Layout.tsx, pages/PilotPages.tsx, pages/HangarPages.tsx, styles/global.css}` | `/oyna` rotası (geç yükleme), PUT isteği, Oyna menüsü, Uzaya çık butonları |
| `apps/client/vite.config.ts`, `apps/client/package.json` | Phaser bağımlılığı; Phaser ayrı parça |
| `database/schema-draft.sql` | 0004'te uygulanan tablolar taslaktan çıkarıldı |
| `scripts/e2e-auth.mjs`, `scripts/ui-e2e.mjs` | Dünya, geçit, ayar ve oyun ekranı senaryoları |
| `Documentation/{03,04,07}`, `README.md`, `Documentation/README.md`, `Karar-Gunlugu.md` | Aşama 7 durumu, tablolar, kontroller, K-033…K-038 |

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 38/38. 7 yeni: harita giriş koşulları, hız denetimi, ayar şeması ve varsayılanları |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis**) | ✅ 117/117 (13 yeni) |
| API uçtan uca (gerçek süreç + SMTP, **iki hesap**) | ✅ 32/32 adım (6 yeni) |
| Tarayıcı uçtan uca (Chromium masaüstü + iPhone 13 dikey ve yatay) | ✅ 35/35 adım (13 yeni), 9 yeni ekran görüntüsü |
| Migration 0004 (geliştirme DB) + taslak zinciri | ✅ |
| `npm run build` | ✅ Hesap ekranları 111 KB, oyun ekranı 12 KB, Phaser 332 KB (gzip) |

**Tarayıcıda gerçekten denenen senaryolar:**
- **Klavye ve fare:** D tuşu basılı tutulunca gemi sağa gitti, konum sunucuya yazıldı ve HUD ile aynı çıktı. Ekrana tıklanınca gemi hedefe yöneldi.
- **Sunucu düzeltmesi:** Sunucudaki konum değiştirildikten sonra istemcinin gönderdiği adım reddedildi. İstemci sunucu konumuna çekildi ve Türkçe uyarı gösterdi.
- **Geçitler:** Seviye 5 isteyen G-4 geçidinde buton pasifti ve sebep yazılıydı. G-2 geçidinde J tuşuyla atlandı. G-2 yüklendi, geçiş kaydedildi ve geçişten sonra yanlış ret oluşmadı.
- **Galaksi ve ayarlar:** M tuşu galaksi haritasını açtı. Galaksi tuşu G olarak değiştirilip kaydedildi; G tuşu haritayı açtı ve ayar sunucuda doğrulandı.
- **Telefon:**
  - PC'de geçilen G-2 telefonda açıldı (hesap senkronu).
  - Joystick sağa çekilince gemi gitti ve konum sunucuya yazıldı.
  - Yatay düzen çalıştı.
  - Joystick sağa alınınca telefon ayarı ayrı saklandı; masaüstü ayarı değişmedi.
- **Hata kontrolü:** Oyun ekranlarında hiç JavaScript hatası oluşmadı.

**API uçtan uca (iki hesap):**
- Işınlanma girişimi reddedildi ve sunucu konumu döndü. 250 ms'den sık güncelleme 429 aldı.
- Pilot B, başka haritanın geçidini kullanamadı (`PORTAL_NOT_FOUND`) ve uzaktan atlayamadı (`TOO_FAR_FROM_PORTAL`).
- Kilitli harita 403 döndü.
- Bakıma alınan haritadaki pilot ana haritasına taşındı ve bildirim aldı.
- Ayarlar hesaplar arasında sızmadı; geçersiz değer reddedildi.

**FPS ölçümü (dürüst not):** Test ortamı ekran kartı olmayan bir sunucuda başsız Chromium ile yazılımsal çizim (SwiftShader) kullanıyor. Burada ölçülen değerler **16 FPS (masaüstü 1280×860)** ve **25 FPS (iPhone 13 emülasyonu)**. Bu değerler gerçek cihaz performansını göstermez. Gerçek cihaz ölçümü Aşama 15-16'da yapılacak.

## 5. Geliştirme sırasında bulunan ve düzeltilen sorunlar
1. **Gemi dokusu yüklenmiyordu:** Phaser yükleyicisi `data:` adreslerini base64 olarak çözüyor. URL-kodlu SVG `atob` hatası verdi ve sahne hiç başlamadı. Gemi SVG'si UTF-8 güvenli base64 ile üretildi.
2. **Düşük FPS'te gemi yavaşlıyordu:** Phaser'ın "yumuşatılmış" kare süresi FPS düştüğünde veya pencere odakta değilken her kareyi yaklaşık 16 ms ile sınırlıyor. 16 FPS'te gemi gerçek hızının yaklaşık %30'uyla gidiyordu; zayıf telefonlarda da olacaktı. Hareket artık gerçek geçen süreye göre, 50 ms'lik alt adımlarla hesaplanıyor.
3. **Geçişten sonra yanlış "konum düzeltildi" uyarısı:** Atlamadan sonraki ~250 ms'lik kararmada sahne eski haritanın konumunu yazmaya devam ediyordu. Senkronizasyon bu konumu yeni haritaya gönderdi ve sunucu reddetti. Düzeltmeler:
   - Kararma sırasında sahne konum yazmayı bırakıyor.
   - Geçiş isteği, süren konum bildiriminin bitmesini bekliyor.
   - Geçişten önce gönderilmiş eski bir bildirimin yanıtı artık yok sayılıyor.
   - Sayfadan çıkarken yapılan son gönderim, konum değişmediyse atlanıyor.

   Testte geçişten sonra hiç ret oluşmadığı doğrulandı.
4. **Eşzamanlı sorgu:** Hız denetiminde aynı işlem (transaction) istemcisine paralel sorgu gönderiliyordu (pg kütüphanesi uyarısı, pg@9'da hata olacak). Sorgular sıralı hale getirildi.
5. **Erişilebilirlik:** Telefonda yazısı gizlenen HUD butonlarının ekran okuyucu adı yoktu. `aria-label` eklendi.
6. **Yerleşim:**
   - Masaüstünde yardım satırı geçit kutusunun altına giriyordu.
   - Telefonda yatay mod önerisi mini haritanın üstüne biniyordu.
   - İkisi de yeniden konumlandırıldı.

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Diğer oyuncular görünmez; hareket istemcide simüle edilir (sunucu yalnızca hızı denetler) | Aşama 8: WebSocket, sunucu tarafı hareket, tahmin/uzlaştırma/enterpolasyon |
| 2 | Konum yaklaşık saniyede bir gönderilir. Sekme kapanırken veya sayfadan çıkılırken son konum ayrıca gönderilir (`keepalive`). Tarayıcı çökerse ya da ağ kesilirse en fazla son ~1 sn'lik hareket kaybolur | Aşama 8 (sürekli bağlantı) |
| 3 | Aynı hesap iki cihazda aynı anda oyundaysa iki istemci de konum gönderebilir. Sunucu hızı denetler ama "tek aktif oyun oturumu" kuralı yok | Aşama 8: oyun bileti ve tek oturum |
| 4 | NPC, kargo, savaş, hedef seçme ve ateş butonları yok | Aşama 9 |
| 5 | Güvenli bölge ve istasyon yalnızca görsel. "Yalnızca istasyonda ekipman değiştirme" ve "güvenli bölgede saldırı yok" kuralları savaşla birlikte uygulanacak | Aşama 8-9 |
| 6 | Kaynak alanları görsel; madencilik yok | Aşama 11 |
| 7 | Otomatik grafik kademesi seçimi ve sürükle-bırak düğme düzenleme modu yok (ayarlar elle değiştirilebilir) | Aşama 16 |
| 8 | Gerçek cihaz testi yok (yalnızca emülasyon ve yazılımsal çizim) | Aşama 15-16 |
| 9 | iPhone Safari tam ekran API'sini desteklemez; buton orada gizlenir. Manifest `display: fullscreen` ayarlı olduğu için ana ekrana eklenen uygulama tarayıcı çubukları olmadan açılmalıdır (gerçek cihazda denenmedi) | Aşama 15 (Capacitor) |

## 7. Sonraki aşama
**Aşama 8: Multiplayer.**
- `apps/game-server`: WebSocket oyun sunucusu, oyun bileti ile kimlik doğrulama, harita başına oda.
- Sunucu tarafı hareket: istemci yalnızca niyet gönderir.
- Tahmin, uzlaştırma ve diğer oyuncular için enterpolasyon.
- AOI (ilgi alanı) filtresi: radar menzili kuralıyla mini haritada başka oyuncular.
- Tek aktif oyun oturumu; bağlantı kopunca yeniden bağlanma.

Aşama 7'deki sahne, HUD ve kontroller aynen kalacak; değişecek olan yalnızca kontrolcünün sunucuyla konuşma biçimi (REST yerine WebSocket).

## 8. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-07-Harita-Oyun-Motoru.zip` (Aşama 1–6 dahil tam proje). `node_modules`, `dist` ve `.env` içermez.
