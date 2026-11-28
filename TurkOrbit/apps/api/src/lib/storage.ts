/**
 * Dosya deposu (Aşama 13): destek ekleri. İçerik veritabanına gömülmez; rastgele anahtarla saklanır.
 * Yerel disk sürücüsü: anahtar → <kök>/<2 hane>/<64 hane>. Dosyalar statik olarak SUNULMAZ; yalnızca yetki
 * denetimi yapan uçtan, "indirme" olarak verilir. Nesne depolama (S3 uyumlu) sürücüsü aynı arayüzle eklenecek.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface FileStore {
  /** Yeni anahtar üretir ve içeriği yazar. */
  put(bytes: Buffer): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

const KEY = /^[a-f0-9]{2}\/[a-f0-9]{64}$/;

export class LocalFileStore implements FileStore {
  constructor(private readonly root: string) {}

  private file(key: string): string {
    if (!KEY.test(key)) throw new Error('Geçersiz depolama anahtarı');
    return path.join(this.root, ...key.split('/'));
  }

  async put(bytes: Buffer): Promise<string> {
    const hex = randomBytes(32).toString('hex');
    const key = `${hex.slice(0, 2)}/${hex}`;
    const target = this.file(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    // Önce geçici dosyaya yazılır, sonra atomik olarak taşınır (yarım dosya kalmaz)
    const tmp = `${target}.tmp-${process.pid}`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, target);
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.file(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }
}
