import type { ReactNode } from 'react';
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
  return me ? <Navigate to="/hesap" replace /> : <>{children}</>;
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
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
