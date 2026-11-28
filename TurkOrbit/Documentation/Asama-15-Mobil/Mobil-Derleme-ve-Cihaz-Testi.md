# Aşama 15 — Mobil Derleme ve Gerçek Cihaz Testi

Bu rehber Türk Orbit'in Android ve iOS uygulamasını derlemeyi ve **gerçek telefonda** denemeyi anlatır.

> **Dürüst durum:** Bu aşamada Android APK ve AAB bu geliştirme ortamında derlendi ve imzası doğrulandı. Ancak bu ortamda gerçek telefon, Android emülatörü (KVM yok) ve macOS yok. Bu yüzden:
> - Uygulama gerçek bir Android cihazda **henüz çalıştırılmadı**.
> - Android cihaz testi (`SecureStoreTest`, Keystore) derlendi ama **çalıştırılmadı**.
> - iOS projesi hazırlandı ama **derlenmedi** (Xcode gerekir).
>
> 07'deki kabul ölçütü ("APK gerçek Android cihazda kurulup aynı hesapla PC oyuncusuyla aynı haritada oynanır") aşağıdaki **§3 Cihaz test listesi** ile senin telefonunda doğrulanacak.

## 1. İki derleme türü

| | Test derlemesi (debug APK) | Sürüm derlemesi (mağaza) |
|---|---|---|
| Komut | `npm run mobile:test-apk` | `npm run mobile:release` |
| Çıktı | `Deliveries/TurkOrbit-<sürüm>-test.apk` | `app-release.apk` + `app-release.aab` |
| Uygulama adı ve kimliği | "Türk Orbit Test", `com.turkorbit.oyun.test` (mağaza sürümüyle yan yana kurulur) | "Türk Orbit", `com.turkorbit.oyun` |
| Sunucu adresi | İlk açılışta uygulama sorar; giriş ekranında "Değiştir" | `VITE_SERVER_URL` ile pakete gömülü, değiştirilemez |
| Bağlantı | HTTP ve HTTPS (yerel ağdaki geliştirme sunucusu için) | **Yalnızca HTTPS/WSS** |
| İmza | Android hata ayıklama anahtarı | Senin anahtar deponla (keystore) |
| WebView hata ayıklama (chrome://inspect) | Açık | Kapalı |

## 2. Test APK'sı ile telefonda deneme (Android)

### 2.1 Bilgisayarda sunucuyu aç
1. Aşama 1–15 kurulumu yapılmış olsun (bkz. [Kurulum rehberi](Kurulum-ve-Dosya-Yerlestirme-Rehberi.md)).
2. Bilgisayarın yerel IP adresini bul:
   - Windows: `ipconfig` → "IPv4 Address" (ör. `192.168.1.20`).
   - Mac/Linux: `ip addr` veya `ifconfig`.
3. `.env` dosyasında `ALLOWED_ORIGINS` değerine Android uygulamasının kökünü ekle:
   ```
   ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5175,https://localhost,capacitor://localhost
   ```
   - `https://localhost`: Android uygulamasının sayfa kökü (Capacitor). Gerçek bir site değildir; uygulamanın içinden gelir.
   - `capacitor://localhost`: iOS uygulamasının sayfa kökü.
4. Dört süreci başlat: `npm run dev:api`, `npm run dev:game`, `npm run dev:client` (5173, `/api` ve `/game` yönlendirmesini yapar). Panel gerekirse `npm run dev:admin`.
5. Güvenlik duvarında **5173** portuna yerel ağdan gelen bağlantıya izin ver (Windows ilk açılışta sorar → "Özel ağlar").
6. Telefonun tarayıcısında `http://192.168.1.20:5173` aç: oyun sitesi geliyorsa ağ hazır.

### 2.2 APK'yı kur
- **Kablo ile (önerilir):**
  1. Telefonda Geliştirici seçenekleri → USB hata ayıklama açık olsun.
  2. Bilgisayarda: `adb install -r Deliveries/TurkOrbit-0.15.0-test.apk`.
- **Kablosuz:**
  1. APK dosyasını telefona gönder (e-posta, bulut, USB).
  2. Dosyaya dokun → "Bilinmeyen kaynaklardan yüklemeye izin ver" → Yükle.
- **Kendin derlemek istersen:** JDK 21 ve Android SDK kur (Android Studio en kolayı; `ANDROID_HOME` ayarlı olsun), sonra `npm run mobile:test-apk`.

### 2.3 Uygulamayı bağla
1. "Türk Orbit Test" uygulamasını aç → **Sunucu adresi** ekranı: `http://192.168.1.20:5173` → **Bağlan**.
2. "Sunucuya ulaşılamadı" çıkarsa sırayla kontrol et:
   - Telefon ve bilgisayar aynı Wi-Fi ağında mı?
   - Port açık mı (§2.1 adım 5)?
   - `ALLOWED_ORIGINS` içinde `https://localhost` var mı (API yeniden başlatıldı mı)?
3. Giriş ekranının altında "Sunucu: …" yazar. Hesabınla giriş yap.

## 3. Cihaz test listesi (07 kabul ölçütü)

Her maddeyi dene, sonucu (✅/❌ + not) bana yaz. Rapora gerçek cihaz sonucu olarak işlerim.

| # | Adım | Beklenen |
|---|---|---|
| 1 | Uygulamada giriş yap (PC'de web'de de aynı hesapla giriş yapılı olsun) | Pilot sayfası açılır |
| 2 | PC'de Hesap → Güvenlik | "Android · <telefon modeli>" oturumu listede |
| 3 | Uygulamayı tamamen kapat, yeniden aç | Tekrar giriş istemeden pilot sayfası (anahtar Keystore'da) |
| 4 | Uygulamada **Oyna**; PC'de **başka bir hesapla** aynı haritaya gir | İki pilot birbirini görür (gemi + radar listesi) |
| 5 | Telefonda joystick ile hareket et | PC ekranında gemi akıcı hareket eder; gözle gecikme kabaca ≤ 150 ms |
| 6 | Telefondan NPC'ye saldır (hedef + ateş düğmesi) | Hasar, ödül ve kargo PC'deki gibi |
| 7 | Telefonu yan çevir | Oyun yatay düzene geçer, HUD kesilmez, dokunma alanları rahat |
| 8 | Ana ekrana dön, 30 sn bekle, uygulamaya geri gel | "Yeniden bağlanılıyor" kısa süre görünür, oyun devam eder |
| 9 | Wi-Fi'yi kapatıp mobil veriye geç (sunucu internete açıksa) / Wi-Fi'yi kapat-aç | 30 sn içinde yeniden bağlanır |
| 10 | Oyunda Görevler çekmecesini aç → telefonun **geri** tuşu | Çekmece kapanır |
| 11 | Geri tuşuna tekrar bas | Önceki sayfaya döner; pilot sayfasında geri tuşu uygulamayı arka plana alır |
| 12 | PC'de Güvenlik → Android oturumunu **kapat** | Uygulamada bir sonraki işlemde giriş ekranı |
| 13 | Destek → yeni talep + ekran görüntüsü ekle → eke dokun | Ek telefonun tarayıcısında iner |
| 14 | Panelde İçerik → Ayarlar → Mobil uygulama sürümü → Android en düşük sürüm `0.16.0` → yayınla | Uygulamada "Güncelleme gerekli" ekranı; geri alınca "Tekrar dene" ile açılır |
| 15 | 60 dk oyna (isteğe bağlı) | Çökme yok; pil ve ısınma notu |

**Keystore cihaz testi (isteğe bağlı, teknik):**
1. Telefon USB ile bağlıyken: `cd apps/client/android && ./gradlew connectedDebugAndroidTest`.
2. 6 test geçmeli: yaz/oku/sil, değerin diskte açık metin olmaması, başka ada taşınan şifreli değerin okunamaması, bozuk değerin silinmesi.

**Hata ayıklama:**
1. Test APK'sında masaüstü Chrome'da `chrome://inspect` aç → telefondaki WebView → konsol ve ağ.
2. Oyun sunucusu günlüğü bilgisayarda `npm run dev:game` penceresinde.

## 4. Sürüm (mağaza) derlemesi — Android

### 4.1 İmza anahtarı (bir kez)
```bash
keytool -genkeypair -v -keystore turkorbit-yukleme.jks -alias turkorbit -keyalg RSA -keysize 4096 -validity 10000
```
- **Saklama:** Anahtar deposunu ve parolalarını depoya **koyma** (`.gitignore` `*.jks`/`*.keystore` dosyalarını dışlar). Güvenli bir yerde iki kopya tut.
- **Önerilen:** Google Play'de **Play App Signing** açık olsun. Bu anahtar "yükleme anahtarı" olur; kaybolursa Play Console'dan sıfırlanabilir.

### 4.2 Derle
```bash
export VITE_SERVER_URL=https://turkorbit.com.tr        # sunucunun HTTPS kökü (yol yok)
export TURKORBIT_KEYSTORE=/guvenli/yer/turkorbit-yukleme.jks
export TURKORBIT_KEYSTORE_PASSWORD=...
export TURKORBIT_KEY_ALIAS=turkorbit
export TURKORBIT_KEY_PASSWORD=...
npm run mobile:release
```
- **Çıktılar:**
  - `apps/client/android/app/build/outputs/bundle/release/app-release.aab` → Google Play Console'a yüklenir.
  - `…/apk/release/app-release.apk` → doğrudan dağıtım için.
- **Betiğin reddettiği durumlar:** HTTPS olmayan adres, eksik imza değişkeni.
- **Sunucu tarafı:** `ALLOWED_ORIGINS` üretimde `https://localhost,capacitor://localhost` içermeli. Mobil uygulama çerez değil Bearer anahtarı kullandığı için web oturumunun CSRF korumasını zayıflatmaz (K-104).

### 4.3 Yeni sürüm yayımlarken
1. `apps/client/package.json` içindeki `version` değerini artır (ör. `0.15.0` → `0.16.0`). Android `versionCode` ve iOS sürümü bundan türetilir (K-107). iOS için Xcode'da `MARKETING_VERSION`'ı da aynı yap.
2. Mağaza onayından **sonra**, eski sürümleri kapatmak istersen panelden İçerik → Ayarlar → **Mobil uygulama sürümü**'nü güncelle. Önce mağaza bağlantısını gir.

### 4.4 Google Play'de gerekecekler (senin hesabınla)
- Google Play Console geliştirici hesabı (tek seferlik ücret).
- Gizlilik politikası bağlantısı: sitedeki `/kvkk` sayfası kullanılabilir.
- Veri güvenliği formu:
  - Toplanan: e-posta, kullanıcı adı, oyun verisi, cihaz modeli (oturum listesi için).
  - Konum, rehber, kamera istenmez. İzin olarak yalnızca internet.
- Yaş derecelendirmesi anketi.
- Mağaza görselleri: simge 512×512 ve öne çıkan görsel 1024×500. Ekran görüntüleri gerçek cihazdan alınmalı.

## 5. iOS

**Gereksinimler:**
- macOS ve Xcode 16 veya üstü.
- Apple Developer Program üyeliği (yıllık ücretli). TestFlight ve App Store için zorunludur.

**Adımlar:**
1. `VITE_SERVER_URL=https://turkorbit.com.tr npm run mobile:ios`: web paketini derler, `apps/client/ios` projesine kopyalar.
2. `cd apps/client && npx cap open ios` → Xcode açılır.
3. App hedefi → **Signing & Capabilities** → Team seç. Bundle Identifier `com.turkorbit.oyun`, değiştirilirse Android ile tutarlı tut.
4. Gerçek iPhone'u bağla → Run. Sorun yoksa Product → **Archive** → Distribute → TestFlight.

**Notlar:**
- **Test sunucusu:** iOS, düz HTTP bağlantılarını (App Transport Security) varsayılan olarak engeller. iPhone testini HTTPS'li bir sunucuya (ör. hazırlık sunucusu) karşı yap. Yerel ağdaki HTTP sunucusu için Info.plist'e geçici olarak `NSAppTransportSecurity → NSAllowsLocalNetworking = YES` eklenebilir; mağaza derlemesine koyma.
- **Keychain:** Oturum anahtarı Keychain'de durur ve yedeğe ya da başka cihaza taşınmaz. Uygulama silinip yeniden kurulursa ilk açılışta temizlenir.
- **Derlenmedi:** iOS'a özgü kod (`App/App/SecureStorePlugin.swift`, `MainViewController.swift`) bu ortamda derlenemedi. İlk Xcode derlemesinde hata çıkarsa ileti metniyle bana yaz.

## 6. Simge ve açılış ekranı
- Görseller Türk Orbit logosundan üretildi; Capacitor'ın varsayılan görselleri kullanılmıyor. Kaynak: `scripts/mobile-assets.mjs`.
- Logo değişirse yeniden üret: `NODE_PATH=<playwright'ın node_modules> npm run mobile:assets`.
