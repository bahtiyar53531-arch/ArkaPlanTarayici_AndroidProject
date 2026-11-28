import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { NotificationBell } from './social/NotificationBell';
import { Logo } from './ui';

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page page-public">
      <div className="stars" aria-hidden="true" />
      <header className="topbar">
        <Logo />
        <nav className="topnav public-nav" aria-label="Site menüsü">
          <NavLink to="/forum">Forum</NavLink>
          <NavLink to="/giris">Giriş</NavLink>
        </nav>
      </header>
      <main className="public-main">{children}</main>
      <Footer />
    </div>
  );
}

export function AccountLayout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="page page-account">
      <div className="stars" aria-hidden="true" />
      <header className="topbar topbar-account">
        <Logo size={36} />
        <nav className="topnav" aria-label="Hesap menüsü">
          <NavLink to="/pilot" end>
            Pilot
          </NavLink>
          <NavLink to="/hangar">Hangar</NavLink>
          <NavLink to="/magaza">Mağaza</NavLink>
          <NavLink to="/pazar">Pazar</NavLink>
          <NavLink to="/gorevler">Görevler</NavLink>
          <NavLink to="/klan">Klan</NavLink>
          <NavLink to="/sosyal">Sosyal</NavLink>
          <NavLink to="/forum">Forum</NavLink>
          <NavLink to="/destek">Destek</NavLink>
          <NavLink to="/oyna" className="nav-play">Oyna</NavLink>
          <NavLink to="/hesap" end>
            Hesabım
          </NavLink>
          <NavLink to="/hesap/guvenlik">Güvenlik</NavLink>
          <NotificationBell />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              await logout();
              navigate('/giris', { replace: true });
            }}
          >
            Çıkış
          </button>
        </nav>
        {me && <span className="topbar-user">{me.user.username}</span>}
      </header>
      <main className="account-main">{children}</main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} Türk Orbit · turkorbit.com</span>
      <NavLink to="/kullanim-kosullari">Kullanım Koşulları</NavLink>
      <NavLink to="/kvkk">KVKK Aydınlatma Metni</NavLink>
    </footer>
  );
}
