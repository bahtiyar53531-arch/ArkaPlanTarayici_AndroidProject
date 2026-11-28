#!/usr/bin/env node
/**
 * TÜRK ORBIT — Aşama 1, 5, 6, 7, 8 ve 9 arayüz (tarayıcı) uçtan uca testi
 *
 * Gerçek API + Vite istemcisi + SMTP alıcısı başlatır, Chromium ile masaüstü ve iPhone görünümünde
 * kayıt → e-posta bağlantısı → giriş → hesap güvenliği → cihazlar arası oturum kapatma akışını dener
 * ve ekran görüntülerini Documentation/DevelopmentNotes/ekran-goruntuleri/asama-01 altına kaydeder.
 *
 * Gereksinim: Playwright (npm i -D playwright && npx playwright install chromium), PostgreSQL, Redis.
 * Kullanım:  npm run test:ui
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
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
const SHOTS8 = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-08');
const SHOTS9 = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-09');
const SHOTS10 = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-10');
const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgres://turkorbit:turkorbit_dev@127.0.0.1:5432/turkorbit_e2e';
const REDIS_URL = process.env.UI_E2E_REDIS_URL ?? 'redis://127.0.0.1:6379/13';
const API_PORT = 4101;
const WEB_PORT = 5174;
const SMTP_PORT = 2526;
const GAME_PORT = 4102;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
mkdirSync(SHOTS, { recursive: true });
mkdirSync(SHOTS5, { recursive: true });
mkdirSync(SHOTS6, { recursive: true });
mkdirSync(SHOTS7, { recursive: true });
mkdirSync(SHOTS8, { recursive: true });
mkdirSync(SHOTS9, { recursive: true });
mkdirSync(SHOTS10, { recursive: true });

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
  GAME_PORT: String(GAME_PORT),
  // Testte bağlantısı kopan gemi hemen kaldırılır (veritabanından konum yerleştirme adımları için)
  GAME_LINGER_SECONDS: '0',
  VITE_GAME_PROXY: `ws://127.0.0.1:${GAME_PORT}`,
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
let gameProc = null;
let startGame = async () => {};
let browser;
let db;
const fpsReadings = {};
try {
  console.log('TÜRK ORBIT — arayüz testi (Aşama 1, 5, 6, 7, 8, 9, 10)\n');
  await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  const tsx = path.join(ROOT, 'node_modules/.bin/tsx');
  const mig = spawnSync(tsx, ['apps/api/src/scripts/migrate.ts'], { cwd: ROOT, env, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error(mig.stderr);
  spawnSync('redis-cli', ['-u', REDIS_URL, 'FLUSHDB']);
  // Önceki adımlar NPC'siz haritalarda; savaş adımları için G-1'e iki test NPC'si (zayıf pasif + güçlü saldırgan)
  {
    const s = new pg.Client({ connectionString: DB_URL });
    await s.connect();
    await s.query(`UPDATE npc_spawns SET is_enabled = false`);
    await s.query(`INSERT INTO reward_tables (code, name) VALUES ('npc.test-cakal', 'Eğitim'), ('npc.test-akrep', 'Eğitim')`);
    await s.query(
      `INSERT INTO npc_types (code, name, family, level, sprite_key, scale, color_hex, hitpoints, shield, shield_absorb, damage, attack_rate_ms, attack_range, speed, ai, experience, reward_table_id) VALUES
       ('test-cakal', 'Eğitim Çakalı', 'cakal', 1, 'npc-cakal', 0.9, '#E0A93B', 120, 0, 0, 0, 1000, 450, 200, '{"behavior":"passive","patrol_radius":1}', 6000, (SELECT id FROM reward_tables WHERE code = 'npc.test-cakal')),
       ('test-akrep', 'Kızgın Akrep', 'akrep', 3, 'npc-akrep', 1.3, '#E0533D', 99999, 0, 0, 6000, 1000, 600, 300, '{"behavior":"aggressive","aggro_range":800,"patrol_radius":1}', 0, (SELECT id FROM reward_tables WHERE code = 'npc.test-akrep'))`,
    );
    await s.query(
      `INSERT INTO reward_entries (reward_table_id, reward_type, ref_code, min_amount, max_amount, chance, delivery) VALUES
       ((SELECT id FROM reward_tables WHERE code = 'npc.test-cakal'), 'currency', 'KREDI', 500, 500, 1, 'direct'),
       ((SELECT id FROM reward_tables WHERE code = 'npc.test-cakal'), 'item', 'ammo.isk1', 30, 30, 1, 'cargo')`,
    );
    await s.query(
      `INSERT INTO npc_spawns (map_id, npc_type_id, area, max_alive, respawn_seconds) VALUES
       ((SELECT id FROM maps WHERE code = 'G-1'), (SELECT id FROM npc_types WHERE code = 'test-cakal'), '{"type":"circle","x":14000,"y":4000,"r":1}', 1, 600),
       ((SELECT id FROM maps WHERE code = 'G-1'), (SELECT id FROM npc_types WHERE code = 'test-akrep'), '{"type":"circle","x":6000,"y":9000,"r":1}', 1, 600)`,
    );
    // Aşama 10: görev adımları için G-1'de bir Eğitim Kurdu ve "Eğitim Avı" görevi
    await s.query(`INSERT INTO reward_tables (code, name) VALUES ('npc.test-ui-kurt', 'Eğitim'), ('quest.test-ui-av', 'Görev: Eğitim Avı')`);
    await s.query(
      `INSERT INTO npc_types (code, name, family, level, sprite_key, scale, color_hex, hitpoints, shield, shield_absorb, damage, attack_rate_ms, attack_range, speed, ai, experience, reward_table_id) VALUES
       ('test-ui-kurt', 'Eğitim Kurdu', 'cakal', 1, 'npc-cakal', 0.9, '#E0A93B', 120, 0, 0, 0, 1000, 450, 200, '{"behavior":"passive","patrol_radius":1}', 100, (SELECT id FROM reward_tables WHERE code = 'npc.test-ui-kurt'))`,
    );
    await s.query(
      `INSERT INTO npc_spawns (map_id, npc_type_id, area, max_alive, respawn_seconds) VALUES
       ((SELECT id FROM maps WHERE code = 'G-1'), (SELECT id FROM npc_types WHERE code = 'test-ui-kurt'), '{"type":"circle","x":13600,"y":5300,"r":1}', 1, 600)`,
    );
    await s.query(
      `INSERT INTO reward_entries (reward_table_id, reward_type, ref_code, min_amount, max_amount, chance) VALUES
       ((SELECT id FROM reward_tables WHERE code = 'quest.test-ui-av'), 'experience', 'XP', 500, 500, 1),
       ((SELECT id FROM reward_tables WHERE code = 'quest.test-ui-av'), 'currency', 'KREDI', 1000, 1000, 1)`,
    );
    await s.query(
      `INSERT INTO quests (code, category, title, description, reward_table_id, sort_order)
       VALUES ('test-ui-av', 'main', 'Eğitim Avı', 'Görev panelinden kabul et ve bir Eğitim Kurdu avla.', (SELECT id FROM reward_tables WHERE code = 'quest.test-ui-av'), 0)`,
    );
    await s.query(
      `INSERT INTO quest_objectives (quest_id, sort_order, objective_type, params, target, label)
       VALUES ((SELECT id FROM quests WHERE code = 'test-ui-av'), 1, 'kill_npc', '{"family":["cakal"],"maps":["{c}-1"]}', 1, 'Çakal ailesinden NPC yok et ({c}-1)')`,
    );
    await s.end();
  }
  procs.push(spawn(tsx, ['apps/api/src/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] }));
  procs.push(
    spawn(path.join(ROOT, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], {
      cwd: path.join(ROOT, 'apps/client'),
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
    }),
  );
  // Oyun sunucusu günlüğü (hata ayıklama için): test-results/ui-e2e-game.log
  mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
  const gameLog = openSync(path.join(ROOT, 'test-results/ui-e2e-game.log'), 'w');
  startGame = async () => {
    gameProc = spawn(tsx, ['apps/api/src/game/index.ts'], { cwd: ROOT, env: { ...env, LOG_LEVEL: 'info' }, stdio: ['ignore', gameLog, gameLog] });
    gameProc.on('exit', (code, signal) => console.log(`      [oyun sunucusu süreci çıktı: kod ${code}, sinyal ${signal}]`));
    procs.push(gameProc);
    await waitHttp(`http://127.0.0.1:${GAME_PORT}/health`);
  };
  await startGame();
  await waitHttp(`http://127.0.0.1:${API_PORT}/api/v1/health`);
  await waitHttp(WEB);

  browser = await playwright.chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: 'tr-TR' });
  const iphone = await browser.newContext({ ...playwright.devices['iPhone 13'], locale: 'tr-TR' });
  const pc = await desktop.newPage();
  const phone = await iphone.newPage();
  const pageErrors = [];
  for (const [name, pg_] of [['pc', pc], ['phone', phone]]) pg_.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const coords = async (page) => {
    const t = await page.getByTestId('hud-coords').innerText();
    const [x, y] = t.split('/').map((v) => Number(v.trim()));
    return { x, y };
  };
  const dbPos = async (username = 'AnadoluKartali') =>
    (await db.query(`SELECT p.id, p.pos_x, p.pos_y, m.code FROM players p JOIN maps m ON m.id = p.map_id JOIN users u ON u.id = p.user_id WHERE u.username = $1`, [username])).rows[0];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Oyun sunucusu konumu toplu (5 sn) kaydeder: veritabanı HUD'a yaklaşana kadar bekler. */
  const waitDbX = async (username, x, tol = 60, ms = 9000) => {
    const end = Date.now() + ms;
    let d;
    while (Date.now() < end) {
      d = await dbPos(username);
      if (Math.abs(d.pos_x - x) <= tol) return d;
      await sleep(300);
    }
    throw new Error(`sunucu konumu HUD ile eşleşmedi: db ${d?.pos_x}, hud ${x}`);
  };
  /** Pilot oyundan çıkınca (sunucu kaydı bitince) çevrimiçi kaydı silinir. */
  const waitOffline = async (username) => {
    const { id } = await dbPos(username);
    for (let i = 0; i < 50; i++) {
      if (spawnSync('redis-cli', ['-u', REDIS_URL, 'EXISTS', `game:presence:${id}`], { encoding: 'utf8' }).stdout.trim() === '0') return;
      await sleep(100);
    }
    throw new Error('pilot oyundan çıkmadı');
  };
  /** Sunucu otoriter olduğu için konum yalnızca pilot oyun dışındayken veritabanından yerleştirilir. */
  const teleport = async (page, username, x, y, mapCode) => {
    await page.goto(`${WEB}/hangar`);
    await page.getByRole('heading', { name: 'Hangar' }).waitFor();
    await waitOffline(username);
    await db.query(
      `UPDATE players SET pos_x = $2, pos_y = $3 ${mapCode ? `, map_id = (SELECT id FROM maps WHERE code = '${mapCode}')` : ''}
       FROM users u WHERE u.id = players.user_id AND u.username = $1`,
      [username, x, y],
    );
    await page.goto(`${WEB}/oyna`);
    await page.locator('.hud-minimap-title').waitFor();
  };
  const nearbyDistance = async (page, name) => {
    const row = page.getByTestId('nearby').locator('.hud-nearby-row').filter({ hasText: name });
    if ((await row.count()) === 0) return null;
    return Number((await row.locator('.hud-nearby-dist').innerText()).replace(/\./g, ''));
  };
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

  console.log('Aşama 7 — harita ve oyun motoru (masaüstü, sunucu otoriteli hareket)');
  await step('Oyna: oyun sunucusuna bağlanır; tuval ve HUD açılır (pilot, can/kalkan, G-1 mini harita, güvenli bölge, ping)', async () => {
    await pc.getByRole('link', { name: 'Oyna', exact: true }).click();
    await pc.waitForURL(/\/oyna$/);
    await singleCanvas(pc);
    await pc.locator('.hud-pilot').getByText(A.username).waitFor();
    await pc.locator('.hud-minimap-title').getByText('G-1 · Gökbörü Üssü').waitFor();
    await pc.locator('.hud-pilot').getByText('Güvenli').waitFor();
    await pc.getByTestId('hud-ping').waitFor({ timeout: 6000 });
    await sleep(900); // kamera açılış geçişi
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '01-oyun-g1-istasyon.jpg') });
  });
  await step('Klavye: D basılı tutulunca gemi sağa gider; konumu sunucu hesaplar ve kaydeder', async () => {
    const a = await coords(pc);
    await pc.keyboard.down('KeyD');
    await sleep(2200);
    await pc.keyboard.up('KeyD');
    await sleep(800);
    const b = await coords(pc);
    if (!(b.x > a.x + 150)) throw new Error(`x artmadı: ${a.x} → ${b.x}`);
    if (Math.abs(b.y - a.y) > 30) throw new Error(`y değişmemeliydi: ${a.y} → ${b.y}`);
    await waitDbX(A.username, b.x);
  });
  await step('Tıkla-git: ekranın üst tarafına tıklanınca gemi yukarı yönelir', async () => {
    const a = await coords(pc);
    await pc.mouse.click(640, 200);
    await sleep(1800);
    const b = await coords(pc);
    if (!(b.y < a.y - 100)) throw new Error(`y azalmadı: ${a.y} → ${b.y}`);
  });
  await step('Kilitli geçit: seviye 5 isteyen G-4 geçidinde "Atla" pasif ve sebep Türkçe yazılı', async () => {
    await teleport(pc, A.username, 10000, 10950);
    const prompt = pc.locator('.hud-portal');
    await prompt.getByText('G-4').waitFor();
    await prompt.getByText(/seviye 5/i).waitFor();
    if (!(await prompt.getByRole('button').isDisabled())) throw new Error('kilitli geçitte buton aktif');
    await sleep(700);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '02-kilitli-gecit.jpg') });
  });
  await step('Geçit: G-2 geçidinin yanında J tuşu ile atlanır → G-2 yüklenir, geçiş sunucuda kayıtlı', async () => {
    await teleport(pc, A.username, 18250, 6250);
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
    await sleep(900);
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

  console.log('Aşama 8 — çok oyunculu (iki pilot, iki tarayıcı)');
  const B = { username: 'BozkirKurdu', email: 'bozkir.kurdu@ornek.com', password: 'Ergenekon_Destani_552' };
  const desktop2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: 'tr-TR' });
  const pc2 = await desktop2.newPage();
  pc2.on('pageerror', (e) => pageErrors.push(`pc2: ${e.message}`));
  await step('İkinci oyuncu (B) kayıt olur, e-postasını doğrular ve Gökbörü pilotu oluşturur', async () => {
    await pc2.goto(`${WEB}/kayit`);
    await pc2.getByLabel('Kullanıcı adı (pilot adı)').fill(B.username);
    await pc2.getByLabel('E-posta').fill(B.email);
    await pc2.getByLabel('Parola', { exact: true }).fill(B.password);
    await pc2.getByLabel('Parola (tekrar)').fill(B.password);
    await pc2.getByRole('checkbox').check();
    await pc2.getByRole('button', { name: 'Kayıt ol' }).click();
    await pc2.getByRole('heading', { name: 'E-postanı kontrol et' }).waitFor();
    await pc2.goto(await linkFor(B.email, 'doğrula'));
    await pc2.getByText('E-posta adresin doğrulandı').waitFor();
    await pc2.goto(`${WEB}/giris`);
    await pc2.getByLabel('Kullanıcı adı veya e-posta').fill(B.username);
    await pc2.getByLabel('Parola', { exact: true }).fill(B.password);
    await pc2.getByRole('button', { name: 'Giriş yap' }).click();
    await pc2.getByRole('heading', { name: 'Pilotunu oluştur' }).waitFor();
    await pc2.getByText('Gökbörü Filosu', { exact: true }).click();
    await pc2.getByRole('button', { name: 'Pilotu oluştur' }).click();
    await pc2.getByRole('heading', { name: B.username }).waitFor();
  });
  await step('A ve B aynı haritada birbirini görür: gemi, ad etiketi ve radar listesi (sunucu AOI)', async () => {
    const a = await coords(pc);
    await db.query(
      `UPDATE players SET pos_x = $2, pos_y = $3, map_id = (SELECT id FROM maps WHERE code = 'G-2')
       FROM users u WHERE u.id = players.user_id AND u.username = $1`,
      [B.username, a.x + 500, a.y],
    );
    await pc2.goto(`${WEB}/oyna`);
    await singleCanvas(pc2);
    await pc2.locator('.hud-minimap-title').getByText(/^G-2 · /).waitFor();
    await pc.getByTestId('nearby').getByText(B.username).waitFor({ timeout: 8000 });
    await pc2.getByTestId('nearby').getByText(A.username).waitFor({ timeout: 8000 });
    const d = await nearbyDistance(pc, B.username);
    if (!(d > 400 && d < 600)) throw new Error(`A-B mesafesi ~500 bekleniyordu: ${d}`);
    await sleep(800);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS8, '01-a-b-pilotunu-goruyor.jpg') });
    await pc2.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS8, '02-b-a-pilotunu-goruyor.jpg') });
  });
  await step('B hareket eder → A\'nın ekranında anlık güncellenir (10 Hz anlık görüntü + enterpolasyon)', async () => {
    const d0 = await nearbyDistance(pc, B.username);
    await pc2.keyboard.down('KeyD');
    await sleep(2000);
    const d1 = await nearbyDistance(pc, B.username);
    if (!(d1 > d0 + 300)) throw new Error(`A'nın gördüğü mesafe artmadı: ${d0} → ${d1}`);
  });
  await step('B radar menzilinden çıkınca A\'nın listesinden ve haritasından düşer (sunucu artık göndermez)', async () => {
    await pc.getByTestId('nearby').getByText('menzilde pilot yok').waitFor({ timeout: 8000 });
    await pc2.keyboard.up('KeyD');
    const b = await coords(pc2);
    const a = await coords(pc);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1500) throw new Error('B hâlâ radar menzilinde');
  });
  await step('Oyun sunucusu yeniden başlatılır → iki istemci de "yeniden bağlanılıyor" gösterir ve kendiliğinden bağlanır', async () => {
    gameProc.kill('SIGTERM');
    try {
      await pc.getByTestId('conn-banner').waitFor({ timeout: 8000 });
      await pc2.getByTestId('conn-banner').waitFor({ timeout: 8000 });
      await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS8, '03-yeniden-baglaniyor.jpg') });
    } finally {
      // Bu adım başarısız olsa bile sonraki adımlar için oyun sunucusu yeniden başlatılır (zincirleme hata olmaz)
      await startGame();
    }
    await pc.getByTestId('conn-banner').waitFor({ state: 'detached', timeout: 25000 });
    await pc2.getByTestId('conn-banner').waitFor({ state: 'detached', timeout: 25000 });
    await pc.getByText('Yeniden bağlandın.').waitFor();
    await pc.locator('.hud-minimap-title').getByText(/^G-2 · /).waitFor();
  });
  await desktop2.close();

  console.log('Aşama 9 — NPC ve savaş (masaüstü)');
  await step('NPC radar menzilinde görünür; Tab ile hedeflenir; hedef paneli adını ve canını gösterir', async () => {
    await teleport(pc, A.username, 13600, 4000, 'G-1');
    await pc.getByTestId('action-bar').waitFor();
    await sleep(1000);
    await pc.keyboard.press('Tab');
    const panel = pc.getByTestId('target-panel');
    await panel.getByText('Eğitim Çakalı').waitFor({ timeout: 6000 });
    await panel.getByText('%100').first().waitFor();
  });
  await step('Boşluk ile ateş: lazer ve hasar sayıları; NPC yok edilir; ödül (deneyim + Kredi) ve seviye atlama bildirilir, defterde kayıtlı', async () => {
    await pc.keyboard.press('Space');
    await pc.getByTestId('attack-button').getByText('Ateşi kes').waitFor({ timeout: 3000 });
    await sleep(600);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS9, '01-npc-savas-lazer.jpg') });
    await pc.getByText(/Eğitim Çakalı yok edildi: \+6\.000 deneyim · \+500 Kredi/).waitFor({ timeout: 10000 });
    await pc.getByText('Seviye atladın! Artık seviye 2.').waitFor({ timeout: 6000 });
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS9, '02-odul-seviye-kargo.jpg') });
    const l = await db.query(
      `SELECT l.delta FROM currency_ledger l JOIN players p ON p.id = l.player_id JOIN users u ON u.id = p.user_id
       WHERE u.username = $1 AND l.reason = 'npc_reward'`,
      [A.username],
    );
    if (l.rows.length !== 1 || Number(l.rows[0].delta) !== 500) throw new Error(`ödül defteri: ${JSON.stringify(l.rows)}`);
  });
  await step('Kargo kutusu: tıklayınca gemi gider ve toplar; IŞK-1 sayısı 30 artar (harcanan atışlar düşülmüş olarak)', async () => {
    const count = async () => Number((await pc.getByTestId('action-bar').locator('.hud-slot-count').first().innerText()).replace(/\./g, ''));
    const before = await count();
    if (!(before < 2000 && before >= 1994)) throw new Error(`atışlar mühimmattan düşülmeliydi: ${before}`);
    await pc.mouse.click(640 + 260, 430);
    await pc.getByText(/Kargo kutusu toplandı: 30 × IŞK-1 Batarya/).waitFor({ timeout: 10000 });
    for (let i = 0; i < 20 && (await count()) !== before + 30; i++) await sleep(200);
    if ((await count()) !== before + 30) throw new Error(`kargo sonrası ${await count()}, beklenen ${before + 30}`);
  });
  await step('Saldırgan NPC pilotu yok eder: ölüm ekranı; "İstasyonda yeniden doğ" ile istasyonda %10 canla devam', async () => {
    await teleport(pc, A.username, 6000, 9650, 'G-1');
    const overlay = pc.getByTestId('death-overlay');
    await overlay.waitFor({ timeout: 10000 });
    await overlay.getByText('Kızgın Akrep tarafından vuruldun.', { exact: false }).waitFor();
    await sleep(700);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS9, '03-olum-ekrani.jpg') });
    await overlay.getByRole('button', { name: 'İstasyonda yeniden doğ' }).click();
    await overlay.waitFor({ state: 'detached', timeout: 10000 });
    await pc.getByTestId('hud-hp').getByText('400 / 4.000').waitFor({ timeout: 6000 });
    const d = await db.query(`SELECT count(*)::int AS n FROM combat_deaths`);
    if (d.rows[0].n !== 1) throw new Error('ölüm kaydı yok');
    await sleep(900);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS9, '04-istasyonda-yeniden-dogus.jpg') });
  });

  console.log('Aşama 10 — görevler (masaüstü)');
  await step('Görev izleyici günlük görevleri gösterir; Q ile görev çekmecesi açılır; zincir görevi kabul edilir', async () => {
    await teleport(pc, A.username, 13600, 5000, 'G-1');
    const tracker = pc.getByTestId('quest-tracker');
    await tracker.waitFor({ timeout: 8000 });
    if ((await tracker.locator('.hud-quest').count()) !== 3) throw new Error('izleyicide 3 görev bekleniyordu');
    await pc.keyboard.press('q');
    const drawer = pc.getByTestId('quest-drawer');
    await drawer.waitFor();
    const card = drawer.getByTestId('quest-test-ui-av');
    await card.getByText('Alınabilir').waitFor();
    await card.getByRole('button', { name: 'Kabul et' }).click();
    await card.getByText('Devam ediyor').waitFor();
    await drawer.getByText('"Eğitim Avı" görev listene eklendi.').waitFor();
    await drawer.getByTestId('quest-buyuk-sicrama-01').waitFor(); // gerçek içerik: Büyük Sıçrama zinciri
    await sleep(400);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS10, '01-gorev-cekmecesi.jpg') });
    await pc.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
    await pc.getByTestId('track-test-ui-av').waitFor({ timeout: 6000 });
  });
  await step('Görev canlı ilerler: NPC yok edilince izleyicide ✔ ve "Görev tamamlandı"; ödül çekmeceden alınır (defterli)', async () => {
    await sleep(800);
    await pc.keyboard.press('Tab');
    await pc.getByTestId('target-panel').getByText('Eğitim Kurdu').waitFor({ timeout: 6000 });
    await pc.keyboard.press('Space');
    await pc.getByText('Görev tamamlandı: Eğitim Avı. Ödülünü görev listesinden al.').waitFor({ timeout: 15000 });
    const tracked = pc.getByTestId('track-test-ui-av');
    await tracked.getByText('Ödülünü al').waitFor({ timeout: 6000 });
    await sleep(300);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS10, '02-gorev-tamamlandi-izleyici.jpg') });
    await tracked.click();
    const drawer = pc.getByTestId('quest-drawer');
    await drawer.getByTestId('quest-test-ui-av').getByRole('button', { name: 'Ödülü al' }).click();
    await drawer.getByText('Ödül alındı: +500 deneyim · +1.000 Kredi').waitFor({ timeout: 6000 });
    await sleep(300);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS10, '03-gorev-odulu-alindi.jpg') });
    const l = await db.query(
      `SELECT l.delta FROM currency_ledger l JOIN players p ON p.id = l.player_id JOIN users u ON u.id = p.user_id
       WHERE u.username = $1 AND l.reason = 'quest_reward'`,
      [A.username],
    );
    if (l.rows.length !== 1 || Number(l.rows[0].delta) !== 1000) throw new Error(`görev ödülü defteri: ${JSON.stringify(l.rows)}`);
    await pc.keyboard.press('Escape');
  });
  await step('Görevler sayfası: sekmeler, günlük yenilenme süresi, etkinlik sekmesi (gerçek tarihle)', async () => {
    await pc.goto(`${WEB}/gorevler`);
    await pc.getByRole('heading', { name: 'Görevler' }).waitFor();
    await pc.getByTestId('quest-tab-daily').click();
    await pc.getByText(/Günlük görevler .+ sonra yenilenir \(05:00 TSİ\)\./).waitFor();
    if ((await pc.getByTestId('quest-list-daily').locator('.quest').count()) !== 3) throw new Error('3 günlük görev bekleniyordu');
    await sleep(300);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS10, '04-gorevler-sayfasi-gunluk.jpg') });
    await pc.getByTestId('quest-tab-event').click();
    const t = Date.now();
    if (t >= Date.parse('2026-11-27T21:00:00Z') && t < Date.parse('2027-01-01T02:00:00Z')) await pc.getByText('Açılış Şenliği: Hoş Geldin').waitFor();
    else await pc.getByTestId('quest-list-event').waitFor();
    await pc.getByTestId('quest-tab-main').click();
    await pc.getByText('Tamamlanan görevler (1)').waitFor();
    // Telefon adımları G-2'de devam eder
    await teleport(pc, A.username, 2200, 6250, 'G-2');
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
  await step('Telefonda oyun: G-2 açılır, joystick görünür; PC\'deki oyun "başka cihaz" uyarısıyla durur (tek aktif oturum)', async () => {
    await phone.goto(`${WEB}/oyna`);
    await singleCanvas(phone);
    await phone.locator('.hud-minimap-title').getByText(/^G-2 · /).waitFor();
    await phone.getByTestId('joystick').waitFor();
    await phone.getByTestId('attack-button').waitFor(); // dokunmatik savaş butonları
    await phone.getByText('Daha geniş görüş için telefonu yan çevir').waitFor();
    const ended = pc.getByTestId('conn-ended');
    await ended.getByText('Başka bir cihazda oyundasın').waitFor({ timeout: 8000 });
    await ended.getByText('Hesabınla başka bir cihazdan oyuna girildi.').waitFor();
    await sleep(900);
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS7, '07-mobil-dikey-joystick.jpg') });
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS8, '04-pc-baska-cihazda-oyundasin.jpg') });
  });
  await step('Telefonda joystick sağa çekilince gemi sağa gider; konumu sunucu kaydeder', async () => {
    const a = await coords(phone);
    const box = await phone.getByTestId('joystick').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await phone.mouse.move(cx, cy);
    await phone.mouse.down();
    await phone.mouse.move(cx + box.width / 2, cy, { steps: 5 });
    await sleep(2000);
    await phone.mouse.up();
    await sleep(800);
    const b = await coords(phone);
    if (!(b.x > a.x + 150)) throw new Error(`x artmadı: ${a.x} → ${b.x}`);
    await waitDbX(A.username, b.x);
  });
  await step('Telefon uzaydayken PC hangarında ekipman değişikliği engellenir ("yalnızca istasyonda")', async () => {
    await pc.goto(`${WEB}/hangar`);
    await pc.getByRole('heading', { name: 'Hangar' }).waitFor();
    await pc.getByRole('button', { name: /Lazer 1: OK-1/ }).click();
    await pc.getByRole('button', { name: 'Çıkar' }).click();
    await pc.getByText('Oyundayken ekipman yalnızca istasyonda değiştirilebilir').first().waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS8, '05-pc-hangar-istasyon-kurali.jpg') });
    await pc.keyboard.press('Escape');
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
  await step('Telefon "Bu cihazda devam et" ile oyunu geri alır; ayarlar (joystick sağda, telefon sınıfı ayrı saklanır)', async () => {
    const ended = phone.getByTestId('conn-ended');
    await ended.waitFor({ timeout: 8000 });
    await ended.getByRole('button', { name: 'Bu cihazda devam et' }).click();
    await ended.waitFor({ state: 'detached', timeout: 8000 });
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
    const r = await db.query(`SELECT device_class, settings->'controls'->>'joystickSide' AS side FROM player_settings WHERE user_id = (SELECT id FROM users WHERE username = $1) ORDER BY device_class`, [A.username]);
    const rows = Object.fromEntries(r.rows.map((x) => [x.device_class, x.side]));
    if (rows.phone !== 'right' || rows.desktop !== 'left') throw new Error(`cihaz sınıfı ayarları karıştı: ${JSON.stringify(rows)}`);
    await dlg.getByRole('button', { name: 'Kapat' }).click();
    const box = await phone.getByTestId('joystick').boundingBox();
    if (box.x < 390 / 2) throw new Error('joystick sağa geçmedi');
    await sleep(2500);
    fpsReadings.phone = await phone.getByTestId('hud-fps').innerText();
  });
  await step('Telefonda görev çekmecesi: 📜 ile açılır; uzun liste kaydırılır', async () => {
    await phone.getByTestId('hud-quests-btn').click();
    const drawer = phone.getByTestId('quest-drawer');
    await drawer.getByTestId('quest-buyuk-sicrama-01').waitFor({ timeout: 8000 });
    const m = await drawer.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, w: el.getBoundingClientRect().width }));
    if (!(m.sh > m.ch + 100)) throw new Error(`liste kaydırılacak kadar uzun değil: ${JSON.stringify(m)}`);
    if (m.w < 380) throw new Error(`çekmece telefonda tam genişlikte değil: ${m.w}`);
    await sleep(300);
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS10, '05-mobil-gorev-cekmecesi.jpg') });
    await drawer.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await sleep(300);
    const top = await drawer.evaluate((el) => el.scrollTop);
    if (top <= 0) throw new Error('çekmece kaydırılamadı');
    const last = drawer.locator('.quest-list').first().locator('.quest').last();
    const box = await last.boundingBox();
    if (!box || box.y + box.height > 844 + 2) throw new Error(`son görev görünmüyor: ${JSON.stringify(box)}`);
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS10, '06-mobil-gorev-cekmecesi-kaydirildi.jpg') });
    await drawer.getByRole('button', { name: 'Kapat (Esc)' }).click();
    await drawer.waitFor({ state: 'detached' });
  });
  await step('PC oyuna dönünce telefon "başka cihaz" uyarısı alır (iki yönde de tek oturum)', async () => {
    await pc.goto(`${WEB}/oyna`);
    await pc.locator('.hud-minimap-title').getByText(/^G-2 · /).waitFor();
    await phone.getByTestId('conn-ended').getByText('Başka bir cihazda oyundasın').waitFor({ timeout: 8000 });
  });
  await step('Telefonda görevler sayfası: sayfa kaydırılır; ödülü alınan görev "Tamamlanan görevler" altında', async () => {
    await phone.goto(`${WEB}/gorevler`);
    await phone.getByRole('heading', { name: 'Görevler' }).waitFor();
    await phone.getByTestId('quest-buyuk-sicrama-01').waitFor();
    const h = await phone.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight }));
    if (!(h.sh > h.ih + 200)) throw new Error(`sayfa kaydırılacak kadar uzun değil: ${JSON.stringify(h)}`);
    const done = phone.getByText('Tamamlanan görevler (1)');
    await done.scrollIntoViewIfNeeded();
    await done.click();
    await phone.getByTestId('quest-test-ui-av').getByText('Tamamlandı').waitFor();
    const y = await phone.evaluate(() => window.scrollY);
    if (y <= 0) throw new Error('sayfa kaydırılmadı');
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS10, '07-mobil-gorevler-sayfasi.jpg'), fullPage: true });
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
  console.log(`\nSonuç: ${results.length - failed}/${results.length} adım başarılı. Ekran görüntüleri: ${path.relative(ROOT, SHOTS)}, ${path.relative(ROOT, SHOTS5)}, ${path.relative(ROOT, SHOTS6)}, ${path.relative(ROOT, SHOTS7)}, ${path.relative(ROOT, SHOTS8)}, ${path.relative(ROOT, SHOTS9)}, ${path.relative(ROOT, SHOTS10)}`);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
