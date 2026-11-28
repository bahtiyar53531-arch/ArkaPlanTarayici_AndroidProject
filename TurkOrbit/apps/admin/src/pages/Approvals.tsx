import { APPROVAL_ACTION_LABELS, type ApprovalView } from '@turkorbit/shared';
import { useState } from 'react';
import { api, errorText } from '../api';
import { Alert, Badge, Empty, Page, formatDate, useLoad } from '../ui';

const STATUS: Record<ApprovalView['status'], { label: string; kind: 'ok' | 'warn' | 'danger' | 'muted' | 'info' }> = {
  pending: { label: 'Bekliyor', kind: 'warn' },
  executed: { label: 'Onaylandı ve uygulandı', kind: 'ok' },
  rejected: { label: 'Reddedildi', kind: 'muted' },
  expired: { label: 'Süresi doldu', kind: 'muted' },
  failed: { label: 'Uygulanamadı', kind: 'danger' },
};

/** İki yetkili onayı: talep eden kendi talebini onaylayamaz (sunucu ve veritabanı da reddeder). */
export function ApprovalsPage() {
  const { data, error, reload } = useLoad(() => api<{ approvals: ApprovalView[] }>('GET', '/admin/approvals').then((r) => r.approvals), []);
  const [note, setNote] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const review = async (a: ApprovalView, approve: boolean) => {
    setMsg(null);
    try {
      const r = await api<{ approval: ApprovalView }>('POST', `/admin/approvals/${a.id}/review`, { approve, ...(note[a.id]?.trim() ? { note: note[a.id]!.trim() } : {}) });
      setMsg({ kind: r.approval.status === 'failed' ? 'error' : 'success', text: `${a.summary}: ${STATUS[r.approval.status].label}.` });
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorText(e) });
    }
  };
  const pending = data?.filter((a) => a.status === 'pending') ?? [];
  const done = data?.filter((a) => a.status !== 'pending') ?? [];
  return (
    <Page title="Onay bekleyen işlemler">
      <p className="muted">
        Kalıcı ban, eşik üstü para/eşya verme ve Süper Yönetici ataması iki yetkili ister: talep eden kendi talebini onaylayamaz. Onaylanan işlem hemen
        uygulanır ve denetim kaydına yazılır.
      </p>
      {error && <Alert>{error}</Alert>}
      {msg && <Alert kind={msg.kind} testId="approval-msg">{msg.text}</Alert>}
      {data && pending.length === 0 && <Empty>Bekleyen talep yok.</Empty>}
      {pending.map((a) => (
        <div key={a.id} className="card approval" data-testid={`approval-${a.id}`}>
          <div className="approval-head">
            <b>{a.summary}</b>
            <Badge kind="info">{APPROVAL_ACTION_LABELS[a.action]}</Badge>
          </div>
          <div className="small">Gerekçe: {a.reason}</div>
          <div className="small muted">
            Talep eden: {a.requestedBy} · {formatDate(a.createdAt)} · son geçerlilik {formatDate(a.expiresAt)}
          </div>
          {a.canReview ? (
            <div className="inline">
              <input placeholder="Not (isteğe bağlı)" value={note[a.id] ?? ''} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} />
              <button type="button" className="btn btn-primary btn-small" onClick={() => void review(a, true)} data-testid="approve">
                Onayla ve uygula
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void review(a, false)} data-testid="reject">
                Reddet
              </button>
            </div>
          ) : (
            <p className="small muted" data-testid="approval-waiting">
              {a.mine ? 'Bu senin talebin; başka bir yetkilinin onayı bekleniyor.' : 'Bu işlemi onaylama yetkin yok.'}
            </p>
          )}
        </div>
      ))}
      {done.length > 0 && (
        <div className="card">
          <h2>Sonuçlananlar</h2>
          <table className="table">
            <tbody>
              {done.map((a) => (
                <tr key={a.id}>
                  <td>{a.summary}</td>
                  <td><Badge kind={STATUS[a.status].kind}>{STATUS[a.status].label}</Badge></td>
                  <td className="small">{a.requestedBy} → {a.reviewedBy ?? '—'}</td>
                  <td className="small muted">{formatDate(a.reviewedAt ?? a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
