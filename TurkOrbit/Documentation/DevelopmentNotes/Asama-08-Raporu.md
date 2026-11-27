# Aşama Raporu — Aşama 8: Multiplayer (gerçek zamanlı çok oyunculu dünya)

**Tarih:** 27.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-08-Multiplayer.zip`

> **Kapsam notu:**
> - Bu aşama çok oyunculu dünyanın **hareket katmanıdır**: pilotlar aynı haritada birbirini gerçek zamanlı görür, hareket tamamen sunucuda hesaplanır, geçitler ve tek aktif oturum sunucu tarafında yönetilir.
> - Savaş (hedef seçme, lazer, roket, hasar), NPC'ler, ölüm ve ödüller **Aşama 9**'dur. Sohbet ve grup **Aşama 12**'dir.

## 1. Tamamlanan işler

| İstenen | Durum | Ayrıntı |
|---|---|---|
| WebSocket oyun sunucusu | ✅ | Ayrı süreç (`npm run dev:game` / `start:game`, port 4001), `ws` kütüphanesi, `/health` uç noktası |
| Oyun bileti | ✅ | `POST /api/v1/game/ticket`: oturum + doğrulanmış e-posta + pilot + bakım denetimi; 60 sn, tek kullanımlık (Redis `GETDEL`). Oturum anahtarı WebSocket'e gitmez |
| Sunucu otoriteli hareket | ✅ | 20 Hz sabit adım; istemci yalnızca niyet gönderir (yön / hedef nokta / geçit). Konum yazan mesaj yoktur; Aşama 7'nin REST konum ve geçit uç noktaları kaldırıldı |
| Hız hilesine karşı | ✅ | Tik başına en fazla bir girdi, 20'lik kuyruk sınırı, yön değeri kırpma. Saniyede 100 girdi gönderen istemci 1 sn'de gemi hızından fazla gidemedi (test) |
| İstemci tahmini + uzlaştırma | ✅ | Sunucu ile **aynı** `stepShip` fonksiyonu (`packages/shared/src/net.ts`); onaylanmamış girdiler yeniden oynatılır, küçük fark yumuşatılır, büyük fark atlanır |
| Diğer oyuncular (enterpolasyon) | ✅ | ~150 ms geriden iki anlık görüntü arasında; gemi, şirket renginde ad etiketi ve seviye |
| İlgi alanı (AOI) | ✅ | Izgara tabanlı; yalnızca radar menzilindekiler gönderilir (madde 18). Mini harita radar dairesi + menzildeki pilotlar, düşman şirket kırmızı halkalı; HUD'da "Radar" listesi |
| Geçitler (WebSocket) | ✅ | Konum sunucunun kendi konumu. Geçen pilot eski haritadakilere "leave", yeni haritadakilere "enter" olur |
| Tek aktif oyun oturumu | ✅ | Yeni cihaz bağlanınca eskisi "Başka bir cihazda oyundasın" ekranıyla durur, gemi devredilir. **Bu cihazda devam et** ile geri alınır. Redis yayınıyla süreçler arası çalışır |
| Yeniden bağlanma | ✅ | Kopmada "Bağlantı koptu, yeniden bağlanılıyor…"; her denemede yeni bilet, 1-2-4-8-10 sn bekleme; çevrimiçi olunca hemen deneme |
| Kopmada gemi haritada kalır | ✅ | 30 sn (`GAME_LINGER_SECONDS`); geri dönülürse aynı gemi devam eder |
| Oturum güvenliği | ✅ | Çıkış, parola değişimi, yasak veya askıya alma sonrası oyun bağlantısı en geç 30 sn'de kapanır. Origin denetimi, mesaj hız sınırı, 4 KB mesaj sınırı |
| Kalıcılık | ✅ | Konum 5 sn'de bir toplu ve çıkışta yazılır; harita geçişi anında (transaction); son çevrimiçi zamanı |
| Yalnızca istasyonda ekipman | ✅ | Aşama 6'dan kalan kural: oyundayken istasyon dışında ekipman/gemi değişimi `409 NOT_IN_STATION`. Konfigürasyon değişimi her yerde serbest |
| Hangar değişikliği oyuna canlı yansır | ✅ | Konfigürasyon/ekipman değişince hız, can, kalkan ve radar oyunda anında güncellenir (`pilot` mesajı) |
| Harita bakımı (canlı) | ✅ | Oyundaki pilot, bulunduğu harita kapatılınca en geç 15 sn'de şirket haritasına taşınır ve bildirim alır |
| HUD | ✅ | Ping göstergesi, bağlantı durumu şeridi, radar listesi, "başka cihaz" / "oturum sona erdi" ekranları |

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Ortak paket | `packages/shared/src/net.ts` (protokol + hareket simülasyonu), `net.test.ts` (10 test) |
| Oyun sunucusu | `apps/api/src/game/{server,index,logger}.ts` |
| API | `apps/api/src/modules/game/{bridge,routes}.ts` |
| Testler | `apps/api/test/game.test.ts` (20 test, gerçek WebSocket + PostgreSQL + Redis) |
| Belgeler | `Documentation/Asama-08-Multiplayer/{Protokol,Kurulum-ve-Dosya-Yerlestirme-Rehberi}.md`, bu rapor, 5 yeni ekran görüntüsü (`ekran-goruntuleri/asama-08`) |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/modules/world/{service,routes}.ts` | REST konum/geçit kaldırıldı. Oyun sunucusu için `enterWorld`, `jumpForGame` eklendi |
| `apps/api/src/modules/hangar/service.ts` | İstasyon kuralı + değişiklik bildirimi |
| `apps/api/src/{app.ts, config/env.ts}`, `apps/api/package.json` | Bilet rotası, köprü, `GAME_PORT` / `GAME_LINGER_SECONDS`, `ws` bağımlılığı, `dev:game` / `start:game` |
| `packages/shared/src/{api-types,index}.ts` | `GAME_UNAVAILABLE`, `NOT_IN_STATION` |
| `apps/client/src/game/{controller,SpaceScene}.ts` | WebSocket istemcisi, tahmin/uzlaştırma/enterpolasyon, diğer gemiler ve ad etiketleri |
| `apps/client/src/{pages/GamePage.tsx, components/game/GameHud.tsx, styles/game.css, vite.config.ts}` | Bağlantı akışı, radar, ping, bağlantı ekranları, `/game` yönlendirmesi |
| `apps/api/test/world.test.ts` | Konum testleri oyun sunucusu testlerine taşındı; geçit kuralları servis düzeyinde test ediliyor |
| `scripts/e2e-auth.mjs`, `scripts/ui-e2e.mjs` | Oyun sunucusu süreci, WebSocket ve çok oyunculu senaryolar |
| `infra/nginx/turkorbit.conf.example`, `.env.example`, `package.json` | `/game` yönlendirmesi, CSP `blob:`, yeni değişkenler, `dev:game` |
| `Documentation/{02,03,04,06,07}`, README'ler, Karar Günlüğü | Durum, mimari güncellemesi, Redis anahtarları, K-039…K-045 |
| `apps/game-server/` (yalnızca README) | Silindi: oyun sunucusu `apps/api/src/game` altında (K-039) |

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 48/48. 10 yeni: hız sınırı, çapraz yön, hedefe varış, sınır kırpma, uzlaştırma yeniden oynatma doğruluğu, mesaj şeması, girdi temizleme |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis + WebSocket**) | ✅ 134/134 (20 yeni oyun sunucusu testi) |
| API uçtan uca (gerçek API + oyun sunucusu süreçleri + SMTP, **iki hesap, web + Android**) | ✅ 35/35 adım |
| Tarayıcı uçtan uca (Chromium: iki masaüstü + iPhone 13 dikey/yatay) | ✅ 41/41 adım |
| `npm run build`, `npm audit` | ✅ / 0 açık |

**Oyun sunucusu entegrasyon testlerinde doğrulananlar:**
- **Bilet:** Oturumsuz, doğrulanmamış ve pilotsuz istekler reddedildi. Aynı bilet ikinci kez kullanılamadı. Sahte bilet, eski sürüm, izinsiz kaynak ve `hello` göndermeyen bağlantı kapatıldı.
- **Hareket:** 1 sn'lik yön girdisiyle gemi 200–320 birim gitti (gemi hızı 320). Hız hilesi denemesi (100 girdi/sn, 50× yön, sahte konum mesajı) etkisiz kaldı. Girdisi kesilen gemi durdu; hedef noktaya giden gemi devam etti.
- **Görünürlük (AOI):** Menzildeki pilot ad, şirket ve gemiyle göründü; menzil dışı ve başka haritadaki görünmedi. Uzaklaşınca `leave`, yaklaşınca `enter` geldi.
- **Geçit:** Atlayan pilot yeni haritayı aldı, eski haritadakiler `leave` aldı. Uzak geçit ve kilitli harita Türkçe hata döndü.
- **Oturumlar:** İkinci cihaz bağlanınca birincisi 4002 ile kapandı ve gemi devredildi; bu, iki ayrı oyun sunucusu süreci arasında da çalıştı. Çıkış yapan oturumun bağlantısı kapandı. Mesaj seli 4009 ile kesildi.
- **Kopma:** Kopan gemi haritada kaldı, geri dönen pilot aynı gemiyle devam etti, süre bitince diğerleri `leave` aldı.
- **Hangar ve bakım:** İstasyon dışında ekipman değişimi 409 döndü. Konfigürasyon değişimi hızı canlı güncelledi (320 → 322). Bakıma alınan haritadaki çevrimiçi pilot taşındı.
- **Ağ bütçesi:** 10 pilot birbirini görürken oyuncu başına en fazla **3,44 KB/s** indirme ölçüldü (hedef ≤ 15 KB/s).

**Tarayıcıda gerçekten denenen çok oyunculu senaryolar:**
- **İki oyuncu:** İkinci oyuncu (B) arayüzden kayıt oldu, e-postasını doğruladı ve pilot oluşturdu. A ve B aynı haritada birbirinin gemisini, ad etiketini ve radar listesini gördü; ölçülen mesafe ~500'dü.
- **Canlı hareket:** B sağa uçtuğunda A'nın ekranındaki mesafe anında arttı. B radar menzilinden çıkınca A'nın listesinden düştü.
- **Sunucu yeniden başlatma:** Oyun sunucusu süreci durdurulup yeniden başlatıldı. İki tarayıcı da "Bağlantı koptu, yeniden bağlanılıyor…" gösterdi ve kendiliğinden yeniden bağlandı.
- **Tek oturum:**
  - Aynı hesap telefondan oyuna girince PC'de "Başka bir cihazda oyundasın" ekranı çıktı.
  - Telefon uzaydayken PC hangarında ekipman çıkarma "yalnızca istasyonda" uyarısıyla engellendi.
  - Telefon **Bu cihazda devam et** ile oyunu geri aldı; PC oyuna dönünce bu kez telefon uyarı aldı.
- **Telefon:** Joystick ile gidilen konum sunucuda kaydedildi.
- **Hata kontrolü:** Hiçbir oyun ekranında JavaScript hatası oluşmadı.

**FPS ve ping (dürüst not):**
- Ekran kartı olmayan test sunucusunda yazılımsal çizimle 18–21 FPS (masaüstü) ve 38–41 FPS (iPhone emülasyonu) ölçüldü. Bu değerler gerçek cihaz performansını göstermez.
- Aynı ortamda HUD'daki ping 100–450 ms arasında görüldü, oysa sunucu aynı makinede çalışıyor. Ping, yanıtın JavaScript'te işlendiği ana kadar ölçülür. Büyük olasılıkla çizimle meşgul ana iş parçacığının gecikmesini içeriyor; ağ gecikmesi değil.
- Gerçek ağ ve cihaz ölçümü Aşama 15-16'da yapılacak.

## 5. Geliştirme sırasında bulunan ve düzeltilen sorunlar
1. **Girdi kuyruğu çok küçüktü:** İlk sürümde 8 olan kuyruk sınırı, ağ dalgalanmasında gelen girdi demetlerini atıyordu (test: 20 girdiden yalnızca 8'i işlendi). Sınır 20'ye (1 sn) çıkarıldı. Tik başına tek girdi kuralı hız hilesini yine engelliyor.
2. **Kendi yayınını yanlış yorumlama riski:** Tek oturum mesajı Redis üzerinden sürecin kendisine de geri geliyor. Yanıt sırasına bağlı olarak yeni bağlantının gemisi silinebilirdi. Süreç, kendi kabul ettiği bağlantıları tanıyıp bu mesajı yok sayıyor.
3. **Yavaş istemci belleği şişirebilirdi:** Gönderim arabelleği 512 KB'ı aşan bağlantıya anlık görüntü atlanıyor.
4. **Karşılamadan önce anlık görüntü (tarayıcı testinde yakalandı):**
   - Pilot sunucuda zaten varken (ör. PC'de oyundayken telefondan girince) gemi yeni bağlantıya `welcome`'dan önce bağlanıyordu.
   - Aradaki birkaç milisaniyelik veritabanı beklemesinde tik gelirse telefona önce `snap` gidiyor; harita henüz olmadığı için telefon "Cannot read properties of undefined" hatası veriyordu. Aynı açık yeni giriş yolunda da vardı.
   - Düzeltme: `welcome` gönderilene kadar o bağlantıya anlık görüntü gönderilmiyor. İstemci de haritası yokken dünya mesajlarını yok sayıyor.
   - Sürekli tik atarken giriş yapan bir regresyon testi eklendi. Test düzeltme olmadan bu hatayı yakalıyor (`expected 'snap' to be 'welcome'`), düzeltmeyle geçiyor.

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Savaş, hedef seçme, NPC, ölüm/yeniden doğma, ödül yok | Aşama 9 |
| 2 | Protokol JSON. İkili protokol ve 16-bit konum nicemleme yok (ölçülen bant genişliği hedefin altında) | Aşama 16 |
| 3 | Tek oyun sunucusu süreci tüm haritaları çalıştırır. Birden çok süreç arasında harita dağıtımı ve devri yok (tek oturum kuralı süreçler arası çalışıyor) | Aşama 16-17 |
| 4 | Oturum iptali en geç 30 sn'de, harita bakımı en geç 15 sn'de yansır (anlık yayın değil, periyodik denetim) | Aşama 14: Yönetim Merkezi işlemleri Redis'e anlık yayın yapacak |
| 5 | `item_types` SQL ile değiştirilirse çevrimiçi oyuncuya yeniden bağlanınca veya hangar işleminde yansır | Aşama 14 (içerik sürümleme + `content:updated` yayını) |
| 6 | Yük testi (yüzlerce eşzamanlı bağlantı) yapılmadı. Ölçülen: 10 pilotla bant genişliği | Aşama 16 |
| 7 | Gerçek mobil ağda (3G/4G kayıp, yüksek gecikme) test yok; yalnızca yerel ağ ve emülasyon | Aşama 15-16 |
| 8 | Güvenli bölge kuralları (saldırı yasağı) savaşla birlikte uygulanacak | Aşama 9 |

## 7. Sonraki aşama
**Aşama 9: NPC ve savaş.**
- Hedef seçme (tıklama / dokunma / otomatik hedef), lazer ve roket ateşi, sunucu tarafı menzil ve atış hızı denetimi.
- Hasar, kalkan emilimi, mühimmat tüketimi (envanter defteriyle).
- NPC aileleri, doğma noktaları ve yapay zekâ (devriye, saldırı, kaçış).
- Ölüm, istasyonda yeniden doğma, onarım.
- Ödüller: deneyim, kredi, kargo kutusu (defterli). Güvenli bölgede saldırı yasağı.

## 8. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-08-Multiplayer.zip` (Aşama 1–7 dahil tam proje). `node_modules`, `dist` ve `.env` içermez.
