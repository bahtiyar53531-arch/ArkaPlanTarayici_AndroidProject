/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Sunucu kökü (ör. https://turkorbit.com.tr). Boşsa:
   * - web: sayfanın kendi kökü kullanılır (/api ve /game aynı kökten),
   * - mobil: uygulama ilk açılışta sunucu adresini sorar (yalnızca test derlemesi için).
   * Mağaza (sürüm) derlemesinde zorunludur ve https olmalıdır (scripts/mobile.mjs denetler).
   */
  readonly VITE_SERVER_URL?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_GAME_URL?: string;
}

/** İstemci sürümü (apps/client/package.json). Android versionName ve iOS CFBundleShortVersionString ile aynıdır. */
declare const __APP_VERSION__: string;
