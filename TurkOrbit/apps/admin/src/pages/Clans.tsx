import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Alert, Empty, Page, fmt, formatDate, useLoad } from '../ui';

interface ClanRow { id: string; tag: string; name: string; server: string; members: number; leader: string | null; treasury: number; createdAt: string }
interface ClanDetail {
  id: string; tag: string; name: string; description: string | null; taxPercent: number; recruiting: boolean; server: string; createdAt: string;
  treasury: Record<string, number>;
  members: Array<{ playerId: string; pilot: string; username: string; userId: string; rank: string; joinedAt: string }>;
  events: Array<{ kind: string; actor: string | null; target: string | null; at: string }>;
}

/** Klanlar (salt okunur). Uygunsuz klan adı veya üye için yaptırım oyuncu sayfasından uygulanır. */
export function ClansPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error } = useLoad(() => api<{ clans: ClanRow[] }>('GET', `/admin/clans?q=${encodeURIComponent(query)}`).then((r) => r.clans), [query]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(q.trim());
  };
  return (
    <Page title="Klanlar">
      <form className="search" onSubmit={submit}>
        <input placeholder="Etiket veya ad" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-secondary">Ara</button>
      </form>
      {error && <Alert>{error}</Alert>}
      {data && data.length === 0 && <Empty>Klan yok.</Empty>}
      {data && data.length > 0 && (
        <table className="table">
          <thead><tr><th>Etiket</th><th>Ad</th><th>Sunucu</th><th>Üye</th><th>Lider</th><th>Hazine (Kredi)</th><th>Kuruluş</th></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/klanlar/${c.id}`}>[{c.tag}]</Link></td>
                <td>{c.name}</td><td>{c.server}</td><td className="num">{c.members}</td><td>{c.leader ?? '—'}</td>
                <td className="num">{fmt(c.treasury)}</td><td className="small muted">{formatDate(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}

export function ClanDetailPage() {
  const { id } = useParams();
  const { data: c, error } = useLoad(() => api<{ clan: ClanDetail }>('GET', `/admin/clans/${id}`).then((r) => r.clan), [id]);
  if (error) return <Page title="Klan"><Alert>{error}</Alert></Page>;
  if (!c) return <Page title="Klan"><p className="muted">Yükleniyor…</p></Page>;
  return (
    <Page title={`[${c.tag}] ${c.name}`} actions={<Link to="/klanlar" className="btn btn-ghost btn-small">← Klanlar</Link>}>
      <div className="card">
        <p>{c.description ?? <span className="muted">Açıklama yok.</span>}</p>
        <p className="small muted">
          {c.server} · vergi %{c.taxPercent} · {c.recruiting ? 'üye alıyor' : 'üye almıyor'} · kuruluş {formatDate(c.createdAt)} · hazine{' '}
          {Object.entries(c.treasury).map(([k, v]) => `${fmt(v)} ${k}`).join(', ') || '0'}
        </p>
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Üyeler ({c.members.length})</h2>
          <table className="table"><tbody>
            {c.members.map((m) => (
              <tr key={m.playerId}><td><Link to={`/oyuncular/${m.userId}`}>{m.pilot}</Link></td><td>{m.rank}</td><td className="small muted">{formatDate(m.joinedAt)}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="card">
          <h2>Son etkinlikler</h2>
          <table className="table"><tbody>
            {c.events.map((e, i) => (
              <tr key={i}><td className="mono small">{e.kind}</td><td className="small">{[e.actor, e.target].filter(Boolean).join(' → ')}</td><td className="small muted">{formatDate(e.at)}</td></tr>
            ))}
          </tbody></table>
        </div>
      </div>
    </Page>
  );
}
