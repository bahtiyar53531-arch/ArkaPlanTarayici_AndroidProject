import Phaser from 'phaser';
import type { GameController, Vec } from './controller';
import {
  createAsteroidTextures,
  createGlowTexture,
  createPortalTexture,
  createStarTexture,
  createStationTexture,
  seeded,
  shipSvgDataUrl,
} from './textures';

export interface SceneData {
  controller: GameController;
  touch: boolean;
}

const BG_COLORS: Record<string, number> = {
  starter: 0x050a1c,
  company: 0x060a1e,
  border: 0x0a0718,
  core: 0x12060c,
  special: 0x050816,
  event: 0x050816,
  gate: 0x050816,
};

const hex = (c: string) => Number.parseInt(c.replace('#', ''), 16);

/** Klavye kodları: ayarlardaki tuşlar + ok tuşları. */
function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export class SpaceScene extends Phaser.Scene {
  private c!: GameController;
  private touch = false;
  private ship!: Phaser.GameObjects.Image;
  private pos: Vec = { x: 0, y: 0 };
  private vel: Vec = { x: 0, y: 0 };
  private heading = -Math.PI / 2;
  private target: Vec | null = null;
  private targetMarker!: Phaser.GameObjects.Arc;
  private stars: Array<{ sprite: Phaser.GameObjects.TileSprite; factor: number }> = [];
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private portalRings: Phaser.GameObjects.Arc[] = [];
  private pressed = new Set<string>();
  private seenCorrection = 0;
  private seenMap = 0;
  private lastEmit = 0;
  private zoomFactor = 1;
  private baseZoom = 0.8;
  private pinchStart: { dist: number; zoom: number } | null = null;
  private shipKey = '';
  /** Harita değişti, sahne kararıp yeniden başlıyor: eski haritanın konumu artık yazılmamalı. */
  private leaving = false;
  /** Hareket simülasyonu için gerçek zaman (Phaser'ın yumuşatılmış delta'sı düşük FPS'te zamanı kısar). */
  private lastNow = 0;

  constructor() {
    super('space');
  }

  init(data: SceneData) {
    this.c = data.controller;
    this.touch = data.touch;
    this.seenCorrection = this.c.correctionSeq;
    this.seenMap = this.c.mapSeq;
    this.target = null;
    this.vel = { x: 0, y: 0 };
    this.stars = [];
    this.portalRings = [];
    this.emitter = null;
    this.leaving = false;
    this.lastNow = 0;
  }

  preload() {
    const { ship, company } = this.c.map.pilot;
    this.shipKey = `ship:${ship.spriteKey}:${company.colorHex}`;
    if (!this.textures.exists(this.shipKey)) {
      this.load.svg(this.shipKey, shipSvgDataUrl(ship.spriteKey, company.colorHex, 128), { width: 128, height: 128 });
    }
  }

  create() {
    const m = this.c.map;
    const q = this.c.settings.graphics.quality;
    const w = m.map.width;
    const h = m.map.height;
    const cam = this.cameras.main;
    cam.setBackgroundColor(BG_COLORS[m.map.mapType] ?? 0x050816);
    cam.setBounds(-1500, -1500, w + 3000, h + 3000);
    this.baseZoom = this.touch ? (Math.min(this.scale.width, this.scale.height) < 600 ? 0.5 : 0.62) : 0.8;
    this.applyZoom();

    // --- yıldız alanı (ekrana sabit, parallax kayan katmanlar)
    const layers = q === 'low' ? [[0.08, 140, 1.1, 0.7]] : q === 'medium' ? [[0.08, 160, 1.1, 0.7], [0.25, 70, 1.6, 0.85]] : [[0.08, 180, 1.1, 0.7], [0.25, 90, 1.6, 0.85], [0.5, 40, 2.2, 1]];
    layers.forEach(([factor, count, size, alpha], i) => {
      const key = `stars-${m.map.code}-${i}`;
      createStarTexture(this, key, count!, size!, alpha!, `${m.map.code}-${i}`);
      const ts = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, key).setScrollFactor(0).setOrigin(0.5).setDepth(-100 + i);
      this.stars.push({ sprite: ts, factor: factor! });
    });
    this.layoutStars();

    // --- bulutsular (dünyada, yarı parallax)
    createGlowTexture(this, 'glow', 256);
    const rnd = seeded(`nebula-${m.map.code}`);
    const tint = m.map.company ? hex(m.map.company.colorHex) : m.map.mapType === 'core' ? 0xff4d6d : 0x8b5cf6;
    for (let i = 0; i < (q === 'low' ? 2 : 4); i++) {
      this.add
        .image(rnd() * w, rnd() * h, 'glow')
        .setScale(10 + rnd() * 14)
        .setTint(i % 2 ? tint : 0x29c5ff)
        .setAlpha(0.07 + rnd() * 0.05)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScrollFactor(0.6)
        .setDepth(-50);
    }

    // --- ızgara ve harita sınırı
    const grid = this.add.graphics().setDepth(-40);
    grid.lineStyle(2, 0x29c5ff, 0.05);
    for (let x = 0; x <= w; x += 1000) grid.lineBetween(x, 0, x, h);
    for (let y = 0; y <= h; y += 1000) grid.lineBetween(0, y, w, y);
    grid.lineStyle(8, 0xff4d6d, 0.45);
    grid.strokeRect(0, 0, w, h);

    // --- bölgeler
    createStationTexture(this);
    createAsteroidTextures(this);
    for (const z of m.zones) {
      if (z.zoneType === 'safe') {
        this.add.circle(z.x, z.y, z.r, 0x34d399, 0.04).setStrokeStyle(6, 0x34d399, 0.25).setDepth(-30);
      } else if (z.zoneType === 'station') {
        const st = this.add.image(z.x, z.y, 'station').setDepth(-20).setScale(1.6);
        this.tweens.add({ targets: st, angle: 360, duration: 240000, repeat: -1 });
        this.add.text(z.x, z.y + 340, z.name, { fontFamily: 'system-ui, sans-serif', fontSize: '56px', color: '#cfe8ff' }).setOrigin(0.5).setAlpha(0.85).setDepth(-19);
      } else if (z.zoneType === 'resource') {
        const zr = seeded(`ast-${z.id}`);
        const n = q === 'low' ? 10 : q === 'medium' ? 22 : 36;
        for (let i = 0; i < n; i++) {
          const a = zr() * Math.PI * 2;
          const d = Math.sqrt(zr()) * z.r;
          const ast = this.add.image(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, `asteroid${i % 3}`).setScale(0.6 + zr() * 1.4).setAngle(zr() * 360).setDepth(-25);
          if (q !== 'low') this.tweens.add({ targets: ast, angle: ast.angle + (zr() < 0.5 ? 360 : -360), duration: 60000 + zr() * 90000, repeat: -1 });
        }
        this.add.text(z.x, z.y - z.r - 60, z.name, { fontFamily: 'system-ui, sans-serif', fontSize: '48px', color: '#d6c3a5' }).setOrigin(0.5).setAlpha(0.6).setDepth(-24);
      }
    }

    // --- portallar
    createPortalTexture(this);
    for (const p of m.portals) {
      const ok = p.access.ok;
      const img = this.add.image(p.x, p.y, 'portal').setScale(1.4).setDepth(-10).setTint(ok ? 0xffffff : 0xff6b6b);
      this.tweens.add({ targets: img, angle: 360, duration: ok ? 9000 : 18000, repeat: -1 });
      const ring = this.add.circle(p.x, p.y, m.rules.jumpRadius, 0x29c5ff, 0).setStrokeStyle(4, ok ? 0x29c5ff : 0xff6b6b, 0.0).setDepth(-11);
      this.portalRings.push(ring);
      this.add
        .text(p.x, p.y + 230, `${ok ? '' : '🔒 '}${p.target.code} · ${p.target.name}`, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '52px',
          color: ok ? '#bff1ff' : '#ffb4b4',
          stroke: '#050816',
          strokeThickness: 8,
        })
        .setOrigin(0.5)
        .setDepth(-9);
    }

    // --- gemi
    this.pos = { ...this.c.state.position };
    this.heading = this.c.state.heading;
    if (q !== 'low') {
      this.emitter = this.add.particles(0, 0, 'glow', {
        speed: { min: 10, max: 40 },
        lifespan: 450,
        scale: { start: 0.18, end: 0 },
        alpha: { start: 0.8, end: 0 },
        tint: hex(m.pilot.company.colorHex),
        blendMode: Phaser.BlendModes.ADD,
        frequency: q === 'high' ? 18 : 40,
        emitting: false,
      });
      this.emitter.setDepth(4);
    }
    this.ship = this.add.image(this.pos.x, this.pos.y, this.shipKey).setDepth(5).setScale(1.1);
    this.ship.rotation = this.heading + Math.PI / 2;
    this.targetMarker = this.add.circle(0, 0, 28, 0x29c5ff, 0.15).setStrokeStyle(4, 0x29c5ff, 0.9).setVisible(false).setDepth(3);
    cam.startFollow(this.ship, true, 0.12, 0.12);
    cam.centerOn(this.pos.x, this.pos.y);
    cam.fadeIn(350, 5, 8, 22);

    // --- girdiler
    this.input.addPointer(1);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) return;
      if (this.touch && this.c.settings.controls.mode !== 'tap') return;
      this.target = { x: Phaser.Math.Clamp(p.worldX, 0, w), y: Phaser.Math.Clamp(p.worldY, 0, h) };
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.changeZoom(dy > 0 ? -0.1 : 0.1));
    const down = (e: KeyboardEvent) => {
      if (!isTyping(e)) this.pressed.add(e.code);
    };
    const up = (e: KeyboardEvent) => this.pressed.delete(e.code);
    const blur = () => this.pressed.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.scale.on('resize', this.layoutStars, this);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      this.scale.off('resize', this.layoutStars, this);
    });
  }

  private applyZoom() {
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.baseZoom * this.zoomFactor, 0.3, 1.5));
    this.layoutStars();
  }

  private changeZoom(d: number) {
    this.zoomFactor = Phaser.Math.Clamp(this.zoomFactor + d, 0.5, 1.8);
    this.applyZoom();
  }

  /** Yıldız katmanlarını yakınlaştırmadan bağımsız olarak ekranı kaplayacak şekilde yerleştirir. */
  private layoutStars() {
    const cam = this.cameras.main;
    for (const s of this.stars) {
      s.sprite.setPosition(cam.width / 2, cam.height / 2);
      s.sprite.setSize(cam.width, cam.height);
      s.sprite.setScale(1 / cam.zoom);
    }
  }

  /** Tek simülasyon adımı; sunucunun doğruladığı gemi hızını asla aşmaz. Hız büyüklüğünü döner. */
  private integrate(dt: number, dx: number, dy: number, speed: number, w: number, h: number): number {
    let desired = { x: 0, y: 0 };
    const mag = Math.hypot(dx, dy);
    if (mag > 0) {
      const m = Math.min(1, mag);
      desired = { x: (dx / mag) * speed * m, y: (dy / mag) * speed * m };
      this.target = null;
    } else if (this.target) {
      const tx = this.target.x - this.pos.x;
      const ty = this.target.y - this.pos.y;
      const d = Math.hypot(tx, ty);
      if (d < 8) this.target = null;
      else {
        const s = speed * Math.min(1, d / 160);
        desired = { x: (tx / d) * s, y: (ty / d) * s };
      }
    }
    const a = 1 - Math.exp(-dt * 6);
    this.vel.x += (desired.x - this.vel.x) * a;
    this.vel.y += (desired.y - this.vel.y) * a;
    let v = Math.hypot(this.vel.x, this.vel.y);
    if (v > speed) {
      this.vel.x *= speed / v;
      this.vel.y *= speed / v;
      v = speed;
    }
    this.pos.x = Phaser.Math.Clamp(this.pos.x + this.vel.x * dt, 0, w);
    this.pos.y = Phaser.Math.Clamp(this.pos.y + this.vel.y * dt, 0, h);
    if (v > 6) this.heading = Phaser.Math.Angle.RotateTo(this.heading, Math.atan2(this.vel.y, this.vel.x), 6 * dt);
    return v;
  }

  update(_time: number, delta: number) {
    const c = this.c;
    if (this.leaving) return;
    if (c.mapSeq !== this.seenMap) {
      this.seenMap = c.mapSeq;
      this.leaving = true;
      this.cameras.main.fadeOut(250, 5, 8, 22);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({ controller: c, touch: this.touch }));
      return;
    }
    const { width: w, height: h } = c.map.map;
    if (c.correctionSeq !== this.seenCorrection) {
      this.seenCorrection = c.correctionSeq;
      this.pos = { ...c.state.position };
      this.vel = { x: 0, y: 0 };
      this.target = null;
    }
    if (c.pendingTarget) {
      this.target = c.pendingTarget;
      c.pendingTarget = null;
    }
    if (c.zoomDelta) {
      this.changeZoom(c.zoomDelta);
      c.zoomDelta = 0;
    }

    // --- pinch yakınlaştırma (iki parmak)
    const p1 = this.input.pointer1;
    const p2 = this.input.pointer2;
    if (p1.isDown && p2.isDown) {
      const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      if (!this.pinchStart) this.pinchStart = { dist, zoom: this.zoomFactor };
      else {
        this.zoomFactor = Phaser.Math.Clamp(this.pinchStart.zoom * (dist / this.pinchStart.dist), 0.5, 1.8);
        this.applyZoom();
      }
    } else this.pinchStart = null;

    // --- yön girdisi: klavye (PC) veya sanal joystick (dokunmatik)
    const k = c.settings.keys;
    let dx = 0;
    let dy = 0;
    if (c.settings.controls.keyboardMove) {
      if (this.pressed.has(k.left) || this.pressed.has('ArrowLeft')) dx -= 1;
      if (this.pressed.has(k.right) || this.pressed.has('ArrowRight')) dx += 1;
      if (this.pressed.has(k.up) || this.pressed.has('ArrowUp')) dy -= 1;
      if (this.pressed.has(k.down) || this.pressed.has('ArrowDown')) dy += 1;
    }
    const joy = c.joystick;
    if (Math.hypot(joy.x, joy.y) > 0.15) {
      dx = joy.x;
      dy = joy.y;
    }

    // --- hareket: düşük FPS'te de gerçek süreye göre ilerlesin diye ≤50 ms'lik alt adımlarla
    // (1 sn'den uzun boşluk sekme değişimi/duraklatma sayılır ve atlanır)
    const speed = c.map.pilot.ship.speed;
    const now = performance.now();
    const realMs = this.lastNow ? now - this.lastNow : delta;
    this.lastNow = now;
    let remaining = realMs > 1000 ? 0 : realMs / 1000;
    let v = Math.hypot(this.vel.x, this.vel.y);
    while (remaining > 0) {
      const dt = Math.min(remaining, 0.05);
      remaining -= dt;
      v = this.integrate(dt, dx, dy, speed, w, h);
    }
    const moving = v > 6;
    this.ship.setPosition(this.pos.x, this.pos.y);
    this.ship.rotation = this.heading + Math.PI / 2;
    if (this.emitter) {
      this.emitter.emitting = moving;
      this.emitter.setPosition(this.pos.x - Math.cos(this.heading) * 52, this.pos.y - Math.sin(this.heading) * 52);
    }
    this.targetMarker.setVisible(!!this.target);
    if (this.target) this.targetMarker.setPosition(this.target.x, this.target.y);

    // --- yakın geçit
    let near = null;
    let nearD = Infinity;
    c.map.portals.forEach((p, i) => {
      const d = Math.hypot(p.x - this.pos.x, p.y - this.pos.y);
      const inside = d <= c.map.rules.jumpRadius;
      this.portalRings[i]?.setStrokeStyle(4, p.access.ok ? 0x29c5ff : 0xff6b6b, inside ? 0.7 : d < 2000 ? 0.25 : 0);
      if (inside && d < nearD) {
        near = p;
        nearD = d;
      }
    });

    // --- parallax
    const cam = this.cameras.main;
    for (const s of this.stars) {
      s.sprite.tilePositionX = cam.scrollX * s.factor;
      s.sprite.tilePositionY = cam.scrollY * s.factor;
    }

    // --- HUD durumu (10 Hz)
    const st = c.state;
    st.position = { x: this.pos.x, y: this.pos.y };
    st.heading = this.heading;
    st.moving = moving;
    st.target = this.target;
    const nearChanged = st.nearPortal?.id !== (near as { id: number } | null)?.id;
    st.nearPortal = near;
    if (nearChanged || _time - this.lastEmit > 100) {
      st.fps = Math.round(this.game.loop.actualFps);
      this.lastEmit = _time;
      c.emit();
    }
  }
}
