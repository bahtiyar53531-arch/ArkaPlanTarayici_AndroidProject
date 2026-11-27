import { type GalaxyResponse, type PlayerSettings } from '@turkorbit/shared';
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { SERVER, type GameController } from '../../game/controller';
import { fmt } from '../../lib/format';

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
      <div className="hud-bar hp" title="Can">
        <span style={{ width: `${(pilot.ship.hitpoints / pilot.ship.maxHitpoints) * 100}%` }} />
        <em>{fmt(pilot.ship.hitpoints)}</em>
      </div>
      <div className="hud-bar sh" title="Kalkan">
        <span style={{ width: pilot.ship.shield > 0 ? '100%' : '0%' }} />
        <em>{fmt(pilot.ship.shield)}</em>
      </div>
      <div className="hud-map">
        <b>{map.code}</b> {map.name} {map.pvpEnabled ? <span className="hud-tag danger">PvP</span> : <span className="hud-tag ok">Güvenli</span>}
      </div>
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
        ctx.beginPath();
        ctx.arc(o.x * sx, o.y * sy, 3, 0, Math.PI * 2);
        ctx.fillStyle = o.info.c;
        ctx.fill();
        if (o.info.cc !== c.map.pilot.company.code) {
          ctx.strokeStyle = '#ff4d6d';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
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

// ====================================================================== üst çubuk
export function TopBar({ onGalaxy, onSettings, touch, c }: { onGalaxy: () => void; onSettings: () => void; touch: boolean; c: GameController }) {
  return (
    <div className="hud-topbar">
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
