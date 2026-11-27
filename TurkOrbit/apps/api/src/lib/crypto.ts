import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL'de güvenle taşınabilen, tahmin edilemez anahtar (varsayılan 256 bit). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}

export function hmacBase64Url(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64url');
}

/** Zamanlama saldırısına dayanıklı karşılaştırma. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
