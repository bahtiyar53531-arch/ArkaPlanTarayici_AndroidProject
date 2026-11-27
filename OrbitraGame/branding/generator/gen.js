// ORBITRAGAME.SPACE gorsel kimlik ureticisi (SVG -> PNG, Chromium ile).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const FONT = process.argv[3]; // orbitron_900.ttf
const fontB64 = fs.readFileSync(FONT).toString('base64');

function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function stars(seed, n, w, h, rMin, rMax, oMin = 0.35, oMax = 1) {
  const r = rng(seed); let s = '';
  for (let i = 0; i < n; i++) {
    const x = (r() * w).toFixed(2), y = (r() * h).toFixed(2);
    const rad = (rMin + Math.pow(r(), 3) * (rMax - rMin)).toFixed(2);
    const o = (oMin + r() * (oMax - oMin)).toFixed(2);
    const c = r() < 0.15 ? '#9FF7FF' : (r() < 0.1 ? '#BFD4FF' : '#FFFFFF');
    s += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${c}" opacity="${o}"/>`;
  }
  return s;
}

function sparkle(x, y, s, color = '#FFFFFF', o = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})" opacity="${o}"><path d="M0,-6 C0.6,-1.2 1.2,-0.6 6,0 C1.2,0.6 0.6,1.2 0,6 C-0.6,1.2 -1.2,0.6 -6,0 C-1.2,-0.6 -0.6,-1.2 0,-6 Z" fill="${color}"/><circle r="1.4" fill="${color}" filter="url(#glow2)"/></g>`;
}

// Spiral galaksi (logaritmik kollar)
function galaxy(seed, cx, cy, size, tilt, n = 900) {
  const r = rng(seed); let s = '';
  for (let i = 0; i < n; i++) {
    const arm = i % 2;
    const t = Math.pow(r(), 0.7) * 3.2 * Math.PI;
    const rad = size * 0.06 * Math.exp(0.28 * t);
    if (rad > size) continue;
    const ang = t + arm * Math.PI + (r() - 0.5) * 0.55;
    const sc = (r() - 0.5) * size * 0.08 * (1 + rad / size);
    let x = Math.cos(ang) * (rad + sc), y = Math.sin(ang) * (rad + sc) * 0.42;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const X = cx + x * ct - y * st, Y = cy + x * st + y * ct;
    const o = (0.25 + 0.75 * (1 - rad / size)) * (0.4 + r() * 0.6);
    const col = rad < size * 0.25 ? '#E8FDFF' : (r() < 0.5 ? '#7FE9FF' : '#6F9BFF');
    s += `<circle cx="${X.toFixed(2)}" cy="${Y.toFixed(2)}" r="${(0.25 + r() * 0.55).toFixed(2)}" fill="${col}" opacity="${o.toFixed(2)}"/>`;
  }
  return `<g opacity=".8">${s}<ellipse cx="${cx}" cy="${cy}" rx="${size * 0.12}" ry="${size * 0.06}" transform="rotate(${tilt * 180 / Math.PI} ${cx} ${cy})" fill="#DFFBFF" opacity=".55" filter="url(#glow2)"/></g>`;
}

const DEFS = `
<filter id="glow1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.8"/></filter>
<filter id="glow2" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.6"/></filter>
<filter id="glow4" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="blur8" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>
<radialGradient id="planet" cx="34%" cy="28%" r="78%">
  <stop offset="0" stop-color="#D9FFFF"/><stop offset="0.16" stop-color="#5BEAF5"/>
  <stop offset="0.45" stop-color="#1D93EA"/><stop offset="0.75" stop-color="#1838A8"/><stop offset="1" stop-color="#0A1240"/>
</radialGradient>
<linearGradient id="shade" x1="0.2" y1="0.15" x2="0.95" y2="0.95">
  <stop offset="0.45" stop-color="#02061A" stop-opacity="0"/><stop offset="1" stop-color="#02061A" stop-opacity="0.85"/>
</linearGradient>
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#2F7BFF"/><stop offset="0.45" stop-color="#19E3D6"/><stop offset="1" stop-color="#B9FBFF"/>
</linearGradient>
<linearGradient id="trail" x1="1" y1="0" x2="0" y2="0">
  <stop offset="0" stop-color="#C8FDFF" stop-opacity="1"/><stop offset="1" stop-color="#19E3D6" stop-opacity="0"/>
</linearGradient>
<linearGradient id="hull" x1="0" y1="-1" x2="0" y2="1">
  <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.6" stop-color="#CFEFFF"/><stop offset="1" stop-color="#7FB8E6"/>
</linearGradient>
<radialGradient id="bg" cx="36%" cy="28%" r="88%">
  <stop offset="0" stop-color="#173C82"/><stop offset="0.42" stop-color="#0A1A47"/><stop offset="1" stop-color="#02040D"/>
</radialGradient>
<clipPath id="planetClip"><circle cx="52" cy="57" r="16"/></clipPath>
<clipPath id="ringBack"><rect x="0" y="0" width="108" height="55"/></clipPath>
<clipPath id="ringFront"><rect x="0" y="55" width="108" height="60"/></clipPath>
`;

function ship(x, y, rot, sc) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${sc})">
    <ellipse cx="-8.5" cy="0" rx="4.5" ry="1.6" fill="#7FF6FF" opacity=".9" filter="url(#glow2)"/>
    <circle cx="-6.6" cy="0" r="1.25" fill="#FFFFFF"/>
    <path d="M7.5,0 L-3.8,-4.6 L-2.2,-1.3 L-6.2,-1.9 L-6.2,1.9 L-2.2,1.3 L-3.8,4.6 Z" fill="url(#hull)" stroke="#0B1E3F" stroke-width="0.35" stroke-linejoin="round"/>
    <path d="M-3.8,-4.6 L-2.2,-1.3 L-0.5,-1.0 Z M-3.8,4.6 L-2.2,1.3 L-0.5,1.0 Z" fill="#19E3D6" opacity=".9"/>
    <ellipse cx="2.4" cy="0" rx="2.2" ry="0.95" fill="#0FD2E6" stroke="#0B1E3F" stroke-width="0.25"/>
    <ellipse cx="2.9" cy="-0.3" rx="0.9" ry="0.3" fill="#FFFFFF" opacity=".85"/>
  </g>`;
}

// Halka uzerindeki bir noktanin (ring-yerel aci) dunya koordinati
const RCX = 54, RCY = 55, RX = 34, RY = 11, RROT = -18;
function ringPoint(deg) {
  const t = deg * Math.PI / 180, a = RROT * Math.PI / 180;
  const dx = RX * Math.cos(t), dy = RY * Math.sin(t);
  return [RCX + dx * Math.cos(a) - dy * Math.sin(a), RCY + dx * Math.sin(a) + dy * Math.cos(a)];
}
function trailPath(fromDeg, toDeg) {
  let d = ''; for (let k = 0; k <= 24; k++) { const g = fromDeg + (toDeg - fromDeg) * k / 24; const [x, y] = ringPoint(g); d += (k ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2); }
  return d;
}

function background108() {
  return `
  <rect width="108" height="108" fill="url(#bg)"/>
  <ellipse cx="80" cy="80" rx="34" ry="17" transform="rotate(-32 80 80)" fill="#1E5BFF" opacity=".38" filter="url(#blur8)"/>
  <ellipse cx="26" cy="86" rx="26" ry="11" transform="rotate(18 26 86)" fill="#19E3D6" opacity=".22" filter="url(#blur8)"/>
  <ellipse cx="20" cy="20" rx="22" ry="10" transform="rotate(-10 20 20)" fill="#4C7DFF" opacity=".28" filter="url(#blur8)"/>
  ${galaxy(7, 79, 29, 13, -0.5, 300)}
  ${stars(11, 70, 108, 108, 0.18, 0.75)}
  ${sparkle(17, 36, 0.32, '#BFFBFF', .9)}${sparkle(88, 90, 0.26, '#FFFFFF', .8)}
  `;
}

function foreground108() {
  const [sx, sy] = ringPoint(55);
  return `
  <circle cx="52" cy="57" r="19" fill="#2FD9FF" opacity=".28" filter="url(#glow4)"/>
  <g transform="rotate(${RROT} ${RCX} ${RCY})" clip-path="url(#ringBack)">
    <ellipse cx="${RCX}" cy="${RCY}" rx="${RX}" ry="${RY}" fill="none" stroke="url(#ring)" stroke-width="2.6" opacity=".75"/>
  </g>
  <circle cx="52" cy="57" r="16" fill="url(#planet)"/>
  <g clip-path="url(#planetClip)" opacity=".35">
    <ellipse cx="50" cy="52" rx="20" ry="2.2" fill="#9FF7FF" opacity=".5" transform="rotate(-14 50 52)"/>
    <ellipse cx="54" cy="60" rx="22" ry="1.6" fill="#0B2A7A" opacity=".8" transform="rotate(-14 54 60)"/>
    <ellipse cx="52" cy="66" rx="22" ry="1.2" fill="#9FF7FF" opacity=".35" transform="rotate(-14 52 66)"/>
  </g>
  <circle cx="52" cy="57" r="16" fill="url(#shade)"/>
  <circle cx="52" cy="57" r="16.4" fill="none" stroke="#7FF6FF" stroke-width="0.7" opacity=".55" filter="url(#glow1)"/>
  <g transform="rotate(${RROT} ${RCX} ${RCY})" clip-path="url(#ringFront)">
    <ellipse cx="${RCX}" cy="${RCY}" rx="${RX}" ry="${RY}" fill="none" stroke="url(#ring)" stroke-width="2.8"/>
  </g>
  <path d="${trailPath(58, 150)}" fill="none" stroke="#9FF7FF" stroke-width="2.4" stroke-linecap="round" opacity=".55" filter="url(#glow2)"/>
  <path d="${trailPath(60, 135)}" fill="none" stroke="url(#trail)" stroke-width="1.2" stroke-linecap="round"/>
  ${ship(sx.toFixed(2), sy.toFixed(2), -30.6, 1.18)}
  ${sparkle(73, 36, 0.42, '#FFFFFF', 1)}
  `;
}

const svg = (vb, w, h, body, extraDefs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}"><defs>${DEFS}${extraDefs}</defs>${body}</svg>`;

function spaceBackground(W, H) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${DEFS}
  <radialGradient id="sky" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#0D2257"/><stop offset=".5" stop-color="#06102E"/><stop offset="1" stop-color="#010309"/></radialGradient>
  <filter id="neb" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.0024" numOctaves="6" seed="9" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.12  0 0 0 0 0.42  0 0 0 0 1.0  0 0 0 3.0 -1.3" result="blue"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.0022 0.0018" numOctaves="5" seed="21" result="m"/>
    <feColorMatrix in="m" type="matrix" values="0 0 0 0 0.08  0 0 0 0 0.92  0 0 0 0 0.85  0 0 0 2.8 -1.55" result="teal"/>
    <feMerge><feMergeNode in="blue"/><feMergeNode in="teal"/></feMerge>
  </filter>
  <radialGradient id="mask1" cx="25%" cy="25%" r="65%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
  <radialGradient id="mask2" cx="75%" cy="75%" r="55%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
  <mask id="nm"><rect width="${W}" height="${H}" fill="url(#mask1)"/><rect width="${W}" height="${H}" fill="url(#mask2)" opacity=".9"/></mask>
  <radialGradient id="g1"><stop offset="0" stop-color="#1E5BFF" stop-opacity=".30"/><stop offset="1" stop-color="#1E5BFF" stop-opacity="0"/></radialGradient>
  <radialGradient id="g2"><stop offset="0" stop-color="#19E3D6" stop-opacity=".20"/><stop offset="1" stop-color="#19E3D6" stop-opacity="0"/></radialGradient>
  <radialGradient id="g3"><stop offset="0" stop-color="#6A4CFF" stop-opacity=".16"/><stop offset="1" stop-color="#6A4CFF" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" filter="url(#neb)" mask="url(#nm)" opacity=".85"/>
  <ellipse cx="${W * .22}" cy="${H * .2}" rx="${W * .7}" ry="${H * .25}" fill="url(#g1)"/>
  <ellipse cx="${W * .85}" cy="${H * .8}" rx="${W * .7}" ry="${H * .28}" fill="url(#g2)"/>
  <ellipse cx="${W * .7}" cy="${H * .35}" rx="${W * .5}" ry="${H * .18}" fill="url(#g3)"/>
  ${stars(101, 1400, W, H, 0.5, 2.2, 0.25, 0.95)}
  ${[...Array(14)].map((_, i) => { const r = rng(300 + i); return sparkle((r() * W).toFixed(0), (r() * H).toFixed(0), (0.5 + r() * 0.9).toFixed(2), r() < .5 ? '#BFFBFF' : '#FFFFFF', (0.6 + r() * 0.4).toFixed(2)); }).join('')}
  </svg>`;
}

function wordmark(W, H, withIcon) {
  const fs = H * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${DEFS}
  <style>@font-face{font-family:Orb;src:url(data:font/ttf;base64,${fontB64});}</style>
  <linearGradient id="wm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#CFF8FF"/><stop offset="1" stop-color="#5FD6FF"/></linearGradient>
  </defs>
  <text x="${W / 2}" y="${H * 0.66}" text-anchor="middle" font-family="Orb" font-size="${fs}" letter-spacing="${fs * 0.08}" fill="url(#wm)" style="filter:drop-shadow(0 0 ${fs * .12}px rgba(25,227,214,.55))">ORBITRAGAME<tspan fill="#19E3D6">.SPACE</tspan></text>
  </svg>`;
}

function featureGraphic() {
  const W = 1024, H = 500;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${DEFS}
  <style>@font-face{font-family:Orb;src:url(data:font/ttf;base64,${fontB64});}</style>
  <linearGradient id="wm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#CFF8FF"/><stop offset="1" stop-color="#5FD6FF"/></linearGradient>
  </defs>
  <image href="BG" x="0" y="-260" width="1024" height="1024" preserveAspectRatio="xMidYMid slice"/>
  <g transform="translate(40 70) scale(3.3)">${foreground108()}</g>
  <text x="660" y="250" text-anchor="middle" font-family="Orb" font-size="50" letter-spacing="4" fill="url(#wm)" style="filter:drop-shadow(0 0 8px rgba(25,227,214,.6))">ORBITRAGAME</text>
  <text x="660" y="305" text-anchor="middle" font-family="Orb" font-size="38" letter-spacing="14" fill="#19E3D6">.SPACE</text>
  <text x="660" y="360" text-anchor="middle" font-family="sans-serif" font-size="22" letter-spacing="3" fill="#9FC7FF">ANDROID OYUN UYGULAMASI</text>
  </svg>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(file, svgText, w, h, transparent = true) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svgText}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(50);
    const p = path.join(OUT, file); fs.mkdirSync(path.dirname(p), { recursive: true });
    await page.screenshot({ path: p, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
    console.log('wrote', file);
  }
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const a = Math.round(108 * k), l = Math.round(48 * k);
    await render(`mipmap-${d}/ic_launcher_background.png`, svg('0 0 108 108', a, a, background108()), a, a, false);
    await render(`mipmap-${d}/ic_launcher_foreground.png`, svg('0 0 108 108', a, a, foreground108()), a, a);
    const legacy = (round) => svg('0 0 108 108', l, l, `<defs><clipPath id="shape">${round ? '<circle cx="54" cy="54" r="52"/>' : '<rect x="4" y="4" width="100" height="100" rx="22"/>'}</clipPath></defs><g clip-path="url(#shape)"><g transform="translate(54 54) scale(1.32) translate(-54 -54)">${background108()}${foreground108()}</g></g>`);
    await render(`mipmap-${d}/ic_launcher.png`, legacy(false), l, l);
    await render(`mipmap-${d}/ic_launcher_round.png`, legacy(true), l, l);
  }
  await render('drawable-xxxhdpi/brand_mark.png', svg('16 18 76 76', 192, 192, foreground108()), 192, 192);
  await render('playstore/ic_launcher-playstore.png', svg('9 9 90 90', 512, 512, background108() + foreground108()), 512, 512, false);
  await render('drawable-nodpi/bg_space.png', spaceBackground(1440, 2560), 1440, 2560, false);
  await render('docs/wordmark.png', wordmark(1600, 260), 1600, 260);
  const bgData = 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, 'drawable-nodpi/bg_space.png')).toString('base64');
  await render('playstore/feature-graphic.png', featureGraphic().replace('href="BG"', `href="${bgData}"`), 1024, 500, false);
  await render('docs/icon-preview.png', `<div style="display:flex;gap:24px;padding:24px;background:#1b1f2a">
     <div style="width:192px;height:192px;border-radius:50%;overflow:hidden">${svg('0 0 108 108', 192, 192, background108() + foreground108()).replace('<svg ', '<svg style="transform:scale(1.5);transform-origin:50% 50%" ')}</div>
     <div style="width:192px;height:192px;border-radius:40px;overflow:hidden">${svg('0 0 108 108', 192, 192, background108() + foreground108()).replace('<svg ', '<svg style="transform:scale(1.5);transform-origin:50% 50%" ')}</div>
     <img src="${'data:image/png;base64,' + fs.readFileSync(path.join(OUT, 'mipmap-xxxhdpi/ic_launcher.png')).toString('base64')}" width="192" height="192">
     <img src="${'data:image/png;base64,' + fs.readFileSync(path.join(OUT, 'mipmap-xxxhdpi/ic_launcher_round.png')).toString('base64')}" width="192" height="192">
     </div>`, 912, 240, false);
  await browser.close();
})();
