import type { AdminPlayerSummary, ApprovalView } from '@turkorbit/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { Alert, Page, fmt, useLoad } from '../ui';

interface Catalog {
  currencies: Array<{ code: string; name: string }>;
  items: Array<{ code: string; name: string; category: string }>;
  thresholds: { currency: Record<string, number>; item: number };
}

/** Oyuncuya para/eşya verme: gerekçe zorunlu; eşik üstü ikinci yetkilinin onayına gider. */
export function EconomyPage() {
  const [params] = useSearchParams();
  const { data: cat, error } = useLoad(() => api<Catalog>('GET', '/admin/economy/catalog'), []);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<AdminPlayerSummary[]>([]);
  const [pilot, setPilot] = useState<{ id: string; label: string } | null>(null);
  const [kind, setKind] = useState<'currency' | 'item'>('currency');
  const [code, setCode] = useState('KREDI');
  const [amount, setAmount] = useState(1000);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = params.get('pilot');
    if (id) {
      api<{ players: AdminPlayerSummary[] }>('GET', `/admin/players?q=${id}`)
        .then((r) => {
          const p = r.players[0]?.pilots.find((x) => x.id === id);
          if (p) setPilot({ id, label: `${p.server} · ${p.name}` });
        })
        .catch(() => undefined);
    }
  }, [params]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setFound((await api<{ players: AdminPlayerSummary[] }>('GET', `/admin/players?q=${encodeURIComponent(q.trim())}`)).players);
  };
  const threshold = cat ? (kind === 'currency' ? (cat.thresholds.currency[code] ?? 0) : cat.thresholds.item) : 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pilot) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ status: string; approval?: ApprovalView; balance?: number }>('POST', '/admin/economy/grant', { playerId: pilot.id, kind, code, amount, reason: reason.trim() });
      setMsg(
        r.status === 'pending_approval'
          ? { kind: 'warn', text: `Eşik (${fmt(threshold)}) aşıldığı için onay talebi oluşturuldu: ${r.approval!.summary}. Başka bir yetkili onaylayınca uygulanır.` }
          : { kind: 'success', text: `Verildi.${r.balance !== undefined ? ` Yeni bakiye: ${fmt(r.balance)} ${code}.` : ''}` },
      );
      setReason('');
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="Oyuncuya para / eşya ver">
      {error && <Alert>{error}</Alert>}
      <p className="muted">
        Her işlem gerekçeyle denetim kaydına ve oyuncunun defterine (işlemi yapan yönetici kimliğiyle) yazılır. Kendi pilotuna veremezsin. Eşik üstü
        tutarlar ikinci bir yetkilinin onayından sonra uygulanır.
      </p>
      {msg && <Alert kind={msg.kind} testId="grant-msg">{msg.text}</Alert>}
      <div className="card">
        <h2>1. Pilot</h2>
        {pilot ? (
          <div className="inline">
            <b data-testid="grant-pilot">{pilot.label}</b>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPilot(null)}>Değiştir</button>
          </div>
        ) : (
          <>
            <form className="search" onSubmit={search}>
              <input placeholder="Kullanıcı veya pilot adı" value={q} onChange={(e) => setQ(e.target.value)} data-testid="grant-search" />
              <button type="submit" className="btn btn-secondary">Ara</button>
            </form>
            {found.flatMap((u) =>
              u.pilots.map((p) => (
                <button key={p.id} type="button" className="list-pick" onClick={() => setPilot({ id: p.id, label: `${p.server} · ${p.name}` })} data-testid={`pick-${p.name}`}>
                  {p.server} · {p.name} (Sv {p.level}) — {u.username}
                </button>
              )),
            )}
          </>
        )}
      </div>
      {cat && (
        <form className="card" onSubmit={submit}>
          <h2>2. Ne verilecek?</h2>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Tür</span>
              <select value={kind} onChange={(e) => { const k = e.target.value as 'currency' | 'item'; setKind(k); setCode(k === 'currency' ? 'KREDI' : (cat.items[0]?.code ?? '')); }} data-testid="grant-kind">
                <option value="currency">Para</option>
                <option value="item">Eşya</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">{kind === 'currency' ? 'Para birimi' : 'Eşya'}</span>
              <select value={code} onChange={(e) => setCode(e.target.value)} data-testid="grant-code">
                {(kind === 'currency' ? cat.currencies : cat.items).map((x) => (
                  <option key={x.code} value={x.code}>{x.name}{'category' in x ? ` (${x.category})` : ''}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Miktar</span>
              <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} data-testid="grant-amount" />
              <span className={`small ${amount > threshold ? 'warn-text' : 'muted'}`}>Onay eşiği: {fmt(threshold)}{amount > threshold ? ' — bu tutar onaya gider' : ''}</span>
            </label>
          </div>
          <label className="field">
            <span className="field-label">Gerekçe (zorunlu; ör. destek talebi numarası)</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="grant-reason" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!pilot || busy || reason.trim().length < 3 || amount < 1} data-testid="grant-submit">
            {busy ? 'İşleniyor…' : amount > threshold ? 'Onaya gönder' : 'Ver'}
          </button>
        </form>
      )}
    </Page>
  );
}
