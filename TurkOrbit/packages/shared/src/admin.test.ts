import { describe, expect, it } from 'vitest';
import {
  CONTENT_TYPE_DEFS,
  SETTING_DEFS,
  adminGrantSchema,
  adminQuestCreateSchema,
  adminSanctionSchema,
  diffFields,
  getPath,
  setPath,
  validateField,
} from './admin.js';
import { PERMISSIONS, ROLE_PERMISSIONS } from './roles.js';

describe('yönetim: alan doğrulama ve fark', () => {
  it('sayı/metin/tarih/liste alanları sınırlara göre doğrulanır ve normalleşir', () => {
    const hp = CONTENT_TYPE_DEFS.npc_type.fields.find((f) => f.key === 'hitpoints')!;
    expect(validateField(hp, 1500)).toEqual({ ok: true, value: 1500 });
    expect(validateField(hp, '1500')).toEqual({ ok: true, value: 1500 });
    expect(validateField(hp, 0)).toMatchObject({ ok: false });
    expect(validateField(hp, 12.5)).toEqual({ ok: false, message: 'Can tam sayı olmalı.' });
    expect(validateField(hp, null)).toEqual({ ok: false, message: 'Can boş olamaz.' });
    const name = CONTENT_TYPE_DEFS.npc_type.fields.find((f) => f.key === 'name')!;
    expect(validateField(name, '  Çakal   Reisi ')).toEqual({ ok: true, value: 'Çakal Reisi' });
    const ends = CONTENT_TYPE_DEFS.quest.fields.find((f) => f.key === 'ends_at')!;
    expect(validateField(ends, null)).toEqual({ ok: true, value: null });
    expect(validateField(ends, 'yarın')).toMatchObject({ ok: false });
    const words = SETTING_DEFS.find((d) => d.key === 'chat')!.fields.find((f) => f.kind === 'list')!;
    expect(validateField(words, 'Küfür\n  küfür \n\nARGO')).toEqual({ ok: true, value: ['küfür', 'argo'] });
  });

  it('iç içe yol: yalnızca hedef anahtar değişir; fark yalnızca tanımlı alanları gösterir', () => {
    const v = { value: { cost: { amount: 2000, currency: 'AKCE' }, cooldown_days: 30 } };
    const n = setPath(v, 'value.cost.amount', 1500);
    expect(n).toEqual({ value: { cost: { amount: 1500, currency: 'AKCE' }, cooldown_days: 30 } });
    expect(v.value.cost.amount).toBe(2000); // değişmez kopya
    expect(getPath(n, 'value.cost.currency')).toBe('AKCE');
    const fields = SETTING_DEFS.find((d) => d.key === 'company.change')!.fields;
    expect(diffFields(fields, v, n)).toEqual([{ key: 'value.cost.amount', label: 'Ücret (Akçe)', before: 2000, after: 1500 }]);
  });
});

describe('yönetim: istek şemaları ve yetki eşlemesi', () => {
  it('yaptırım: süreli olanlar süre ister, uyarı/ban süresizdir; gerekçe zorunlu', () => {
    expect(adminSanctionSchema.safeParse({ kind: 'mute', reason: 'Spam yaptı' }).success).toBe(false);
    expect(adminSanctionSchema.safeParse({ kind: 'mute', reason: 'Spam yaptı', hours: 2 }).success).toBe(true);
    expect(adminSanctionSchema.safeParse({ kind: 'ban', reason: 'Hile', hours: 2 }).success).toBe(false);
    expect(adminSanctionSchema.safeParse({ kind: 'warning', reason: 'x' }).success).toBe(false);
    expect(adminGrantSchema.safeParse({ playerId: crypto.randomUUID(), kind: 'currency', code: 'KREDI', amount: 0, reason: 'telafi' }).success).toBe(false);
  });

  it('yeni görev: etkinlikte tarih zorunlu ve bitiş sonra; en az bir ödül', () => {
    const base = {
      code: 'test_gorev',
      category: 'event' as const,
      title: 'Deneme görevi',
      description: 'Açıklama metni',
      minLevel: 1,
      objective: { type: 'kill_npc' as const, target: 3, label: '3 NPC', params: {} },
      reward: { credits: 100 },
    };
    expect(adminQuestCreateSchema.safeParse(base).success).toBe(false);
    expect(adminQuestCreateSchema.safeParse({ ...base, startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z' }).success).toBe(false);
    expect(adminQuestCreateSchema.safeParse({ ...base, startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-08T00:00:00Z' }).success).toBe(true);
    expect(adminQuestCreateSchema.safeParse({ ...base, category: 'main', reward: {} }).success).toBe(false);
  });

  it('içerik türlerinin tüm yetkileri katalogda var; içerik yöneticisi ayar ve ekonomi yazamaz', () => {
    for (const d of Object.values(CONTENT_TYPE_DEFS)) for (const p of [d.read, d.write, d.publish, d.rollback]) expect(PERMISSIONS).toContain(p);
    expect(ROLE_PERMISSIONS.content_manager).not.toContain('settings.write');
    expect(ROLE_PERMISSIONS.content_manager).not.toContain('economy.write');
    expect(ROLE_PERMISSIONS.content_manager).not.toContain('content.rollback');
    expect(ROLE_PERMISSIONS.game_admin).toContain('content.rollback');
  });
});
