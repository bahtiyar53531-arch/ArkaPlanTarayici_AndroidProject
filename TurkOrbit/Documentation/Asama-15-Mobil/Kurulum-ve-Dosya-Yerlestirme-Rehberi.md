# Aşama 15 — Kurulum ve Dosya Yerleştirme Rehberi

Bu paket (`Deliveries/TurkOrbit-Asama-15-Mobil.zip`) **Aşama 1–14'ü de içeren tam projedir**. İlk kurulum için [Aşama 1 rehberine](../Asama-01-Kayit-Giris/Kurulum-ve-Dosya-Yerlestirme-Rehberi.md) bak. Bu rehber, Aşama 14 kurulu bir sistemi günceller. Telefona kurulum ve mağaza derlemesi için: [Mobil Derleme ve Cihaz Testi](Mobil-Derleme-ve-Cihaz-Testi.md).

> **Önemli:**
> - **Yeni migration:** `0011_mobile.sql`. Yalnızca `client` ayarını ekler (mobil uygulamanın en düşük sürümü ve mağaza bağlantıları); yeni tablo yok. Başlatmadan önce `npm run db:migrate` çalıştır.
> - **Yeni bağımlılıklar (istemci):** `@capacitor/core`, `@capacitor/android`, `@capacitor/ios` 8.6.2, `@capacitor/app` 8.1.2, `@capacitor/device` 8.0.3; geliştirme için `@capacitor/cli` 8.6.2. Hepsi sabit sürümle kurulur. `npm install` hepsini kurar; `npm audit`: 0 açık.
> - **Ortam değişkeni:** Yeni değişken yok, ama `ALLOWED_ORIGINS` mobil uygulamanın köklerini içermeli: `https://localhost` (Android) ve `capacitor://localhost` (iOS). `.env.example` güncellendi.
> - **Web istemcisi davranışı değişmedi:** Web hâlâ HttpOnly çerez kullanır; mobil uygulama Bearer anahtarı kullanır.

## 1. Dosyaları yerleştirme (sunucu)
1. API'yi, oyun sunucusunu ve istemciyi durdur.
2. Veritabanını yedekle: `pg_dump -Fc turkorbit > turkorbit-asama14.dump`.
3. ZIP'i aç ve `TurkOrbit/` üzerine kopyala.
4. Kurulumu çalıştır:
   1. `npm install`
   2. `npm run db:migrate` → `✔ uygulandı: 0011_mobile.sql` görmelisin.
   3. `npm run build`
5. Üretimdeki `.env` dosyasında `ALLOWED_ORIGINS` değerine `https://localhost,capacitor://localhost` ekle.
6. Hizmetleri başlat: önce API, sonra oyun sunucusu.
7. Mobil uygulama sunucuya `https://<alan adı>/api/v1` ve `wss://<alan adı>/game` üzerinden bağlanır. Mevcut nginx yapılandırması (`/api`, `/game`) yeterli; değişiklik gerekmez.

| Yeni / değişen dosya | Ne |
|---|---|
| `database/migrations/0011_mobile.sql` | **Yeni:** `game_settings.client` (en düşük Android/iOS sürümü, mağaza bağlantıları, mesaj) |
| `apps/client/capacitor.config.ts` | **Yeni:** uygulama kimliği `com.turkorbit.oyun`, `dist-mobile`, sistem çubukları |
| `apps/client/src/platform/` | **Yeni:** yerel/web tespiti, güvenli depo arayüzü, sunucu kökü, geri tuşu ve ön plan/arka plan |
| `apps/client/src/{api/client.ts, auth/AuthContext.tsx, game/controller.ts, App.tsx, main.tsx}` | Mobilde Bearer + güvenli depo, platform/sürüm başlıkları, 426 → "Güncelleme gerekli", sunucu adresi ekranı, ön plana dönüşte yeniden bağlanma |
| `apps/client/src/pages/{MobilePages.tsx (yeni), AuthPages.tsx, SupportPages.tsx}`, `styles/global.css` | Sunucu adresi ve güncelleme ekranları, giriş ekranında sunucu bilgisi, mobilde ek indirme |
| `apps/client/vite.config.ts`, `src/env.d.ts`, `package.json` (0.15.0) | `--mode mobile` → `dist-mobile`, sürüm sabiti |
| `apps/client/android/` | **Yeni:** Android projesi + `SecureStore`/`SecureStorePlugin` (Keystore), `MainActivity`, manifest (yedekleme kapalı, cleartext yalnızca debug), simgeler, imza yapılandırması, testler |
| `apps/client/ios/` | **Yeni:** iOS projesi (SPM) + `SecureStorePlugin.swift` (Keychain), `MainViewController.swift`, simgeler |
| `apps/api/src/modules/client/gate.ts`, `src/lib/one-time.ts` | **Yeni:** sürüm kapısı (426), tek kullanımlık bağlantılar |
| `apps/api/src/{app.ts, lib/errors.ts, modules/support/*, modules/admin/content.ts}` | Bağlantılar, ek indirme bağlantısı, ayar yayınında önbellek boşaltma |
| `packages/shared/src/{admin.ts, api-types.ts}` | `client` ayar tanımı, sürüm karşılaştırma, `CLIENT_OUTDATED`, `LINK_INVALID` |
| `apps/admin/src/ui.tsx` | Sürüm ve https alanlarında ipucu |
| `scripts/mobile.mjs`, `scripts/mobile-assets.mjs` | **Yeni:** test APK / sürüm / iOS derleme betiği; simge ve açılış görseli üretimi |
| `scripts/ui-e2e.mjs`, `apps/api/test/mobile.test.ts` | Mobil uçtan uca ve entegrasyon testleri |
| `package.json`, `.gitignore`, `.env.example`, `scripts/package-phase.mjs` | `mobile:*` komutları, mobil derleme çıktıları ve imza anahtarlarının dışlanması |

## 2. Geliştirme ortamında mobil
```bash
npm run mobile:test-apk     # test APK'sı → Deliveries/TurkOrbit-0.15.0-test.apk  (JDK 21 + Android SDK gerekir)
npm run mobile:release      # imzalı APK + AAB (VITE_SERVER_URL=https://… ve TURKORBIT_* imza değişkenleri)
npm run mobile:ios          # iOS projesini eşitler (macOS'ta Xcode ile derlenir)
```
- **Android SDK:** Android Studio ile kurmak en kolayı. Komut satırı araçlarıyla kurulursa: `platforms;android-36`, `build-tools;36.0.0` ve `ANDROID_HOME` gerekir.
- **Ayrıntı:** Telefonda deneme ve mağaza adımları için [Mobil Derleme ve Cihaz Testi](Mobil-Derleme-ve-Cihaz-Testi.md).

## 3. Yönetim Merkezi
- Yeni ayar: İçerik → Ayarlar → **Mobil uygulama sürümü**.
  - Android/iOS için en düşük desteklenen sürüm ve mağaza bağlantıları buradan girilir.
  - Daha eski uygulamalar "Güncelleme gerekli" ekranı görür. Web etkilenmez.
  - Taslak → fark → yayın → geri alma akışı ve denetim kaydı Aşama 14'teki gibidir.
- **Dikkat:** En düşük sürümü, yeni sürüm mağazada onaylanmadan yükseltme. Aksi halde oyuncular güncelleyemeden kilitlenir.

## 4. Güvenlik notları
- **Oturum anahtarı:**
  - Android'de Keystore'da üretilen ve dışarı çıkarılamayan anahtarla şifrelenir (AES-256-GCM).
  - iOS'ta Keychain'de durur (yalnızca bu cihaz).
  - localStorage'a veya çereze yazılmaz.
  - Uygulama yedeğine ve cihazdan cihaza aktarıma girmez.
- **Sürüm derlemesi:**
  - Yalnızca HTTPS/WSS kullanır, sunucu adresi değiştirilemez, WebView hata ayıklaması kapalıdır.
  - Düz HTTP ve karışık içerik yalnızca test derlemesinde açılır.
- **İzinler:** Uygulama yalnızca internet izni ister.
- **Sürüm kapısı:** Bir uyumluluk aracıdır. Asıl güvenlik (yetki, oyun kuralları) her zaman sunucudadır.

## 5. Testler
```bash
npm test             # birim + entegrasyon (mobil: Bearer/CSRF, uygulama kökleri, 426 sürüm kapısı ve panelden yayın, tek kullanımlık ek bağlantısı)
npm run test:ui      # tarayıcı: Aşama 1–15; Aşama 15 = derlenmiş mobil paket + gerçek Capacitor Android köprüsü + PC oyuncusu
cd apps/client/android && ./gradlew testDebugUnitTest          # Android JVM testleri (yapılandırma)
cd apps/client/android && ./gradlew connectedDebugAndroidTest  # Android cihaz testi (Keystore) — telefon bağlıyken
```
