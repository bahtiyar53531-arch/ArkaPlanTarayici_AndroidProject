import type { ItemCategory } from '@turkorbit/shared';

const nf = new Intl.NumberFormat('tr-TR');
export const fmt = (n: number) => nf.format(n);
const pct = (r: number) => `%${Math.round(r * 100)}`;
const sec = (ms: number) => `${(ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sn`;

export const CURRENCY_LABELS: Record<string, string> = { KREDI: 'Kredi', AKCE: 'Akçe' };
export const money = (amount: number, currency: string) => `${fmt(amount)} ${CURRENCY_LABELS[currency] ?? currency}`;

const EXTRA_KIND: Record<string, string> = { cargo: 'kargo', repair: 'onarım/sn', radar: 'radar menzili' };
const PET_KIND: Record<string, string> = {
  collector: 'Kargo kutularını toplar',
  repair: 'PET gövdesini onarır',
  guard: 'Koruma modunda tehditlere ateş eder',
  follow: 'Seçilen hedefi izler',
};

/** Eşya istatistiklerini Türkçe, okunabilir kısa metne çevirir. */
export function formatItemStats(category: ItemCategory | 'ship', s: Record<string, unknown>, upgradeMultiplier = 1): string {
  const n = (k: string) => Number(s[k] ?? 0);
  const up = (v: number) => Math.round(v * upgradeMultiplier);
  switch (category) {
    case 'laser':
      return `Hasar ${fmt(up(n('damage')))} · atış ${sec(n('rateMs'))} · menzil ${fmt(n('range'))}`;
    case 'ammo':
      return `×${n('multiplier')} hasar${s.shieldLeech ? ` · ${pct(n('shieldLeech'))} kalkana aktarım` : ''}`;
    case 'rocket':
      return [
        `Hasar ${fmt(n('damage'))}`,
        `bekleme ${sec(n('cooldownMs'))}`,
        `menzil ${fmt(n('range'))}`,
        s.aoeRadius ? `alan ${fmt(n('aoeRadius'))}` : '',
        s.slowMs ? `yavaşlatma ${sec(n('slowMs'))}` : '',
      ].filter(Boolean).join(' · ');
    case 'rocket_launcher':
      return `${n('volley')}'li yaylım · dolum ${sec(n('reloadMs'))}`;
    case 'shield_generator':
      return `Kalkan ${fmt(up(n('shield')))} · ${pct(n('absorb'))} emme`;
    case 'speed_generator':
      return `+${fmt(up(n('speed')))} hız`;
    case 'extra':
      return `+${fmt(n('value'))} ${EXTRA_KIND[String(s.kind)] ?? ''}`;
    case 'drone':
      return `${n('gearSlots')} ekipman${n('bonus') > 0 ? ` · ekipmana +${pct(n('bonus'))} güç` : ''}`;
    case 'pet':
      return `${n('moduleSlots')} modül slotu · ${fmt(n('hitpoints'))} can`;
    case 'pet_module':
      return PET_KIND[String(s.kind)] ?? '';
    case 'ship_design':
      return 'Yalnızca görünüm değiştirir';
    default:
      return '';
  }
}

export const RARITY_COLORS: Record<string, string> = {
  common: '#9aa6cc',
  uncommon: '#34d399',
  rare: '#29c5ff',
  epic: '#c084fc',
  legendary: '#f5b700',
};
