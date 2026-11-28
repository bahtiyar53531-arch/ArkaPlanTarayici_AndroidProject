import { CONTENT_TYPES, type ContentType } from '@turkorbit/shared';
import { useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { errorText } from './api';
import { useAuth } from './auth';
import { Layout } from './Layout';
import { ApprovalsPage } from './pages/Approvals';
import { AuditPage } from './pages/Audit';
import { ClansPage, ClanDetailPage } from './pages/Clans';
import { ContentDetailPage, ContentListPage, QuestCreatePage } from './pages/Content';
import { DashboardPage } from './pages/Dashboard';
import { EconomyPage } from './pages/Economy';
import { ForumAdminPage } from './pages/Forum';
import { PlayerDetailPage, PlayersPage } from './pages/Players';
import { ReportsPage } from './pages/Reports';
import { RolesPage } from './pages/Roles';
import { SystemPage } from './pages/System';
import { Alert } from './ui';

function LoginPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <img src="/yonetim/favicon.svg" alt="" width={48} height={48} />
        <h1>Türk Orbit Yönetim Merkezi</h1>
        <p className="muted">Yalnızca yetkili ekip üyeleri içindir. Tüm işlemler denetim kaydına yazılır.</p>
        {error && <Alert>{error}</Alert>}
        <label className="field">
          <span className="field-label">Kullanıcı adı veya e-posta</span>
          <input autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} data-testid="login-id" />
        </label>
        <label className="field">
          <span className="field-label">Parola</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !identifier || !password} data-testid="login-submit">
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
      </form>
    </div>
  );
}

function ContentRoute({ detail }: { detail?: boolean }) {
  const { type } = useParams();
  if (!type || !(CONTENT_TYPES as readonly string[]).includes(type)) return <Navigate to="/" replace />;
  return detail ? <ContentDetailPage type={type as ContentType} /> : <ContentListPage type={type as ContentType} />;
}

export function App() {
  const { me, loading, can, logout } = useAuth();
  if (loading) return <div className="center muted">Yükleniyor…</div>;
  if (!me) return <LoginPage />;
  // Oturum var ama personel değil: panel hiçbir veri göstermez (sunucu zaten 403 döner)
  if (!can('dashboard.view')) {
    return (
      <div className="login">
        <div className="card login-card" data-testid="not-staff">
          <h1>Yetkin yok</h1>
          <p className="muted">Bu panel yalnızca Türk Orbit ekibi içindir. Oyuncu hesabınla oyuna ana siteden devam edebilirsin.</p>
          <div className="row-actions">
            <a className="btn btn-primary" href="/">
              Siteye dön
            </a>
            <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
              Çıkış yap
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/onaylar" element={<ApprovalsPage />} />
        {can('players.read') && <Route path="/oyuncular" element={<PlayersPage />} />}
        {can('players.read') && <Route path="/oyuncular/:id" element={<PlayerDetailPage />} />}
        {can('chat.reports.read') && <Route path="/sikayetler" element={<ReportsPage />} />}
        {can('economy.grant') && <Route path="/ekonomi" element={<EconomyPage />} />}
        {can('clans.read') && <Route path="/klanlar" element={<ClansPage />} />}
        {can('clans.read') && <Route path="/klanlar/:id" element={<ClanDetailPage />} />}
        {can('quests.write') && <Route path="/icerik/quest/yeni" element={<QuestCreatePage />} />}
        <Route path="/icerik/:type" element={<ContentRoute />} />
        <Route path="/icerik/:type/:id" element={<ContentRoute detail />} />
        {can('forum.read') && <Route path="/forum" element={<ForumAdminPage />} />}
        {can('system.read') && <Route path="/sistem" element={<SystemPage />} />}
        {can('roles.read') && <Route path="/roller" element={<RolesPage />} />}
        {can('audit.read') && <Route path="/denetim" element={<AuditPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
