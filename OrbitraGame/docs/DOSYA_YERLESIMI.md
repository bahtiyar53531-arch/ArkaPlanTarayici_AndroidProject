# Dosya Yerleşimi

```
OrbitraGame/                         Android Studio projesi (bu klasörü aç)
├─ settings.gradle.kts               Modüller: :core ve :app
├─ build.gradle.kts                  Eklenti tanımları
├─ gradle/libs.versions.toml         Tüm kütüphane sürümleri tek yerde
├─ gradle/wrapper/                   Gradle 8.14.3 sarmalayıcısı
├─ gradlew, gradlew.bat              Komut satırı derleme
├─ keystore.properties               (git'e EKLENMEZ) release imza bilgileri
│
├─ core/                             PLATFORMDAN BAĞIMSIZ iş mantığı (saf Kotlin)
│  └─ src/main/kotlin/space/orbitragame/core/
│     ├─ GameConfig.kt               Oyun adresi, güvenilen alan adları
│     ├─ UrlPolicy.kt                Alan adı beyaz listesi, http→https, hile engelleme
│     ├─ LoadingProgressModel.kt     %0-20-40-60-80-100 gerçek yükleme aşamaları
│     ├─ FpsStats.kt                 Anlık / ortalama / en düşük FPS, düşük FPS uyarısı
│     ├─ PingStats.kt                Ping ortanca, sapma (jitter), kayıp, kalite
│     ├─ ZoomModel.kt                Ölçek sınırları ve görünüm boyutu hesabı
│     ├─ ReconnectPolicy.kt          Artan aralıklı (backoff) yeniden bağlanma
│     └─ ConnectionTracker.kt        Oyun soketlerinin açık/kapalı durumu
│  └─ src/test/…                     18 birim testi
│
├─ app/                              ANDROID UYGULAMASI
│  ├─ build.gradle.kts               SDK 24–36, imzalama, R8 küçültme
│  ├─ proguard-rules.pro
│  └─ src/main/
│     ├─ AndroidManifest.xml         İzinler, PiP, ön plan servisi, oyun kategorisi
│     ├─ assets/js/orbitra_probe.js  Sayfaya enjekte edilen GÖZLEM betiği (FPS + soket durumu)
│     ├─ java/space/orbitragame/app/
│     │  ├─ MainActivity.kt          Ana ekran: yükleme, olaylar, menü, panel, PiP, bağlantı
│     │  ├─ OrbitraApp.kt            Bildirim kanalı
│     │  ├─ RestartActivity.kt       "Uygulamayı yeniden başlat" (ayrı süreçte)
│     │  ├─ web/
│     │  │  ├─ GameWebView.kt        Arka planda "gizli sekme" kısıtlamasını önleyen WebView
│     │  │  ├─ WebViewHolder.kt      WebView'i Activity'den bağımsız tutar (oturum korunur)
│     │  │  ├─ GameWebViewClient.kt  Gezinme güvenliği, SSL, hata, renderer çökmesi
│     │  │  ├─ GameChromeClient.kt   İlerleme, mikrofon izni, dosya seçici
│     │  │  ├─ JsBridge.kt           Güvenli WebMessageListener köprüsü
│     │  │  └─ GameWebHost.kt        WebView → Activity olay arayüzü
│     │  ├─ ui/
│     │  │  ├─ SpaceLoadingView.kt   Animasyonlu uzay açılış ekranı + yüzde çubuğu
│     │  │  ├─ ControlButtonView.kt  Sürüklenebilir kontrol düğmesi
│     │  │  ├─ ControlMenuView.kt    Açılır kapanır kontrol menüsü
│     │  │  ├─ PerfPanelView.kt      FPS / Ping / sistem paneli
│     │  │  ├─ ZoomOverlayView.kt    İki parmak yakınlaştırma modu
│     │  │  ├─ GameViewport.kt       Zoom ve PiP için WebView boyut/ölçek yönetimi
│     │  │  ├─ DragHelper.kt         Sürükle-bırak + kenara yapışma
│     │  │  └─ SettingsDialog.kt     Arka plan / bağlantı ayarları
│     │  ├─ system/
│     │  │  ├─ DisplayController.kt  Tam ekran, ekran yönü, ekranı açık tutma
│     │  │  ├─ PipController.kt      Küçük pencere (PiP) parametreleri ve eylemleri
│     │  │  ├─ NetworkMonitor.kt     Ağ türü / bağlantı izleme
│     │  │  ├─ PingMonitor.kt        TCP el sıkışma süresiyle ping
│     │  │  ├─ FrameRateMonitor.kt   Ekrana çizilen kare sayısı (FrameMetrics)
│     │  │  └─ DeviceStats.kt        Bellek, ısı, pil
│     │  ├─ service/GameSessionService.kt  Arka planda bağlantı koruyan ön plan servisi
│     │  └─ settings/AppSettings.kt  Kullanıcı tercihleri (şifre tutulmaz)
│     └─ res/
│        ├─ mipmap-*/                Uygulama simgesi (5 yoğunluk, adaptive katmanlar)
│        ├─ mipmap-anydpi-v26/       Adaptive icon tanımı (+ Android 13 tema simgesi)
│        ├─ drawable/                Menü simgeleri, bildirim simgesi, şekiller
│        ├─ drawable-nodpi/bg_space.webp   Uzay arka planı
│        ├─ drawable-xxxhdpi/brand_mark.png  Uygulama içi küçük logo
│        ├─ font/                    Orbitron (marka yazısı)
│        ├─ layout/activity_main.xml Katman düzeni
│        ├─ values/                  Renkler, Türkçe metinler, temalar
│        └─ xml/                     Ağ güvenliği, yedekleme kuralları, Game Mode
│  └─ src/test/…/UiScreenshotTest.kt Robolectric arayüz testleri + ekran görüntüleri
│
├─ branding/                         Play Store simgesi, tanıtım görseli, logo yazısı,
│  └─ generator/gen.js               görsellerin kaynağı (SVG → PNG üretici)
├─ docs/                             Türkçe belgeler ve ekran görüntüleri
└─ tools/js-probe-test/              Enjekte betiğin Chromium doğrulama testi

../.github/workflows/orbitragame-android.yml   GitHub Actions: test + APK + (etiketle) Release
../dist/                                       Hazır APK'lar ve ZIP paketi
```

## Katmanlar nasıl çalışıyor?

1. **Açılış:** `MainActivity` sistem splash'ından sonra `SpaceLoadingView`'ı
   gösterir; ilk kare çizilince WebView'i (`WebViewHolder`) oluşturur (%20),
   oyun adresini yükler (%40), sunucu yanıt verince %60, Chromium'un gerçek
   ilerlemesiyle %60–79, sayfa bitince %80, oyun kare çizmeye başlayınca
   (`orbitra_probe.js` → `ready`) %100 olur ve ekran kaybolur.
2. **Güvenlik:** Her gezinme `UrlPolicy`'den geçer. Köprü yalnızca
   `https://orbitragame.space` kaynağına açılır.
3. **Ölçüm:** `orbitra_probe.js` oyunun `requestAnimationFrame` ve
   `WebSocket` çağrılarını şeffaf sarar (davranışı değiştirmez), sayıları
   saniyede bir uygulamaya iletir. Ping, oyun soketinin sunucusuna TCP el
   sıkışma süresiyle ölçülür (oyun trafiğine paket eklenmez).
4. **Arka plan:** Ana ekrana dönünce PiP; PiP yoksa/kapatılmışsa
   `GameSessionService` + `GameWebView` canlı tutma + renderer önceliği.
5. **iOS'a geçiş:** `core/` modülü Android'e bağımlı değildir; Kotlin
   Multiplatform modülüne çevrilip iOS (WKWebView) kabuğundan kullanılabilir.
