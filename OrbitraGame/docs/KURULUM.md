# Kurulum Talimatı

## 1. Telefona / tablete kurulum (APK)

**Desteklenen sürümler:** Android 7.0 (API 24) ve üzeri telefon ve tabletler.
Küçük pencere (PiP) Android 8.0 ve üzerinde çalışır.

1. Telefondan release APK'yı indir:
   `https://github.com/bahtiyar53531-arch/ArkaPlanTarayici_AndroidProject/raw/ccr-992f123f-q9iy6l/dist/ORBITRAGAME.SPACE-v1.2.0.apk`
   (Eski sürüm kuruluysa üzerine kurulur; giriş bilgilerin korunur.)
2. İndirilen dosyaya dokun. "Bilinmeyen uygulamaları yükle" izni sorulursa
   tarayıcına (Chrome vb.) bu izni ver ve geri dön.
3. **Yükle** → **Aç**.
4. İlk açılışta:
   - Uzay temalı açılış ekranı gerçek yükleme yüzdesini gösterir.
   - Giriş yapmadıysan oyunun kendi giriş sayfası açılır (kullanıcı adı,
     şifre, doğrulama kodu). "Beni hatırla" seçersen sonraki açılışlarda
     doğrudan oyuna girersin.
   - Oyuna girdiğinde **bildirim izni** sorulur (Android 13+). Arka plan
     bildirimini görmek için izin ver.
   - Bir kez "pil kısıtlamasını kaldır" önerisi çıkar. Arka planda bağlantı
     için **önerilir** (Menü → Ayarlar'dan da yapılabilir).

### Debug ve release farkı

| | Release | Debug |
|---|---|---|
| Dosya | `ORBITRAGAME.SPACE-v1.2.0.apk` | `ORBITRAGAME.SPACE-v1.2.0-debug.apk` |
| Uygulama adı | ORBITRAGAME.SPACE | ORBITRAGAME.SPACE (Debug) |
| Paket adı | `space.orbitragame.app` | `space.orbitragame.app.debug` |
| Boyut / hız | ~2,4 MB (açılış videoları dahil), küçültülmüş ve optimize | ~6 MB, hata ayıklama bilgisi var |

İkisi aynı anda kurulabilir. Günlük kullanım için **release** sürümünü kur.

### Arka planda kesintisiz bağlantı için öneriler

- **En güçlü yöntem:** Ana ekrana dönünce oyun otomatik olarak küçük pencereye
  geçer ve tam hızda çalışmaya devam eder. Pencereyi ekran kenarına
  sürüklersen gizlenir ama oyun canlı kalır. Pencerenin **X** düğmesi oyunu
  kapatır.
- Küçük pencere açılmıyorsa: Ayarlar → Uygulamalar → ORBITRAGAME.SPACE →
  **Pencere içinde pencere** iznini aç.
- Pil optimizasyonunu kapat (menü → Ayarlar → "Pil optimizasyonunu kapat").
- Bazı üreticilerde ek ayar gerekir:
  - **Xiaomi / Redmi / POCO:** Uygulama bilgisi → Otomatik başlatma: Açık;
    Pil tasarrufu: Kısıtlama yok.
  - **Samsung:** Ayarlar → Pil → Arka plan kullanım sınırları → "Hiç uyku
    moduna geçmeyen uygulamalar" listesine ekle.
  - **Huawei / Honor:** Pil → Uygulama başlatma → Manuel yönet → hepsini aç.
  - **Oppo / Realme / OnePlus / Vivo:** Pil → Arka planda çalışmaya izin ver.

> Android ve üreticiler arka plandaki uygulamaları kendi kurallarıyla
> kısıtlayabilir. Uygulama mümkün olan en iyi korumayı yapar ama **her cihazda
> kesintisiz çalışma garanti edilemez.**

### Menü (v1.2.0 — sade)

Sağ kenardaki yuvarlak düğmeye dokun (basılı tutup sürükleyerek yerini değiştirebilirsin):

- **− %100 +** : oyun ölçeği (%30–%160). Yüzdeye dokununca %100'e döner.
- **FPS** : köşede yalnızca "60 FPS" yazan küçük göstergeyi aç/kapat (sürüklenebilir).
- **PC görünümü** : dokundukça Kapalı → Orta → Güçlü. Yalnızca üstteki pencereler küçülür,
  gemi ve harita aynı kalır. "Küçültülecek pencere bulunamadı" yazarsa bana haber ver.
- **Ekran yönü** : dokundukça Otomatik → Yatay → Dikey.
- **Küçük pencere**, **Yeniden bağlan**, **Ayarlar** (3 anahtar + yeniden başlat).

Render kalitesi, 60 Hz kararlı ekran, otomatik yeniden bağlanma ve düşük gecikmeli
Wi-Fi kendiliğinden çalışır; ayar gerekmez.

### Sorun giderme

| Sorun | Çözüm |
|---|---|
| Oyun açılmıyor / siyah ekran | Play Store'dan **Android System WebView** ve **Chrome**'u güncelle (WebGL2 için güncel motor gerekir). Menü → Yeniden başlat. |
| "Sunucuya ulaşılamıyor" | İnternet bağlantını kontrol et; uygulama bağlantı gelince otomatik yeniden dener. |
| Bağlantı arka planda kopuyor | Yukarıdaki pil/üretici ayarlarını yap; Ayarlar'da "Küçük pencere" ve "Arka planda bağlı kal" açık kalsın. |
| Menü düğmesi oyun düğmesinin üstünde | Düğmeyi basılı tutup istediğin kenara sürükle; konum kaydedilir. |
| Yazılar çok küçük/büyük | Menü → − / + veya PC görünümü. |
| Ekranın bir kısmı siyah | Klavye kaynaklı nedeni v1.1.0'da düzeltildi. Tekrar olursa ekran görüntüsünü gönder; Menü → Yeniden bağlan. |
| FPS hâlâ düşük | Uygulama kaliteyi otomatik ayarlar. Telefon ısınmışsa biraz soğumasını bekle, arka plandaki uygulamaları kapat. |

## 2. Android Studio ile derleme

**Gerekenler:** Android Studio 2025.1 (Narwhal) veya daha yeni, JDK 17+
(Android Studio'nun kendi JDK'sı yeterli), Android SDK Platform 36.

1. Android Studio → **Open** → depodaki `OrbitraGame` klasörünü seç.
2. Gradle senkronizasyonunun bitmesini bekle (ilk seferde bağımlılıklar iner).
3. Telefonu USB ile bağla (Geliştirici seçenekleri → USB hata ayıklama açık).
4. Üstteki çalıştırma yapılandırmasında **app** seçili → **Run ▶**.

Komut satırından:

```bash
cd OrbitraGame
./gradlew :core:test :app:testDebugUnitTest   # 21 otomatik test
./gradlew :app:assembleDebug                  # app/build/outputs/apk/debug/
./gradlew :app:assembleRelease                # app/build/outputs/apk/release/
./gradlew :app:installDebug                   # bağlı telefona kur
```

## 3. Release imzalama

Release APK, imza anahtarıyla (keystore) imzalanır. **Güncellemelerin eski
sürümün üzerine kurulabilmesi için hep aynı anahtar kullanılmalıdır.**
Anahtar ve şifreleri sana ayrıca (depoya koymadan) verildi; güvenli sakla.

`OrbitraGame/keystore.properties` dosyasını oluştur (git'e eklenmez):

```properties
storeFile=/tam/yol/orbitragame-release.jks
storePassword=...
keyAlias=orbitragame
keyPassword=...
```

Sonra `./gradlew :app:assembleRelease`.

## 4. GitHub Actions ile otomatik derleme

`.github/workflows/orbitragame-android.yml`:

- `OrbitraGame/` altında değişiklik push edildiğinde testleri çalıştırır,
  debug APK üretir ve **Actions → Artifacts** altına koyar.
- İmzalı release için depo ayarlarında **Settings → Secrets and variables →
  Actions** bölümüne şu secret'ları ekle:
  - `ORBITRA_KEYSTORE_BASE64` — `base64 -w0 orbitragame-release.jks` çıktısı
  - `ORBITRA_KEYSTORE_PASSWORD`, `ORBITRA_KEY_ALIAS` (`orbitragame`), `ORBITRA_KEY_PASSWORD`
- `orbitragame-v1.0.1` gibi bir etiket (tag) push edilirse APK'larla birlikte
  bir GitHub Release oluşturulur.

> Not: Depodaki eski workflow dosyalarına (`lbuild-apk.yml`,
> `starkchrome-v3.yml`, `starkorbit-v2.yml`) dokunulmadı. Bunlar her push'ta
> çalışıp eski sürümleri silip yeniden oluşturuyor.
