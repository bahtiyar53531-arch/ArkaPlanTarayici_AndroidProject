# Aşama Raporu — Aşama 15: Android ve iOS (Capacitor)

**Tarih:** 28.11.2026 · **Dal:** `ccr-4f8cba77-ej0zlw` · **Teslimat:** `Deliveries/TurkOrbit-Asama-15-Mobil.zip` + `Deliveries/TurkOrbit-0.15.0-test.apk`

> **Kapsam:**
> - 07'deki Aşama 15 satırı: Capacitor Android (APK + AAB) + iOS Xcode projesi.
> - Kabul ölçütü: "APK gerçek Android cihazda kurulup aynı hesapla PC oyuncusuyla aynı haritada oynanır; iOS derleme talimatı".
>
> **Dürüst durum: Aşama 15 tamamlandı sayılmaz (🟡).**
> - Bu geliştirme ortamında gerçek telefon, Android emülatörü (KVM yok) ve macOS yok.
> - APK ve AAB derlendi; içerikleri ve imzaları doğrulandı.
> - Uygulamanın JavaScript tarafı, derlenmiş mobil paket ve Capacitor'ın gerçek Android köprü betiğiyle PC oyuncusuna karşı uçtan uca denendi.
> - Ama uygulama **gerçek bir telefonda çalıştırılmadı**, Keystore cihaz testi **çalıştırılmadı**, iOS projesi **derlenmedi**.
> - Kabul ölçütü, test APK'sı ve [cihaz test listesi](../Asama-15-Mobil/Mobil-Derleme-ve-Cihaz-Testi.md) ile senin telefonunda doğrulanacak.

Rehberler: [Mobil Derleme ve Cihaz Testi](../Asama-15-Mobil/Mobil-Derleme-ve-Cihaz-Testi.md) · [Kurulum ve Dosya Yerleştirme](../Asama-15-Mobil/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)

## 1. Tamamlanan işler

| İstenen | Durum | Ayrıntı |
|---|---|---|
| Capacitor Android projesi | ✅ derlendi | `apps/client/android`, Capacitor 8.6.2 (sabit sürüm), hedef Android 16 (SDK 36), en düşük Android 7 (SDK 24). Uygulama kimliği `com.turkorbit.oyun` |
| **Test APK'sı** | ✅ derlendi, ⏳ cihazda denenmedi | `Deliveries/TurkOrbit-0.15.0-test.apk` (5,1 MB). "Türk Orbit Test", `com.turkorbit.oyun.test`, sürüm 0.15.0-test (1500). Sunucu adresi ilk açılışta sorulur; yalnızca bu derlemede yerel ağdaki HTTP sunucusuna bağlanabilir |
| **İmzalı sürüm APK + AAB** | ✅ derlendi ve doğrulandı | `npm run mobile:release` geçici bir anahtarla çalıştırıldı. APK 3,8 MB, AAB 3,7 MB; `apksigner`/`jarsigner` imzayı doğruladı. Ayrıca doğrulananlar: düz HTTP kapalı, yedekleme kapalı, hata ayıklama kapalı, kaynak haritası yok, HTTPS sunucu adresi gömülü. Betik HTTPS'siz adresi ve eksik imza değişkenini reddetti |
| **Oturum anahtarı Keystore/Keychain'de** | ✅ Android derlendi · iOS yazıldı | Uygulamanın kendi eklentisi (`TurkOrbitSecureStore`). Android: Keystore'da üretilen, dışarı çıkarılamayan AES-256-GCM anahtarı; değer adı AAD olarak bağlı; okunamayan değer silinir. iOS: Keychain, yalnızca bu cihaz; yeniden kurulumda temizlenir. localStorage/çerez kullanılmaz (testle doğrulandı) |
| iOS Xcode projesi | ✅ hazır · ❌ derlenmedi | `apps/client/ios` (Swift Package Manager), Keychain eklentisi, `MainViewController`, simge ve açılış görseli, sürüm 0.15.0 (1500). Derleme macOS + Xcode ister: [talimat §5](../Asama-15-Mobil/Mobil-Derleme-ve-Cihaz-Testi.md) |
| Aynı hesap, aynı dünya | ✅ tarayıcıda | Mobil uygulama Bearer anahtarıyla aynı API'ye ve oyun sunucusuna bağlanır. Oturum PC'nin güvenlik sayfasında "Android · cihaz adı" olarak görünür ve oradan kapatılabilir. Uygulama ile PC oyuncusu aynı haritada birbirini görür (tarayıcı testi) |
| Sürüm kapısı (426) | ✅ | `game_settings.client`: Android ve iOS için ayrı en düşük sürüm ve mağaza bağlantısı. Eski uygulama "Güncelleme gerekli" ekranı görür, web etkilenmez. Panelden taslak → yayın → geri alma akışıyla düzenlenir |
| Mobilde destek eki | ✅ | 60 sn geçerli, tek kullanımlık ve tek eke bağlı bağlantı; cihazın tarayıcısında iner. Yükleme Bearer ile yapılır |
| Android geri tuşu | ✅ | Sırayla: açık pencere/çekmece kapanır → önceki sayfa → ana sayfada uygulama arka plana alınır (oturum ve bağlantı korunur) |
| Arka plan / ön plan | ✅ | Arka plana geçerken basılı tuşlar/joystick bırakılır. Ön plana dönünce kopmuş bağlantı yeniden deneme süresini beklemeden hemen kurulur |
| Yatay telefon HUD'u | ✅ (düzeltme) | Savaş düğmeleri mini harita ve radarın üstüne biniyordu (Aşama 9'dan beri). Yeni yerleşim çakışmasız; test her koşuda denetler (§5-2) |
| Simge ve açılış ekranı | ✅ | Türk Orbit logosundan üretildi (Android uyarlanabilir simge dahil). Capacitor'ın varsayılan görselleri kaldırıldı |
| Derleme betikleri ve rehber | ✅ | `npm run mobile:test-apk` / `mobile:release` / `mobile:ios` / `mobile:assets`. Rehberde Android SDK kurulumu, telefona kurulum, cihaz test listesi, imza anahtarı, Google Play ve App Store adımları var |
| **Kabul ölçütü: gerçek Android cihaz + PC aynı harita** | ⏳ **bekliyor** | Cihaz yok. Test listesi hazır: [§3](../Asama-15-Mobil/Mobil-Derleme-ve-Cihaz-Testi.md) |

## 2. Oluşturulan / değişen dosyalar
| Alan | Dosyalar |
|---|---|
| Veritabanı | `database/migrations/0011_mobile.sql` (`client` ayarı; yeni tablo yok) |
| Ortak paket | `packages/shared/src/admin.ts` (`client` ayar tanımı, `format: version / https-url`, `compareVersions`), `api-types.ts` (`CLIENT_OUTDATED`, `LINK_INVALID`) |
| API | `modules/client/gate.ts` (yeni), `lib/one-time.ts` (yeni), `app.ts`, `lib/errors.ts`, `modules/support/{routes,service}.ts`, `modules/admin/content.ts` |
| İstemci | `capacitor.config.ts`, `src/platform/{native,secure-store,server,shell}.ts`, `src/pages/MobilePages.tsx`, `src/env.d.ts` (yeni); `api/client.ts`, `auth/AuthContext.tsx`, `game/controller.ts`, `App.tsx`, `main.tsx`, `pages/{AuthPages,SupportPages,GamePage}.tsx`, `styles/{global,game}.css`, `vite.config.ts`, `package.json` (0.15.0) |
| Android | `apps/client/android/` (Capacitor şablonu + `SecureStore.java`, `SecureStorePlugin.java`, `MainActivity.java`, manifest, `data_extraction_rules.xml`, debug adı, `build.gradle` (sürüm, imza, derleme türleri), simgeler, `AppConfigTest` (JVM), `SecureStoreTest` (cihaz)) |
| iOS | `apps/client/ios/` (Capacitor SPM şablonu + `SecureStorePlugin.swift`, `MainViewController.swift`, `SceneDelegate`, storyboard, Info.plist, proje dosyası, simgeler) |
| Panel | `apps/admin/src/ui.tsx` (sürüm/https alan ipuçları) |
| Betikler | `scripts/mobile.mjs`, `scripts/mobile-assets.mjs` (yeni), `scripts/package-phase.mjs`, `scripts/ui-e2e.mjs` |
| Testler | `apps/api/test/mobile.test.ts` (10 test), `apps/api/test/helpers.ts`, `scripts/e2e-auth.mjs` (sürüm başlığı + 426 adımı) |
| Belgeler | `Documentation/Asama-15-Mobil/` (2 rehber), bu rapor, Karar Günlüğü K-102…K-109, 03/04/06/07, README'ler, `.env.example` |

## 3. Güvenlik özeti
- **Oturum anahtarı:** Yalnızca güvenli depoda tutulur. Sayfada bellekte durur ve `Authorization: Bearer` olarak gönderilir. Web çerezi kullanılmaz; CSRF başlığı gönderilmez (gerekmez).
- **Uygulama kökleri:**
  - `ALLOWED_ORIGINS`'e eklenen kökler: Android `https://localhost`, iOS `capacitor://localhost`.
  - Web oturumunun çerez korumasını zayıflatmaz: çerez `SameSite=Strict` ve CSRF anahtarı zorunlu; uygulama zaten çerez kullanmaz.
  - Yabancı kök hâlâ 403 alır (testli).
- **Sürüm derlemesi:**
  - Yalnızca HTTPS/WSS; sunucu adresi gömülü ve değiştirilemez; WebView hata ayıklaması kapalı.
  - Düz HTTP izni manifestte derleme türüne bağlı (birim testiyle denetlenir). Karışık içerik yalnızca debuggable derlemede açılır.
- **Veri ve izinler:**
  - Yedekleme ve cihazdan cihaza aktarım kapalı.
  - İzin olarak yalnızca internet istenir. Birleşik manifestteki `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` androidx'in uygulamaya özel iç iznidir; kullanıcıya sorulmaz.
- **İmza anahtarı:** Depoya girmez (`*.jks` / `*.keystore` dışlandı). Ortam değişkeninden okunur.
- **Sürüm kapısı:** Uyumluluk aracıdır, güvenlik denetimi değildir. Yetki ve oyun kuralları her zaman sunucudadır.

## 4. Testler ve sonuçlar
| Test | Sonuç |
|---|---|
| `npm run typecheck` (paylaşılan, API, istemci, panel) | ✅ Hatasız |
| Paylaşılan birim testleri | ✅ 95/95 |
| API entegrasyon testleri (**gerçek PostgreSQL + Redis**) | ✅ 224/224 (10 yeni: mobil oturum ve kökler, CORS ön kontrolü, Bearer'la oyun bileti, uzaktan oturum kapatma, 426 kapısı, panelden sürüm yayını/geri alma ve biçim denetimi, tek kullanımlık ek bağlantısı ve süre dolumu) |
| API uçtan uca (ayrı API + oyun sunucusu süreçleri + gerçek SMTP) | ✅ 56/56 adım (1 yeni: eski Android sürümü 426 alır, web etkilenmez) |
| Tarayıcı uçtan uca (Chromium: 3 masaüstü + iPhone 13 + **Pixel 7: mobil paket + Capacitor köprüsü**) | ✅ 93/93 adım (9 yeni + yatay HUD çakışma denetimi), son iki koşuda üst üste. Başsız yazılımsal çizimde FPS: masaüstü 21, telefon emülasyonu 47; bu ölçüm ortamı değeridir, gerçek cihaz FPS'i değildir. Koşu geçmişi aşağıda |
| Android JVM birim testleri (`testDebugUnitTest`) | ✅ 3/3 (yedekleme kapalı, cleartext derleme türüne bağlı ve sürümde kapalı, yalnızca internet izni) |
| Android cihaz testi (`SecureStoreTest`, Keystore) | ⏳ Derlendi (`app-debug-androidTest.apk`); **çalıştırılmadı** (cihaz/emülatör yok) |
| Android derleme: test APK, imzalı APK + AAB | ✅ Derlendi. `aapt2`/`apksigner`/`jarsigner` doğrulaması §1'de |
| iOS derleme | ❌ Yapılmadı (macOS gerekir) |
| `npm run build`, `npm audit` | ✅ Paylaşılan, API, istemci ve panel derlendi; 0 güvenlik açığı |

**Tarayıcı testi koşu geçmişi:**

| Koşu | Sonuç | Not |
|---|---|---|
| 1 | 92/93 | Ek indirme adımı: dosya adı "download" (test ortamının dil ayarı; §5-1) |
| 2 | 93/93 | UTF-8 dil ayarıyla |
| 3 (son) | 93/93 | Yatay HUD düzeltmesi + çakışma denetimiyle; teslim edilen ekran görüntüleri bu koşudan |

**Tarayıcıda gerçekten denenenler (Aşama 15 bloğu):**
- **Ortam:**
  - APK'ya giren derlenmiş `dist-mobile` paketi ayrı bir kökten sunuldu.
  - Sayfaya Capacitor'ın **gerçek** Android köprü betiği (`native-bridge.js`) Android'in enjekte ettiği sırayla eklendi.
  - Köprünün yerel ucu Node'daki taklitti: güvenli depo, cihaz bilgisi, geri tuşu ve ön plan olayları.
- **Sunucu adresi:** Uygulama ilk açılışta adres sordu. Ulaşılamayan adreste açıklayıcı hata verdi; doğru adreste giriş ekranına geçti ve sunucu bilgisini gösterdi.
- **Oturum:**
  - Girişten sonra anahtar yalnızca güvenli depoda; çerezde ve web deposunda yok.
  - Tüm istekler `Authorization: Bearer`, `X-Client-Platform: android` ve `X-Client-Version: 0.15.0` taşıdı; CSRF başlığı yoktu.
  - Veritabanında oturum `token / Google Pixel 8 / 0.15.0` olarak kayıtlı.
  - Aynı hesabın PC'deki güvenlik sayfasında "Android · Google Pixel 8" göründü.
- **Ortak harita (yatay Pixel 7):** Uygulamadaki pilot ile PC oyuncusu aynı haritada birbirini gördü. Uygulamada joystick'le hareket PC ekranındaki mesafeye yansıdı. HUD öğeleri çakışmadı.
- **Ön plana dönüş:** Uygulama arka plandayken oyun soketi kapatıldı ve yeniden denemeler engellendi. Öne gelince bağlantı ~4 sn'lik yeniden deneme beklenmeden kuruldu; PC oyuncusu onu yine gördü.
- **Geri tuşu:** Görev çekmecesini kapattı → oyundan önceki sayfaya döndü → ana sayfada uygulamayı arka plana aldı.
- **Uzaktan kapatma:** PC'den kapatılan uygulama oturumunda uygulama giriş ekranına döndü; güvenli depodaki anahtar silindi.
- **Sürüm kapısı:** Panelden Android en düşük sürümü 0.16.0 yapıldı → uygulamada "Güncelleme gerekli" ekranı ve mağaza düğmesi göründü; web oturumu etkilenmedi. Geri almadan sonra "Tekrar dene" ile uygulama açıldı.
- **Destek eki:** Uygulamadan ekli talep açıldı. Ek, tek kullanımlık bağlantıyla indi ("telefon ekranı.png", aynı baytlar); bağlantı ikinci kez 410 döndü.

## 5. Geliştirme sırasında bulunan ve düzeltilen sorunlar
1. **İndirilen ekin adı "download" çıkıyordu (test ortamı):**
   - Sunucunun `Content-Disposition` başlığı doğruydu.
   - Sebep: Konteynerin varsayılan "C" dil ayarında Chromium Türkçe karakterli dosya adını ("ekranı.png") diske yazamayıp genel ada düşüyordu. Ayrı bir sunucuyla varyasyonlar denenerek kanıtlandı: UTF-8 dil ayarında aynı başlık doğru adı verdi.
   - Telefon ve masaüstü dosya sistemleri UTF-8'dir. Test tarayıcısı UTF-8 dil ayarıyla başlatılıyor.
2. **Yatay telefonda HUD çakışması (Aşama 9'dan beri):**
   - Ekran görüntüsü incelenirken görüldü: "Ateş/Hedef/Yıldırım" düğmeleri mini haritanın ve radar listesinin, joystick de görev izleyicisinin üstüne biniyordu. iPhone yatayda da aynıydı.
   - Yeni yerleşim:
     - pilot ve görev yan yana,
     - düğmeler tek satır,
     - mini harita ve radar savaş sütununun (veya sağdaki joystick'in) solunda,
     - hedef paneli alt ortada,
     - savaş düğmeleri biraz küçültüldü; dokunma alanı ≥ 40 px.
   - Tarayıcı testi artık iPhone ve Pixel yatayda öğelerin kesişmediğini denetliyor.
3. **Gradle bağımlılık indirmesi 429:** Maven Central, paralel indirmelere hız sınırı uyguladı. Tek işçiyle ve yeniden denemeyle indirildi. Ağ engeli değildi.
4. **Capacitor şablonunun Cordova modülü:** `assembleDebugAndroidTest` tüm modüllerde çalışınca bu modülün test sınıf yolunda Kotlin kopyası çakışıyor. Uygulamanın cihaz testi `:app:assembleDebugAndroidTest` ile derleniyor (rehberdeki komut).
5. **API uçtan uca betiğinin "Android uygulama" istemcisi sürüm başlığı göndermiyordu:**
   - Sürüm kapısı eklenince bu istekler 426 alırdı.
   - Gerçek uygulama sürümünü her istekte gönderir. Betik bu davranışa getirildi ve eski sürümün 426 aldığını deneyen bir adım eklendi.
6. **Test kullanıcı adları:** "Yonetici" ve "Destek" içeren adlar ayrılmış ad kuralına takıldı (beklenen davranış). Testte adlar değiştirildi.

## 6. Bilinen sınırlamalar
| # | Konu | Plan |
|---|---|---|
| 1 | **Gerçek Android cihazda deneme yok** (07 kabul ölçütü bekliyor) | Test APK'sı + cihaz test listesi senin telefonunda; sonuç rapora işlenecek |
| 2 | Android Keystore cihaz testi çalıştırılmadı | `./gradlew connectedDebugAndroidTest` (telefon bağlıyken) |
| 3 | iOS projesi derlenmedi; Swift kodu macOS'ta ilk kez derlenecek | macOS + Xcode + Apple Developer hesabıyla |
| 4 | Anlık bildirim (FCM/APNs), derin bağlantı (App Links/Universal Links), uygulama içi satın alma, masaüstü sarmalayıcı yok (K-109) | İlgili harici hesaplar hazır olunca |
| 5 | iOS test derlemesi düz HTTP sunucuya bağlanmaz (ATS) | HTTPS hazırlık sunucusu veya geçici `NSAllowsLocalNetworking` (rehber §5) |
| 6 | Platform dağılımı grafikleri ve istemci hata raporları (`client_error_reports`) yok | Aşama 16 (izleme) |
| 7 | Tarayıcı taklidi Keystore şifrelemesini, gerçek WebView'ı ve dokunmatik donanımı denemez (K-108) | Gerçek cihaz testi |
| 8 | Uygulama kimliği `com.turkorbit.oyun`; alan adı kesinleşince ilk mağaza yüklemesinden **önce** değiştirilebilir | Yayın öncesi karar |

## 6b. Telefondan test (ek: bilgisayarı olmayan kullanıcı için)
- **Sorun:** Kullanıcının PC'si yok. Geliştirme ortamı internetten bağlantı kabul etmiyor, ağ politikası tünel servislerine izin vermiyor. Bu yüzden buradan herkese açık oyun linki verilemedi.
- **Çözüm:** Sunucu GitHub Codespaces'ta çalışır.
  - Depo kökündeki `.devcontainer/` PostgreSQL, Redis ve Mailpit'i kaldırır.
  - `scripts/codespace-baslat.sh` sunucuyu üretim modunda derleyip başlatır ve 8080'i herkese açık yapar.
  - `scripts/tek-port-sunucu.mjs` web, panel, API ve oyun soketini tek porttan sunar.
  - Çıkan `https://…-8080.app.github.dev` linki tarayıcıda ve test APK'sında kullanılır.
- **Doğrulanan:** Başlatma betiği ve tek port sunucusu bu ortamda üretim moduyla denendi. Kayıt → SMTP'den doğrulama e-postası → doğrulama → giriş (`__Host-` güvenli HttpOnly çerez) → pilot → oyuna WebSocket bağlantısı, panel ve derin bağlantılar çalıştı. Klasör dışına çıkma denemesi dosya sızdırmadı.
- **Denemede bulunan hata:** Betik ilk denemede bitmiyordu; arka plan süreçlerini başlatan alt kabuklar günlük borusunu açık tutuyordu. Düzeltildi.
- **Doğrulanmayan:** Codespaces'ın kendisinde hiç çalıştırılmadı (erişimim yok). Portu otomatik herkese açma (`gh codespace ports visibility`) yetki nedeniyle başarısız olursa rehber elle yapma adımını gösteriyor.
- **Rehber:** [Codespaces ile Telefondan Test](../Asama-15-Mobil/Codespaces-ile-Telefondan-Test.md)

## 7. Sonraki aşama
**Aşama 16: Güvenlik ve performans:**
- OWASP ASVS L2 kontrol listesi,
- yük testi (200 oyunculu harita, API p95),
- 60 dk uzun oturum testi,
- yedekleme ve geri yükleme tatbikatı,
- panelde 2FA,
- izleme ve metrik geçmişi.

Aşama 15'in cihaz testi sonucu geldiğinde bu rapor ve 07 güncellenecek.

## 8. Teslimat
- `TurkOrbit/Deliveries/TurkOrbit-Asama-15-Mobil.zip`: Aşama 1–15 dahil tam proje. `node_modules`, `dist`, `dist-mobile`, Android/iOS derleme çıktıları, `.env`, imza anahtarları, test çıktıları ve yüklenen dosyalar içermez.
- `TurkOrbit/Deliveries/TurkOrbit-0.15.0-test.apk`: telefona doğrudan kurulabilen test APK'sı (Android hata ayıklama anahtarıyla imzalı).
