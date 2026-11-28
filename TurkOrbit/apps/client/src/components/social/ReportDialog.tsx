/** Şikâyet penceresi (Aşama 12): oyun içi sohbet ve pilot profilinden açılır. Şikâyet moderasyon kuyruğuna yazılır. */
import { REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason } from '@turkorbit/shared';
import { useState } from 'react';
import { api, ApiError } from '../../api/client';

export interface ReportTarget {
  type: 'player' | 'chat_message' | 'clan';
  /** mesaj kimliği, pilot adı veya klan etiketi */
  id: string;
  /** pencerede gösterilecek açıklama (ör. mesajın kendisi) */
  label: string;
}

export function ReportDialog({ target, onClose, onDone }: { target: ReportTarget; onClose: () => void; onDone: (text: string) => void }) {
  const [reason, setReason] = useState<ReportReason>(target.type === 'chat_message' ? 'insult' : 'other');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/reports', { serverCode: 'TR1', targetType: target.type, target: target.id, reason, ...(details.trim() ? { details: details.trim() } : {}) });
      onDone('Şikâyetin kaydedildi; moderasyon ekibi inceleyecek.');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Şikâyet gönderilemedi.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-label="Şikâyet et" data-testid="report-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Şikâyet et</h2>
        <p className="muted small report-target">{target.label}</p>
        <label className="field">
          <span className="field-label">Sebep</span>
          <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} data-testid="report-reason">
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {REPORT_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Açıklama (isteğe bağlı)</span>
          <textarea value={details} maxLength={500} rows={3} onChange={(e) => setDetails(e.target.value)} />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Vazgeç
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void submit()} data-testid="report-submit">
            {busy ? 'Gönderiliyor…' : 'Şikâyeti gönder'}
          </button>
        </div>
      </div>
    </div>
  );
}
