/**
 * Grup (party) deposu (Aşama 12). Gruplar kısa ömürlüdür; canlı durum Redis'te tutulur (02-Teknik-Mimari §4.5).
 * Birden çok oyun sunucusu süreci aynı grubu paylaşabilir. Üyelik değişiklikleri tek bir Lua betiğiyle ATOMİKTİR:
 * eşzamanlı katılımda üye sınırı aşılamaz, bir pilot aynı anda iki grupta olamaz.
 *
 * Anahtarlar (hepsi TTL'li; oyundaki üyelerin süreci her saniye yeniler, herkes çıkınca grup kendiliğinden silinir):
 *   party:of:<pilot>       → grup kimliği
 *   party:<id>:m           → üyeler (ZSET, puan = katılım zamanı; lider ayrılırsa en eski üye lider olur)
 *   party:<id>:l           → lider
 *   party:<id>:st          → üye durumu (HASH pilot → JSON: ad, seviye, harita, konum, can, izin)
 *   party:inv:<hedef>:<davet eden> → bekleyen davet (JSON, süreli)
 */
import type { Redis } from 'ioredis';

export const PARTY_TTL_SECONDS = 180;

const SCRIPT = `
local action = ARGV[1]
local ttl = tonumber(ARGV[2])
local function mk(pid) return 'party:' .. pid .. ':m' end
local function lk(pid) return 'party:' .. pid .. ':l' end
local function sk(pid) return 'party:' .. pid .. ':st' end
local function of(p) return 'party:of:' .. p end

local function remove(pid, p)
  redis.call('ZREM', mk(pid), p)
  redis.call('DEL', of(p))
  redis.call('HDEL', sk(pid), p)
  local n = redis.call('ZCARD', mk(pid))
  if n <= 1 then
    local rest = redis.call('ZRANGE', mk(pid), 0, -1)
    for _, m in ipairs(rest) do redis.call('DEL', of(m)) end
    redis.call('DEL', mk(pid), lk(pid), sk(pid))
    local out = {'DISBANDED', pid}
    for _, m in ipairs(rest) do table.insert(out, m) end
    return out
  end
  local leader = redis.call('GET', lk(pid))
  if (not leader) or leader == p then
    leader = redis.call('ZRANGE', mk(pid), 0, 0)[1]
    redis.call('SET', lk(pid), leader, 'EX', ttl)
  end
  return {'LEFT', pid, leader}
end

if action == 'accept' then
  -- ARGV: 3 davet eden, 4 hedef, 5 yeni grup kimliği, 6 azami üye, 7 zaman (ms)
  local inviter, target = ARGV[3], ARGV[4]
  local inv = 'party:inv:' .. target .. ':' .. inviter
  if redis.call('EXISTS', inv) == 0 then return {'NO_INVITE'} end
  if redis.call('EXISTS', of(target)) == 1 then return {'TARGET_IN_PARTY'} end
  local pid = redis.call('GET', of(inviter))
  if not pid then
    pid = ARGV[5]
    redis.call('SET', of(inviter), pid, 'EX', ttl)
    redis.call('ZADD', mk(pid), tonumber(ARGV[7]), inviter)
    redis.call('SET', lk(pid), inviter, 'EX', ttl)
  elseif redis.call('GET', lk(pid)) ~= inviter then
    redis.call('DEL', inv)
    return {'NOT_LEADER'}
  end
  if redis.call('ZCARD', mk(pid)) >= tonumber(ARGV[6]) then return {'FULL'} end
  redis.call('ZADD', mk(pid), tonumber(ARGV[7]) + 1, target)
  redis.call('SET', of(target), pid, 'EX', ttl)
  redis.call('EXPIRE', mk(pid), ttl)
  redis.call('EXPIRE', lk(pid), ttl)
  redis.call('DEL', inv)
  return {'OK', pid}
elseif action == 'leave' then
  local p = ARGV[3]
  local pid = redis.call('GET', of(p))
  if not pid then return {'NONE'} end
  return remove(pid, p)
elseif action == 'kick' or action == 'promote' then
  local leader, target = ARGV[3], ARGV[4]
  local pid = redis.call('GET', of(leader))
  if not pid then return {'NONE'} end
  if redis.call('GET', lk(pid)) ~= leader then return {'NOT_LEADER'} end
  if leader == target or redis.call('GET', of(target)) ~= pid then return {'NOT_MEMBER'} end
  if action == 'promote' then
    redis.call('SET', lk(pid), target, 'EX', ttl)
    return {'PROMOTED', pid}
  end
  return remove(pid, target)
end
return {'BAD_ACTION'}
`;

export interface PartyMemberStatus {
  name: string;
  level: number;
  company: string;
  map: string;
  mapName: string;
  x: number;
  y: number;
  hp: number;
  sh: number;
  sharing: 'group' | 'map' | 'none';
  entityId: number;
  online: boolean;
  /** yazma zamanı (ms): eski durumlar çevrimdışı sayılır */
  at: number;
}

export interface PartySnapshot {
  id: string;
  leader: string | null;
  /** katılım sırasıyla üye kimlikleri */
  members: string[];
  status: Map<string, PartyMemberStatus>;
}

export type PartyResult = string[];

export class PartyStore {
  constructor(private readonly redis: Redis) {}

  private run(args: Array<string | number>): Promise<PartyResult> {
    return this.redis.eval(SCRIPT, 0, ...args.map(String)) as Promise<PartyResult>;
  }

  /** Davet: hedef için süreli kayıt (aynı davet edenin önceki daveti yenilenir). */
  async invite(targetId: string, inviterId: string, info: { name: string; level: number; company: string }, seconds: number) {
    await this.redis.set(`party:inv:${targetId}:${inviterId}`, JSON.stringify(info), 'EX', seconds);
  }

  async hasInvite(targetId: string, inviterId: string): Promise<boolean> {
    return (await this.redis.exists(`party:inv:${targetId}:${inviterId}`)) === 1;
  }

  async declineInvite(targetId: string, inviterId: string): Promise<boolean> {
    return (await this.redis.del(`party:inv:${targetId}:${inviterId}`)) === 1;
  }

  accept(inviterId: string, targetId: string, newPartyId: string, max: number, nowMs: number) {
    return this.run(['accept', PARTY_TTL_SECONDS, inviterId, targetId, newPartyId, max, nowMs]);
  }

  leave(playerId: string) {
    return this.run(['leave', PARTY_TTL_SECONDS, playerId]);
  }

  kick(leaderId: string, targetId: string) {
    return this.run(['kick', PARTY_TTL_SECONDS, leaderId, targetId]);
  }

  promote(leaderId: string, targetId: string) {
    return this.run(['promote', PARTY_TTL_SECONDS, leaderId, targetId]);
  }

  async partyOf(playerId: string): Promise<string | null> {
    return this.redis.get(`party:of:${playerId}`);
  }

  async partiesOf(playerIds: string[]): Promise<Array<string | null>> {
    if (playerIds.length === 0) return [];
    return this.redis.mget(...playerIds.map((id) => `party:of:${id}`));
  }

  /** Üye durumlarını yazar ve grubun tüm anahtarlarının süresini yeniler (her saniye, oyundaki üyelerin sürecinden). */
  async writeStatus(entries: Array<{ partyId: string; playerId: string; status: PartyMemberStatus }>) {
    if (entries.length === 0) return;
    const pipe = this.redis.pipeline();
    const parties = new Set<string>();
    for (const e of entries) {
      pipe.hset(`party:${e.partyId}:st`, e.playerId, JSON.stringify(e.status));
      pipe.expire(`party:of:${e.playerId}`, PARTY_TTL_SECONDS);
      parties.add(e.partyId);
    }
    for (const id of parties) {
      pipe.expire(`party:${id}:m`, PARTY_TTL_SECONDS);
      pipe.expire(`party:${id}:l`, PARTY_TTL_SECONDS);
      pipe.expire(`party:${id}:st`, PARTY_TTL_SECONDS);
    }
    await pipe.exec();
  }

  async read(partyIds: string[]): Promise<Map<string, PartySnapshot>> {
    const out = new Map<string, PartySnapshot>();
    if (partyIds.length === 0) return out;
    const pipe = this.redis.pipeline();
    for (const id of partyIds) {
      pipe.zrange(`party:${id}:m`, 0, -1);
      pipe.get(`party:${id}:l`);
      pipe.hgetall(`party:${id}:st`);
    }
    const res = (await pipe.exec()) ?? [];
    partyIds.forEach((id, i) => {
      const members = (res[i * 3]?.[1] as string[] | null) ?? [];
      if (members.length === 0) return;
      const leader = (res[i * 3 + 1]?.[1] as string | null) ?? null;
      const raw = (res[i * 3 + 2]?.[1] as Record<string, string> | null) ?? {};
      const status = new Map<string, PartyMemberStatus>();
      for (const [pid, json] of Object.entries(raw)) {
        try {
          status.set(pid, JSON.parse(json) as PartyMemberStatus);
        } catch {
          /* bozuk durum yok sayılır */
        }
      }
      out.set(id, { id, leader, members, status });
    });
    return out;
  }
}
