import {
  ROLES,
  ROLE_LABELS_TR,
  SANCTION_LABELS,
  type AdminPlayerDetail,
  type AdminPlayerSummary,
  type ApprovalView,
  type PermissionKey,
  type RoleKey,
} from '@turkorbit/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ActionDialog, Alert, Badge, Empty, Page, fmt, formatDate, useLoad } from '../ui';

const STATUS: Record<AdminPlayerSummary['status'], { label: string; kind: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  active: { label: 'Etkin', kind: 'ok' },
  suspended: { label: 'Askıda', kind: 'warn' },
  banned: { label: 'Yasaklı', kind: 'danger' },
  deleted: { label: 'Silinmiş', kind: 'muted' },
};

export function PlayersPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading } = useLoad(
    () => (query.length >= 2 ? api<{ players: AdminPlayerSummary[] }>('GET', `/admin/players?q=${encodeURIComponent(query)}`).then((r) => r.players) : Promise.resolve(null)),
    [query],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(q.trim());
  };
  return (
    <Page title="Oyuncu yönetimi">
      <form className="search" onSubmit={submit} role="search">
        <input
          placeholder="Kullanıcı adı, e-posta, pilot adı, oyuncu ID, pilot kimliği veya IP"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="player-search"
        />
        <button type="submit" className="btn btn-primary" disabled={q.trim().length < 2}>
          Ara
        </button>
      </form>
      {error && <Alert>{error}</Alert>}
      {loading && query && <p className="muted">Aranıyor…</p>}
      {data && data.length === 0 && <Empty>Sonuç yok.</Empty>}
      {data && data.length > 0 && (
        <table className="table" data-testid="player-results">
          <thead>
            <tr><th>Kullanıcı</th><th>Oyuncu ID</th><th>Durum</th><th>Roller</th><th>Pilotlar</th><th>Kayıt</th></tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.userId}>
                <td>
                  <Link to={`/oyuncular/${u.userId}`} data-testid={`player-${u.username}`}>{u.username}</Link>
                  <div className="muted small">{u.email}</div>
                </td>
                <td className="mono">{u.publicId}</td>
                <td><Badge kind={STATUS[u.status].kind}>{STATUS[u.status].label}</Badge></td>
                <td className="small">{u.roles.filter((r) => r !== 'player').map((r) => ROLE_LABELS_TR[r]).join(', ') || '—'}</td>
                <td className="small">
                  {u.pilots.map((p) => (
                    <div key={p.id}>
                      {p.online ? '🟢' : '⚪'} {p.server} · {p.name} · Sv {p.level}
                    </div>
                  ))}
                </td>
                <td className="small muted">{formatDate(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}

type Dialog =
  | { kind: 'sanction'; path: 'warn' | 'mute' | 'suspend' | 'ban' | 'lock'; title: string; hours: boolean; danger?: boolean; note?: string }
  | { kind: 'revoke'; path: 'unmute' | 'unban' | 'unlock' | 'sessions/revoke'; title: string }
  | { kind: 'role'; role: RoleKey; grant: boolean };

export function PlayerDetailPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const navigate = useNavigate();
  const { data: p, error, reload } = useLoad(() => api<{ player: AdminPlayerDetail }>('GET', `/admin/players/${id}`).then((r) => r.player), [id]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [roleToAdd, setRoleToAdd] = useState<RoleKey>('moderator');

  const run = async (path: string, body: object, ok: (r: { status?: string; approval?: ApprovalView; revoked?: number }) => string) => {
    const r = await api<{ status?: string; approval?: ApprovalView; revoked?: number }>('POST', `/admin/players/${id}/${path}`, body);
    setDone(ok(r));
    reload();
  };
  const action = (perm: PermissionKey, d: Dialog, label: string, cls = 'btn-secondary') =>
    can(perm) ? (
      <button type="button" className={`btn btn-small ${cls}`} onClick={() => setDialog(d)} data-testid={`act-${'path' in d ? d.path.replace('/', '-') : 'role'}`}>
        {label}
      </button>
    ) : null;

  if (error) return <Page title="Oyuncu"><Alert>{error}</Alert></Page>;
  if (!p) return <Page title="Oyuncu"><p className="muted">Yükleniyor…</p></Page>;
  const self = p.userId === me?.user.id;
  const activeKinds = new Set(p.sanctions.filter((s) => s.active).map((s) => s.kind));
  return (
    <Page title={p.username} actions={<Badge kind={STATUS[p.status].kind}>{STATUS[p.status].label}</Badge>}>
      {done && <Alert kind="success" testId="player-done">{done}</Alert>}
      <div className="grid-2">
        <div className="card">
          <h2>Hesap</h2>
          <dl className="kv">
            <dt>Oyuncu ID</dt><dd className="mono">{p.publicId}</dd>
            <dt>E-posta</dt><dd>{p.email} {p.emailVerified ? <Badge kind="ok">doğrulandı</Badge> : <Badge kind="warn">doğrulanmadı</Badge>}</dd>
            <dt>Kayıt</dt><dd>{formatDate(p.createdAt)}</dd>
            <dt>Roller</dt><dd data-testid="player-roles">{p.roles.map((r) => ROLE_LABELS_TR[r]).join(', ')}</dd>
            {p.suspendedUntil && <><dt>Askı bitişi</dt><dd>{formatDate(p.suspendedUntil)}</dd></>}
            {p.lockedUntil && <><dt>Kilit bitişi</dt><dd>{formatDate(p.lockedUntil)}</dd></>}
            {p.mutedUntil && <><dt>Susturma bitişi</dt><dd data-testid="muted-until">{formatDate(p.mutedUntil)}</dd></>}
            {p.statusReason && <><dt>Oyuncuya gösterilen</dt><dd>{p.statusReason}</dd></>}
          </dl>
          {self ? (
            <Alert kind="info">Kendi hesabına yönetim işlemi uygulayamazsın.</Alert>
          ) : (
            <div className="actions-wrap" data-testid="player-actions">
              {action('players.warn', { kind: 'sanction', path: 'warn', title: 'Uyarı ver', hours: false }, 'Uyar')}
              {!activeKinds.has('mute') && action('chat.moderate', { kind: 'sanction', path: 'mute', title: 'Sustur (sohbet ve forum)', hours: true }, 'Sustur')}
              {activeKinds.has('mute') && action('chat.moderate', { kind: 'revoke', path: 'unmute', title: 'Susturmayı kaldır' }, 'Susturmayı kaldır')}
              {p.status === 'active' && action('players.ban', { kind: 'sanction', path: 'suspend', title: 'Askıya al (geçici ban)', hours: true, danger: true }, 'Askıya al', 'btn-danger')}
              {p.status !== 'banned' &&
                action('players.ban', { kind: 'sanction', path: 'ban', title: 'Kalıcı ban', hours: false, danger: true, note: 'Kalıcı ban ikinci bir yetkilinin onayından sonra uygulanır.' }, 'Kalıcı ban…', 'btn-danger')}
              {(p.status === 'suspended' || p.status === 'banned') && action('players.unban', { kind: 'revoke', path: 'unban', title: 'Askıyı / banı kaldır' }, 'Banı kaldır')}
              {!p.lockedUntil && action('players.lock', { kind: 'sanction', path: 'lock', title: 'Hesabı kilitle', hours: true, danger: true }, 'Kilitle')}
              {p.lockedUntil && action('players.lock', { kind: 'revoke', path: 'unlock', title: 'Kilidi kaldır' }, 'Kilidi kaldır')}
              {action('players.sessions.revoke', { kind: 'revoke', path: 'sessions/revoke', title: 'Tüm oturumları kapat' }, 'Oturumları kapat')}
              {can('economy.grant') && p.pilotDetails.length > 0 && (
                <button type="button" className="btn btn-small btn-secondary" onClick={() => navigate(`/ekonomi?pilot=${p.pilotDetails[0]!.id}`)}>
                  Para / eşya ver
                </button>
              )}
            </div>
          )}
          {can('roles.assign') && !self && (
            <div className="role-edit">
              <h3>Roller</h3>
              <div className="chips">
                {p.roles.filter((r) => r !== 'player').map((r) => (
                  <button key={r} type="button" className="chip" onClick={() => setDialog({ kind: 'role', role: r, grant: false })} title="Rolü kaldır">
                    {ROLE_LABELS_TR[r]} ✕
                  </button>
                ))}
              </div>
              <div className="inline">
                <select value={roleToAdd} onChange={(e) => setRoleToAdd(e.target.value as RoleKey)} data-testid="role-select">
                  {ROLES.filter((r) => r !== 'player' && !p.roles.includes(r)).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS_TR[r]}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-small btn-secondary" onClick={() => setDialog({ kind: 'role', role: roleToAdd, grant: true })} data-testid="role-add">
                  Rol ekle
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="card">
          <h2>Pilotlar</h2>
          {p.pilotDetails.length === 0 && <Empty>Henüz pilot oluşturmamış.</Empty>}
          {p.pilotDetails.map((x) => (
            <div key={x.id} className="pilot-box" data-testid="pilot-box">
              <div><b>{x.server} · {x.name}</b> {x.online ? <Badge kind="ok">Çevrimiçi · {x.map}</Badge> : <Badge>Çevrimdışı</Badge>}</div>
              <div className="small muted">
                {x.company} · Sv {x.level} · {fmt(x.experience)} XP · {fmt(x.honor)} şeref{x.clan ? ` · [${x.clan}]` : ''} · {x.ship ?? 'gemi yok'}
              </div>
              <div className="small">
                {Object.entries(x.wallets).map(([c, b]) => `${fmt(b)} ${c}`).join(' · ')} · {fmt(x.items)} eşya satırı · {fmt(x.activeQuests)} aktif görev
              </div>
              <div className="mono tiny muted">{x.id}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>Yaptırım geçmişi</h2>
        {p.sanctions.length === 0 ? (
          <Empty>Yaptırım yok.</Empty>
        ) : (
          <table className="table" data-testid="sanctions">
            <thead><tr><th>Tür</th><th>Gerekçe</th><th>Veren</th><th>Başlangıç</th><th>Bitiş</th><th>Durum</th></tr></thead>
            <tbody>
              {p.sanctions.map((s) => (
                <tr key={s.id}>
                  <td>{SANCTION_LABELS[s.kind]}</td>
                  <td className="small">{s.reason}{s.publicReason ? <div className="muted">Oyuncuya: {s.publicReason}</div> : null}</td>
                  <td className="small">{s.issuedBy}</td>
                  <td className="small">{formatDate(s.startsAt)}</td>
                  <td className="small">{s.kind === 'warning' ? '—' : s.endsAt ? formatDate(s.endsAt) : 'Kalıcı'}</td>
                  <td>{s.active ? <Badge kind="danger">Etkin</Badge> : s.revokedAt ? <Badge>Kaldırıldı ({s.revokedBy})</Badge> : <Badge>Bitti</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Açık oturumlar</h2>
          {p.sessions.length === 0 ? <Empty>Açık oturum yok.</Empty> : (
            <table className="table"><tbody>
              {p.sessions.map((s) => (
                <tr key={s.id}><td>{s.platform}</td><td className="small">{[s.browser, s.os].filter(Boolean).join(' · ')}</td><td className="mono small">{s.ip}</td><td className="small muted">{formatDate(s.lastSeenAt)}</td></tr>
              ))}
            </tbody></table>
          )}
        </div>
        <div className="card">
          <h2>Son girişler</h2>
          <table className="table"><tbody>
            {p.logins.map((l, i) => (
              <tr key={i}><td>{l.success ? <Badge kind="ok">Başarılı</Badge> : <Badge kind="warn">{l.reason ?? 'Başarısız'}</Badge>}</td><td>{l.platform}</td><td className="mono small">{l.ip}</td><td className="small muted">{formatDate(l.at)}</td></tr>
            ))}
          </tbody></table>
        </div>
      </div>
      {dialog?.kind === 'sanction' && (
        <ActionDialog
          title={`${dialog.title}: ${p.username}`}
          description={dialog.note}
          confirm={dialog.path === 'ban' ? 'Onaya gönder' : 'Uygula'}
          danger={dialog.danger}
          hours={dialog.hours}
          publicReason
          onClose={() => setDialog(null)}
          onSubmit={(v) =>
            run(dialog.path, v, (r) =>
              r.status === 'pending_approval' ? 'Kalıcı ban talebi oluşturuldu; ikinci bir yetkilinin onayı bekleniyor.' : `${dialog.title} uygulandı.`,
            )
          }
        />
      )}
      {dialog?.kind === 'revoke' && (
        <ActionDialog
          title={`${dialog.title}: ${p.username}`}
          confirm="Onayla"
          onClose={() => setDialog(null)}
          onSubmit={(v) => run(dialog.path, v, (r) => (dialog.path === 'sessions/revoke' ? `${r.revoked ?? 0} oturum kapatıldı.` : `${dialog.title}: tamam.`))}
        />
      )}
      {dialog?.kind === 'role' && (
        <ActionDialog
          title={`${dialog.grant ? 'Rol ekle' : 'Rol kaldır'}: ${ROLE_LABELS_TR[dialog.role]}`}
          description={dialog.role === 'super_admin' && dialog.grant ? 'Süper Yönetici ataması ikinci bir yetkilinin onayından sonra uygulanır.' : undefined}
          confirm={dialog.grant ? 'Rolü ver' : 'Rolü kaldır'}
          danger={!dialog.grant}
          onClose={() => setDialog(null)}
          onSubmit={(v) =>
            run('roles', { role: dialog.role, grant: dialog.grant, reason: v.reason }, (r) =>
              r.status === 'pending_approval' ? 'Onay talebi oluşturuldu.' : dialog.grant ? 'Rol verildi.' : 'Rol kaldırıldı.',
            )
          }
        />
      )}
    </Page>
  );
}
