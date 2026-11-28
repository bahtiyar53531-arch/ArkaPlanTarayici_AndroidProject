# Aşama Raporu — Aşama 10: Görev sistemi

**Tarih:** 28.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-10-Gorev-Sistemi.zip`

> **Kapsam notu:**
> - Görev motoru, 300 görev, günlük/haftalık döngüler, etkinlik görevleri, ödül, oyun içi görev arayüzü ve anında başarımlar bu aşamada tamamlandı.
> - Görevler yalnızca **bugün çalışan** sistemlerle ilerleyebilen hedefler içerir. Madencilik (`collect_resource`) ve Yıldız Kapısı (`complete_gate`) hedefleri o sistemler gelince eklenecek. Çalışmayan görev yayımlanmadı.
> - Görevlerin Yönetim Merkezi'nden düzenlenmesi Aşama 14'tedir; şimdilik içerik migration ve SQL ile yönetilir.

Kurallar, içerik ve API: [Görev Kuralları ve API](../Asama-10-Gorev-Sistemi/Gorev-Kurallari-ve-API.md) · Kurulum: [Güncelleme Rehberi](../Asama-10-Gorev-Sistemi/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)

## 1. Tamamlanan işler

| İstenen | Durum | Ayrıntı |
|---|---|---|
| ~300 görev | ✅ | **300 görev, 338 hedef.** Dağılım: 120 ana/zincir (Büyük Sıçrama 40 + 8 yan zincir), 90 günlük, 60 haftalık, 30 etkinlik (5 etkinlik). Gerçek NPC, harita ve eşya adlarıyla yazıldı |
| Ana ve zincir görevler | ✅ | Kabul et / bırak. Zincirde sonraki görev, öncekinin ödülü alınınca açılır. Seviye kilidi "N. seviyede açılır" diye görünür. Aynı anda en fazla 10 etkin görev (ayarlanabilir) |
| Günlük görevler | ✅ | Seviye bandına uygun havuzdan, pilota özel tohumlu seçimle 3 görev. Her gün **05:00 TSİ**'de yenilenir; günde 1 yeniden çekme hakkı |
| Haftalık görevler | ✅ | 3 görev; pazartesi 05:00 TSİ'de yenilenir; haftada 1 yeniden çekme hakkı |
| Etkinlik görevleri | ✅ | Tarih penceresinde kabul edilir ve ilerler. 14 gün içinde başlayacak etkinlik "kilitli" görünür. **Açılış Şenliği** (28.11.2026–01.01.2027) şu an açık |
| Olay tabanlı ilerleme | ✅ | 11 hedef türü: NPC öldürme, PvP, kargo, harita ziyareti, hasar, yol, roket, geçit, başarılı yükseltme, satın alma, seviye. **Yalnızca sunucuda**; istemcinin ilerleme ucu yok |
| Verimli kayıt | ✅ | Oyun sunucusu yalnızca pilotun etkin hedefleriyle eşleşen olayları biriktirir ve saniyede bir tek transaction'da yazar. İlerleme oyuncuya `qp` mesajıyla anında gider |
| Şirkete göre görev | ✅ | `{c}` yer tutucusu: Gökbörü pilotu için "Çakal yok et (G-1)", Kızılelma için "(K-1)" |
| Ödül | ✅ | "Ödülü al": Kredi, Akçe, deneyim, şeref, eşya. Defterli ve idempotent; eşzamanlı iki istek tek ödül verir. Tamamlanan görevin ödülü döngü bitse de kaybolmaz |
| Seviye hedefleri | ✅ | Kabul anında değerlendirilir. Görev ödülüyle seviye atlanınca etkin seviye hedefleri aynı transaction'da güncellenir |
| Başarımlar anında | ✅ | NPC, PvP, kargo, seviye ve görev ödülünden sonra değerlendirilir. Oyunda "Başarım kazanıldı: …" bildirimi (Aşama 9 sınırlaması kapandı) |
| Hangar olayları | ✅ | Başarılı yükseltme ve mağaza alımı görevi aynı transaction'da ilerletir. Tekrar isteği (aynı `requestId`) iki kez sayılmaz |
| Görevler sayfası | ✅ | `/gorevler`: 4 sekme, ödül-hazır rozeti, yenilenme geri sayımı, yeniden çekme hakkı, hedef çubukları, ödül etiketleri, tamamlananlar listesi |
| Oyun içi arayüz | ✅ | **Q** (ayarlanabilir) ve 📜 ile görev çekmecesi; telefonda tam ekran ve kaydırılabilir. Sol üstte görev izleyici (masaüstü 3, telefon 2). Görev tamamlanınca bildirim |

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0006_quests.sql`: 4 tablo + ayarlar + 300 görev (üretici: `gen_quests.py`, deterministik) |
| Ortak paket | `packages/shared/src/quests.ts`, `quests.test.ts` (8 test) |
| API | `apps/api/src/modules/quest/{service,routes}.ts`, `apps/api/src/modules/economy/rewards.ts` (ortak ödül), `apps/api/src/modules/player/achievements.ts` (ortak başarım) |
| İstemci | `apps/client/src/components/quests/QuestBoard.tsx`, `apps/client/src/pages/QuestPages.tsx` |
| Testler | `apps/api/test/quest.test.ts` (10 test, zaman taklidi) + `combat.test.ts` içinde 4 oyun sunucusu görev testi |
| Belgeler | `Documentation/Asama-10-Gorev-Sistemi/{Gorev-Kurallari-ve-API,Kurulum-ve-Dosya-Yerlestirme-Rehberi}.md`, bu rapor, 7 ekran görüntüsü (`ekran-goruntuleri/asama-10`) |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/game/server.ts` | Görev olayları, etkin hedef önbelleği, saniyede bir toplu yazım, yeni döngü algısı, `qp`/`quests` mesajları, anında başarım |
| `apps/api/src/game/persistence.ts` | Ödül verme ortak modüle taşındı |
| `apps/api/src/modules/hangar/service.ts` | Yükseltme ve satın alma görev olayları (aynı transaction) |
| `apps/api/src/modules/player/service.ts` | Başarım değerlendirmesi ortak modülü kullanıyor |
| `apps/api/src/{app.ts, modules/game/bridge.ts}` | Görev servisi ve uçları, `quests` bildirim gerekçesi, test için saat seçeneği |
| `packages/shared/src/{net,world,api-types,index}.ts` | `qp`/`quests` mesajları, görev tuşu (Q), 6 yeni hata kodu |
| `apps/client/src/{game/controller.ts, components/game/GameHud.tsx, components/game/SettingsPanel.tsx, pages/GamePage.tsx, App.tsx, components/Layout.tsx, styles/*.css}` | İzleyici, çekmece, üst çubuk butonu, Görevler menüsü ve sayfası |
| `apps/api/test/helpers.ts`, `scripts/e2e-auth.mjs`, `scripts/ui-e2e.mjs` | Görev ayarı, saat taklidi, görev adımları; tarayıcı testinde oyun sunucusu günlüğü dosyaya yazılıyor |
| `database/schema-draft.sql` | Görev tabloları taslaktan çıkarıldı |
| `Documentation/{02,04,06,07}`, README'ler, Karar Günlüğü | Durum, 0006 tabloları, K-054…K-062 |

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 67/67. Yeni: 05:00 TSİ sınırları, ISO hafta ve yıl dönümü, sonraki sıfırlama anı, hedef eşleme (`{c}`, aile, harita türü, hasar hedefi, yükseltme seviyesi, kategori), ilerleme üst sınırı, olay şeması, tohumlu seçim |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis + WebSocket**) | ✅ 162/162 (14 yeni) |
| API uçtan uca (gerçek API + oyun sunucusu süreçleri + SMTP) | ✅ 38/38 adım (2 yeni) |
| Tarayıcı uçtan uca (Chromium: masaüstü + iPhone 13) | ✅ 50/50 adım (5 yeni) |
| `npm run build`, `npm audit` | ✅ / 0 açık |
| Şema doğrulama | ✅ 0001 → 0006 + taslak boş veritabanına hatasız (94 tablo; 300 görev, 338 hedef; tüm ödül eşya/para kodları mevcut) |

**Görev servisi testlerinde doğrulananlar** (gerçek içerikle; saat test içinden ayarlanır):
- **Liste:** Yeni pilotta zincir başları alınabilir, sonraki görevler gizli. "Akrep Zehri" görevi "3. seviyede açılır" diye kilitli. 1–6 bandından 3 günlük ve 3 haftalık görev etkin. Açılış Şenliği açık; seviye isteyen etkinlik görevi kilitli; 3 hafta sonraki etkinlik görünmez. Aynı gün tekrar istekte aynı görevler geldi, yeni atama yapılmadı.
- **Zincir ve ödül:** Önceki görev bitmeden sonraki alınamadı. İlerleme yalnızca sunucu olayıyla arttı ve hedefte durdu (3.500 → 3.000). Tamamlanmamış görevin ödülü 409 döndü. **Eşzamanlı iki ödül isteğinden** biri ödülü aldı, diğeri `replay` döndü; defterde tek kayıt oluştu. Sonraki zincir görevi açıldı.
- **Şirket haritası:** Gökbörü pilotu için K-1'deki Çakal ve G-1'deki Akrep sayılmadı, G-1'deki Çakal sayıldı.
- **Seviye:** 5. seviyedeki pilotun "5. seviyeye ulaş" görevi kabul anında tamamlandı. 4. seviyedeki pilot görev ödülüyle 5'e çıkınca seviye görevi aynı istekte tamamlandı ve `level_5` başarımı verildi.
- **Sınır ve bırakma:** Etkin görev sınırı 2'ye indirilince üçüncü görev reddedildi ("en fazla 2"). Bırakılan görev yeniden alınabildi. Günlük görev bırakılamadı.
- **Günlük döngü:**
  - 04:30 TSİ'de önceki günün görevleri geldi.
  - Tamamlanan görev yeniden çekilemedi; diğeri çekildi; ikinci çekme `REROLL_LIMIT` döndü.
  - 05:00'te yeni 3 görev geldi ve hak sıfırlandı. Dünün tamamlanmış görevi listede kaldı ve ödülü alındı; dünün tamamlanmamışları listeden kalktı.
- **Haftalık döngü:** Pazar 23:00 ve pazartesi 04:59'da W48, pazartesi 05:00'te W49.
- **Etkinlik:** Başlamamış etkinlik kilitli göründü ve kabul edilemedi. Etkinlik bitince tamamlanmamış görev listeden kalktı ve olay almadı; tamamlanmış görevin ödülü yine alındı.
- **Güvenlik:**
  - `POST /quests/progress` → 404. Bilinmeyen kod 404. `progress` alanı eklenmiş istek 400 döndü.
  - Oturumsuz istek 401. Pilotsuz istek `PILOT_NOT_FOUND`.
  - Başka oyuncunun tamamladığı görevin ödülü alınamadı (defter boş).
- **Hangar:** Mühimmat alımı görevi ilerletti; aynı `requestId` tekrarı sayılmadı; roket alımı mühimmat görevini ilerletmedi. Başarılı yükseltme "Usta İşi" görevini tamamladı.

**Oyun sunucusu görev testlerinde doğrulananlar** (gerçek WebSocket):
- NPC öldürünce `qp` mesajı 1/2, ikincide "tamamlandı" ve "Görev tamamlandı" bildirimi geldi; veritabanında durum `completed`.
- Bağlanınca bulunulan harita "ziyaret" sayıldı.
- NPC'ye %10 hasar veren pilota öldürme sayılmadı, öldüren pilota sayıldı.
- Oyundayken API'den kabul edilen görev `quests` mesajıyla anında izlendi; uçuş "yol" görevini ilerletti.
- Seviye atlatan öldürme "Başarım kazanıldı: Kanatlandın" bildirimi gönderdi.

**Tarayıcıda gerçekten denenenler:**
- **Masaüstü:**
  - Görev izleyicide 3 görev vardı. Q ile çekmece açıldı, "Eğitim Avı" kabul edildi.
  - Eğitim Kurdu yok edilince "Görev tamamlandı" bildirimi geldi, izleyicide ✔ "Ödülünü al" ve 📜 butonunda ödül rozeti göründü.
  - İzleyiciye tıklayınca çekmece açıldı; ödül alındı ("+500 deneyim · +1.000 Kredi"); defterde kayıt var.
  - `/gorevler` sayfası: günlük sekmesinde yenilenme süresi ve 3 görev, etkinlik sekmesinde Açılış Şenliği, ana sekmede "Tamamlanan görevler (1)".
  - Günlük "Talimci" görevinin hasar hedefi, önceki adımlarda verilen gerçek hasarla ilerlemişti (240 / 20.000).
- **Telefon (iPhone 13 emülasyonu):**
  - 📜 ile çekmece tam ekran açıldı. Liste ekrandan uzundu, kaydırıldı ve son görev görünür oldu.
  - `/gorevler` sayfası kaydırıldı; ödülü alınan görev "Tamamlanan görevler" altında göründü.
- **Hata kontrolü:** Oyun ekranlarında JavaScript hatası oluşmadı.

**Dürüst not:**
- FPS (yazılımsal çizim, ekran kartı yok): masaüstü ~21, telefon emülasyonu 46–48. Gerçek cihazı göstermez.
- Gerçek telefonda deneme yapılmadı.

## 5. Geliştirme sırasında bulunan ve düzeltilen sorunlar
1. **Sonsuz yeniden yükleme riski (kod incelemesinde yakalandı):**
   - Oyun içi çekmece her çizimde yeni bir `onChange` fonksiyonu veriyordu.
   - Görev panosu bunu yükleme etkisinin bağımlılığı yaptığı için her çizimde liste yeniden istenecekti.
   - Geri çağırımlar `ref`'e alındı; liste yalnızca açılışta ve sunucu "quests" bildirince isteniyor.
2. **Görsel (ekran görüntüsünden):**
   - Çekmecenin arka planı %95 saydamdı; HUD yazıları başlığın arkasından seçiliyordu. Arka plan tam opak yapıldı.
   - Telefonda sekmeler iki satıra taşıyordu; tek satır ve yatay kaydırma yapıldı.
3. **Test tasarımı:**
   - Aynı olay, eşleşen günlük görevleri de ilerletebiliyor (ör. "Karma Av" her haritadaki Çakalı sayar). Testler zincir görevini koduyla kontrol edecek şekilde düzeltildi; bu davranış doğru.
   - Test NPC kimliği yanlış alandan okunuyordu (`entityId` yerine `id`).
   - İkinci atış lazer bekleme süresine takılıyordu.
   - Başlangıç Kredisi üç mühimmat paketine yetmiyordu.
4. **Ödül dengesi:** İlk üretimde ödüller cömertti (bir haftalık görev ~5 milyon deneyim). Oranlar düşürüldü (ana %50, günlük %35, haftalık %40, etkinlik %40) ve bantlar arası yinelenen başlıklara I–IV eki verildi.

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Madencilik ve Yıldız Kapısı hedefleri yok (sistemler henüz yok) | Aşama 11 (kaynaklar) ve kapılarla |
| 2 | Görev içeriği Yönetim Merkezi'nden düzenlenemiyor. İçerik 60 sn önbellekte; SQL değişikliği en geç 60 sn'de yansır | Aşama 14 |
| 3 | Etkinlik tarihleri içerikte sabit; yıllık tekrar kuralı yok | Aşama 14 (etkinlik yönetimi) |
| 4 | Ödül değerleri formülle hesaplanmış ilk ayardır; gerçek oyuncu verisiyle dengelenmedi | Aşama 14-16 (canlı veriyle) |
| 5 | Grup/klan görevleri ve grup üyelerinin görev paylaşımı yok | Aşama 12 (grup, klan) |
| 6 | Sezon bileti / sezon puanı yok (araştırmada görülen sistem) | Kapsam dışı; istenirse Aşama 11 ekonomiyle |
| 7 | Oyun sunucusu çökerse en fazla son 1 sn'lik görev olayı kaybolabilir (oyuncu aleyhine değil) | Bilinçli karar (K-055) |
| 8 | Her NPC öldürmede başarım değerlendirmesi birkaç ek sorgu yapar; yüzlerce oyuncuyla yük testi yapılmadı | Aşama 16 |
| 9 | Seviye atlayan pilotun yeni seviyesi, onu zaten görmekte olan diğer oyunculara ancak yeniden görüş alanına girince yansır | Aşama 16 (protokol iyileştirmesi) |
| 10 | Gerçek telefonda deneme yok; yalnızca emülasyon | Aşama 15 |

## 7. Sonraki aşama
**Aşama 11: Ekonomi.**
- Kaynaklar ve madencilik (görevlerdeki `collect_resource` hedefi de açılacak).
- Açık artırma, üretim tarifleri, günlük giriş ödülü.
- Mağaza indirim ve paketleri.
- Eşzamanlı satın alma ve idempotent anahtar testleri (07 kabul ölçütleri).

## 8. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-10-Gorev-Sistemi.zip` (Aşama 1–9 dahil tam proje). `node_modules`, `dist` ve `.env` içermez.
