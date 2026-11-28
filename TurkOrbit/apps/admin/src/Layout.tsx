import type { AdminDashboard, PermissionKey } from '@turkorbit/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { fmt } from './ui';

interface Item {
  to: string;
  label: string;
  perm: PermissionKey;
  /** ana sitedeki sayfa (Yönetim Merkezi dışında) */
  external?: boolean;
}
const GROUPS: Array<{ title: string; items: Item[] }> = [
  { title: 'Genel', items: [{ to: '/', label: 'Pano', perm: 'dashboard.view' }, { to: '/onaylar', label: 'Onay bekleyenler', perm: 'dashboard.view' }] },
  {
    title: 'Oyuncular',
    items: [
      { to: '/oyuncular', label: 'Oyuncu yönetimi', perm: 'players.read' },
      { to: '/sikayetler', label: 'Şikâyetler', perm: 'chat.reports.read' },
      { to: '/ekonomi', label: 'Para / eşya ver', perm: 'economy.grant' },
      { to: '/klanlar', label: 'Klanlar', perm: 'clans.read' },
    ],
  },
  {
    title: 'İçerik',
    items: [
      { to: '/icerik/npc_type', label: 'NPC türleri', perm: 'npcs.read' },
      { to: '/icerik/ship_type', label: 'Gemiler', perm: 'ships.read' },
      { to: '/icerik/shop_offer', label: 'Mağaza', perm: 'economy.read' },
      { to: '/icerik/quest', label: 'Görevler', perm: 'quests.read' },
      { to: '/icerik/map', label: 'Haritalar', perm: 'maps.read' },
    ],
  },
  {
    title: 'Topluluk',
    items: [
      { to: '/forum', label: 'Forum yönetimi', perm: 'forum.read' },
      { to: '/destek/masa', label: 'Destek masası ↗', perm: 'support.read', external: true },
    ],
  },
  {
    title: 'Sistem',
    items: [
      { to: '/sistem', label: 'Sunucular ve bakım', perm: 'system.read' },
      { to: '/icerik/setting', label: 'Oyun ayarları', perm: 'settings.read' },
      { to: '/roller', label: 'Roller ve yetkiler', perm: 'roles.read' },
      { to: '/denetim', label: 'Denetim kaydı', perm: 'audit.read' },
    ],
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Pick<AdminDashboard, 'players' | 'maintenance' | 'nodes' | 'queues'> | null>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!can('dashboard.view')) return;
    let stop = false;
    const load = () =>
      api<AdminDashboard>('GET', '/admin/dashboard')
        .then((d) => !stop && setStatus(d))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [can]);
  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="menu-btn" aria-label="Menü" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="menu-toggle">
          ☰
        </button>
        <div className="brand">
          <img src="/yonetim/favicon.svg" alt="" width={28} height={28} />
          <div>
            <b>TÜRK ORBIT</b>
            <span>Yönetim Merkezi</span>
          </div>
        </div>
        {status && (
          <div className="status" data-testid="status-bar">
            <span title="Çevrimiçi pilot">🟢 {fmt(status.players.online)} çevrimiçi</span>
            <span title="Oyun sunucusu süreçleri" className={status.nodes.length ? '' : 'warn'}>
              🛰 {status.nodes.length} oyun sunucusu
            </span>
            {status.maintenance.enabled && <span className="danger">🔧 Bakım modu açık</span>}
            {status.queues.pendingApprovals > 0 && (
              <NavLink to="/onaylar" className="warn">
                ⏳ {status.queues.pendingApprovals} onay bekliyor
              </NavLink>
            )}
          </div>
        )}
        <div className="who">
          <span data-testid="who">{me?.user.username}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void logout()}>
            Çıkış
          </button>
        </div>
      </header>
      <div className="body">
        <nav className={`side${open ? ' open' : ''}`} aria-label="Yönetim menüsü">
          {GROUPS.map((g) => {
            const items = g.items.filter((i) => can(i.perm));
            if (items.length === 0) return null;
            return (
              <div key={g.title} className="side-group">
                <div className="side-title">{g.title}</div>
                {items.map((i) =>
                  i.external ? (
                    <a key={i.to} href={i.to}>
                      {i.label}
                    </a>
                  ) : (
                    <NavLink key={i.to} to={i.to} end={i.to === '/'}>
                      {i.label}
                    </NavLink>
                  ),
                )}
              </div>
            );
          })}
          <a className="side-back" href="/">
            ← Siteye dön
          </a>
        </nav>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
