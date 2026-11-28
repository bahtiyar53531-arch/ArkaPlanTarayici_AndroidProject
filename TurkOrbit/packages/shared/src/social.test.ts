import { describe, expect, it } from 'vitest';
import { canAttack } from './combat.js';
import {
  cleanChatText,
  clanCreateSchema,
  dmChannel,
  filterChat,
  hasClanPermission,
  normalizeClanTag,
  outranks,
  partyLocation,
  socialSettingsSchema,
} from './social.js';

const BANNED = ['amk', 'aq', 'siktir', 'orospu', 'şerefsiz'];

describe('sohbet filtresi', () => {
  it('yasaklı kelimeler büyük/küçük harf, Türkçe harf, rakam ve harf tekrarına rağmen yakalanır; harf sayısı kadar yıldız', () => {
    expect(filterChat('AMK ne oldu', BANNED)).toEqual({ text: '*** ne oldu', filtered: true });
    expect(filterChat('s1kt1r git', BANNED).text).toBe('****** git');
    expect(filterChat('SİİİKTİR', BANNED).text).toBe('********');
    expect(filterChat('serefsiz!', BANNED).text).toBe('********!');
    expect(filterChat('orospuçocuğu', BANNED).text).toBe('************'); // 5+ harfli kök kelime başında
  });
  it('masum kelimeler maskelenmez (kısa kökler yalnızca tam kelime)', () => {
    expect(filterChat('Aqua rengi güzel, amkara değil', BANNED)).toEqual({ text: 'Aqua rengi güzel, amkara değil', filtered: false });
    expect(filterChat('sikke koleksiyonu', BANNED).filtered).toBe(false);
    expect(filterChat('her şey yolunda', []).filtered).toBe(false);
  });
  it('görünmez karakterler temizlenir, boşluklar sadeleşir', () => {
    expect(cleanChatText('  merhaba​   dünya‮ \n')).toBe('merhaba dünya');
    expect(cleanChatText('\u0007‏')).toBe('');
  });
  it('özel mesaj kanalı iki pilot için sıradan bağımsızdır', () => {
    expect(dmChannel('b', 'a')).toBe(dmChannel('a', 'b'));
  });
});

describe('klan kuralları', () => {
  const leader = { sortOrder: 0, isLeader: true, permissions: [] };
  const commander = { sortOrder: 1, isLeader: false, permissions: ['invite', 'kick'] };
  const member = { sortOrder: 3, isLeader: false, permissions: [] };
  it('lider her yetkiye sahiptir; diğer rütbeler yalnızca listedekilere', () => {
    expect(hasClanPermission(leader, 'diplomacy')).toBe(true);
    expect(hasClanPermission(commander, 'kick')).toBe(true);
    expect(hasClanPermission(commander, 'treasury')).toBe(false);
    expect(hasClanPermission(member, 'invite')).toBe(false);
  });
  it('yalnızca alt rütbe yönetilir; lider asla yönetilemez', () => {
    expect(outranks(commander, member)).toBe(true);
    expect(outranks(commander, commander)).toBe(false);
    expect(outranks(member, commander)).toBe(false);
    expect(outranks(commander, leader)).toBe(false);
    expect(outranks(leader, commander)).toBe(true);
  });
  it('etiket Türkçe büyük harfe çevrilir; ad boşlukları sadeleşir; geçersiz biçim reddedilir', () => {
    expect(normalizeClanTag(' çğı ')).toBe('ÇĞI');
    expect(normalizeClanTag('iz')).toBe('İZ');
    const base = { serverCode: 'TR1', requestId: '5b7c3a1e-0d8e-4f3e-9c1a-2b3c4d5e6f70' };
    expect(clanCreateSchema.parse({ ...base, tag: 'akn', name: '  Akıncılar   Birliği ' })).toMatchObject({ tag: 'AKN', name: 'Akıncılar Birliği' });
    expect(clanCreateSchema.safeParse({ ...base, tag: 'A', name: 'Geçerli Ad' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...base, tag: 'AB-C', name: 'Geçerli Ad' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...base, tag: 'ABC', name: 'Ad<script>' }).success).toBe(false);
    expect(clanCreateSchema.safeParse({ ...base, tag: 'ABC', name: 'İyi Ad', leaderId: 'x' }).success).toBe(false);
  });
});

describe('grup konum izni', () => {
  const m = { mapCode: 'G-2', mapName: 'Gökbörü Kuşağı', x: 1234.6, y: 99.2, entityId: 7 };
  it('üyenin izni: harita+konum / yalnızca harita / gizli; varlık kimliği yalnızca aynı haritada', () => {
    expect(partyLocation('group', m, 'G-1')).toEqual({ map: { code: 'G-2', name: 'Gökbörü Kuşağı' }, x: 1235, y: 99, entityId: null });
    expect(partyLocation('group', m, 'G-2').entityId).toBe(7);
    expect(partyLocation('map', m, 'G-1')).toEqual({ map: { code: 'G-2', name: 'Gökbörü Kuşağı' }, x: null, y: null, entityId: null });
    expect(partyLocation('none', m, 'G-2')).toEqual({ map: null, x: null, y: null, entityId: null });
  });
  it('gizlilik ayarı şeması yalnızca bilinen değerleri kabul eder', () => {
    const ok = { serverCode: 'TR1', locationSharing: 'map', friendsSeeOnline: true, dmPolicy: 'friends', groupInvites: 'friends_clan', friendRequests: false };
    expect(socialSettingsSchema.safeParse(ok).success).toBe(true);
    expect(socialSettingsSchema.safeParse({ ...ok, locationSharing: 'everyone' }).success).toBe(false);
  });
});

describe('saldırı izni ve diplomasi', () => {
  const base = { targetKind: 'pilot' as const, mapPvp: true, attackerCompany: 'KZL', targetCompany: 'GKB', attackerInSafeZone: false, targetInSafeZone: false };
  it('grup, klan, ittifak ve saldırmazlık saldırıyı engeller', () => {
    expect(canAttack({ ...base, relation: 'party' })).toEqual({ ok: false, reason: 'Grup arkadaşına saldıramazsın.' });
    expect(canAttack({ ...base, relation: 'clan' })).toEqual({ ok: false, reason: 'Kendi klanından pilota saldıramazsın.' });
    expect(canAttack({ ...base, relation: 'alliance' })).toEqual({ ok: false, reason: 'Müttefik klandan pilota saldıramazsın.' });
    expect(canAttack({ ...base, relation: 'non_aggression' }).ok).toBe(false);
    expect(canAttack({ ...base, relation: null })).toEqual({ ok: true });
  });
  it('savaş aynı şirketten pilota saldırıya izin verir; PvP kapalı harita ve güvenli bölge yine engeller', () => {
    const same = { ...base, targetCompany: 'KZL' };
    expect(canAttack({ ...same, relation: null }).ok).toBe(false);
    expect(canAttack({ ...same, relation: 'war' })).toEqual({ ok: true });
    expect(canAttack({ ...same, relation: 'war', mapPvp: false }).ok).toBe(false);
    expect(canAttack({ ...same, relation: 'war', targetInSafeZone: true }).ok).toBe(false);
  });
});
