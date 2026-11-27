/**
 * API ile oyun sunucusu arasındaki Redis köprüsü (Aşama 8).
 *
 *  - Oyun bileti: API üretir, oyun sunucusu tek seferlik tüketir.
 *  - Çevrimiçi durum (presence): oyun sunucusu yazar; API "yalnızca istasyonda ekipman" kuralında okur.
 *  - Olaylar: API hangarda bir değişiklik yapınca oyun sunucusu canlı istatistikleri yeniden yükler.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../auth/service.js';

export const TICKET_TTL_SECONDS = 60;
export const PRESENCE_TTL_SECONDS = 30;

export const GAME_KEYS = {
  ticket: (hash: string) => `game:ticket:${hash}`,
  presence: (playerId: string) => `game:presence:${playerId}`,
  session: (playerId: string) => `game:session:${playerId}`,
};
export const GAME_CHANNELS = {
  /** {playerId}: hangar/ekipman değişti → istatistikleri yeniden yükle */
  playerUpdated: 'game:player-updated',
  /** {playerId, connId}: bu oyuncunun connId dışındaki bağlantılarını kapat (tek aktif oyun oturumu) */
  kick: 'game:kick',
};

export interface TicketPayload {
  userId: string;
  sessionId: string;
  playerId: string;
  serverCode: string;
  issuedAt: number;
}

export interface Presence {
  /** bulunulan harita kodu */
  map: string;
  /** istasyon bölgesinde mi */
  station: boolean;
  /** oyun sunucusu süreç kimliği */
  instance: string;
  at: number;
}

export const hashTicket = (ticket: string) => createHash('sha256').update(ticket).digest('hex');

export class GameBridge {
  constructor(
    private readonly redis: Redis | null,
    private readonly log: Logger,
  ) {}

  get available() {
    return this.redis !== null;
  }

  async issueTicket(payload: Omit<TicketPayload, 'issuedAt'>): Promise<{ ticket: string; expiresIn: number }> {
    if (!this.redis) throw new AppError('GAME_UNAVAILABLE', 503, 'Oyun sunucusu şu an kullanılamıyor. Biraz sonra tekrar dene.');
    const ticket = randomBytes(32).toString('base64url');
    const body: TicketPayload = { ...payload, issuedAt: Date.now() };
    await this.redis.set(GAME_KEYS.ticket(hashTicket(ticket)), JSON.stringify(body), 'EX', TICKET_TTL_SECONDS);
    return { ticket, expiresIn: TICKET_TTL_SECONDS };
  }

  /** Bileti atomik olarak tüketir (GETDEL): aynı bilet ikinci kez kullanılamaz. */
  async consumeTicket(ticket: string): Promise<TicketPayload | null> {
    if (!this.redis) return null;
    const raw = await this.redis.getdel(GAME_KEYS.ticket(hashTicket(ticket)));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TicketPayload;
    } catch {
      return null;
    }
  }

  async presence(playerId: string): Promise<Presence | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(GAME_KEYS.presence(playerId));
      return raw ? (JSON.parse(raw) as Presence) : null;
    } catch (err) {
      // Redis geçici olarak erişilemezse ekipman değişikliği engellenmez (oyun kuralı; güvenlik açığı değil).
      this.log.warn({ err, playerId }, 'çevrimiçi durum okunamadı');
      return null;
    }
  }

  /** Oyuncu oyundaysa ve istasyonda değilse ekipman değiştiremez. Oyun dışındaysa (web hangarı) serbesttir. */
  async assertCanChangeEquipment(playerId: string) {
    const p = await this.presence(playerId);
    if (p && !p.station) {
      throw new AppError('NOT_IN_STATION', 409, 'Oyundayken ekipman yalnızca istasyonda değiştirilebilir. Önce istasyona dön.');
    }
  }

  async notifyPlayerUpdated(playerId: string) {
    if (!this.redis) return;
    await this.redis.publish(GAME_CHANNELS.playerUpdated, JSON.stringify({ playerId })).catch((err: unknown) => {
      this.log.warn({ err, playerId }, 'oyun sunucusuna değişiklik bildirilemedi');
    });
  }
}
