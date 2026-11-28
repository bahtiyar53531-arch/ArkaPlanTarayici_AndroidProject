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
  /** Aşama 14 — oyun sunucusu süreci nabzı ve metrikleri (Yönetim Merkezi panosu okur) */
  node: (id: string) => `game:node:${id}`,
};
export const NODE_TTL_SECONDS = 15;
export const GAME_CHANNELS = {
  /** {playerId}: hangar/ekipman değişti → istatistikleri yeniden yükle */
  playerUpdated: 'game:player-updated',
  /** {playerId, connId}: bu oyuncunun connId dışındaki bağlantılarını kapat (tek aktif oyun oturumu) */
  kick: 'game:kick',
  /** Aşama 12 — {playerId, msg}: pilot hangi süreçteyse oradaki bağlantısına sunucu mesajı iletilir (bildirim, grup daveti) */
  deliver: 'game:deliver',
  /** Aşama 12 — {clanIds}: klanlar arası diplomasi değişti → oyun sunucuları ilişki tablosunu yeniden okur */
  relations: 'game:relations',
  /** Aşama 12 — sohbet mesajı: {server, channel, sender, recipient, m} → kanalı dinleyen yerel pilotlara iletilir */
  chat: 'game:chat',
  /** Aşama 14 — Yönetim Merkezi olayları (AdminGameEvent): içerik yayını, yaptırım, bakım, duyuru */
  admin: 'game:admin',
};

/** Yönetim Merkezi → oyun sunucuları */
export type AdminGameEvent =
  /** NPC türleri / savaş ayarları değişti: içerik yeniden yüklenir, yaşayan NPC'ler ölçeklenir */
  | { type: 'content' }
  /** gemi taban değerleri değişti: bu gemiyi kullanan çevrimiçi pilotların istatistikleri yeniden hesaplanır */
  | { type: 'ships'; shipTypeId: number }
  /** harita ayarı değişti (PvP açık odaya uygulanır; kapatma hemen denetlenir) */
  | { type: 'map'; code: string; pvp: boolean }
  /** sohbet/sosyal ayarları değişti */
  | { type: 'social-config' }
  /** yaptırım: kick=true ise kullanıcının oyundaki bağlantıları kapatılır; değilse susturma durumu yeniden okunur */
  | { type: 'sanction'; userId: string; kick: boolean; message?: string }
  | { type: 'maintenance'; enabled: boolean; message: string }
  | { type: 'announce'; text: string };

/** quests: görev listesi değişti (kabul, ödül, hangar olayı) → oyun sunucusu izleyiciyi, seviyeyi ve envanteri yeniler */
/** social (Aşama 12): klan üyeliği/etiketi, engellenenler veya gizlilik ayarı değişti */
export type PlayerUpdateReason = 'stats' | 'ship' | 'repair' | 'inventory' | 'quests' | 'social';

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

  /** Birden çok pilotun çevrimiçi durumu (klan üyeleri, arkadaşlar). Redis yoksa boş. */
  async presenceMany(playerIds: string[]): Promise<Map<string, Presence>> {
    const out = new Map<string, Presence>();
    if (!this.redis || playerIds.length === 0) return out;
    try {
      const raws = await this.redis.mget(...playerIds.map((id) => GAME_KEYS.presence(id)));
      raws.forEach((raw, i) => {
        if (!raw) return;
        try {
          out.set(playerIds[i]!, JSON.parse(raw) as Presence);
        } catch {
          /* bozuk kayıt yok sayılır */
        }
      });
    } catch (err) {
      this.log.warn({ err }, 'çevrimiçi durumlar okunamadı');
    }
    return out;
  }

  /** Pilot oyundaysa (hangi süreçte olursa olsun) bağlantısına mesaj iletilir; değilse hiçbir şey olmaz. */
  async deliver(playerId: string, msg: unknown) {
    if (!this.redis) return;
    await this.redis.publish(GAME_CHANNELS.deliver, JSON.stringify({ playerId, msg })).catch((err: unknown) => {
      this.log.warn({ err, playerId }, 'oyun sunucusuna mesaj iletilemedi');
    });
  }

  async notifyRelationsChanged(clanIds: string[]) {
    if (!this.redis) return;
    await this.redis.publish(GAME_CHANNELS.relations, JSON.stringify({ clanIds })).catch((err: unknown) => {
      this.log.warn({ err }, 'diplomasi değişikliği bildirilemedi');
    });
  }

  /** Yönetim Merkezi olayı tüm oyun sunucularına yayınlanır (Redis yoksa yalnızca günlüğe yazılır). */
  async publishAdmin(event: AdminGameEvent) {
    if (!this.redis) return;
    await this.redis.publish(GAME_CHANNELS.admin, JSON.stringify(event)).catch((err: unknown) => {
      this.log.warn({ err, event: event.type }, 'yönetim olayı oyun sunucularına iletilemedi');
    });
  }

  /** Redis gecikmesi (ms); Redis yoksa veya yanıt vermezse -1 */
  async ping(): Promise<number> {
    if (!this.redis) return -1;
    const t = performance.now();
    try {
      await this.redis.ping();
      return Math.round((performance.now() - t) * 10) / 10;
    } catch {
      return -1;
    }
  }

  /** Oyun sunucusu süreçlerinin son nabızları (TTL dolan süreç listede görünmez). */
  async nodes(): Promise<unknown[]> {
    if (!this.redis) return [];
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', 'game:node:*', 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0' && keys.length < 500);
    if (keys.length === 0) return [];
    const raws = await this.redis.mget(...keys);
    return raws.flatMap((r) => {
      try {
        return r ? [JSON.parse(r) as unknown] : [];
      } catch {
        return [];
      }
    });
  }

  /** Tüm çevrimiçi pilotların durumu (pano: harita başına oyuncu). */
  async allPresence(): Promise<Presence[]> {
    if (!this.redis) return [];
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', 'game:presence:*', 'COUNT', 500);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0' && keys.length < 50_000);
    const out: Presence[] = [];
    for (let i = 0; i < keys.length; i += 500) {
      const raws = await this.redis.mget(...keys.slice(i, i + 500));
      for (const r of raws) {
        try {
          if (r) out.push(JSON.parse(r) as Presence);
        } catch {
          /* bozuk kayıt */
        }
      }
    }
    return out;
  }

  /** Oyuncu oyundaysa ve istasyonda değilse ekipman değiştiremez. Oyun dışındaysa (web hangarı) serbesttir. */
  async assertCanChangeEquipment(playerId: string) {
    const p = await this.presence(playerId);
    if (p && !p.station) {
      throw new AppError('NOT_IN_STATION', 409, 'Oyundayken ekipman yalnızca istasyonda değiştirilebilir. Önce istasyona dön.');
    }
  }

  /**
   * reason: stats (konfigürasyon/ekipman) · ship (aktif gemi değişti) · repair (can değişti) · inventory (mühimmat sayıları)
   */
  async notifyPlayerUpdated(playerId: string, reason: PlayerUpdateReason = 'stats') {
    if (!this.redis) return;
    await this.redis.publish(GAME_CHANNELS.playerUpdated, JSON.stringify({ playerId, reason })).catch((err: unknown) => {
      this.log.warn({ err, playerId }, 'oyun sunucusuna değişiklik bildirilemedi');
    });
  }
}
