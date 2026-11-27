import { z } from 'zod';
import { CLIENT_PLATFORMS } from './brand.js';
import { PASSWORD_MAX_LENGTH } from './password-policy.js';

/** Kullanıcı adı: harfle başlar, 3-20 karakter, sadece İngilizce harf/rakam/alt çizgi. */
export const USERNAME_REGEX = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;

/**
 * Yetkili / resmî hesap taklidini önlemek için rezerve edilmiş adlar.
 * Kullanıcı adı küçük harfe çevrilip bu kökleri İÇERİYORSA reddedilir.
 */
export const RESERVED_USERNAME_PARTS = [
  'admin',
  'yonetici',
  'moderator',
  'moderatör',
  'turkorbit',
  'destek',
  'support',
  'sistem',
  'system',
  'gamemaster',
  'official',
  'resmi',
] as const;
export const RESERVED_USERNAMES_EXACT = ['gm', 'mod', 'root', 'staff', 'null', 'undefined'] as const;

export function isReservedUsername(username: string): boolean {
  const lower = username.toLowerCase();
  if ((RESERVED_USERNAMES_EXACT as readonly string[]).includes(lower)) return true;
  return RESERVED_USERNAME_PARTS.some((part) => lower.includes(part));
}

export const usernameSchema = z
  .string({ message: 'Kullanıcı adı gerekli.' })
  .trim()
  .regex(USERNAME_REGEX, {
    message:
      'Kullanıcı adı harfle başlamalı, 3-20 karakter olmalı ve sadece harf, rakam ve alt çizgi (_) içermeli.',
  })
  .refine((v) => !isReservedUsername(v), {
    message: 'Bu kullanıcı adı resmî/yetkili hesaplar için ayrılmıştır.',
  });

export const emailSchema = z
  .string({ message: 'E-posta adresi gerekli.' })
  .trim()
  .toLowerCase()
  .max(254, { message: 'E-posta adresi çok uzun.' })
  .pipe(z.email({ message: 'Geçerli bir e-posta adresi gir.' }));

/** Uzunluk üst sınırı burada; asıl politika checkPassword() ile uygulanır. */
export const passwordInputSchema = z
  .string({ message: 'Parola gerekli.' })
  .min(1, { message: 'Parola gerekli.' })
  .max(PASSWORD_MAX_LENGTH, { message: `Parola en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.` });

export const clientPlatformSchema = z.enum(CLIENT_PLATFORMS);

export const deviceInfoSchema = z.strictObject({
  platform: clientPlatformSchema.default('unknown'),
  name: z.string().trim().max(60).optional(),
  appVersion: z.string().trim().max(32).optional(),
});

/**
 * Kayıt şeması. strictObject: tanımsız alan (ör. "role", "isAdmin") gönderilirse istek REDDEDİLİR.
 * Rol bilgisi hiçbir zaman istemciden alınmaz.
 */
export const registerSchema = z.strictObject({
  username: usernameSchema,
  email: emailSchema,
  password: passwordInputSchema,
  acceptTerms: z.literal(true, { message: 'Kullanım koşullarını ve KVKK metnini kabul etmelisin.' }),
  locale: z.enum(['tr', 'en']).default('tr'),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.strictObject({
  identifier: z
    .string({ message: 'Kullanıcı adı veya e-posta gerekli.' })
    .trim()
    .min(1, { message: 'Kullanıcı adı veya e-posta gerekli.' })
    .max(254),
  password: passwordInputSchema,
  /** web: HttpOnly çerez; token: mobil/masaüstü uygulamalar için güvenli depoda saklanan oturum anahtarı. */
  transport: z.enum(['cookie', 'token']).default('cookie'),
  device: deviceInfoSchema.optional(),
});
export type LoginInput = z.input<typeof loginSchema>;

export const verifyEmailSchema = z.strictObject({
  token: z.string().trim().min(20).max(200),
});

export const forgotPasswordSchema = z.strictObject({
  email: emailSchema,
});

export const resetPasswordSchema = z.strictObject({
  token: z.string().trim().min(20).max(200),
  newPassword: passwordInputSchema,
});

export const changePasswordSchema = z.strictObject({
  currentPassword: passwordInputSchema,
  newPassword: passwordInputSchema,
});
