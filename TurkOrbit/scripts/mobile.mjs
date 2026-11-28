#!/usr/bin/env node
/**
 * Türk Orbit mobil derleme (Aşama 15). Web istemcisi `dist-mobile/` klasörüne derlenir ve Capacitor ile
 * Android/iOS projelerine kopyalanır.
 *
 *   npm run mobile:test-apk        Test APK'sı (debug imzalı, "Türk Orbit Test"). Sunucu adresi uygulamada sorulur;
 *                                  yerel ağdaki http geliştirme sunucusuna bağlanabilir. Telefona doğrudan kurulur.
 *   npm run mobile:release         Mağaza derlemesi: imzalı APK + AAB (Google Play). Yalnızca HTTPS.
 *                                  Gerekenler: VITE_SERVER_URL=https://…, TURKORBIT_KEYSTORE, TURKORBIT_KEYSTORE_PASSWORD,
 *                                  TURKORBIT_KEY_ALIAS, TURKORBIT_KEY_PASSWORD
 *   npm run mobile:ios             iOS projesini eşitler (VITE_SERVER_URL=https://… gerekli). Derleme macOS + Xcode'da yapılır.
 *
 * Gereksinimler: Node 22+, JDK 21, Android SDK (ANDROID_HOME). iOS için macOS + Xcode 16+.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'apps/client');
const ANDROID = path.join(CLIENT, 'android');
const mode = process.argv[2];
const version = JSON.parse(readFileSync(path.join(CLIENT, 'package.json'), 'utf8')).version;

function run(cmd, args, opts = {}) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) {
    console.error(`✖ Komut başarısız oldu (${cmd}).`);
    process.exit(r.status ?? 1);
  }
}
function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(2);
}
function requireHttpsServer() {
  const url = process.env.VITE_SERVER_URL ?? '';
  let u;
  try {
    u = new URL(url);
  } catch {
    fail('VITE_SERVER_URL gerekli (ör. VITE_SERVER_URL=https://turkorbit.com.tr). Mağaza derlemesinde sunucu adresi sabittir.');
  }
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash) {
    fail(`VITE_SERVER_URL https:// ile başlayan bir kök adres olmalı (yol yok). Verilen: ${url}`);
  }
}
function buildWeb(env) {
  run('npm', ['run', 'build', '-w', '@turkorbit/shared'], { cwd: ROOT });
  run('npx', ['vite', 'build', '--mode', 'mobile'], { cwd: CLIENT, env: { ...process.env, ...env } });
}
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const size = (f) => `${(statSync(f).size / 1024 / 1024).toFixed(1)} MB`;

if (mode === 'test-apk') {
  // Test derlemesinde sunucu adresi gömülmez (uygulama sorar); istenirse VITE_SERVER_URL ile sabitlenebilir
  buildWeb({ VITE_SERVER_URL: process.env.VITE_SERVER_URL ?? '' });
  run('npx', ['cap', 'sync', 'android'], { cwd: CLIENT });
  run(gradlew, ['assembleDebug'], { cwd: ANDROID });
  const apk = path.join(ANDROID, 'app/build/outputs/apk/debug/app-debug.apk');
  const outDir = path.join(ROOT, 'Deliveries');
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `TurkOrbit-${version}-test.apk`);
  copyFileSync(apk, out);
  console.log(`\n✔ Test APK'sı: ${path.relative(ROOT, out)} (${size(out)})`);
  console.log('  Telefona kur: adb install -r Deliveries/' + path.basename(out) + '  (veya dosyayı telefona kopyalayıp aç)');
} else if (mode === 'release') {
  requireHttpsServer();
  for (const k of ['TURKORBIT_KEYSTORE', 'TURKORBIT_KEYSTORE_PASSWORD', 'TURKORBIT_KEY_ALIAS', 'TURKORBIT_KEY_PASSWORD']) {
    if (!process.env[k]) fail(`${k} ortam değişkeni gerekli (imza anahtarı depoya konmaz). Ayrıntı: Documentation/Asama-15-Mobil/`);
  }
  if (!existsSync(process.env.TURKORBIT_KEYSTORE)) fail(`Anahtar deposu bulunamadı: ${process.env.TURKORBIT_KEYSTORE}`);
  buildWeb({});
  run('npx', ['cap', 'sync', 'android'], { cwd: CLIENT });
  run(gradlew, ['assembleRelease', 'bundleRelease'], { cwd: ANDROID });
  console.log('\n✔ Sürüm derlemesi:');
  console.log(`  APK: apps/client/android/app/build/outputs/apk/release/app-release.apk`);
  console.log(`  AAB: apps/client/android/app/build/outputs/bundle/release/app-release.aab (Google Play'e bu yüklenir)`);
} else if (mode === 'ios') {
  requireHttpsServer();
  buildWeb({});
  run('npx', ['cap', 'sync', 'ios'], { cwd: CLIENT });
  console.log('\n✔ iOS projesi eşitlendi. macOS\'ta: npx cap open ios (apps/client içinde) → Xcode → Signing & Capabilities → Product → Archive.');
} else {
  console.log('Kullanım: node scripts/mobile.mjs <test-apk | release | ios>');
  process.exit(2);
}
