/**
 * Pazar (/pazar) — Aşama 11: günlük giriş ödülü, kaynaklar (satış), rafineri ve atölye (üretim kuyruğu), açık artırma.
 * Tüm hesaplar sunucuda yapılır; sayfa yalnızca "ne" ve "kaç adet" gönderir.
 */
import {
  AUCTION_TYPE_LABELS,
  AUCTION_TYPES,
  RECIPE_CATEGORY_LABELS,
  type AuctionsResponse,
  type AuctionView,
  type CraftingResponse,
  type DailyRewardResponse,
  type RecipeView,
} from '@turkorbit/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { AccountLayout } from '../components/Layout';
import { ItemIcon } from '../components/ShipArt';
import { Alert, ErrorAlert } from '../components/ui';
import { fmt, money, RARITY_COLORS } from '../lib/format';

const SERVER = 'TR1';
type Tab = 'daily' | 'resources' | 'crafting' | 'auctions';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'daily', label: 'Günlük ödül' },
  { key: 'resources', label: 'Kaynaklar' },
  { key: 'crafting', label: 'Üretim' },
  { key: 'auctions', label: 'Açık artırma' },
];

function remaining(ms: number): string {
  if (ms <= 0) return 'şimdi';
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} gün ${h} sa`;
  if (h > 0) return `${h} sa ${m} dk`;
  if (m > 0) return `${m} dk ${sec} sn`;
  return `${sec} sn`;
}

/** Sunucu saatine göre geri sayım için saniyede bir yenilenen "şimdi" */
function useNow(serverTime: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    if (serverTime) setSkew(Date.parse(serverTime) - Date.now());
  }, [serverTime]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now + skew;
}

function NoPilot({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.code === 'PILOT_NOT_FOUND') {
    return (
      <Alert kind="info">
        Pazarı kullanmak için önce bir pilot oluşturmalısın. <Link to="/pilot">Pilot oluştur</Link>
      </Alert>
    );
  }
  return <ErrorAlert error={error} />;
}

export function MarketPage() {
  const [tab, setTab] = useState<Tab>('daily');
  return (
    <AccountLayout>
      <div className="page-head">
        <h1 className="page-title">Pazar</h1>
      </div>
      <div className="tabs" role="tablist" aria-label="Pazar bölümleri">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)} data-testid={`market-tab-${t.key}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'daily' && <DailyPanel />}
      {(tab === 'resources' || tab === 'crafting') && <CraftingArea mode={tab} />}
      {tab === 'auctions' && <AuctionsPanel />}
    </AccountLayout>
  );
}

// ====================================================================== günlük ödül
function DailyPanel() {
  const [d, setD] = useState<DailyRewardResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(d?.serverTime);
  useEffect(() => {
    api<{ daily: DailyRewardResponse }>('GET', `/market/daily?server=${SERVER}`)
      .then((r) => setD(r.daily))
      .catch(setError);
  }, []);
  if (!d) return error ? <NoPilot error={error} /> : <p className="muted">Yükleniyor…</p>;
  const claim = async () => {
    setBusy(true);
    try {
      const r = await api<{ replay: boolean; reward: { day: number; currencies: Array<{ code: string; amount: number }>; items: Array<{ name: string; amount: number }> } | null; daily: DailyRewardResponse }>(
        'POST',
        '/market/daily/claim',
        { serverCode: SERVER },
      );
      setD(r.daily);
      setError(null);
      if (r.reward) {
        const parts = [...r.reward.currencies.map((c) => money(c.amount, c.code)), ...r.reward.items.map((i) => `${fmt(i.amount)} × ${i.name}`)];
        setNotice(`${r.reward.day}. gün ödülü alındı: ${parts.join(' · ')}`);
      } else setNotice('Bugünün ödülünü zaten almıştın.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" data-testid="daily-panel">
      <div className="panel-head">
        <div>
          <h2>Günlük giriş ödülü</h2>
          <p className="muted small">
            Her gün 05:00'te (TSİ) yenilenir. Art arda giriş serisi: <b>{d.streak}</b> gün · Sonraki yenilenme: {remaining(Date.parse(d.nextReset) - now)}
          </p>
        </div>
        {d.claimedToday ? (
          <span className="badge badge-ok">Bugünün ödülü alındı</span>
        ) : (
          <button type="button" className="btn btn-claim" disabled={busy} onClick={() => void claim()}>
            {busy ? 'Alınıyor…' : `${d.day}. gün ödülünü al`}
          </button>
        )}
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}
      {error !== null && <ErrorAlert error={error} />}
      <ol className="daily-calendar">
        {d.calendar.map((c) => {
          const state = c.day < d.day || (c.day === d.day && d.claimedToday) ? 'done' : c.day === d.day ? 'today' : 'next';
          return (
            <li key={c.day} className={`daily-day ${state}`} data-testid={`daily-day-${c.day}`}>
              <div className="daily-num">{c.day}. gün</div>
              {c.rewards.map((r) => (
                <div key={r.code} className="daily-reward">
                  {r.type === 'item' ? `${fmt(r.amount)} × ${r.name}` : `+${fmt(r.amount)} ${r.name}`}
                </div>
              ))}
              {state === 'done' && <div className="daily-check" aria-label="alındı">✔</div>}
            </li>
          );
        })}
      </ol>
      <p className="muted small">Bir gün kaçırırsan seri 1. günden yeniden başlar. 7. günden sonra takvim başa döner.</p>
    </section>
  );
}

// ====================================================================== kaynaklar ve üretim
function CraftingArea({ mode }: { mode: 'resources' | 'crafting' }) {
  const [data, setData] = useState<CraftingResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(data?.serverTime);
  const load = useCallback(async () => {
    try {
      setData((await api<{ crafting: CraftingResponse }>('GET', `/market/crafting?server=${SERVER}`)).crafting);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return error ? <NoPilot error={error} /> : <p className="muted">Yükleniyor…</p>;

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setNotice(null);
    try {
      const msg = await fn();
      setError(null);
      if (msg) setNotice(msg);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const sell = (code: string, itemId: string, quantity: number, name: string, price: number) =>
    run(async () => {
      await api('POST', `/hangar/items/${itemId}/sell`, { serverCode: SERVER, quantity, requestId: crypto.randomUUID() });
      await load();
      return `${fmt(quantity)} ${name} satıldı: +${fmt(quantity * price)} Kredi`;
    });
  const start = (r: RecipeView, batches: number) =>
    run(async () => {
      const x = await api<{ crafting: CraftingResponse }>('POST', '/market/crafting/start', { serverCode: SERVER, recipe: r.code, batches, requestId: crypto.randomUUID() });
      setData(x.crafting);
      return `${r.name} üretimi başladı (${fmt(batches)} adet).`;
    });
  const claim = (jobId: number) =>
    run(async () => {
      const x = await api<{ claimed: { name: string; quantity: number }; crafting: CraftingResponse }>('POST', '/market/crafting/claim', { serverCode: SERVER, jobId });
      setData(x.crafting);
      return `Teslim alındı: ${fmt(x.claimed.quantity)} × ${x.claimed.name}`;
    });

  return (
    <>
      {notice && <Alert kind="success">{notice}</Alert>}
      {error !== null && <ErrorAlert error={error} />}
      {mode === 'resources' ? (
        <ResourcesPanel data={data} busy={busy} onSell={sell} />
      ) : (
        <CraftingPanel data={data} busy={busy} now={now} onStart={start} onClaim={claim} />
      )}
    </>
  );
}

function ResourcesPanel({ data, busy, onSell }: {
  data: CraftingResponse;
  busy: boolean;
  onSell: (code: string, itemId: string, qty: number, name: string, price: number) => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const full = data.cargo.used >= data.cargo.capacity;
  return (
    <section className="panel" data-testid="resources-panel">
      <div className="panel-head">
        <h2>Kaynaklar</h2>
        <span className={`badge ${full ? 'badge-warn' : 'badge-info'}`} data-testid="cargo-badge">
          Ambar {fmt(data.cargo.used)} / {fmt(data.cargo.capacity)}
        </span>
      </div>
      <p className="muted small">
        Kaynaklar oyunda kaynak bölgelerindeki kristal kümelerine yaklaşınca toplanır. Ambar dolunca toplama durur: kaynakları burada sat veya Üretim bölümünde işle.
      </p>
      <ul className="inventory">
        {data.resources.map((r) => {
          const q = Math.min(r.quantity, Math.max(1, qty[r.code] ?? r.quantity));
          return (
            <li key={r.code} className="inv-item" data-testid={`resource-${r.code}`}>
              <ItemIcon iconKey={`res-${r.code}`} size={44} color={RARITY_COLORS[r.tier >= 4 ? 'legendary' : r.tier === 3 ? 'rare' : r.tier === 2 ? 'uncommon' : 'common']} />
              <div className="inv-body">
                <div className="inv-title">
                  <b>{r.name}</b>
                  <span className="muted small">{r.tier}. kademe</span>
                </div>
                <div className="small">
                  Elinde: <b>{fmt(r.quantity)}</b> · {r.sellPrice > 0 ? `Birim fiyat: ${fmt(r.sellPrice)} Kredi` : 'Satılamaz'}
                </div>
              </div>
              {r.quantity > 0 && r.sellPrice > 0 && r.itemId && (
                <div className="inv-actions">
                  <input type="number" min={1} max={r.quantity} value={q} aria-label={`${r.name} satış miktarı`} onChange={(e) => setQty({ ...qty, [r.code]: Number(e.target.value) || 1 })} />
                  <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => onSell(r.code, r.itemId!, q, r.name, r.sellPrice)}>
                    Sat ({fmt(q * r.sellPrice)} Kredi)
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CraftingPanel({ data, busy, now, onStart, onClaim }: {
  data: CraftingResponse;
  busy: boolean;
  now: number;
  onStart: (r: RecipeView, batches: number) => void;
  onClaim: (jobId: number) => void;
}) {
  const [batches, setBatches] = useState<Record<string, number>>({});
  const slotsFull = data.jobs.length >= data.slots;
  return (
    <>
      <section className="panel" data-testid="crafting-jobs">
        <div className="panel-head">
          <h2>Üretim kuyruğu</h2>
          <span className="badge badge-info">
            {data.jobs.length} / {data.slots} yuva
          </span>
        </div>
        {data.jobs.length === 0 && <p className="muted">Şu anda üretim yok. Aşağıdaki tariflerden birini başlat.</p>}
        <ul className="list">
          {data.jobs.map((j) => {
            const left = Date.parse(j.readyAt) - now;
            const total = Date.parse(j.readyAt) - Date.parse(j.startedAt);
            const ready = left <= 0;
            return (
              <li key={j.id} className="list-item craft-job" data-testid={`job-${j.recipe}`}>
                <div>
                  <div className="list-title">
                    {fmt(j.output.quantity)} × {j.output.name}
                  </div>
                  <div className="bar" aria-hidden="true">
                    <span style={{ width: `${total > 0 ? Math.min(100, ((total - Math.max(0, left)) / total) * 100) : 100}%` }} />
                  </div>
                  <div className="list-meta">{ready ? 'Hazır' : `Kalan: ${remaining(left)}`}</div>
                </div>
                {ready && (
                  <button type="button" className="btn btn-claim btn-small" disabled={busy} onClick={() => onClaim(j.id)}>
                    Teslim al
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {(['refine', 'craft'] as const).map((cat) => (
        <section key={cat} className="panel">
          <h2>{RECIPE_CATEGORY_LABELS[cat]}</h2>
          <div className="offer-grid">
            {data.recipes
              .filter((r) => r.category === cat)
              .map((r) => {
                const b = Math.max(1, Math.min(Math.max(1, r.maxBatches), batches[r.code] ?? 1));
                const reason = r.locked ? `Sv ${r.minLevel} gerekli` : r.maxBatches === 0 ? 'Yetersiz kaynak' : slotsFull ? 'Kuyruk dolu' : null;
                return (
                  <article key={r.code} className="offer recipe" data-testid={`recipe-${r.code}`}>
                    <h3 className="offer-name">{r.name}</h3>
                    <div className="muted small">
                      {fmt(r.output.quantity)} × {r.output.name} · {r.durationSeconds} sn / adet{r.minLevel > 1 ? ` · Sv ${r.minLevel}+` : ''}
                    </div>
                    <ul className="recipe-inputs small">
                      {r.inputs.map((i) => (
                        <li key={i.code} className={i.have >= i.qty * b ? 'ok' : 'missing'}>
                          {fmt(i.qty * b)} {i.name} <span className="muted">(elinde {fmt(i.have)})</span>
                        </li>
                      ))}
                    </ul>
                    <div className="offer-foot">
                      {!reason && r.maxBatches > 1 && (
                        <label className="packs">
                          Adet
                          <input type="number" min={1} max={r.maxBatches} value={b} onChange={(e) => setBatches({ ...batches, [r.code]: Number(e.target.value) || 1 })} />
                        </label>
                      )}
                      {reason ? (
                        <span className="badge badge-muted">{reason}</span>
                      ) : (
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onStart(r, b)}>
                          Üret
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      ))}
    </>
  );
}

// ====================================================================== açık artırma
function AuctionsPanel() {
  const [data, setData] = useState<AuctionsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<number, number>>({});
  const now = useNow(data?.serverTime);
  const load = useCallback(async () => {
    try {
      setData((await api<{ auctions: AuctionsResponse }>('GET', `/market/auctions?server=${SERVER}`)).auctions);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);
  if (!data) return error ? <NoPilot error={error} /> : <p className="muted">Yükleniyor…</p>;
  const bid = async (a: AuctionView) => {
    const amount = Math.max(a.nextMinBid, amounts[a.id] ?? a.nextMinBid);
    setBusy(a.id);
    setNotice(null);
    try {
      const r = await api<{ auctions: AuctionsResponse }>('POST', '/market/auctions/bid', { serverCode: SERVER, auctionId: a.id, amount, requestId: crypto.randomUUID() });
      setData(r.auctions);
      setError(null);
      setNotice(`${a.item.name} için ${money(amount, a.currency)} teklif verdin. Geçilirsen tutar otomatik iade edilir.`);
    } catch (e) {
      setError(e);
      void load();
    } finally {
      setBusy(null);
    }
  };
  const kredi = data.balances.find((b) => b.code === 'KREDI')?.balance ?? 0;
  return (
    <>
      <p className="muted">
        Teklif verdiğinde tutar emanete alınır. Başka biri seni geçerse tutar hemen iade edilir. Son 60 saniyede gelen teklif süreyi 60 saniye uzatır. Bakiyen: <b>{money(kredi, 'KREDI')}</b>
      </p>
      {notice && <Alert kind="success">{notice}</Alert>}
      {error !== null && <ErrorAlert error={error} />}
      {AUCTION_TYPES.map((type) => {
        const list = data.open.filter((a) => a.type === type);
        if (list.length === 0) return null;
        return (
          <section key={type} className="panel" data-testid={`auctions-${type}`}>
            <h2>{AUCTION_TYPE_LABELS[type]} açık artırmalar</h2>
            <div className="offer-grid">
              {list.map((a) => {
                const amount = Math.max(a.nextMinBid, amounts[a.id] ?? a.nextMinBid);
                return (
                  <article key={a.id} className="offer auction" style={{ borderColor: RARITY_COLORS[a.item.rarity] }} data-testid={`auction-${a.item.code}-${a.type}`}>
                    <h3 className="offer-name" style={{ color: RARITY_COLORS[a.item.rarity] }}>
                      {a.item.name}
                      {a.item.quantity > 1 ? <span className="muted"> ×{fmt(a.item.quantity)}</span> : null}
                    </h3>
                    <div className="small">
                      {a.currentBid === null ? `Açılış: ${money(a.minBid, a.currency)}` : `En yüksek teklif: ${money(a.currentBid, a.currency)}`} · {fmt(a.bidCount)} teklif
                    </div>
                    <div className="muted small">Bitiş: {remaining(Date.parse(a.endsAt) - now)}</div>
                    <div className="offer-badges">
                      {a.leading && <span className="badge badge-ok">En yüksek teklif senin</span>}
                      {!a.leading && a.myBid === null && a.bidCount > 0 && <span className="badge badge-muted">Henüz teklifin yok</span>}
                    </div>
                    <div className="offer-foot">
                      <label className="packs">
                        Teklif
                        <input type="number" min={a.nextMinBid} step={100} value={amount} aria-label={`${a.item.name} teklif tutarı`} onChange={(e) => setAmounts({ ...amounts, [a.id]: Number(e.target.value) || a.nextMinBid })} />
                      </label>
                      <button type="button" className="btn btn-secondary" disabled={busy !== null || a.leading} onClick={() => void bid(a)}>
                        {busy === a.id ? 'Gönderiliyor…' : a.leading ? 'Öndesin' : `Teklif ver (en az ${fmt(a.nextMinBid)})`}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {data.history.length > 0 && (
        <section className="panel">
          <h2>Katıldığın sonuçlanan açık artırmalar</h2>
          <ul className="list">
            {data.history.map((a) => (
              <li key={a.id} className="list-item">
                <div>
                  <div className="list-title">
                    {a.item.name} ×{fmt(a.item.quantity)} {a.won ? <span className="badge badge-ok">Kazandın</span> : <span className="badge badge-muted">Kaybettin (iade edildi)</span>}
                  </div>
                  <div className="list-meta">Kazanan teklif: {a.currentBid === null ? '—' : money(a.currentBid, a.currency)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
