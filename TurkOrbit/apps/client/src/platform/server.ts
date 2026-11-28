import { IS_NATIVE } from './native';

/**
 * Sunucu kökü çözümlemesi. API `${kök}/api/v1`, oyun sunucusu `${kök (ws/wss)}/game` adresindedir;
 * üretimde ikisini de nginx aynı kökten yönlendirir, geliştirmede Vite yapar.
 *
 * - Web: kök sayfanın kendi kökü (göreli adres) — değişmedi.
 * - Mobil, sürüm derlemesi: VITE_SERVER_URL derlemeye gömülür ve değiştirilemez (SERVER_LOCKED).
 * - Mobil, test derlemesi (VITE_SERVER_URL boş): uygulama ilk açılışta adresi sorar (ör. bilgisayardaki
 *   geliştirme sunucusu http://192.168.1.20:5173). Adres gizli bilgi değildir; cihazda localStorage'da tutulur.
 */
const BUILD_SERVER = normalizeServerUrl(import.meta.env.VITE_SERVER_URL ?? '');
export const SERVER_LOCKED = BUILD_SERVER !== null;

const OVERRIDE_KEY = 'turkorbit.server';

/** "192.168.1.20:5173" veya "https://ornek.com/" → kök ("http://192.168.1.20:5173"). Geçersizse null. */
export function normalizeServerUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  if (!u.hostname) return null;
  return u.origin;
}

function readOverride(): string | null {
  try {
    return normalizeServerUrl(localStorage.getItem(OVERRIDE_KEY) ?? '');
  } catch {
    return null;
  }
}

/** Kök. Web'de '' (aynı kök). Mobilde adres henüz seçilmediyse null. */
export function serverOrigin(): string | null {
  if (BUILD_SERVER) return BUILD_SERVER;
  if (!IS_NATIVE) return '';
  return readOverride();
}

export function needsServerSetup(): boolean {
  return serverOrigin() === null;
}

/** Test derlemesinde sunucu adresini değiştirir. Sürüm derlemesinde (SERVER_LOCKED) izin verilmez. */
export function setServerOverride(url: string): string {
  if (SERVER_LOCKED) throw new Error('Bu derlemede sunucu adresi sabittir.');
  const origin = normalizeServerUrl(url);
  if (!origin) throw new Error('Geçerli bir adres yaz (ör. http://192.168.1.20:5173).');
  localStorage.setItem(OVERRIDE_KEY, origin);
  return origin;
}

export function clearServerOverride() {
  try {
    localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* depolama kapalı */
  }
}

export function apiBase(): string {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  return `${serverOrigin() ?? ''}/api/v1`;
}

export function gameUrl(): string {
  if (import.meta.env.VITE_GAME_URL) return import.meta.env.VITE_GAME_URL;
  const origin = serverOrigin();
  if (origin) return `${origin.replace(/^http/, 'ws')}/game`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game`;
}
