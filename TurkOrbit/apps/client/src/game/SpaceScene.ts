import { AMMO_COLORS, AMMO_CODES } from '@turkorbit/shared';
import Phaser from 'phaser';
import type { GameController, Vec } from './controller';
import {
  createAsteroidTextures,
  createNpcTextures,
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
  private heading = -Math.PI / 2;
  /** Diğer pilotların gemileri ve ad etiketleri */
  private remotes = new Map<number, { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text | null; bars: Phaser.GameObjects.Graphics; key: string; size: number }>();
  private targetRing!: Phaser.GameObjects.Graphics;
  private burst: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private loadingKeys = new Set<string>();
  private nameLabel!: Phaser.GameObjects.Text;
  private targetMarker!: Phaser.GameObjects.Arc;
  private stars: Array<{ sprite: Phaser.GameObjects.TileSprite; factor: number }> = [];
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private portalRings: Phaser.GameObjects.Arc[] = [];
  private pressed = new Set<string>();
  private seenMap = 0;
  private lastEmit = 0;
  private zoomFactor = 1;
  private baseZoom = 0.8;
  private pinchStart: { dist: number; zoom: number } | null = null;
  private shipKey = '';
  /** Harita değişti, sahne kararıp yeniden başlıyor: eski haritanın konumu artık yazılmamalı. */
  private leaving = false;

  constructor() {
    super('space');
  }

  init(data: SceneData) {
    this.c = data.controller;
    this.touch = data.touch;
    this.seenMap = this.c.mapSeq;
    this.remotes = new Map();
    this.stars = [];
    this.portalRings = [];
    this.emitter = null;
    this.leaving = false;
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
    createNpcTextures(this);
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
    this.nameLabel = this.add
      .text(this.pos.x, this.pos.y - 95, m.pilot.pilotName, { fontFamily: 'system-ui, sans-serif', fontSize: '34px', color: '#ffffff', stroke: '#050816', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(6)
      .setAlpha(0.9);
    this.targetRing = this.add.graphics().setDepth(7);
    this.burst = this.add.particles(0, 0, 'glow', {
      speed: { min: 60, max: 260 },
      lifespan: 700,
      scale: { start: 0.5, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffd27f, 0xff8a3d, 0xff4d4d],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.burst.setDepth(8);
    this.targetMarker = this.add.circle(0, 0, 28, 0x29c5ff, 0.15).setStrokeStyle(4, 0x29c5ff, 0.9).setVisible(false).setDepth(3);
    cam.startFollow(this.ship, true, 0.12, 0.12);
    cam.centerOn(this.pos.x, this.pos.y);
    cam.fadeIn(350, 5, 8, 22);

    // --- girdiler
    this.input.addPointer(1);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) return;
      // Önce bir gemiye/NPC'ye tıklandı mı bak: hedef seçimi (kargo kutusuna tıklanınca oraya gidilir)
      const hit = this.pick(p.worldX, p.worldY);
      if (hit && hit.k !== 'c') {
        this.c.selectTarget(hit.id);
        return;
      }
      if (this.touch && this.c.settings.controls.mode !== 'tap' && !hit) return;
      this.c.setTarget({ x: Phaser.Math.Clamp(p.worldX, 0, w), y: Phaser.Math.Clamp(p.worldY, 0, h) });
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

  update(time: number) {
    const c = this.c;
    if (this.leaving) return;
    if (c.mapSeq !== this.seenMap) {
      this.seenMap = c.mapSeq;
      this.leaving = true;
      this.cameras.main.fadeOut(250, 5, 8, 22);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({ controller: c, touch: this.touch }));
      return;
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

    // --- hareket: kontrolcü sunucuyla aynı simülasyonu sabit adımlarla tahmin eder (gerçek zamana göre)
    const r = c.update(performance.now(), { x: dx, y: dy });
    this.pos = { x: r.x, y: r.y };
    this.heading = r.h;
    this.ship.setPosition(r.x, r.y);
    this.ship.rotation = r.h + Math.PI / 2;
    this.nameLabel.setPosition(r.x, r.y - 95);
    const alive = !c.state.dead;
    this.ship.setVisible(alive);
    this.nameLabel.setVisible(alive);
    if (this.emitter) {
      this.emitter.emitting = r.moving && alive;
      this.emitter.setPosition(r.x - Math.cos(r.h) * 52, r.y - Math.sin(r.h) * 52);
    }
    const target = c.state.target;
    this.targetMarker.setVisible(!!target);
    if (target) this.targetMarker.setPosition(target.x, target.y);
    this.syncRemotes();
    this.drawTargetRing();
    this.playFx();

    // --- yakın geçit
    let near = null;
    let nearD = Infinity;
    c.map.portals.forEach((p, i) => {
      const d = Math.hypot(p.x - r.x, p.y - r.y);
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
    st.position = { x: r.x, y: r.y };
    st.heading = r.h;
    st.moving = r.moving;
    const nearChanged = st.nearPortal?.id !== (near as { id: number } | null)?.id;
    st.nearPortal = near;
    if (nearChanged || time - this.lastEmit > 100) {
      st.fps = Math.round(this.game.loop.actualFps);
      this.lastEmit = time;
      c.emit();
    }
  }

  /** Diğer pilotları, NPC'leri ve kargo kutularını kontrolcünün enterpolasyonlu konumlarıyla eşler. */
  private syncRemotes() {
    const targetId = this.c.state.combat.target;
    for (const [id, s] of this.c.ships) {
      if (!Number.isFinite(s.x)) continue;
      let r = this.remotes.get(id);
      if (!r) {
        const k = s.info.k;
        const key = k === 'p' ? `ship:${s.info.s}:${s.info.c}` : k === 'n' ? s.info.s : 'cargo';
        if (k === 'p' && !this.textures.exists(key)) this.loadShipTexture(key, s.info.s, s.info.c);
        const img = this.add.image(s.x, s.y, this.textures.exists(key) ? key : this.shipKey).setDepth(k === 'c' ? 2 : 4);
        let size = 1.1;
        if (k === 'n') {
          size = 0.95 * (s.info.z ?? 1);
          img.setTint(Number.parseInt(s.info.c.slice(1), 16));
        } else if (k === 'c') {
          size = 1;
          this.tweens.add({ targets: img, angle: 360, duration: 6000, repeat: -1 });
        }
        img.setScale(size);
        const label =
          k === 'c'
            ? null
            : this.add
                .text(s.x, s.y - 95 * size, k === 'n' ? `${s.info.n} · Sv ${s.info.l}${s.info.b ? ' ★' : ''}` : `${s.info.n} · Sv ${s.info.l}`, {
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: '34px',
                  color: s.info.c,
                  stroke: '#050816',
                  strokeThickness: 6,
                })
                .setOrigin(0.5)
                .setDepth(6);
        r = { img, label, bars: this.add.graphics().setDepth(6), key, size };
        this.remotes.set(id, r);
      }
      if (r.img.texture.key !== r.key && this.textures.exists(r.key)) r.img.setTexture(r.key);
      r.img.setPosition(s.x, s.y);
      if (s.info.k !== 'c') r.img.rotation = s.h + Math.PI / 2;
      r.label?.setPosition(s.x, s.y - 95 * r.size);
      // Can/kalkan çubukları: hedefteyse veya hasarlıysa
      r.bars.clear();
      if (s.info.k !== 'c' && (id === targetId || s.hp < 100)) {
        const w = 110 * Math.max(0.8, r.size);
        const x0 = s.x - w / 2;
        const y0 = s.y - 70 * r.size;
        r.bars.fillStyle(0x0b1230, 0.85).fillRect(x0 - 2, y0 - 2, w + 4, 22);
        r.bars.fillStyle(0x34d399, 1).fillRect(x0, y0, (w * s.hp) / 100, 8);
        r.bars.fillStyle(0x29c5ff, 1).fillRect(x0, y0 + 10, (w * s.sh) / 100, 8);
      }
    }
    for (const [id, r] of this.remotes) {
      if (!this.c.ships.has(id)) {
        r.img.destroy();
        r.label?.destroy();
        r.bars.destroy();
        this.remotes.delete(id);
      }
    }
  }

  /** Tıklanan dünya noktasına en yakın varlık (ekranda ~40 piksel içinde). */
  private pick(wx: number, wy: number): { id: number; k: 'p' | 'n' | 'c' } | null {
    const radius = 70 / this.cameras.main.zoom;
    let best: { id: number; k: 'p' | 'n' | 'c' } | null = null;
    let bestD = radius;
    for (const [id, s] of this.c.ships) {
      if (!Number.isFinite(s.x)) continue;
      const d = Math.hypot(s.x - wx, s.y - wy) - (s.info.k === 'n' ? 30 * (s.info.z ?? 1) : 0);
      if (d < bestD) {
        bestD = d;
        best = { id, k: s.info.k };
      }
    }
    return best;
  }

  private posOf(id: number): Vec | null {
    if (id === this.c.myEntityId) return this.pos;
    const s = this.c.ships.get(id);
    return s && Number.isFinite(s.x) ? { x: s.x, y: s.y } : null;
  }

  private drawTargetRing() {
    this.targetRing.clear();
    const id = this.c.state.combat.target;
    if (id === null) return;
    const p = this.posOf(id);
    if (!p) return;
    const s = this.c.ships.get(id);
    const r = 70 * Math.max(0.9, s?.info.z ?? 1);
    const t = this.time.now / 1000;
    const color = this.c.state.combat.attacking ? 0xff4d4d : 0xffd166;
    this.targetRing.lineStyle(5, color, 0.95);
    for (let i = 0; i < 4; i++) {
      const a = t * 1.5 + (i * Math.PI) / 2;
      this.targetRing.beginPath();
      this.targetRing.arc(p.x, p.y, r, a, a + 0.9);
      this.targetRing.strokePath();
    }
  }

  /** Sunucudan gelen efektleri çizer: lazer, roket, hasar sayısı, patlama. */
  private playFx() {
    const q = this.c.fxQueue;
    if (q.length === 0) return;
    const items = q.splice(0, q.length);
    const me = this.c.myEntityId;
    for (const f of items) {
      if (f[0] === 'l' || f[0] === 'r') {
        const from = this.posOf(f[1]);
        const to = this.posOf(f[2]);
        if (!from || !to) continue;
        if (f[0] === 'l') {
          const color = f[3] === 9 ? 0xff8844 : (AMMO_COLORS[AMMO_CODES[f[3]] ?? 'ammo.isk1'] ?? 0xff4d4d);
          const g = this.add.graphics().setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
          g.lineStyle(10, color, 0.25).lineBetween(from.x, from.y, to.x, to.y);
          g.lineStyle(4, color, 1).lineBetween(from.x, from.y, to.x, to.y);
          this.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
        } else {
          const rocket = this.add.image(from.x, from.y, 'glow').setScale(0.35).setTint(0xffa040).setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({ targets: rocket, x: to.x, y: to.y, duration: 320, onComplete: () => rocket.destroy() });
        }
      } else if (f[0] === 'd') {
        const p = this.posOf(f[1]);
        if (!p || f[2] <= 0) continue;
        const mine = f[1] === me;
        const txt = this.add
          // Hedefin sağ yanında çıkar: üstteki ad etiketi ve can çubuğuyla çakışmaz
          .text(p.x + 70 + Math.random() * 40, p.y - 10 + (Math.random() - 0.5) * 30, f[2].toLocaleString('tr-TR'), {
            fontFamily: 'system-ui, sans-serif',
            fontSize: '44px',
            fontStyle: 'bold',
            color: mine ? '#ff6b6b' : f[3] === 1 ? '#7fdcff' : '#ffd166',
            stroke: '#050816',
            strokeThickness: 7,
          })
          .setOrigin(0.5)
          .setDepth(9);
        this.tweens.add({ targets: txt, y: txt.y - 60, alpha: 0, duration: 900, onComplete: () => txt.destroy() });
      } else if (f[0] === 'x') {
        const [, id, x, y, size] = f;
        this.burst?.explode(Math.round(24 * size), x, y);
        const flash = this.add.circle(x, y, 40 * size, 0xffd27f, 0.8).setDepth(8).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: flash, scale: 3, alpha: 0, duration: 450, onComplete: () => flash.destroy() });
        if (id === me) this.cameras.main.shake(400, 0.012);
      }
    }
  }

  private loadShipTexture(key: string, spriteKey: string, color: string) {
    if (this.loadingKeys.has(key)) return;
    this.loadingKeys.add(key);
    this.load.svg(key, shipSvgDataUrl(spriteKey, color, 128), { width: 128, height: 128 });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.loadingKeys.delete(key));
    if (!this.load.isLoading()) this.load.start();
  }
}
