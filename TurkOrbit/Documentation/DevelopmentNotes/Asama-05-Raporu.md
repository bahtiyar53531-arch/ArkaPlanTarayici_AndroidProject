# Aşama Raporu — Aşama 5: Oyuncu Profili

**Tarih:** 27.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-05-Oyuncu-Profili.zip`

## 1. Tamamlanan işler

### Madde 5 (Oyuncu profili) karşılama tablosu

| İstenen alan | Durum | Kaynak |
|---|---|---|
| Pilot adı | ✅ | Hesabın kullanıcı adı (rezerve/taklit adlar kayıtta zaten engelli) |
| Oyuncu ID | ✅ | `users.public_id` (100001'den başlar) |
| Seviye, deneyim | ✅ | Deneyimden sunucuda hesaplanır; 50 seviyelik özgün eğri |
| Şeref ve itibar | ✅ | `players.honor` + rütbe (18 özgün rütbe, puan formülü) |
| Oyun paraları | ✅ | Kredi + Akçe cüzdanları, **değiştirilemez para defteri** ile |
| Şirket | ✅ | 3 özgün şirket, ilk girişte seçim, 30 günde bir ücretli değişim |
| Aktif gemi | ✅ | Başlangıç gemisi Kırlangıç (özgün 2.5D çizim). Diğer gemiler Aşama 6'da |
| Aktif harita | ✅ | 21 haritanın temel kaydı; şirketin başlangıç haritasında başlar. Portal/NPC Aşama 7'de |
| Oyun süresi | ✅ alan hazır | Oyun sunucusu (Aşama 8) yazacak; şu an doğru değer: 0 |
| İstatistikler, savaş ve NPC istatistikleri | ✅ alan hazır | `player_stats`; yalnızca sunucu yazar, istemciden yazılamaz (test edildi) |
| Başarımlar | ✅ | 10 özgün başarım; istatistiklerden otomatik ilerleme ve verilme |
| Klan, arkadaşlar | ⏳ Aşama 12 | Profilde "Yakında" olarak açıkça belirtildi (sahte veri yok) |
| Görev ilerlemesi | ⏳ Aşama 10 | Profilde "Yakında" olarak açıkça belirtildi |
| Tüm cihazlarda senkron | ✅ | Tüm veriler sunucuda; Android uygulama oturumunda yapılan değişikliğin web'de aynen göründüğü test edildi |

### Ek olarak
- **Pilot oluşturma sihirbazı:** sunucu seçimi (Anadolu-1), şirket kartları, onay. E-posta doğrulaması zorunlu.
- **Herkese açık pilot profili** (`/pilot/TR1/<ad>`): e-posta, para, konum ve oynama süresi gibi özel bilgiler göstermez.
- **Para hareketleri ekranı:** oyuncu kendi defter kayıtlarını görür (son 50).
- **Cüzdan çekirdeği:** satır kilidi, negatif bakiye engeli, yalnızca eklenebilir defter, `idempotency_key`. Aşama 11 ekonomisi bunun üzerine kurulacak.
- **Yönetim ayarları (canlı):** `starter.currencies` ve `company.change` değişince yeniden başlatmadan etkili olur (test edildi).

## 2. Oluşturulan dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0002_player_profile.sql` |
| Ortak paket | `packages/shared/src/progression.ts`, `player.ts`, `progression.test.ts` |
| API | `apps/api/src/modules/player/{service,repository,routes}.ts`, `apps/api/src/modules/economy/wallet.ts` |
| API testleri | `apps/api/test/profile.test.ts` (22 test), `apps/api/test/wallet.test.ts` (6 test) |
| İstemci | `apps/client/src/pages/PilotPages.tsx`, `apps/client/src/components/ShipArt.tsx` |
| Belgeler | `Documentation/Asama-05-Oyuncu-Profili/{API-Referansi,Kurulum-ve-Dosya-Yerlestirme-Rehberi}.md`, bu rapor, 4 ekran görüntüsü |

## 3. Değiştirilen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/api/src/app.ts` | Profil rotaları, `PATCH` CORS izni |
| `apps/api/src/modules/auth/guards.ts` | `optionalAuth` (herkese açık uç noktalar için) |
| `apps/api/src/modules/auth/service.ts`, `repository.ts` | **Hata düzeltmesi:** e-posta doğrulanınca açık oturumların önbelleği temizleniyor (§5) |
| `apps/api/test/helpers.ts` | Yeni ayarların tohumlanması, PATCH desteği |
| `packages/shared/src/api-types.ts`, `index.ts` | Yeni hata kodları ve dışa aktarımlar |
| `apps/client/src/{App.tsx, api/client.ts, components/Layout.tsx, pages/AuthPages.tsx, pages/AccountPages.tsx, styles/global.css}` | Pilot rotaları, menü, girişten sonra Pilot sayfasına yönlendirme, PATCH, stiller |
| `database/schema-draft.sql` | 0002'de uygulanan tablolar taslaktan çıkarıldı, kalan kısım bunları genişletecek şekilde hizalandı |
| `scripts/e2e-auth.mjs`, `scripts/ui-e2e.mjs` | Profil senaryoları eklendi |
| Belgeler 04, 05, 06, 07, 08, README'ler, karar günlüğü | Durum güncellemeleri |

## 4. Çalıştırılan testler ve sonuçları

| Test | Sonuç |
|---|---|
| `npm run typecheck` (shared + api + client) | ✅ Hatasız |
| Paylaşılan paket birim testleri | ✅ 24/24 (8 yeni: seviye eğrisi, rütbe, profil şemaları) |
| API entegrasyon testleri, **gerçek PostgreSQL 16 + Redis** | ✅ 84/84 (28 yeni) |
| API uçtan uca: gerçek süreç + SMTP, **iki hesap** (PC web + Android uygulama) | ✅ 23/23 adım (5 yeni profil adımı) |
| Tarayıcı uçtan uca: Chromium masaüstü + iPhone 13 emülasyonu | ✅ 17/17 adım (6 yeni), 4 yeni ekran görüntüsü |
| Migration 0002 geliştirme veritabanında + tekrar çalıştırma | ✅ uygulandı / "zaten uygulanmış" |
| Taslak şema zinciri (0001 → 0002 → taslak) | ✅ 88 tablo hatasız |
| `npm run build`, `npm audit` | ✅ / 0 açık |

**Öne çıkan senaryolar:**
- Eşzamanlı 20 harcamadan yalnızca bakiyenin karşıladığı 10'u uygulandı, bakiye hiç negatife düşmedi.
- Aynı `idempotency_key` ile gelen 10 eşzamanlı istek tek kez uygulandı.
- Aynı anda gönderilen iki şirket değişiminden yalnızca biri ücret aldı.
- İstemcinin `experience`, `honor`, `level`, `stats`, `currencies` alanlarını gönderme girişimleri reddedildi.
- Herkese açık profilde e-posta, para ve konum sızmadı.
- Android'de yazılan slogan web'de anında göründü.

## 5. Geliştirme sırasında bulunan ve düzeltilen hata
- **Önbellek tutarsızlığı (Aşama 1 kodunda):** E-postasını yeni doğrulayan oyuncu, 30 saniyelik oturum önbelleği nedeniyle pilot oluştururken "e-posta doğrulanmamış" hatası alabiliyordu. Doğrulama artık kullanıcının açık oturumlarının önbelleğini anında temizliyor. Bu senaryo için regresyon testi eklendi.

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | Şirket değişimi şu an her zaman yapılabiliyor; oyun sunucusu olmadığı için "yalnızca istasyonda / çevrimdışıyken" kuralı yok | Aşama 8 |
| 2 | Başarımlar profil okunurken senkronize ediliyor (idempotent). Oyun olaylarından anlık verilme yok | Aşama 9'da oyun olayları aynı fonksiyonu çağıracak |
| 3 | Oyun süresi, son çevrimiçi ve istatistikleri oyun sunucusu yazacak; şu an sıfır/boş (gerçek değer) | Aşama 8-9 |
| 4 | Pilot adı değiştirme yok (hesap adı kullanılıyor) | Gerekirse Yönetim Merkezi'nden denetimli yeniden adlandırma (Aşama 14) |
| 5 | API ve oyun sunucusu aynı veritabanı kullanıcısını kullanıyor; istatistik tablolarına yazma izni rol bazında ayrılmadı | Aşama 16: ayrı veritabanı rolleri (API'nin `player_stats`'a yazma yetkisi olmayacak) |
| 6 | Herkese açık profil şu an oturum gerektirmiyor; sıralama ve arama sayfası yok | Aşama 12 |
| 7 | Mobil yalnızca tarayıcı emülasyonuyla test edildi | Aşama 15 (gerçek cihaz) |

## 7. Sonraki aşama
**Aşama 6: Hangar ve ekipman.**
- 10 gemi sınıfının tamamı
- Eşya tanımları (lazer, mermi, roket, kalkan, jeneratör, drone, PET)
- Envanter ve eşya defteri
- İki konfigürasyon
- Başlangıç ekipmanı
- Mağazadan gemi/ekipman satın alma (cüzdan çekirdeği üzerinden)
- Hangar ekranı

## 8. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-05-Oyuncu-Profili.zip` (Aşama 1 dahil tam proje). `node_modules`, `dist` ve `.env` içermez.
