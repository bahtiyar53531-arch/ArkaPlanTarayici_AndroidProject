import { checkPassword } from '@turkorbit/shared';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <Link to="/" className="logo" aria-label="Türk Orbit ana sayfa">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <radialGradient id="logo-planet" cx="38%" cy="35%" r="70%">
            <stop offset="0" stopColor="#ff5a5f" />
            <stop offset="1" stopColor="#b3000d" />
          </radialGradient>
        </defs>
        <ellipse cx="32" cy="33" rx="27" ry="10" fill="none" stroke="#29c5ff" strokeOpacity=".45" strokeWidth="2.5" transform="rotate(-18 32 33)" />
        <circle cx="32" cy="32" r="14" fill="url(#logo-planet)" />
        <circle cx="37.5" cy="29.5" r="11" fill="var(--bg)" />
        <path d="M52.5 21.8l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.9 2 .8-4.3-3.1-3 4.3-.6z" fill="#fff" />
      </svg>
      <span className="logo-text">
        <span className="logo-name">TÜRK ORBIT</span>
        <span className="logo-domain">turkorbit.com</span>
      </span>
    </Link>
  );
}

export function Card({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <h1 className="card-title">{title}</h1>
      {subtitle && <p className="card-subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : 'Beklenmeyen bir hata oluştu.';
  const general = error instanceof ApiError ? error.fields._ : undefined;
  return (
    <Alert kind="error">
      {message}
      {general?.map((m) => (
        <div key={m}>{m}</div>
      ))}
    </Alert>
  );
}

export function fieldErrors(error: unknown, field: string): string[] {
  return error instanceof ApiError ? (error.fields[field] ?? []) : [];
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  errors?: string[];
}

export function Field({ label, hint, errors = [], type = 'text', ...input }: FieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className={`field${errors.length ? ' field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field-control">
        <input
          id={id}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={errors.length > 0}
          aria-describedby={hint || errors.length ? `${id}-desc` : undefined}
          {...input}
        />
        {isPassword && (
          <button
            type="button"
            className="field-toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Parolayı gizle' : 'Parolayı göster'}
          >
            {visible ? 'Gizle' : 'Göster'}
          </button>
        )}
      </div>
      {(hint || errors.length > 0) && (
        <div id={`${id}-desc`} className="field-desc">
          {errors.map((e) => (
            <div key={e} className="field-error">
              {e}
            </div>
          ))}
          {hint && !errors.length && <div className="field-hint">{hint}</div>}
        </div>
      )}
    </div>
  );
}

const STRENGTH = ['Çok zayıf', 'Zayıf', 'Orta', 'Güçlü', 'Çok güçlü'];

export function PasswordStrength({ password, username, email }: { password: string; username?: string; email?: string }) {
  if (!password) return null;
  const r = checkPassword(password, { username, email });
  return (
    <div className="strength" aria-live="polite">
      <div className="strength-bar">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < r.score ? `on s${r.score}` : ''} />
        ))}
      </div>
      <div className="strength-label">Parola gücü: {STRENGTH[r.score]}</div>
      {r.problems.length > 0 && (
        <ul className="strength-problems">
          {r.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
      {busy ? 'Lütfen bekle…' : children}
    </button>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Bağlantıdaki tek kullanımlık anahtarı okur ve adres çubuğundan/geçmişten siler. */
export function takeTokenFromUrl(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (token) {
    url.searchParams.delete('token');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  return token;
}
