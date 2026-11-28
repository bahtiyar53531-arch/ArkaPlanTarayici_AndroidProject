import { AMMO_CODES, AMMO_COLORS, AMMO_LABELS, ROCKET_LABELS, type GalaxyResponse, type PlayerSettings, type QuestView } from '@turkorbit/shared';
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { SERVER, type GameController } from '../../game/controller';
import { fmt } from '../../lib/format';
import { QuestBoard } from '../quests/QuestBoard';

export function useController(c: GameController) {
  // Kontrolcü durumu nesnesi yerinde değişir; sürüm sayacıyla React'e bildirilir.
  const ver = useRef(0);
  return useSyncExternalStore(
    (cb) =>
      c.subscribe(() => {
        ver.current++;
        cb();
      }),
    () => ver.current,
  );
}

// ====================================================================== pilot paneli
export function PilotPanel({ c }: { c: GameController }) {
  useController(c);
  const { pilot, map } = c.map;
  const s = c.state;
  return (
    <div className="hud-panel hud-pilot">
      <div className="hud-pilot-name">
        <span className="hud-dot" style={{ background: pilot.company.colorHex }} />
        <b>{pilot.pilotName}</b>
        <span className="hud-level">Sv {pilot.level}</span>
      </div>
      <div className="hud-bar hp" title="Can" data-testid="hud-hp">
        <span style={{ width: `${(s.hp / Math.max(1, s.maxHp)) * 100}%` }} />
        <em>{fmt(s.hp)} / {fmt(s.maxHp)}</em>
      </div>
      <div className="hud-bar sh" title="Kalkan" data-testid="hud-shield">
        <span style={{ width: `${s.maxShield > 0 ? (s.shield / s.maxShield) * 100 : 0}%` }} />
        <em>{fmt(s.shield)} / {fmt(s.maxShield)}</em>
      </div>
      <div className="hud-map">
        <b>{map.code}</b> {map.name} {map.pvpEnabled ? <span className="hud-tag danger">PvP</span> : <span className="hud-tag ok">Güvenli</span>}
      </div>
      {s.combat.cargo[1] > 0 && (
        <div className={`hud-cargo${s.combat.cargo[0] >= s.combat.cargo[1] ? ' full' : ''}`} data-testid="hud-cargo" title="Gemi ambarındaki kaynak">
          Ambar {fmt(s.combat.cargo[0])} / {fmt(s.combat.cargo[1])}
        </div>
      )}
      {c.settings.hud.showCoordinates && (
        <div className="hud-coords" data-testid="hud-coords">
          {Math.round(s.position.x)} / {Math.round(s.position.y)}
        </div>
      )}
      {(c.settings.graphics.showFps || s.ping !== null) && (
        <div className="hud-fps">
          {c.settings.graphics.showFps && <span data-testid="hud-fps">{s.fps} FPS</span>}
          {s.ping !== null && <span data-testid="hud-ping" className={s.ping > 250 ? 'bad' : s.ping > 120 ? 'warn' : ''}>Ping {s.ping} ms</span>}
        </div>
      )}
    </div>
  );
}

// ====================================================================== mini harita
const MINIMAP_SIZES = { small: 150, medium: 210, large: 290 } as const;

export function Minimap({ c }: { c: GameController }) {
  useController(c);
  const ref = useRef<HTMLCanvasElement>(null);
  const w = MINIMAP_SIZES[c.settings.hud.minimapSize];
  const { width: mw, height: mh } = c.map.map;
  const h = Math.round((w * mh) / mw);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 120) return; // ~8 fps: pil ve işlemci dostu
      last = t;
      const cv = ref.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cv.width !== w * dpr) {
        cv.width = w * dpr;
        cv.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sx = w / mw;
      const sy = h / mh;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(5,8,22,0.85)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,77,109,0.6)';
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      // Kurallar (madde 18): NPC'ler, düşmanlar ve kargo burada sürekli gösterilmez — yalnızca sabit nesneler.
      for (const z of c.map.zones) {
        ctx.beginPath();
        ctx.arc(z.x * sx, z.y * sy, Math.max(2, z.r * sx), 0, Math.PI * 2);
        if (z.zoneType === 'safe') {
          ctx.fillStyle = 'rgba(52,211,153,0.12)';
          ctx.fill();
        } else if (z.zoneType === 'resource') {
          ctx.fillStyle = 'rgba(180,150,110,0.25)';
          ctx.fill();
        } else if (z.zoneType === 'station') {
          ctx.fillStyle = '#9fb0d3';
          ctx.fillRect(z.x * sx - 3, z.y * sy - 3, 6, 6);
        }
      }
      for (const p of c.map.portals) {
        ctx.beginPath();
        ctx.arc(p.x * sx, p.y * sy, 4, 0, Math.PI * 2);
        ctx.strokeStyle = p.access.ok ? '#29c5ff' : '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const s = c.state;
      // Radar menzili ve menzildeki diğer pilotlar (sunucu yalnızca bunları gönderir)
      ctx.strokeStyle = 'rgba(41,197,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(s.position.x * sx, s.position.y * sy, c.map.rules.detection.radar * sx, c.map.rules.detection.radar * sy, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (const o of c.ships.values()) {
        if (!Number.isFinite(o.x)) continue;
        if (o.info.k === 'c' || o.info.k === 'r') {
          // Kargo kutusu ve maden noktası (yalnızca kargo algılama menzilinde gönderilir)
          ctx.fillStyle = o.info.k === 'c' ? '#F5B700' : o.info.c;
          ctx.fillRect(o.x * sx - 2, o.y * sy - 2, o.info.k === 'c' ? 4 : 3, o.info.k === 'c' ? 4 : 3);
          continue;
        }
        ctx.beginPath();
        ctx.arc(o.x * sx, o.y * sy, o.info.k === 'n' ? 2.5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = o.info.c;
        ctx.fill();
        if (o.info.k === 'p' && o.info.cc !== c.map.pilot.company.code) {
          ctx.strokeStyle = '#ff4d6d';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      // Aşama 12: grup üyeleri (aynı haritada; konumu üyenin iznine göre gelir) — yeşil halka
      for (const m of s.party?.members ?? []) {
        if (m.you || !m.online || !m.map || m.map.code !== c.map.map.code) continue;
        const seen = m.entityId !== null ? c.ships.get(m.entityId) : undefined;
        const x = seen && Number.isFinite(seen.x) ? seen.x : m.x;
        const y = seen && Number.isFinite(seen.y) ? seen.y : m.y;
        if (x === null || y === null) continue;
        ctx.beginPath();
        ctx.arc(x * sx, y * sy, 4.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (s.target) {
        ctx.strokeStyle = 'rgba(41,197,255,0.7)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(s.position.x * sx, s.position.y * sy);
        ctx.lineTo(s.target.x * sx, s.target.y * sy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const px = s.position.x * sx;
      const py = s.position.y * sy;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(s.heading);
      ctx.fillStyle = c.map.pilot.company.colorHex;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, -4);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [c, w, h, mw, mh]);

  return (
    <div className="hud-panel hud-minimap" style={{ width: w + 12 }}>
      <div className="hud-minimap-title">{c.map.map.code} · {c.map.map.name}</div>
      <canvas
        ref={ref}
        style={{ width: w, height: h }}
        aria-label="Mini harita (hedef seçmek için dokun)"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          c.setTarget({ x: ((e.clientX - r.left) / r.width) * mw, y: ((e.clientY - r.top) / r.height) * mh });
        }}
      />
    </div>
  );
}

// ====================================================================== geçit uyarısı
export function PortalPrompt({ c }: { c: GameController }) {
  useController(c);
  const p = c.state.nearPortal;
  if (!p) return null;
  const keyLabel = c.settings.keys.jump.replace(/^Key/, '');
  return (
    <div className={`hud-panel hud-portal${p.access.ok ? '' : ' locked'}`} role="status">
      <div>
        Geçit: <b>{p.target.code}</b> {p.target.name}
        {!p.access.ok && <div className="hud-portal-reason">{p.access.reason}</div>}
      </div>
      <button type="button" className="btn btn-primary btn-small" disabled={!p.access.ok || c.state.jumping} onClick={() => c.jump()}>
        {c.state.jumping ? 'Geçiliyor…' : `Atla (${keyLabel})`}
      </button>
    </div>
  );
}

// ====================================================================== bildirim
export function Toast({ c }: { c: GameController }) {
  useController(c);
  const [visible, setVisible] = useState<number | null>(null);
  const t = c.state.toast;
  useEffect(() => {
    if (!t) return;
    setVisible(t.id);
    const timer = setTimeout(() => setVisible(null), 4500);
    return () => clearTimeout(timer);
  }, [t?.id]);
  if (!t || visible !== t.id) return null;
  return <div className={`hud-toast ${t.kind}`} role="status">{t.text}</div>;
}

// ====================================================================== sanal joystick
export function Joystick({ c, settings }: { c: GameController; settings: PlayerSettings }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const size = 130 * settings.controls.joystickSize;
  const radius = size / 2;

  const update = (e: RPointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let x = e.clientX - (r.left + radius);
    let y = e.clientY - (r.top + radius);
    const d = Math.hypot(x, y);
    if (d > radius) {
      x = (x / d) * radius;
      y = (y / d) * radius;
    }
    setKnob({ x, y });
    c.joystick = { x: x / radius, y: y / radius };
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    c.joystick = { x: 0, y: 0 };
  };
  const side = settings.controls.joystickSide;
  return (
    <div
      ref={base}
      className="hud-joystick"
      data-testid="joystick"
      aria-label="Sanal joystick"
      style={{
        width: size,
        height: size,
        opacity: settings.controls.joystickOpacity,
        bottom: `calc(${settings.controls.joystickOffsetY * 100}vh + env(safe-area-inset-bottom) + 16px)`,
        [side]: `calc(env(safe-area-inset-${side}) + 20px)`,
      }}
      onPointerDown={(e) => {
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="hud-joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)`, width: size * 0.42, height: size * 0.42 }} />
    </div>
  );
}

// ====================================================================== radar: yakındaki pilotlar
export function NearbyPanel({ c, max = 5 }: { c: GameController; max?: number }) {
  useController(c);
  const list = c.state.nearby;
  const mine = c.map.pilot.company.code;
  return (
    <div className="hud-panel hud-nearby" data-testid="nearby">
      <div className="hud-nearby-title">Radar · {list.length === 0 ? 'menzilde pilot yok' : `${list.length} pilot`}</div>
      {list.slice(0, max).map((p) => (
        <div key={p.id} className="hud-nearby-row">
          <span className="hud-dot" style={{ background: p.color }} />
          <span className={`hud-nearby-name${p.company !== mine ? ' enemy' : ''}`}>{p.name}</span>
          <span className="hud-nearby-dist">{fmt(p.distance)}</span>
        </div>
      ))}
    </div>
  );
}

// ====================================================================== bağlantı durumu
export function ConnectionBanner({ c }: { c: GameController }) {
  useController(c);
  const { conn, connMessage, reconnectAttempt } = c.state;
  if (conn === 'online') return null;
  if (conn === 'connecting' || conn === 'reconnecting') {
    return (
      <div className="hud-conn" role="status" data-testid="conn-banner">
        <span className="hud-spinner" aria-hidden="true" />
        {conn === 'connecting' ? 'Oyun sunucusuna bağlanılıyor…' : `${connMessage ?? 'Yeniden bağlanılıyor…'}${reconnectAttempt > 1 ? ` (${reconnectAttempt}. deneme)` : ''}`}
      </div>
    );
  }
  return (
    <div className="hud-overlay" role="alertdialog" aria-label="Bağlantı sonlandı" data-testid="conn-ended">
      <div className="hud-overlay-card conn">
        <h2>{conn === 'replaced' ? 'Başka bir cihazda oyundasın' : 'Bağlantı sonlandı'}</h2>
        <p>{connMessage}</p>
        <div className="conn-actions">
          {conn === 'replaced' && (
            <button type="button" className="btn btn-primary" onClick={() => c.resume()}>Bu cihazda devam et</button>
          )}
          {conn === 'ended' && (
            <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Sayfayı yenile</button>
          )}
          <Link className="btn btn-secondary" to="/hangar">Hangara dön</Link>
        </div>
      </div>
    </div>
  );
}

// ====================================================================== hedef paneli
export function TargetPanel({ c, onPilot }: { c: GameController; onPilot?: (name: string) => void }) {
  useController(c);
  const id = c.state.combat.target;
  if (id === null) return null;
  const t = c.ships.get(id);
  if (!t) return null;
  const d = Number.isFinite(t.x) ? Math.round(Math.hypot(t.x - c.state.position.x, t.y - c.state.position.y)) : null;
  const inRange = d !== null && d <= c.state.combat.laserRange;
  const enemy = t.info.k === 'n' || t.info.cc !== c.map.pilot.company.code;
  return (
    <div className={`hud-panel hud-target${enemy ? ' enemy' : ''}`} data-testid="target-panel">
      <div className="hud-target-head">
        <span className="hud-dot" style={{ background: t.info.c }} />
        <b>{t.info.ct ? `[${t.info.ct}] ` : ''}{t.info.n}</b>
        <span className="hud-level">{t.info.k === 'n' ? `Sv ${t.info.l}${t.info.b ? ' · Kadim' : ''}` : `Sv ${t.info.l} · ${t.info.cc}`}</span>
        <button type="button" className="hud-x" aria-label="Hedefi bırak" onClick={() => c.selectTarget(null)}>×</button>
      </div>
      <div className="hud-bar hp small"><span style={{ width: `${t.hp}%` }} /><em>%{t.hp}</em></div>
      <div className="hud-bar sh small"><span style={{ width: `${t.sh}%` }} /><em>%{t.sh}</em></div>
      {t.info.k === 'p' && onPilot && (
        <div className="hud-target-actions">
          {!c.state.party?.members.some((m) => m.name === t.info.n) && (
            <button type="button" className="btn btn-small btn-secondary" onClick={() => c.partyAction('invite', t.info.n)} data-testid="target-invite">
              Gruba davet et
            </button>
          )}
          <button type="button" className="btn btn-small btn-ghost" onClick={() => onPilot(t.info.n)}>
            Özel mesaj
          </button>
        </div>
      )}
      <div className="hud-target-foot">
        {d !== null && <span>{fmt(d)} birim</span>}
        {c.state.combat.attacking ? (inRange ? <span className="hud-tag danger">Ateş ediliyor</span> : <span className="hud-tag warn">Menzil dışı — yaklaş</span>) : null}
      </div>
    </div>
  );
}

// ====================================================================== mühimmat, roket ve ateş çubuğu
export function ActionBar({ c, touch }: { c: GameController; touch: boolean }) {
  useController(c);
  const cs = c.state.combat;
  const k = c.settings.keys;
  const key = (code: string) => code.replace(/^Key|^Digit/, '').replace('Space', 'Boşluk');
  return (
    <div className={`hud-actions${touch ? ' touch' : ''}`} data-testid="action-bar">
      <div className="hud-ammo" role="radiogroup" aria-label="Lazer mühimmatı">
        {AMMO_CODES.map((code, i) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={cs.ammo === code}
            className={`hud-slot${cs.ammo === code ? ' active' : ''}${(cs.counts[code] ?? 0) === 0 ? ' empty' : ''}`}
            onClick={() => c.selectAmmo(code)}
            title={`${AMMO_LABELS[code]} (${i + 1})`}
          >
            <i style={{ background: `#${AMMO_COLORS[code].toString(16).padStart(6, '0')}` }} />
            {!touch && <kbd>{i + 1}</kbd>}
            <span className="hud-slot-name">{AMMO_LABELS[code]}</span>
            <span className="hud-slot-count">{fmtShort(cs.counts[code] ?? 0)}</span>
          </button>
        ))}
      </div>
      {!touch && <CombatButtons c={c} touch={false} />}
    </div>
  );
}

/** Roket, en yakın hedef ve ateş butonları (dokunmatikte joystick'in karşı tarafında, büyük). */
export function CombatButtons({ c, touch, side }: { c: GameController; touch: boolean; side?: 'left' | 'right' }) {
  useController(c);
  const cs = c.state.combat;
  const k = c.settings.keys;
  const key = (code: string) => code.replace(/^Key|^Digit/, '').replace('Space', 'Boşluk');
  return (
    <div className={`hud-combat-buttons${touch ? ` touch ${side ?? 'right'}` : ''}`}>
        <button type="button" className="hud-slot rocket" onClick={() => c.fireRocket()} title={`${ROCKET_LABELS[cs.rocket]} roketi (${key(k.rocket)})`} data-testid="rocket-button">
          {!touch && <kbd>{key(k.rocket)}</kbd>}
          <span className="hud-slot-name">{ROCKET_LABELS[cs.rocket]}</span>
          <span className="hud-slot-count">{fmtShort(cs.counts[cs.rocket] ?? 0)}</span>
          {cs.rocketCooldownMs > 0 && <span className="hud-cooldown" />}
        </button>
        <button type="button" className="hud-slot target" onClick={() => c.targetNearest(c.state.position)} title={`En yakın hedef (${key(k.nextTarget)})`} data-testid="target-button">
          {!touch && <kbd>{key(k.nextTarget)}</kbd>}
          <span className="hud-slot-name">Hedef</span>
          <span aria-hidden="true">🎯</span>
        </button>
        <button
          type="button"
          className={`hud-attack${cs.attacking ? ' on' : ''}`}
          onClick={() => c.toggleAttack()}
          aria-pressed={cs.attacking}
          data-testid="attack-button"
          title={`Ateş aç/kapa (${key(k.attack)})`}
        >
          {cs.attacking ? 'Ateşi kes' : 'Ateş'}
          {!touch && <kbd>{key(k.attack)}</kbd>}
        </button>
      </div>
  );
}

const fmtShort = (n: number) => (n >= 10000 ? `${Math.floor(n / 1000)}B` : fmt(n));

// ====================================================================== ölüm ekranı
export function DeathOverlay({ c }: { c: GameController }) {
  useController(c);
  const d = c.state.dead;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!d) setBusy(false);
  }, [d]);
  if (!d) return null;
  return (
    <div className="hud-overlay death" role="alertdialog" aria-label="Gemin yok edildi" data-testid="death-overlay">
      <div className="hud-overlay-card conn">
        <h2>Gemin yok edildi</h2>
        <p>{d.by ? `${d.by} tarafından vuruldun.` : 'Gemin yok edildi.'} Şirket istasyonunda acil onarımla (canın %10'u) yeniden doğabilirsin. Tam onarım hangarda.</p>
        <div className="conn-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setBusy(true); c.respawn(); }}>
            {busy ? 'Yeniden doğuluyor…' : 'İstasyonda yeniden doğ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================================================================== galaksi haritası
export function GalaxyOverlay({ onClose }: { onClose: () => void }) {
  const [g, setG] = useState<GalaxyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    api<{ galaxy: GalaxyResponse }>('GET', `/world/galaxy?server=${SERVER}`)
      .then((r) => {
        setG(r.galaxy);
        setSel(r.galaxy.currentMap);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Galaksi haritası yüklenemedi.'));
  }, []);
  const byCode = new Map(g?.maps.map((m) => [m.code, m]));
  const selected = sel ? byCode.get(sel) : undefined;
  const color = (code: string) => {
    const m = byCode.get(code)!;
    return m.company?.colorHex ?? (m.mapType === 'core' ? '#ff4d6d' : '#a78bfa');
  };
  return (
    <div className="hud-overlay" role="dialog" aria-label="Galaksi haritası" onClick={onClose}>
      <div className="hud-overlay-card galaxy" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>Galaksi haritası</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Kapat (Esc)</button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {g && (
          <>
            <svg viewBox="-4 -4 108 108" className="galaxy-svg">
              {g.links.map(([a, b]) => {
                const ma = byCode.get(a)!;
                const mb = byCode.get(b)!;
                return <line key={`${a}-${b}`} x1={ma.galaxyX} y1={ma.galaxyY} x2={mb.galaxyX} y2={mb.galaxyY} stroke="#34468a" strokeWidth="0.6" />;
              })}
              {g.maps.map((m) => (
                <g key={m.code} onClick={() => setSel(m.code)} style={{ cursor: 'pointer' }} opacity={m.access.ok ? 1 : 0.55}>
                  {m.code === g.currentMap && <circle cx={m.galaxyX} cy={m.galaxyY} r="5.4" fill="none" stroke="#fff" strokeWidth="0.6" className="galaxy-pulse" />}
                  <circle cx={m.galaxyX} cy={m.galaxyY} r="3.6" fill="#0d1530" stroke={color(m.code)} strokeWidth={sel === m.code ? 1.4 : 0.9} />
                  <text x={m.galaxyX} y={m.galaxyY + 1.3} textAnchor="middle" fontSize="2.8" fill="#e6ecff" fontWeight="700">{m.code}</text>
                </g>
              ))}
            </svg>
            {selected && (
              <div className="galaxy-info">
                <b>{selected.code} · {selected.name}</b>
                <span className="muted small">
                  {selected.minLevel > 1 ? `Seviye ${selected.minLevel}+ · ` : ''}
                  {selected.pvpEnabled ? 'PvP açık' : 'Güvenli bölge'}
                  {selected.code === g.currentMap ? ' · Buradasın' : ''}
                </span>
                {!selected.access.ok && <span className="field-error">{selected.access.reason}</span>}
              </div>
            )}
            <p className="muted small">Haritalar arasında geçitlerle yolculuk edilir. Kilitli haritalar seviye veya şirket koşulu ister.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ====================================================================== görevler (Aşama 10)
const TRACK_ORDER: Record<QuestView['category'], number> = { main: 0, event: 1, daily: 2, weekly: 3 };

/** HUD görev izleyicisi: ödülü hazır olanlar, sonra etkin görevler (ana → etkinlik → günlük → haftalık). */
export function QuestTracker({ c, max = 3, onOpen }: { c: GameController; max?: number; onOpen: () => void }) {
  const list = c.state.quests
    .filter((q) => q.status === 'active' || q.status === 'completed')
    .sort((a, b) => (a.status === b.status ? TRACK_ORDER[a.category] - TRACK_ORDER[b.category] : a.status === 'completed' ? -1 : 1))
    .slice(0, max);
  if (list.length === 0) return null;
  return (
    <button type="button" className="hud-quests" onClick={onOpen} data-testid="quest-tracker" aria-label="Görevleri aç">
      {list.map((q) => {
        const o = q.objectives.find((x) => x.current < x.target) ?? q.objectives[0]!;
        return (
          <div key={`${q.code}:${q.cycle}`} className={`hud-quest${q.status === 'completed' ? ' done' : ''}`} data-testid={`track-${q.code}`}>
            <div className="hud-quest-title">{q.status === 'completed' ? '✔ ' : ''}{q.title}</div>
            <div className="hud-quest-obj">
              {q.status === 'completed' ? (
                <span>Ödülünü al</span>
              ) : (
                <>
                  <span>{o.label}</span>
                  <b>
                    {fmt(o.current)}/{fmt(o.target)}
                  </b>
                </>
              )}
            </div>
          </div>
        );
      })}
    </button>
  );
}

/** Oyun içi görev çekmecesi (Q). Mobilde ekranın tamamını kaplar ve kaydırılır. */
export function QuestDrawer({ c, onClose }: { c: GameController; onClose: () => void }) {
  return (
    <div className="hud-drawer-backdrop" onClick={onClose}>
      <aside className="hud-drawer" role="dialog" aria-label="Görevler" data-testid="quest-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>Görevler</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Kapat (Esc)</button>
        </div>
        <QuestBoard
          compact
          reloadKey={c.state.questsVersion}
          onChange={(q) => c.setQuests(q)}
          onReward={(text, level, levelUp) => {
            c.toast('success', text);
            c.applyLevel(level);
            if (levelUp) setTimeout(() => c.toast('success', `Seviye atladın! Artık seviye ${level}.`), 1500);
          }}
        />
      </aside>
    </div>
  );
}

// ====================================================================== üst çubuk
export function TopBar({ onGalaxy, onSettings, onQuests, onChat, touch, c }: { onGalaxy: () => void; onSettings: () => void; onQuests: () => void; onChat?: () => void; touch: boolean; c: GameController }) {
  const ready = c.state.quests.filter((q) => q.status === 'completed').length;
  return (
    <div className="hud-topbar">
      {onChat && (
        <button type="button" className="hud-btn" onClick={onChat} title="Sohbet" aria-label="Sohbet" data-testid="hud-chat-btn">
          💬<span>Sohbet</span>
          {c.state.chatUnread > 0 && <span className="quest-ready-dot" aria-label={`${c.state.chatUnread} yeni mesaj`}>{Math.min(99, c.state.chatUnread)}</span>}
        </button>
      )}
      <button type="button" className="hud-btn" onClick={onQuests} title="Görevler (Q)" aria-label="Görevler" data-testid="hud-quests-btn">
        📜<span>Görevler</span>
        {ready > 0 && <span className="quest-ready-dot" aria-label={`${ready} ödül hazır`}>{ready}</span>}
      </button>
      <button type="button" className="hud-btn" onClick={onGalaxy} title="Galaksi haritası" aria-label="Galaksi haritası">🗺️<span>Galaksi</span></button>
      <button type="button" className="hud-btn" onClick={onSettings} title="Ayarlar" aria-label="Ayarlar">⚙️<span>Ayarlar</span></button>
      {document.fullscreenEnabled && (
        <button type="button" className="hud-btn" title="Tam ekran" aria-label="Tam ekran" onClick={() => void toggleFullscreen()}>⛶<span>Tam ekran</span></button>
      )}
      {touch && (
        <>
          <button type="button" className="hud-btn" aria-label="Yakınlaştır" onClick={() => (c.zoomDelta = 0.15)}>＋</button>
          <button type="button" className="hud-btn" aria-label="Uzaklaştır" onClick={() => (c.zoomDelta = -0.15)}>－</button>
        </>
      )}
      <Link className="hud-btn" to="/hangar" title="Hangara dön" aria-label="Hangara dön">🛠️<span>Hangar</span></Link>
    </div>
  );
}

export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* tarayıcı izin vermeyebilir (ör. iOS Safari) */
  }
}
