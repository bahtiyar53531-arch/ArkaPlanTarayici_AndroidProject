#!/usr/bin/env node
/**
 * TÜRK ORBIT — Aşama 1 arayüz (tarayıcı) uçtan uca testi
 *
 * Gerçek API + Vite istemcisi + SMTP alıcısı başlatır, Chromium ile masaüstü ve iPhone görünümünde
 * kayıt → e-posta bağlantısı → giriş → hesap güvenliği → cihazlar arası oturum kapatma akışını dener
 * ve ekran görüntülerini Documentation/DevelopmentNotes/ekran-goruntuleri/asama-01 altına kaydeder.
 *
 * Gereksinim: Playwright (npm i -D playwright && npx playwright install chromium), PostgreSQL, Redis.
 * Kullanım:  npm run test:ui
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  console.error('Playwright bulunamadı. Kurulum: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-01');
const SHOTS5 = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-05');
const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgres://turkorbit:turkorbit_dev@127.0.0.1:5432/turkorbit_e2e';
const REDIS_URL = process.env.UI_E2E_REDIS_URL ?? 'redis://127.0.0.1:6379/13';
const API_PORT = 4101;
const WEB_PORT = 5174;
const SMTP_PORT = 2526;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
mkdirSync(SHOTS, { recursive: true });
mkdirSync(SHOTS5, { recursive: true });

const inbox = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  logger: false,
  onData(stream, session, cb) {
    simpleParser(stream)
      .then((m) => {
        for (const r of session.envelope.rcptTo) inbox.push({ to: r.address, subject: m.subject, text: m.text ?? '' });
        cb();
      })
      .catch(cb);
  },
});
async function linkFor(to, subjectPart) {
  for (let i = 0; i < 100; i++) {
    const m = [...inbox].reverse().find((x) => x.to === to && x.subject.includes(subjectPart));
    if (m) return m.text.match(/https?:\/\/\S+token=[A-Za-z0-9_-]+/)[0];
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${to} için "${subjectPart}" e-postası gelmedi`);
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: String(API_PORT),
  LOG_LEVEL: 'warn',
  DATABASE_URL: DB_URL,
  REDIS_URL,
  PUBLIC_WEB_URL: WEB,
  ALLOWED_ORIGINS: WEB,
  CSRF_SECRET: 'ui-e2e-csrf-secret-at-least-32-characters',
  MAIL_TRANSPORT: 'smtp',
  SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}?ignoreTLS=true`,
  VITE_API_PROXY: `http://127.0.0.1:${API_PORT}`,
};

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✖ ${name}\n      → ${err.message.split('\n')[0]}`);
  }
}
async function waitHttp(url) {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* bekle */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${url} açılmadı`);
}

const procs = [];
let browser;
try {
  console.log('TÜRK ORBIT — Aşama 1 arayüz testi\n');
  await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  const tsx = path.join(ROOT, 'node_modules/.bin/tsx');
  const mig = spawnSync(tsx, ['apps/api/src/scripts/migrate.ts'], { cwd: ROOT, env, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error(mig.stderr);
  spawnSync('redis-cli', ['-u', REDIS_URL, 'FLUSHDB']);
  procs.push(spawn(tsx, ['apps/api/src/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] }));
  procs.push(
    spawn(path.join(ROOT, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], {
      cwd: path.join(ROOT, 'apps/client'),
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
    }),
  );
  await waitHttp(`http://127.0.0.1:${API_PORT}/api/v1/health`);
  await waitHttp(WEB);

  browser = await playwright.chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: 'tr-TR' });
  const iphone = await browser.newContext({ ...playwright.devices['iPhone 13'], locale: 'tr-TR' });
  const pc = await desktop.newPage();
  const phone = await iphone.newPage();
  const A = { username: 'AnadoluKartali', email: 'kartal.pilot@ornek.com', password: 'Kizilelma_Seferi_1071' };

  console.log('Masaüstü (1280×860)');
  await step('Kayıt sayfası: zayıf parola canlı uyarı gösterir', async () => {
    await pc.goto(`${WEB}/kayit`);
    await pc.getByLabel('Kullanıcı adı (pilot adı)').fill(A.username);
    await pc.getByLabel('E-posta').fill(A.email);
    await pc.getByLabel('Parola', { exact: true }).fill('galatasaray');
    await pc.getByText('Bu parola çok yaygın').waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS, '01-kayit-zayif-parola.jpg') });
  });
  await step('Kayıt tamamlanır → "E-postanı kontrol et"', async () => {
    await pc.getByLabel('Parola', { exact: true }).fill(A.password);
    await pc.getByLabel('Parola (tekrar)').fill(A.password);
    await pc.getByRole('checkbox').check();
    await pc.getByRole('button', { name: 'Kayıt ol' }).click();
    await pc.getByRole('heading', { name: 'E-postanı kontrol et' }).waitFor();
  });
  await step('E-postadaki bağlantı (gerçek SMTP) hesabı doğrular ve anahtar adres çubuğundan silinir', async () => {
    await pc.goto(await linkFor(A.email, 'doğrula'));
    await pc.getByText('E-posta adresin doğrulandı').waitFor();
    if (pc.url().includes('token=')) throw new Error('token adres çubuğunda kaldı');
  });
  await step('Hatalı parola Türkçe hata mesajı gösterir', async () => {
    await pc.goto(`${WEB}/giris`);
    await pc.getByLabel('Kullanıcı adı veya e-posta').fill(A.username);
    await pc.getByLabel('Parola', { exact: true }).fill('yanlis-parola-1');
    await pc.getByRole('button', { name: 'Giriş yap' }).click();
    await pc.getByText('Kullanıcı adı/e-posta veya parola hatalı.').waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS, '02-giris-hata.jpg') });
  });
  await step('Giriş → pilotu olmayan oyuncu pilot oluşturma sihirbazına yönlenir', async () => {
    await pc.getByLabel('Parola', { exact: true }).fill(A.password);
    await pc.getByRole('button', { name: 'Giriş yap' }).click();
    await pc.getByRole('heading', { name: 'Pilotunu oluştur' }).waitFor();
  });
  await step('Hesabım: Oyuncu ID, doğrulanmış e-posta, rol: Oyuncu', async () => {
    await pc.goto(`${WEB}/hesap`);
    await pc.getByRole('heading', { name: `Hoş geldin, ${A.username}` }).waitFor();
    await pc.getByText('Doğrulandı', { exact: true }).waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS, '03-hesabim.jpg') });
  });

  console.log('Aşama 5 — pilot profili (masaüstü)');
  await step('Sihirbaz: sunucu seçili gelir, şirket seçilir ve pilot oluşturulur', async () => {
    await pc.goto(`${WEB}/pilot`);
    await pc.getByRole('heading', { name: 'Pilotunu oluştur' }).waitFor();
    await pc.getByText('Gökbörü Filosu', { exact: true }).click();
    await pc.getByText('Kırlangıç gemisiyle göreve başlayacak').waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS5, '01-pilot-olusturma.jpg'), fullPage: true });
    await pc.getByRole('button', { name: 'Pilotu oluştur' }).click();
    await pc.getByRole('heading', { name: A.username }).waitFor();
  });
  await step('Profil: şirket, Oyuncu ID, seviye, rütbe, paralar, gemi, konum ve başarım gerçek veriyle görünür', async () => {
    for (const t of ['Gökbörü Filosu', 'Sv 1', 'Pilot Adayı', '25.000', '1.000', 'Kırlangıç', 'Gökbörü Üssü', 'Galaksiye Hoş Geldin', 'Başlangıç desteği']) {
      await pc.getByText(t).first().waitFor();
    }
    await pc.getByText(/Oyuncu ID #\d+/).first().waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS5, '02-pilot-profili.jpg'), fullPage: true });
  });
  await step('Slogan düzenlenir ve kaydedilir', async () => {
    await pc.getByRole('button', { name: 'Sloganı düzenle' }).click();
    await pc.getByLabel('Pilot sloganı').fill('Sürü güçlüdür, rota bizden sorulur');
    await pc.getByRole('button', { name: 'Kaydet' }).click();
    await pc.getByText('“Sürü güçlüdür, rota bizden sorulur”').waitFor();
  });
  await step('Herkese açık profil: e-posta ve para bilgisi göstermez', async () => {
    await pc.getByRole('link', { name: 'Herkese açık profilim' }).click();
    await pc.waitForURL(/\/pilot\/TR1\/AnadoluKartali$/);
    await pc.getByText('Kazanılan başarımlar').waitFor();
    const body = await pc.locator('main').innerText();
    if (body.includes(A.email) || body.includes('25.000') || body.includes('Akçe')) throw new Error('özel bilgi görünüyor');
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS5, '03-acik-profil.jpg'), fullPage: true });
  });

  console.log('iPhone 13 görünümü');
  await step('Aynı hesapla telefondan giriş', async () => {
    await phone.goto(`${WEB}/giris`);
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS, '04-mobil-giris.jpg') });
    await phone.getByLabel('Kullanıcı adı veya e-posta').fill(A.email);
    await phone.getByLabel('Parola', { exact: true }).fill(A.password);
    await phone.getByRole('button', { name: 'Giriş yap' }).click();
    await phone.getByRole('heading', { name: A.username }).waitFor();
  });
  await step('Telefonda aynı pilot profili ve PC\'de yazılan slogan görünür (senkron)', async () => {
    await phone.getByText('“Sürü güçlüdür, rota bizden sorulur”').waitFor();
    await phone.getByText('Gökbörü Filosu').first().waitFor();
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS5, '04-mobil-profil.jpg'), fullPage: true });
  });
  await step('Telefonda güvenlik sayfası: iki aktif oturum görünür', async () => {
    await phone.goto(`${WEB}/hesap/guvenlik`);
    await phone.getByRole('heading', { name: 'Aktif oturumlar' }).waitFor();
    const items = phone.locator('.panel').first().locator('.list-item');
    await items.nth(1).waitFor(); // veriler API'den yüklenene kadar bekle
    const n = await items.count();
    if (n !== 2) throw new Error(`2 oturum bekleniyordu, ${n} görüldü`);
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS, '05-mobil-guvenlik.jpg'), fullPage: true });
  });

  console.log('Cihazlar arası oturum kontrolü');
  await step('PC güvenlik sayfasından telefon oturumu kapatılır', async () => {
    await pc.goto(`${WEB}/hesap/guvenlik`);
    await pc.getByRole('heading', { name: 'Aktif oturumlar' }).waitFor();
    await pc.locator('.panel').first().locator('.list-item').nth(1).waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS, '06-pc-guvenlik.jpg'), fullPage: true });
    await pc.getByRole('button', { name: 'Oturumu kapat' }).click();
    await pc.getByText('Oturum kapatıldı.').waitFor();
  });
  await step('Telefon yenilendiğinde giriş sayfasına düşer', async () => {
    await phone.reload();
    await phone.waitForURL(/\/giris$/);
    await phone.getByRole('heading', { name: 'Giriş yap' }).waitFor();
  });
  await step('Parola değiştirme formu çalışır', async () => {
    await pc.getByLabel('Mevcut parola').fill(A.password);
    await pc.getByLabel('Yeni parola', { exact: true }).fill('Gokturk_Yazitlari_732');
    await pc.getByRole('button', { name: 'Parolayı değiştir' }).click();
    await pc.getByText('Parolan değiştirildi.').waitFor();
  });
  await step('Çıkış yapılır ve korumalı sayfa giriş sayfasına yönlendirir', async () => {
    await pc.getByRole('button', { name: 'Çıkış', exact: true }).click();
    await pc.waitForURL(/\/giris$/);
    await pc.goto(`${WEB}/hesap`);
    await pc.waitForURL(/\/giris$/);
  });
} catch (err) {
  results.push({ name: 'hazırlık', ok: false });
  console.error(err);
} finally {
  await browser?.close();
  for (const p of procs) p.kill('SIGTERM');
  smtp.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSonuç: ${results.length - failed}/${results.length} adım başarılı. Ekran görüntüleri: ${path.relative(ROOT, SHOTS)}, ${path.relative(ROOT, SHOTS5)}`);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
