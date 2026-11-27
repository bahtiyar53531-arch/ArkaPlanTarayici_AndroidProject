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
│     ├─ ZoomModel.kt                Ölçek sınırları ve görünüm boyutu hesabı
│     ├─ ReconnectPolicy.kt          Artan aralıklı (backoff) yeniden bağlanma
│     ├─ RenderQuality.kt            Render kalitesi seviyeleri + otomatik (uyarlanabilir) kalite
│     └─ ConnectionTracker.kt        Oyun soketlerinin açık/kapalı durumu
│  └─ src/test/…                     birim testleri
│
├─ app/                              ANDROID UYGULAMASI
│  ├─ build.gradle.kts               SDK 24–36, imzalama, R8 küçültme
│  ├─ proguard-rules.pro
│  └─ src/main/
│     ├─ AndroidManifest.xml         İzinler, PiP, ön plan servisi, oyun kategorisi
│     ├─ assets/js/orbitra_probe.js  Hafif sayfa betiği: FPS sayacı, soket durumu, oyun ölçeği (viewport),
│     │                              render kalitesi (devicePixelRatio), PC görünümü, klavye konumu
│     ├─ java/space/orbitragame/app/
│     │  ├─ MainActivity.kt          Ana ekran: yükleme, olaylar, menü, FPS, PiP, bağlantı
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
│     │  │  ├─ SpaceLoadingView.kt   Açılış yazısı + yüzde çubuğu (video yoksa gerçekçi hareketsiz görüntü)
│     │  │  ├─ SplashVideoView.kt    Sinematik açılış videosu (sessiz, döngülü, center-crop)
│     │  │  ├─ ControlButtonView.kt  Sürüklenebilir kontrol düğmesi
│     │  │  ├─ ControlMenuView.kt    Sade kontrol menüsü (zoom satırı + 6 düğme, bir kez oluşturulur)
│     │  │  ├─ FpsBadgeView.kt       Yalnızca "60 FPS" gösteren küçük rozet
│     │  │  ├─ GameViewport.kt       Etkin sayfa ölçeği (zoom, PiP) ve klavye kaydırması
│     │  │  ├─ DragHelper.kt         Sürükle-bırak + kenara yapışma
│     │  │  └─ SettingsDialog.kt     Sade ayarlar (3 anahtar + yeniden başlat)
│     │  ├─ system/
│     │  │  ├─ DisplayController.kt  Tam ekran, ekran yönü, ekranı açık tutma, 60 Hz
│     │  │  ├─ PipController.kt      Küçük pencere (PiP) parametreleri ve eylemleri
│     │  │  └─ NetworkMonitor.kt     Ağ bağlantısı izleme
│     │  ├─ service/GameSessionService.kt  Arka planda bağlantı koruyan ön plan servisi
│     │  └─ settings/AppSettings.kt  Kullanıcı tercihleri (şifre tutulmaz)
│     └─ res/
│        ├─ mipmap-*/                Uygulama simgesi (5 yoğunluk, adaptive katmanlar)
│        ├─ mipmap-anydpi-v26/       Adaptive icon tanımı (+ Android 13 tema simgesi)
│        ├─ drawable/                Menü simgeleri, bildirim simgesi, şekiller
│        ├─ raw/splash_*.mp4         Açılış videoları (dikey 720x1280, yatay 1280x720)
│        ├─ drawable-nodpi/bg_space.webp   Gerçekçi arka plan (dikey; yatay için drawable-land-nodpi)
│        ├─ drawable-xxxhdpi/brand_mark.png  Uygulama içi küçük logo
│        ├─ font/                    Orbitron (marka yazısı)
│        ├─ layout/activity_main.xml Katman düzeni
│        ├─ values/                  Renkler, Türkçe metinler, temalar
│        └─ xml/                     Ağ güvenliği, yedekleme kuralları, Game Mode
│  └─ src/test/…/UiScreenshotTest.kt Robolectric arayüz testleri + ekran görüntüleri
│
├─ branding/                         Play Store simgesi, tanıtım görseli, logo yazısı,
│  ├─ generator/gen.js               simge görsellerinin kaynağı (SVG → PNG üretici)
│  └─ splash-scene/                  açılış videosunun 3B sahnesi (three.js) ve render betiği
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
3. **Hafif ölçüm:** `orbitra_probe.js` oyunun `requestAnimationFrame` çağrısında
   tek bir karşılaştırma yapar (bellek ayırmaz), `WebSocket` için yalnızca
   açılış/kapanışı izler; FPS'i yalnızca gösterge açıkken veya otomatik kalite
   karar verirken saniyede bir uygulamaya iletir. PC görünümünde sayfa ağacı
   sürekli izlenmez; tarama tarayıcı boştayken yapılır.
4. **Arka plan:** Ana ekrana dönünce PiP; PiP yoksa/kapatılmışsa
   `GameSessionService` + `GameWebView` canlı tutma + renderer önceliği.
5. **iOS'a geçiş:** `core/` modülü Android'e bağımlı değildir; Kotlin
   Multiplatform modülüne çevrilip iOS (WKWebView) kabuğundan kullanılabilir.
