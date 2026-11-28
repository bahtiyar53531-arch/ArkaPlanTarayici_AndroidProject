#!/usr/bin/env node
/**
 * Mobil uygulama simge ve açılış ekranı görsellerini Türk Orbit logosundan üretir (Aşama 15).
 * Şablonla gelen Capacitor varsayılan görsellerinin yerine geçer. Çıktılar depoya eklenir;
 * logo değişirse yeniden çalıştırılır:
 *
 *   NODE_PATH=<playwright'in kurulu olduğu node_modules> node scripts/mobile-assets.mjs
 *
 * Çizim için Playwright + Chromium kullanılır (projede zaten tarayıcı testleri için var).
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_RES = path.join(ROOT, 'apps/client/android/app/src/main/res');
const IOS_ASSETS = path.join(ROOT, 'apps/client/ios/App/App/Assets.xcassets');
const BG = '#050816';

/** Logonun gezegen + yörünge + yıldız kısmı (arka plansız), 64×64 görünüm kutusu. */
const GLYPH = `
  <defs>
    <radialGradient id="p" cx="38%" cy="35%" r="70%">
      <stop offset="0" stop-color="#ff5a5f"/><stop offset="1" stop-color="#b3000d"/>
    </radialGradient>
  </defs>
  <ellipse cx="32" cy="33" rx="27" ry="10" fill="none" stroke="#29c5ff" stroke-width="2.5" stroke-opacity=".55" transform="rotate(-18 32 33)"/>
  <circle cx="32" cy="32" r="14" fill="url(#p)"/>
  <circle cx="37.5" cy="29.5" r="11" fill="${BG}"/>
  <path d="M52.5 21.8l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.9 2 .8-4.3-3.1-3 4.3-.6z" fill="#ffffff"/>
  <path d="M5.8 43.5a27 10 -18 0 0 46 -4" fill="none" stroke="#29c5ff" stroke-width="2.5"/>`;

/** Kare simge. shape: 'square' (köşesiz, iOS maskeler), 'rounded' (eski Android), 'round' (daire), 'none' (saydam, uyarlanabilir ön plan). */
function iconSvg(shape, glyphScale) {
  const bg =
    shape === 'square' ? `<rect width="64" height="64" fill="${BG}"/>`
    : shape === 'rounded' ? `<rect width="64" height="64" rx="14" fill="${BG}"/>`
    : shape === 'round' ? `<circle cx="32" cy="32" r="32" fill="${BG}"/>`
    : '';
  const t = (64 * (1 - glyphScale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${bg}<g transform="translate(${t} ${t}) scale(${glyphScale})">${GLYPH}</g></svg>`;
}

function splashHtml(w, h) {
  const s = Math.round(Math.min(w, h) * 0.3);
  const font = Math.round(s * 0.2);
  return `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;background:${BG};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'DejaVu Sans',Arial,sans-serif">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${s}" height="${s}">${GLYPH}</svg>
    <div style="margin-top:${Math.round(font * 0.6)}px;color:#e8eeff;font-weight:700;letter-spacing:${Math.round(font * 0.18)}px;font-size:${font}px">TÜRK ORBIT</div>
  </body></html>`;
}

async function render(page, html, w, h, out, transparent = false) {
  mkdirSync(path.dirname(out), { recursive: true });
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}
const svgPage = (svg, size) => `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const done = [];

// ---------------------------------------------------------------- Android başlatıcı simgeleri
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  const icon = Math.round(48 * k);
  const fg = Math.round(108 * k);
  await render(page, svgPage(iconSvg('rounded', 0.9), icon), icon, icon, path.join(ANDROID_RES, `mipmap-${d}/ic_launcher.png`), true);
  await render(page, svgPage(iconSvg('round', 0.82), icon), icon, icon, path.join(ANDROID_RES, `mipmap-${d}/ic_launcher_round.png`), true);
  // Uyarlanabilir simge: 108 dp tuvalin ortadaki 66 dp'si her maskede görünür → logo ~%56
  await render(page, svgPage(iconSvg('none', 0.56), fg), fg, fg, path.join(ANDROID_RES, `mipmap-${d}/ic_launcher_foreground.png`), true);
  done.push(`android mipmap-${d}`);
}

// ---------------------------------------------------------------- Android açılış ekranı
const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(SPLASH)) {
  await render(page, splashHtml(w, h), w, h, path.join(ANDROID_RES, `drawable-port-${d}/splash.png`));
  await render(page, splashHtml(h, w), h, w, path.join(ANDROID_RES, `drawable-land-${d}/splash.png`));
}
await render(page, splashHtml(480, 320), 480, 320, path.join(ANDROID_RES, 'drawable/splash.png'));
done.push('android splash');

// ---------------------------------------------------------------- iOS
await render(page, svgPage(iconSvg('square', 0.82), 1024), 1024, 1024, path.join(IOS_ASSETS, 'AppIcon.appiconset/AppIcon-512@2x.png'));
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await render(page, splashHtml(2732, 2732), 2732, 2732, path.join(IOS_ASSETS, `Splash.imageset/${name}`));
}
done.push('ios icon + splash');

await browser.close();
console.log(`✔ Mobil görseller üretildi: ${done.join(', ')}`);
