/**
 * Oyun kontrolcüsü: Phaser sahnesi ile React HUD arasındaki köprü + sunucu senkronizasyonu.
 *
 * Aşama 7 (tek oyunculu): hareket istemcide simüle edilir, konum ~1 sn'de bir sunucuya bildirilir.
 * Sunucu hız denetiminden geçmeyen konumu reddeder → istemci sunucu konumuna geri çekilir (uzlaştırma).
 * Aşama 8'de bu sınıf WebSocket istemcisine dönüşecek; sahne arayüzü aynı kalacak.
 */
import type { MapResponse, PlayerSettings, PortalInfo } from '@turkorbit/shared';
import { api, ApiError } from '../api/client';

export const SERVER = 'TR1';

export interface Vec {
  x: number;
  y: number;
}

export interface HudState {
  position: Vec;
  heading: number;
  moving: boolean;
  target: Vec | null;
  nearPortal: PortalInfo | null;
  fps: number;
  jumping: boolean;
  toast: { kind: 'info' | 'error' | 'success'; text: string; id: number } | null;
}

type Listener = () => void;

export class GameController {
  map: MapResponse;
  settings: PlayerSettings;
  readonly state: HudState;
  /** Joystick yönü (-1..1); React bileşeni yazar, sahne okur. */
  joystick: Vec = { x: 0, y: 0 };
  /** Sahnenin tıklama/mini harita hedefini alması için. */
  pendingTarget: Vec | null = null;
  zoomDelta = 0;
  /** Sahne konumunu sunucu konumuna çekmesi gerektiğinde artar. */
  correctionSeq = 0;
  mapSeq = 0;

  private listeners = new Set<Listener>();
  private lastSent: Vec;
  private inFlight: Promise<void> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private toastId = 0;

  constructor(map: MapResponse, settings: PlayerSettings) {
    this.map = map;
    this.settings = settings;
    this.lastSent = { ...map.position };
    this.state = {
      position: { ...map.position },
      heading: -Math.PI / 2,
      moving: false,
      target: null,
      nearPortal: null,
      fps: 0,
      jumping: false,
      toast: map.notice ? { kind: 'info', text: map.notice, id: ++this.toastId } : null,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const l of this.listeners) l();
  }

  toast(kind: 'info' | 'error' | 'success', text: string) {
    this.state.toast = { kind, text, id: ++this.toastId };
    this.emit();
  }

  start() {
    this.syncTimer = setInterval(() => void this.syncPosition(), 1000);
  }

  stop() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    this.listeners.clear();
  }

  setTarget(p: Vec | null) {
    this.pendingTarget = p;
  }

  /**
   * Konumu sunucuya bildirir; reddedilirse sunucu konumuna geri çeker.
   * force: 5 birim eşiğini atlar (sayfadan çıkarken), ama konum hiç değişmediyse yine göndermez.
   */
  async syncPosition(force = false, keepalive = false) {
    if (this.inFlight || this.state.jumping) return;
    const p = this.state.position;
    const moved = Math.hypot(p.x - this.lastSent.x, p.y - this.lastSent.y);
    if (moved < (force ? 0.5 : 5)) return;
    this.inFlight = this.sendPosition({ x: Math.round(p.x), y: Math.round(p.y) }, keepalive);
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async sendPosition(sent: Vec, keepalive: boolean) {
    const seq = this.mapSeq;
    try {
      const r = await api<{ accepted: boolean; x: number; y: number; reason: string | null }>(
        'POST',
        '/world/position',
        { serverCode: SERVER, ...sent },
        { keepalive },
      );
      if (seq !== this.mapSeq) return; // istek sürerken haritadan geçildi: eski haritanın yanıtı yok sayılır
      this.lastSent = { x: r.x, y: r.y };
      if (!r.accepted) {
        this.state.position = { x: r.x, y: r.y };
        this.state.target = null;
        this.correctionSeq++;
        this.toast('error', 'Konumun sunucu tarafından doğrulanamadı ve düzeltildi.');
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'RATE_LIMITED')) {
        this.toast('error', e instanceof ApiError ? e.message : 'Sunucuyla bağlantı kurulamadı.');
      }
    }
  }

  async jump() {
    const portal = this.state.nearPortal;
    if (!portal || this.state.jumping) return;
    if (!portal.access.ok) {
      this.toast('error', portal.access.reason);
      return;
    }
    this.state.jumping = true;
    this.emit();
    try {
      // Süren konum bildirimi önce bitsin: aksi halde sunucu eski haritanın konumunu geçişten sonra alıp reddeder.
      if (this.inFlight) await this.inFlight;
      const p = this.state.position;
      const r = await api<{ map: MapResponse }>('POST', '/world/jump', {
        serverCode: SERVER,
        portalId: portal.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
      });
      this.applyMap(r.map);
      this.toast('success', `${r.map.map.code} ${r.map.map.name} bölgesine geçtin.`);
    } catch (e) {
      this.toast('error', e instanceof ApiError ? e.message : 'Geçiş başarısız.');
    } finally {
      this.state.jumping = false;
      this.emit();
    }
  }

  applyMap(map: MapResponse) {
    this.map = map;
    this.state.position = { ...map.position };
    this.lastSent = { ...map.position };
    this.state.target = null;
    this.state.nearPortal = null;
    this.mapSeq++;
    this.emit();
  }

  async saveSettings(settings: PlayerSettings, deviceClass: string) {
    await api('PUT', '/settings', { deviceClass, settings });
    this.settings = settings;
    this.emit();
  }
}
