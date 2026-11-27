# Aşama Raporu — Aşama 1–4: Araştırma, Mimari, Altyapı, Kayıt ve Giriş

**Tarih:** 27.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-01-Kayit-Giris.zip`

## 1. Tamamlanan işler

### Araştırma ve planlama
- Çalışma klasörü analiz edildi. Depoda Türk Orbit'e ait kod yoktu; mevcut APK workflow'larının her push'ta sürüm silip oluşturduğu tespit edildi ([00](../00-Calisma-Klasoru-Analizi.md)).
- 24 sistemin işlevsel analizi ve belirsizlik listesi hazırlandı ([01](../01-Arastirma-Raporu.md)). **Kısıt:** resmî site/forum/wiki sayfaları ağ politikası nedeniyle açılamadı; yalnızca arama özetleri kullanıldı. Bu durum raporda açıkça belirtildi.
- Teknik mimari, platformlar arası mimari, multiplayer tasarımı, Yönetim Merkezi modül planı, klasör yapısı, 17 aşamalık plan ve test stratejisi yazıldı ([02](../02-Teknik-Mimari.md)–[07](../07-Gelistirme-Asamalari-ve-Test-Plani.md)).
- Türk Orbit'e özgü dünya taslağı hazırlandı: şirketler, para birimleri, haritalar, 10 gemi, ekipman serileri, NPC aileleri ve 7 Yıldız Kapısı ([08](../08-Ozgun-Dunya-Taslagi.md)).
- Tüm oyunun veritabanı taslağı (75 tablo) yazıldı ve PostgreSQL 16'ya hatasız yüklenerek doğrulandı.

### Kayıt ve giriş sistemi (gerçek, çalışan)
| Gereksinim (madde 4) | Durum | Nerede |
|---|---|---|
| Kullanıcı adı + e-posta kaydı | ✅ | `POST /auth/register` |
| E-posta doğrulaması | ✅ | 24 saatlik tek kullanımlık bağlantı, yeniden gönderme |
| Güvenli parola oluşturma | ✅ | Ortak politika (istemcide canlı gösterge + sunucuda zorunlu) |
| Giriş / çıkış | ✅ | Kullanıcı adı veya e-posta ile; çıkışta oturum sunucuda iptal edilir |
| Parola sıfırlama | ✅ | 30 dk'lık tek kullanımlık bağlantı; tüm oturumları kapatır |
| Parola değiştirme | ✅ | Mevcut parola doğrulanır, diğer oturumlar kapanır |
| Oturum yönetimi | ✅ | Opak anahtar (SHA-256 özeti), 30 gün mutlak + 7 gün boşta kalma süresi, Redis önbelleği |
| Birden fazla cihazdan giriş | ✅ | Web (çerez) + uygulama (Bearer) aynı hesapta |
| Aktif oturumları görüntüleme / kapatma | ✅ | `GET/DELETE /auth/sessions`, "diğerlerini kapat" |
| Giriş geçmişi | ✅ | Son 50 deneme; başarısızlık nedeni, cihaz, maskelenmiş IP |
| Şüpheli giriş denetimi | ✅ | Yeni cihaz + yeni ağ veya giriş öncesi çok sayıda hatalı deneme → işaret + e-posta |
| Rate limiting | ✅ | Redis (IP, hesap, e-posta bazlı); 5 hatalı denemede 15 dk kilit + e-posta |
| Güvenli çerezler ve CSRF | ✅ | `__Host-` önekli HttpOnly/Secure/SameSite=Strict çerez, yalnızca JSON, Origin denetimi, HMAC CSRF anahtarı |
| Argon2id | ✅ | 64 MiB / 3 tur; parametre değişince girişte yeniden özetleme |
| Yeni kayıt = NORMAL PLAYER | ✅ | Veritabanı tetikleyicisi + kayıt şeması `role` alanını reddeder |
| Kimse kendini yönetici yapamaz | ✅ | Rol atama yalnızca sunucu tarafı CLI ile; denetim kaydına yazılır; RBAC sunucuda denetlenir |

Ek olarak: Türkçe web arayüzü (giriş, kayıt, e-posta doğrulama, şifremi unuttum, şifre sıfırlama, hesabım, hesap güvenliği, taslak kullanım koşulları ve KVKK sayfaları), mobil uyumlu koyu uzay teması, özgün Türk Orbit logosu, PWA manifest, sağlık uç noktası, değiştirilemez yönetici işlem geçmişi, kayıt açma/kapama ayarı.

## 2. Oluşturulan dosyalar

Yeni klasör: `TurkOrbit/` (proje kökü). Başlıcaları:

| Alan | Dosyalar |
|---|---|
| Kök | `package.json`, `package-lock.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `docker-compose.yml`, `README.md` |
| Ortak paket | `packages/shared/` — `brand.ts`, `roles.ts`, `password-policy.ts`, `auth-schemas.ts`, `api-types.ts`, `labels.ts`, `shared.test.ts` |
| API | `apps/api/src/` — `index.ts`, `app.ts`, `runtime.ts`, `config/env.ts`, `db/{pool,migrate}.ts`, `lib/{crypto,password,mailer,rate-limit,client-info,errors}.ts`, `modules/auth/{service,repository,routes,guards,session-cache,emails}.ts`, `modules/health/routes.ts`, `scripts/{migrate,role-cli}.ts` |
| API testleri | `apps/api/test/` — `helpers.ts`, `register`, `login`, `sessions`, `password`, `security`, `rbac` testleri |
| İstemci | `apps/client/` — `index.html`, `vite.config.ts`, `public/{favicon.svg,manifest.webmanifest}`, `src/{main,App}.tsx`, `src/api/client.ts`, `src/auth/AuthContext.tsx`, `src/components/{ui,Layout}.tsx`, `src/pages/{AuthPages,AccountPages,InfoPages}.tsx`, `src/styles/global.css` |
| Veritabanı | `database/migrations/0001_auth.sql`, `database/schema-draft.sql` |
| Altyapı | `infra/nginx/turkorbit.conf.example`, `infra/postgres/init-test-db.sql` |
| Betikler | `scripts/e2e-auth.mjs`, `scripts/ui-e2e.mjs`, `scripts/package-phase.mjs` |
| Yer tutucular | `apps/game-server/README.md`, `apps/admin/README.md` (kod yok, plan) |
| Belgeler | `Documentation/00…08`, `Documentation/Asama-01-Kayit-Giris/{API-Referansi,Kurulum-ve-Dosya-Yerlestirme-Rehberi}.md`, `Documentation/DevelopmentNotes/{Asama-01-Raporu,Karar-Gunlugu}.md`, 6 ekran görüntüsü |

## 3. Değiştirilen dosyalar
Depo kökündeki mevcut dosyaların (eski APK workflow'ları) **hiçbiri değiştirilmedi**.

## 4. Çalıştırılan testler ve sonuçları

| Test | Komut | Sonuç |
|---|---|---|
| TypeScript denetimi (shared + api + client) | `npm run typecheck` | ✅ Hatasız |
| Birim testleri (parola politikası, şemalar, rol kataloğu) | `npm test` | ✅ 16/16 |
| Entegrasyon testleri, **gerçek PostgreSQL 16 + Redis** | `npm test` | ✅ 56/56 (6 dosya) |
| API uçtan uca: gerçek API süreci + gerçek SMTP, **2 ayrı hesap**, PC web + Android uygulama oturumları | `npm run test:e2e` | ✅ 18/18 adım, 8 e-posta SMTP'den alındı |
| Tarayıcı uçtan uca: Chromium masaüstü 1280×860 + iPhone 13 emülasyonu | `npm run test:ui` | ✅ 11/11 adım, 6 ekran görüntüsü |
| Üretim derlemesi + derlenmiş API'nin çalıştırılması + `/health` | `npm run build`, `npm run start -w @turkorbit/api` | ✅ |
| Gerçek `.env` dosyasıyla `db:migrate`, `dev:api` | — | ✅ (test sırasında bulunan iki `.env` hatası düzeltildi, bkz. §5) |
| Veritabanı taslağı doğrulama | `psql -1 -f schema-draft.sql` | ✅ 88 tablo |
| Bağımlılık güvenlik taraması | `npm audit` | ✅ 0 açık (ilk kurulumda bulunan 5 açık, geliştirme araçları yükseltilerek kapatıldı) |

**Testlerin kapsadığı başlıca güvenlik senaryoları:** rol alanıyla kendini yönetici yapma girişimi (reddedildi), hatalı ve olmayan hesap için aynı yanıt, kayıtlı e-postayla kayıtta aynı yanıt, kilit ve kilidin e-posta ile aşılamaması, CSRF anahtarsız istek, izinsiz Origin, text/plain ve form gövdeleri, çerez ↔ Bearer anahtar karıştırma, iptal edilen oturumun tekrar kullanımı, boşta kalma ve süre dolması, başka kullanıcının oturumunu kapatma, tek kullanımlık bağlantıların tekrar kullanımı, süresi dolmuş bağlantılar, parolanın ve anahtarların düz metin saklanmaması, denetim kaydının değiştirilemezliği.

## 5. Geliştirme sırasında bulunan ve düzeltilen hatalar
1. Test sırasında: test temizliğindeki `TRUNCATE … CASCADE`, `game_settings` tablosunu da boşaltıyordu (FK). Test yardımcısı varsayılan ayarları yeniden yazacak şekilde düzeltildi. Üretim kodunu etkilemiyordu.
2. `.env` dosyasında boş bırakılan değerler (`CSRF_SECRET=`) boş metin olarak geldiği için API açılmıyordu. Boş değerler artık tanımsız sayılıyor.
3. `.env`'de `MAIL_FROM` tırnaklar nedeniyle kırpılıyordu. Örnek dosyadaki tırnaklama düzeltildi.
4. İstemci ile test aracı farklı Vite sürümleri kullanıyordu (tip uyuşmazlığı). Tek sürümde (7.3.8) birleştirildi.
5. Fastify'nin kullanımdan kalkan `disableRequestLogging` seçeneği kaldırıldı.

## 6. Bilinen sorunlar ve sınırlamalar
| # | Konu | Etki | Plan |
|---|---|---|---|
| 1 | Araştırma resmî sayfalar okunmadan, arama özetleriyle yapıldı | Bazı ayrıntılar doğrulanamadı (rapor §4) | Ağ izni verilirse doğrulama; tasarım kendi kurallarıyla bağımsız |
| 2 | Oturum önbelleği 30 sn | Yasaklama/askı **doğrudan SQL ile** yapılırsa açık oturumlar en geç 30 sn sonra düşer | Aşama 14'te yasaklama servisi oturumları iptal edip önbelleği anında temizleyecek |
| 3 | Şüpheli girişte yalnızca işaretleme + e-posta var, ek doğrulama (e-posta kodu/2FA) yok | — | Aşama 16: şüpheli girişte e-posta kodu, isteğe bağlı TOTP 2FA |
| 4 | Sızdırılmış parola kontrolü yalnızca yerleşik küçük listeyle | — | Aşama 16: HIBP k-anonimlik API'si (isteğe bağlı) |
| 5 | Mobil yerel uygulama yok; gerçek cihaz testi yapılmadı | Mobil yalnızca tarayıcı emülasyonuyla denendi | Aşama 15 |
| 6 | iOS derlemesi için macOS + Xcode + Apple Developer üyeliği gerekir | Bu ortamda yok | Aşama 15'te talimat |
| 7 | PWA'da yalnızca SVG simge var | Bazı Android sürümleri kurulum için PNG 192/512 simgesi ister | Aşama 15 |
| 8 | Kullanım koşulları ve KVKK metinleri taslak | Yayından önce hukuki inceleme ve şirket bilgisi gerekir | Aşama 17 |
| 9 | Üretimde nginx arkasında `TRUST_PROXY` ayarlanmazsa tüm istemciler aynı IP görünür | IP bazlı hız sınırı ortaklaşır | Kurulum rehberinde zorunlu ayar olarak belirtildi |
| 10 | Hız sınırı sabit pencereli | Pencere sınırında kısa süreli 2× patlama olabilir | Gerekirse kayan pencere |
| 11 | Depo kökündeki eski workflow'lar her push'ta çalışıyor | Türk Orbit commit'lerinde `[skip ci]` kullanıldı | Senin kararın: ayrı depo veya `paths-ignore` |
| 12 | Playwright projeye bağımlılık olarak eklenmedi (büyük) | `test:ui` için ayrıca kurulmalı | Rehberde anlatıldı |

## 7. Eksik özellikler (bu aşamanın kapsamı dışında)
Oyuncu profili, şirket/sunucu seçimi, hangar, oyun motoru, multiplayer, NPC, görevler, ekonomi, klan, forum, destek, Yönetim Merkezi arayüzü, mobil paketler. Bunların hepsi planlandı ([07](../07-Gelistirme-Asamalari-ve-Test-Plani.md)), hiçbiri tamamlanmış gibi gösterilmedi.

## 8. Sonraki aşama
**Aşama 5: Oyuncu profili.** `game_servers`, `companies`, `players`, `player_stats` migration'ı (0002), ilk girişte sunucu ve şirket seçimi, Oyuncu ID'li profil API'si ve ekranı, oyun bileti için e-posta doğrulama şartı.

## 9. ZIP teslimatı
`TurkOrbit/Deliveries/TurkOrbit-Asama-01-Kayit-Giris.zip`. `node_modules`, `dist` ve `.env` içermez. Kurulum için [Kurulum ve Dosya Yerleştirme Rehberi](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)'ne bak.
