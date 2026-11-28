# Aşama Raporu — Aşama 11: Ekonomi

**Tarih:** 28.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-11-Ekonomi.zip`

> **Kapsam notu:**
> - Cüzdan, defter ve mağaza Aşama 5–6'da kurulmuştu. Bu aşama ekonomiyi tamamlar: kaynaklar ve madencilik, rafineri ve süreli üretim, sistem açık artırmaları, günlük giriş ödülü, mağaza paketleri.
> - 07'deki eşzamanlılık kabul ölçütü testle doğrulandı.
> - Oyuncudan oyuncuya ticaret ve pazar yeri bilinçli olarak **yok** (K-067).

Kurallar, içerik ve API: [Ekonomi Kuralları ve API](../Asama-11-Ekonomi/Ekonomi-Kurallari-ve-API.md) · Kurulum: [Güncelleme Rehberi](../Asama-11-Ekonomi/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)

## 1. Tamamlanan işler

| İstenen | Durum | Ayrıntı |
|---|---|---|
| Kaynaklar | ✅ | 7 kaynak (3 cevher, 2 ikinci kademe, Kozmit, satılamaz Yıldız Özü). Envanterde yığınlanabilir eşya; satış Aşama 6 satış ucuyla |
| Madencilik | ✅ | 45 kaynak bölgesinden 414'e kadar maden noktası. Oyun sunucusunda yakınlıkta toplanır; verim sunucu zarı; defter `mining`; aynı nokta bir kez |
| Gemi ambarı | ✅ | Kapasite gemi + Kargo Genişletici. Dolunca toplama durur ve bildirilir; HUD'da "Ambar x / y". Satış/üretim sonrası oyunda anında güncellenir |
| Rafineri ve üretim | ✅ | 12 tarif. Girdiler başlatırken düşer (eksikse hiçbiri düşmez), çıktı süre dolunca "Teslim al". 3 yuva, en fazla 50 adet, idempotent başlatma |
| Açık artırma | ✅ | 9 lot (saatlik/günlük/haftalık). Teklif emanete alınır, geçilen teklif aynı transaction'da iade edilir, en az %5/100 artış, son saniye uzatması. Kapanış zamanlayıcısı birden çok süreçte güvenli |
| Günlük ödül | ✅ | 7 günlük takvim, art arda giriş serisi (05:00 TSİ), kaçırılınca başa döner; günde tek ödül (eşzamanlı istekte de) |
| Mağaza paketleri | ✅ | 3 paket (biri %40 indirimli ve hesap başına bir kez). İçerik tek transaction'da; seviye şartı içerikteki en yüksek şart |
| **07 kabul ölçütü** | ✅ | 50 eşzamanlı satın almada negatif bakiye yok; aynı idempotency anahtarı yalnızca bir kez uygulanır (testli) |
| Görevler | ✅ | `collect_resource` ve `craft_item` hedefleri; 18 yeni görev ("Altay'ın Mirası" zinciri + günlük/haftalık), toplam 318 |
| Pazar sayfası | ✅ | `/pazar`: Günlük ödül · Kaynaklar (ambar, satış) · Üretim (kuyruk, geri sayım, tarifler) · Açık artırma (teklif, öndesin, geçmiş). Mağazada Paketler kategorisi, hangarda "Kaynaklar" filtresi |
| Oyun içi | ✅ | Renkli kristal görseli, mini haritada maden noktaları, tıklayınca oraya uçma, "Kaynak toplandı" bildirimi |

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0007_economy.sql` (görevler `gen_economy_quests.py` ile üretildi) |
| Ortak paket | `packages/shared/src/economy.ts`, `economy.test.ts` (7 test) |
| API | `apps/api/src/modules/market/{service,routes}.ts` |
| İstemci | `apps/client/src/pages/MarketPages.tsx` |
| Testler | `apps/api/test/market.test.ts` (8 test), `combat.test.ts` içinde madencilik testi |
| Belgeler | `Documentation/Asama-11-Ekonomi/{Ekonomi-Kurallari-ve-API,Kurulum-ve-Dosya-Yerlestirme-Rehberi}.md`, bu rapor, ekran görüntüleri (`ekran-goruntuleri/asama-11`) |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/game/{server,content,persistence}.ts` | Maden noktaları (oda, yeniden doğma, yayın), toplama, ambar, `cs.cargo` |
| `apps/api/src/modules/hangar/service.ts` | Paket teklifleri (liste, satın alma, envanter ve seviye denetimi) |
| `apps/api/src/{app.ts,index.ts}` | Pazar servisi ve uçları; açık artırma zamanlayıcısı |
| `packages/shared/src/{items,quests,combat,net,api-types,player,index}.ts` | `resource` kategorisi, yeni görev hedefleri, ambar, varlık türü `r`, paket alanları, 7 hata kodu, defter etiketleri |
| `apps/client/src/{game/*, components/game/GameHud.tsx, components/ShipArt.tsx, pages/HangarPages.tsx, App.tsx, components/Layout.tsx, lib/format.ts, styles/*}` | Kristal görseli, ambar göstergesi, paket kartı, Pazar menüsü, ikonlar |
| `apps/api/test/{game,combat,quest,hangar}.test.ts`, `scripts/*.mjs` | Gerçek maden noktaları testlerde kapalı (test kendi noktasını ekler); mağaza kategori sırası; görev havuzu; yeni E2E adımları |
| `database/schema-draft.sql` | Ekonomi tabloları taslaktan çıkarıldı |
| `Documentation/{02,04,06,07}`, README'ler, Karar Günlüğü | Durum, 0007 tabloları, K-063…K-071 |

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 74/74 (7 yeni: açık artırma dönemleri, teklif artışı, son saniye uzatması, günlük seri ve yıl geçişi, kaynak/üretim şemaları, yeni görev hedefleri) |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis + WebSocket**) | ✅ 171/171 (9 yeni) |
| API uçtan uca (gerçek API + oyun sunucusu süreçleri) | ✅ 43/43 adım (5 yeni) |
| Tarayıcı uçtan uca (Chromium: masaüstü + iPhone 13) | ✅ 57/57 adım (7 yeni). Başsız yazılımsal çizimde FPS: masaüstü 21, telefon emülasyonu 44. Bu bir ölçüm ortamı değeridir; gerçek cihaz FPS'i değildir |
| `npm run build`, `npm audit` | ✅ Hatasız · 0 açık |
| Şema doğrulama | ✅ 0001 → 0007 + taslak boş veritabanına hatasız (96 tablo; tüm tarif ve paket eşya kodları mevcut) |

**Doğrulananlar** (zaman taklidiyle; gerçek içerikle):
- **Eşzamanlılık (07):**
  - 35.000 Kredi bakiyeyle 50 eşzamanlı satın alma (her biri 10.000): tam 3'ü başarılı, 47'si `INSUFFICIENT_FUNDS`. Bakiye 5.000; defterde 3 kayıt (−30.000).
  - Aynı istek kimliğiyle 50 eşzamanlı istek: tek satın alma, 49 `replay`, bakiye bir kez düştü.
- **Açık artırma:**
  - 9 dönem açık artırması oluştu; bitişler 11:00, ertesi gün 05:00 TSİ ve pazartesi 05:00 TSİ.
  - Taban altı ve artış altı teklifler reddedildi ("En az 4.000 Kredi…").
  - B geçince A'nın 4.000'i iade edildi. 10:59:30'daki teklif bitişi 11:00:30'a uzattı; 11:00:10'da hâlâ açıktı.
  - 11:01'de A kazandı ve 10 Nebulit aldı. Tekrar sonuçlandırma 0 döndü; teklifsiz iki açık artırma kazanansız kapandı. Defter sırası birebir doğrulandı.
  - 8 oyuncu aynı anda teklif verdi: tek lider; diğer herkesin bakiyesi başlangıçtakiyle aynı.
- **Üretim:**
  - Girdiler hemen düştü (20 Kuvarsit, 20 Ferrolit, 100 Kredi).
  - Süre dolmadan "Üretim henüz bitmedi (60 sn kaldı)" döndü; dolunca 2 Nebulit verildi; ikinci istek `replay`. Defter: `crafting_input` / `crafting_output`. "Rafineri" zincir görevi tamamlandı.
  - Eksik kaynakta hiçbir şey düşmedi. 1. seviyede Kozmit kilitli. 4. üretim `CRAFT_SLOTS_FULL`. Aynı istek kimliği ikinci kez düşmedi. `output` alanı eklenmiş istek reddedildi.
- **Günlük ödül:**
  - 1. gün 2.000 Kredi; tekrar `replay`. Ertesi gün eşzamanlı iki istekte tek ödül (2. gün).
  - Bir gün atlanınca 1. güne döndü; 7. günden sonra seri 8, takvim 1.
- **Kaynak satışı:** 30 Ferrolit +300 Kredi; Yıldız Özü `NOT_SELLABLE`; ambar 41/100 doğru.
- **Paket:** 300 Akçe (−%40); 4 içeriğin hepsi envanterde; ikinci alım `PURCHASE_LIMIT`; Avcı Paketi seviye 6 şartı.
- **Madencilik (WebSocket):**
  - Ambarı 97/100 olan pilot 4 verimli noktadan yalnızca 3 aldı.
  - Ambar dolunca ikinci nokta alınmadı ve "Ambarın dolu (100/100)…" bildirimi geldi.
  - Defterde `mining +3`; "İlk Cevher" görevi 3/10.

**Tarayıcıda gerçekten denenenler:**
- **Masaüstü:**
  - Test maden noktasına gelen gemi 30 Titanyum topladı ("Kaynak toplandı: 30 × Titanyum Tozu", HUD "Ambar 30 / 100", defter).
  - Pazar'da 1. gün ödülü alındı. 10 Titanyum satıldı (+140 Kredi, ambar 20). Test tarifi üretildi ve süre dolunca teslim alındı.
  - Saatlik Nebulit açık artırmasına 4.000 teklif verildi ("En yüksek teklif senin", defterde −4.000).
  - Mağazada indirimli Acemi Pilot Paketi satın alındı (300 Akçe).
- **Telefon:** Pazar'da PC'de alınan günlük ödül "Bugünün ödülü alındı" olarak göründü; üretim tarifleri listelendi.
- Aşama 1–10'un tüm adımları da yeniden geçti.

## 5. Geliştirme sırasında bulunan ve düzeltilen sorunlar
1. **Eşzamanlı sorgu riski:** Üretim ekranı verisi transaction istemcisinde paralel sorgularla okunuyordu (Aşama 8'de yaşanan sorunun aynısı). Sıralı hale getirildi.
2. **Kendi teklifini artırma:** İlk sürümde yeni tutar iade edilmeden önce düşülüyordu; emanetteki tutarı kullanmak isteyen oyuncu reddedilebilirdi. Önce iade, sonra emanet yapılıyor.
3. **Hata mesajında kod:** "Yetersiz kaynak: 10 res.kuvarsit" yazıyordu; eşya adına çevrildi ("10 Kuvarsit").
4. **Önceki aşama testleri:** Mağaza artık "Paketler" ile açılıyor. Aşama 6 tarayıcı adımı "Gemiler" sekmesine tıklayacak şekilde güncellendi; ilk koşuda bu adım ve ona bağlı iki adım başarısız olmuştu. Görev havuzu testi de seviye şartsız madencilik görevlerini kapsayacak şekilde güncellendi.
5. **Gerçek maden noktaları testleri etkileyebilirdi:** Oyun, savaş ve E2E testleri gerçek maden noktalarını kapatıp kendi noktalarını ekliyor (NPC'lerde olduğu gibi).
6. **Görsel:** Telefonda Pazar sekmeleri iki satıra taşıyordu; dar ekranda tek satır ve yatay kaydırma yapıldı.

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Oyuncudan oyuncuya ticaret ve pazar yeri yok (bilinçli, K-067) | Değerlendirme Aşama 14+ (sahtekârlık önlemleriyle) |
| 2 | Yıldız Özü'nün "geçici güç" etkisi (08 taslağı) yok; yalnızca IŞK-4 üretiminde kullanılıyor | Güçlendirme (buff) sistemiyle |
| 3 | Üretim iptali ve Akçe ile hızlandırma yok | İhtiyaca göre |
| 4 | Toplama anında; süreli toplama (ilerleme çubuğu) ve PET toplayıcı modülünün madencilikte kullanımı yok | Sonraki iyileştirme |
| 5 | Açık artırmada geçilen oyuncuya anlık bildirim yok (iade defterde ve listede görünür) | Aşama 12 (bildirimler) |
| 6 | Ekonomi değerleri (fiyat, verim, süre, ödül) ilk ayardır; gerçek oyuncu verisiyle dengelenmedi | Aşama 14-16 |
| 7 | Yönetim Merkezi'nden ekonomi düzenleme yok (SQL ile) | Aşama 14 |
| 8 | Maden noktaları harita odası açılırken okunur; canlı değişiklik yeniden başlatma ister | Aşama 14 |
| 9 | Gerçek telefonda deneme yok; yalnızca emülasyon | Aşama 15 |

## 7. Sonraki aşama
**Aşama 12: Klan ve sosyal.**
- Klan, rütbeler, klan hazinesi (defterli) ve diplomasi.
- Grup (party), arkadaşlık ve engelleme.
- Sohbet kanalları (genel, şirket, harita, klan, grup, özel) ve bildirimler; açık artırmada geçilme bildirimi de bunlara dahil.

## 8. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-11-Ekonomi.zip` (Aşama 1–10 dahil tam proje). `node_modules`, `dist` ve `.env` içermez.
