import { Capacitor } from '@capacitor/core';
import type { ClientPlatform } from '@turkorbit/shared';

/**
 * Çalışma ortamı. Uygulama Android/iOS içinde (Capacitor) çalışırken yerel köprü sayfadan önce yüklenir,
 * bu yüzden değer modül yüklenirken kesinleşir ve oturum boyunca değişmez.
 */
export const IS_NATIVE: boolean = Capacitor.isNativePlatform();

const platform = Capacitor.getPlatform();
export const CLIENT_PLATFORM: ClientPlatform = platform === 'android' ? 'android' : platform === 'ios' ? 'ios' : 'web';

export const APP_VERSION: string = __APP_VERSION__;
