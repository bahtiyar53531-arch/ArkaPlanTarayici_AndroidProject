#!/usr/bin/env node
/**
 * Aşama teslimat ZIP'i üretir: Deliveries/TurkOrbit-<aşama-adı>.zip
 * node_modules, dist, .env, test çıktıları ve önceki ZIP'ler pakete girmez.
 *
 * Kullanım: npm run package:phase -- Asama-01-Kayit-Giris
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2];
if (!phase || !/^Asama-\d{2}-[A-Za-z0-9-]+$/.test(phase)) {
  console.error('Kullanım: npm run package:phase -- Asama-01-Kayit-Giris');
  process.exit(2);
}
const outDir = path.join(ROOT, 'Deliveries');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `TurkOrbit-${phase}.zip`);
if (existsSync(out)) rmSync(out);

const excludes = [
  'TurkOrbit/node_modules/*',
  'TurkOrbit/*/node_modules/*',
  'TurkOrbit/*/*/node_modules/*',
  'TurkOrbit/*/*/dist/*',
  'TurkOrbit/Deliveries/*',
  'TurkOrbit/.env',
  'TurkOrbit/test-results/*',
  'TurkOrbit/playwright-report/*',
];
const parent = path.dirname(ROOT);
let r = spawnSync('zip', ['-r', '-q', '-X', out, 'TurkOrbit', '-x', ...excludes], { cwd: parent, stdio: 'inherit' });
if (r.error) {
  // zip yoksa (ör. Windows) bsdtar ile dene
  const tarExcludes = ['node_modules', 'dist', 'Deliveries', '.env', 'test-results', 'playwright-report'].flatMap((e) => [
    '--exclude',
    e,
  ]);
  r = spawnSync('tar', ['-a', '-c', '-f', out, ...tarExcludes, 'TurkOrbit'], { cwd: parent, stdio: 'inherit' });
}
if (r.status !== 0) {
  console.error('ZIP oluşturulamadı.');
  process.exit(1);
}
console.log(`✔ ${path.relative(ROOT, out)} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
