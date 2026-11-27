# 07 — Geliştirme Aşamaları ve Test Planı

**Kural:** Bir aşama, kabul ölçütlerinin **tamamı** otomatik veya belgelenmiş manuel testle doğrulanmadan "tamamlandı" sayılmaz. Her aşama sonunda rapor + ZIP teslimatı hazırlanır.

## 1. Aşama durumu

| # | Aşama | Durum | Not |
|---|---|---|---|
| 1 | Araştırma ve analiz | 🟡 **Kısmen** | Resmî sayfalara ağ engeli nedeniyle doğrudan erişilemedi; arama özetleriyle yapıldı ([01](01-Arastirma-Raporu.md)). Ağ izni verilirse doğrulanacak. |
| 2 | Teknik mimari | ✅ Tamamlandı | [02](02-Teknik-Mimari.md), [03](03-Platform-Mimarisi.md), [05](05-Yonetim-Merkezi-Plani.md) |
| 3 | Veritabanı ve altyapı | ✅ Tamamlandı | 0001 migration + doğrulanmış taslak; docker-compose, nginx örneği |
| 4 | Kayıt ve giriş | ✅ **Web için tamamlandı** | API + web arayüzü + 72 otomatik test + 18 adımlı API E2E + 11 adımlı tarayıcı E2E. Mobil güvenli depolama Aşama 15'te. |
| 5 | Oyuncu profili | ✅ **Tamamlandı** | Sunucu/şirket seçimi, pilot, cüzdan + defter, seviye/rütbe, başarımlar, açık profil. Rapor: [Aşama 5](DevelopmentNotes/Asama-05-Raporu.md) |
| 6 | Hangar ve ekipman | ✅ **Tamamlandı** | 10 gemi, 36 eşya, envanter + defter, 2 konfigürasyon, yükseltme, tamir, PET, mağaza. Rapor: [Aşama 6](DevelopmentNotes/Asama-06-Raporu.md) |
| 7 | Harita ve oyun motoru | ✅ **Tamamlandı (tek oyunculu)** | Phaser 3.90 sahnesi, 21 harita + 60 geçit + 51 bölge, sunucu hız denetimli konum, geçit geçişi, galaksi haritası, mini harita, joystick, cihaz sınıfına göre ayarlar. Rapor: [Aşama 7](DevelopmentNotes/Asama-07-Raporu.md) |
| 8 | Multiplayer | ✅ **Tamamlandı (hareket katmanı)** | WebSocket oyun sunucusu, oyun bileti, 20 Hz sunucu otoriteli hareket, tahmin/uzlaştırma/enterpolasyon, radar menzili (AOI), tek aktif oturum, yeniden bağlanma, istasyon kuralı. Rapor: [Aşama 8](DevelopmentNotes/Asama-08-Raporu.md) |
| 9 | NPC ve savaş | ✅ **Tamamlandı (Yıldız Kapıları hariç)** | Hedef seçme, lazer/roket, sunucu tarafı hasar, 11 NPC türü (2 kadim), yapay zekâ, ölüm/yeniden doğma, katkıya göre bölünen ödül, kargo kutusu, PvP kuralları. Yıldız Kapıları Aşama 10-11'e, canlı içerik güncelleme Aşama 14'e kaldı. Rapor: [Aşama 9](DevelopmentNotes/Asama-09-Raporu.md) |
| 10 | Görev sistemi | ⏭ Sıradaki | ~300 görev |
| 11 | Ekonomi | ⏳ | |
| 12 | Klan ve sosyal | ⏳ | |
| 13 | Forum ve destek | ⏳ | |
| 14 | Yönetim Merkezi | ⏳ | RBAC altyapısı Aşama 4'te hazır |
| 15 | Android ve iOS | ⏳ | Capacitor; iOS için macOS + Apple Developer gerekir |
| 16 | Güvenlik ve performans | ⏳ | Yük testi, sızma testi kontrol listesi, yedek tatbikatı |
| 17 | Yayın ve dağıtım | ⏳ | VPS kurulumu, alan adı, TLS, izleme |

## 2. Aşama bazında teslimatlar ve kabul ölçütleri

| # | Ana teslimat | Kabul ölçütleri (özet) |
|---|---|---|
| 5 | Sunucu/şirket seçimi, `players`, profil API + ekranı | Tek hesapta sunucu başına bir pilot; profil web ve mobil görünümde aynı; istatistik alanları istemciden yazılamaz (403 testi) |
| 6 | Hangar, envanter, 2 konfigürasyon, mağazadan başlangıç ekipmanı | Slot uyumsuz takma reddedilir; aynı eşya bir konfigürasyonda iki kez takılamaz; tüm değişiklikler `item_ledger`'da |
| 7 | Phaser istemci, harita yükleme, kamera, mini harita, PC + dokunmatik girdi katmanı | 60 FPS (orta seviye cihaz emülasyonu), HUD tüm yerleşim profillerinde kesilmeden |
| 8 | Oyun sunucusu, bilet, ikili protokol, AOI, tahmin + uzlaştırma + enterpolasyon, yeniden bağlanma, harita geçişi | **İki ayrı hesapla** aynı haritada karşılıklı hareketin görünmesi (otomatik bot istemcileriyle test + manuel iki tarayıcı); 200 ms yapay gecikme ve %5 paket kaybında akıcılık; 100 bot istemciyle yük testi |
| 9 | NPC yapay zekâsı, hasar formülü, ölüm/patlama/ödül, kapılar, boss | Hasar ve ödül yalnızca sunucuda; iki oyuncu aynı NPC'yi vurduğunda ödül katkıya göre bölünür; Yönetim Merkezi'nden can değişikliği canlı NPC'ye yansır |
| 10 | Görev motoru + ~300 görev | Olay tabanlı ilerleme; günlük/haftalık sıfırlama (zaman taklidiyle test); mobilde uzun liste kaydırma |
| 11 | Cüzdan, defter, mağaza, açık artırma, üretim, günlük ödül | Eşzamanlı 50 satın alma isteğinde negatif bakiye yok; aynı `idempotency_key` iki kez uygulanmaz |
| 12 | Klan, diplomasi, grup, arkadaş, engelleme, sohbet kanalları, bildirimler | Grup üyesinin farklı haritadaki konumu izinlere göre görünür; engellenen oyuncunun mesajı iletilmez |
| 13 | Forum (ortak hesap) + destek talepleri | Kilitli konuya yanıt reddedilir; ek dosya türü/boyut sınırı; talep numarası benzersiz |
| 14 | Yönetim Merkezi'nin tüm modülleri | Her uç nokta için yetkisiz → 403 testi; yayınla/geri al; denetim kaydı; iki yetkili onayı |
| 15 | Capacitor Android (APK + AAB) + iOS Xcode projesi | APK gerçek Android cihazda kurulup aynı hesapla PC oyuncusuyla aynı haritada oynanır; iOS derleme talimatı |
| 16 | Güvenlik denetimi, performans optimizasyonu, yedekleme | OWASP ASVS L2 kontrol listesi; 60 dk uzun oturum testi; geri yükleme tatbikatı |
| 17 | Üretim kurulumu | turkorbit.com üzerinde TLS, izleme, alarm, bakım modu |

## 3. Test stratejisi

| Katman | Araç | Kapsam | Aşama 1 durumu |
|---|---|---|---|
| Birim | Vitest | Saf fonksiyonlar (parola politikası, şemalar, seviye/rütbe, eşya/slot kuralları, konfigürasyon istatistikleri, harita giriş koşulları, ayar şeması, ağ protokolü ve ortak hareket simülasyonu, savaş kuralları: hasar, saldırı izni, ödül zarı ve paylaşımı) | ✅ 59 test |
| Entegrasyon | Vitest + `fastify.inject` + **gerçek PostgreSQL + Redis** + gerçek WebSocket | API uç noktaları, veritabanı kısıtları, tetikleyiciler, eşzamanlı harcama/satın alma, geçitler, oyun sunucusu (bilet, mesaj sırası, hareket, hız hilesi, AOI, tek oturum, kopma, ağ bütçesi), savaş (atış hızı, menzil, ödül ve paylaşımı, kargo, NPC yapay zekâsı, ölüm, PvP, roket, canlı envanter) | ✅ 148 test |
| API uçtan uca | `scripts/e2e-auth.mjs` (gerçek API + oyun sunucusu süreçleri + gerçek SMTP) | Çoklu hesap, çoklu platform, WebSocket senaryoları, NPC öldürme ve ödül | ✅ 36/36 adım |
| Arayüz uçtan uca | Playwright (Chromium; 2 masaüstü + iPhone dikey/yatay emülasyonu) | Gerçek tarayıcıda kullanıcı akışları, oyun ekranı, iki pilotun birbirini görmesi, sunucu yeniden başlatma, tek oturum, savaş (hedef, ateş, ödül, kargo, ölüm, yeniden doğma) + ekran görüntüleri | ✅ 45/45 adım |
| Multiplayer | Başsız bot istemcileri (Node) + iki gerçek tarayıcı | Senkronizasyon, gecikme, paket kaybı, yük | Aşama 8 |
| Gerçek cihaz | Android/iOS telefon + tablet | Bkz. [03 §8](03-Platform-Mimarisi.md) | Aşama 15 |
| Güvenlik | Bağımlılık taraması (`npm audit`), statik analiz, sızma testi kontrol listesi | — | `npm audit`: 0 açık |
| Performans | k6 / özel WebSocket yük aracı | API p95 < 150 ms; oyun tik süresi < 10 ms (200 oyunculu harita) | Aşama 8/16 |

## 4. Bağlantı ve performans test ekranı (madde 20 — Aşama 8)
Oyun içinde `Ayarlar → Bağlantı Testi`: sunucu bağlantısı, ping (min/ortalama/maks), gecikme dalgalanması (jitter), FPS, WebSocket durumu, paket kaybı (sıra numarası boşlukları), yeniden bağlanma sayısı, harita senkronizasyonu (sunucu tik farkı), son hata kayıtları. Ham veriler isteğe bağlı olarak destek talebine eklenebilir.
