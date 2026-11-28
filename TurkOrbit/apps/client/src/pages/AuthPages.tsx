import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PublicLayout } from '../components/Layout';
import { ServerBadge } from './MobilePages';
import {
  Alert,
  Card,
  ErrorAlert,
  Field,
  fieldErrors,
  PasswordStrength,
  SubmitButton,
  takeTokenFromUrl,
} from '../components/ui';

// ====================================================================== Giriş
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
      navigate('/pilot', { replace: true });
    } catch (err) {
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout>
      <Card title="Giriş yap" subtitle="Galaksiye dönüş zamanı, pilot. PC, web, Android ve iOS'ta aynı hesap.">
        <form onSubmit={onSubmit} noValidate>
          <ErrorAlert error={error} />
          <Field
            label="Kullanıcı adı veya e-posta"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            maxLength={254}
            autoFocus
          />
          <Field
            label="Parola"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={128}
          />
          <div className="form-row-end">
            <Link to="/sifremi-unuttum">Şifremi unuttum</Link>
          </div>
          <SubmitButton busy={busy}>Giriş yap</SubmitButton>
        </form>
        <p className="card-footer">
          Hesabın yok mu? <Link to="/kayit">Hemen kayıt ol</Link>
        </p>
        <ServerBadge />
      </Card>
    </PublicLayout>
  );
}

// ====================================================================== Kayıt
export function RegisterPage() {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '', acceptTerms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const confirmError = form.confirm && form.confirm !== form.password ? ['Parolalar eşleşmiyor.'] : [];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError(new ApiError(400, 'VALIDATION_ERROR', 'Parolalar eşleşmiyor.'));
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>('POST', '/auth/register', {
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        acceptTerms: form.acceptTerms,
      });
      setDone(r.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <PublicLayout>
        <Card title="E-postanı kontrol et">
          <Alert kind="success">{done}</Alert>
          <p className="muted">
            E-posta birkaç dakika içinde gelmezse gereksiz (spam) klasörüne bak. Bağlantı 24 saat geçerlidir.
          </p>
          <Link className="btn btn-secondary" to="/giris">
            Giriş sayfasına dön
          </Link>
        </Card>
      </PublicLayout>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === 'acceptTerms' ? e.target.checked : e.target.value }));

  return (
    <PublicLayout>
      <Card title="Pilot kaydı" subtitle="Türk Orbit hesabını oluştur. Tüm cihazlarında aynı karakterle oynarsın.">
        <form onSubmit={onSubmit} noValidate>
          <ErrorAlert error={error} />
          <Field
            label="Kullanıcı adı (pilot adı)"
            autoComplete="username"
            value={form.username}
            onChange={set('username')}
            required
            maxLength={20}
            hint="3-20 karakter; harfle başlar; harf, rakam ve alt çizgi (_) kullanılabilir."
            errors={fieldErrors(error, 'username')}
          />
          <Field
            label="E-posta"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={form.email}
            onChange={set('email')}
            required
            maxLength={254}
            errors={fieldErrors(error, 'email')}
          />
          <Field
            label="Parola"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            required
            maxLength={128}
            errors={fieldErrors(error, 'password')}
          />
          <PasswordStrength password={form.password} username={form.username} email={form.email} />
          <Field
            label="Parola (tekrar)"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set('confirm')}
            required
            maxLength={128}
            errors={confirmError}
          />
          <label className="checkbox">
            <input type="checkbox" checked={form.acceptTerms} onChange={set('acceptTerms')} required />
            <span>
              <Link to="/kullanim-kosullari" target="_blank">
                Kullanım Koşulları
              </Link>
              'nı ve{' '}
              <Link to="/kvkk" target="_blank">
                KVKK Aydınlatma Metni
              </Link>
              'ni okudum, kabul ediyorum.
            </span>
          </label>
          {fieldErrors(error, 'acceptTerms').map((m) => (
            <div key={m} className="field-error">
              {m}
            </div>
          ))}
          <SubmitButton busy={busy}>Kayıt ol</SubmitButton>
        </form>
        <p className="card-footer">
          Zaten hesabın var mı? <Link to="/giris">Giriş yap</Link>
        </p>
      </Card>
    </PublicLayout>
  );
}

// ====================================================================== E-posta doğrulama
export function VerifyEmailPage() {
  const { me, refresh } = useAuth();
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React StrictMode'da iki kez çalışmasın (anahtar tek kullanımlık)
    started.current = true;
    const token = takeTokenFromUrl();
    if (!token) {
      setState('error');
      setMessage('Doğrulama bağlantısı eksik. E-postandaki bağlantıyı yeniden aç.');
      return;
    }
    api<{ message: string }>('POST', '/auth/verify-email', { token })
      .then(async (r) => {
        setState('ok');
        setMessage(r.message);
        await refresh().catch(() => undefined);
      })
      .catch((err) => {
        setState('error');
        setMessage(err instanceof ApiError ? err.message : 'Doğrulama başarısız.');
      });
  }, [refresh]);

  return (
    <PublicLayout>
      <Card title="E-posta doğrulama">
        {state === 'working' && <Alert kind="info">Doğrulanıyor…</Alert>}
        {state === 'ok' && <Alert kind="success">{message}</Alert>}
        {state === 'error' && <Alert kind="error">{message}</Alert>}
        {state !== 'working' && (
          <Link className="btn btn-primary" to={me ? '/pilot' : '/giris'}>
            {me ? 'Pilotunu oluştur' : 'Giriş yap'}
          </Link>
        )}
      </Card>
    </PublicLayout>
  );
}

// ====================================================================== Şifremi unuttum
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>('POST', '/auth/password/forgot', { email: email.trim() });
      setDone(r.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout>
      <Card title="Şifremi unuttum" subtitle="Hesabına kayıtlı e-posta adresini yaz, sana sıfırlama bağlantısı gönderelim.">
        {done ? (
          <>
            <Alert kind="success">{done}</Alert>
            <p className="muted">Bağlantı 30 dakika geçerlidir ve yalnızca bir kez kullanılabilir.</p>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <ErrorAlert error={error} />
            <Field
              label="E-posta"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              errors={fieldErrors(error, 'email')}
            />
            <SubmitButton busy={busy}>Sıfırlama bağlantısı gönder</SubmitButton>
          </form>
        )}
        <p className="card-footer">
          <Link to="/giris">Giriş sayfasına dön</Link>
        </p>
      </Card>
    </PublicLayout>
  );
}

// ====================================================================== Şifre sıfırlama
export function ResetPasswordPage() {
  const { clear } = useAuth();
  const [token] = useState(() => takeTokenFromUrl());
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(new ApiError(400, 'VALIDATION_ERROR', 'Parolalar eşleşmiyor.'));
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>('POST', '/auth/password/reset', { token, newPassword: password });
      clear(); // tüm oturumlar sunucuda kapatıldı
      setDone(r.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout>
      <Card title="Yeni parola belirle">
        {!token ? (
          <Alert kind="error">Sıfırlama bağlantısı eksik veya hatalı. Lütfen yeni bir bağlantı iste.</Alert>
        ) : done ? (
          <>
            <Alert kind="success">{done}</Alert>
            <Link className="btn btn-primary" to="/giris">
              Giriş yap
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <ErrorAlert error={error} />
            <Field
              label="Yeni parola"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={128}
              errors={fieldErrors(error, 'newPassword')}
            />
            <PasswordStrength password={password} />
            <Field
              label="Yeni parola (tekrar)"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              maxLength={128}
              errors={confirm && confirm !== password ? ['Parolalar eşleşmiyor.'] : []}
            />
            <SubmitButton busy={busy}>Parolamı güncelle</SubmitButton>
          </form>
        )}
        <p className="card-footer">
          <Link to="/sifremi-unuttum">Yeni bağlantı iste</Link>
        </p>
      </Card>
    </PublicLayout>
  );
}
