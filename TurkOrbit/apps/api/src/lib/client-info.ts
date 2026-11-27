import { isIP } from 'node:net';
import { CLIENT_PLATFORMS, type ClientPlatform } from '@turkorbit/shared';

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
}

/**
 * Hafif User-Agent çözümleyici. Amaç güvenlik ekranında "Chrome · Android" gibi okunabilir bilgi
 * göstermek ve cihaz parmak izi üretmektir; tam doğruluk hedeflenmez.
 */
export function parseUserAgent(ua: string | undefined | null): ParsedUserAgent {
  if (!ua) return { browser: null, os: null };
  let os: string | null = null;
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPad/i.test(ua)) os = 'iPadOS';
  else if (/iPhone|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser: string | null = null;
  // Aşama 15'te Capacitor/masaüstü uygulamaları UA'ya "TurkOrbitApp/<sürüm>" işaretini ekleyecek.
  if (/TurkOrbitApp\//.test(ua)) browser = 'Türk Orbit Uygulaması';
  else if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet';
  else if (/YaBrowser\//.test(ua)) browser = 'Yandex';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';
  else if (/curl\/|node|undici|okhttp|axios/i.test(ua)) browser = 'Komut satırı / uygulama';
  return { browser, os };
}

export function normalizePlatform(value: unknown): ClientPlatform {
  return typeof value === 'string' && (CLIENT_PLATFORMS as readonly string[]).includes(value)
    ? (value as ClientPlatform)
    : 'unknown';
}

/** Kullanıcıya gösterim için IP maskeleme: 85.105.12.34 → 85.105.*.* */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v) === 4) {
    const p = v.split('.');
    return `${p[0]}.${p[1]}.*.*`;
  }
  if (isIP(v) === 6) {
    const groups = v.split(':').filter(Boolean).slice(0, 3);
    return `${groups.join(':')}:*`;
  }
  return null;
}

/** PostgreSQL inet sütununa yazılabilir IP (geçersizse null). */
export function safeIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return isIP(v) ? v : null;
}
