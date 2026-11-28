import { REPORT_STATUS_LABELS, REPORT_TARGET_LABELS, type ReportStatus, type ReportView } from '@turkorbit/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Alert, Empty, Page, formatDate, useLoad } from '../ui';

const REASONS: Record<string, string> = { spam: 'Spam', insult: 'Hakaret', cheating: 'Hile', inappropriate_name: 'Uygunsuz ad', scam: 'Dolandırıcılık', other: 'Diğer' };

export function ReportsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<ReportStatus>('open');
  const { data, error, reload } = useLoad(() => api<{ reports: ReportView[] }>('GET', `/admin/reports?status=${status}`).then((r) => r.reports), [status]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const resolve = async (r: ReportView, s: 'in_review' | 'dismissed' | 'actioned') => {
    setMsg(null);
    try {
      await api('POST', `/admin/reports/${r.id}/resolve`, { status: s });
      setMsg({ kind: 'success', text: `Şikâyet #${r.id}: ${REPORT_STATUS_LABELS[s]}.` });
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: errorText(e) });
    }
  };
  return (
    <Page title="Şikâyet kuyruğu">
      <div className="tabs">
        {(['open', 'in_review', 'actioned', 'dismissed'] as const).map((s) => (
          <button key={s} type="button" className={`tab${s === status ? ' active' : ''}`} onClick={() => setStatus(s)}>
            {REPORT_STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <p className="muted small">Yaptırım uygulamak için oyuncunun sayfasını aç: verilen yaptırım şikâyete bağlanır ve şikâyet “işlem yapıldı” olur.</p>
      {error && <Alert>{error}</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {data && data.length === 0 && <Empty>Bu durumda şikâyet yok.</Empty>}
      {data?.map((r) => (
        <div key={r.id} className="card report" data-testid={`report-${r.id}`}>
          <div className="approval-head">
            <b>#{r.id} · {REPORT_TARGET_LABELS[r.targetType] ?? r.targetType} · {REASONS[r.reason] ?? r.reason}</b>
            <span className="small muted">{formatDate(r.createdAt)}</span>
          </div>
          <div className="small">Şikâyet eden: {r.reporter}{r.details ? ` — “${r.details}”` : ''}</div>
          <div className="small">
            Hedef: {r.target.userId ? <Link to={`/oyuncular/${r.target.userId}`}>{r.target.pilot ?? r.target.username}</Link> : '—'}
          </div>
          <pre className="snapshot">{JSON.stringify(r.snapshot, null, 2)}</pre>
          {r.handledBy && <div className="small muted">Ele alan: {r.handledBy}{r.resolutionNote ? ` — ${r.resolutionNote}` : ''}</div>}
          {can('chat.moderate') && (r.status === 'open' || r.status === 'in_review') && (
            <div className="row-actions">
              {r.status === 'open' && <button type="button" className="btn btn-small btn-secondary" onClick={() => void resolve(r, 'in_review')}>İncelemeye al</button>}
              <button type="button" className="btn btn-small btn-ghost" onClick={() => void resolve(r, 'dismissed')} data-testid="report-dismiss">Reddet (ihlal yok)</button>
              {r.target.userId && <Link className="btn btn-small btn-primary" to={`/oyuncular/${r.target.userId}`}>Oyuncuya git</Link>}
            </div>
          )}
        </div>
      ))}
    </Page>
  );
}
