import { describe, expect, it } from 'vitest';
import { cleanMultiline, detectFileType, forumThreadCreateSchema, sanitizeFileName, supportCreateSchema, ticketNumber, TICKET_NO_REGEX } from './community.js';

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe('ek dosya türü (sihirli baytlar)', () => {
  it('PNG, JPEG, WEBP, PDF içerikten tanınır; uzantıya güvenilmez', () => {
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2))).toBe('image/png');
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('image/jpeg');
    expect(detectFileType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56))).toBe('image/webp');
    expect(detectFileType(text('%PDF-1.7\n...'))).toBe('application/pdf');
  });
  it('çalıştırılabilir, arşiv ve ikili dosyalar reddedilir; düz metin (UTF-8, Türkçe) kabul edilir', () => {
    expect(detectFileType(bytes(0x4d, 0x5a, 0x90, 0, 3))).toBeNull(); // Windows EXE
    expect(detectFileType(bytes(0x7f, 0x45, 0x4c, 0x46, 2))).toBeNull(); // ELF
    expect(detectFileType(bytes(0x50, 0x4b, 0x03, 0x04, 0x14))).toBeNull(); // ZIP
    expect(detectFileType(bytes(0xc3, 0x28))).toBeNull(); // geçersiz UTF-8
    expect(detectFileType(new Uint8Array(0))).toBeNull();
    expect(detectFileType(text('Hata kaydı: ığüşöç İĞÜŞÖÇ\r\n\tsatır 2'))).toBe('text/plain');
  });
  it('dosya adı: yol ve tehlikeli karakterler atılır, uzantı türe göre konur', () => {
    expect(sanitizeFileName('../../etc/passwd', 'text/plain')).toBe('passwd.txt');
    expect(sanitizeFileName('C:\\Users\\a\\ekran görüntüsü<script>.exe', 'image/png')).toBe('ekran görüntüsü_script_.png');
    expect(sanitizeFileName('...', 'application/pdf')).toBe('dosya.pdf');
  });
});

describe('destek ve forum şemaları', () => {
  it('talep numarası biçimi: TO-yıl-6 hane; büyük sayılar taşmaz', () => {
    expect(ticketNumber(2026, 123)).toBe('TO-2026-000123');
    expect(ticketNumber(2027, 1234567)).toBe('TO-2027-1234567');
    expect(TICKET_NO_REGEX.test('TO-2026-000123')).toBe(true);
    expect(TICKET_NO_REGEX.test("TO-2026-1' OR 1=1")).toBe(false);
  });
  it('metin temizliği: satır sonları korunur, görünmez karakterler atılır; istemciden durum/öncelik kabul edilmez', () => {
    expect(cleanMultiline('a\u200b b  \r\n\r\n\r\n\r\n\r\nc\u202e')).toBe('a b\n\n\nc');
    expect(forumThreadCreateSchema.parse({ category: 'genel', title: '  Uzun   başlık  ', body: 'x' }).title).toBe('Uzun başlık');
    const base = { category: 'bug', subject: 'Oyun donuyor', body: 'Harita geçişinde oyun donuyor.' };
    expect(supportCreateSchema.safeParse(base).success).toBe(true);
    expect(supportCreateSchema.safeParse({ ...base, status: 'resolved' }).success).toBe(false);
    expect(supportCreateSchema.safeParse({ ...base, priority: 'urgent' }).success).toBe(false);
    expect(supportCreateSchema.safeParse({ ...base, body: 'kısa' }).success).toBe(false);
  });
});
