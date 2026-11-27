import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Logo } from './ui';

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page page-public">
      <div className="stars" aria-hidden="true" />
      <header className="topbar">
        <Logo />
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
          <NavLink to="/hesap" end>
            Hesabım
          </NavLink>
          <NavLink to="/hesap/guvenlik">Güvenlik</NavLink>
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
