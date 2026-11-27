import argon2 from 'argon2';

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Argon2id parola özetleyici.
 * - Parolalar asla düz metin saklanmaz/loglanmaz.
 * - Var olmayan kullanıcıyla girişte de sahte doğrulama yapılır (kullanıcı varlığı zamanlamadan anlaşılmasın).
 * - Parametreler yükseltilirse başarılı girişte özet yeniden hesaplanır (needsRehash).
 */
export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly params: Argon2Params) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...this.params });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, { ...this.params });
    } catch {
      return true;
    }
  }

  /** Kullanıcı bulunamadığında harcanan süreyi gerçek doğrulamaya eşitler. */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('turkorbit-dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
