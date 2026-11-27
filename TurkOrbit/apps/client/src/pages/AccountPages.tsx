import {
  LOGIN_FAILURE_LABELS_TR,
  PLATFORM_LABELS_TR,
  ROLE_LABELS_TR,
  SUSPICIOUS_REASON_LABELS_TR,
  type LoginHistoryEntry,
  type SessionInfo,
} from '@turkorbit/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AccountLayout } from '../components/Layout';
import { Alert, ErrorAlert, Field, fieldErrors, formatDate, PasswordStrength, SubmitButton } from '../components/ui';

// ====================================================================== Hesabım
export function AccountPage() {
  const { me } = useAuth();
  const [resend, setResend] = useState<{ busy: boolean; message?: string; error?: unknown }>({ busy: false });
  if (!me) return null;
  const u = me.user;

  async function resendVerification() {
    setResend({ busy: true });
    try {
      const r = await api<{ message: string }>('POST', '/auth/resend-verification');
      setResend({ busy: false, message: r.message });
    } catch (error) {
      setResend({ busy: false, error });
    }
  }

  return (
    <AccountLayout>
      <h1 className="page-title">Hoş geldin, {u.username}</h1>
      {!u.emailVerified && (
        <Alert kind="warning">
          <strong>E-posta adresin henüz doğrulanmadı.</strong> Oyun dünyasına girebilmek için {u.email} adresine gönderilen
          bağlantıyı aç.
          <div className="alert-actions">
            <button type="button" className="btn btn-secondary" onClick={resendVerification} disabled={resend.busy}>
              {resend.busy ? 'Gönderiliyor…' : 'Doğrulama e-postasını yeniden gönder'}
            </button>
          </div>
          {resend.message && <div className="alert-note">{resend.message}</div>}
          {resend.error ? <ErrorAlert error={resend.error} /> : null}
        </Alert>
      )}
      <div className="grid">
        <section className="panel">
          <h2>Pilot kimliği</h2>
          <dl className="kv">
            <dt>Pilot adı</dt>
            <dd>{u.username}</dd>
            <dt>Oyuncu ID</dt>
            <dd className="mono">#{u.playerId}</dd>
            <dt>E-posta</dt>
            <dd>
              {u.email}{' '}
              <span className={`badge ${u.emailVerified ? 'badge-ok' : 'badge-warn'}`}>
                {u.emailVerified ? 'Doğrulandı' : 'Doğrulanmadı'}
              </span>
            </dd>
            <dt>Rol</dt>
            <dd>{u.roles.map((r) => ROLE_LABELS_TR[r]).join(', ')}</dd>
            <dt>Kayıt tarihi</dt>
            <dd>{formatDate(u.createdAt)}</dd>
            <dt>Bu oturum</dt>
            <dd>{PLATFORM_LABELS_TR[me.session.platform]}</dd>
          </dl>
        </section>
        <section className="panel">
          <h2>Pilot</h2>
          <p className="muted">
            Oyuncu profilin, şirketin, gemin ve istatistiklerin Pilot sayfasında. Hesabın PC, web, Android ve iOS
            istemcilerinde aynıdır.
          </p>
          <Link className="btn btn-secondary" to="/pilot">Pilot sayfasına git</Link>
        </section>
      </div>
    </AccountLayout>
  );
}

// ====================================================================== Güvenlik
export function SecurityPage() {
  const { me, clear } = useAuth();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [events, setEvents] = useState<LoginHistoryEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        api<{ sessions: SessionInfo[] }>('GET', '/auth/sessions'),
        api<{ events: LoginHistoryEntry[] }>('GET', '/auth/login-history'),
      ]);
      setSessions(s.sessions);
      setEvents(h.events);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    try {
      const r = await api<{ current: boolean }>('DELETE', `/auth/sessions/${id}`);
      if (r.current) return clear();
      setNotice('Oturum kapatıldı.');
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function revokeOthers() {
    try {
      const r = await api<{ revoked: number }>('POST', '/auth/sessions/revoke-others');
      setNotice(`${r.revoked} oturum kapatıldı.`);
      await load();
    } catch (err) {
      setError(err);
    }
  }

  if (!me) return null;
  const others = sessions.filter((s) => !s.current).length;

  return (
    <AccountLayout>
      <h1 className="page-title">Hesap güvenliği</h1>
      <ErrorAlert error={error} />
      {notice && <Alert kind="success">{notice}</Alert>}

      <section className="panel">
        <div className="panel-head">
          <h2>Aktif oturumlar</h2>
          <button type="button" className="btn btn-secondary" onClick={revokeOthers} disabled={others === 0}>
            Diğer tüm oturumları kapat
          </button>
        </div>
        <p className="muted">Hesabının şu an açık olduğu cihazlar. Tanımadığın bir cihaz görürsen oturumu kapat ve parolanı değiştir.</p>
        <ul className="list">
          {sessions.map((s) => (
            <li key={s.id} className="list-item">
              <div>
                <div className="list-title">
                  {PLATFORM_LABELS_TR[s.platform]}
                  {s.deviceName ? ` · ${s.deviceName}` : ''}
                  {s.current && <span className="badge badge-ok">Bu cihaz</span>}
                </div>
                <div className="list-meta">
                  {[s.browser, s.os, s.ipMasked].filter(Boolean).join(' · ')} — son etkinlik {formatDate(s.lastSeenAt)}
                </div>
              </div>
              <button type="button" className="btn btn-danger" onClick={() => revoke(s.id)}>
                {s.current ? 'Çıkış yap' : 'Oturumu kapat'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <ChangePasswordPanel onChanged={load} />

      <section className="panel">
        <h2>Giriş geçmişi</h2>
        <p className="muted">Son 50 giriş denemesi. Şüpheli girişler e-posta ile de bildirilir.</p>
        <ul className="list">
          {events.map((e) => (
            <li key={e.id} className="list-item">
              <div>
                <div className="list-title">
                  <span className={`badge ${e.success ? 'badge-ok' : 'badge-danger'}`}>
                    {e.success ? 'Başarılı' : 'Başarısız'}
                  </span>
                  {e.suspicious && <span className="badge badge-warn">Şüpheli</span>}
                  {PLATFORM_LABELS_TR[e.platform]}
                </div>
                <div className="list-meta">
                  {formatDate(e.createdAt)} — {[e.browser, e.os, e.ipMasked].filter(Boolean).join(' · ')}
                  {!e.success && e.failureReason && ` — ${LOGIN_FAILURE_LABELS_TR[e.failureReason] ?? e.failureReason}`}
                </div>
                {e.suspicious && (
                  <div className="list-meta warn">
                    {e.suspiciousReasons.map((r) => SUSPICIOUS_REASON_LABELS_TR[r] ?? r).join(' · ')}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </AccountLayout>
  );
}

function ChangePasswordPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const { me } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ message: string }>('POST', '/auth/password/change', {
        currentPassword: current,
        newPassword: next,
      });
      setDone(r.message);
      setCurrent('');
      setNext('');
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Parola değiştir</h2>
      <form onSubmit={onSubmit} className="form-narrow" noValidate>
        {done && <Alert kind="success">{done}</Alert>}
        {!fieldErrors(error, 'currentPassword').length && !fieldErrors(error, 'newPassword').length && (
          <ErrorAlert error={error} />
        )}
        <Field
          label="Mevcut parola"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          errors={fieldErrors(error, 'currentPassword')}
        />
        <Field
          label="Yeni parola"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          maxLength={128}
          errors={fieldErrors(error, 'newPassword')}
        />
        <PasswordStrength password={next} username={me?.user.username} email={me?.user.email} />
        <SubmitButton busy={busy}>Parolayı değiştir</SubmitButton>
      </form>
    </section>
  );
}
