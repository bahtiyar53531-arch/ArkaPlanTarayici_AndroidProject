/**
 * Parola politikası (NIST SP 800-63B yaklaşımı: uzunluk + yasaklı liste + kullanıcıya özel kontroller).
 * Aynı fonksiyon istemcide (anlık geri bildirim) ve sunucuda (asıl doğrulama) çalışır.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
/** Bu uzunluğun altındaki parolalarda en az iki farklı karakter sınıfı istenir. */
export const PASSWORD_LONG_PASSPHRASE = 16;

/**
 * Sık kullanılan / tahmin edilebilir parolalar (küçük harfe çevrilmiş halde karşılaştırılır).
 * Üretimde bu liste daha büyük bir sızıntı listesiyle (ör. HIBP k-anonymity) desteklenebilir.
 */
const COMMON_PASSWORDS = new Set<string>([
  '1234567890', '12345678910', '0123456789', '1111111111', '0000000000', '1234512345',
  '123456789a', 'a123456789', '1q2w3e4r5t', 'q1w2e3r4t5', '1qaz2wsx3edc', 'qwertyuiop',
  'qwerty1234', 'qwerty12345', 'asdfghjkl1', 'zxcvbnm123', 'password12', 'password123',
  'password1234', 'passw0rd123', 'iloveyou12', 'letmein123', 'welcome123', 'admin12345',
  'administrator', 'abc1234567', 'abcdefghij', 'princess12', 'sunshine12', 'football12',
  'baseball12', 'superman12', 'dragon1234', 'monkey1234', 'master1234', 'trustno1234',
  'sifre12345', 'şifre12345', 'sifre123456', 'parola1234', 'parola12345', 'parolam123',
  'galatasaray', 'galatasaray1905', '1905galatasaray', 'fenerbahce', 'fenerbahce1907',
  '1907fenerbahce', 'besiktas1903', '1903besiktas', 'trabzonspor', 'trabzonspor1967',
  'turkiye1923', 'türkiye1923', 'istanbul34', 'istanbul1453', 'ankara0606', 'izmir35izmir',
  'bismillah1', 'allahuekber', 'askim12345', 'aşkım12345', 'seniseviyorum', 'kanka12345',
  'turkorbit', 'turkorbit1', 'turkorbit123', 'türkorbit123', 'darkorbit1', 'darkorbit123',
  'orbit12345', 'uzaygemisi', 'qwertyuiop1', 'aaaaaaaaaa', 'abcabcabca', '9876543210',
  'qazwsxedcr', 'mustafakemal', 'ataturk1881', 'atatürk1881', 'minecraft12', 'pubgmobile',
]);

export interface PasswordContext {
  username?: string | undefined;
  email?: string | undefined;
}

export interface PasswordCheckResult {
  ok: boolean;
  /** Türkçe, kullanıcıya gösterilebilir sorun listesi. */
  problems: string[];
  /** 0 (çok zayıf) - 4 (çok güçlü) arası kaba güç tahmini, sadece arayüz göstergesi içindir. */
  score: 0 | 1 | 2 | 3 | 4;
}

function characterClasses(password: string): number {
  let classes = 0;
  if (/\p{Ll}/u.test(password)) classes++;
  if (/\p{Lu}/u.test(password)) classes++;
  if (/\p{Nd}/u.test(password)) classes++;
  if (/[^\p{L}\p{Nd}]/u.test(password)) classes++;
  return classes;
}

export function checkPassword(password: string, ctx: PasswordContext = {}): PasswordCheckResult {
  const problems: string[] = [];
  const length = [...password].length;
  const lower = password.toLocaleLowerCase('tr-TR');

  if (length < PASSWORD_MIN_LENGTH) {
    problems.push(`Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`);
  }
  if (length > PASSWORD_MAX_LENGTH) {
    problems.push(`Parola en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.`);
  }
  if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(password.toLowerCase())) {
    problems.push('Bu parola çok yaygın ve kolay tahmin edilir. Başka bir parola seç.');
  }
  if (/^(.)\1+$/u.test(password)) {
    problems.push('Parola tek bir karakterin tekrarından oluşamaz.');
  }
  const username = ctx.username?.trim().toLocaleLowerCase('tr-TR');
  if (username && username.length >= 3 && lower.includes(username)) {
    problems.push('Parola kullanıcı adını içeremez.');
  }
  const emailLocal = ctx.email?.split('@')[0]?.trim().toLocaleLowerCase('tr-TR');
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    problems.push('Parola e-posta adresinin bir bölümünü içeremez.');
  }
  const classes = characterClasses(password);
  if (length >= PASSWORD_MIN_LENGTH && length < PASSWORD_LONG_PASSPHRASE && classes < 2) {
    problems.push(
      `${PASSWORD_LONG_PASSPHRASE} karakterden kısa parolalarda en az iki farklı karakter türü (küçük harf, büyük harf, rakam, sembol) kullan.`,
    );
  }

  let score = 0;
  if (length >= PASSWORD_MIN_LENGTH) score++;
  if (length >= 14) score++;
  if (classes >= 3) score++;
  if (length >= 20 || (length >= 14 && classes >= 4)) score++;
  if (problems.length > 0) score = Math.min(score, 1);

  return { ok: problems.length === 0, problems, score: score as PasswordCheckResult['score'] };
}
