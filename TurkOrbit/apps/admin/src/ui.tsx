import type { ContentField } from '@turkorbit/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { errorText } from './api';

export const fmt = (n: number) => n.toLocaleString('tr-TR');
export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Veri yükleme: hata ve yeniden yükleme ile */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => {
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => n === seq.current && setError(errorText(e)))
      .finally(() => n === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => reload(), [reload]);
  return { data, error, loading, reload, setData };
}

export function Alert({ kind = 'error', children, testId }: { kind?: 'error' | 'success' | 'info' | 'warn'; children: ReactNode; testId?: string }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'} data-testid={testId}>
      {children}
    </div>
  );
}

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head">
        <h1>{title}</h1>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Badge({ kind = 'muted', children }: { kind?: 'ok' | 'warn' | 'danger' | 'muted' | 'info'; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

/** Alan değerini türüne göre gösterir */
export function ValueView({ kind, value }: { kind: ContentField['kind'] | 'auto'; value: unknown }) {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  if (kind === 'bool' || typeof value === 'boolean') return value ? <Badge kind="ok">Evet</Badge> : <Badge>Hayır</Badge>;
  if (kind === 'datetime') return <>{formatDate(String(value))}</>;
  if (kind === 'list' || Array.isArray(value)) return <span className="small">{(value as unknown[]).join(', ')}</span>;
  if (typeof value === 'number') return <>{fmt(value)}</>;
  return <>{String(value)}</>;
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
};

/** Alan tanımına göre düzenleme kutusu */
export function FieldInput({ f, value, onChange }: { f: ContentField; value: unknown; onChange: (v: unknown) => void }) {
  const id = `f-${f.key}`;
  let input: ReactNode;
  switch (f.kind) {
    case 'bool':
      input = (
        <select id={id} value={value === true ? '1' : value === false ? '0' : ''} onChange={(e) => onChange(e.target.value === '1')} data-testid={id}>
          <option value="1">Evet</option>
          <option value="0">Hayır</option>
        </select>
      );
      break;
    case 'int':
    case 'number':
      input = (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={f.step ?? (f.kind === 'int' ? 1 : 0.01)}
          min={f.min}
          max={f.max}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          data-testid={id}
        />
      );
      break;
    case 'datetime':
      input = (
        <input
          id={id}
          type="datetime-local"
          value={toLocalInput((value as string | null) ?? null)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          data-testid={id}
        />
      );
      break;
    case 'longtext':
      input = <textarea id={id} rows={4} maxLength={f.maxLength} value={(value as string | null) ?? ''} onChange={(e) => onChange(e.target.value)} data-testid={id} />;
      break;
    case 'list':
      input = (
        <textarea
          id={id}
          rows={6}
          value={Array.isArray(value) ? (value as string[]).join('\n') : ''}
          onChange={(e) => onChange(e.target.value.split('\n'))}
          data-testid={id}
        />
      );
      break;
    default:
      input = (
        <input
          id={id}
          type={f.format === 'https-url' ? 'url' : 'text'}
          inputMode={f.format === 'version' ? 'decimal' : undefined}
          placeholder={f.format === 'version' ? '1.2.3' : f.format === 'https-url' ? 'https://…' : undefined}
          maxLength={f.maxLength}
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          data-testid={id}
        />
      );
  }
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">
        {f.label}
        {f.min !== undefined && f.max !== undefined && (f.kind === 'int' || f.kind === 'number') && (
          <em className="muted small"> ({fmt(f.min)}–{fmt(f.max)})</em>
        )}
      </span>
      {input}
      {f.help && <span className="muted small">{f.help}</span>}
    </label>
  );
}

/**
 * Kritik işlem penceresi: gerekçe zorunlu (denetim kaydına yazılır). İsteğe bağlı süre ve oyuncuya gösterilen metin.
 */
export function ActionDialog(props: {
  title: string;
  description?: ReactNode;
  confirm: string;
  danger?: boolean;
  hours?: boolean;
  publicReason?: boolean;
  reasonLabel?: string;
  minReason?: number;
  onSubmit: (v: { reason: string; hours?: number; publicReason?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(24);
  const [pub, setPub] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const min = props.minReason ?? 3;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit({ reason: reason.trim(), ...(props.hours ? { hours } : {}), ...(props.publicReason && pub.trim() ? { publicReason: pub.trim() } : {}) });
      props.onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-back" role="presentation" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()} data-testid="action-dialog">
        <h2>{props.title}</h2>
        {props.description && <div className="muted">{props.description}</div>}
        {error && <Alert>{error}</Alert>}
        {props.hours && (
          <label className="field">
            <span className="field-label">Süre</span>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} data-testid="dialog-hours">
              {[1, 6, 24, 72, 168, 720].map((h) => (
                <option key={h} value={h}>
                  {h < 24 ? `${h} saat` : `${h / 24} gün`}
                </option>
              ))}
            </select>
          </label>
        )}
        {props.publicReason && (
          <label className="field">
            <span className="field-label">Oyuncuya gösterilecek açıklama (isteğe bağlı)</span>
            <input type="text" maxLength={300} value={pub} onChange={(e) => setPub(e.target.value)} data-testid="dialog-public" />
          </label>
        )}
        <label className="field">
          <span className="field-label">{props.reasonLabel ?? 'Gerekçe (denetim kaydına yazılır)'}</span>
          <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="dialog-reason" />
        </label>
        <div className="row-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Vazgeç
          </button>
          <button type="button" className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || reason.trim().length < min} onClick={submit} data-testid="dialog-confirm">
            {busy ? 'İşleniyor…' : props.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted empty">{children}</p>;
}
