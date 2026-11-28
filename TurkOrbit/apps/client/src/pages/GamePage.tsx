/**
 * Oyun ekranı (/oyna). Bu dosya ayrı bir parça olarak yüklenir (React.lazy): Phaser yalnızca
 * oyuna girilince indirilir, hesap sayfaları hafif kalır.
 */
import { AMMO_CODES, type DeviceClass, type PlayerSettings } from '@turkorbit/shared';
import Phaser from 'phaser';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import {
  ActionBar,
  CombatButtons,
  ConnectionBanner,
  DeathOverlay,
  GalaxyOverlay,
  Joystick,
  Minimap,
  NearbyPanel,
  PilotPanel,
  PortalPrompt,
  QuestDrawer,
  QuestTracker,
  TargetPanel,
  Toast,
  TopBar,
  toggleFullscreen,
  useController,
} from '../components/game/GameHud';
import { SettingsPanel } from '../components/game/SettingsPanel';
import { ChatDock, ChatPanel, PartyInvites, PartyPanel } from '../components/game/SocialHud';
import { GameController, SERVER } from '../game/controller';
import { SpaceScene } from '../game/SpaceScene';
import '../styles/game.css';

/** Cihaz sınıfı: dokunmatik (kaba işaretçi) + kısa kenar < 600 px → telefon, dokunmatik → tablet, diğerleri bilgisayar. */
export function detectDeviceClass(): DeviceClass {
  const coarse = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const fine = window.matchMedia('(pointer: fine)').matches;
  if (!coarse || (fine && !window.matchMedia('(any-pointer: coarse)').matches)) return 'desktop';
  return Math.min(window.screen.width, window.screen.height) < 600 ? 'phone' : 'tablet';
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-pilot' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; controller: GameController };

export function GamePage() {
  const [deviceClass] = useState(detectDeviceClass);
  const touch = deviceClass !== 'desktop';
  const [st, setSt] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let controller: GameController | null = null;
    api<{ settings: PlayerSettings }>('GET', `/settings?deviceClass=${deviceClass}`)
      .then(async (s) => {
        if (cancelled) return;
        controller = new GameController(s.settings);
        // Oyun bileti alınır, WebSocket açılır; ilk "welcome" mesajında harita ve konum gelir.
        await controller.connect();
        if (!cancelled) setSt({ kind: 'ready', controller });
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === 'PILOT_NOT_FOUND') setSt({ kind: 'no-pilot' });
        else setSt({ kind: 'error', message: e instanceof ApiError ? e.message : 'Oyun yüklenemedi.' });
      });
    return () => {
      cancelled = true;
      controller?.dispose();
    };
  }, [deviceClass]);

  if (st.kind === 'loading') {
    return (
      <div className="game-loading" role="status">
        <div className="splash-text">TÜRK ORBIT</div>
        <div className="splash-sub">Uzaya çıkılıyor…</div>
      </div>
    );
  }
  if (st.kind === 'no-pilot' || st.kind === 'error') {
    return (
      <div className="game-loading">
        <div className="card game-message">
          <h2>{st.kind === 'no-pilot' ? 'Önce pilotunu oluştur' : 'Oyun açılamadı'}</h2>
          <p>{st.kind === 'no-pilot' ? `${SERVER} sunucusunda henüz bir pilotun yok. Şirketini seçip pilotunu oluşturduktan sonra uzaya çıkabilirsin.` : st.message}</p>
          <Link className="btn btn-primary" to="/pilot">Pilot sayfasına git</Link>
        </div>
      </div>
    );
  }
  return <GameView c={st.controller} deviceClass={deviceClass} touch={touch} />;
}

function GameView({ c, deviceClass, touch }: { c: GameController; deviceClass: DeviceClass; touch: boolean }) {
  useController(c);
  const host = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<'none' | 'galaxy' | 'settings' | 'quests' | 'chat'>('none');
  /** Aşama 12: özel mesaj alıcısı ve sohbet alanına odaklanma isteği */
  const [dm, setDm] = useState('');
  const [chatFocus, setChatFocus] = useState(0);
  const openDm = (name: string) => {
    setDm(name);
    if (touch) setOverlay('chat');
    else setChatFocus((n) => n + 1);
  };
  const [portraitHint, setPortraitHint] = useState(false);
  const { quality, fpsLimit } = c.settings.graphics;

  // Phaser oyunu: grafik kalitesi / FPS sınırı değişince yeniden kurulur.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#050816',
      banner: false,
      scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
      fps: { target: fpsLimit, limit: fpsLimit },
      render: { antialias: quality !== 'low', powerPreference: quality === 'low' ? 'low-power' : 'high-performance' },
      input: { activePointers: 3 },
      disableContextMenu: true,
      scene: [],
    });
    game.scene.add('space', SpaceScene, true, { controller: c, touch });
    return () => game.destroy(true);
  }, [c, touch, quality, fpsLimit]);

  // Klavye kısayolları (hareket tuşlarını sahne dinler).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const k = c.settings.keys;
      if (e.code === 'Escape') {
        if (overlay === 'none' && c.state.combat.target !== null) c.selectTarget(null);
        setOverlay('none');
      } else if (overlay !== 'none') return;
      else if (e.code === k.attack) {
        e.preventDefault();
        if (!e.repeat) c.toggleAttack();
      } else if (e.code === k.rocket) c.fireRocket();
      else if (e.code === k.nextTarget) {
        e.preventDefault();
        c.targetNearest(c.state.position);
      } else if (/^Digit[1-5]$/.test(e.code)) c.selectAmmo(AMMO_CODES[Number(e.code.slice(5)) - 1]!);
      else if (e.code === k.jump) c.jump();
      else if (e.code === k.galaxy) setOverlay('galaxy');
      else if (e.code === k.quests) setOverlay('quests');
      else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !touch) {
        // Sohbet alanına geç (yazarken oyun kısayolları devre dışı)
        e.preventDefault();
        setChatFocus((n) => n + 1);
      }
      else if (e.code === k.zoomIn) c.zoomDelta = 0.15;
      else if (e.code === k.zoomOut) c.zoomDelta = -0.15;
      else if (e.code === k.fullscreen) void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c, overlay, touch]);

  // Telefonda dikey tutuşta yatay mod önerisi (oyun dikeyde de oynanabilir).
  useEffect(() => {
    if (deviceClass !== 'phone') return;
    const mq = window.matchMedia('(orientation: portrait)');
    const on = () => setPortraitHint(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [deviceClass]);

  const s = c.settings;
  return (
    <div className={`game-root device-${deviceClass}`} style={{ ['--hud-scale' as string]: s.hud.scale }}>
      <div ref={host} className="game-canvas" data-testid="game-canvas" />
      <div className="hud-layer">
        <div className="hud-corner tl">
          <PilotPanel c={c} />
          <QuestTracker c={c} max={deviceClass === 'phone' ? 2 : 3} onOpen={() => setOverlay('quests')} />
          {!touch && overlay === 'none' && (
            <div className="hud-help muted small">WASD: hareket · Tıkla: hedef seç / git · Boşluk: ateş · 1–5: mühimmat · R: roket · Tab: en yakın hedef · {s.keys.jump.replace(/^Key/, '')}: geçit · {s.keys.galaxy.replace(/^Key/, '')}: galaksi · {s.keys.quests.replace(/^Key/, '')}: görevler · Enter: sohbet</div>
          )}
        </div>
        <div className="hud-corner tr">
          <TopBar
            c={c}
            touch={touch}
            onGalaxy={() => setOverlay('galaxy')}
            onSettings={() => setOverlay('settings')}
            onQuests={() => setOverlay('quests')}
            {...(touch ? { onChat: () => setOverlay('chat') } : {})}
          />
          <Minimap c={c} />
          <NearbyPanel c={c} max={deviceClass === 'phone' ? 3 : 5} />
          {deviceClass !== 'phone' && <PartyPanel c={c} />}
        </div>
        <div className="hud-corner tc">
          <TargetPanel c={c} onPilot={openDm} />
          <PartyInvites c={c} />
        </div>
        {!touch && (
          <div className="hud-corner bl">
            <ChatDock c={c} dm={dm} setDm={setDm} focusKey={chatFocus} />
          </div>
        )}
        <div className="hud-corner bc">
          <PortalPrompt c={c} />
          <ActionBar c={c} touch={touch} />
        </div>
        <Toast c={c} />
        <ConnectionBanner c={c} />
        <DeathOverlay c={c} />
        {touch && s.controls.mode === 'joystick' && <Joystick c={c} settings={s} />}
        {touch && <CombatButtons c={c} touch side={s.controls.mode === 'joystick' && s.controls.joystickSide === 'right' ? 'left' : 'right'} />}
        {portraitHint && (
          <button type="button" className="hud-portrait-hint" onClick={() => setPortraitHint(false)}>
            Daha geniş görüş için telefonu yan çevir · Kapat
          </button>
        )}
      </div>
      {overlay === 'galaxy' && <GalaxyOverlay onClose={() => setOverlay('none')} />}
      {overlay === 'quests' && <QuestDrawer c={c} onClose={() => setOverlay('none')} />}
      {overlay === 'chat' && (
        <div className="hud-drawer-backdrop" onClick={() => setOverlay('none')}>
          <aside className="hud-drawer chat-drawer" role="dialog" aria-label="Sohbet ve grup" data-testid="chat-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h2>Sohbet</h2>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setOverlay('none')}>
                Kapat
              </button>
            </div>
            <PartyPanel c={c} />
            <ChatPanel c={c} dm={dm} setDm={setDm} />
          </aside>
        </div>
      )}
      {overlay === 'settings' && (
        <SettingsPanel initial={s} deviceClass={deviceClass} onClose={() => setOverlay('none')} onSave={(next) => c.saveSettings(next, deviceClass)} />
      )}
    </div>
  );
}
