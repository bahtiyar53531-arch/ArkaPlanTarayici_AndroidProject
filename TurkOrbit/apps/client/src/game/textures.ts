/**
 * Prosedürel (kodla üretilen) dokular: görsel dosya indirmeden hızlı açılış ve küçük paket boyutu.
 * Gemi dokusu Aşama 6'daki ShipArt SVG çiziminden üretilir (aynı tasarım dili).
 */
import Phaser from 'phaser';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ShipArt } from '../components/ShipArt';

/** ShipArt bileşenini ayrık bir DOM düğümüne çizip SVG metnini alır (react-dom/server paketi gerekmez). */
export function shipSvgDataUrl(spriteKey: string, color: string, size = 128): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(createElement(ShipArt, { spriteKey, color, size })));
  const svg = host.innerHTML;
  root.unmount();
  const markup = svg.includes('xmlns=') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  // Phaser yükleyicisi data: adreslerini base64 olarak çözer; UTF-8 güvenli base64 üretilir.
  const bytes = new TextEncoder().encode(markup);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/** Tekrarlanabilir rastgele sayı üreteci (harita koduna göre aynı yıldız/asteroit düzeni). */
export function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStarTexture(scene: Phaser.Scene, key: string, count: number, maxSize: number, alpha: number, seed: string) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const size = 512;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const rnd = seeded(seed);
  for (let i = 0; i < count; i++) {
    const r = 0.4 + rnd() * maxSize;
    const tint = rnd() < 0.15 ? 0x9fe6ff : rnd() < 0.1 ? 0xffd9a0 : 0xffffff;
    g.fillStyle(tint, alpha * (0.4 + rnd() * 0.6));
    g.fillCircle(rnd() * size, rnd() * size, r);
  }
  g.generateTexture(key, size, size);
  g.destroy();
}

export function createGlowTexture(scene: Phaser.Scene, key: string, radius: number) {
  if (scene.textures.exists(key)) return;
  const c = scene.textures.createCanvas(key, radius * 2, radius * 2);
  if (!c) return;
  const ctx = c.getContext();
  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, radius * 2, radius * 2);
  c.refresh();
}

export function createPortalTexture(scene: Phaser.Scene) {
  if (scene.textures.exists('portal')) return;
  const size = 256;
  const c = scene.textures.createCanvas('portal', size, size);
  if (!c) return;
  const ctx = c.getContext();
  const mid = size / 2;
  const grad = ctx.createRadialGradient(mid, mid, 20, mid, mid, mid);
  grad.addColorStop(0, 'rgba(41,197,255,0)');
  grad.addColorStop(0.55, 'rgba(41,197,255,0.15)');
  grad.addColorStop(0.8, 'rgba(120,230,255,0.85)');
  grad.addColorStop(1, 'rgba(41,197,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(mid, mid, mid, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(220,250,255,0.9)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(mid, mid, mid * 0.78, (i * Math.PI) / 3, (i * Math.PI) / 3 + 0.6);
    ctx.stroke();
  }
  c.refresh();
}

export function createStationTexture(scene: Phaser.Scene) {
  if (scene.textures.exists('station')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const s = 320;
  const m = s / 2;
  g.fillStyle(0x0d1530, 1);
  g.lineStyle(6, 0x5b6b8c, 1);
  const hex = (r: number) => Array.from({ length: 6 }, (_, i) => new Phaser.Math.Vector2(m + r * Math.cos((Math.PI / 3) * i + Math.PI / 6), m + r * Math.sin((Math.PI / 3) * i + Math.PI / 6)));
  g.fillPoints(hex(130), true);
  g.strokePoints(hex(130), true, true);
  g.fillStyle(0x23305e, 1);
  g.fillPoints(hex(80), true);
  g.lineStyle(4, 0x29c5ff, 0.9);
  g.strokeCircle(m, m, 46);
  g.fillStyle(0x29c5ff, 0.25);
  g.fillCircle(m, m, 40);
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    g.fillStyle(0x9fb0d3, 1);
    g.fillRect(m + Math.cos(a) * 140 - 10, m + Math.sin(a) * 140 - 10, 20, 20);
  }
  g.generateTexture('station', s, s);
  g.destroy();
}

export function createAsteroidTextures(scene: Phaser.Scene) {
  for (let v = 0; v < 3; v++) {
    const key = `asteroid${v}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const rnd = seeded(key);
    const pts: Phaser.Math.Vector2[] = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 26 + rnd() * 14;
      pts.push(new Phaser.Math.Vector2(48 + Math.cos(a) * r, 48 + Math.sin(a) * r));
    }
    g.fillStyle([0x6b5a48, 0x58606e, 0x7a6a52][v]!, 1);
    g.fillPoints(pts, true);
    g.lineStyle(3, 0x2a2420, 0.8);
    g.strokePoints(pts, true, true);
    g.fillStyle(0xffffff, 0.12);
    g.fillCircle(40, 40, 10);
    g.fillStyle(0x000000, 0.2);
    g.fillCircle(58, 56, 8);
    g.generateTexture(key, 96, 96);
    g.destroy();
  }
}

/**
 * NPC aile dokuları (Aşama 9): açık renkli silüetler; sahnede ailenin rengiyle boyanır (setTint).
 * Hepsi "yukarı" bakar (gemilerle aynı yön kuralı: rotation = yön + π/2).
 */
export function createNpcTextures(scene: Phaser.Scene) {
  const S = 128;
  const m = S / 2;
  const make = (key: string, draw: (g: Phaser.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    g.generateTexture(key, S, S);
    g.destroy();
  };
  const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
  const eyes = (g: Phaser.GameObjects.Graphics, y: number, dx: number) => {
    g.fillStyle(0xfff3b0, 1);
    g.fillCircle(m - dx, y, 4);
    g.fillCircle(m + dx, y, 4);
  };

  // Çakal: ince, sivri, kulaklı ok başı
  make('npc-cakal', (g) => {
    const body = [V(m, 10), V(m + 16, 36), V(m + 30, 26), V(m + 26, 58), V(m + 40, 100), V(m, 84), V(m - 40, 100), V(m - 26, 58), V(m - 30, 26), V(m - 16, 36)];
    g.fillStyle(0xe8e8e8, 1);
    g.fillPoints(body, true);
    g.lineStyle(4, 0x2a2a2a, 0.9);
    g.strokePoints(body, true, true);
    g.fillStyle(0x9a9a9a, 1);
    g.fillTriangle(m, 30, m + 12, 70, m - 12, 70);
    eyes(g, 44, 10);
  });

  // Akrep: segmentli gövde, kıskaçlar, kıvrık kuyruk ve iğne
  make('npc-akrep', (g) => {
    g.fillStyle(0xe8e8e8, 1);
    g.lineStyle(4, 0x2a2a2a, 0.9);
    for (let i = 0; i < 4; i++) {
      g.fillEllipse(m, 48 + i * 14, 40 - i * 6, 18);
      g.strokeEllipse(m, 48 + i * 14, 40 - i * 6, 18);
    }
    // kıskaçlar
    g.fillCircle(m - 28, 26, 11);
    g.fillCircle(m + 28, 26, 11);
    g.strokeCircle(m - 28, 26, 11);
    g.strokeCircle(m + 28, 26, 11);
    g.lineStyle(6, 0xe8e8e8, 1);
    g.lineBetween(m - 14, 42, m - 26, 30);
    g.lineBetween(m + 14, 42, m + 26, 30);
    // kuyruk (gövdenin arkasında yukarı kıvrılır)
    g.lineStyle(7, 0xd0d0d0, 1);
    g.beginPath();
    g.arc(m + 18, 104, 18, Math.PI, Math.PI * 1.9, false);
    g.strokePath();
    g.fillStyle(0xffe08a, 1);
    g.fillTriangle(m + 34, 92, m + 44, 84, m + 38, 100);
    eyes(g, 44, 8);
  });

  // Örümcek: yuvarlak gövde + 8 bacak
  make('npc-orumcek', (g) => {
    g.lineStyle(5, 0xd8d8d8, 1);
    for (let i = 0; i < 4; i++) {
      const y = 46 + i * 12;
      g.lineBetween(m - 16, y, m - 46, y - 18 + i * 10);
      g.lineBetween(m - 46, y - 18 + i * 10, m - 56, y + 4 + i * 6);
      g.lineBetween(m + 16, y, m + 46, y - 18 + i * 10);
      g.lineBetween(m + 46, y - 18 + i * 10, m + 56, y + 4 + i * 6);
    }
    g.fillStyle(0xe8e8e8, 1);
    g.lineStyle(4, 0x2a2a2a, 0.9);
    g.fillCircle(m, 40, 16);
    g.strokeCircle(m, 40, 16);
    g.fillEllipse(m, 78, 44, 52);
    g.strokeEllipse(m, 78, 44, 52);
    g.fillStyle(0x9a9a9a, 1);
    g.fillTriangle(m, 64, m + 9, 84, m - 9, 84);
    eyes(g, 36, 6);
  });

  // Yarasa: geniş kanat zarı
  make('npc-yarasa', (g) => {
    const wing = [V(m, 30), V(m + 22, 40), V(m + 58, 30), V(m + 50, 58), V(m + 60, 72), V(m + 36, 70), V(m + 26, 86), V(m, 76), V(m - 26, 86), V(m - 36, 70), V(m - 60, 72), V(m - 50, 58), V(m - 58, 30), V(m - 22, 40)];
    g.fillStyle(0xe2e2e2, 1);
    g.fillPoints(wing, true);
    g.lineStyle(4, 0x2a2a2a, 0.9);
    g.strokePoints(wing, true, true);
    g.fillStyle(0xbdbdbd, 1);
    g.fillEllipse(m, 56, 22, 38);
    g.fillTriangle(m - 8, 40, m - 4, 26, m, 40);
    g.fillTriangle(m + 8, 40, m + 4, 26, m, 40);
    eyes(g, 46, 5);
  });

  // Kargo kutusu
  if (!scene.textures.exists('cargo')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xf5b700, 0.25);
    g.fillCircle(32, 32, 30);
    g.fillStyle(0x8a5a00, 1);
    g.fillRoundedRect(14, 14, 36, 36, 6);
    g.lineStyle(4, 0xffd75e, 1);
    g.strokeRoundedRect(14, 14, 36, 36, 6);
    g.lineBetween(14, 32, 50, 32);
    g.lineBetween(32, 14, 32, 50);
    g.generateTexture('cargo', 64, 64);
    g.destroy();
  }

  // Aşama 11: maden noktası (açık renkli kristal kümesi; sahnede kaynağın rengine boyanır)
  if (!scene.textures.exists('resource')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 0.16);
    g.fillCircle(40, 40, 38);
    const crystal = (cx: number, cy: number, w: number, h: number, a: number) => {
      g.fillStyle(0xffffff, a);
      g.fillPoints([new Phaser.Math.Vector2(cx, cy - h), new Phaser.Math.Vector2(cx + w, cy), new Phaser.Math.Vector2(cx, cy + h * 0.55), new Phaser.Math.Vector2(cx - w, cy)], true);
      g.lineStyle(2, 0xffffff, 1);
      g.strokePoints([new Phaser.Math.Vector2(cx, cy - h), new Phaser.Math.Vector2(cx + w, cy), new Phaser.Math.Vector2(cx, cy + h * 0.55), new Phaser.Math.Vector2(cx - w, cy)], true);
    };
    crystal(40, 44, 12, 30, 0.95);
    crystal(24, 52, 9, 20, 0.8);
    crystal(56, 54, 9, 18, 0.8);
    g.generateTexture('resource', 80, 80);
    g.destroy();
  }
}
