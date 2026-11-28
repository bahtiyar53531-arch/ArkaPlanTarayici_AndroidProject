import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Türk Orbit mobil uygulaması (Android + iOS). Web istemcisiyle aynı kod tabanıdır:
 * `npm run mobile:build` istemciyi `dist-mobile/` klasörüne derler, `cap sync` bunu yerel projelere kopyalar.
 *
 * Güvenlik:
 * - Android'de sayfa kökü https://localhost, iOS'ta capacitor://localhost olur. Uygulama sunucuya çerezle değil,
 *   cihazın güvenli deposunda (Keystore/Keychain) tutulan oturum anahtarıyla (Authorization: Bearer) bağlanır.
 * - Düz HTTP (cleartext) ve karışık içerik burada AÇILMAZ. Yalnızca test derlemesinde (debug APK) yerel ağdaki
 *   geliştirme sunucusuna bağlanabilmek için Android tarafında açılır (bkz. android/app/build.gradle ve MainActivity).
 */
const config: CapacitorConfig = {
  appId: 'com.turkorbit.oyun',
  appName: 'Türk Orbit',
  webDir: 'dist-mobile',
  android: {
    // Karışık içerik sürüm derlemesinde kapalı. WebView hata ayıklama varsayılanı: yalnızca debug APK'da açık.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SystemBars: {
      // index.html viewport-fit=cover kullanır; CSS env(safe-area-inset-*) değerleri çentik/gezinme çubuğu boşluğunu verir
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
  },
};

export default config;
