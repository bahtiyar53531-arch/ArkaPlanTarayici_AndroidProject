import type { ErrorCode } from '@turkorbit/shared';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly extra: {
      fields?: Record<string, string[]>;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthenticated: () => new AppError('UNAUTHENTICATED', 401, 'Oturum açman gerekiyor.'),
  forbidden: () => new AppError('FORBIDDEN', 403, 'Bu işlem için yetkin yok.'),
  invalidCredentials: () =>
    new AppError('INVALID_CREDENTIALS', 401, 'Kullanıcı adı/e-posta veya parola hatalı.'),
  rateLimited: (retryAfterSeconds: number, message = 'Çok fazla deneme yaptın. Biraz bekleyip tekrar dene.') =>
    new AppError('RATE_LIMITED', 429, message, { retryAfterSeconds }),
  invalidToken: () =>
    new AppError('INVALID_TOKEN', 400, 'Bağlantı geçersiz veya daha önce kullanılmış.'),
  tokenExpired: () =>
    new AppError('TOKEN_EXPIRED', 400, 'Bağlantının süresi dolmuş. Lütfen yeni bir bağlantı iste.'),
  notFound: (what = 'Kayıt') => new AppError('NOT_FOUND', 404, `${what} bulunamadı.`),
  csrf: () =>
    new AppError('CSRF_FAILED', 403, 'Güvenlik doğrulaması başarısız. Sayfayı yenileyip tekrar dene.'),
  origin: () => new AppError('ORIGIN_NOT_ALLOWED', 403, 'Bu kaynaktan gelen isteklere izin verilmiyor.'),
};
