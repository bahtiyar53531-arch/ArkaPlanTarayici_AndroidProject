import type { AdminDashboard } from '@turkorbit/shared';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Badge, Empty, Page, fmt, formatDate, useLoad } from '../ui';

const PLATFORM: Record<string, string> = { web: 'Web', android: 'Android', ios: 'iOS', windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export function DashboardPage() {
  const { can } = useAuth();
  const { data: d, error, reload } = useLoad(() => api<AdminDashboard>('GET', '/admin/dashboard'), []);
  useEffect(() => {
    const t = setInterval(reload, 10_000);
    return () => clearInterval(t);
  }, [reload]);
  return (
    <Page title="Pano" actions={<span className="muted small">10 sn'de bir yenilenir</span>}>
      {error && <Alert>{error}</Alert>}
      {d && (
        <>
          {d.maintenance.enabled && (
            <Alert kind="warn">
              <b>Bakım modu açık.</b> Oyuna yalnızca personel girebilir. Mesaj: “{d.maintenance.message}”
            </Alert>
          )}
          <div className="stats" data-testid="dash-stats">
            <Stat label="Toplam oyuncu" value={d.players.total} />
            <Stat label="Bugün kayıt" value={d.players.registeredToday} />
            <Stat label="Son 7 gün kayıt" value={d.players.registered7d} />
            <Stat label="Pilot" value={d.players.pilots} />
            <Stat label="Çevrimiçi" value={d.players.online} accent testId="dash-online" />
            {d.queues.openTickets !== null && <Stat label="Açık destek talebi" value={d.queues.openTickets} href="/destek/masa" external />}
            {d.queues.openReports !== null && <Stat label="Açık şikâyet" value={d.queues.openReports} href="/sikayetler" />}
            <Stat label="Onayını bekleyen" value={d.queues.pendingApprovals} href="/onaylar" />
          </div>
          <div className="grid-2">
            <div className="card">
              <h2>Oyun sunucuları</h2>
              {d.nodes.length === 0 ? (
                <Empty>Çalışan oyun sunucusu süreci yok (son 15 sn içinde nabız gelmedi).</Empty>
              ) : (
                <table className="table" data-testid="dash-nodes">
                  <thead>
                    <tr><th>Süreç</th><th>Bağlantı</th><th>Pilot</th><th>Harita</th><th>NPC</th><th>Tik</th><th>Bellek</th></tr>
                  </thead>
                  <tbody>
                    {d.nodes.map((n) => (
                      <tr key={n.id}>
                        <td className="mono small">{n.id}</td>
                        <td>{fmt(n.connections)}</td>
                        <td>{fmt(n.players)}</td>
                        <td>{fmt(n.rooms)}</td>
                        <td>{fmt(n.npcs)}</td>
                        <td>{n.tickMs.toLocaleString('tr-TR')} ms</td>
                        <td>{fmt(n.rssMb)} MB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted small">
                API: çalışma {Math.floor(d.api.uptimeSec / 60)} dk · bellek {fmt(d.api.rssMb)} MB · veritabanı {d.api.dbMs} ms · Redis {d.api.redisMs >= 0 ? `${d.api.redisMs} ms` : 'yok'}
              </p>
            </div>
            <div className="card">
              <h2>Haritalardaki pilotlar</h2>
              <table className="table" data-testid="dash-maps">
                <tbody>
                  {d.maps
                    .filter((m) => m.online > 0)
                    .map((m) => (
                      <tr key={m.code}>
                        <td className="mono">{m.code}</td>
                        <td>{m.name}</td>
                        <td className="num">{fmt(m.online)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {d.maps.every((m) => m.online === 0) && <Empty>Şu an oyunda kimse yok.</Empty>}
              <h3>Etkin oturumlar (platform)</h3>
              <div className="chips">
                {d.platforms.map((p) => (
                  <Badge key={p.platform} kind="info">
                    {PLATFORM[p.platform] ?? p.platform}: {fmt(p.sessions)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          {d.recentAudit && can('audit.read') && (
            <div className="card">
              <h2>
                Son yönetici işlemleri <Link to="/denetim" className="small">Tümü →</Link>
              </h2>
              <table className="table">
                <tbody>
                  {d.recentAudit.map((a) => (
                    <tr key={a.id}>
                      <td className="small muted">{formatDate(a.at)}</td>
                      <td>{a.actor}</td>
                      <td className="mono small">{a.action}</td>
                      <td className="small">{a.reason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function Stat({ label, value, accent, href, external, testId }: { label: string; value: number; accent?: boolean; href?: string; external?: boolean; testId?: string }) {
  const body = (
    <>
      <span className="stat-value">{fmt(value)}</span>
      <span className="stat-label">{label}</span>
    </>
  );
  if (href && external) return <a className={`stat${accent ? ' accent' : ''}`} href={href}>{body}</a>;
  if (href) return <Link className={`stat${accent ? ' accent' : ''}`} to={href}>{body}</Link>;
  return <div className={`stat${accent ? ' accent' : ''}`} data-testid={testId}>{body}</div>;
}
