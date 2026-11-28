import { useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { ActionDialog, Alert, Badge, Page, useLoad } from '../ui';

interface Category { id: number; slug: string; name: string; description: string | null; sortOrder: number; postPermission: string | null; isArchived: boolean; threads: number; moderators: string[] }

/** Forum bölümleri ve bölüm moderatörleri. Konu moderasyonu (sabitle/kilitle/taşı/sil) forumun kendisinde yapılır. */
export function ForumAdminPage() {
  const { can } = useAuth();
  const { data, error, setData } = useLoad(() => api<{ categories: Category[] }>('GET', '/admin/forum/categories').then((r) => r.categories), []);
  const [edit, setEdit] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [mod, setMod] = useState({ category: '', username: '' });
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const write = can('forum.categories.write');
  const assign = async (e: FormEvent, assignIt: boolean) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api('POST', '/admin/forum/moderators', { category: mod.category, username: mod.username.trim(), assign: assignIt });
      setData((await api<{ categories: Category[] }>('GET', '/admin/forum/categories')).categories);
      setMsg({ kind: 'success', text: assignIt ? 'Bölüm moderatörü atandı.' : 'Bölüm moderatörlüğü kaldırıldı.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    }
  };
  return (
    <Page title="Forum yönetimi" actions={write ? <button type="button" className="btn btn-primary btn-small" onClick={() => setCreating(true)}>Yeni bölüm</button> : undefined}>
      <p className="muted small">Konuları sabitleme, kilitleme, taşıma ve silme forumun konu sayfasındaki moderasyon çubuğundan yapılır; işlemler denetim kaydına yazılır.</p>
      {error && <Alert>{error}</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {data && (
        <table className="table" data-testid="forum-categories">
          <thead><tr><th>Bölüm</th><th>Konu</th><th>Konu açma</th><th>Bölüm moderatörleri</th><th>Durum</th><th /></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td><a href={`/forum/${c.slug}`}>{c.name}</a><div className="small muted">{c.description}</div></td>
                <td className="num">{c.threads}</td>
                <td className="small">{c.postPermission ? 'Yalnızca ekip' : 'Doğrulanmış oyuncular'}</td>
                <td className="small">{c.moderators.join(', ') || '—'}</td>
                <td>{c.isArchived ? <Badge>Arşivde</Badge> : <Badge kind="ok">Açık</Badge>}</td>
                <td>{write && <button type="button" className="btn btn-small btn-ghost" onClick={() => setEdit(c)}>Düzenle</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {can('forum.moderators.assign') && data && (
        <form className="card" onSubmit={(e) => void assign(e, true)}>
          <h2>Bölüm moderatörü</h2>
          <div className="inline">
            <select value={mod.category} onChange={(e) => setMod({ ...mod, category: e.target.value })}>
              <option value="">Bölüm seç</option>
              {data.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
            <input placeholder="Kullanıcı adı" value={mod.username} onChange={(e) => setMod({ ...mod, username: e.target.value })} />
            <button type="submit" className="btn btn-secondary btn-small" disabled={!mod.category || !mod.username.trim()}>Ata</button>
            <button type="button" className="btn btn-ghost btn-small" disabled={!mod.category || !mod.username.trim()} onClick={(e) => void assign(e, false)}>Kaldır</button>
          </div>
        </form>
      )}
      {(edit || creating) && <CategoryDialog cat={edit} onClose={() => { setEdit(null); setCreating(false); }} onSaved={(cats) => { setData(cats); setMsg({ kind: 'success', text: 'Bölüm kaydedildi.' }); }} />}
    </Page>
  );
}

function CategoryDialog({ cat, onClose, onSaved }: { cat: Category | null; onClose: () => void; onSaved: (c: Category[]) => void }) {
  const [v, setV] = useState({ slug: cat?.slug ?? '', name: cat?.name ?? '', description: cat?.description ?? '', sortOrder: cat?.sortOrder ?? 10, staffOnly: !!cat?.postPermission, isArchived: cat?.isArchived ?? false });
  return (
    <ActionDialog
      title={cat ? `Bölümü düzenle: ${cat.name}` : 'Yeni forum bölümü'}
      confirm="Kaydet"
      onClose={onClose}
      description={
        <div className="form-grid">
          {!cat && <label className="field"><span className="field-label">Kısa ad (adres)</span><input value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} /></label>}
          <label className="field"><span className="field-label">Ad</span><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
          <label className="field"><span className="field-label">Açıklama</span><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
          <label className="field"><span className="field-label">Sıra</span><input type="number" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: Number(e.target.value) })} /></label>
          <label className="field"><span className="field-label">Konu açma</span>
            <select value={v.staffOnly ? '1' : '0'} onChange={(e) => setV({ ...v, staffOnly: e.target.value === '1' })}><option value="0">Doğrulanmış oyuncular</option><option value="1">Yalnızca ekip</option></select>
          </label>
          <label className="field"><span className="field-label">Durum</span>
            <select value={v.isArchived ? '1' : '0'} onChange={(e) => setV({ ...v, isArchived: e.target.value === '1' })}><option value="0">Açık</option><option value="1">Arşivde</option></select>
          </label>
        </div>
      }
      onSubmit={async ({ reason }) => {
        const body = { name: v.name.trim(), description: v.description.trim() || null, sortOrder: v.sortOrder, postPermission: v.staffOnly ? 'forum.moderate' : null, isArchived: v.isArchived, reason };
        const r = await api<{ categories: Category[] }>('POST', cat ? `/admin/forum/categories/${cat.id}` : '/admin/forum/categories', cat ? body : { ...body, slug: v.slug.trim() });
        onSaved(r.categories);
      }}
    />
  );
}
