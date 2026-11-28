import { registerPlugin } from '@capacitor/core';
import { IS_NATIVE } from './native';

/**
 * Uygulamanın kendi yerel eklentisi (apps/client/android/.../SecureStorePlugin.java, ios/App/App/SecureStorePlugin.swift).
 * - Android: değer, Android Keystore'da üretilen ve dışarı çıkarılamayan AES-256-GCM anahtarıyla şifrelenip
 *   uygulamaya özel SharedPreferences'ta saklanır.
 * - iOS: Keychain (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly: yedeğe ve başka cihaza taşınmaz).
 * Web'de kullanılmaz: tarayıcı oturumu HttpOnly çerezdedir ve JavaScript ona erişemez.
 */
interface SecureStorePlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

const SecureStore = registerPlugin<SecureStorePlugin>('TurkOrbitSecureStore');
const SESSION_KEY = 'session';

let cached: string | null = null;

/**
 * Oturum anahtarı (yalnızca mobil uygulama). Bellekteki kopya API isteklerine "Authorization: Bearer" olarak eklenir;
 * kalıcı kopya yalnızca güvenli depodadır (localStorage'a veya çereze yazılmaz).
 */
export const sessionToken = {
  current: (): string | null => cached,

  async load(): Promise<string | null> {
    if (!IS_NATIVE) return null;
    try {
      cached = (await SecureStore.get({ key: SESSION_KEY })).value ?? null;
    } catch {
      // Ör. Android'de anahtar silinmiş/yedekten dönülmüş: okunamayan anahtar yok sayılır, oyuncu yeniden giriş yapar
      cached = null;
    }
    return cached;
  },

  async save(token: string): Promise<void> {
    cached = token;
    if (IS_NATIVE) await SecureStore.set({ key: SESSION_KEY, value: token });
  },

  async clear(): Promise<void> {
    cached = null;
    if (IS_NATIVE) await SecureStore.remove({ key: SESSION_KEY }).catch(() => undefined);
  },
};
