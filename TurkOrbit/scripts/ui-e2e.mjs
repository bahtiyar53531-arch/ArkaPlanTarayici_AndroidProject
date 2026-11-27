#!/usr/bin/env node
/**
 * TÜRK ORBIT — Aşama 1, 5, 6 ve 7 arayüz (tarayıcı) uçtan uca testi
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
const SHOTS6 = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-06');
const SHOTS7 = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-07');
const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgres://turkorbit:turkorbit_dev@127.0.0.1:5432/turkorbit_e2e';
const REDIS_URL = process.env.UI_E2E_REDIS_URL ?? 'redis://127.0.0.1:6379/13';
const API_PORT = 4101;
const WEB_PORT = 5174;
const SMTP_PORT = 2526;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
mkdirSync(SHOTS, { recursive: true });
mkdirSync(SHOTS5, { recursive: true });
mkdirSync(SHOTS6, { recursive: true });
mkdirSync(SHOTS7, { recursive: true });

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
let db;
const fpsReadings = {};
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
  const pageErrors = [];
  const worldNet = { pc: [], phone: [] };
  for (const [name, pg_] of [['pc', pc], ['phone', phone]]) {
    pg_.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
    // Hata durumunda teşhis için dünya isteklerinin durum kodları
    pg_.on('response', (r) => r.url().includes('/api/v1/world/') && worldNet[name].push(`${r.status()} ${new URL(r.url()).pathname.replace('/api/v1', '')}`));
  }
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const coords = async (page) => {
    const t = await page.getByTestId('hud-coords').innerText();
    const [x, y] = t.split('/').map((v) => Number(v.trim()));
    return { x, y };
  };
  const dbPos = async () => (await db.query(`SELECT p.pos_x, p.pos_y, m.code FROM players p JOIN maps m ON m.id = p.map_id`)).rows[0];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Tek tuval: geliştirme modundaki React StrictMode ilk oyunu kurup hemen kapatır; kapanan tuval DOM'dan kalkmalı.
  const singleCanvas = async (page) => {
    const canvases = page.locator('[data-testid="game-canvas"] canvas');
    await canvases.first().waitFor();
    for (let i = 0; i < 40 && (await canvases.count()) !== 1; i++) await sleep(100);
    if ((await canvases.count()) !== 1) throw new Error(`tek tuval bekleniyordu: ${await canvases.count()}`);
  };
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

  console.log('Aşama 6 — hangar ve mağaza (masaüstü)');
  const statDps = async () => (await pc.locator('.stats-table dd').nth(1).innerText()).trim();
  await step('Hangar: başlangıç kiti takılı, Kırlangıç aktif, konfigürasyon değerleri görünür', async () => {
    await pc.getByRole('link', { name: 'Hangar', exact: true }).click();
    await pc.getByRole('heading', { name: 'Hangar' }).waitFor();
    await pc.getByText('Konfigürasyon 1 değerleri').waitFor();
    if ((await statDps()) !== '40') throw new Error(`saniyede hasar 40 bekleniyordu: ${await statDps()}`);
    await pc.getByText('IŞK-1 Batarya').first().waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS6, '01-hangar.jpg'), fullPage: true });
  });
  await step('Slot seçici: lazer çıkarılır (hasar 0), yeniden takılır (hasar 40)', async () => {
    await pc.getByRole('button', { name: /Lazer 1: OK-1/ }).click();
    await pc.getByRole('button', { name: 'Çıkar' }).click();
    await pc.getByRole('button', { name: /Lazer 1: boş/ }).waitFor();
    if ((await statDps()) !== '0') throw new Error('çıkarınca hasar 0 olmalı');
    await pc.getByRole('button', { name: /Lazer 1: boş/ }).click();
    await pc.getByRole('dialog').getByRole('button', { name: 'Tak' }).first().click();
    await pc.getByRole('button', { name: /Lazer 1: OK-1/ }).waitFor();
    if ((await statDps()) !== '40') throw new Error('takınca hasar 40 olmalı');
  });
  await step('Mağaza: gemiler listelenir; lazer satın alınır ve bakiye düşer', async () => {
    await pc.getByRole('link', { name: 'Mağaza', exact: true }).first().click();
    await pc.getByRole('heading', { name: 'Mağaza' }).waitFor();
    await pc.getByText('Doğan', { exact: true }).waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS6, '02-magaza-gemiler.jpg'), fullPage: true });
    await pc.getByRole('tab', { name: 'Lazerler' }).click();
    const card = pc.locator('.offer').filter({ hasText: 'OK-1 Lazer Topu' });
    await card.getByRole('button', { name: 'Satın al' }).click();
    await card.getByRole('button', { name: 'Onayla' }).click();
    await pc.getByText('OK-1 Lazer Topu satın alındı').waitFor();
    await pc.getByText('Kredi: 15.000').waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS6, '03-magaza-lazerler.jpg') });
  });
  await step('Envanter: yeni lazer yükseltilir (+1) ve sonuç Türkçe bildirilir', async () => {
    await pc.getByRole('link', { name: 'Hangar', exact: true }).first().click();
    await pc.getByRole('heading', { name: 'Envanter' }).waitFor();
    const free = pc.locator('.inv-item').filter({ hasText: 'OK-1 Lazer Topu' }).filter({ hasNotText: 'Kırlangıç' }).first();
    await free.getByRole('button', { name: 'Yükselt' }).click();
    await free.locator('.confirm').getByRole('button', { name: 'Yükselt' }).click(); // onay kutusundaki buton
    await pc.getByText('Yükseltme başarılı! OK-1 Lazer Topu artık +1.').waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS6, '04-envanter-yukseltme.jpg'), fullPage: true });
  });

  console.log('Aşama 7 — harita ve oyun motoru (masaüstü)');
  await step('Oyna: tuval ve HUD açılır (pilot, can/kalkan, G-1 mini harita, güvenli bölge)', async () => {
    await pc.getByRole('link', { name: 'Oyna', exact: true }).click();
    await pc.waitForURL(/\/oyna$/);
    await singleCanvas(pc);
    await pc.locator('.hud-pilot').getByText(A.username).waitFor();
    await pc.locator('.hud-minimap-title').getByText('G-1 · Gökbörü Üssü').waitFor();
    await pc.locator('.hud-pilot').getByText('Güvenli').waitFor();
    await sleep(900); // kamera açılış geçişi
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '01-oyun-g1-istasyon.jpg') });
  });
  await step('Klavye: D basılı tutulunca gemi sağa gider ve konum sunucuya kaydedilir', async () => {
    const a = await coords(pc);
    await pc.keyboard.down('KeyD');
    await sleep(2200);
    await pc.keyboard.up('KeyD');
    await sleep(1600); // en az bir senkron turu
    const b = await coords(pc);
    if (!(b.x > a.x + 150)) throw new Error(`x artmadı: ${a.x} → ${b.x}`);
    if (Math.abs(b.y - a.y) > 30) throw new Error(`y değişmemeliydi: ${a.y} → ${b.y}`);
    const d = await dbPos();
    if (Math.abs(d.pos_x - b.x) > 60) throw new Error(`sunucu konumu farklı: db ${d.pos_x}, hud ${b.x}; istekler: ${worldNet.pc.slice(-8).join(', ')}`);
  });
  await step('Tıkla-git: ekranın üst tarafına tıklanınca gemi yukarı yönelir', async () => {
    const a = await coords(pc);
    await pc.mouse.click(640, 200);
    await sleep(1800);
    const b = await coords(pc);
    if (!(b.y < a.y - 100)) throw new Error(`y azalmadı: ${a.y} → ${b.y}`);
  });
  await step('Sunucu doğrulaması: sunucudaki konum ile uyuşmayan hareket reddedilir, istemci düzeltilir', async () => {
    await sleep(1200);
    const d = await dbPos();
    const fx = Math.round(d.pos_x) - 4000;
    const fy = Math.round(d.pos_y);
    // Sunucu tarafında konumu değiştir (ör. başka cihazdan hareket); istemcinin eski konumdan gönderdiği adım hız sınırını aşar.
    await db.query(`UPDATE players SET pos_x = $1, pos_y = $2, pos_updated_at = now()`, [fx, fy]);
    await pc.keyboard.down('KeyS');
    await sleep(700);
    await pc.keyboard.up('KeyS');
    await pc.getByText('Konumun sunucu tarafından doğrulanamadı ve düzeltildi.').waitFor({ timeout: 5000 });
    await sleep(300);
    const b = await coords(pc);
    if (Math.abs(b.x - fx) > 40) throw new Error(`istemci sunucu konumuna çekilmedi: ${b.x} (beklenen ${fx})`);
    const r = await db.query(`SELECT count(*)::int AS n FROM position_rejections`);
    if (r.rows[0].n < 1) throw new Error('reddedilen konum kaydı yok');
  });
  await step('Kilitli geçit: seviye 5 isteyen G-4 geçidinde "Atla" pasif ve sebep Türkçe yazılı', async () => {
    await db.query(`UPDATE players SET pos_x = 10000, pos_y = 10950, pos_updated_at = now()`);
    await pc.reload();
    const prompt = pc.locator('.hud-portal');
    await prompt.getByText('G-4').waitFor();
    await prompt.getByText(/seviye 5/i).waitFor();
    if (!(await prompt.getByRole('button').isDisabled())) throw new Error('kilitli geçitte buton aktif');
    await sleep(700);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '02-kilitli-gecit.jpg') });
  });
  await step('Geçit: G-2 geçidinin yanında J tuşu ile atlanır → G-2 yüklenir, geçiş sunucuda kayıtlı', async () => {
    await db.query(`UPDATE players SET pos_x = 18250, pos_y = 6250, pos_updated_at = now()`);
    await pc.reload();
    await pc.locator('.hud-portal').getByText('G-2').waitFor();
    await sleep(800);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '03-gecit-yaninda.jpg') });
    await pc.keyboard.press('KeyJ');
    await pc.locator('.hud-minimap-title').getByText(/^G-2 · /).waitFor({ timeout: 8000 });
    await pc.getByText(/G-2 .* bölgesine geçtin\./).waitFor();
    const d = await dbPos();
    if (d.code !== 'G-2') throw new Error(`sunucuda harita ${d.code}`);
    const t = await db.query(`SELECT count(*)::int AS n FROM map_transitions WHERE reason = 'portal'`);
    if (t.rows[0].n !== 1) throw new Error('geçiş kaydı yok');
    await sleep(2500);
    // Geçişten sonra eski haritanın konumu gönderilip reddedilmemeli (yalnızca önceki adımdaki 1 bilinçli ret)
    const rj = await db.query(`SELECT count(*)::int AS n FROM position_rejections`);
    if (rj.rows[0].n !== 1) throw new Error(`geçişten sonra yanlış konum reddi: ${rj.rows[0].n - 1}`);
    if (await pc.getByText('Konumun sunucu tarafından doğrulanamadı').isVisible()) throw new Error('geçişten sonra düzeltme uyarısı çıktı');
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '04-g2-varis.jpg') });
  });
  await step('Galaksi haritası: M ile açılır, bulunulan harita ve kilit sebepleri görünür; Esc kapatır', async () => {
    await pc.keyboard.press('KeyM');
    const dlg = pc.getByRole('dialog', { name: 'Galaksi haritası' });
    await dlg.locator('svg circle').first().waitFor();
    await dlg.getByText('Buradasın', { exact: false }).waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '05-galaksi-haritasi.jpg') });
    await pc.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
  });
  await step('Ayarlar: galaksi tuşu G yapılır, FPS göstergesi açılır ve sunucuya kaydedilir', async () => {
    await pc.getByRole('button', { name: 'Ayarlar', exact: true }).click();
    const dlg = pc.getByRole('dialog', { name: 'Oyun ayarları' });
    await dlg.locator('.key-row').filter({ hasText: 'Galaksi haritası' }).getByRole('button').click();
    await pc.keyboard.press('KeyG');
    await dlg.locator('.key-row').filter({ hasText: 'Galaksi haritası' }).getByRole('button', { name: 'G', exact: true }).waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '06-ayarlar-tuslar.jpg') });
    await dlg.getByRole('button', { name: 'Grafik' }).click();
    await dlg.getByLabel('FPS göstergesi').check();
    await dlg.getByRole('button', { name: 'Kaydet' }).click();
    await dlg.getByText('Kaydedildi.', { exact: false }).waitFor();
    const r = await db.query(`SELECT settings FROM player_settings WHERE device_class = 'desktop'`);
    if (r.rows[0]?.settings.keys.galaxy !== 'KeyG' || r.rows[0]?.settings.graphics.showFps !== true) throw new Error('ayar sunucuya yazılmadı');
    await dlg.getByRole('button', { name: 'Kapat' }).click();
    await pc.keyboard.press('KeyG');
    await pc.getByRole('dialog', { name: 'Galaksi haritası' }).waitFor();
    await pc.keyboard.press('Escape');
    await sleep(2500);
    fpsReadings.desktop = await pc.getByTestId('hud-fps').innerText();
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
  await step('Telefonda hangar: aynı ekipman ve +1 lazer görünür (senkron)', async () => {
    await phone.goto(`${WEB}/hangar`);
    await phone.getByRole('heading', { name: 'Envanter' }).waitFor();
    await phone.locator('.level-badge', { hasText: '+1' }).first().waitFor();
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS6, '05-mobil-hangar.jpg'), fullPage: true });
  });
  await step('Telefonda oyun: PC\'de geçilen G-2 haritası açılır (senkron), sanal joystick görünür', async () => {
    await phone.goto(`${WEB}/oyna`);
    await singleCanvas(phone);
    await phone.locator('.hud-minimap-title').getByText(/^G-2 · /).waitFor();
    await phone.getByTestId('joystick').waitFor();
    await phone.getByText('Daha geniş görüş için telefonu yan çevir').waitFor();
    await sleep(900);
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '07-mobil-dikey-joystick.jpg') });
  });
  await step('Telefonda joystick sağa çekilince gemi sağa gider ve sunucuya kaydedilir', async () => {
    const a = await coords(phone);
    const box = await phone.getByTestId('joystick').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await phone.mouse.move(cx, cy);
    await phone.mouse.down();
    await phone.mouse.move(cx + box.width / 2, cy, { steps: 5 });
    await sleep(2000);
    await phone.mouse.up();
    await sleep(1600);
    const b = await coords(phone);
    if (!(b.x > a.x + 150)) throw new Error(`x artmadı: ${a.x} → ${b.x}`);
    const d = await dbPos();
    if (Math.abs(d.pos_x - b.x) > 60) throw new Error(`sunucu konumu farklı: db ${d.pos_x}, hud ${b.x}; istekler: ${worldNet.phone.slice(-8).join(', ')}`);
  });
  await step('Telefon yatay: oyun ekranı yatay düzende açılır (aynı oturum)', async () => {
    const land = await browser.newContext({ ...playwright.devices['iPhone 13 landscape'], locale: 'tr-TR', storageState: await iphone.storageState() });
    const lp = await land.newPage();
    lp.on('pageerror', (e) => pageErrors.push(`landscape: ${e.message}`));
    await lp.goto(`${WEB}/oyna`);
    await lp.locator('.hud-minimap-title').getByText(/^G-2 · /).waitFor();
    await lp.getByTestId('joystick').waitFor();
    await sleep(900);
    await lp.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '08-mobil-yatay.jpg') });
    await land.close();
  });
  await step('Telefonda ayarlar: dokunmatik sekmeleri ve joystick ayarları (telefon sınıfı ayrı saklanır)', async () => {
    await phone.goto(`${WEB}/oyna`);
    await phone.getByTestId('joystick').waitFor();
    await phone.getByRole('button', { name: 'Ayarlar', exact: true }).click();
    const dlg = phone.getByRole('dialog', { name: 'Oyun ayarları' });
    await dlg.getByText('(telefon)').waitFor();
    await dlg.getByLabel('Joystick tarafı').selectOption('right');
    await dlg.getByRole('button', { name: 'Grafik' }).click();
    await dlg.getByLabel('FPS göstergesi').check();
    await dlg.getByRole('button', { name: 'Kaydet' }).click();
    await dlg.getByText('Kaydedildi.', { exact: false }).waitFor();
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '09-mobil-ayarlar.jpg') });
    const r = await db.query(`SELECT device_class, settings->'controls'->>'joystickSide' AS side FROM player_settings ORDER BY device_class`);
    const rows = Object.fromEntries(r.rows.map((x) => [x.device_class, x.side]));
    if (rows.phone !== 'right' || rows.desktop !== 'left') throw new Error(`cihaz sınıfı ayarları karıştı: ${JSON.stringify(rows)}`);
    await dlg.getByRole('button', { name: 'Kapat' }).click();
    const box = await phone.getByTestId('joystick').boundingBox();
    if (box.x < 390 / 2) throw new Error('joystick sağa geçmedi');
    await sleep(2500);
    fpsReadings.phone = await phone.getByTestId('hud-fps').innerText();
  });
  await step('Oyun ekranlarında JavaScript hatası oluşmadı', async () => {
    if (pageErrors.length) throw new Error(pageErrors.join(' | '));
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
  if (Object.keys(fpsReadings).length) console.log(`\nBaşsız (yazılımsal çizim) FPS ölçümü: ${JSON.stringify(fpsReadings)}`);
  await browser?.close();
  await db?.end().catch(() => {});
  for (const p of procs) p.kill('SIGTERM');
  smtp.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSonuç: ${results.length - failed}/${results.length} adım başarılı. Ekran görüntüleri: ${path.relative(ROOT, SHOTS)}, ${path.relative(ROOT, SHOTS5)}, ${path.relative(ROOT, SHOTS6)}, ${path.relative(ROOT, SHOTS7)}`);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
