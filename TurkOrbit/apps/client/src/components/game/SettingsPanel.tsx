import { settingsSchema, type DeviceClass, type PlayerSettings } from '@turkorbit/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';

const DEVICE_LABELS: Record<DeviceClass, string> = { desktop: 'bilgisayar', phone: 'telefon', tablet: 'tablet' };
const KEY_LABELS: Record<keyof PlayerSettings['keys'], string> = {
  up: 'Yukarı', down: 'Aşağı', left: 'Sol', right: 'Sağ', jump: 'Geçitten atla', galaxy: 'Galaksi haritası',
  zoomIn: 'Yakınlaştır', zoomOut: 'Uzaklaştır', fullscreen: 'Tam ekran',
  attack: 'Ateş aç / kapa', rocket: 'Roket at', nextTarget: 'En yakın hedef', quests: 'Görevler',
};

export function SettingsPanel({ initial, deviceClass, onSave, onClose }: {
  initial: PlayerSettings;
  deviceClass: DeviceClass;
  onSave: (s: PlayerSettings) => Promise<void>;
  onClose: () => void;
}) {
  const [s, setS] = useState<PlayerSettings>(structuredClone(initial));
  const [tab, setTab] = useState<'controls' | 'graphics' | 'hud' | 'keys'>(deviceClass === 'desktop' ? 'keys' : 'controls');
  const [binding, setBinding] = useState<keyof PlayerSettings['keys'] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') setS((p) => ({ ...p, keys: { ...p.keys, [binding]: e.code } }));
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, { capture: true, once: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [binding]);

  const set = <K extends keyof PlayerSettings>(group: K, patch: Partial<PlayerSettings[K]>) => setS((p) => ({ ...p, [group]: { ...p[group], ...patch } }));

  async function save() {
    const parsed = settingsSchema.safeParse(s);
    if (!parsed.success) return setMsg({ kind: 'err', text: 'Ayarlarda geçersiz değer var.' });
    setBusy(true);
    try {
      await onSave(parsed.data);
      setMsg({ kind: 'ok', text: `Kaydedildi. Bu ayarlar ${DEVICE_LABELS[deviceClass]} sınıfındaki tüm cihazlarında geçerli.` });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Kaydedilemedi.' });
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<[typeof tab, string]> = [['controls', 'Kontroller'], ['graphics', 'Grafik'], ['hud', 'Arayüz'], ...(deviceClass === 'desktop' ? [['keys', 'Tuşlar'] as [typeof tab, string]] : [])];
  return (
    <div className="hud-overlay" role="dialog" aria-label="Oyun ayarları" onClick={onClose}>
      <div className="hud-overlay-card settings" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>Ayarlar <span className="muted small">({DEVICE_LABELS[deviceClass]})</span></h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Kapat</button>
        </div>
        <div className="chips">
          {tabs.map(([k, l]) => (
            <button key={k} type="button" className={`chip${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {tab === 'controls' && (
          <div className="settings-grid">
            <label>Dokunmatik hareket
              <select value={s.controls.mode} onChange={(e) => set('controls', { mode: e.target.value as 'joystick' | 'tap' })}>
                <option value="joystick">Sanal joystick</option>
                <option value="tap">Dokun-git</option>
              </select>
            </label>
            <label>Joystick tarafı
              <select value={s.controls.joystickSide} onChange={(e) => set('controls', { joystickSide: e.target.value as 'left' | 'right' })}>
                <option value="left">Sol</option>
                <option value="right">Sağ</option>
              </select>
            </label>
            <label>Joystick boyutu: {s.controls.joystickSize.toFixed(1)}×
              <input type="range" min={0.6} max={1.6} step={0.1} value={s.controls.joystickSize} onChange={(e) => set('controls', { joystickSize: Number(e.target.value) })} />
            </label>
            <label>Joystick şeffaflığı: %{Math.round(s.controls.joystickOpacity * 100)}
              <input type="range" min={0.2} max={1} step={0.05} value={s.controls.joystickOpacity} onChange={(e) => set('controls', { joystickOpacity: Number(e.target.value) })} />
            </label>
            <label>Joystick yüksekliği: %{Math.round(s.controls.joystickOffsetY * 100)}
              <input type="range" min={0} max={0.4} step={0.02} value={s.controls.joystickOffsetY} onChange={(e) => set('controls', { joystickOffsetY: Number(e.target.value) })} />
            </label>
            <label className="checkbox"><input type="checkbox" checked={s.controls.keyboardMove} onChange={(e) => set('controls', { keyboardMove: e.target.checked })} /> Klavye ile hareket</label>
          </div>
        )}
        {tab === 'graphics' && (
          <div className="settings-grid">
            <label>Grafik kalitesi
              <select value={s.graphics.quality} onChange={(e) => set('graphics', { quality: e.target.value as PlayerSettings['graphics']['quality'] })}>
                <option value="low">Düşük (pil dostu)</option>
                <option value="medium">Orta</option>
                <option value="high">Yüksek</option>
              </select>
            </label>
            <label>FPS sınırı
              <select value={s.graphics.fpsLimit} onChange={(e) => set('graphics', { fpsLimit: Number(e.target.value) as 30 | 60 | 120 })}>
                <option value={30}>30 (pil tasarrufu)</option>
                <option value={60}>60</option>
                <option value={120}>120 (destekleyen ekranlar)</option>
              </select>
            </label>
            <label className="checkbox"><input type="checkbox" checked={s.graphics.showFps} onChange={(e) => set('graphics', { showFps: e.target.checked })} /> FPS göstergesi</label>
            <p className="muted small">Kalite ve FPS değişiklikleri kaydedilince oyun ekranı yeniden başlatılır.</p>
          </div>
        )}
        {tab === 'hud' && (
          <div className="settings-grid">
            <label>Arayüz ölçeği: {s.hud.scale.toFixed(2)}×
              <input type="range" min={0.75} max={1.5} step={0.05} value={s.hud.scale} onChange={(e) => set('hud', { scale: Number(e.target.value) })} />
            </label>
            <label>Mini harita boyutu
              <select value={s.hud.minimapSize} onChange={(e) => set('hud', { minimapSize: e.target.value as PlayerSettings['hud']['minimapSize'] })}>
                <option value="small">Küçük</option>
                <option value="medium">Orta</option>
                <option value="large">Büyük</option>
              </select>
            </label>
            <label className="checkbox"><input type="checkbox" checked={s.hud.showCoordinates} onChange={(e) => set('hud', { showCoordinates: e.target.checked })} /> Koordinatları göster</label>
          </div>
        )}
        {tab === 'keys' && (
          <div className="settings-keys">
            {(Object.keys(KEY_LABELS) as Array<keyof PlayerSettings['keys']>).map((k) => (
              <div key={k} className="key-row">
                <span>{KEY_LABELS[k]}</span>
                <button type="button" className={`btn btn-secondary btn-small${binding === k ? ' binding' : ''}`} onClick={() => setBinding(k)}>
                  {binding === k ? 'Bir tuşa bas… (Esc: vazgeç)' : s.keys[k].replace(/^Key|^Digit/, '')}
                </button>
              </div>
            ))}
            <p className="muted small">Ok tuşları her zaman hareket için de çalışır. 1–5 tuşları mühimmat seçer. Fare tekerleği yakınlaştırır.</p>
          </div>
        )}
        {msg && <div className={`alert ${msg.kind === 'ok' ? 'alert-success' : 'alert-error'}`}>{msg.text}</div>}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button>
      </div>
    </div>
  );
}
