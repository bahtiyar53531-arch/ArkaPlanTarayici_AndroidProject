# Aşama Raporu — Aşama 14: TÜRK ORBIT YÖNETİM MERKEZİ

**Tarih:** 28.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-14-Yonetim-Merkezi.zip`

> **Kapsam:**
> - 07'deki Aşama 14 satırı: Yönetim Merkezi'nin tüm modülleri.
> - Kabul ölçütleri:
>   1. "Her uç nokta için yetkisiz → 403 testi"
>   2. "yayınla/geri al"
>   3. "denetim kaydı"
>   4. "iki yetkili onayı"
> - 05'teki senaryolar ("NPC canı değişince oyunda değişir", "fiyat değişince mağazada değişir", "görev yayımlanınca oyuncu görür") **iki hesapla** (yönetici + oyuncu) uçtan uca test edildi.
> - Tüm ölçütler entegrasyon, API uçtan uca ve tarayıcı testleriyle doğrulandı.

Kurallar ve API: [Yönetim Merkezi Kuralları ve API](../Asama-14-Yonetim-Merkezi/Yonetim-Merkezi-Kurallari-ve-API.md) · Kurulum: [Güncelleme Rehberi](../Asama-14-Yonetim-Merkezi/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) · Modül durumu: [05 §0](../05-Yonetim-Merkezi-Plani.md)

## 1. Tamamlanan işler

| İstenen | Durum | Ayrıntı |
|---|---|---|
| Panel uygulaması | ✅ | `apps/admin` (React + Vite), üretimde `/yonetim/`. Oyun hesabıyla aynı oturum, Türkçe, koyu tema. Sol menü yetkiye göre süzülür; üst durum çubuğunda çevrimiçi pilot, oyun sunucusu sayısı, bakım ve bekleyen onay. Mobil/tablet uyumlu (menü çekmecesi) |
| **Yetki koruması (her uç → 403)** | ✅ | 62 uç tek tabloda (`ADMIN_ROUTE_SPECS`). Test her uç için oturumsuz 401, oyuncu 403 ve yetkisi olmayan personel rolü 403 dener. Tabloda olmayan uç sunucuyu başlatmaz |
| Pano | ✅ | Gerçek kayıt/pilot/çevrimiçi sayıları, harita başına pilot, oyun sunucusu süreç metrikleri (Redis nabzı), API/PostgreSQL/Redis gecikmesi, platform başına oturum, kuyruklar, son işlemler |
| Oyuncu yönetimi | ✅ | Arama (ad, e-posta, ID, pilot, IP). Ayrıntı: pilotlar, cüzdanlar, oturumlar, girişler, yaptırım geçmişi. Uyarı, susturma (sohbet + forum), askı, **kalıcı ban (iki yetkili onayı)**, kilit, kaldırma, oturum kapatma. Askı/ban/kilitte oyundan **anında** gerekçeli atma. Rütbe kuralı |
| **İçerik: yayınla / geri al** | ✅ | NPC, gemi, mağaza, görev, harita ve 14 ayar grubu. Akış: taslak → fark + etki → yayın → geri alma. İyimser kilit, ilk durum sürüm 1. Yeni etkinlik görevi oluşturma |
| Canlı yansıma | ✅ | NPC değişikliği oyundaki NPC'lere oran korunarak uygulanır, oyuncu yeni azami canı görür. Gemi değerleri çevrimiçi pilotlarda yeniden hesaplanır. Mağaza ve görev bir sonraki istekte geçerli. Harita kapatma ve PvP anında |
| Ekonomi | ✅ | Gerekçeli para/eşya verme (defterde işlemi yapan yönetici). Eşik üstü tutar onaya gider |
| **İki yetkili onayı** | ✅ | Kalıcı ban, eşik üstü verme, Süper Yönetici ataması. Talep eden onaylayamaz (kod + veritabanı CHECK), işlemden yararlanan onaylayamaz. Süre 72 saat. Yürütme onayla aynı transaction'da, hata olursa "uygulanamadı" |
| Roller | ✅ | Rol–yetki matrisi, üyeler, panelden rol atama (rütbe kuralı, son Süper Yönetici korunur) |
| Şikâyet kuyruğu | ✅ | Durumlara göre liste, içerik kopyası, karar. Şikâyetten verilen yaptırım şikâyeti "işlem yapıldı" yapar |
| Sistem | ✅ | Bakım modu (oyun personel dışına kapalı, oyundakiler gerekçeyle çıkarılır, site/forum açık), oyun içi duyuru, süreç durumu |
| **Denetim kaydı** | ✅ | Tüm işlemler (taslak, yayın, geri alma, yaptırım, rol, verme, onay/red, bakım, duyuru, şikâyet, forum) önce/sonra değerleriyle. Süzme ve sayfalama |
| Klan / forum | ✅ | Klanlar (salt okunur), forum bölümleri (ekle/düzenle/arşivle), bölüm moderatörü atama, destek masasına bağlantı |

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0010_admin.sql` (3 tablo + 1 sütun + ayarlar) |
| Ortak paket | `packages/shared/src/admin.ts`, `admin.test.ts` (5 test) |
| API | `apps/api/src/modules/admin/{common,approvals,players,content,overview,routes}.ts` |
| Yönetim Merkezi | `apps/admin/` (`src/{App,Layout,api,auth,ui}.tsx`, `src/pages/*` — 12 sayfa grubu, `styles.css`) |
| Testler | `apps/api/test/admin.test.ts` (14 test), `admin-live.test.ts` (3 test, gerçek WebSocket) |
| Belgeler | `Documentation/Asama-14-Yonetim-Merkezi/*`, bu rapor, ekran görüntüleri (`ekran-goruntuleri/asama-14`) |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/game/server.ts` | `game:admin` olayları (canlı içerik ve NPC ölçekleme, gemi değerleri, harita, sohbet ayarı, atma/susturma, bakım, duyuru), nabız, NPC bilgisinde azami can |
| `apps/api/src/game/content.ts` | Bellekte olmayan NPC türü görülünce içerik yeniden yükleme |
| `apps/api/src/modules/game/{bridge,routes}.ts` | Yönetim kanalı, nabız/çevrimiçi okuma; bakımda bilet engeli |
| `apps/api/src/modules/auth/service.ts` | Tüm oturumları önbellekle birlikte iptal |
| `apps/api/src/modules/forum/service.ts` | Susturulan kullanıcı foruma yazamaz |
| `apps/api/src/modules/quest/service.ts` | Görev kataloğu önbelleğine isteği bekletmeyen sürüm denetimi |
| `apps/api/src/app.ts` | Servis ve rota bağlantıları |
| `apps/client/src/{game/controller.ts, components/game/GameHud.tsx, styles/game.css}` | Gerekçeli atma ve bakım mesajı (bakımda yeniden bağlanma döngüsü yok), hedef panelinde NPC azami canı, üst üste dizilen bildirimler |
| `packages/shared/src/{net,api-types,index}.ts` | Azami can alanı, bakım kapanış kodu, 13 hata kodu |
| `apps/api/test/helpers.ts`, `scripts/{e2e-auth,ui-e2e,package-phase}.mjs` | Test ayarları; uçtan uca yönetim adımları; panel sunucusu |
| `package.json`, `package-lock.json`, `.env.example`, `infra/nginx/turkorbit.conf.example` | Çalışma alanı, `dev:admin`, izinli kaynak, `/yonetim/` |
| `database/schema-draft.sql` | Uygulanan tablolar taslaktan çıkarıldı |
| `Documentation/{04,05,06,07}`, README'ler, `apps/admin/README.md`, Karar Günlüğü | Durum, 0010 tabloları, modül durumu, K-092…K-101 |

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` (paylaşılan, API, istemci, panel) | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 95/95 (5 yeni) |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis + WebSocket**) | ✅ 214/214 (17 yeni: 14 yönetim + 3 canlı yansıma) |
| API uçtan uca (ayrı API + oyun sunucusu süreçleri) | ✅ 55/55 adım (3 yeni) |
| Tarayıcı uçtan uca (Chromium: 3 masaüstü hesap + iPhone 13) | UI_SONUC |
| `npm run build`, `npm audit` | BUILD_SONUC |
| Şema doğrulama | ✅ 0001 → 0010 + taslak boş veritabanına hatasız (100 tablo) |

**Doğrulananlar (entegrasyon testleri):**
- **403 matrisi:**
  - 62 ucun hepsinde oturumsuz 401 ve oyuncu 403.
  - Yetkiyi taşımayan personel rolüyle 50'den fazla ayrı 403 denetimi.
  - Süper Yönetici ile parametresiz tüm GET uçları 200.
- **Yaptırımlar:**
  - Uyarı bildirimi.
  - Susturmada süre zorunlu, foruma yazma `MUTED`; kaldırınca yazabilir.
  - Askıda açık oturum anında 401, girişte gerekçe görünür. Moderatör askıyı kaldıramaz, topluluk yöneticisi kaldırır.
  - Rütbe: kendine ve eşit/üst rütbeye işlem yapılamadı.
  - Kilit `ACCOUNT_LOCKED` → kaldırma. Oturum kapatma çalışıyor.
- **Kalıcı ban (iki yetkili):**
  - Talep eden onaylayınca `APPROVAL_SELF`. Yetkisiz rol onaylayamaz ve listede görmez.
  - İkinci moderatör onaylayınca hesap yasaklandı; girişte gerekçe görünür.
  - Sonuçlanmış talep yeniden incelenemez.
  - Veritabanı, talep edenin onayını `approval_two_person` ile reddetti.
- **İçerik:**
  - Doğrulama hataları alan bazlı döner; değişiklik yoksa `NO_CHANGES`.
  - Taslak veritabanını değiştirmez, fark doğru.
  - Yayından sonra değer güncellendi; sürümler 1 → 2 oldu; denetimde önce/sonra değerleri ve not var.
  - İçerik yöneticisi geri alamaz (403); oyun yöneticisi sürüm 1'e döndü (v3 yayında, v2 "geri alındı").
- **İyimser kilit:**
  - SQL ile araya giren değişiklikte yayın `REVISION_CONFLICT` aldı, veritabanı korundu.
  - Yeni taslak doğrudan değişikliği sürüm olarak kaydetti.
  - Başka yöneticinin taslağı eskisini geçersiz kıldı.
- **Mağaza:** Fiyat 1.000 → 1.500 ve %20 indirim yayınlandı. Oyuncunun mağazasında 1.200 göründü ve satın almada 1.200 düştü. Geri almada 1.000 geri geldi. İçerik yöneticisi mağaza fiyatı yazamaz (`economy.write` yalnızca oyun yöneticisinde).
- **Görev:** Yeni etkinlik görevi oluşturuldu ama yayımlanmadığı için oyuncu görmedi. Yayından sonra hedefiyle birlikte görev listesinde göründü. Etkinlikte tarih silinemez.
- **Ayar:**
  - Kayıt kapatılınca `REGISTRATION_CLOSED`, geri alınca kayıt açıldı.
  - İç içe ayarda yalnızca düzenlenen anahtar değişti.
  - İçerik yöneticisi ayarlara dokunamaz.
- **Para verme:**
  - 5.000 Kredi anında verildi; defterde yönetici kimliği, oyuncuda bildirim var. Eşya defteri doğru.
  - Bilinmeyen kod reddedildi; kendine verme engellendi.
  - 2.000.000 Kredi onaya gitti: talep eden onaylayamadı, yetkisiz onaylayamadı. Yararlanan oyun yöneticisi kendi pilotuna yapılan talebi onaylayamadı (talep açık kaldı).
  - İkinci oyun yöneticisi onaylayınca uygulandı; defterde başlatan, denetimde onaylayan görünüyor.
  - Red ve 73 saat sonra süre dolması çalışıyor.
  - Pilot silinmişken onay "uygulanamadı" oldu.
- **Roller:**
  - Oyun yöneticisinin `roles.assign` yetkisi yok.
  - Süper Yönetici moderatör atadı; yetki `/auth/me`'de görünüyor.
  - Süper Yönetici ataması onaylı; son Süper Yönetici kaldırılamaz.
- **Bakım modu:** Oyuncu bileti 503 `MAINTENANCE` (mesajla), personel bileti 200, forum açık; kapatınca oyuncu bileti 200. Duyuru denetime yazıldı.
- **Pano, şikâyet, denetim:**
  - Sayılar gerçek; moderatörün denetim okuma yetkisi yok.
  - Şikâyetten uyarı verilince şikâyet "işlem yapıldı" oldu.
  - Salt okunur rol denetimi süzebildi ama değişiklik yapamadı.
- **Canlı yansıma (gerçek oyun sunucusu + WebSocket):**
  - Yarı canlı çakal 400 → 1000 yayından sonra 500/1000 oldu.
  - Oyuncu "Çakal Reisi" adını ve 1000 azami canı aldı; geri alma da canlı uygulandı.
  - Susturulan pilotun sohbeti reddedildi, duyuru iki pilota ulaştı.
  - Askıda bağlantı 4003 ile gerekçeli kapandı, diğer pilot etkilenmedi.
  - Bakımda oyuncu 4011 ile atıldı, personel kaldı; pano nabzı göründü.

**API uçtan uca (ayrı süreçler):**
- Oyuncuya 403; pano gerçek kullanıcı sayısını ve 1 oyun sunucusunu gösterdi.
- API'den yayımlanan NPC canı Redis üzerinden **ayrı oyun sunucusu sürecine** ulaştı; oyuncunun bağlantısında 3000 → 6000 azami can görüldü.
- Askıda oyuncunun oyun bağlantısı gerekçeli 4003 ile kapandı ve oturumu düştü; ban kaldırılınca giriş yapabildi.

**Tarayıcıda gerçekten denenenler (yönetici A, oyuncu B, ikinci yetkili C):**
- B panele girince "Yetkin yok" gördü; yönetim API'si 403 döndü.
- A'ya sunucu tarafında oyun ve sistem yöneticisi rolleri verildi. Pano veritabanıyla aynı oyuncu sayısını ve "1 oyun sunucusu"nu gösterdi.
- **NPC:** B oyunda Eğitim Hedefi'ni hedefledi ("5.000 / 5.000"). A, Can'ı 8.000 yapıp taslağı kaydetti; fark tablosu göründü, veritabanı değişmedi. A yayımlayınca B'nin hedef panelinde "8.000 / 8.000" göründü.
- **Mağaza:** A fiyatı 1.500 yaptı, B mağazada 1.500 gördü. A "Bu sürüme dön" ile v1'e döndü, B yeniden 1.000 gördü.
- **Görev:** A "Çakal Avı Haftası"nı oluşturdu; B etkinlik sekmesinde görmedi. A "Yayında" açıp yayımladı; B gördü.
- **İki yetkili onayı:** A, B'ye 2.000.000 Kredi talebi açtı; onay sayfasında "Bu senin talebin" yazdı. C ayrı tarayıcıda giriş yapıp onayladı; B'nin bakiyesi tam 2.000.000 arttı.
- **Askı:** A, B'yi 1 saatliğine askıya aldı. Oyundaki B'nin ekranında "askıya alındı · Sohbette hakaret" çıktı ve B giriş yapamadı. A banı kaldırdı, B girdi.
- **Bakım:** A bakım modunu açtı. Oyundaki B "Planlı bakım…" mesajıyla çıkarıldı ve oyuna giremedi. A kapatınca B girdi.
- **Denetim kaydı:** Yayın, geri alma, onay, askı, ban kaldırma ve bakım açma/kapama işlemleri listelendi.
- **Telefon:** C, iPhone görünümünde menü çekmecesinden oyuncu sayfasını açtı. Sayfada yatay taşma yok; geniş tablolar kartın içinde yatay kayıyor.
- Aşama 1–13'ün tüm adımları da yeniden koşuldu.

## 5. Geliştirme sırasında bulunan ve düzeltilen sorunlar
1. **Görev önbelleği ve havuz tıkanması:**
   - Yayınlanan görevin hemen görünmesi için görev kataloğuna sürüm denetimi eklendi. İlk hali her çağrıda veritabanını bekliyordu.
   - Satın alma transaction'ı içinde havuzdan ikinci bağlantı istendiği için 50 eşzamanlı satın alma testinde bağlantı zaman aşımı (500) oluştu. Testte yakalandı.
   - Düzeltme: Denetim isteği bekletmeden arka planda yapılıyor. Yayını yapan süreç önbelleği anında tazeliyor (K-098).
2. **Çıkar çatışması:**
   - İlk sürümde talep edenin onaylayamaması vardı; ama işlemden yararlanan (kendi pilotuna para) başka bir yönetici talebi onaylayabiliyordu.
   - Düzeltme: Yararlanan onaylayamaz; talep açık kalır (testli).
3. **Panel ↔ veritabanı sınırları:** NPC hızının alt sınırı panelde 0, veritabanında 1'di; atış aralığında 200 ve 250'ydi. Tarayıcı testinin hazırlığında yakalandı ve hizalandı (birim testi alanları doğrular).
4. **Oyun sunucusu:**
   - Sunucu açıldıktan sonra eklenen NPC türünün doğma noktası, tür bellekte olmadığı için sessizce atlanıyordu (API uçtan uca testinde yakalandı). Artık bilinmeyen tür görülünce içerik bir kez yeniden yükleniyor.
   - Bakımdayken ilk bağlantıda bilet 503 aldığında istemci sonsuz "yeniden bağlanılıyor" döngüsüne giriyordu. Artık bakım mesajı gösteriliyor.
5. **Hedef paneli:** NPC azami canı eklenirken yüzde göstergesi kalkmıştı; Aşama 9'un tarayıcı adımı bunu yakaladı. Artık "8.000 / 8.000 · %100" biçiminde ikisi birden gösteriliyor.
6. **Tarayıcı testi — "B hareket eder" adımı (Aşama 13 raporundaki sınırlama #10):**
   - Adım, yük altında (bu aşamada ikinci bir Vite sunucusu da çalışıyor) koşuların çoğunda düştü.
   - Sebep: Sunucu gemiyi istemcinin gönderdiği girdi kadar ilerletiyor (hız hilesi koruması); yazılımsal çizimde kare hızı düşünce 2 saniyede beklenen mesafe alınamıyordu.
   - Düzeltme: Adım artık sabit süre beklemiyor; mesafenin 8 saniye içinde 300 birim artmasını yokluyor. Doğrulanan davranış aynı.
7. **Panel telefonda — tablo taşması:**
   - Telefon ekran görüntüsünde oyuncu sayfasındaki "Yaptırım geçmişi" tablosu kartın dışına taşıyordu; sağdaki "Bitiş" ve "Durum" sütunları kesiliyordu.
   - Sayfanın kendisi taşmadığı için testteki yatay taşma denetimi bunu yakalamadı; ekran görüntüsü incelenirken görüldü.
   - Düzeltme: Kartlar artık içerik sığmazsa kendi içinde yatay kayıyor. Son tarayıcı koşusunun ekran görüntüsü düzeltilmiş hâli gösteriyor.
8. **Oyun içi bildirimler birbirini siliyordu:**
   - Bir tarayıcı koşusunda Aşama 7'nin "J ile geçitten atlama" adımı düştü. Sunucu geçişi doğru kaydetmişti; ama "G-2 … bölgesine geçtin" bildirimi ekranda görülmedi.
   - Sebep: O koşuda rastgele atanan günlük görev "Şirket Turu" (G-1 ve G-2'yi ziyaret et) geçişle tamamlandı. Sunucu yaklaşık 200 ms sonra "Görev tamamlandı" bildirimini gönderdi. İstemcide tek bildirim yeri olduğu için yeni bildirim öncekini anında sildi. Oyuncu da geçiş mesajını göremiyordu; adımın bazen düşmesinin nedeni günlük görevin rastgele seçilmesiydi.
   - Düzeltme: Bildirimler artık üst üste diziliyor (en fazla 3, her biri 4,5 saniye). Aynı metin yeniden gelirse ikinci kopya açılmıyor, süresi tazeleniyor. Bildirim alanı tıklamaları oyuna geçiriyor.

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Panelde gösterilmeyenler (backend yok, K-101): yedekleme/geri yükleme, sunucu başlat/durdur, istemci sürümleri ve özellik bayrakları, NPC doğma noktası ve görsel harita düzenleyici, eşya istatistik (JSON) düzenleme, görsel yükleme, paket/tarif/açık artırma programı düzenleme, klan yazma işlemleri | Aşama 15–16 |
| 2 | Pano zaman serisi grafikleri ve kalıcı metrik geçmişi yok (anlık değerler var) | Aşama 16 (izleme) |
| 3 | Envanterden eşya silme / bakiye düşürme paneli yok; yalnızca verme | Aşama 16 |
| 4 | Gemi slot sayıları düzenlenmez (takılı ekipmanı geçersiz kılar) | Taşıma kuralıyla birlikte, ihtiyaca göre |
| 5 | Panel girişinde iki aşamalı doğrulama (2FA) yok; nginx IP kısıtı önerilir | Aşama 16 (güvenlik denetimi) |
| 6 | Onaylayan "yararlanan" kontrolü para verme ve rol atamada var; kalıcı banda hedef zaten kendisi olamaz | — |
| 7 | Görev kataloğu diğer API/oyun sunucusu süreçlerine birkaç saniye gecikmeyle yansır (yayını yapan süreçte anında) | Gerekirse Redis bildirimi |
| 8 | Gerçek telefonda deneme yok; panel yalnızca emülasyonda denendi | Aşama 15 |

## 7. Sonraki aşama
**Aşama 15: Android ve iOS (Capacitor).**
- APK + AAB ve iOS Xcode projesi.
- Oturum anahtarının cihazın güvenli deposunda tutulması.
- 07 kabul ölçütü: APK gerçek Android cihazda kurulup aynı hesapla PC oyuncusuyla aynı haritada oynanır. Gerçek cihaz erişimi gerekir; erişemediğim cihazda test edilmiş gibi raporlamayacağım.

## 8. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-14-Yonetim-Merkezi.zip` (Aşama 1–13 dahil tam proje). `node_modules`, `dist`, `.env`, test çıktıları ve yüklenen dosyalar içermez.
