import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AccountPage, SecurityPage } from './pages/AccountPages';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './pages/AuthPages';
import { NotFoundPage, PrivacyPage, TermsPage } from './pages/InfoPages';
import { HangarPage, ShopPage } from './pages/HangarPages';
import { PilotPage, PublicPilotPage } from './pages/PilotPages';
import { QuestsPage } from './pages/QuestPages';
import { ClanPage, PublicClanPage } from './pages/ClanPages';
import { SocialPage } from './pages/SocialPages';
import { ForumCategoryPage, ForumIndexPage, ForumSearchPage, ForumThreadPage } from './pages/ForumPages';
import { SupportDeskPage, SupportDeskTicketPage, SupportPage, SupportTicketPage } from './pages/SupportPages';
import { MarketPage } from './pages/MarketPages';

// Oyun ekranı (Phaser dahil) ayrı parça olarak yalnızca /oyna açılınca indirilir.
const GamePage = lazy(() => import('./pages/GamePage').then((m) => ({ default: m.GamePage })));

function Splash() {
  return (
    <div className="splash" role="status">
      <div className="stars" aria-hidden="true" />
      <div className="splash-text">TÜRK ORBIT</div>
      <div className="splash-sub">Bağlanılıyor…</div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Splash />;
  return me ? <>{children}</> : <Navigate to="/giris" replace />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Splash />;
  return me ? <Navigate to="/pilot" replace /> : <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<GuestOnly><LoginPage /></GuestOnly>} />
          <Route path="/giris" element={<GuestOnly><LoginPage /></GuestOnly>} />
          <Route path="/kayit" element={<GuestOnly><RegisterPage /></GuestOnly>} />
          <Route path="/sifremi-unuttum" element={<ForgotPasswordPage />} />
          <Route path="/sifre-sifirla" element={<ResetPasswordPage />} />
          <Route path="/eposta-dogrula" element={<VerifyEmailPage />} />
          <Route path="/kullanim-kosullari" element={<TermsPage />} />
          <Route path="/kvkk" element={<PrivacyPage />} />
          <Route path="/hesap" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route path="/hesap/guvenlik" element={<RequireAuth><SecurityPage /></RequireAuth>} />
          <Route path="/pilot" element={<RequireAuth><PilotPage /></RequireAuth>} />
          <Route path="/pilot/:server/:name" element={<PublicPilotPage />} />
          <Route path="/hangar" element={<RequireAuth><HangarPage /></RequireAuth>} />
          <Route path="/magaza" element={<RequireAuth><ShopPage /></RequireAuth>} />
          <Route path="/gorevler" element={<RequireAuth><QuestsPage /></RequireAuth>} />
          <Route path="/pazar" element={<RequireAuth><MarketPage /></RequireAuth>} />
          <Route path="/klan" element={<RequireAuth><ClanPage /></RequireAuth>} />
          <Route path="/klan/:server/:tag" element={<PublicClanPage />} />
          <Route path="/sosyal" element={<RequireAuth><SocialPage /></RequireAuth>} />
          <Route path="/forum" element={<ForumIndexPage />} />
          <Route path="/forum/ara" element={<ForumSearchPage />} />
          <Route path="/forum/konu/:id" element={<ForumThreadPage />} />
          <Route path="/forum/:slug" element={<ForumCategoryPage />} />
          <Route path="/destek" element={<RequireAuth><SupportPage /></RequireAuth>} />
          <Route path="/destek/masa" element={<RequireAuth><SupportDeskPage /></RequireAuth>} />
          <Route path="/destek/masa/:no" element={<RequireAuth><SupportDeskTicketPage /></RequireAuth>} />
          <Route path="/destek/:no" element={<RequireAuth><SupportTicketPage /></RequireAuth>} />
          <Route path="/oyna" element={<RequireAuth><Suspense fallback={<Splash />}><GamePage /></Suspense></RequireAuth>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
