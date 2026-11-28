/**
 * Sosyal servis (Aşama 12): arkadaşlık, engelleme, gizlilik ayarları, bildirimler, şikâyetler, sohbet geçmişi.
 *
 *  - Engelleme iki yönlü etkiler: engellenen pilotun mesajları (canlı ve geçmiş) gösterilmez, özel mesajı, arkadaşlık
 *    isteği, grup ve klan daveti iletilmez. Engellemek mevcut arkadaşlığı ve istekleri siler.
 *  - Arkadaş listesinde çevrimiçi durum ve harita, ARKADAŞIN kendi gizlilik ayarına göre gösterilir.
 *  - Şikâyet, şikâyet anındaki içeriğin bir kopyasıyla moderasyon kuyruğuna (reports) yazılır.
 */
import {
  DEFAULT_SOCIAL_SETTINGS,
  dmChannel,
  friendRespondSchema,
  levelForXp,
  normalizeClanTag,
  notificationReadSchema,
  reportSchema,
  socialPilotSchema,
  socialSettingsSchema,
  type ChatChannel,
  type ChatMessageView,
  type FriendsResponse,
  type NotificationsResponse,
  type SocialSettings,
} from '@turkorbit/shared';
import { uniqueViolation, withTransaction, type Db, type Queryable } from '../../db/pool.js';
import { getSetting } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import type { GameBridge } from '../game/bridge.js';
import { err, isBlocked, myPilot, pilotByName, type Pilot } from './common.js';
import { Notifier, Outbox } from './notifications.js';

export interface SocialLimits {
  max_friends: number;
  max_blocks: number;
  party_max: number;
  party_invite_seconds: number;
  notification_keep: number;
}
export const DEFAULT_SOCIAL_LIMITS: SocialLimits = { max_friends: 200, max_blocks: 500, party_max: 8, party_invite_seconds: 60, notification_keep: 200 };

interface SettingsRow {
  location_sharing: SocialSettings['locationSharing'];
  friends_see_online: boolean;
  dm_policy: SocialSettings['dmPolicy'];
  group_invites: SocialSettings['groupInvites'];
  friend_requests: boolean;
}
const toSettings = (r: SettingsRow | undefined): SocialSettings =>
  r
    ? { locationSharing: r.location_sharing, friendsSeeOnline: r.friends_see_online, dmPolicy: r.dm_policy, groupInvites: r.group_invites, friendRequests: r.friend_requests }
    : { ...DEFAULT_SOCIAL_SETTINGS };

export async function loadSocialSettings(c: Queryable, playerId: string): Promise<SocialSettings> {
  const r = await c.query<SettingsRow>(
    'SELECT location_sharing, friends_see_online, dm_policy, group_invites, friend_requests FROM player_social_settings WHERE player_id = $1',
    [playerId],
  );
  return toSettings(r.rows[0]);
}

export async function areFriends(c: Queryable, a: string, b: string): Promise<boolean> {
  const r = await c.query(`SELECT 1 FROM friendships WHERE player_id = $1 AND friend_id = $2 AND status = 'accepted'`, [a, b]);
  return (r.rowCount ?? 0) > 0;
}

/** Sohbet mesajı satırından görünüm (gönderenin güncel klan etiketiyle). */
export const CHAT_SELECT = `SELECT m.id::text, m.channel, m.body, m.created_at, sp.pilot_name::text AS sender, sp.experience, sco.code AS company,
    sc.tag::text AS clan_tag, rp.pilot_name::text AS recipient
  FROM chat_messages m JOIN players sp ON sp.id = m.sender_id JOIN companies sco ON sco.id = sp.company_id
  LEFT JOIN clan_members scm ON scm.player_id = sp.id LEFT JOIN clans sc ON sc.id = scm.clan_id
  LEFT JOIN players rp ON rp.id = m.recipient_id`;
export interface ChatRow {
  id: string;
  channel: string;
  body: string;
  created_at: Date;
  sender: string;
  experience: string;
  company: string;
  clan_tag: string | null;
  recipient: string | null;
}
export function chatView(r: ChatRow): ChatMessageView {
  const ch = r.channel.split(':')[0] as ChatChannel;
  return {
    id: Number(r.id),
    ch: ch,
    from: { name: r.sender, company: r.company, clanTag: r.clan_tag, level: levelForXp(Number(r.experience)) },
    ...(r.recipient ? { to: r.recipient } : {}),
    b: r.body,
    at: r.created_at.toISOString(),
  };
}

export class SocialService {
  private readonly bridge: GameBridge | null;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly notifier: Notifier,
    o: { bridge?: GameBridge | null } = {},
  ) {
    this.bridge = o.bridge ?? null;
  }

  private async limits(c: Queryable = this.db): Promise<SocialLimits> {
    return { ...DEFAULT_SOCIAL_LIMITS, ...(await getSetting<Partial<SocialLimits>>(c, 'social')) };
  }

  private async run<T>(fn: (c: Queryable, out: Outbox) => Promise<T>): Promise<T> {
    const out = new Outbox();
    const r = await withTransaction(this.db, (c) => fn(c, out));
    await this.notifier.flush(out);
    return r;
  }

  // ================================================================== arkadaşlar
  async friends(owner: { id: string }, serverCode: string): Promise<FriendsResponse> {
    const me = await myPilot(this.db, owner.id, serverCode);
    const [friends, incoming, outgoing, blocked, settings, limits] = await Promise.all([
      this.db.query<{ id: string; pilot_name: string; experience: string; code: string; color_hex: string; clan_tag: string | null; accepted_at: Date | null; created_at: Date; friends_see_online: boolean | null }>(
        `SELECT p.id, p.pilot_name::text AS pilot_name, p.experience, co.code, co.color_hex, c.tag::text AS clan_tag, f.accepted_at, f.created_at,
                s.friends_see_online
         FROM friendships f JOIN players p ON p.id = f.friend_id JOIN companies co ON co.id = p.company_id
         LEFT JOIN clan_members cm ON cm.player_id = p.id LEFT JOIN clans c ON c.id = cm.clan_id
         LEFT JOIN player_social_settings s ON s.player_id = p.id
         WHERE f.player_id = $1 AND f.status = 'accepted' ORDER BY p.pilot_name`,
        [me.id],
      ),
      this.db.query<{ pilot_name: string; experience: string; code: string; created_at: Date }>(
        `SELECT p.pilot_name::text AS pilot_name, p.experience, co.code, f.created_at FROM friendships f
         JOIN players p ON p.id = f.player_id JOIN companies co ON co.id = p.company_id
         WHERE f.friend_id = $1 AND f.status = 'pending' ORDER BY f.created_at DESC`,
        [me.id],
      ),
      this.db.query<{ pilot_name: string; created_at: Date }>(
        `SELECT p.pilot_name::text AS pilot_name, f.created_at FROM friendships f JOIN players p ON p.id = f.friend_id
         WHERE f.player_id = $1 AND f.status = 'pending' ORDER BY f.created_at DESC`,
        [me.id],
      ),
      this.db.query<{ pilot_name: string; created_at: Date }>(
        `SELECT p.pilot_name::text AS pilot_name, b.created_at FROM player_blocks b JOIN players p ON p.id = b.blocked_id
         WHERE b.player_id = $1 ORDER BY p.pilot_name`,
        [me.id],
      ),
      loadSocialSettings(this.db, me.id),
      this.limits(),
    ]);
    const presence = this.bridge ? await this.bridge.presenceMany(friends.rows.map((f) => f.id)) : new Map();
    const mapCodes = [...new Set([...presence.values()].map((p) => p.map))];
    const maps = mapCodes.length
      ? new Map((await this.db.query<{ code: string; name: string }>('SELECT code, name FROM maps WHERE code = ANY($1)', [mapCodes])).rows.map((m) => [m.code, m.name]))
      : new Map<string, string>();
    return {
      friends: friends.rows.map((f) => {
        const visible = f.friends_see_online ?? true;
        const p = presence.get(f.id);
        return {
          pilotName: f.pilot_name,
          level: levelForXp(Number(f.experience)),
          company: { code: f.code, colorHex: f.color_hex },
          clanTag: f.clan_tag,
          online: visible ? Boolean(p) : null,
          map: visible && p ? { code: p.map, name: maps.get(p.map) ?? p.map } : null,
          since: (f.accepted_at ?? f.created_at).toISOString(),
        };
      }),
      incoming: incoming.rows.map((r) => ({ pilotName: r.pilot_name, level: levelForXp(Number(r.experience)), company: r.code, createdAt: r.created_at.toISOString() })),
      outgoing: outgoing.rows.map((r) => ({ pilotName: r.pilot_name, createdAt: r.created_at.toISOString() })),
      blocked: blocked.rows.map((r) => ({ pilotName: r.pilot_name, createdAt: r.created_at.toISOString() })),
      settings,
      max: limits.max_friends,
    };
  }

  private async friendCount(c: Queryable, id: string) {
    const r = await c.query<{ n: string }>(`SELECT count(*) AS n FROM friendships WHERE player_id = $1 AND status = 'accepted'`, [id]);
    return Number(r.rows[0]!.n);
  }

  /** İki pilotun satırları kimlik sırasıyla kilitlenir (aynı çift üzerinde eşzamanlı istekler sıraya girer). */
  private async lockPair(c: Queryable, a: string, b: string) {
    await c.query('SELECT id FROM players WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[a, b]]);
  }

  private async accept(c: Queryable, out: Outbox, me: Pilot, other: Pilot) {
    const lim = await this.limits(c);
    if ((await this.friendCount(c, me.id)) >= lim.max_friends) throw err('FRIEND_LIMIT', 409, `Arkadaş listen dolu (en fazla ${lim.max_friends}).`);
    if ((await this.friendCount(c, other.id)) >= lim.max_friends) throw err('FRIEND_LIMIT', 409, `${other.name} adlı pilotun arkadaş listesi dolu.`);
    await c.query(`UPDATE friendships SET status = 'accepted', accepted_at = now() WHERE player_id = $1 AND friend_id = $2`, [other.id, me.id]);
    await c.query(
      `INSERT INTO friendships (player_id, friend_id, status, accepted_at) VALUES ($1, $2, 'accepted', now())
       ON CONFLICT (player_id, friend_id) DO UPDATE SET status = 'accepted', accepted_at = now()`,
      [me.id, other.id],
    );
    await this.notifier.create(c, out, other.id, { kind: 'friend_accepted', title: 'Arkadaşlık isteğin kabul edildi', body: `${me.name} artık arkadaşın.`, link: '/sosyal' });
  }

  async request(owner: { id: string }, input: unknown): Promise<FriendsResponse> {
    const b = socialPilotSchema.parse(input);
    await this.run(async (c, out) => {
      const me = await myPilot(c, owner.id, b.serverCode);
      const other = await pilotByName(c, me.serverId, b.pilotName);
      if (other.id === me.id) throw err('VALIDATION_ERROR', 400, 'Kendine arkadaşlık isteği gönderemezsin.');
      await this.lockPair(c, me.id, other.id);
      if (await isBlocked(c, me.id, other.id)) throw err('BLOCKED', 409, `${other.name} adlı pilotu engellemişsin. Önce engeli kaldır.`);
      // Engellenmiş olmak ve isteğe kapalı olmak aynı mesajla bildirilir (kimin engellediği sızmaz)
      const closed = (await isBlocked(c, other.id, me.id)) || !(await loadSocialSettings(c, other.id)).friendRequests;
      const rows = await c.query<{ player_id: string; status: string }>(
        'SELECT player_id, status FROM friendships WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)',
        [me.id, other.id],
      );
      if (rows.rows.some((r) => r.status === 'accepted')) throw err('FRIEND_EXISTS', 409, `${other.name} zaten arkadaşın.`);
      if (rows.rows.some((r) => r.player_id === other.id)) {
        // Karşı taraf zaten istek göndermiş: bu, kabul demektir
        await this.accept(c, out, me, other);
        return;
      }
      if (rows.rows.some((r) => r.player_id === me.id)) throw err('FRIEND_EXISTS', 409, `${other.name} adlı pilota zaten istek gönderdin.`);
      if (closed) throw err('NOT_ALLOWED', 403, `${other.name} şu an arkadaşlık isteği kabul etmiyor.`);
      const lim = await this.limits(c);
      if ((await this.friendCount(c, me.id)) >= lim.max_friends) throw err('FRIEND_LIMIT', 409, `Arkadaş listen dolu (en fazla ${lim.max_friends}).`);
      await c.query(`INSERT INTO friendships (player_id, friend_id, status) VALUES ($1, $2, 'pending')`, [me.id, other.id]);
      await this.notifier.create(c, out, other.id, { kind: 'friend_request', title: 'Arkadaşlık isteği', body: `${me.name} (Sv ${me.level}) seni arkadaş olarak eklemek istiyor.`, link: '/sosyal' });
    });
    return this.friends(owner, b.serverCode);
  }

  async respond(owner: { id: string }, input: unknown): Promise<FriendsResponse> {
    const b = friendRespondSchema.parse(input);
    await this.run(async (c, out) => {
      const me = await myPilot(c, owner.id, b.serverCode);
      const other = await pilotByName(c, me.serverId, b.pilotName);
      await this.lockPair(c, me.id, other.id);
      const r = await c.query(`SELECT 1 FROM friendships WHERE player_id = $1 AND friend_id = $2 AND status = 'pending'`, [other.id, me.id]);
      if (!r.rowCount) throw err('NOT_FOUND', 404, `${other.name} adlı pilottan bekleyen bir istek yok.`);
      if (b.accept) await this.accept(c, out, me, other);
      else await c.query('DELETE FROM friendships WHERE player_id = $1 AND friend_id = $2', [other.id, me.id]);
    });
    return this.friends(owner, b.serverCode);
  }

  /** Arkadaşlıktan çıkarma veya gönderilen isteği geri çekme. */
  async remove(owner: { id: string }, input: unknown): Promise<FriendsResponse> {
    const b = socialPilotSchema.parse(input);
    await this.run(async (c) => {
      const me = await myPilot(c, owner.id, b.serverCode);
      const other = await pilotByName(c, me.serverId, b.pilotName);
      await this.lockPair(c, me.id, other.id);
      const r = await c.query(
        `DELETE FROM friendships WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1 AND status = 'accepted')`,
        [me.id, other.id],
      );
      if (!r.rowCount) throw err('NOT_FOUND', 404, `${other.name} arkadaş listende değil.`);
    });
    return this.friends(owner, b.serverCode);
  }

  // ================================================================== engelleme
  async block(owner: { id: string }, input: unknown): Promise<FriendsResponse> {
    const b = socialPilotSchema.parse(input);
    await this.run(async (c, out) => {
      const me = await myPilot(c, owner.id, b.serverCode);
      const other = await pilotByName(c, me.serverId, b.pilotName);
      if (other.id === me.id) throw err('VALIDATION_ERROR', 400, 'Kendini engelleyemezsin.');
      await this.lockPair(c, me.id, other.id);
      const lim = await this.limits(c);
      const n = await c.query<{ n: string }>('SELECT count(*) AS n FROM player_blocks WHERE player_id = $1', [me.id]);
      if (Number(n.rows[0]!.n) >= lim.max_blocks) throw err('NOT_ALLOWED', 409, `En fazla ${lim.max_blocks} pilot engelleyebilirsin.`);
      await c.query('INSERT INTO player_blocks (player_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me.id, other.id]);
      await c.query('DELETE FROM friendships WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)', [me.id, other.id]);
      out.social.add(me.id);
      out.social.add(other.id);
    });
    return this.friends(owner, b.serverCode);
  }

  async unblock(owner: { id: string }, input: unknown): Promise<FriendsResponse> {
    const b = socialPilotSchema.parse(input);
    await this.run(async (c, out) => {
      const me = await myPilot(c, owner.id, b.serverCode);
      const other = await pilotByName(c, me.serverId, b.pilotName);
      const r = await c.query('DELETE FROM player_blocks WHERE player_id = $1 AND blocked_id = $2', [me.id, other.id]);
      if (!r.rowCount) throw err('NOT_FOUND', 404, `${other.name} engellenenler listende değil.`);
      out.social.add(me.id);
      out.social.add(other.id);
    });
    return this.friends(owner, b.serverCode);
  }

  // ================================================================== gizlilik
  async updateSettings(owner: { id: string }, input: unknown): Promise<FriendsResponse> {
    const b = socialSettingsSchema.parse(input);
    await this.run(async (c, out) => {
      const me = await myPilot(c, owner.id, b.serverCode);
      await c.query(
        `INSERT INTO player_social_settings (player_id, location_sharing, friends_see_online, dm_policy, group_invites, friend_requests, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (player_id) DO UPDATE SET location_sharing = $2, friends_see_online = $3, dm_policy = $4, group_invites = $5,
           friend_requests = $6, updated_at = now()`,
        [me.id, b.locationSharing, b.friendsSeeOnline, b.dmPolicy, b.groupInvites, b.friendRequests],
      );
      out.social.add(me.id);
    });
    return this.friends(owner, b.serverCode);
  }

  // ================================================================== bildirimler
  async notifications(owner: { id: string }, serverCode: string): Promise<NotificationsResponse> {
    const me = await myPilot(this.db, owner.id, serverCode);
    return this.notifier.list(this.db, me.id);
  }

  async unreadCount(owner: { id: string }, serverCode: string): Promise<number> {
    const me = await myPilot(this.db, owner.id, serverCode);
    return this.notifier.unread(this.db, me.id);
  }

  async markRead(owner: { id: string }, input: unknown): Promise<NotificationsResponse> {
    const b = notificationReadSchema.parse(input);
    const me = await myPilot(this.db, owner.id, b.serverCode);
    await this.notifier.markRead(this.db, me.id, b.ids);
    await this.notifier.prune(this.db, me.id);
    return this.notifier.list(this.db, me.id);
  }

  // ================================================================== şikâyet
  async report(owner: { id: string }, input: unknown): Promise<{ id: number }> {
    const b = reportSchema.parse(input);
    const me = await myPilot(this.db, owner.id, b.serverCode);
    let targetId = b.target;
    let targetPlayer: string | null = null;
    let snapshot: Record<string, unknown> = {};
    if (b.targetType === 'chat_message') {
      if (!/^\d{1,18}$/.test(b.target)) throw err('NOT_FOUND', 404, 'Mesaj bulunamadı.');
      const r = await this.db.query<ChatRow & { sender_id: string; server_id: number; recipient_id: string | null }>(
        `${CHAT_SELECT.replace('SELECT ', 'SELECT m.sender_id, m.server_id, m.recipient_id, ')} WHERE m.id = $1`,
        [b.target],
      );
      const m = r.rows[0];
      // Özel mesajlar yalnızca iki tarafça şikâyet edilebilir
      if (!m || m.server_id !== me.serverId || (m.recipient_id && m.recipient_id !== me.id && m.sender_id !== me.id)) throw err('NOT_FOUND', 404, 'Mesaj bulunamadı.');
      if (m.sender_id === me.id) throw err('VALIDATION_ERROR', 400, 'Kendi mesajını şikâyet edemezsin.');
      targetPlayer = m.sender_id;
      snapshot = { body: m.body, sender: m.sender, channel: m.channel.split(':')[0], at: m.created_at.toISOString() };
    } else if (b.targetType === 'player') {
      const p = await pilotByName(this.db, me.serverId, b.target);
      if (p.id === me.id) throw err('VALIDATION_ERROR', 400, 'Kendini şikâyet edemezsin.');
      targetId = p.name;
      targetPlayer = p.id;
      snapshot = { pilotName: p.name, company: p.company, level: p.level };
    } else {
      const r = await this.db.query<{ id: string; tag: string; name: string; description: string | null }>(
        'SELECT id, tag::text AS tag, name::text AS name, description FROM clans WHERE server_id = $1 AND tag = $2',
        [me.serverId, normalizeClanTag(b.target)],
      );
      const cl = r.rows[0];
      if (!cl) throw err('CLAN_NOT_FOUND', 404, 'Klan bulunamadı.');
      targetId = cl.tag;
      snapshot = { tag: cl.tag, name: cl.name, description: cl.description };
    }
    try {
      const ins = await this.db.query<{ id: string }>(
        `INSERT INTO reports (reporter_user_id, reporter_player_id, target_type, target_id, target_player_id, reason, details, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
        [owner.id, me.id, b.targetType, targetId, targetPlayer, b.reason, b.details || null, JSON.stringify(snapshot)],
      );
      this.log.info({ reportId: ins.rows[0]!.id, type: b.targetType, reason: b.reason }, 'şikâyet alındı');
      return { id: Number(ins.rows[0]!.id) };
    } catch (e) {
      if (uniqueViolation(e)) throw err('REPORT_EXISTS', 409, 'Bu içerik için zaten açık bir şikâyetin var; moderasyon ekibi inceliyor.');
      throw e;
    }
  }

  // ================================================================== sohbet geçmişi
  async chatHistory(owner: { id: string }, q: { server?: string; channel?: string; with?: string; before?: string }): Promise<{ messages: ChatMessageView[] }> {
    const me = await myPilot(this.db, owner.id, q.server ?? 'TR1');
    const chat = { history: 50, ...(await getSetting<{ history?: number }>(this.db, 'chat')) };
    let channel: string;
    switch (q.channel) {
      case 'global':
        channel = 'global';
        break;
      case 'company':
        channel = `company:${me.company}`;
        break;
      case 'clan': {
        const r = await this.db.query<{ clan_id: string }>('SELECT clan_id FROM clan_members WHERE player_id = $1', [me.id]);
        if (!r.rows[0]) throw err('NOT_IN_CLAN', 400, 'Bir klanda değilsin.');
        channel = `clan:${r.rows[0].clan_id}`;
        break;
      }
      case 'dm': {
        if (!q.with || !/^[A-Za-z0-9_]{1,20}$/.test(q.with)) throw err('VALIDATION_ERROR', 400, 'Özel mesaj geçmişi için pilot adı gerekli.');
        const other = await pilotByName(this.db, me.serverId, q.with);
        channel = dmChannel(me.id, other.id);
        break;
      }
      default:
        throw err('VALIDATION_ERROR', 400, 'Geçmişi okunabilen kanallar: global, company, clan, dm.');
    }
    const before = q.before && /^\d{1,18}$/.test(q.before) ? q.before : null;
    const r = await this.db.query<ChatRow>(
      `${CHAT_SELECT} WHERE m.server_id = $1 AND m.channel = $2 AND NOT m.is_deleted
         AND NOT EXISTS (SELECT 1 FROM player_blocks b WHERE b.player_id = $3 AND b.blocked_id = m.sender_id)
         AND ($5::bigint IS NULL OR m.id < $5::bigint)
       ORDER BY m.id DESC LIMIT $4`,
      [me.serverId, channel, me.id, Math.min(100, chat.history), before],
    );
    return { messages: r.rows.reverse().map(chatView) };
  }

  /** Özel mesajlaşılan pilotlar (en son mesaja göre). Engellenenler listelenmez. */
  async conversations(owner: { id: string }, serverCode: string): Promise<{ items: Array<{ pilotName: string; last: string; at: string; fromMe: boolean }> }> {
    const me = await myPilot(this.db, owner.id, serverCode);
    const r = await this.db.query<{ other: string; body: string; created_at: Date; from_me: boolean }>(
      `SELECT DISTINCT ON (other) other, body, created_at, from_me FROM (
         SELECT CASE WHEN m.sender_id = $1 THEN rp.pilot_name ELSE sp.pilot_name END::text AS other,
                CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS other_id,
                m.body, m.created_at, m.id, m.sender_id = $1 AS from_me
         FROM chat_messages m JOIN players sp ON sp.id = m.sender_id JOIN players rp ON rp.id = m.recipient_id
         WHERE m.server_id = $2 AND m.channel LIKE 'dm:%' AND (m.sender_id = $1 OR m.recipient_id = $1) AND NOT m.is_deleted) x
       WHERE NOT EXISTS (SELECT 1 FROM player_blocks b WHERE b.player_id = $1 AND b.blocked_id = x.other_id)
       ORDER BY other, id DESC`,
      [me.id, me.serverId],
    );
    const items = r.rows
      .map((x) => ({ pilotName: x.other, last: x.body.slice(0, 80), at: x.created_at.toISOString(), fromMe: x.from_me }))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 30);
    return { items };
  }

  /** Profil sayfası için: görüntüleyen ile pilot arasındaki ilişki. */
  async relationTo(owner: { id: string }, serverCode: string, pilotName: string): Promise<{ friend: 'none' | 'pending_out' | 'pending_in' | 'friends'; blocked: boolean; self: boolean }> {
    const me = await myPilot(this.db, owner.id, serverCode);
    const other = await pilotByName(this.db, me.serverId, pilotName);
    if (other.id === me.id) return { friend: 'none', blocked: false, self: true };
    const rows = await this.db.query<{ player_id: string; status: string }>(
      'SELECT player_id, status FROM friendships WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)',
      [me.id, other.id],
    );
    const friend = rows.rows.some((r) => r.status === 'accepted')
      ? 'friends'
      : rows.rows.some((r) => r.player_id === me.id)
        ? 'pending_out'
        : rows.rows.some((r) => r.player_id === other.id)
          ? 'pending_in'
          : 'none';
    return { friend, blocked: await isBlocked(this.db, me.id, other.id), self: false };
  }

  async limitsPublic() {
    return this.limits();
  }

  async areFriends(a: string, b: string) {
    return areFriends(this.db, a, b);
  }
}
