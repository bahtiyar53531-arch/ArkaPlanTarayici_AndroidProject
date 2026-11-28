import {
  ITEM_CATEGORY_LABELS_TR,
  RARITY_LABELS_TR,
  SHIP_CLASS_LABELS_TR,
  SLOT_ACCEPTS,
  SLOT_LABELS_TR,
  slotCount,
  type HangarResponse,
  type HangarShip,
  type InventoryItem,
  type ItemCategory,
  type ShopOffer,
  type ShopResponse,
  type SlotType,
} from '@turkorbit/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { AccountLayout } from '../components/Layout';
import { ItemIcon, ShipArt } from '../components/ShipArt';
import { Alert, ErrorAlert } from '../components/ui';
import { fmt, formatItemStats, money, RARITY_COLORS } from '../lib/format';

const SERVER = 'TR1';
const SLOT_ORDER: SlotType[] = ['laser', 'generator', 'extra', 'drone', 'drone_gear'];

function useHangar() {
  const [hangar, setHangar] = useState<HangarResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setHangar((await api<{ hangar: HangarResponse }>('GET', `/hangar?server=${SERVER}`)).hangar);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { hangar, setHangar, error, setError, load };
}

function NoPilot({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.code === 'PILOT_NOT_FOUND') {
    return (
      <Alert kind="info">
        Hangarı kullanmak için önce bir pilot oluşturmalısın. <Link to="/pilot">Pilot oluştur</Link>
      </Alert>
    );
  }
  return <ErrorAlert error={error} />;
}

function Balances({ currencies }: { currencies: Array<{ code: string; name: string; balance: number }> }) {
  return (
    <div className="balances">
      {currencies.map((c) => (
        <span key={c.code} className={`balance balance-${c.code.toLowerCase()}`}>
          {c.name}: <b>{fmt(c.balance)}</b>
        </span>
      ))}
    </div>
  );
}

// ====================================================================== HANGAR
export function HangarPage() {
  const { hangar, setHangar, error, setError } = useHangar();
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [loadout, setLoadout] = useState<1 | 2>(1);
  const [picker, setPicker] = useState<{ slotType: SlotType; slotIndex: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hangar && !selectedShipId) {
      setSelectedShipId(hangar.activeShipId ?? hangar.ships[0]?.id ?? null);
      setLoadout(hangar.activeLoadout);
    }
  }, [hangar, selectedShipId]);

  const run = useCallback(
    async (fn: () => Promise<{ hangar: HangarResponse; result?: unknown }>, ok?: (r: { result?: unknown }) => string | null) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const r = await fn();
        setHangar(r.hangar);
        const msg = ok?.(r);
        if (msg) setNotice(msg);
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
    [setError, setHangar],
  );

  if (!hangar) {
    return (
      <AccountLayout>
        <h1 className="page-title">Hangar</h1>
        {error ? <NoPilot error={error} /> : <p className="muted">Hangar yükleniyor…</p>}
      </AccountLayout>
    );
  }

  const ship = hangar.ships.find((s) => s.id === selectedShipId) ?? hangar.ships[0]!;
  const items = new Map(hangar.inventory.map((i) => [i.id, i]));
  const post = (path: string, body: object) => api<{ hangar: HangarResponse; result?: unknown }>('POST', path, { serverCode: SERVER, ...body });

  return (
    <AccountLayout>
      <div className="page-head">
        <h1 className="page-title">Hangar</h1>
        <div className="page-head-actions">
          <Balances currencies={hangar.currencies} />
          <Link className="btn btn-secondary" to="/magaza">Mağaza</Link>
          <Link className="btn btn-primary" to="/oyna">Uzaya çık</Link>
        </div>
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}
      <ErrorAlert error={error} />

      <section className="ship-strip" aria-label="Gemilerin">
        {hangar.ships.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`ship-card${s.id === ship.id ? ' selected' : ''}`}
            onClick={() => { setSelectedShipId(s.id); setPicker(null); }}
          >
            <ShipArt spriteKey={s.spriteKey} size={72} />
            <span className="ship-card-name">{s.type.name}</span>
            <span className="muted small">{SHIP_CLASS_LABELS_TR[s.type.shipClass] ?? s.type.shipClass}</span>
            {s.isActive && <span className="badge badge-ok">Aktif</span>}
          </button>
        ))}
        <Link to="/magaza" className="ship-card ship-card-add">
          <span className="plus">+</span>
          <span className="muted small">Yeni gemi al</span>
        </Link>
      </section>

      <div className="hangar-grid">
        <section className="panel ship-detail">
          <div className="ship-detail-head">
            <ShipArt spriteKey={ship.spriteKey} size={150} />
            <div className="ship-detail-info">
              <h2>{ship.type.name}</h2>
              <div className="muted">{SHIP_CLASS_LABELS_TR[ship.type.shipClass] ?? ship.type.shipClass}{ship.design ? ` · ${ship.design.name}` : ''}</div>
              <div className="list-meta">Can {fmt(ship.hitpoints)} / {fmt(ship.maxHitpoints)}</div>
              <div className="bar"><span style={{ width: `${(ship.hitpoints / ship.maxHitpoints) * 100}%`, background: 'var(--ok)' }} /></div>
              <div className="ship-actions">
                {!ship.isActive && (
                  <button type="button" className="btn btn-primary btn-small" disabled={busy}
                    onClick={() => run(() => post(`/hangar/ships/${ship.id}/activate`, {}), () => `${ship.type.name} artık aktif gemin.`)}>
                    Aktif gemi yap
                  </button>
                )}
                {ship.repairCost && (
                  <button type="button" className="btn btn-secondary btn-small" disabled={busy}
                    onClick={() => run(() => post(`/hangar/ships/${ship.id}/repair`, { requestId: crypto.randomUUID() }), () => 'Gemi onarıldı.')}>
                    Onar ({money(ship.repairCost.amount, ship.repairCost.currency)})
                  </button>
                )}
                <DesignSelect ship={ship} hangar={hangar} busy={busy}
                  onChange={(itemId) => run(() => post(`/hangar/ships/${ship.id}/design`, { itemId }), () => 'Tasarım güncellendi.')} />
              </div>
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="Konfigürasyonlar">
            {([1, 2] as const).map((n) => (
              <button key={n} type="button" role="tab" aria-selected={loadout === n} className={`tab${loadout === n ? ' active' : ''}`}
                onClick={() => { setLoadout(n); setPicker(null); }}>
                Konfigürasyon {n}
                {ship.isActive && hangar.activeLoadout === n && <span className="badge badge-ok">Kullanımda</span>}
              </button>
            ))}
            {ship.isActive && hangar.activeLoadout !== loadout && (
              <button type="button" className="btn btn-ghost btn-small" disabled={busy}
                onClick={() => run(() => post('/hangar/loadout', { loadout }), () => `Konfigürasyon ${loadout} kullanıma alındı.`)}>
                Bunu kullan
              </button>
            )}
          </div>

          {SLOT_ORDER.map((slotType) => {
            const count = slotCount(ship.type.slots, slotType);
            if (count === 0) return null;
            return (
              <div key={slotType} className="slot-group">
                <div className="slot-group-title">{SLOT_LABELS_TR[slotType]} <span className="muted small">({count})</span></div>
                <div className="slot-row">
                  {Array.from({ length: count }, (_, i) => {
                    const placed = ship.loadouts[loadout].find((l) => l.slotType === slotType && l.slotIndex === i);
                    const it = placed ? items.get(placed.itemId) : undefined;
                    const locked = slotType === 'drone_gear' && !ship.loadouts[loadout].some((l) => l.slotType === 'drone' && l.slotIndex === i);
                    const active = picker?.slotType === slotType && picker.slotIndex === i;
                    return (
                      <button key={i} type="button" disabled={locked}
                        className={`slot${it ? ' filled' : ''}${active ? ' picking' : ''}${locked ? ' locked' : ''}`}
                        title={locked ? 'Önce bu sıraya bir drone tak' : it ? it.name : 'Boş slot'}
                        aria-label={`${SLOT_LABELS_TR[slotType]} ${i + 1}: ${it ? it.name : locked ? 'kilitli' : 'boş'}`}
                        onClick={() => setPicker(active ? null : { slotType, slotIndex: i })}>
                        {it ? <ItemIcon iconKey={it.iconKey} size={34} color={RARITY_COLORS[it.rarity]} /> : <span className="slot-empty">{locked ? '🔒' : '+'}</span>}
                        {it && it.upgradeLevel > 0 && <span className="slot-level">+{it.upgradeLevel}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {picker && (
            <SlotPicker
              ship={ship}
              loadout={loadout}
              slot={picker}
              hangar={hangar}
              busy={busy}
              onClose={() => setPicker(null)}
              onEquip={(itemId) =>
                run(() => post('/hangar/equip', { shipId: ship.id, loadout, slotType: picker.slotType, slotIndex: picker.slotIndex, itemId }), () => {
                  setPicker(null);
                  return null;
                })
              }
              onUnequip={() =>
                run(() => post('/hangar/unequip', { shipId: ship.id, loadout, slotType: picker.slotType, slotIndex: picker.slotIndex }), () => {
                  setPicker(null);
                  return null;
                })
              }
            />
          )}
        </section>

        <section className="panel">
          <h2>Konfigürasyon {loadout} değerleri</h2>
          <StatsTable stats={ship.stats[loadout]} />
          <p className="muted small">Değerler sunucuda, ekipmanın gerçek istatistikleri ve yükseltme seviyeleriyle hesaplanır.</p>
          <PetPanel hangar={hangar} busy={busy}
            onRename={(name) => run(() => post('/hangar/pet/name', { name }), () => 'PET adı güncellendi.')}
            onModule={(slotIndex, itemId) => run(() => post('/hangar/pet/modules', { slotIndex, itemId }), () => null)} />
        </section>
      </div>

      <InventoryPanel hangar={hangar} busy={busy}
        onUpgrade={(it) => run(() => post(`/hangar/items/${it.id}/upgrade`, { requestId: crypto.randomUUID() }), (r) => {
          const res = r.result as { success: boolean; toLevel: number };
          return res.success ? `Yükseltme başarılı! ${it.name} artık +${res.toLevel}.` : `Yükseltme başarısız oldu. ${it.name} +${res.toLevel} seviyesinde kaldı.`;
        })}
        onSell={(it, quantity) => run(() => post(`/hangar/items/${it.id}/sell`, { quantity, requestId: crypto.randomUUID() }), (r) => {
          const res = r.result as { earned: number };
          return `${it.name} satıldı: +${money(res.earned, 'KREDI')}.`;
        })}
      />
    </AccountLayout>
  );
}

function DesignSelect({ ship, hangar, busy, onChange }: { ship: HangarShip; hangar: HangarResponse; busy: boolean; onChange: (id: string | null) => void }) {
  const designs = hangar.inventory.filter((i) => i.category === 'ship_design' && i.requiresShip === ship.type.code);
  if (designs.length === 0) return null;
  return (
    <label className="design-select">
      <span className="sr-only">Gemi tasarımı</span>
      <select value={ship.design?.itemId ?? ''} disabled={busy} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Varsayılan tasarım</option>
        {designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  );
}

function SlotPicker(props: {
  ship: HangarShip;
  loadout: 1 | 2;
  slot: { slotType: SlotType; slotIndex: number };
  hangar: HangarResponse;
  busy: boolean;
  onClose: () => void;
  onEquip: (itemId: string) => void;
  onUnequip: () => void;
}) {
  const { ship, loadout, slot, hangar } = props;
  const current = ship.loadouts[loadout].find((l) => l.slotType === slot.slotType && l.slotIndex === slot.slotIndex);
  const accepts = SLOT_ACCEPTS[slot.slotType];
  const options = hangar.inventory.filter(
    (i) =>
      accepts.includes(i.category) &&
      i.id !== current?.itemId &&
      !i.equippedIn.some((e) => e.shipId !== ship.id),
  );
  return (
    <div className="picker" role="dialog" aria-label={`${SLOT_LABELS_TR[slot.slotType]} ${slot.slotIndex + 1} için eşya seç`}>
      <div className="picker-head">
        <b>{SLOT_LABELS_TR[slot.slotType]} {slot.slotIndex + 1}</b>
        <span className="muted small">Uygun: {accepts.map((c) => ITEM_CATEGORY_LABELS_TR[c]).join(', ')}</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={props.onClose}>Kapat</button>
      </div>
      {current && (
        <div className="picker-current">
          <span>Takılı: <b>{hangar.inventory.find((i) => i.id === current.itemId)?.name}</b></span>
          <button type="button" className="btn btn-danger btn-small" disabled={props.busy} onClick={props.onUnequip}>Çıkar</button>
        </div>
      )}
      {options.length === 0 ? (
        <p className="muted small">Bu slota takılabilecek boşta eşyan yok. <Link to="/magaza">Mağazaya göz at</Link>.</p>
      ) : (
        <ul className="picker-list">
          {options.map((i) => {
            const tooLow = hangar.playerLevel < i.minLevel;
            const sameLoadout = i.equippedIn.find((e) => e.shipId === ship.id && e.loadout === loadout);
            return (
              <li key={i.id}>
                <ItemIcon iconKey={i.iconKey} size={36} color={RARITY_COLORS[i.rarity]} />
                <div className="picker-item">
                  <div><b style={{ color: RARITY_COLORS[i.rarity] }}>{i.name}</b>{i.upgradeLevel > 0 && <span className="muted"> +{i.upgradeLevel}</span>}</div>
                  <div className="muted small">{formatItemStats(i.category, i.stats)}{sameLoadout ? ` · şu an ${SLOT_LABELS_TR[sameLoadout.slotType]} ${sameLoadout.slotIndex + 1} slotunda` : ''}</div>
                  {tooLow && <div className="field-error">Seviye {i.minLevel} gerekli</div>}
                </div>
                <button type="button" className="btn btn-secondary btn-small" disabled={props.busy || tooLow} onClick={() => props.onEquip(i.id)}>
                  Tak
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatsTable({ stats }: { stats: HangarShip['stats'][1] }) {
  const rows: Array<[string, string]> = [
    ['Lazer hasarı / atış', fmt(stats.damagePerVolley)],
    ['Saniyede hasar', fmt(stats.damagePerSecond)],
    ['Lazer menzili', stats.laserRange ? fmt(stats.laserRange) : '—'],
    ['Kalkan', fmt(stats.shield)],
    ['Kalkan emme', stats.shield ? `%${Math.round(stats.shieldAbsorb * 100)}` : '—'],
    ['Can', fmt(stats.hitpoints)],
    ['Hız', fmt(stats.speed)],
    ['Kargo', fmt(stats.cargo)],
    ['Roket yaylımı', `${stats.rocketVolley}'li`],
    ['Drone', String(stats.drones)],
  ];
  return (
    <dl className="kv compact stats-table">
      {rows.map(([k, v]) => (
        <div key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

function PetPanel({ hangar, busy, onRename, onModule }: {
  hangar: HangarResponse; busy: boolean; onRename: (n: string) => void; onModule: (slot: number, itemId: string | null) => void;
}) {
  const [name, setName] = useState(hangar.pet?.name ?? '');
  useEffect(() => setName(hangar.pet?.name ?? ''), [hangar.pet?.name]);
  if (!hangar.pet) {
    return (
      <div className="pet-panel">
        <h3>PET</h3>
        <p className="muted small">Henüz bir PET'in yok. <Link to="/magaza">Mağazadan</Link> Yoldaş PET'i (seviye 5) alabilirsin.</p>
      </div>
    );
  }
  const pet = hangar.pet;
  const modules = hangar.inventory.filter((i) => i.category === 'pet_module');
  return (
    <div className="pet-panel">
      <h3>PET: {pet.name}</h3>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); onRename(name); }}>
        <label className="sr-only" htmlFor="pet-name">PET adı</label>
        <input id="pet-name" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-secondary btn-small" disabled={busy || name === pet.name}>Adını değiştir</button>
      </form>
      {Array.from({ length: pet.moduleSlots }, (_, i) => {
        const current = pet.modules.find((m) => m.slotIndex === i)?.itemId ?? '';
        return (
          <label key={i} className="pet-slot">
            <span>Modül {i + 1}</span>
            <select value={current} disabled={busy} onChange={(e) => onModule(i, e.target.value || null)}>
              <option value="">Boş</option>
              {modules.map((m) => <option key={m.id} value={m.id}>{m.name}{m.usage.petModuleSlot !== null && m.usage.petModuleSlot !== i ? ` (modül ${m.usage.petModuleSlot + 1})` : ''}</option>)}
            </select>
          </label>
        );
      })}
    </div>
  );
}

const INVENTORY_FILTERS: Array<{ key: string; label: string; cats: ItemCategory[] }> = [
  { key: 'all', label: 'Tümü', cats: [] },
  { key: 'weapon', label: 'Silahlar', cats: ['laser', 'rocket_launcher'] },
  { key: 'gen', label: 'Jeneratörler', cats: ['shield_generator', 'speed_generator'] },
  { key: 'ammo', label: 'Mühimmat', cats: ['ammo', 'rocket'] },
  { key: 'other', label: 'Ekstra ve drone', cats: ['extra', 'drone'] },
  { key: 'pet', label: 'PET', cats: ['pet', 'pet_module'] },
  { key: 'design', label: 'Tasarımlar', cats: ['ship_design'] },
  { key: 'resource', label: 'Kaynaklar', cats: ['resource'] },
];

function InventoryPanel({ hangar, busy, onUpgrade, onSell }: {
  hangar: HangarResponse; busy: boolean; onUpgrade: (i: InventoryItem) => void; onSell: (i: InventoryItem, q: number) => void;
}) {
  const [filter, setFilter] = useState('all');
  const [confirm, setConfirm] = useState<{ id: string; action: 'upgrade' | 'sell'; qty: number } | null>(null);
  const shipNames = new Map(hangar.ships.map((s) => [s.id, s.type.name]));
  const cats = INVENTORY_FILTERS.find((f) => f.key === filter)!.cats;
  const list = useMemo(() => hangar.inventory.filter((i) => cats.length === 0 || cats.includes(i.category)), [hangar.inventory, cats]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Envanter</h2>
        <span className="muted small">{hangar.inventory.length} / {hangar.inventoryLimit}</span>
      </div>
      <div className="chips" role="tablist">
        {INVENTORY_FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <ul className="inventory">
        {list.map((i) => {
          const inUse = i.equippedIn.length > 0 || i.usage.pet || i.usage.petModuleSlot !== null || i.usage.designShipId !== null;
          const usage = [
            ...new Set(i.equippedIn.map((e) => `${shipNames.get(e.shipId)} · K${e.loadout}`)),
            i.usage.pet ? 'Aktif PET' : '',
            i.usage.petModuleSlot !== null ? `PET modül ${i.usage.petModuleSlot + 1}` : '',
            i.usage.designShipId ? `${shipNames.get(i.usage.designShipId)} tasarımı` : '',
          ].filter(Boolean);
          const c = confirm?.id === i.id ? confirm : null;
          return (
            <li key={i.id} className="inv-item">
              <ItemIcon iconKey={i.iconKey} size={44} color={RARITY_COLORS[i.rarity]} />
              <div className="inv-body">
                <div className="inv-title">
                  <b style={{ color: RARITY_COLORS[i.rarity] }}>{i.name}</b>
                  {i.upgradeLevel > 0 && <span className="level-badge">+{i.upgradeLevel}</span>}
                  {i.quantity > 1 && <span className="muted">×{fmt(i.quantity)}</span>}
                  <span className="muted small">{ITEM_CATEGORY_LABELS_TR[i.category]} · {RARITY_LABELS_TR[i.rarity]}</span>
                </div>
                <div className="muted small">{formatItemStats(i.category, i.stats, 1 + 0.02 * i.upgradeLevel)}</div>
                {usage.length > 0 && <div className="small inv-usage">{usage.join(' · ')}</div>}
                {c?.action === 'upgrade' && i.nextUpgrade && (
                  <div className="confirm">
                    <span>+{i.nextUpgrade.level} için %{Math.round(i.nextUpgrade.chance * 100)} başarı şansı, ücret {money(i.nextUpgrade.amount, i.nextUpgrade.currency)}. Başarısız olursa ücret iade edilmez.</span>
                    <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => { setConfirm(null); onUpgrade(i); }}>Yükselt</button>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirm(null)}>Vazgeç</button>
                  </div>
                )}
                {c?.action === 'sell' && (
                  <div className="confirm">
                    {i.quantity > 1 && (
                      <input type="number" min={1} max={i.quantity} value={c.qty} aria-label="Satılacak miktar"
                        onChange={(e) => setConfirm({ ...c, qty: Math.max(1, Math.min(i.quantity, Number(e.target.value) || 1)) })} />
                    )}
                    <span>{fmt(c.qty)} adet → +{money(c.qty * i.sellPrice, 'KREDI')}</span>
                    <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => { setConfirm(null); onSell(i, c.qty); }}>Sat</button>
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirm(null)}>Vazgeç</button>
                  </div>
                )}
              </div>
              {!c && <div className="inv-actions">
                {i.nextUpgrade && (
                  <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => setConfirm({ id: i.id, action: 'upgrade', qty: 1 })}>Yükselt</button>
                )}
                {i.sellPrice > 0 && !inUse && !i.bound && (
                  <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirm({ id: i.id, action: 'sell', qty: 1 })}>Sat</button>
                )}
              </div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ====================================================================== MAĞAZA
export function ShopPage() {
  const [shop, setShop] = useState<ShopResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyOffer, setBusyOffer] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const s = (await api<{ shop: ShopResponse }>('GET', `/shop?server=${SERVER}`)).shop;
      setShop(s);
      setCategory((c) => c ?? s.categories[0]?.code ?? null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function buy(o: ShopOffer, packs: number) {
    setBusyOffer(o.id);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ purchase: { total: number; currency: string } }>('POST', '/shop/purchase', {
        serverCode: SERVER, offerId: o.id, packs, requestId: crypto.randomUUID(),
      });
      setNotice(`${o.name}${packs > 1 ? ` ×${packs}` : ''} satın alındı (${money(r.purchase.total, r.purchase.currency)}). Hangarında seni bekliyor.`);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusyOffer(null);
    }
  }

  if (!shop) {
    return (
      <AccountLayout>
        <h1 className="page-title">Mağaza</h1>
        {error ? <NoPilot error={error} /> : <p className="muted">Mağaza yükleniyor…</p>}
      </AccountLayout>
    );
  }
  const current = shop.categories.find((c) => c.code === category) ?? shop.categories[0];
  return (
    <AccountLayout>
      <div className="page-head">
        <h1 className="page-title">Mağaza</h1>
        <div className="page-head-actions">
          <Balances currencies={shop.currencies} />
          <Link className="btn btn-secondary" to="/hangar">Hangar</Link>
        </div>
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}
      <ErrorAlert error={error} />
      <div className="chips" role="tablist" aria-label="Mağaza kategorileri">
        {shop.categories.map((c) => (
          <button key={c.code} type="button" role="tab" aria-selected={current?.code === c.code} className={`chip${current?.code === c.code ? ' active' : ''}`} onClick={() => setCategory(c.code)}>{c.name}</button>
        ))}
      </div>
      <div className="offer-grid">
        {current?.offers.map((o) => (
          <OfferCard key={o.id} offer={o} playerLevel={shop.playerLevel} busy={busyOffer === o.id}
            balance={shop.currencies.find((c) => c.code === o.currency)?.balance ?? 0} onBuy={(p) => buy(o, p)} />
        ))}
      </div>
    </AccountLayout>
  );
}

function OfferCard({ offer: o, playerLevel, balance, busy, onBuy }: {
  offer: ShopOffer; playerLevel: number; balance: number; busy: boolean; onBuy: (packs: number) => void;
}) {
  const [packs, setPacks] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const total = o.finalPrice * packs;
  const tooLow = playerLevel < o.minLevel;
  const blocked = o.owned || o.limitReached || tooLow;
  return (
    <article className="offer" style={{ borderColor: RARITY_COLORS[o.rarity] }}>
      <div className="offer-art">
        {o.ship ? <ShipArt spriteKey={o.ship.spriteKey} size={120} /> : <ItemIcon iconKey={o.iconKey} size={72} color={RARITY_COLORS[o.rarity]} />}
      </div>
      <h3 className="offer-name" style={{ color: RARITY_COLORS[o.rarity] }}>
        {o.name}{o.quantity > 1 ? <span className="muted"> ×{fmt(o.quantity)}</span> : null}
      </h3>
      <div className="muted small">{o.ship ? SHIP_CLASS_LABELS_TR[o.ship.shipClass] : o.bundle ? 'Paket' : ITEM_CATEGORY_LABELS_TR[o.category as ItemCategory]}</div>
      <p className="offer-desc">{o.description}</p>
      {o.ship ? (
        <dl className="kv compact">
          <dt>Can</dt><dd>{fmt(o.ship.hitpoints)}</dd>
          <dt>Hız</dt><dd>{fmt(o.ship.baseSpeed)}</dd>
          <dt>Kargo</dt><dd>{fmt(o.ship.cargoCapacity)}</dd>
          <dt>Slotlar</dt><dd>{o.ship.slots.laser} lazer · {o.ship.slots.generator} jen. · {o.ship.slots.extra} ekstra · {o.ship.slots.drone} drone</dd>
        </dl>
      ) : o.bundle ? (
        <ul className="bundle-list small" aria-label="Paket içeriği">
          {o.bundle.map((b) => (
            <li key={b.code}>
              {fmt(b.quantity)} × {b.name}
            </li>
          ))}
        </ul>
      ) : (
        <div className="small offer-stats">{formatItemStats(o.category as ItemCategory, o.stats)}</div>
      )}
      {o.requiresShip && <div className="muted small">Uygun gemi: {o.requiresShip}</div>}
      <div className="offer-foot">
        <div className="price">
          {o.discountPercent > 0 && <s className="muted">{money(o.price, o.currency)}</s>}
          <b>{money(o.finalPrice, o.currency)}</b>
          {o.discountPercent > 0 && <span className="badge badge-warn">-%{o.discountPercent}</span>}
        </div>
        <div className="offer-badges">
          <span className={`badge ${tooLow ? 'badge-danger' : 'badge-ok'}`}>Sv {o.minLevel}+</span>
          {o.owned && <span className="badge badge-ok">Sahipsin</span>}
          {!o.owned && o.limitReached && <span className="badge badge-warn">Sınıra ulaşıldı</span>}
        </div>
        {!blocked && o.maxPerPurchase > 1 && (
          <label className="packs">
            Paket
            <input type="number" min={1} max={o.maxPerPurchase} value={packs} onChange={(e) => setPacks(Math.max(1, Math.min(o.maxPerPurchase, Number(e.target.value) || 1)))} />
          </label>
        )}
        {!blocked && (confirming ? (
          <div className="confirm">
            <span>{money(total, o.currency)} ödenecek.{total > balance ? ' Bakiyen yetersiz.' : ''}</span>
            <button type="button" className="btn btn-primary btn-small" disabled={busy || total > balance} onClick={() => { setConfirming(false); onBuy(packs); }}>Onayla</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirming(false)}>Vazgeç</button>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(true)}>
            {busy ? 'İşleniyor…' : 'Satın al'}
          </button>
        ))}
      </div>
    </article>
  );
}
