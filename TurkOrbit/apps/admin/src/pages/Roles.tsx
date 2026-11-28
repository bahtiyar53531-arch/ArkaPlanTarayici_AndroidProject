import { PERMISSIONS, type RoleMatrixView } from '@turkorbit/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Alert, Page, formatDate, useLoad } from '../ui';

/** Rol → yetki matrisi (veritabanından) ve rol üyeleri. Rol atama oyuncu sayfasından yapılır (roles.assign). */
export function RolesPage() {
  const { data, error } = useLoad(() => api<RoleMatrixView>('GET', '/admin/roles'), []);
  const [role, setRole] = useState<string | null>(null);
  const members = useLoad(
    () => (role ? api<{ members: Array<{ userId: string; username: string; grantedAt: string; grantedBy: string | null; reason: string | null }> }>('GET', `/admin/roles/${role}/members`).then((r) => r.members) : Promise.resolve(null)),
    [role],
  );
  return (
    <Page title="Roller ve yetkiler">
      <p className="muted">
        Yetkiler yalnızca sunucuda, veritabanındaki rol–yetki eşlemesiyle denetlenir. Rol atamak için oyuncunun sayfasını aç. Kimse kendi rütbesine eşit
        veya yüksek bir rolü atayamaz; Süper Yönetici ataması iki yetkili onayı ister.
      </p>
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="table-wrap">
          <table className="table matrix" data-testid="role-matrix">
            <thead>
              <tr>
                <th>Yetki</th>
                {data.roles.map((r) => (
                  <th key={r.key}>
                    <button type="button" className="linklike" onClick={() => setRole(r.key)}>{r.label}</button>
                    <div className="tiny muted">{r.members} kişi · rütbe {r.rank}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td className="mono small">{p}</td>
                  {data.roles.map((r) => <td key={r.key} className="center">{r.permissions.includes(p) ? '✔' : ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {role && members.data && (
        <div className="card">
          <h2>{data?.roles.find((r) => r.key === role)?.label} rolündekiler</h2>
          <table className="table">
            <tbody>
              {members.data.map((m) => (
                <tr key={m.userId}>
                  <td><Link to={`/oyuncular/${m.userId}`}>{m.username}</Link></td>
                  <td className="small">{m.grantedBy ? `veren: ${m.grantedBy}` : 'sunucu aracı'}</td>
                  <td className="small">{m.reason ?? ''}</td>
                  <td className="small muted">{formatDate(m.grantedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
