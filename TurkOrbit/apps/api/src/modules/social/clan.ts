/**
 * Klan servisi (Aşama 12): kurma, başvuru/davet, rütbe ve yetkiler, hazine, diplomasi, etkinlik kaydı.
 *
 * Güvenlik ilkeleri:
 *  - Her yetki sunucuda, işlem anındaki rütbeden okunur (CLAN_PERMISSION). Yalnızca alt rütbedekiler yönetilebilir.
 *  - Klanı değiştiren her işlem klan satırını kilitler (FOR UPDATE): eşzamanlı katılımda üye sınırı aşılamaz.
 *  - Bir pilot tek klanda olabilir (clan_members.player_id UNIQUE). Rütbe aynı klana ait olmalı (bileşik FK).
 *  - Hazine hareketleri defterli ve idempotenttir; kilit sırası: önce pilot cüzdanı, en son klan cüzdanı.
 *  - Bildirimler transaction içinde yazılır, anlık iletim işlem bitince yapılır.
 */
import {
  CLAN_PERMISSION_LABELS,
  clanApplySchema,
  clanCreateSchema,
  clanDecideSchema,
  clanDepositSchema,
  clanIdSchema,
  clanMemberRankSchema,
  clanPilotSchema,
  clanProposeSchema,
  clanRankUpdateSchema,
  clanRespondSchema,
  clanServerSchema,
  clanTargetSchema,
  clanUpdateSchema,
  clanWithdrawSchema,
  CLAN_PERMISSIONS,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_CLAN_RANKS,
  DIPLOMACY_LABELS,
  filterChat,
  hasClanPermission,
  levelForXp,
  normalizeClanTag,
  outranks,
  type ChatSettings,
  type ClanEventView,
  type ClanPermission,
  type ClanPublicView,
  type ClanRankView,
  type ClanRelationView,
  type ClanResponse,
  type ClanSummary,
  type DiplomacyRelation,
  type MyClanView,
  type RankLike,
} from '@turkorbit/shared';
import { uniqueViolation, withTransaction, type Db, type DbClient, type Queryable } from '../../db/pool.js';
import { getSetting } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import { applyCurrencyChange } from '../economy/wallet.js';
import type { GameBridge } from '../game/bridge.js';
import { err, fmt, isBlocked, myPilot, pilotById, pilotByName, type Pilot } from './common.js';
import { Notifier, Outbox } from './notifications.js';
import { applyClanCurrencyChange } from './treasury.js';

export interface ClanSettings {
  create_cost: { currency: string; amount: number };
  create_min_level: number;
  max_members: number;
  invitation_days: number;
  max_relations: number;
}
export const DEFAULT_CLAN_SETTINGS: ClanSettings = {
  create_cost: { currency: 'KREDI', amount: 50_000 },
  create_min_level: 5,
  max_members: 50,
  invitation_days: 7,
  max_relations: 10,
};

interface ClanRow {
  id: string;
  server_id: number;
  tag: string;
  name: string;
  description: string | null;
  leader_id: string | null;
  tax_percent: number;
  is_recruiting: boolean;
  min_level: number;
  created_at: Date;
}
interface RankRow {
  id: number;
  name: string;
  sort_order: number;
  is_leader: boolean;
  permissions: string[];
}
interface Membership {
  clan: ClanRow;
  rank: RankRow;
}

const CLAN_COLS = 'c.id, c.server_id, c.tag::text AS tag, c.name::text AS name, c.description, c.leader_id, c.tax_percent, c.is_recruiting, c.min_level, c.created_at';
const rankLike = (r: RankRow): RankLike => ({ sortOrder: r.sort_order, isLeader: r.is_leader, permissions: r.permissions });
const rel = (r: DiplomacyRelation) => DIPLOMACY_LABELS[r].toLocaleLowerCase('tr-TR');

function eventText(kind: string, actor: string | null, target: string | null, d: Record<string, unknown>): string {
  const a = actor ?? 'Bir pilot';
  const t = target ?? 'bir pilot';
  switch (kind) {
    case 'created':
      return `${a} klanı kurdu.`;
    case 'joined':
      return `${t} klana katıldı.`;
    case 'left':
      return `${a} klandan ayrıldı.`;
    case 'kicked':
      return `${a}, ${t} adlı pilotu klandan çıkardı.`;
    case 'rank':
      return `${a}, ${t} adlı pilotun rütbesini "${String(d.rank)}" yaptı.`;
    case 'leader':
      return `${a} liderliği ${t} adlı pilota devretti.`;
    case 'info':
      return `${a} klan bilgilerini güncelledi.`;
    case 'tax':
      return `${a} klan vergisini %${String(d.tax)} yaptı.`;
    case 'rank_edit':
      return `${a} "${String(d.rank)}" rütbesini düzenledi.`;
    case 'deposit':
      return `${a} hazineye ${fmt(Number(d.amount))} Kredi yatırdı.`;
    case 'payout':
      return `${a}, ${t} adlı pilota hazineden ${fmt(Number(d.amount))} Kredi ödedi.`;
    case 'dip_proposed':
      return `${a}, [${String(d.tag)}] klanına ${rel(d.relation as DiplomacyRelation)} önerdi.`;
    case 'dip_received':
      return `[${String(d.tag)}] klanı ${rel(d.relation as DiplomacyRelation)} önerdi.`;
    case 'dip_active':
      return `[${String(d.tag)}] klanıyla ${rel(d.relation as DiplomacyRelation)} başladı.`;
    case 'dip_rejected':
      return `[${String(d.tag)}] klanıyla ${rel(d.relation as DiplomacyRelation)} önerisi reddedildi.`;
    case 'dip_ended':
      return `[${String(d.tag)}] klanıyla ${rel(d.relation as DiplomacyRelation)} sona erdi.`;
    case 'war_declared':
      return `${a}, [${String(d.tag)}] klanına savaş ilan etti.`;
    case 'war_received':
      return `[${String(d.tag)}] klanı bize savaş ilan etti.`;
    case 'peace_proposed':
      return `${a}, [${String(d.tag)}] klanına barış önerdi.`;
    case 'peace_received':
      return `[${String(d.tag)}] klanı barış önerdi.`;
    default:
      return kind;
  }
}

export class ClanService {
  private readonly bridge: GameBridge | null;
  private readonly notifier: Notifier;
  private readonly clock: () => Date;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    o: { bridge?: GameBridge | null; notifier: Notifier; clock?: () => Date },
  ) {
    this.bridge = o.bridge ?? null;
    this.notifier = o.notifier;
    this.clock = o.clock ?? (() => new Date());
  }

  // ================================================================== yardımcılar
  private async settings(c: Queryable = this.db): Promise<ClanSettings> {
    return { ...DEFAULT_CLAN_SETTINGS, ...(await getSetting<Partial<ClanSettings>>(c, 'clan')) };
  }

  private async run<T>(fn: (c: DbClient, out: Outbox) => Promise<T>): Promise<T> {
    const out = new Outbox();
    const r = await withTransaction(this.db, (c) => fn(c, out));
    await this.notifier.flush(out);
    return r;
  }

  private async membership(c: Queryable, playerId: string, lockClan: boolean): Promise<Membership | null> {
    const m = await c.query<{ clan_id: string }>('SELECT clan_id FROM clan_members WHERE player_id = $1', [playerId]);
    if (!m.rows[0]) return null;
    const cl = await c.query<ClanRow>(`SELECT ${CLAN_COLS} FROM clans c WHERE c.id = $1 ${lockClan ? 'FOR UPDATE' : ''}`, [m.rows[0].clan_id]);
    if (!cl.rows[0]) return null;
    const r = await c.query<RankRow>(
      `SELECT r.id, r.name, r.sort_order, r.is_leader, r.permissions FROM clan_members cm JOIN clan_ranks r ON r.id = cm.rank_id
       WHERE cm.player_id = $1 AND cm.clan_id = $2`,
      [playerId, cl.rows[0].id],
    );
    if (!r.rows[0]) return null;
    return { clan: cl.rows[0], rank: r.rows[0] };
  }

  private async requireMember(c: Queryable, pilot: Pilot, lockClan: boolean, perm?: ClanPermission): Promise<Membership> {
    const m = await this.membership(c, pilot.id, lockClan);
    if (!m) throw err('NOT_IN_CLAN', 400, 'Bir klanda değilsin.');
    if (perm && !hasClanPermission(rankLike(m.rank), perm)) {
      throw err('CLAN_PERMISSION', 403, `Bu işlem için klanında "${CLAN_PERMISSION_LABELS[perm]}" yetkisi gerekiyor.`);
    }
    return m;
  }

  private requireLeader(m: Membership) {
    if (!m.rank.is_leader) throw err('CLAN_PERMISSION', 403, 'Bu işlemi yalnızca klan lideri yapabilir.');
  }

  private async clanByTag(c: Queryable, serverId: number, tag: string, lock = false): Promise<ClanRow> {
    const r = await c.query<ClanRow>(`SELECT ${CLAN_COLS} FROM clans c WHERE c.server_id = $1 AND c.tag = $2 ${lock ? 'FOR UPDATE' : ''}`, [serverId, normalizeClanTag(tag)]);
    if (!r.rows[0]) throw err('CLAN_NOT_FOUND', 404, `[${normalizeClanTag(tag)}] etiketli klan bulunamadı.`);
    return r.rows[0];
  }

  private async memberCount(c: Queryable, clanId: string): Promise<number> {
    const r = await c.query<{ n: string }>('SELECT count(*) AS n FROM clan_members WHERE clan_id = $1', [clanId]);
    return Number(r.rows[0]!.n);
  }

  private async event(c: Queryable, clanId: string, kind: string, actor: string | null, target: string | null, data: Record<string, unknown> = {}) {
    await c.query('INSERT INTO clan_events (clan_id, kind, actor_name, target_name, data) VALUES ($1, $2, $3, $4, $5)', [clanId, kind, actor, target, JSON.stringify(data)]);
  }

  /** Verilen yetkiye sahip üyeler (lider her zaman dahil). perm yoksa tüm üyeler. */
  private async membersWith(c: Queryable, clanId: string, perm?: ClanPermission): Promise<string[]> {
    const r = await c.query<{ player_id: string }>(
      `SELECT cm.player_id FROM clan_members cm JOIN clan_ranks r ON r.id = cm.rank_id
       WHERE cm.clan_id = $1 ${perm ? 'AND (r.is_leader OR $2 = ANY(r.permissions))' : ''}`,
      perm ? [clanId, perm] : [clanId],
    );
    return r.rows.map((x) => x.player_id);
  }

  private async notifyMany(c: Queryable, out: Outbox, ids: string[], n: Parameters<Notifier['create']>[3], except?: string) {
    for (const id of ids) if (id !== except) await this.notifier.create(c, out, id, n);
  }

  private async lowestRank(c: Queryable, clanId: string): Promise<RankRow> {
    const r = await c.query<RankRow>('SELECT id, name, sort_order, is_leader, permissions FROM clan_ranks WHERE clan_id = $1 ORDER BY sort_order DESC LIMIT 1', [clanId]);
    return r.rows[0]!;
  }

  /** Pilotu klana ekler; diğer bekleyen başvuru ve davetleri iptal eder. Klan satırı kilitli olmalı. */
  private async addMember(c: Queryable, out: Outbox, clan: ClanRow, pilot: Pilot, s: ClanSettings) {
    if ((await this.memberCount(c, clan.id)) >= s.max_members) throw err('CLAN_FULL', 409, `Klan dolu (en fazla ${s.max_members} üye).`);
    const rank = await this.lowestRank(c, clan.id);
    try {
      await c.query('INSERT INTO clan_members (clan_id, player_id, rank_id) VALUES ($1, $2, $3)', [clan.id, pilot.id, rank.id]);
    } catch (e) {
      if (uniqueViolation(e)) throw err('ALREADY_IN_CLAN', 409, `${pilot.name} zaten bir klanda.`);
      throw e;
    }
    await c.query(`UPDATE clan_applications SET status = 'cancelled', decided_at = now() WHERE player_id = $1 AND status = 'pending' AND clan_id <> $2`, [pilot.id, clan.id]);
    await c.query(`UPDATE clan_invitations SET status = 'cancelled', decided_at = now() WHERE player_id = $1 AND status = 'pending' AND clan_id <> $2`, [pilot.id, clan.id]);
    await this.event(c, clan.id, 'joined', null, pilot.name);
    out.social.add(pilot.id);
  }

  // ================================================================== okuma
  async me(owner: { id: string }, serverCode: string): Promise<ClanResponse> {
    const pilot = await myPilot(this.db, owner.id, serverCode);
    const s = await this.settings();
    const m = await this.membership(this.db, pilot.id, false);
    const base = { createCost: s.create_cost, createMinLevel: s.create_min_level, level: pilot.level };
    if (!m) {
      const [inv, apps] = await Promise.all([
        this.db.query<{ id: string; tag: string; name: string; invited_by: string | null; expires_at: Date }>(
          `SELECT i.id::text, c.tag::text AS tag, c.name::text AS name, p.pilot_name::text AS invited_by, i.expires_at
           FROM clan_invitations i JOIN clans c ON c.id = i.clan_id LEFT JOIN players p ON p.id = i.invited_by
           WHERE i.player_id = $1 AND i.status = 'pending' AND i.expires_at > $2 ORDER BY i.id DESC`,
          [pilot.id, this.clock()],
        ),
        this.db.query<{ id: string; tag: string; name: string; created_at: Date }>(
          `SELECT a.id::text, c.tag::text AS tag, c.name::text AS name, a.created_at FROM clan_applications a JOIN clans c ON c.id = a.clan_id
           WHERE a.player_id = $1 AND a.status = 'pending' ORDER BY a.id DESC`,
          [pilot.id],
        ),
      ]);
      return {
        ...base,
        clan: null,
        invitations: inv.rows.map((r) => ({ id: Number(r.id), tag: r.tag, name: r.name, invitedBy: r.invited_by, expiresAt: r.expires_at.toISOString() })),
        applications: apps.rows.map((r) => ({ id: Number(r.id), tag: r.tag, name: r.name, createdAt: r.created_at.toISOString() })),
      };
    }
    return { ...base, clan: await this.myClanView(m, s), invitations: [], applications: [] };
  }

  private async myClanView(m: Membership, s: ClanSettings): Promise<MyClanView> {
    const c = this.db;
    const clan = m.clan;
    const canInvite = hasClanPermission(rankLike(m.rank), 'invite');
    const ranksQ = await c.query<RankRow & { members: string }>(
      `SELECT r.id, r.name, r.sort_order, r.is_leader, r.permissions, count(cm.player_id) AS members
       FROM clan_ranks r LEFT JOIN clan_members cm ON cm.rank_id = r.id WHERE r.clan_id = $1 GROUP BY r.id ORDER BY r.sort_order`,
      [clan.id],
    );
    const ranks: ClanRankView[] = ranksQ.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      isLeader: r.is_leader,
      permissions: (r.is_leader ? [...CLAN_PERMISSIONS] : r.permissions) as ClanPermission[],
      members: Number(r.members),
    }));
    const membersQ = await c.query<{ id: string; pilot_name: string; experience: string; code: string; color_hex: string; rank_id: number; rank_name: string; joined_at: Date }>(
      `SELECT p.id, p.pilot_name::text AS pilot_name, p.experience, co.code, co.color_hex, r.id AS rank_id, r.name AS rank_name, cm.joined_at
       FROM clan_members cm JOIN players p ON p.id = cm.player_id JOIN companies co ON co.id = p.company_id JOIN clan_ranks r ON r.id = cm.rank_id
       WHERE cm.clan_id = $1 ORDER BY r.sort_order, cm.joined_at`,
      [clan.id],
    );
    const presence = this.bridge ? await this.bridge.presenceMany(membersQ.rows.map((r) => r.id)) : new Map();
    const wallet = await c.query<{ balance: string }>(`SELECT balance FROM clan_wallets WHERE clan_id = $1 AND currency_code = 'KREDI'`, [clan.id]);
    const ledger = await c.query<{ id: string; delta: string; balance_after: string; reason: string; pilot: string | null; actor: string | null; created_at: Date }>(
      `SELECT l.id::text, l.delta, l.balance_after, l.reason, p.pilot_name::text AS pilot, a.pilot_name::text AS actor, l.created_at
       FROM clan_treasury_ledger l LEFT JOIN players p ON p.id = l.player_id LEFT JOIN players a ON a.id = l.actor_player_id
       WHERE l.clan_id = $1 ORDER BY l.id DESC LIMIT 25`,
      [clan.id],
    );
    const relations = await this.relations(c, clan.id);
    const apps = canInvite
      ? await c.query<{ id: string; pilot_name: string; experience: string; code: string; message: string | null; created_at: Date }>(
          `SELECT a.id::text, p.pilot_name::text AS pilot_name, p.experience, co.code, a.message, a.created_at
           FROM clan_applications a JOIN players p ON p.id = a.player_id JOIN companies co ON co.id = p.company_id
           WHERE a.clan_id = $1 AND a.status = 'pending' ORDER BY a.id`,
          [clan.id],
        )
      : { rows: [] };
    const invites = canInvite
      ? await c.query<{ id: string; pilot_name: string; invited_by: string | null; expires_at: Date }>(
          `SELECT i.id::text, p.pilot_name::text AS pilot_name, ib.pilot_name::text AS invited_by, i.expires_at
           FROM clan_invitations i JOIN players p ON p.id = i.player_id LEFT JOIN players ib ON ib.id = i.invited_by
           WHERE i.clan_id = $1 AND i.status = 'pending' AND i.expires_at > $2 ORDER BY i.id`,
          [clan.id, this.clock()],
        )
      : { rows: [] };
    const events = await c.query<{ id: string; kind: string; actor_name: string | null; target_name: string | null; data: Record<string, unknown>; created_at: Date }>(
      `SELECT id::text, kind, actor_name, target_name, data, created_at FROM clan_events WHERE clan_id = $1 ORDER BY id DESC LIMIT 30`,
      [clan.id],
    );
    const leader = membersQ.rows.find((r) => r.id === clan.leader_id);
    const myRank = ranks.find((r) => r.id === m.rank.id)!;
    return {
      ...this.summaryOf(clan, membersQ.rows.length, s, leader?.pilot_name ?? null),
      description: clan.description,
      myRank,
      ranks,
      memberList: membersQ.rows.map((r) => ({
        pilotName: r.pilot_name,
        level: levelForXp(Number(r.experience)),
        company: { code: r.code, colorHex: r.color_hex },
        rankId: r.rank_id,
        rankName: r.rank_name,
        joinedAt: r.joined_at.toISOString(),
        online: presence.has(r.id),
      })),
      treasury: {
        balance: Number(wallet.rows[0]?.balance ?? 0),
        entries: ledger.rows.map((r) => ({
          id: Number(r.id),
          delta: Number(r.delta),
          balanceAfter: Number(r.balance_after),
          reason: r.reason,
          pilotName: r.pilot,
          actorName: r.actor,
          createdAt: r.created_at.toISOString(),
        })),
      },
      relations,
      applications: apps.rows.map((r) => ({
        id: Number(r.id),
        pilotName: r.pilot_name,
        level: levelForXp(Number(r.experience)),
        company: r.code,
        message: r.message,
        createdAt: r.created_at.toISOString(),
      })),
      invitations: invites.rows.map((r) => ({ id: Number(r.id), pilotName: r.pilot_name, invitedBy: r.invited_by, expiresAt: r.expires_at.toISOString() })),
      events: events.rows.map(
        (r): ClanEventView => ({ id: Number(r.id), kind: r.kind, text: eventText(r.kind, r.actor_name, r.target_name, r.data), createdAt: r.created_at.toISOString() }),
      ),
    };
  }

  private summaryOf(clan: ClanRow, members: number, s: ClanSettings, leader: string | null): ClanSummary {
    return {
      tag: clan.tag,
      name: clan.name,
      members,
      maxMembers: s.max_members,
      leader,
      isRecruiting: clan.is_recruiting,
      minLevel: clan.min_level,
      taxPercent: clan.tax_percent,
      createdAt: clan.created_at.toISOString(),
    };
  }

  private async relations(c: Queryable, clanId: string): Promise<ClanRelationView[]> {
    const r = await c.query<{ other_tag: string; other_name: string; relation: DiplomacyRelation; status: 'proposed' | 'active'; proposed_by: string; peace_proposed_by: string | null; created_at: Date; activated_at: Date | null }>(
      `SELECT o.tag::text AS other_tag, o.name::text AS other_name, d.relation, d.status, d.proposed_by, d.peace_proposed_by, d.created_at, d.activated_at
       FROM clan_diplomacy d JOIN clans o ON o.id = CASE WHEN d.clan_a = $1 THEN d.clan_b ELSE d.clan_a END
       WHERE d.clan_a = $1 OR d.clan_b = $1 ORDER BY d.status, d.relation, o.tag`,
      [clanId],
    );
    return r.rows.map((x) => ({
      tag: x.other_tag,
      name: x.other_name,
      relation: x.relation,
      status: x.status,
      ours: x.proposed_by === clanId,
      peace: x.peace_proposed_by === null ? null : x.peace_proposed_by === clanId ? 'ours' : 'theirs',
      since: (x.activated_at ?? x.created_at).toISOString(),
    }));
  }

  async list(serverCode: string, q?: string): Promise<ClanSummary[]> {
    const s = await this.settings();
    const term = (q ?? '').trim().slice(0, 30);
    const like = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const r = await this.db.query<ClanRow & { members: string; leader_name: string | null }>(
      `SELECT ${CLAN_COLS}, (SELECT count(*) FROM clan_members m WHERE m.clan_id = c.id) AS members, lp.pilot_name::text AS leader_name
       FROM clans c JOIN game_servers s ON s.id = c.server_id LEFT JOIN players lp ON lp.id = c.leader_id
       WHERE s.code = $1 AND ($2 = '' OR c.tag ILIKE $3 OR c.name ILIKE $3)
       ORDER BY members DESC, c.created_at LIMIT 50`,
      [serverCode.toUpperCase(), term, like],
    );
    return r.rows.map((x) => this.summaryOf(x, Number(x.members), s, x.leader_name));
  }

  async publicView(serverCode: string, tag: string): Promise<ClanPublicView> {
    const s = await this.settings();
    const sv = await this.db.query<{ id: number }>('SELECT id FROM game_servers WHERE code = $1', [serverCode.toUpperCase()]);
    if (!sv.rows[0] || !/^[A-Za-z0-9ÇĞİÖŞÜçğıöşü]{2,5}$/.test(tag)) throw err('CLAN_NOT_FOUND', 404, 'Klan bulunamadı.');
    const clan = await this.clanByTag(this.db, sv.rows[0].id, tag);
    const members = await this.db.query<{ id: string; pilot_name: string; experience: string; rank_name: string; code: string }>(
      `SELECT p.id, p.pilot_name::text AS pilot_name, p.experience, r.name AS rank_name, co.code
       FROM clan_members cm JOIN players p ON p.id = cm.player_id JOIN clan_ranks r ON r.id = cm.rank_id JOIN companies co ON co.id = p.company_id
       WHERE cm.clan_id = $1 ORDER BY r.sort_order, cm.joined_at`,
      [clan.id],
    );
    const leader = members.rows.find((m) => m.id === clan.leader_id)?.pilot_name ?? null;
    const relations = (await this.relations(this.db, clan.id)).filter((x) => x.status === 'active').map((x) => ({ ...x, ours: false, peace: null }));
    return {
      ...this.summaryOf(clan, members.rows.length, s, leader),
      description: clan.description,
      memberList: members.rows.map((m) => ({ pilotName: m.pilot_name, level: levelForXp(Number(m.experience)), rankName: m.rank_name, company: m.code })),
      relations,
    };
  }

  // ================================================================== kurma ve bilgiler
  async create(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanCreateSchema.parse(input);
    const key = `clan-create:${owner.id}:${b.requestId}`;
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode, true);
      const replay = await c.query('SELECT 1 FROM currency_ledger WHERE idempotency_key = $1', [key]);
      if (replay.rowCount) return;
      const s = await this.settings(c);
      if (pilot.level < s.create_min_level) throw err('LEVEL_TOO_LOW', 400, `Klan kurmak için en az ${s.create_min_level}. seviye olmalısın.`);
      if (await this.membership(c, pilot.id, false)) throw err('ALREADY_IN_CLAN', 409, 'Zaten bir klandasın. Yeni klan kurmak için önce ayrılmalısın.');
      const chat = { ...DEFAULT_CHAT_SETTINGS, ...(await getSetting<Partial<ChatSettings>>(c, 'chat')) };
      if (filterChat(`${b.tag} ${b.name}`, chat.banned_words).filtered) throw err('VALIDATION_ERROR', 400, 'Klan adı veya etiketi uygunsuz bir kelime içeriyor.');
      const exists = await c.query(`SELECT tag::text FROM clans WHERE server_id = $1 AND (tag = $2 OR name = $3)`, [pilot.serverId, b.tag, b.name]);
      if (exists.rowCount) throw err('CLAN_EXISTS', 409, 'Bu etiket veya ad başka bir klan tarafından kullanılıyor.');
      await applyCurrencyChange(c, {
        playerId: pilot.id,
        currency: s.create_cost.currency,
        delta: -s.create_cost.amount,
        reason: 'clan_create',
        refType: 'clan',
        refId: b.tag,
        idempotencyKey: key,
      });
      let clanId: string;
      try {
        const ins = await c.query<{ id: string }>(
          `INSERT INTO clans (server_id, tag, name, description, leader_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [pilot.serverId, b.tag, b.name, b.description || null, pilot.id],
        );
        clanId = ins.rows[0]!.id;
      } catch (e) {
        if (uniqueViolation(e)) throw err('CLAN_EXISTS', 409, 'Bu etiket veya ad başka bir klan tarafından kullanılıyor.');
        throw e;
      }
      let leaderRank = 0;
      for (const r of DEFAULT_CLAN_RANKS) {
        const ins = await c.query<{ id: number }>(
          'INSERT INTO clan_ranks (clan_id, name, sort_order, is_leader, permissions) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [clanId, r.name, r.sortOrder, r.isLeader, r.isLeader ? [] : r.permissions],
        );
        if (r.isLeader) leaderRank = ins.rows[0]!.id;
      }
      await c.query('INSERT INTO clan_members (clan_id, player_id, rank_id) VALUES ($1, $2, $3)', [clanId, pilot.id, leaderRank]);
      await c.query(`UPDATE clan_applications SET status = 'cancelled', decided_at = now() WHERE player_id = $1 AND status = 'pending'`, [pilot.id]);
      await c.query(`UPDATE clan_invitations SET status = 'cancelled', decided_at = now() WHERE player_id = $1 AND status = 'pending'`, [pilot.id]);
      await this.event(c, clanId, 'created', pilot.name, null);
      out.social.add(pilot.id);
    });
    return this.me(owner, b.serverCode);
  }

  async update(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanUpdateSchema.parse(input);
    await this.run(async (c) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true);
      const infoChange = b.description !== undefined || b.isRecruiting !== undefined || b.minLevel !== undefined;
      if (infoChange && !hasClanPermission(rankLike(m.rank), 'edit_info')) {
        throw err('CLAN_PERMISSION', 403, `Bu işlem için klanında "${CLAN_PERMISSION_LABELS.edit_info}" yetkisi gerekiyor.`);
      }
      if (b.taxPercent !== undefined && b.taxPercent !== m.clan.tax_percent) {
        this.requireLeader(m);
        await c.query('UPDATE clans SET tax_percent = $2 WHERE id = $1', [m.clan.id, b.taxPercent]);
        await this.event(c, m.clan.id, 'tax', pilot.name, null, { tax: b.taxPercent });
      }
      if (infoChange) {
        await c.query(
          `UPDATE clans SET description = CASE WHEN $2 THEN $3 ELSE description END,
             is_recruiting = COALESCE($4, is_recruiting), min_level = COALESCE($5, min_level) WHERE id = $1`,
          [m.clan.id, b.description !== undefined, b.description ? b.description : null, b.isRecruiting ?? null, b.minLevel ?? null],
        );
        await this.event(c, m.clan.id, 'info', pilot.name, null);
      }
    });
    return this.me(owner, b.serverCode);
  }

  // ================================================================== başvuru ve davet
  async apply(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanApplySchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode, true);
      if (await this.membership(c, pilot.id, false)) throw err('ALREADY_IN_CLAN', 409, 'Zaten bir klandasın.');
      const clan = await this.clanByTag(c, pilot.serverId, b.tag, true);
      const s = await this.settings(c);
      // Bu klandan bekleyen davet varsa başvuru doğrudan katılım olur
      const inv = await c.query<{ id: string }>(`SELECT id::text FROM clan_invitations WHERE clan_id = $1 AND player_id = $2 AND status = 'pending' AND expires_at > $3`, [
        clan.id,
        pilot.id,
        this.clock(),
      ]);
      if (inv.rows[0]) {
        await this.addMember(c, out, clan, pilot, s);
        await c.query(`UPDATE clan_invitations SET status = 'accepted', decided_at = now() WHERE id = $1`, [inv.rows[0].id]);
        return;
      }
      if (!clan.is_recruiting) throw err('CLAN_NOT_RECRUITING', 409, 'Bu klan şu an üye almıyor.');
      if (pilot.level < clan.min_level) throw err('LEVEL_TOO_LOW', 400, `Bu klana başvurmak için en az ${clan.min_level}. seviye olmalısın.`);
      if ((await this.memberCount(c, clan.id)) >= s.max_members) throw err('CLAN_FULL', 409, `Klan dolu (en fazla ${s.max_members} üye).`);
      const pending = await c.query<{ n: string }>(`SELECT count(*) AS n FROM clan_applications WHERE player_id = $1 AND status = 'pending'`, [pilot.id]);
      if (Number(pending.rows[0]!.n) >= 5) throw err('APPLICATION_EXISTS', 409, 'Aynı anda en fazla 5 klana başvurabilirsin.');
      try {
        await c.query('INSERT INTO clan_applications (clan_id, player_id, message) VALUES ($1, $2, $3)', [clan.id, pilot.id, b.message || null]);
      } catch (e) {
        if (uniqueViolation(e)) throw err('APPLICATION_EXISTS', 409, 'Bu klana zaten bekleyen bir başvurun var.');
        throw e;
      }
      await this.notifyMany(c, out, await this.membersWith(c, clan.id, 'invite'), {
        kind: 'clan_application',
        title: 'Yeni klan başvurusu',
        body: `${pilot.name} (Sv ${pilot.level}) klana katılmak istiyor.`,
        link: '/klan',
      });
    });
    return this.me(owner, b.serverCode);
  }

  async withdrawApplication(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanIdSchema.parse(input);
    const pilot = await myPilot(this.db, owner.id, b.serverCode);
    const r = await this.db.query(`UPDATE clan_applications SET status = 'withdrawn', decided_at = now() WHERE id = $1 AND player_id = $2 AND status = 'pending'`, [b.id, pilot.id]);
    if (!r.rowCount) throw err('NOT_FOUND', 404, 'Bekleyen başvuru bulunamadı.');
    return this.me(owner, b.serverCode);
  }

  async decideApplication(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanDecideSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true, 'invite');
      const a = await c.query<{ player_id: string }>(`SELECT player_id FROM clan_applications WHERE id = $1 AND clan_id = $2 AND status = 'pending' FOR UPDATE`, [b.id, m.clan.id]);
      if (!a.rows[0]) throw err('NOT_FOUND', 404, 'Bekleyen başvuru bulunamadı.');
      const applicant = await pilotById(c, a.rows[0].player_id);
      if (b.accept) {
        await this.addMember(c, out, m.clan, applicant, await this.settings(c));
        await c.query(`UPDATE clan_applications SET status = 'accepted', decided_by = $2, decided_at = now() WHERE id = $1`, [b.id, pilot.id]);
        await this.notifier.create(c, out, applicant.id, {
          kind: 'clan_application_result',
          title: 'Klan başvurun kabul edildi',
          body: `[${m.clan.tag}] ${m.clan.name} klanına katıldın.`,
          link: '/klan',
        });
      } else {
        await c.query(`UPDATE clan_applications SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1`, [b.id, pilot.id]);
        await this.notifier.create(c, out, applicant.id, {
          kind: 'clan_application_result',
          title: 'Klan başvurun reddedildi',
          body: `[${m.clan.tag}] ${m.clan.name} klanı başvurunu kabul etmedi.`,
          link: '/klan',
        });
      }
    });
    return this.me(owner, b.serverCode);
  }

  async invite(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanPilotSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true, 'invite');
      const target = await pilotByName(c, pilot.serverId, b.pilotName);
      if (target.id === pilot.id) throw err('VALIDATION_ERROR', 400, 'Kendini davet edemezsin.');
      if (await this.membership(c, target.id, false)) throw err('ALREADY_IN_CLAN', 409, `${target.name} zaten bir klanda.`);
      if (await isBlocked(c, target.id, pilot.id)) throw err('NOT_ALLOWED', 403, `${target.name} adlı pilota davet gönderilemiyor.`);
      const s = await this.settings(c);
      const app = await c.query<{ id: string }>(`SELECT id::text FROM clan_applications WHERE clan_id = $1 AND player_id = $2 AND status = 'pending'`, [m.clan.id, target.id]);
      if (app.rows[0]) {
        // Pilot zaten başvurmuşsa davet, başvurunun kabulü demektir
        await this.addMember(c, out, m.clan, target, s);
        await c.query(`UPDATE clan_applications SET status = 'accepted', decided_by = $2, decided_at = now() WHERE id = $1`, [app.rows[0].id, pilot.id]);
        await this.notifier.create(c, out, target.id, { kind: 'clan_application_result', title: 'Klan başvurun kabul edildi', body: `[${m.clan.tag}] ${m.clan.name} klanına katıldın.`, link: '/klan' });
        return;
      }
      if ((await this.memberCount(c, m.clan.id)) >= s.max_members) throw err('CLAN_FULL', 409, `Klan dolu (en fazla ${s.max_members} üye).`);
      try {
        await c.query(`INSERT INTO clan_invitations (clan_id, player_id, invited_by, expires_at) VALUES ($1, $2, $3, $4)`, [
          m.clan.id,
          target.id,
          pilot.id,
          new Date(this.clock().getTime() + s.invitation_days * 86_400_000),
        ]);
      } catch (e) {
        if (uniqueViolation(e)) throw err('APPLICATION_EXISTS', 409, `${target.name} adlı pilota zaten bekleyen bir davet var.`);
        throw e;
      }
      await this.notifier.create(c, out, target.id, {
        kind: 'clan_invitation',
        title: 'Klan daveti',
        body: `${pilot.name} seni [${m.clan.tag}] ${m.clan.name} klanına davet etti.`,
        link: '/klan',
      });
    });
    return this.me(owner, b.serverCode);
  }

  async cancelInvitation(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanIdSchema.parse(input);
    await this.run(async (c) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true, 'invite');
      const r = await c.query(`UPDATE clan_invitations SET status = 'cancelled', decided_at = now() WHERE id = $1 AND clan_id = $2 AND status = 'pending'`, [b.id, m.clan.id]);
      if (!r.rowCount) throw err('INVITATION_NOT_FOUND', 404, 'Bekleyen davet bulunamadı.');
    });
    return this.me(owner, b.serverCode);
  }

  async respondInvitation(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanDecideSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode, true);
      const inv = await c.query<{ clan_id: string; invited_by: string | null }>(
        `SELECT clan_id, invited_by FROM clan_invitations WHERE id = $1 AND player_id = $2 AND status = 'pending' AND expires_at > $3 FOR UPDATE`,
        [b.id, pilot.id, this.clock()],
      );
      const row = inv.rows[0];
      if (!row) throw err('INVITATION_NOT_FOUND', 404, 'Davet bulunamadı veya süresi dolmuş.');
      if (!b.accept) {
        await c.query(`UPDATE clan_invitations SET status = 'declined', decided_at = now() WHERE id = $1`, [b.id]);
        return;
      }
      if (await this.membership(c, pilot.id, false)) throw err('ALREADY_IN_CLAN', 409, 'Zaten bir klandasın.');
      const clan = (await c.query<ClanRow>(`SELECT ${CLAN_COLS} FROM clans c WHERE c.id = $1 FOR UPDATE`, [row.clan_id])).rows[0]!;
      await this.addMember(c, out, clan, pilot, await this.settings(c));
      await c.query(`UPDATE clan_invitations SET status = 'accepted', decided_at = now() WHERE id = $1`, [b.id]);
      if (row.invited_by) {
        await this.notifier.create(c, out, row.invited_by, { kind: 'clan_joined', title: 'Davetin kabul edildi', body: `${pilot.name} klana katıldı.`, link: '/klan' });
      }
    });
    return this.me(owner, b.serverCode);
  }

  // ================================================================== üyelik
  async leave(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanServerSchema.parse(input);
    let disband = false;
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true);
      if (m.rank.is_leader) {
        if ((await this.memberCount(c, m.clan.id)) > 1) {
          throw err('NOT_ALLOWED', 409, 'Lider klandan ayrılamaz. Önce liderliği başka bir üyeye devret veya klanı dağıt.');
        }
        disband = true;
        return;
      }
      await c.query('DELETE FROM clan_members WHERE player_id = $1 AND clan_id = $2', [pilot.id, m.clan.id]);
      await this.event(c, m.clan.id, 'left', pilot.name, null);
      out.social.add(pilot.id);
    });
    if (disband) return this.disband(owner, b);
    return this.me(owner, b.serverCode);
  }

  async kick(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanPilotSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true, 'kick');
      const target = await pilotByName(c, pilot.serverId, b.pilotName);
      const tm = await this.membership(c, target.id, false);
      if (!tm || tm.clan.id !== m.clan.id) throw err('NOT_IN_CLAN', 404, `${target.name} klanında değil.`);
      if (target.id === pilot.id || !outranks(rankLike(m.rank), rankLike(tm.rank))) {
        throw err('CLAN_PERMISSION', 403, 'Yalnızca senden alt rütbedeki üyeleri çıkarabilirsin.');
      }
      await c.query('DELETE FROM clan_members WHERE player_id = $1 AND clan_id = $2', [target.id, m.clan.id]);
      await this.event(c, m.clan.id, 'kicked', pilot.name, target.name);
      await this.notifier.create(c, out, target.id, { kind: 'clan_kicked', title: 'Klandan çıkarıldın', body: `[${m.clan.tag}] ${m.clan.name} klanından çıkarıldın.`, link: '/klan' });
      out.social.add(target.id);
    });
    return this.me(owner, b.serverCode);
  }

  async setRank(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanMemberRankSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true, 'promote');
      const target = await pilotByName(c, pilot.serverId, b.pilotName);
      const tm = await this.membership(c, target.id, false);
      if (!tm || tm.clan.id !== m.clan.id) throw err('NOT_IN_CLAN', 404, `${target.name} klanında değil.`);
      const nr = await c.query<RankRow>('SELECT id, name, sort_order, is_leader, permissions FROM clan_ranks WHERE id = $1 AND clan_id = $2', [b.rankId, m.clan.id]);
      const newRank = nr.rows[0];
      if (!newRank) throw err('NOT_FOUND', 404, 'Rütbe bulunamadı.');
      if (newRank.is_leader) throw err('NOT_ALLOWED', 400, 'Liderlik rütbesi verilemez; liderliği devretmek için "Liderliği devret" kullan.');
      if (target.id === pilot.id || !outranks(rankLike(m.rank), rankLike(tm.rank)) || !outranks(rankLike(m.rank), rankLike(newRank))) {
        throw err('CLAN_PERMISSION', 403, 'Yalnızca senden alt rütbedeki üyelere, senden alt bir rütbe verebilirsin.');
      }
      if (tm.rank.id === newRank.id) return;
      await c.query('UPDATE clan_members SET rank_id = $3 WHERE player_id = $1 AND clan_id = $2', [target.id, m.clan.id, newRank.id]);
      await this.event(c, m.clan.id, 'rank', pilot.name, target.name, { rank: newRank.name });
      await this.notifier.create(c, out, target.id, { kind: 'clan_rank', title: 'Klan rütben değişti', body: `Yeni rütben: ${newRank.name}.`, link: '/klan' });
    });
    return this.me(owner, b.serverCode);
  }

  async updateRank(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanRankUpdateSchema.parse(input);
    await this.run(async (c) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true);
      this.requireLeader(m);
      const r = await c.query<RankRow>('SELECT id, name, sort_order, is_leader, permissions FROM clan_ranks WHERE id = $1 AND clan_id = $2', [b.rankId, m.clan.id]);
      const rank = r.rows[0];
      if (!rank) throw err('NOT_FOUND', 404, 'Rütbe bulunamadı.');
      // Lider rütbesinin yetkileri sabittir (tümü); yalnızca adı değişir
      const perms = rank.is_leader ? [] : [...new Set(b.permissions)];
      await c.query('UPDATE clan_ranks SET name = $2, permissions = $3 WHERE id = $1', [rank.id, b.name, perms]);
      await this.event(c, m.clan.id, 'rank_edit', pilot.name, null, { rank: b.name });
    });
    return this.me(owner, b.serverCode);
  }

  async transfer(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanPilotSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true);
      this.requireLeader(m);
      const target = await pilotByName(c, pilot.serverId, b.pilotName);
      const tm = await this.membership(c, target.id, false);
      if (!tm || tm.clan.id !== m.clan.id || target.id === pilot.id) throw err('NOT_IN_CLAN', 404, `${target.name} klanında değil.`);
      const second = await c.query<{ id: number }>('SELECT id FROM clan_ranks WHERE clan_id = $1 AND NOT is_leader ORDER BY sort_order LIMIT 1', [m.clan.id]);
      await c.query('UPDATE clan_members SET rank_id = $3 WHERE player_id = $1 AND clan_id = $2', [target.id, m.clan.id, m.rank.id]);
      await c.query('UPDATE clan_members SET rank_id = $3 WHERE player_id = $1 AND clan_id = $2', [pilot.id, m.clan.id, second.rows[0]!.id]);
      await c.query('UPDATE clans SET leader_id = $2 WHERE id = $1', [m.clan.id, target.id]);
      await this.event(c, m.clan.id, 'leader', pilot.name, target.name);
      await this.notifier.create(c, out, target.id, { kind: 'clan_rank', title: 'Klan liderliği sana devredildi', body: `Artık [${m.clan.tag}] ${m.clan.name} klanının liderisin.`, link: '/klan' });
    });
    return this.me(owner, b.serverCode);
  }

  /** Klanı dağıtır: hazinedeki Kredi lidere iade edilir (defterli), üyeler bildirim alır, diplomasi ilişkileri biter. */
  async disband(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanServerSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true);
      this.requireLeader(m);
      const members = await this.membersWith(c, m.clan.id);
      const partners = await c.query<{ other: string }>(
        `SELECT CASE WHEN clan_a = $1 THEN clan_b ELSE clan_a END AS other FROM clan_diplomacy WHERE clan_a = $1 OR clan_b = $1`,
        [m.clan.id],
      );
      const wallet = await c.query<{ balance: string }>(`SELECT balance FROM clan_wallets WHERE clan_id = $1 AND currency_code = 'KREDI'`, [m.clan.id]);
      const balance = Number(wallet.rows[0]?.balance ?? 0);
      if (balance > 0) {
        const key = `clan-disband:${m.clan.id}`;
        await applyCurrencyChange(c, { playerId: pilot.id, currency: 'KREDI', delta: balance, reason: 'clan_disband', refType: 'clan', refId: m.clan.tag, idempotencyKey: key });
        await applyClanCurrencyChange(c, { clanId: m.clan.id, currency: 'KREDI', delta: -balance, reason: 'clan_disband', playerId: pilot.id, actorPlayerId: pilot.id, idempotencyKey: key });
      }
      await this.notifyMany(
        c,
        out,
        members,
        { kind: 'clan_disbanded', title: 'Klan dağıtıldı', body: `[${m.clan.tag}] ${m.clan.name} klanı lider tarafından dağıtıldı.`, link: '/klan' },
        pilot.id,
      );
      await c.query('DELETE FROM clans WHERE id = $1', [m.clan.id]);
      for (const id of members) out.social.add(id);
      out.relations.add(m.clan.id);
      for (const p of partners.rows) out.relations.add(p.other);
      this.log.info({ clan: m.clan.tag, by: pilot.name, members: members.length, refund: balance }, 'klan dağıtıldı');
    });
    return this.me(owner, b.serverCode);
  }

  // ================================================================== hazine
  async deposit(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanDepositSchema.parse(input);
    await this.run(async (c) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const mem = await c.query<{ clan_id: string }>('SELECT clan_id FROM clan_members WHERE player_id = $1 FOR SHARE', [pilot.id]);
      const clanId = mem.rows[0]?.clan_id;
      if (!clanId) throw err('NOT_IN_CLAN', 400, 'Bir klanda değilsin.');
      const key = `clan-dep:${pilot.id}:${b.requestId}`;
      const w = await applyCurrencyChange(c, { playerId: pilot.id, currency: 'KREDI', delta: -b.amount, reason: 'clan_deposit', refType: 'clan', refId: clanId, idempotencyKey: key });
      if (!w.applied) return;
      await applyClanCurrencyChange(c, { clanId, currency: 'KREDI', delta: b.amount, reason: 'clan_deposit', playerId: pilot.id, actorPlayerId: pilot.id, idempotencyKey: key });
      await this.event(c, clanId, 'deposit', pilot.name, null, { amount: b.amount });
    });
    return this.me(owner, b.serverCode);
  }

  async withdraw(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanWithdrawSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const m = await this.requireMember(c, pilot, true, 'treasury');
      const target = await pilotByName(c, pilot.serverId, b.pilotName);
      const tm = await c.query('SELECT 1 FROM clan_members WHERE player_id = $1 AND clan_id = $2 FOR SHARE', [target.id, m.clan.id]);
      if (!tm.rowCount) throw err('NOT_IN_CLAN', 404, `${target.name} klanında değil; hazineden yalnızca klan üyelerine ödeme yapılabilir.`);
      const key = `clan-pay:${m.clan.id}:${b.requestId}`;
      // Kilit sırası: önce pilot cüzdanı, sonra klan cüzdanı (hazine yetersizse tüm işlem geri alınır)
      const w = await applyCurrencyChange(c, { playerId: target.id, currency: 'KREDI', delta: b.amount, reason: 'clan_payout', refType: 'clan', refId: m.clan.id, idempotencyKey: key });
      if (!w.applied) return;
      await applyClanCurrencyChange(c, { clanId: m.clan.id, currency: 'KREDI', delta: -b.amount, reason: 'clan_payout', playerId: target.id, actorPlayerId: pilot.id, idempotencyKey: key });
      await this.event(c, m.clan.id, 'payout', pilot.name, target.name, { amount: b.amount });
      if (target.id !== pilot.id) {
        await this.notifier.create(c, out, target.id, { kind: 'clan_payout', title: 'Klan hazinesinden ödeme', body: `+${fmt(b.amount)} Kredi (${pilot.name})`, link: '/klan' });
      }
    });
    return this.me(owner, b.serverCode);
  }

  // ================================================================== diplomasi
  /** İki klan satırı kimlik sırasıyla kilitlenir; işlemi yapan pilotun yetkisi kilitten SONRA yeniden okunur. */
  private async lockPair(c: Queryable, pilot: Pilot, tag: string): Promise<{ m: Membership; other: ClanRow; a: string; b: string }> {
    const pre = await this.requireMember(c, pilot, false, 'diplomacy');
    const other = await this.clanByTag(c, pilot.serverId, tag);
    if (other.id === pre.clan.id) throw err('VALIDATION_ERROR', 400, 'Kendi klanınla diplomasi kuramazsın.');
    const [a, b] = pre.clan.id < other.id ? [pre.clan.id, other.id] : [other.id, pre.clan.id];
    await c.query('SELECT id FROM clans WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[a, b]]);
    const m = await this.requireMember(c, pilot, false, 'diplomacy');
    if (m.clan.id !== pre.clan.id) throw err('NOT_IN_CLAN', 409, 'Klan üyeliğin değişti; sayfayı yenile.');
    return { m, other, a, b };
  }

  private async pairRow(c: Queryable, a: string, b: string) {
    const r = await c.query<{ relation: DiplomacyRelation; status: 'proposed' | 'active'; proposed_by: string; peace_proposed_by: string | null }>(
      'SELECT relation, status, proposed_by, peace_proposed_by FROM clan_diplomacy WHERE clan_a = $1 AND clan_b = $2',
      [a, b],
    );
    return r.rows[0] ?? null;
  }

  async propose(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanProposeSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const { m, other, a, b: bb } = await this.lockPair(c, pilot, b.tag);
      const row = await this.pairRow(c, a, bb);
      if (row && row.status === 'proposed' && row.proposed_by === other.id && row.relation === b.relation) {
        // Karşı taraf aynı öneriyi yapmışsa bu, kabul demektir
        await this.activate(c, out, m, other, a, bb, row.relation, pilot);
        return;
      }
      if (row) {
        throw err('DIPLOMACY_EXISTS', 409, `[${other.tag}] klanıyla zaten bir ${row.status === 'proposed' ? 'öneri' : 'ilişki'} var (${DIPLOMACY_LABELS[row.relation]}).`);
      }
      const s = await this.settings(c);
      const n = await c.query<{ n: string }>('SELECT count(*) AS n FROM clan_diplomacy WHERE clan_a = $1 OR clan_b = $1', [m.clan.id]);
      if (Number(n.rows[0]!.n) >= s.max_relations) throw err('NOT_ALLOWED', 409, `Bir klanın en fazla ${s.max_relations} diplomatik ilişkisi olabilir.`);
      await c.query(`INSERT INTO clan_diplomacy (clan_a, clan_b, relation, status, proposed_by) VALUES ($1, $2, $3, 'proposed', $4)`, [a, bb, b.relation, m.clan.id]);
      await this.event(c, m.clan.id, 'dip_proposed', pilot.name, null, { tag: other.tag, relation: b.relation });
      await this.event(c, other.id, 'dip_received', null, null, { tag: m.clan.tag, relation: b.relation });
      await this.notifyMany(c, out, await this.membersWith(c, other.id, 'diplomacy'), {
        kind: 'clan_diplomacy',
        title: 'Diplomasi önerisi',
        body: `[${m.clan.tag}] ${m.clan.name} klanı ${rel(b.relation)} öneriyor.`,
        link: '/klan',
      });
    });
    return this.me(owner, b.serverCode);
  }

  private async activate(c: Queryable, out: Outbox, m: Membership, other: ClanRow, a: string, b: string, relation: DiplomacyRelation, pilot: Pilot) {
    await c.query(`UPDATE clan_diplomacy SET status = 'active', activated_at = now() WHERE clan_a = $1 AND clan_b = $2`, [a, b]);
    await this.event(c, m.clan.id, 'dip_active', pilot.name, null, { tag: other.tag, relation });
    await this.event(c, other.id, 'dip_active', null, null, { tag: m.clan.tag, relation });
    await this.notifyMany(c, out, await this.membersWith(c, other.id, 'diplomacy'), {
      kind: 'clan_diplomacy',
      title: `${DIPLOMACY_LABELS[relation]} kabul edildi`,
      body: `[${m.clan.tag}] ${m.clan.name} klanıyla ${rel(relation)} başladı.`,
      link: '/klan',
    });
    out.relations.add(a).add(b);
  }

  async respond(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanRespondSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const { m, other, a, b: bb } = await this.lockPair(c, pilot, b.tag);
      const row = await this.pairRow(c, a, bb);
      if (!row || row.status !== 'proposed' || row.proposed_by !== other.id) throw err('DIPLOMACY_NOT_FOUND', 404, `[${other.tag}] klanından bekleyen bir öneri yok.`);
      if (b.accept) {
        await this.activate(c, out, m, other, a, bb, row.relation, pilot);
        return;
      }
      await c.query('DELETE FROM clan_diplomacy WHERE clan_a = $1 AND clan_b = $2', [a, bb]);
      await this.event(c, m.clan.id, 'dip_rejected', pilot.name, null, { tag: other.tag, relation: row.relation });
      await this.event(c, other.id, 'dip_rejected', null, null, { tag: m.clan.tag, relation: row.relation });
      await this.notifyMany(c, out, await this.membersWith(c, other.id, 'diplomacy'), {
        kind: 'clan_diplomacy',
        title: 'Diplomasi önerisi reddedildi',
        body: `[${m.clan.tag}] ${m.clan.name} klanı ${rel(row.relation)} önerinizi reddetti.`,
        link: '/klan',
      });
    });
    return this.me(owner, b.serverCode);
  }

  async declareWar(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanTargetSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const { m, other, a, b: bb } = await this.lockPair(c, pilot, b.tag);
      const row = await this.pairRow(c, a, bb);
      if (row?.relation === 'war') throw err('DIPLOMACY_EXISTS', 409, `[${other.tag}] klanıyla zaten savaştasınız.`);
      if (row?.status === 'active') throw err('DIPLOMACY_EXISTS', 409, `[${other.tag}] klanıyla ${rel(row.relation)} var. Savaş ilan etmeden önce anlaşmayı bitirmelisin.`);
      if (row) await c.query('DELETE FROM clan_diplomacy WHERE clan_a = $1 AND clan_b = $2', [a, bb]);
      else {
        const s = await this.settings(c);
        const n = await c.query<{ n: string }>('SELECT count(*) AS n FROM clan_diplomacy WHERE clan_a = $1 OR clan_b = $1', [m.clan.id]);
        if (Number(n.rows[0]!.n) >= s.max_relations) throw err('NOT_ALLOWED', 409, `Bir klanın en fazla ${s.max_relations} diplomatik ilişkisi olabilir.`);
      }
      await c.query(`INSERT INTO clan_diplomacy (clan_a, clan_b, relation, status, proposed_by, activated_at) VALUES ($1, $2, 'war', 'active', $3, now())`, [a, bb, m.clan.id]);
      await this.event(c, m.clan.id, 'war_declared', pilot.name, null, { tag: other.tag });
      await this.event(c, other.id, 'war_received', null, null, { tag: m.clan.tag });
      await this.notifyMany(c, out, await this.membersWith(c, other.id), {
        kind: 'clan_war',
        title: 'Klanına savaş ilan edildi',
        body: `[${m.clan.tag}] ${m.clan.name} klanı savaş ilan etti. PvP haritalarında bu klanın pilotlarıyla (aynı şirketten olsalar da) savaşabilirsiniz.`,
        link: '/klan',
      });
      out.relations.add(a).add(bb);
    });
    return this.me(owner, b.serverCode);
  }

  /** Öneriyi geri çeker; ittifak/saldırmazlığı bitirir; savaşta barış önerir (karşı taraf da önerdiyse savaş biter). */
  async end(owner: { id: string }, input: unknown): Promise<ClanResponse> {
    const b = clanTargetSchema.parse(input);
    await this.run(async (c, out) => {
      const pilot = await myPilot(c, owner.id, b.serverCode);
      const { m, other, a, b: bb } = await this.lockPair(c, pilot, b.tag);
      const row = await this.pairRow(c, a, bb);
      if (!row) throw err('DIPLOMACY_NOT_FOUND', 404, `[${other.tag}] klanıyla bir ilişki yok.`);
      const del = () => c.query('DELETE FROM clan_diplomacy WHERE clan_a = $1 AND clan_b = $2', [a, bb]);
      const tellOther = (title: string, body: string, all = false) =>
        this.membersWith(c, other.id, all ? undefined : 'diplomacy').then((ids) => this.notifyMany(c, out, ids, { kind: 'clan_diplomacy', title, body, link: '/klan' }));
      if (row.relation === 'war') {
        if (row.peace_proposed_by === other.id) {
          await del();
          await this.event(c, m.clan.id, 'dip_ended', pilot.name, null, { tag: other.tag, relation: 'war' });
          await this.event(c, other.id, 'dip_ended', null, null, { tag: m.clan.tag, relation: 'war' });
          await tellOther('Savaş sona erdi', `[${m.clan.tag}] ${m.clan.name} klanı barışı kabul etti.`, true);
          out.relations.add(a).add(bb);
          return;
        }
        if (row.peace_proposed_by === m.clan.id) throw err('DIPLOMACY_EXISTS', 409, 'Barış önerin zaten gönderildi; karşı klanın kabulünü bekle.');
        await c.query('UPDATE clan_diplomacy SET peace_proposed_by = $3 WHERE clan_a = $1 AND clan_b = $2', [a, bb, m.clan.id]);
        await this.event(c, m.clan.id, 'peace_proposed', pilot.name, null, { tag: other.tag });
        await this.event(c, other.id, 'peace_received', null, null, { tag: m.clan.tag });
        await tellOther('Barış önerisi', `[${m.clan.tag}] ${m.clan.name} klanı barış öneriyor.`);
        return;
      }
      await del();
      if (row.status === 'proposed') {
        // Kendi önerimizi geri çekiyoruz ya da karşı tarafın önerisini reddediyoruz
        await this.event(c, m.clan.id, 'dip_rejected', pilot.name, null, { tag: other.tag, relation: row.relation });
        return;
      }
      await this.event(c, m.clan.id, 'dip_ended', pilot.name, null, { tag: other.tag, relation: row.relation });
      await this.event(c, other.id, 'dip_ended', null, null, { tag: m.clan.tag, relation: row.relation });
      await tellOther(`${DIPLOMACY_LABELS[row.relation]} sona erdi`, `[${m.clan.tag}] ${m.clan.name} klanı ${rel(row.relation)} anlaşmasını bitirdi.`);
      out.relations.add(a).add(bb);
    });
    return this.me(owner, b.serverCode);
  }

  /** Profil için: pilotun klanı ve rütbesi. */
  static async profileClan(db: Queryable, playerId: string): Promise<{ tag: string; name: string; rank: string } | null> {
    const r = await db.query<{ tag: string; name: string; rank: string }>(
      `SELECT c.tag::text AS tag, c.name::text AS name, r.name AS rank FROM clan_members cm JOIN clans c ON c.id = cm.clan_id JOIN clan_ranks r ON r.id = cm.rank_id
       WHERE cm.player_id = $1`,
      [playerId],
    );
    return r.rows[0] ?? null;
  }
}
