import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { onUpdateRequired, type UpdateRequiredInfo } from '../api/client';
import { PublicLayout } from '../components/Layout';
import { Alert, Card, Field, SubmitButton } from '../components/ui';
import { APP_VERSION, IS_NATIVE } from '../platform/native';
import { normalizeServerUrl, SERVER_LOCKED, serverOrigin, setServerOverride } from '../platform/server';

/**
 * Aşama 15 — mobil uygulamaya özel ekranlar.
 * Sunucu adresi ekranı YALNIZCA test derlemesinde vardır (VITE_SERVER_URL boş). Mağaza derlemesinde adres sabittir.
 */

const HEALTH_TIMEOUT_MS = 6000;

export function ServerSetupPage() {
  const current = serverOrigin();
  const [value, setValue] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const origin = normalizeServerUrl(value);
    if (!origin) return setError('Geçerli bir adres yaz (ör. http://192.168.1.20:5173).');
    setBusy(true);
    try {
      // Adresi kaydetmeden önce gerçekten Türk Orbit sunucusu mu, uygulama ona ulaşabiliyor mu diye bakılır
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`${origin}/api/v1/health`, { credentials: 'omit', signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      const body = (await res.json().catch(() => null)) as { service?: string; status?: string } | null;
      if (!body?.service?.includes('API')) throw new Error('not-turkorbit');
      setServerOverride(origin);
      // Oturum ve önbellek yeni sunucuyla baştan kurulsun
      window.location.replace('/giris');
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'not-turkorbit'
          ? 'Bu adreste Türk Orbit sunucusu bulunamadı. Adresi ve portu kontrol et.'
          : 'Sunucuya ulaşılamadı. Telefon ile bilgisayar aynı Wi-Fi ağında mı, adres ve port doğru mu? ' +
              'Sunucunun ALLOWED_ORIGINS ayarında uygulamanın kökü (Android: https://localhost, iOS: capacitor://localhost) olmalı.',
      );
      setBusy(false);
    }
  }

  return (
    <PublicLayout>
      <Card title="Sunucu adresi" subtitle="Test derlemesi: uygulamanın bağlanacağı Türk Orbit sunucusunu seç.">
        <form onSubmit={onSubmit} noValidate data-testid="server-form">
          {error && <Alert kind="error">{error}</Alert>}
          <Field
            label="Adres"
            hint="Bilgisayardaki geliştirme sunucusu için: http://<bilgisayarın yerel IP'si>:5173"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="http://192.168.1.20:5173"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="server-url"
            required
          />
          <SubmitButton busy={busy}>Bağlan</SubmitButton>
        </form>
        {current && (
          <p className="card-footer">
            <Link to="/giris">Vazgeç</Link>
          </p>
        )}
        <p className="muted small">Uygulama sürümü {APP_VERSION}</p>
      </Card>
    </PublicLayout>
  );
}

/** Giriş ekranında test derlemesinin bağlı olduğu sunucu (mağaza derlemesinde ve web'de görünmez). */
export function ServerBadge() {
  if (!IS_NATIVE || SERVER_LOCKED) return null;
  return (
    <p className="muted small server-badge" data-testid="server-badge">
      Sunucu: <span className="mono">{serverOrigin()}</span> · <Link to="/sunucu">Değiştir</Link>
    </p>
  );
}

/** Sunucu bu uygulama sürümünü artık desteklemiyorsa (426) tüm uygulamanın üstünde gösterilir. */
export function UpdateRequiredGate() {
  const [info, setInfo] = useState<UpdateRequiredInfo | null>(null);
  useEffect(() => onUpdateRequired(setInfo), []);
  if (!info) return null;
  return (
    <div className="update-gate" role="alertdialog" aria-label="Güncelleme gerekli" data-testid="update-required">
      <div className="update-card">
        <h2>Güncelleme gerekli</h2>
        <p>{info.message}</p>
        <p className="muted small">
          Bu sürüm: {APP_VERSION}
          {info.minVersion ? ` · En düşük desteklenen: ${info.minVersion}` : ''}
        </p>
        <div className="update-actions">
          {info.storeUrl && (
            <button type="button" className="btn btn-primary" onClick={() => (window.location.href = info.storeUrl!)}>
              Mağazada güncelle
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
            Tekrar dene
          </button>
        </div>
      </div>
    </div>
  );
}
