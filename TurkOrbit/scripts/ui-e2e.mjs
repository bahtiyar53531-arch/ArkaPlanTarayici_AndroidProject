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
import os from 'node:os';
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
const SHOTS11 = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-11');
const SHOTS12 = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-12');
const SHOTS13 = path.join(ROOT, 'Documentation/DevelopmentNotes/ekran-goruntuleri/asama-13');
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
mkdirSync(SHOTS11, { recursive: true });
mkdirSync(SHOTS12, { recursive: true });
mkdirSync(SHOTS13, { recursive: true });

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
  // Aşama 13: destek ekleri geçici klasöre
  UPLOAD_DIR: path.join(os.tmpdir(), 'turkorbit-ui-uploads'),
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
  console.log('TÜRK ORBIT — arayüz testi (Aşama 1, 5, 6, 7, 8, 9, 10, 11)\n');
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
    await s.query(`UPDATE resource_nodes SET is_enabled = false`); // madencilik adımları kendi test noktalarını ekler
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
    // Aşama 11: G-1'de test maden noktaları (biri toplanacak, üçü görünecek) ve 2 sn'lik test tarifi
    await s.query(
      `INSERT INTO resource_nodes (map_id, item_type_id, area, max_count, respawn_seconds, yield_min, yield_max) VALUES
       ((SELECT id FROM maps WHERE code = 'G-1'), (SELECT id FROM item_types WHERE code = 'res.titanyum'), '{"type":"circle","x":13600,"y":5700,"r":1}', 1, 600, 30, 30),
       ((SELECT id FROM maps WHERE code = 'G-1'), (SELECT id FROM item_types WHERE code = 'res.kuvarsit'), '{"type":"circle","x":13950,"y":5650,"r":140}', 3, 600, 5, 5)`,
    );
    await s.query(
      `INSERT INTO crafting_recipes (code, name, category, output_item_type_id, output_quantity, inputs, duration_seconds, sort_order)
       VALUES ('test-ui-tarif', 'Eğitim Roketi', 'craft', (SELECT id FROM item_types WHERE code = 'rocket.yildirim'), 10, '[{"item":"res.titanyum","qty":5},{"currency":"KREDI","qty":10}]', 2, 0)`,
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
    await pc.getByRole('tab', { name: 'Gemiler' }).click(); // Aşama 11: mağaza "Paketler" ile açılır
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

  console.log('Aşama 11 — Pazar ve madencilik (masaüstü)');
  await step('Madencilik: maden noktasına gelen gemi kaynağı toplar; "Kaynak toplandı" bildirimi ve ambar göstergesi', async () => {
    await teleport(pc, A.username, 13600, 5650, 'G-1');
    await pc.getByText(/Kaynak toplandı: 30 × Titanyum Tozu/).waitFor({ timeout: 10000 });
    await pc.getByTestId('hud-cargo').getByText(/^Ambar 30 \//).waitFor({ timeout: 6000 });
    await sleep(600);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS11, '01-madencilik-ambar.jpg') });
    const l = await db.query(
      `SELECT l.delta FROM item_ledger l JOIN players p ON p.id = l.player_id JOIN users u ON u.id = p.user_id WHERE u.username = $1 AND l.reason = 'mining'`,
      [A.username],
    );
    if (l.rows.length !== 1 || Number(l.rows[0].delta) !== 30) throw new Error(`madencilik defteri: ${JSON.stringify(l.rows)}`);
  });
  await step('Pazar: günlük ödül alınır; takvimde 1. gün işaretlenir', async () => {
    await pc.goto(`${WEB}/pazar`);
    await pc.getByRole('heading', { name: 'Pazar' }).waitFor();
    const panel = pc.getByTestId('daily-panel');
    await panel.getByRole('button', { name: '1. gün ödülünü al' }).click();
    await panel.getByText('1. gün ödülü alındı: 2.000 Kredi').waitFor();
    await panel.getByText('Bugünün ödülü alındı').waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS11, '02-gunluk-odul.jpg') });
  });
  await step('Pazar > Kaynaklar: Titanyum Tozu satılır; ambar azalır', async () => {
    await pc.getByTestId('market-tab-resources').click();
    const card = pc.getByTestId('resource-res.titanyum');
    await card.getByText('Elinde: 30', { exact: false }).waitFor();
    await card.getByLabel('Titanyum Tozu satış miktarı').fill('10');
    await card.getByRole('button', { name: /^Sat/ }).click();
    await pc.getByText('10 Titanyum Tozu satıldı: +140 Kredi').waitFor();
    await pc.getByTestId('cargo-badge').getByText(/^Ambar 20 \//).waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS11, '03-kaynaklar-satis.jpg') });
  });
  await step('Pazar > Üretim: tarif başlatılır (girdi düşer), süre dolunca "Teslim al" ile ürün envantere girer', async () => {
    await pc.getByTestId('market-tab-crafting').click();
    await pc.getByTestId('recipe-test-ui-tarif').getByRole('button', { name: 'Üret' }).click();
    await pc.getByText('Eğitim Roketi üretimi başladı (1 adet).').waitFor();
    const job = pc.getByTestId('job-test-ui-tarif');
    await job.waitFor();
    await job.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS11, '04-uretim-kuyrugu.jpg') });
    await job.getByRole('button', { name: 'Teslim al' }).click({ timeout: 8000 });
    await pc.getByText('Teslim alındı: 10 × Yıldırım R-1').waitFor();
  });
  await step('Pazar > Açık artırma: teklif verilir; tutar emanete alınır; en yüksek teklif sende', async () => {
    await pc.getByTestId('market-tab-auctions').click();
    const card = pc.getByTestId('auction-res.nebulit-hourly');
    await card.getByRole('button', { name: 'Teklif ver (en az 4.000)' }).click();
    await pc.getByText(/Nebulit için 4\.000 Kredi teklif verdin/).waitFor();
    await card.getByText('En yüksek teklif senin').waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS11, '05-acik-artirma.jpg') });
    const l = await db.query(
      `SELECT l.delta FROM currency_ledger l JOIN players p ON p.id = l.player_id JOIN users u ON u.id = p.user_id WHERE u.username = $1 AND l.reason = 'auction_bid'`,
      [A.username],
    );
    if (l.rows.length !== 1 || Number(l.rows[0].delta) !== -4000) throw new Error(`teklif defteri: ${JSON.stringify(l.rows)}`);
  });
  await step('Mağaza: Paketler kategorisi en başta; indirimli Acemi Pilot Paketi satın alınır', async () => {
    await pc.goto(`${WEB}/magaza`);
    const card = pc.locator('.offer').filter({ hasText: 'Acemi Pilot Paketi' });
    await card.getByText('-%40').waitFor();
    await card.getByText('3.000 × IŞK-1 Batarya').waitFor();
    await card.scrollIntoViewIfNeeded();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS11, '06-magaza-paket.jpg') });
    await card.getByRole('button', { name: 'Satın al' }).click();
    await card.getByRole('button', { name: 'Onayla' }).click();
    await pc.getByText(/Acemi Pilot Paketi satın alındı \(300 Akçe\)/).waitFor();
    // Telefon adımları G-2'de devam eder
    await teleport(pc, A.username, 2200, 6250, 'G-2');
  });

  console.log('Aşama 12 — Klan ve sosyal (iki masaüstü)');
  const desktopB = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: 'tr-TR' });
  const pcB = await desktopB.newPage();
  pcB.on('pageerror', (e) => pageErrors.push(`pcB: ${e.message}`));
  await step('Klan: A (seviye 5) Klan sayfasından klanı kurar; ücret düşer; Lider rütbesi ve klan bilgileri görünür', async () => {
    // Test hazırlığı: seviye 5 ve kuruluş ücreti (gerçek oyunda NPC/görevle kazanılır)
    await db.query(`UPDATE players SET experience = 139300 FROM users u WHERE u.id = players.user_id AND u.username = $1`, [A.username]);
    await db.query(
      `UPDATE wallets SET balance = 100000 FROM players p JOIN users u ON u.id = p.user_id WHERE wallets.player_id = p.id AND u.username = $1 AND wallets.currency_code = 'KREDI'`,
      [A.username],
    );
    await pc.goto(`${WEB}/klan`);
    await pc.getByRole('heading', { name: 'Klan', exact: true }).waitFor();
    await pc.getByTestId('clan-tag-input').fill('akn');
    await pc.getByTestId('clan-name-input').fill('Akıncılar');
    await pc.getByTestId('clan-create-btn').click();
    await pc.getByText('Klanın kuruldu!').waitFor();
    const head = pc.getByTestId('my-clan');
    await head.getByText('[AKN]').waitFor();
    await head.getByText('Rütben: Lider').waitFor();
    const l = await db.query(`SELECT delta FROM currency_ledger WHERE reason = 'clan_create'`);
    if (l.rows.length !== 1 || Number(l.rows[0].delta) !== -50000) throw new Error(`klan ücreti defteri: ${JSON.stringify(l.rows)}`);
  });
  await step('B giriş yapar, klanı arar ve başvurur; A\'nın bildirim zilinde başvuru görünür; A kabul eder', async () => {
    await pcB.goto(`${WEB}/giris`);
    await pcB.getByLabel('Kullanıcı adı veya e-posta').fill(B.username);
    await pcB.getByLabel('Parola', { exact: true }).fill(B.password);
    await pcB.getByRole('button', { name: 'Giriş yap' }).click();
    await pcB.getByRole('heading', { name: B.username }).waitFor();
    await pcB.goto(`${WEB}/klan`);
    const row = pcB.getByTestId('clan-row-AKN');
    await row.getByLabel('AKN başvuru mesajı').fill('Bozkırdan selam, katılmak isterim.');
    await row.getByRole('button', { name: 'Başvur' }).click();
    await pcB.getByText('[AKN] klanına başvurdun.', { exact: false }).waitFor();
    await pc.reload();
    await pc.getByTestId('notif-count').waitFor({ timeout: 8000 });
    await pc.getByTestId('notif-bell').click();
    await pc.getByTestId('notif-panel').getByText(`${B.username} (Sv 1) klana katılmak istiyor.`).waitFor();
    await sleep(300);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '01-bildirim-zili.jpg') });
    await pc.getByTestId('notif-bell').click();
    await pc.getByTestId('clan-tab-applications').click();
    await pc.getByText('“Bozkırdan selam, katılmak isterim.”').waitFor();
    await pc.getByTestId('clan-applications').getByRole('button', { name: 'Kabul et' }).click();
    await pc.getByText(`${B.username} klana katıldı.`).waitFor();
    await pc.getByTestId('clan-tab-members').click();
    await pc.getByTestId(`member-${B.username}`).waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '02-klan-uyeler.jpg') });
  });
  await step('Sosyal: A arkadaşlık isteği gönderir; B Sosyal sayfasında kabul eder; arkadaş listesinde klan etiketi', async () => {
    await pc.goto(`${WEB}/sosyal`);
    await pc.getByTestId('friend-name').fill(B.username);
    await pc.getByRole('button', { name: 'Arkadaş ekle' }).click();
    await pc.getByText(`${B.username} adlı pilota arkadaşlık isteği gönderildi.`).waitFor();
    await pcB.goto(`${WEB}/sosyal`);
    await pcB.getByTestId('social-tab-requests').click();
    await pcB.getByTestId(`accept-${A.username}`).click();
    await pcB.getByText(`${A.username} artık arkadaşın.`).waitFor();
    await pc.reload();
    const f = pc.getByTestId(`friend-${B.username}`);
    await f.getByText('[AKN]').waitFor();
    await f.getByText('Çevrimdışı').waitFor();
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '03-sosyal-arkadaslar.jpg') });
  });
  await step('Oyunda sohbet: Enter ile yazılır; B genel ve klan mesajını alır; B ada tıklayıp özel mesaj gönderir', async () => {
    await teleport(pc, A.username, 2200, 6250, 'G-2');
    await waitOffline(B.username);
    await db.query(
      `UPDATE players SET pos_x = 2600, pos_y = 6300, map_id = (SELECT id FROM maps WHERE code = 'G-2') FROM users u WHERE u.id = players.user_id AND u.username = $1`,
      [B.username],
    );
    await pcB.goto(`${WEB}/oyna`);
    await singleCanvas(pcB);
    await pcB.locator('.hud-minimap-title').getByText(/^G-2 · /).waitFor();
    await pc.getByTestId('nearby').getByText(B.username).waitFor({ timeout: 8000 });
    await pc.keyboard.press('Enter');
    await pc.getByTestId('chat-input').waitFor();
    if (!(await pc.getByTestId('chat-input').evaluate((el) => el === document.activeElement))) throw new Error('Enter sohbet alanına odaklamadı');
    await pc.keyboard.type('Selam Gökbörü!');
    await pc.keyboard.press('Enter');
    await pcB.getByTestId('chat-log').getByText('Selam Gökbörü!').waitFor({ timeout: 8000 });
    await pc.getByTestId('chat-tab-clan').click();
    await pc.getByTestId('chat-input').fill('Klan toplantısı 21:00');
    await pc.getByTestId('chat-send').click();
    await pcB.getByTestId('chat-log').getByText('Klan toplantısı 21:00').waitFor();
    // B, A'nın adına tıklar → menüden özel mesaj
    await pcB.getByTestId('chat-log').getByRole('button', { name: `[AKN] ${A.username}` }).first().click();
    await pcB.getByTestId('pilot-menu').getByRole('menuitem', { name: 'Özel mesaj' }).click();
    if ((await pcB.getByTestId('chat-to').inputValue()) !== A.username) throw new Error('özel mesaj alıcısı dolmadı');
    await pcB.getByTestId('chat-input').fill('Sana özel bir mesaj');
    await pcB.getByTestId('chat-send').click();
    await pc.getByTestId('chat-tab-all').click();
    await pc.getByTestId('chat-log').getByText('Sana özel bir mesaj').waitFor();
    await sleep(500);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '04-oyun-sohbet.jpg') });
    const r = await db.query(`SELECT split_part(channel, ':', 1) AS ch FROM chat_messages ORDER BY id`);
    if (JSON.stringify(r.rows.map((x) => x.ch)) !== '["global","clan","dm"]') throw new Error(`sohbet kayıtları: ${JSON.stringify(r.rows)}`);
  });
  await step('Grup: A sohbetteki adından B\'yi davet eder; B davet kartında kabul eder; grup panelinde can/kalkan ve konum', async () => {
    await pc.getByTestId('chat-log').getByRole('button', { name: `[AKN] ${B.username}` }).first().click();
    await pc.getByTestId('pilot-menu').getByRole('menuitem', { name: 'Gruba davet et' }).click();
    await pc.getByText(`${B.username} adlı pilota grup daveti gönderildi.`).waitFor();
    const card = pcB.getByTestId('party-invite');
    await card.getByText(A.username).waitFor({ timeout: 8000 });
    await sleep(300);
    await pcB.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '05-grup-daveti.jpg') });
    await card.getByTestId('party-accept').click();
    await pc.getByTestId(`party-member-${B.username}`).waitFor({ timeout: 8000 });
    await pc.getByTestId(`party-where-${B.username}`).getByText(/^G-2 · \d+\/\d+$/).waitFor({ timeout: 8000 });
    await pcB.getByTestId(`party-member-${A.username}`).waitFor();
    await sleep(800);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '06-grup-paneli.jpg') });
  });
  await step('Konum izni: B başka haritaya geçer ve gizliliği "yalnızca harita" yapar → A\'nın grup panelinde koordinat gizlenir', async () => {
    await teleport(pcB, B.username, 9000, 7000, 'G-1');
    // Oyundan çıkan pilot gruptan ayrılır (bu testte bekleme süresi 0): iki kişilik grup dağılır → A yeniden davet eder
    await pc.getByTestId('party-panel').waitFor({ state: 'detached', timeout: 8000 });
    await pc.getByTestId('chat-log').getByRole('button', { name: `[AKN] ${B.username}` }).first().click();
    await pc.getByTestId('pilot-menu').getByRole('menuitem', { name: 'Gruba davet et' }).click();
    await pcB.getByTestId('party-invite').getByTestId('party-accept').click({ timeout: 8000 });
    await pc.getByTestId(`party-where-${B.username}`).getByText(/^G-1 · \d+\/\d+$/).waitFor({ timeout: 8000 });
    const tab = await desktopB.newPage();
    await tab.goto(`${WEB}/sosyal`);
    await tab.getByTestId('social-tab-privacy').click();
    await tab.getByTestId('privacy-location').selectOption('map');
    await tab.getByTestId('privacy-save').click();
    await tab.getByText('Gizlilik ayarların kaydedildi.').waitFor();
    await tab.close();
    await pc.getByTestId(`party-where-${B.username}`).getByText(/^G-1$/).waitFor({ timeout: 8000 });
    await sleep(500);
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '07-grup-konum-izni.jpg') });
  });
  await step('Şikâyet: A, B\'nin mesajını sohbetten şikâyet eder → moderasyon kuyruğunda anlık kopyasıyla kayıt', async () => {
    await pc.getByTestId('chat-log').getByRole('button', { name: `[AKN] ${B.username}` }).first().click();
    await pc.getByTestId('menu-report').click();
    const dlg = pc.getByTestId('report-dialog');
    await dlg.getByText(`${B.username}: Sana özel bir mesaj`).waitFor();
    await dlg.getByTestId('report-reason').selectOption('spam');
    await dlg.getByTestId('report-submit').click();
    await pc.getByText('Şikâyetin kaydedildi; moderasyon ekibi inceleyecek.').waitFor();
    const r = await db.query(`SELECT target_type, reason, status, snapshot->>'body' AS body FROM reports`);
    if (r.rows.length !== 1 || r.rows[0].body !== 'Sana özel bir mesaj' || r.rows[0].status !== 'open') throw new Error(`şikâyet: ${JSON.stringify(r.rows)}`);
  });
  await step('Açık klan sayfası: üyeler, rütbeler; pilot profilinde klan bağlantısı', async () => {
    await pcB.goto(`${WEB}/pilot/TR1/${A.username}`);
    await pcB.getByTestId('pilot-clan').getByText('[AKN]').waitFor();
    await pcB.getByTestId('pilot-social').waitFor();
    await pcB.getByTestId('pilot-clan').getByRole('link').click();
    const pub = pcB.getByTestId('public-clan');
    await pub.getByRole('link', { name: A.username }).waitFor();
    await pub.getByRole('link', { name: B.username }).waitFor();
    await pub.getByText(`Lider: ${A.username}`).waitFor();
    await pcB.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '08-acik-klan-sayfasi.jpg') });
  });
  await desktopB.close();

  console.log('Aşama 13 — Forum ve destek (oturumsuz ziyaretçi + iki masaüstü)');
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: 'tr-TR' });
  const guest = await guestCtx.newPage();
  guest.on('pageerror', (e) => pageErrors.push(`guest: ${e.message}`));
  const desktopB2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: 'tr-TR' });
  const pcB2 = await desktopB2.newPage();
  pcB2.on('pageerror', (e) => pageErrors.push(`pcB2: ${e.message}`));
  let threadUrl = '';
  let ticketNo = '';
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 11)]);
  await step('Forum: oturumsuz ziyaretçi bölümleri ve kilitli "Topluluk Kuralları" konusunu okur; yazmak için giriş istenir', async () => {
    await guest.goto(`${WEB}/forum`);
    await guest.getByTestId('forum-cat-duyurular').waitFor();
    await guest.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS13, '01-forum-bolumler.jpg') });
    await guest.getByTestId('forum-cat-duyurular').getByRole('link', { name: 'Topluluk Kuralları' }).click();
    await guest.getByTestId('thread-title-h').getByText('Topluluk Kuralları').waitFor();
    await guest.getByText('Saygılı ol. Hakaret, küfür', { exact: false }).waitFor();
    await guest.getByTestId('reply-blocked').getByText('Yanıt yazmak için giriş yap.').waitFor();
  });
  await step('Forum: A konu açar; B giriş yapıp alıntıyla yanıtlar ve beğenir; A\'nın zilinde "takip ettiğin konuya yanıt"', async () => {
    await pc.goto(`${WEB}/forum/rehberler`);
    await pc.getByTestId('new-thread').click();
    await pc.getByTestId('thread-title').fill('Yeni pilotlar için madencilik rehberi');
    await pc.getByTestId('thread-body').fill('Kaynak bölgelerinde gemileri ambar dolana kadar gezdirin.\nDolunca Pazar\'da satın veya rafineride işleyin.');
    await pc.getByTestId('thread-submit').click();
    await pc.getByTestId('thread-title-h').getByText('Yeni pilotlar için madencilik rehberi').waitFor();
    threadUrl = pc.url();
    await pcB2.goto(`${WEB}/giris`);
    await pcB2.getByLabel('Kullanıcı adı veya e-posta').fill(B.username);
    await pcB2.getByLabel('Parola', { exact: true }).fill(B.password);
    await pcB2.getByRole('button', { name: 'Giriş yap' }).click();
    await pcB2.getByRole('heading', { name: B.username }).waitFor();
    await pcB2.goto(threadUrl);
    const first = pcB2.getByTestId('post-list').locator('article').first();
    await first.getByRole('button', { name: 'Alıntıla' }).click();
    await pcB2.getByTestId('reply-body').fill('Çok faydalı oldu, teşekkürler! Titanyum için G-1 bulutunu öneririm.');
    await pcB2.getByTestId('reply-submit').click();
    await pcB2.getByText('Yanıtın gönderildi.').waitFor();
    await first.locator('.like-btn').click();
    await first.locator('.like-btn').getByText('1').waitFor();
    await pc.reload();
    await pc.getByTestId('post-list').locator('article').nth(1).getByText(`${A.username} yazdı:`).waitFor();
    await pc.getByTestId('notif-count').waitFor({ timeout: 8000 });
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS13, '02-forum-konu.jpg'), fullPage: true });
  });
  await step('Kilitli konuya yanıt reddedilir: moderatör A kilitler → B\'nin yanıt kutusu yerine kilit sebebi; doğrudan API isteği de 409', async () => {
    // Test hazırlığı: A'ya moderatör rolü (üretimde yalnızca sunucu tarafı rol aracıyla verilir)
    await db.query(`INSERT INTO user_roles (user_id, role_key) SELECT id, 'moderator' FROM users WHERE username = $1 ON CONFLICT DO NOTHING`, [A.username]);
    await pc.reload();
    await pc.getByTestId('mod-bar').waitFor();
    await pc.getByTestId('mod-lock').click();
    await pc.getByText('Konu kilitlendi.').waitFor();
    await pcB2.reload();
    await pcB2.getByTestId('reply-blocked').getByText('Bu konu kilitli; yeni yanıt yazılamaz.').waitFor();
    const id = threadUrl.match(/konu\/(\d+)/)[1];
    const res = await pcB2.evaluate(async (tid) => {
      const me = await (await fetch('/api/v1/auth/me', { credentials: 'include' })).json();
      const r = await fetch(`/api/v1/forum/t/${tid}/replies`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
        body: JSON.stringify({ body: 'kilide rağmen' }),
      });
      return { status: r.status, body: await r.json() };
    }, id);
    if (res.status !== 409 || res.body.error.code !== 'THREAD_LOCKED') throw new Error(`kilitli konuya yanıt: ${JSON.stringify(res)}`);
    await pcB2.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS13, '03-forum-kilitli.jpg'), fullPage: true });
  });
  await step('Forum araması: "gemi" kelimesi "gemileri"ni bulur ve vurgular', async () => {
    await guest.goto(`${WEB}/forum`);
    await guest.getByTestId('forum-search-input').fill('gemi');
    await guest.getByTestId('forum-search-input').press('Enter');
    const res = guest.getByTestId('search-results');
    await res.getByRole('link', { name: 'Yeni pilotlar için madencilik rehberi' }).waitFor();
    await res.locator('mark').getByText('gemileri').waitFor();
    await guest.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS13, '04-forum-arama.jpg') });
  });
  await step('Destek: .png uzantılı EXE tarayıcıda reddedilir; B gerçek PNG ekiyle talep açar → TO-YYYY-NNNNNN numarası ve indirilebilir ek', async () => {
    await pcB2.goto(`${WEB}/destek`);
    await pcB2.getByTestId('ticket-category').selectOption('gameplay');
    await pcB2.getByTestId('ticket-subject').fill('Görev ödülü envantere gelmedi');
    await pcB2.getByTestId('ticket-body').fill('Dünkü günlük görevin ödülünü aldım ama envanterimde göremiyorum. Ekran görüntüsü ekledim.');
    await pcB2.getByTestId('file-input').setInputFiles({ name: 'resim.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]) });
    await pcB2.getByTestId('ticket-submit').click();
    await pcB2.getByTestId('file-error').getByText('desteklenmeyen bir dosya türü', { exact: false }).waitFor();
    await pcB2.getByRole('button', { name: 'resim.png dosyasını kaldır' }).click();
    await pcB2.getByTestId('file-input').setInputFiles({ name: 'envanter ekranı.png', mimeType: 'image/png', buffer: PNG });
    await pcB2.getByTestId('ticket-submit').click();
    await pcB2.getByTestId('ticket-no').waitFor();
    ticketNo = (await pcB2.getByTestId('ticket-no').innerText()).trim();
    if (!/^TO-\d{4}-\d{6}$/.test(ticketNo)) throw new Error(`talep numarası: ${ticketNo}`);
    await pcB2.getByRole('link', { name: 'envanter ekranı.png' }).waitFor();
    await pcB2.getByTestId('ticket-status').getByText('Ekip yanıtı bekleniyor').waitFor();
    const [download] = await Promise.all([pcB2.waitForEvent('download'), pcB2.getByRole('link', { name: 'envanter ekranı.png' }).click()]);
    const p = await download.path();
    const { readFileSync } = await import('node:fs');
    if (!readFileSync(p).equals(PNG)) throw new Error('indirilen dosya yüklenenle aynı değil');
    await pcB2.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS13, '05-destek-talep.jpg'), fullPage: true });
  });
  await step('Destek masası: A (destek personeli) iç not ve yanıt yazar; B ekip yanıtını görür, iç notu görmez; B\'ye e-posta (gerçek SMTP)', async () => {
    await db.query(`INSERT INTO user_roles (user_id, role_key) SELECT id, 'support_staff' FROM users WHERE username = $1 ON CONFLICT DO NOTHING`, [A.username]);
    await pc.goto(`${WEB}/destek/masa`);
    await pc.getByTestId('desk-queue').getByRole('link', { name: new RegExp(ticketNo) }).click();
    await pc.getByTestId('internal-note').check();
    await pc.getByTestId('reply-text').fill('Ödül kayıtlarını kontrol ettim; envanter senkron sorunu.');
    await pc.getByTestId('reply-send').click();
    await pc.getByText('İç not eklendi.').waitFor();
    await pc.getByTestId('internal-note').uncheck();
    await pc.getByTestId('reply-text').fill('Merhaba, ödülün envanterine eklendi. İyi uçuşlar!');
    await pc.getByTestId('reply-send').click();
    await pc.getByText('Yanıt gönderildi; oyuncuya bildirim ve e-posta gitti.').waitFor();
    await pc.getByTestId('desk-status').getByText('Oyuncu yanıtı bekleniyor').waitFor();
    await pc.evaluate(() => window.scrollTo(0, 0));
    await pc.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS13, '06-destek-masasi.jpg'), fullPage: true });
    await pcB2.reload();
    await pcB2.getByTestId('ticket-messages').getByText('Merhaba, ödülün envanterine eklendi. İyi uçuşlar!').waitFor();
    await pcB2.getByTestId('ticket-messages').getByText('Türk Orbit Destek').waitFor();
    if ((await pcB2.getByText('envanter senkron sorunu', { exact: false }).count()) !== 0) throw new Error('iç not oyuncuya göründü');
    let mail = null;
    for (let i = 0; i < 100 && !mail; i++) {
      mail = inbox.find((m) => m.to === B.email && m.subject.includes(ticketNo)) ?? null;
      if (!mail) await sleep(50);
    }
    if (!mail) throw new Error('destek yanıt e-postası gelmedi');
    await pcB2.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS13, '07-destek-yanit.jpg'), fullPage: true });
  });
  await desktopB2.close();
  await guestCtx.close();
  // Telefon adımları G-2'de devam eder
  await teleport(pc, A.username, 2200, 6250, 'G-2');

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
  await step('Telefonda sohbet: 💬 çekmecesi açılır; geçmiş mesajlar (genel + klan) yüklenir; mesaj gönderilir', async () => {
    await phone.getByTestId('hud-chat-btn').click();
    const drawer = phone.getByTestId('chat-drawer');
    await drawer.getByText('Selam Gökbörü!').waitFor({ timeout: 8000 });
    await drawer.getByText('Klan toplantısı 21:00').waitFor();
    await drawer.getByTestId('chat-input').fill('Telefondan selam');
    await drawer.getByTestId('chat-send').click();
    await drawer.getByTestId('chat-log').getByText('Telefondan selam').waitFor();
    const w = await drawer.evaluate((el) => el.getBoundingClientRect().width);
    if (w < 380) throw new Error(`sohbet çekmecesi telefonda tam genişlikte değil: ${w}`);
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '09-mobil-sohbet.jpg') });
    await drawer.getByRole('button', { name: 'Kapat' }).click();
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
  await step('Telefonda Pazar: günlük takvim (PC\'de alınan ödül görünür) ve üretim tarifleri', async () => {
    await phone.goto(`${WEB}/pazar`);
    await phone.getByTestId('daily-panel').getByText('Bugünün ödülü alındı').waitFor();
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS11, '07-mobil-pazar-gunluk.jpg'), fullPage: true });
    await phone.getByTestId('market-tab-crafting').click();
    await phone.getByTestId('recipe-nebulit').waitFor();
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS11, '08-mobil-uretim.jpg') });
  });
  await step('Telefonda forum konusu ve destek talepleri: okunur, yatay taşma yok', async () => {
    await phone.goto(threadUrl);
    await phone.getByTestId('thread-title-h').waitFor();
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    if (w > 392) throw new Error(`forum sayfası yatay taşıyor: ${w}`);
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS13, '08-mobil-forum.jpg'), fullPage: true });
    await phone.goto(`${WEB}/destek/masa/${ticketNo}`);
    await phone.getByTestId('ticket-messages').getByText('İç not (oyuncu görmez)').waitFor();
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS13, '09-mobil-destek-masasi.jpg'), fullPage: true });
    // Sonraki adımlar için test rolleri geri alınır
    await db.query(`DELETE FROM user_roles WHERE role_key IN ('moderator', 'support_staff') AND user_id = (SELECT id FROM users WHERE username = $1)`, [A.username]);
  });
  await step('Telefonda Klan ve Sosyal sayfaları: sekmeler tek satırda kaydırılır; klan bilgileri görünür', async () => {
    await phone.goto(`${WEB}/klan`);
    await phone.getByTestId('my-clan').getByText('[AKN]').waitFor();
    await phone.getByTestId('clan-tab-members').click();
    await phone.getByTestId('clan-members').getByText(B.username).waitFor();
    const tabs = await phone.locator('.tabs').first().evaluate((el) => ({ h: el.getBoundingClientRect().height, sw: el.scrollWidth, cw: el.clientWidth }));
    if (tabs.h > 70) throw new Error(`sekmeler iki satıra taştı: ${JSON.stringify(tabs)}`);
    await phone.screenshot({ type: 'jpeg', quality: 82, path: path.join(SHOTS12, '10-mobil-klan.jpg'), fullPage: true });
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
  console.log(`\nSonuç: ${results.length - failed}/${results.length} adım başarılı. Ekran görüntüleri: ${path.relative(ROOT, SHOTS)}, ${path.relative(ROOT, SHOTS5)}, ${path.relative(ROOT, SHOTS6)}, ${path.relative(ROOT, SHOTS7)}, ${path.relative(ROOT, SHOTS8)}, ${path.relative(ROOT, SHOTS9)}, ${path.relative(ROOT, SHOTS10)}, ${path.relative(ROOT, SHOTS11)}, ${path.relative(ROOT, SHOTS12)}, ${path.relative(ROOT, SHOTS13)}`);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
