# Aşama Raporu — Aşama 6: Hangar ve Ekipman

**Tarih:** 27.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-06-Hangar-Ekipman.zip`

## 1. Tamamlanan işler — madde 6 karşılama tablosu

| İstenen | Durum | Ayrıntı |
|---|---|---|
| Gemiler | ✅ | 10 özgün gemi (Kırlangıç + 9 yeni): sınıf, can, hız, kargo, slotlar, seviye şartı, fiyat |
| Gemi tasarımları | ✅ | 3 özgün tasarım (Gece Kırlangıcı, Bozkır Atmacası, Altın Kartal); profil ve hangarda görünür |
| Lazerler | ✅ | OK-1…OK-4 |
| Roketler | ✅ | Yıldırım, Şimşek, Tufan (alan), Buz-R (yavaşlatma) + Sağanak roket atar (ekstra slot) |
| Jeneratörler ve kalkanlar | ✅ | Siper-1…4 (kalkan + emme), İtki-1…4 (hız) |
| Drone sistemleri | ✅ | Arı, Yaban, Alkım; her drone bir lazer/kalkan taşır, bonusla güçlendirir |
| PET ve modülleri | ✅ | Yoldaş PET (2 modül slotu), 4 modül; isim değiştirme. Oyun içi etkiler Aşama 8-9'da |
| Envanter | ✅ | Örnek bazlı eşyalar, yığınlanan mühimmat, envanter sınırı, **eşya defteri** |
| İki ayrı ekipman konfigürasyonu | ✅ | Gemi başına K1/K2, kullanımdaki konfigürasyon seçimi |
| Yükseltmeler | ✅ | Seviye 1–10, seviye başına +%2; sunucu tarafı kriptografik zar; denetlenebilir yükseltme kaydı |
| Tamir | ✅ | Eksik cana göre ücret (ayarlanabilir), defterli |
| Ekipman değiştirme | ✅ | Slota tıkla → uygun eşyalar → tak/çıkar/taşı; aktif gemi seçimi |
| Satın alma ve satış | ✅ | Mağaza (9 kategori, 43 teklif, indirim, paket, sınırlar); satış takılı/kullanımdaki eşyada engelli |
| İstatistikler sunucuda doğrulanır | ✅ | Kategori şemaları + sunucuda konfigürasyon hesabı; bozuk veri reddedilir (test edildi) |
| Yönetim değişikliği oyuna yansır | ✅ | Eşya istatistiği, gemi canı, fiyat, indirim, satış durumu anında yansır (test edildi) |

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0003_hangar.sql` |
| Ortak paket | `packages/shared/src/items.ts`, `items.test.ts` |
| API | `apps/api/src/modules/hangar/{service,routes,starter-kit}.ts`, `apps/api/src/modules/economy/inventory.ts` |
| API testleri | `apps/api/test/hangar.test.ts` (20 test) |
| İstemci | `apps/client/src/pages/HangarPages.tsx`, `apps/client/src/lib/format.ts` |
| Belgeler | `Documentation/Asama-06-Hangar-Ekipman/{API-Referansi,Kurulum-ve-Dosya-Yerlestirme-Rehberi}.md`, bu rapor, 5 ekran görüntüsü |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/app.ts` | Hangar/mağaza rotaları, test için RNG enjeksiyonu |
| `apps/api/src/modules/player/{service,repository}.ts` | Pilot oluşturmada başlangıç kiti; profilde tasarım görünümü ve can sınırı |
| `apps/api/test/helpers.ts` | Yeni ayarların tohumlanması, RNG seçeneği |
| `packages/shared/src/{api-types,index,player}.ts` | Yeni hata kodları ve defter etiketleri |
| `apps/client/src/components/ShipArt.tsx` | 10 gemi + 4 renk paleti (parametrik çizim) + eşya simgeleri |
| `apps/client/src/{App.tsx, components/Layout.tsx, pages/PilotPages.tsx, styles/global.css}` | Hangar/Mağaza menüsü ve rotaları, mobilde kaydırılabilir menü, stiller |
| `database/schema-draft.sql` | 0003'te uygulanan tablolar taslaktan çıkarıldı |
| `scripts/e2e-auth.mjs`, `scripts/ui-e2e.mjs` | Hangar/mağaza senaryoları |

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 31/31 (7 yeni: slot uyumu, istatistik doğrulama, konfigürasyon hesabı, istek şemaları) |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis**) | ✅ 104/104 (20 yeni) |
| API uçtan uca (gerçek süreç + SMTP, **iki hesap**) | ✅ 26/26 adım (3 yeni) |
| Tarayıcı uçtan uca (masaüstü + iPhone 13) | ✅ 22/22 adım (5 yeni), 5 yeni ekran görüntüsü |
| Migration 0003 (geliştirme DB) + taslak zinciri | ✅ |
| `npm run build`, `npm audit` | ✅ / 0 açık |

**Öne çıkan senaryolar:**
- **Satın alma:** Eşzamanlı 5 satın alma isteğinden yalnızca bakiyenin karşıladığı 2'si gerçekleşti, bakiye 0'da kaldı. Aynı `requestId` ile tekrar gönderilen satın alma, satış ve yükseltme ikinci kez uygulanmadı.
- **Yükseltme:** Zar sabitlenerek başarılı ve başarısız sonuçların ikisi de doğrulandı. Başarısız denemede ücret düşüldü, seviye değişmedi, zar sonucu kayda yazıldı.
- **Hangar kuralları:** Başka oyuncunun eşyası veya gemisi kullanılamadı. İstemci gövdeye `damage` ya da `price` ekleyince istek reddedildi. Bir eşya iki gemide aynı anda takılamadı. Drone çıkarılınca taşıdığı ekipman da düştü.
- **Yönetim yansıması:** Lazer istatistiği, gemi canı ve mağaza fiyatı veritabanında değişince hangar, mağaza ve profil anında güncellendi.

## 5. Geliştirme sırasında bulunan ve düzeltilen sorun
- **Arayüz:** Yükseltme ve satış onay kutusu açıkken satırdaki dış butonlar da görünüyordu. Bu, kullanıcının yanlışlıkla tekrar dış butona basmasına yol açabiliyordu ve tarayıcı testinde yakalandı. Onay açıkken dış butonlar gizlendi, onay butonları normal boyuta getirildi.

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Gemi/ekipman değişikliği "yalnızca istasyonda" kuralı yok (oyun sunucusu yok) | Aşama 8 |
| 2 | PET modülleri, Tamir Robotu, Radar, drone ve roket etkileri yalnızca değer olarak tanımlı; oyunda çalışmaları Aşama 8-9 | Aşama 8-9 |
| 3 | Mermi ve roket tüketimi yok (savaş yok) | Aşama 9 |
| 4 | Yükseltmede kaynak (Kuvarsit vb.) maliyeti yok; yalnızca para | Aşama 11 (rafineri) |
| 5 | Sürükle-bırak yok; tıkla-seç modeli kullanıldı (PC ve dokunmatikte aynı). İstenirse PC için sürükle-bırak eklenebilir | İsteğe bağlı |
| 6 | Hangar ilk açılışında başlangıç kiti verilmesi bir GET isteğinde yazma yapıyor (Aşama 5 pilotları için tembel geçiş, idempotent) | Gerekirse tek seferlik bakım betiğine dönüştürülebilir |
| 7 | Gerçek mobil cihaz testi yok (yalnızca emülasyon) | Aşama 15 |

## 7. Sonraki aşama
**Aşama 7: Harita ve oyun motoru.**
- Phaser 3 istemcisi
- 21 haritanın portal/bölge verileri
- Kamera, yıldız alanı arka planı, mini harita (algılama kurallarıyla)
- PC (fare/klavye) ve dokunmatik (sanal joystick) girdi katmanı
- Gemilerin oyun içi sprite'ları (Aşama 6 çizimlerinden)
- Tek oyunculu hareket (multiplayer Aşama 8'de)

## 8. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-06-Hangar-Ekipman.zip` (Aşama 1–5 dahil tam proje). `node_modules`, `dist` ve `.env` içermez.
