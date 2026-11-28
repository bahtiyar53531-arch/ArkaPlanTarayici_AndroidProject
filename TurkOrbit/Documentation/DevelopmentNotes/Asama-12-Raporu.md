# Aşama Raporu — Aşama 12: Klan ve Sosyal

**Tarih:** 28.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-12-Klan-Sosyal.zip`

> **Kapsam:**
> - 07'deki Aşama 12 satırı: klan, diplomasi, grup, arkadaş, engelleme, sohbet kanalları ve bildirimler.
> - Kabul ölçütleri:
>   1. "Grup üyesinin farklı haritadaki konumu izinlere göre görünür."
>   2. "Engellenen oyuncunun mesajı iletilmez."
>
>   İkisi de entegrasyon testi, API uçtan uca testi ve tarayıcı testiyle doğrulandı.

Kurallar, protokol ve API: [Klan ve Sosyal Kuralları ve API](../Asama-12-Klan-Sosyal/Klan-ve-Sosyal-Kurallari-ve-API.md) · Kurulum: [Güncelleme Rehberi](../Asama-12-Klan-Sosyal/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)

## 1. Tamamlanan işler

| İstenen | Durum | Ayrıntı |
|---|---|---|
| Klan | ✅ | Kurma (Sv 5, 50.000 Kredi, defterli, idempotent), arama, başvuru, davet, ayrılma, çıkarma, dağıtma. Tek klan kuralı veritabanında. Eşzamanlı katılımda üye sınırı aşılmaz |
| Rütbeler | ✅ | 4 varsayılan rütbe, 6 yetki. Lider rütbe ad ve yetkilerini düzenler. Yalnızca alt rütbe yönetilir. Liderlik devri |
| Klan hazinesi | ✅ | Ayrı cüzdan ve yalnızca eklenebilir defter. Yatırma ve yetkiliyle ödeme. NPC Kredi ödülünden %0–5 vergi (ödülle aynı transaction'da). Dağıtmada lidere iade |
| Diplomasi | ✅ | İttifak ve saldırmazlık (öneri → onay), savaş (tek taraflı, barış iki taraflı). **Oyunda gerçek etki:** müttefik saldıramaz, savaştaki aynı şirketten pilotlar PvP haritasında savaşabilir |
| Grup (party) | ✅ | Redis'te atomik Lua betikleriyle, 8 kişi. Davet ve kabul, lider, çıkarma. Grup sohbeti, grup içi saldırı yok. Panelde can/kalkan ve **üyenin iznine göre** konum. Mini haritada grup üyeleri |
| Sohbet kanalları | ✅ | Genel, şirket, harita, klan, grup, özel. Süreçler arası Redis. Hız sınırı ve susturma. Küfür filtresi. Engelleme. Kayıt ve geçmiş. İsimden menü (özel mesaj, davet, profil, engelle, şikâyet) |
| Arkadaşlık, engelleme, gizlilik | ✅ | İstek, kabul ve karşılıklı otomatik kabul. Çevrimiçi durum arkadaşın iznine göre. Engelleme her kanalda ve her davette geçerli. 5 gizlilik ayarı |
| Bildirimler | ✅ | 14 tür. Web zili ve oyunda anlık iletim. **Aşama 11 sınırlaması giderildi:** açık artırmada teklifin geçilmesi ve kazanma bildirimleri |
| Şikâyet | ✅ | Mesaj, pilot ve klan şikâyeti; içeriğin anlık kopyasıyla moderasyon kuyruğuna yazılır (inceleme ekranı Aşama 14) |
| Arayüz | ✅ | Oyunda sohbet paneli (masaüstü sol alt, telefonda çekmece), grup paneli, davet kartı, klan etiketleri. `/klan`, `/klan/:sunucu/:etiket`, `/sosyal`, menüde 🔔. Açık profilde klan ve sosyal düğmeler |

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0008_social.sql` (15 tablo + ayarlar) |
| Ortak paket | `packages/shared/src/social.ts`, `social.test.ts` (11 test) |
| API | `apps/api/src/modules/social/{clan,service,notifications,treasury,party,common,routes}.ts` |
| İstemci | `apps/client/src/components/game/SocialHud.tsx`, `components/social/{ReportDialog,NotificationBell}.tsx`, `pages/{ClanPages,SocialPages}.tsx` |
| Testler | `apps/api/test/social.test.ts` (16 test, gerçek WebSocket dahil) |
| Belgeler | `Documentation/Asama-12-Klan-Sosyal/*`, bu rapor, ekran görüntüleri (`ekran-goruntuleri/asama-12`) |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/game/server.ts` | Sohbet (kanal, izin, filtre, hız sınırı, Redis), grup (davet, kabul, durum yayını), ilişkiye göre saldırı, klan etiketi, canlı sosyal yenileme |
| `apps/api/src/game/persistence.ts`, `modules/economy/rewards.ts` | NPC ödülünden klan vergisi |
| `apps/api/src/modules/{market,player,game}/…`, `app.ts` | Açık artırma bildirimleri, profilde klan, Redis köprüsü kanalları, servis bağlantıları |
| `packages/shared/src/{combat,net,player,api-types,index}.ts` | Saldırı ilişkisi, protokol mesajları, klan etiketi, profil klanı, 16 hata kodu, defter etiketleri |
| `apps/client/src/{pages/GamePage.tsx, game/controller.ts, game/SpaceScene.ts, components/game/GameHud.tsx, components/Layout.tsx, pages/PilotPages.tsx, App.tsx, styles/*}` | Oyun içi yerleşim, kontrolcü durumu, etiketler, mini harita, menü, profil |
| `apps/api/test/helpers.ts`, `scripts/*.mjs` | Test ayarları (klan, sosyal, sohbet), yeni uçtan uca adımlar |
| `database/schema-draft.sql` | Sosyal tablolar taslaktan çıkarıldı |
| `Documentation/{02,04,06,07}`, README'ler, Karar Günlüğü | Durum, 0008 tabloları, K-072…K-081 |

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 85/85 (11 yeni) |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis + WebSocket**) | ✅ 187/187 (16 yeni) |
| API uçtan uca (gerçek API + oyun sunucusu süreçleri) | ✅ 48/48 adım (5 yeni) |
| Tarayıcı uçtan uca (Chromium: 2 masaüstü + iPhone 13) | ✅ 67/67 adım (10 yeni). Başsız yazılımsal çizimde FPS: masaüstü 21, telefon emülasyonu 50. Bu bir ölçüm ortamı değeridir, gerçek cihaz FPS'i değildir |
| `npm run build`, `npm audit` | ✅ Hatasız · 0 açık |
| Şema doğrulama | ✅ 0001 → 0008 + taslak boş veritabanına hatasız (100 tablo) |

**Doğrulananlar (entegrasyon testleri, gerçek içerikle):**
- **Klan kurma:**
  - Sv 1 reddedildi. Sv 5'te ücret 50.000 düştü; defterde tek kayıt var.
  - Aynı istek kimliği ikinci kez ücret almadı.
  - Etiket büyük/küçük harf duyarsız benzersiz. "Siktir Filosu" adı reddedildi.
  - Profilde ve açık profilde klan bilgisi görünüyor.
- **Yetkiler:**
  - Üye davet edemedi; Subay davet etti.
  - Komutan, lideri ve eşit rütbeyi çıkaramadı, alttakini çıkardı; kendi rütbesini veremedi.
  - Rütbe yetkilerini yalnızca lider düzenledi.
  - Lider ayrılamadı; devrettikten sonra ayrıldı. Etkinlik kaydı birebir doğru.
- **Eşzamanlılık:**
  - Üye sınırı 4 iken 7 eşzamanlı katılım isteği → klanda tam 4 üye.
  - Aynı pilot iki klana birden giremedi.
- **Hazine:**
  - Yatırma iki defterde. Tekrar edilen istek bir kez uygulandı.
  - Yetkisiz ödeme reddedildi. Hazine yetersizken oyuncuya da ödeme yapılmadı.
  - 20 eşzamanlı yatırmada toplam tutarlı (22 defter kaydı). Defterde UPDATE reddedildi.
- **Vergi (%5):**
  - 1.000 Kredi ödülden 50 hazineye; vergisiz pilot 1.000 aldı.
  - Aynı öldürme ikinci kez işlenmedi.
- **Diplomasi:**
  - Öneri yalnızca yetkililere bildirildi; yetkisiz üye yanıtlayamadı.
  - İttifak varken savaş ilan edilemedi. Savaş tüm üyelere bildirildi.
  - Barış iki taraf önerince bitti.
  - Dağıtılan klanın hazinesi lidere iade edildi ve ilişkileri silindi.
- **Arkadaşlık ve engelleme:**
  - İstek, bildirim, kabul ve karşılıklı otomatik kabul çalıştı.
  - Çevrimiçi durum arkadaşın izni kapalıyken `null` döndü.
  - Engelleme arkadaşlığı sildi; engellenen pilot "kabul etmiyor" mesajı aldı (kimin engellediği sızmadı).
- **Şikâyet:**
  - Mesajın anlık kopyası kaydedildi. Tekrar şikâyet edilemedi. Kendi mesajını şikâyet edemedi.
  - Özel mesajı üçüncü kişi göremedi ve şikâyet edemedi.
- **Sohbet (gerçek WebSocket, 4 pilot, 3 harita):**
  - Genel herkese, şirket yalnızca aynı şirkete, harita yalnızca aynı haritaya, klan yalnızca üyelere, özel yalnızca iki tarafa gitti.
  - "SİİİKTİR" maskelendi.
  - API'den engelleme → oyun sunucusu canlı öğrendi; engellenen pilotun mesajı iletilmedi ve özel mesajı reddedildi.
  - 8 hızlı mesajdan 5'i iletildi, ardından susturma uygulandı.
- **Grup (Redis):**
  - Davet, kabul ve görünüm çalıştı.
  - Farklı haritadaki üyenin konumu varsayılan izinle harita ve koordinat olarak göründü. Üye REST'ten "yalnızca harita" seçince koordinat gizlendi; "gizli" seçince harita da gizlendi.
  - Grup sohbeti yalnızca üyelere gitti. Lider olmayan üye davet gönderemedi.
  - Grup üyesine (farklı şirket, PvP haritası) saldırılamadı.
  - Lider ayrılınca en eski üye lider oldu. İki kişi kalıp biri ayrılınca grup dağıldı ve Redis'te `party:*` anahtarı kalmadı.
  - 10 eşzamanlı kabulde grup tam 8 kişi oldu; 3 kişi "Grup dolu" aldı.
- **Diplomasi ve saldırı:**
  - Aynı şirketten iki klan arasında saldırı önce reddedildi.
  - API'den savaş ilanı → oyun sunucusu canlı öğrendi → hasar verildi.
  - İttifaktaki farklı şirket pilotuna saldırı reddedildi.
  - Pilot bilgisinde klan etiketi (`ct`) var.

**Tarayıcıda gerçekten denenenler (iki ayrı masaüstü oturumu, iki hesap):**
- **Klan ve zil:**
  - A, Klan sayfasından [AKN] klanını kurdu (defterde −50.000).
  - B klanı aradı ve mesajla başvurdu. A'nın 🔔 zilinde "BozkirKurdu (Sv 1) klana katılmak istiyor." göründü.
  - A, Başvurular sekmesinden kabul etti; Üyeler'de B listelendi.
- **Arkadaşlık:** A, Sosyal sayfasından arkadaşlık isteği gönderdi; B İstekler'den kabul etti. A'nın listesinde B, `[AKN]` etiketiyle "Çevrimdışı" göründü.
- **Oyunda sohbet:**
  - A Enter ile sohbete geçti, yazdı; B genel mesajı aldı. Klan sekmesinden gönderilen mesaj da geldi.
  - B, A'nın adına tıklayıp menüden "Özel mesaj" seçti; A özel mesajı aldı.
  - Veritabanında kanallar sırasıyla genel, klan, özel.
- **Grup:**
  - A, sohbetteki adından B'yi davet etti; B davet kartında Kabul etti.
  - A'nın grup panelinde B'nin can/kalkanı ve "G-2 · x/y" konumu göründü.
  - B başka haritaya (G-1) geçti ve yeniden davet edildi (oyundan çıkınca gruptan ayrılır).
  - B ikinci sekmeden gizliliği "yalnızca harita" yaptı; A'nın panelinde konum "G-1" olarak kaldı, koordinat gizlendi.
- **Şikâyet:** A, B'nin mesajını menüden şikâyet etti; kuyrukta mesajın kopyasıyla `open` kayıt oluştu.
- **Profil:** B, A'nın profilinde klan bağlantısını ve sosyal düğmeleri gördü; açık klan sayfasında iki üye ve lider göründü.
- **Telefon:**
  - 💬 çekmecesinde genel ve klan geçmişi yüklendi; mesaj gönderildi.
  - Klan sayfasında sekmeler tek satırda kaydı.
- Aşama 1–11'in tüm adımları da yeniden geçti.

## 5. Geliştirme sırasında bulunan ve düzeltilen sorunlar
1. **Kilitlenme riski (klan vergisi):**
   - Birden çok pilotlu NPC ödülünde vergi, pilot sırasıyla klan cüzdanlarını kilitliyordu. Farklı sırayla kilitleyen iki işlem birbirini bekleyebilirdi.
   - Düzeltme: Önce tüm pilotlar, sonra klan cüzdanları **klan kimliği sırasıyla** kilitleniyor. Hazineden ödemede de önce pilot, sonra klan.
2. **Grup görünümünün güncellenmemesi:** Bir grup işlemi, çalışan bir durum turuyla çakışırsa güncelleme bir sonraki saniyeye kalıyordu. Çakışan çağrılar birleştirilip tur yeniden çalıştırılıyor; işlemi yapan güncel görünümü hemen alıyor.
3. **Klan etiketi değişince gemi titremesi:** Varlık bilgisi yeniden gönderilince istemci gemiyi sıfırdan oluşturuyordu. Artık yalnızca bilgisi güncelleniyor, konum tamponu korunuyor.
4. **Test ortamı:** Test veritabanı sıfırlaması yeni ayarları (klan, sosyal, sohbet) silip geri yazmıyordu. Varsayılanlarla devam ediliyordu; küfür filtresi listesi boş kalırdı. Sıfırlamaya eklendi.
5. **Görsel:**
   - Masaüstünde sohbet paneli mühimmat çubuğunun soluna biniyordu; grup paneli sol sütunda sohbetin altında kalıyordu.
   - Grup paneli sağa (radarın altına) taşındı. Sohbet 320 piksele indirildi. Dar masaüstünde sohbet çubuğun üstüne kalkıyor.
   - Telefonda sohbet çekmecesinde yazma alanı ekranın altına alındı.

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Şikâyetlerin incelenmesi, susturma/ban ve sohbet mesajı silme için yönetim ekranı yok; kuyruk SQL ile görülür | Aşama 14 (Yönetim Merkezi) |
| 2 | Sohbet hız sınırı oyun sunucusu süreci başına bellekte tutuluyor; pilot başka sürece bağlanırsa sayaç sıfırlanır | Redis sayaç (çok süreçli kurulumda), Aşama 16 |
| 3 | Grup ödül paylaşımı veya grup bonusu yok; NPC ödülü hasar katkısına göre bölünmeye devam ediyor (K-047) | Dengeleme, Aşama 14–16 |
| 4 | Sıralama/etkinlik tabloları (`events`, `leaderboard_snapshots`; taslakta "12/14" işaretli) bu aşamaya alınmadı; 07'deki Aşama 12 kapsamında değil | Aşama 14 |
| 5 | Klan seviyesi, klan üssü ve klan savaş puanı yok | İhtiyaca göre |
| 6 | Sohbet kayıtlarının saklama süresi ve temizliği yok | Aşama 16 |
| 7 | Web sayfalarında bildirim 30 sn'de bir sorgulanır (anlık değil); oyunda anlık | Gerekirse sunucu olayları (SSE) |
| 8 | Klan dağıtılınca hazine defteri klanla birlikte silinir; lidere iade oyuncu defterinde kalır | Arşivleme, Aşama 14 |
| 9 | Gerçek telefonda deneme yok; yalnızca emülasyon | Aşama 15 |

## 7. Sonraki aşama
**Aşama 13: Forum ve destek.**
- Oyun hesabıyla ortak forum: bölümler, konu ve yanıt, sabitleme ve kilitleme, beğeni, takip, arama, raporlama (`reports` tablosu forum hedeflerini zaten destekliyor).
- Destek talepleri: numara, ek dosya türü/boyut sınırı, durum akışı.

## 8. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-12-Klan-Sosyal.zip` (Aşama 1–11 dahil tam proje). `node_modules`, `dist` ve `.env` içermez.
