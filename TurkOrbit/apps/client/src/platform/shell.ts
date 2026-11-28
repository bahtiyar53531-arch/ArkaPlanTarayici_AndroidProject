import { App } from '@capacitor/app';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { IS_NATIVE } from './native';

/**
 * Mobil uygulama kabuğu: Android geri tuşu, arka plan/ön plan geçişi, sistem çubukları, cihaz adı.
 * Web'de hiçbiri çalışmaz.
 */

/** Ana sayfalar: burada geri tuşu uygulamayı arka plana alır (Android alışkanlığı), geçmişte geri gitmez. */
const ROOT_PATHS = new Set(['/', '/giris', '/pilot']);

/**
 * Android geri tuşu. Sırayla:
 * 1. Açık pencere/çekmece varsa kapatır (arka plan katmanına tıklamakla aynı yol).
 * 2. Bildirim paneli açıksa kapatır.
 * 3. Ana sayfa değilse bir önceki sayfaya döner.
 * 4. Ana sayfadaysa uygulamayı arka plana alır (oturum ve oyun bağlantısı korunur).
 */
export function handleBackButton(canGoBack: boolean): 'closed' | 'back' | 'minimize' {
  const layers = document.querySelectorAll<HTMLElement>('.modal-backdrop, .hud-overlay[role="dialog"], .hud-drawer-backdrop');
  const top = layers[layers.length - 1];
  if (top) {
    top.click();
    return 'closed';
  }
  if (document.querySelector('.notif-panel')) {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return 'closed';
  }
  if (canGoBack && !ROOT_PATHS.has(location.pathname)) {
    history.back();
    return 'back';
  }
  void App.minimizeApp().catch(() => undefined);
  return 'minimize';
}

/** Arka plana geçiş/ön plana dönüş; oyun denetleyicisi dinler (bkz. game/controller.ts). */
export const APP_PAUSE_EVENT = 'turkorbit:pause';
export const APP_RESUME_EVENT = 'turkorbit:resume';

let started = false;

export function initNativeShell() {
  if (!IS_NATIVE || started) return;
  started = true;
  void SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => undefined);
  void App.addListener('backButton', ({ canGoBack }) => handleBackButton(canGoBack));
  void App.addListener('appStateChange', ({ isActive }) => {
    // Arka plana geçerken basılı tuşlar ve joystick bırakılır (sahne 'blur' dinler)
    if (!isActive) window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event(isActive ? APP_RESUME_EVENT : APP_PAUSE_EVENT));
  });
}

/** Oturum listesinde görünen cihaz adı (ör. "samsung SM-A546E"). Alınamazsa undefined. */
export async function nativeDeviceName(): Promise<string | undefined> {
  if (!IS_NATIVE) return undefined;
  try {
    const info = await Device.getInfo();
    const name = [info.manufacturer, info.model].filter(Boolean).join(' ').trim();
    return name ? name.slice(0, 60) : undefined;
  } catch {
    return undefined;
  }
}
