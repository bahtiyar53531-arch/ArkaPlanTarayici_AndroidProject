# Oto Tıklayıcı

Android için otomatik dokunma, kaydırma ve **hareket kaydedip aynen tekrarlama** uygulaması.
Kotlin + Jetpack Compose (Material 3 / Material You), erişilebilirlik servisi tabanlı; root gerekmez,
"diğer uygulamaların üzerinde göster" izni gerekmez, internet izni yoktur.

## Özellikler

**Modlar**
- **Tek nokta** – tek hedefe belirlenen aralıkla sürekli dokunma.
- **Çoklu nokta** – sıralı dokunma ve kaydırma hedefleri; her adımın kendi bekleme, basma süresi ve tık sayısı.
- **Kaydet & tekrarla** – ekranda yaptığın dokunma, uzun basma, kaydırma, sürükleme ve çoklu parmak
  (yakınlaştırma vb.) hareketlerini gerçek zamanlamasıyla kaydeder, aynen tekrarlar. Kayıt sırasında
  dokunuşlar uygulamaya iletildiği için telefonu normal kullanırsın.

**Adım türleri**
- Dokunma / uzun basma / çift-üçlü tık (1–10 art arda tık)
- Kaydırma, fırlatma ve sürükle-bırak (başta basılı tutma süresi)
- Serbest hareket: kaydedilmiş yol, 10 parmağa kadar; "hassas hız profili" ile duraklama ve hızlanmalar korunur

**Oynatma ayarları**
- Sonsuz / tur sayısı / süre (saat:dakika:saniye) ile durma
- Hız çarpanı (%10 – %1000), başlangıç geri sayımı, turlar arası bekleme
- İnsan gibi davranış: rastgele gecikme ± ms ve rastgele konum sapması ± px
- Farklı ekran boyutunda/yönünde konumları orantılı uyarlama
- Tüm adımların beklemesini tek seferde ayarlama

**Yüzen panel**
- Sürüklenebilir, küçültülebilir; dikey/yatay; boyut ve opaklık ayarlanabilir; konum hatırlanır
- Başlat/durdur, kayıt, dokunma/kaydırma hedefi ekle, son adımı sil (uzun bas: hepsini), hedefleri gizle,
  çalıştırma ayarları, kaydet (uzun bas: farklı kaydet), kapat
- Hedefe dokununca ayar penceresi: bekleme, basma süresi, tık sayısı, etkin/pasif, kopyala, sil, ters çevir
- Canlı durum: tur, dokunuş sayısı, geçen/kalan süre, geri sayım; dokunuş göstergesi animasyonu

**Güvenlik ve kolaylık**
- Ses tuşuyla anında durdurma, ekran kapanınca durdurma, uygulama değişince durdurma
- Oynatırken ekranı açık tutma, titreşimli geri bildirim
- Bildirim panelinde hızlı ayar kutucuğu, başlatıcı kısayolları (uzun bas: Tek nokta / Çoklu nokta / Kayıt)
- Makro listesi: düzenle, kopyala, sil, dışa aktar; JSON yedekleme ve içe aktarma
- Gelişmiş düzenleyici: koordinatlar, süreler, sıralama, etkinleştirme
- Açık / koyu / sistem teması ve Material You renkleri, istatistikler

## Kurulum

1. [Releases](../../releases/tag/oto-tiklayici) sayfasından `OtoTiklayici.apk` dosyasını indirip kur.
2. Uygulamayı aç › **Servisi aç** › Erişilebilirlik › Oto Tıklayıcı › Aç.
3. Android 13+ "Kısıtlanmış ayar" uyarısı çıkarsa: Uygulama bilgisi › sağ üst ⋮ › **Kısıtlanmış ayarlara izin ver**,
   sonra servisi tekrar aç.
4. Bir mod seç; panel ekrana gelir, istediğin uygulamaya geç ve ▶ ile başlat.

Xiaomi/Huawei/Oppo/Vivo/Samsung gibi cihazlarda servis kapanıyorsa pil optimizasyonunu kapat
(Ayarlar › Sistem içinde düğmesi var) ve otomatik başlatmaya izin ver.

## Derleme

Gereksinimler: JDK 17+ (21 önerilir), Android SDK (platform `android-37.2`, build-tools `37.0.0`).

```bash
cd OtoTiklayici
./gradlew testDebugUnitTest   # motor testleri (planlayıcı, kaydedici, oynatıcı)
./gradlew assembleRelease     # app/build/outputs/apk/release/app-release.apk
```

Sürümler: AGP 9.5.3, Gradle 9.9.2, Kotlin 2.4.21, Compose BOM 2026.11.01, compileSdk/targetSdk 37, minSdk 26.

`.github/workflows/oto-tiklayici.yml`, `OtoTiklayici/` altında bir değişiklik push edildiğinde testleri ve lint'i
çalıştırır, APK'ları üretir ve `oto-tiklayici` etiketli GitHub Release'e yükler.

### İmzalama

Depodaki `keystore/debug.keystore` herkese açık bir **hata ayıklama** anahtarıdır (parola `android`); CI'dan çıkan
her APK'nın bir öncekinin üzerine güncelleme olarak kurulabilmesi için kullanılır. Play Store veya geniş dağıtım için
kendi anahtarını oluştur ve GitHub Secrets'a ekle; iş akışı bunları otomatik kullanır:

| Secret | Açıklama |
| --- | --- |
| `OTO_KEYSTORE_BASE64` | `base64 -w0 release.keystore` çıktısı |
| `OTO_KEYSTORE_PASSWORD` | Anahtar deposu parolası |
| `OTO_KEY_ALIAS` | Anahtar adı |
| `OTO_KEY_PASSWORD` | Anahtar parolası |

Not: imza anahtarı değişirse eski sürümü kaldırıp yenisini kurmak gerekir.

## Mimari

| Paket | İçerik |
| --- | --- |
| `model` | Makro, adım türleri (dokunma, kaydırma, serbest hareket), çalıştırma ayarları — kotlinx.serialization |
| `engine` | `GesturePlanner` (adım → sistem hareketi, hız profili parçalama), `TouchRecorder` + `RecordingConverter`, `ActionTransformer` (hız, ölçek, rastgelelik), `MacroPlayer` (döngü ve durma koşulları). Android'den bağımsız, JVM testli |
| `service` | `AutoClickService` (erişilebilirlik servisi), `AccessibilityGestureExecutor` (`dispatchGesture`, `continueStroke`), `ServiceBridge` |
| `overlay` | Yüzen panel, sürüklenebilir hedefler, çizim katmanı, kayıt katmanı, overlay iletişim kutuları, `OverlaySession` |
| `data` | Makro deposu (JSON dosyaları), ayarlar (DataStore) |
| `ui` | Compose ekranları: ana ekran, düzenleyici, ayarlar, yardım |
| `tile` | Hızlı ayar kutucuğu |

Kayıt nasıl çalışır: kayıt sırasında tam ekran, dokunuşları yakalayan bir katman açılır. Her hareket parmak
kalktığında kaydedilir; ardından katman bir an dokunulamaz yapılıp aynı hareket alttaki uygulamaya enjekte edilir.
Oynatmada tek parmaklı hareketler, sabit hızla gidilemeyen noktalardan parçalara bölünüp `continueStroke` ile
parmak kaldırılmadan art arda gönderilir; böylece basılı tutma, duraklama ve hız değişimleri korunur.
