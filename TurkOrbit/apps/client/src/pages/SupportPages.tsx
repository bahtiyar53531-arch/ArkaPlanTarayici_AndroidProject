/**
 * Destek (Aşama 13): talep oluşturma (ek dosyalarla), taleplerim, talep sayfası ve personel destek masası.
 * Dosya türü ve boyutu tarayıcıda önceden denetlenir (kullanıcıya hızlı uyarı); asıl denetim sunucudadır.
 */
import {
  ATTACHMENT_LABEL,
  detectFileType,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_STAFF_LABELS,
  SUPPORT_STATUSES,
  type SupportCategory,
  type SupportLimits,
  type SupportMessageView,
  type SupportTicketSummary,
  type SupportTicketView,
} from '@turkorbit/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, attachmentUrl, uploadFile } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AccountLayout } from '../components/Layout';
import { Alert, ErrorAlert, formatDate } from '../components/ui';

const STATUS_BADGE: Record<SupportTicketSummary['status'], string> = {
  waiting_staff: 'badge-info',
  waiting_player: 'badge-warn',
  resolved: 'badge-ok',
  closed: 'badge-muted',
};
const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Seçilen dosyaları önceden denetler: sayı, boyut ve içerikten tür (sunucuyla aynı kural). */
async function checkFiles(files: File[], limits: SupportLimits): Promise<string | null> {
  if (files.length > limits.maxAttachmentsPerMessage) return `Bir mesaja en fazla ${limits.maxAttachmentsPerMessage} dosya eklenebilir.`;
  for (const f of files) {
    if (f.size > limits.maxAttachmentBytes) return `"${f.name}" çok büyük (${sizeText(f.size)}). En fazla ${sizeText(limits.maxAttachmentBytes)}.`;
    const head = new Uint8Array(await f.slice(0, Math.min(f.size, 65536)).arrayBuffer());
    if (!detectFileType(head)) return `"${f.name}" desteklenmeyen bir dosya türü. İzin verilenler: ${ATTACHMENT_LABEL}.`;
  }
  return null;
}

function FilePicker({ limits, files, setFiles }: { limits: SupportLimits | null; files: File[]; setFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="file-picker">
      <input
        ref={ref}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,image/png,image/jpeg,image/webp,application/pdf,text/plain"
        onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 10))}
        aria-label="Dosya ekle"
        data-testid="file-input"
      />
      {limits && (
        <span className="muted small">
          {ATTACHMENT_LABEL} · dosya başına en fazla {sizeText(limits.maxAttachmentBytes)} · en fazla {limits.maxAttachmentsPerMessage} dosya
        </span>
      )}
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {f.name} <span className="muted small">({sizeText(f.size)})</span>{' '}
              <button type="button" className="link-btn" aria-label={`${f.name} dosyasını kaldır`} onClick={() => setFiles(files.filter((_, k) => k !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useLimits() {
  const [limits, setLimits] = useState<SupportLimits | null>(null);
  useEffect(() => {
    api<{ limits: SupportLimits }>('GET', '/support/meta')
      .then((r) => setLimits(r.limits))
      .catch(() => setLimits(null));
  }, []);
  return limits;
}

/** Mesaj gönderildikten sonra dosyaları sırayla yükler; başarısız olanların sebebini döndürür. */
async function uploadAll(base: string, messageId: number, files: File[]): Promise<string[]> {
  const errors: string[] = [];
  for (const f of files) {
    try {
      await uploadFile(`${base}/messages/${messageId}/attachments`, f);
    } catch (e) {
      errors.push(`${f.name}: ${e instanceof ApiError ? e.message : 'yüklenemedi'}`);
    }
  }
  return errors;
}

// ====================================================================== talepler
export function SupportPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const limits = useLimits();
  const [tickets, setTickets] = useState<SupportTicketSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<{ category: SupportCategory; subject: string; body: string }>({ category: 'account', subject: '', body: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ tickets: SupportTicketSummary[] }>('GET', '/support/tickets')
      .then((r) => setTickets(r.tickets))
      .catch(setError);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFileError(null);
    if (limits) {
      const fe = await checkFiles(files, limits);
      if (fe) return setFileError(fe);
    }
    setBusy(true);
    try {
      const r = await api<{ ticket: SupportTicketView; messageId: number }>('POST', '/support/tickets', form);
      const errs = await uploadAll(`/support/tickets/${r.ticket.ticketNo}`, r.messageId, files);
      navigate(`/destek/${r.ticket.ticketNo}`, { state: { created: true, uploadErrors: errs } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const staff = me?.permissions.includes('support.read');
  return (
    <AccountLayout>
      <div className="page-head">
        <h1 className="page-title">Destek</h1>
        {staff && (
          <Link className="btn btn-small btn-secondary" to="/destek/masa">
            Destek masası (personel)
          </Link>
        )}
      </div>
      <p className="muted">
        Hesabına özel sorunlar (giriş, ödeme, kayıp eşya, yaptırım itirazı) için talep oluştur. Genel sorular için <Link to="/forum">Forum</Link>'u kullanabilirsin.
        Ekip senden asla parolanı istemez.
      </p>
      {error ? <ErrorAlert error={error} /> : null}
      <section className="panel" data-testid="ticket-form">
        <h2>Yeni talep</h2>
        <form className="forum-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">Konu türü</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as SupportCategory })} data-testid="ticket-category">
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SUPPORT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Konu</span>
            <input value={form.subject} maxLength={120} minLength={5} required onChange={(e) => setForm({ ...form, subject: e.target.value })} data-testid="ticket-subject" />
          </label>
          <label className="field">
            <span className="field-label">Açıklama</span>
            <textarea value={form.body} rows={6} maxLength={5000} minLength={10} required onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Ne oldu? Ne zaman? Hangi cihazda? Adım adım yaz." data-testid="ticket-body" />
          </label>
          <FilePicker limits={limits} files={files} setFiles={setFiles} />
          {fileError && (
            <p className="field-error" role="alert" data-testid="file-error">
              {fileError}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-auto" disabled={busy} data-testid="ticket-submit">
            {busy ? 'Gönderiliyor…' : 'Talebi gönder'}
          </button>
        </form>
      </section>
      <section className="panel" data-testid="my-tickets">
        <h2>Taleplerim</h2>
        {!tickets ? (
          <p className="muted">Yükleniyor…</p>
        ) : tickets.length === 0 ? (
          <p className="muted">Henüz talebin yok.</p>
        ) : (
          tickets.map((t) => (
            <div key={t.ticketNo} className="app-row">
              <div className="grow">
                <Link to={`/destek/${t.ticketNo}`}>
                  <span className="mono">{t.ticketNo}</span> · {t.subject}
                </Link>
                <div className="muted small">
                  {SUPPORT_CATEGORY_LABELS[t.category]} · son güncelleme {formatDate(t.updatedAt)}
                </div>
              </div>
              <span className={`badge ${STATUS_BADGE[t.status]}`}>{SUPPORT_STATUS_LABELS[t.status]}</span>
            </div>
          ))
        )}
      </section>
    </AccountLayout>
  );
}

function Messages({ messages }: { messages: SupportMessageView[] }) {
  return (
    <section className="support-thread" data-testid="ticket-messages">
      {messages.map((m) => (
        <article key={m.id} className={`panel support-msg${m.isStaff ? ' staff' : ''}${m.internal ? ' internal' : ''}`} data-testid={`msg-${m.id}`}>
          <header className="forum-post-head">
            <span className="forum-author-line">
              <b>{m.author ?? 'Silinmiş hesap'}</b>
              {m.isStaff && <span className="badge badge-warn">{m.internal ? 'İç not (oyuncu görmez)' : 'Ekip'}</span>}
            </span>
            <span className="muted small">{formatDate(m.createdAt)}</span>
          </header>
          <div className="forum-body">{m.body}</div>
          {m.attachments.length > 0 && (
            <ul className="file-list">
              {m.attachments.map((a) => (
                <li key={a.id}>
                  📎{' '}
                  <a href={attachmentUrl(a.id)} download={a.fileName} data-testid={`att-${a.id}`}>
                    {a.fileName}
                  </a>{' '}
                  <span className="muted small">({sizeText(a.sizeBytes)})</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}

function ReplyBox({ limits, onSend, label, extra }: { limits: SupportLimits | null; onSend: (body: string, files: File[]) => Promise<void>; label: string; extra?: React.ReactNode }) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="forum-form panel"
      data-testid="ticket-reply"
      onSubmit={async (e) => {
        e.preventDefault();
        setFileError(null);
        if (limits) {
          const fe = await checkFiles(files, limits);
          if (fe) return setFileError(fe);
        }
        setBusy(true);
        try {
          await onSend(body, files);
          setBody('');
          setFiles([]);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{label}</h2>
      <textarea value={body} rows={5} maxLength={5000} required onChange={(e) => setBody(e.target.value)} aria-label={label} data-testid="reply-text" />
      <FilePicker limits={limits} files={files} setFiles={setFiles} />
      {fileError && (
        <p className="field-error" role="alert" data-testid="file-error">
          {fileError}
        </p>
      )}
      {extra}
      <button type="submit" className="btn btn-primary btn-auto" disabled={busy || !body.trim()} data-testid="reply-send">
        {busy ? 'Gönderiliyor…' : 'Gönder'}
      </button>
    </form>
  );
}

export function SupportTicketPage() {
  const { no = '' } = useParams();
  const limits = useLimits();
  const [t, setT] = useState<SupportTicketView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const location = useLocation();
  const [uploadErrors, setUploadErrors] = useState<string[]>(() => ((location.state as { uploadErrors?: string[] } | null)?.uploadErrors ?? []));
  const load = useCallback(() => {
    api<{ ticket: SupportTicketView }>('GET', `/support/tickets/${encodeURIComponent(no)}`)
      .then((r) => setT(r.ticket))
      .catch(setError);
  }, [no]);
  useEffect(load, [load]);
  if (!t) return <AccountLayout>{error ? <ErrorAlert error={error} /> : <p className="muted">Yükleniyor…</p>}</AccountLayout>;
  return (
    <AccountLayout>
      <nav className="crumbs small">
        <Link to="/destek">Destek</Link> › {t.ticketNo}
      </nav>
      <div className="page-head">
        <h1 className="page-title">{t.subject}</h1>
        <div className="page-head-actions">
          <span className="mono" data-testid="ticket-no">
            {t.ticketNo}
          </span>
          <span className={`badge ${STATUS_BADGE[t.status]}`} data-testid="ticket-status">
            {SUPPORT_STATUS_LABELS[t.status]}
          </span>
          {t.status !== 'closed' && (
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => {
                if (!window.confirm('Talep kapatılsın mı? Kapatılan talebe yazılamaz.')) return;
                void api<{ ticket: SupportTicketView }>('POST', `/support/tickets/${t.ticketNo}/close`).then((r) => setT(r.ticket), setError);
              }}
            >
              Talebi kapat
            </button>
          )}
        </div>
      </div>
      <p className="muted small">
        {SUPPORT_CATEGORY_LABELS[t.category]} · açıldı {formatDate(t.createdAt)}
      </p>
      {error ? <ErrorAlert error={error} /> : null}
      {notice && <Alert kind="success">{notice}</Alert>}
      {uploadErrors.length > 0 && (
        <Alert kind="warning">
          Bazı dosyalar eklenemedi: {uploadErrors.join(' · ')}
          <button type="button" className="link-btn" onClick={() => setUploadErrors([])}>
            {' '}
            Tamam
          </button>
        </Alert>
      )}
      <Messages messages={t.messages} />
      {t.canReply ? (
        <ReplyBox
          limits={limits}
          label="Yanıt yaz"
          onSend={async (body, files) => {
            setError(null);
            try {
              const r = await api<{ ticket: SupportTicketView; messageId: number }>('POST', `/support/tickets/${t.ticketNo}/replies`, { body });
              const errs = await uploadAll(`/support/tickets/${t.ticketNo}`, r.messageId, files);
              setUploadErrors(errs);
              setNotice('Yanıtın gönderildi; ekip en kısa sürede dönecek.');
              load();
            } catch (e) {
              setError(e);
            }
          }}
        />
      ) : (
        <p className="muted" data-testid="ticket-closed">
          {t.replyBlockedReason} <Link to="/destek">Yeni talep oluştur</Link>
        </p>
      )}
    </AccountLayout>
  );
}

// ====================================================================== destek masası (personel)
export function SupportDeskPage() {
  const { me } = useAuth();
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [list, setList] = useState<SupportTicketSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setList(null);
    api<{ tickets: SupportTicketSummary[] }>('GET', `/support/staff/tickets?${status ? `status=${status}&` : ''}${mine ? 'mine=1' : ''}`)
      .then((r) => setList(r.tickets))
      .catch(setError);
  }, [status, mine]);
  if (!me?.permissions.includes('support.read')) {
    return (
      <AccountLayout>
        <Alert kind="error">Bu sayfa yalnızca destek personeli içindir.</Alert>
      </AccountLayout>
    );
  }
  return (
    <AccountLayout>
      <div className="page-head">
        <h1 className="page-title">Destek masası</h1>
        <div className="inline-form">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Durum süzgeci">
            <option value="">Açık talepler</option>
            {SUPPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SUPPORT_STATUS_STAFF_LABELS[s]}
              </option>
            ))}
          </select>
          <label className="perm-grid">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Bana atananlar
          </label>
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <section className="panel" data-testid="desk-queue">
        {!list ? (
          <p className="muted">Yükleniyor…</p>
        ) : list.length === 0 ? (
          <p className="muted">Kuyruk boş.</p>
        ) : (
          list.map((t) => (
            <div key={t.ticketNo} className="app-row">
              <div className="grow">
                <Link to={`/destek/masa/${t.ticketNo}`}>
                  <span className="mono">{t.ticketNo}</span> · {t.subject}
                </Link>
                <div className="muted small">
                  {t.user} · {SUPPORT_CATEGORY_LABELS[t.category]} · {formatDate(t.updatedAt)} · {t.assignedTo ? `atanan: ${t.assignedTo}` : 'atanmamış'}
                </div>
              </div>
              <span className={`badge ${t.priority === 'urgent' || t.priority === 'high' ? 'badge-danger' : 'badge-muted'}`}>{SUPPORT_PRIORITY_LABELS[t.priority]}</span>
              <span className={`badge ${STATUS_BADGE[t.status]}`}>{SUPPORT_STATUS_STAFF_LABELS[t.status]}</span>
            </div>
          ))
        )}
      </section>
    </AccountLayout>
  );
}

export function SupportDeskTicketPage() {
  const { no = '' } = useParams();
  const { me } = useAuth();
  const limits = useLimits();
  const [t, setT] = useState<SupportTicketView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [internal, setInternal] = useState(false);
  const load = useCallback(() => {
    api<{ ticket: SupportTicketView }>('GET', `/support/staff/tickets/${encodeURIComponent(no)}`)
      .then((r) => setT(r.ticket))
      .catch(setError);
  }, [no]);
  useEffect(load, [load]);
  const update = async (body: Record<string, unknown>, ok: string) => {
    try {
      const r = await api<{ ticket: SupportTicketView }>('POST', `/support/staff/tickets/${no}/update`, body);
      setT(r.ticket);
      setNotice(ok);
    } catch (e) {
      setError(e);
    }
  };
  if (!t) return <AccountLayout>{error ? <ErrorAlert error={error} /> : <p className="muted">Yükleniyor…</p>}</AccountLayout>;
  const canReply = me?.permissions.includes('support.reply');
  const canManage = me?.permissions.includes('support.manage');
  return (
    <AccountLayout>
      <nav className="crumbs small">
        <Link to="/destek/masa">Destek masası</Link> › {t.ticketNo}
      </nav>
      <div className="page-head">
        <h1 className="page-title">{t.subject}</h1>
        <span className={`badge ${STATUS_BADGE[t.status]}`} data-testid="desk-status">
          {SUPPORT_STATUS_STAFF_LABELS[t.status]}
        </span>
      </div>
      <p className="muted small">
        <span className="mono">{t.ticketNo}</span> · {t.user} · {SUPPORT_CATEGORY_LABELS[t.category]} · {t.platform ?? 'platform yok'}
        {t.appVersion ? ` ${t.appVersion}` : ''} · atanan: {t.assignedTo ?? '—'}
      </p>
      {error ? <ErrorAlert error={error} /> : null}
      {notice && <Alert kind="success">{notice}</Alert>}
      {canManage && (
        <section className="panel inline-form" data-testid="desk-manage">
          <label className="field">
            <span className="field-label">Durum</span>
            <select value={t.status} onChange={(e) => void update({ status: e.target.value }, 'Durum güncellendi.')} data-testid="desk-status-select">
              {SUPPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUPPORT_STATUS_STAFF_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Öncelik</span>
            <select value={t.priority} onChange={(e) => void update({ priority: e.target.value }, 'Öncelik güncellendi.')}>
              {SUPPORT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {SUPPORT_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-small btn-secondary" onClick={() => void update({ assignToMe: t.assignedTo !== me?.user.username }, 'Atama güncellendi.')}>
            {t.assignedTo === me?.user.username ? 'Atamayı kaldır' : 'Bana ata'}
          </button>
        </section>
      )}
      <Messages messages={t.messages} />
      {canReply && (
        <ReplyBox
          limits={limits}
          label={internal ? 'İç not yaz (oyuncu görmez)' : 'Oyuncuya yanıt yaz'}
          extra={
            <label className="checkbox">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="internal-note" /> İç not (oyuncuya gösterilmez, durum değişmez)
            </label>
          }
          onSend={async (body, files) => {
            setError(null);
            try {
              const r = await api<{ ticket: SupportTicketView; messageId: number }>('POST', `/support/staff/tickets/${t.ticketNo}/replies`, { body, internal });
              const errs = await uploadAll(`/support/staff/tickets/${t.ticketNo}`, r.messageId, files);
              setNotice(errs.length ? `Gönderildi; eklenemeyen dosyalar: ${errs.join(' · ')}` : internal ? 'İç not eklendi.' : 'Yanıt gönderildi; oyuncuya bildirim ve e-posta gitti.');
              load();
            } catch (e) {
              setError(e);
            }
          }}
        />
      )}
    </AccountLayout>
  );
}
