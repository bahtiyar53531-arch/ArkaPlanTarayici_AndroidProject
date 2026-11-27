/** Türk Orbit marka sabitleri — tüm istemci, sunucu ve e-postalarda tek kaynak. */
export const BRAND = {
  gameName: 'TÜRK ORBIT',
  shortName: 'Türk Orbit',
  domain: 'turkorbit.com',
  website: 'https://turkorbit.com',
  adminPanelName: 'TÜRK ORBIT YÖNETİM MERKEZİ',
  supportEmail: 'destek@turkorbit.com',
  noReplyEmail: 'no-reply@turkorbit.com',
} as const;

/** İstemcinin bağlandığı platform. Aynı hesap tüm platformlarda geçerlidir. */
export const CLIENT_PLATFORMS = [
  'web',
  'android',
  'ios',
  'windows',
  'macos',
  'linux',
  'unknown',
] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export const PLATFORM_LABELS_TR: Record<ClientPlatform, string> = {
  web: 'Web tarayıcısı',
  android: 'Android',
  ios: 'iOS (iPhone/iPad)',
  windows: 'Windows',
  macos: 'Mac',
  linux: 'Linux',
  unknown: 'Bilinmeyen cihaz',
};
