import type { AuditEntryView } from '@turkorbit/shared';
import { Fragment, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Alert, Badge, Empty, Page, formatDate, useLoad } from '../ui';

/** Değiştirilemez yönetici işlem geçmişi (veritabanı tetikleyicisi güncelleme ve silmeyi engeller). */
export function AuditPage() {
  const [f, setF] = useState({ actor: '', action: '', targetId: '' });
  const [q, setQ] = useState(f);
  const [before, setBefore] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const qs = new URLSearchParams({ ...(q.actor ? { actor: q.actor } : {}), ...(q.action ? { action: q.action } : {}), ...(q.targetId ? { targetId: q.targetId } : {}), ...(before ? { before: String(before) } : {}) }).toString();
  const { data, error } = useLoad(() => api<{ entries: AuditEntryView[]; next: number | null }>('GET', `/admin/audit${qs ? `?${qs}` : ''}`), [qs]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBefore(null);
    setQ(f);
  };
  return (
    <Page title="Denetim kaydı">
      <form className="filters" onSubmit={submit}>
        <input placeholder="Yönetici" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} data-testid="audit-actor" />
        <input placeholder="İşlem (ör. player., content.publish)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} data-testid="audit-action" />
        <input placeholder="Hedef kimliği" value={f.targetId} onChange={(e) => setF({ ...f, targetId: e.target.value })} />
        <button type="submit" className="btn btn-secondary">Süz</button>
      </form>
      {error && <Alert>{error}</Alert>}
      {data && data.entries.length === 0 && <Empty>Kayıt yok.</Empty>}
      {data && data.entries.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="audit-list">
            <thead><tr><th>Zaman</th><th>Yönetici</th><th>İşlem</th><th>Hedef</th><th>Gerekçe</th><th>Sonuç</th></tr></thead>
            <tbody>
              {data.entries.map((a) => (
                <Fragment key={a.id}>
                  <tr className="clickable" onClick={() => setOpen(open === a.id ? null : a.id)}>
                    <td className="small">{formatDate(a.at)}</td>
                    <td>{a.actor}</td>
                    <td className="mono small">{a.action}</td>
                    <td className="small">{a.targetType ? `${a.targetType}:${a.targetId ?? ''}` : '—'}</td>
                    <td className="small">{a.reason ?? ''}</td>
                    <td><Badge kind={a.result === 'success' ? 'ok' : a.result === 'failure' ? 'danger' : 'warn'}>{a.result === 'success' ? 'Başarılı' : a.result === 'failure' ? 'Başarısız' : 'Onay bekliyor'}</Badge></td>
                  </tr>
                  {open === a.id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="grid-2">
                          <div><b className="small">Önce</b><pre className="snapshot">{JSON.stringify(a.before, null, 2)}</pre></div>
                          <div><b className="small">Sonra</b><pre className="snapshot">{JSON.stringify(a.after, null, 2)}</pre></div>
                        </div>
                        <span className="small muted">IP: {a.ip ?? '—'}</span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.next && (
        <button type="button" className="btn btn-ghost" onClick={() => setBefore(data.next)}>
          Daha eski kayıtlar →
        </button>
      )}
    </Page>
  );
}
