import {
  CONTENT_TYPE_DEFS,
  QUEST_CREATE_OBJECTIVES,
  getPath,
  type ContentDetail,
  type ContentField,
  type ContentListItem,
  type ContentType,
  type RevisionView,
} from '@turkorbit/shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Alert, Badge, Empty, FieldInput, Page, ValueView, formatDate, useLoad } from '../ui';

const COLUMN_LABELS: Record<string, string> = {
  code: 'Kod', name: 'Ad', level: 'Sv', hitpoints: 'Can', shield: 'Kalkan', damage: 'Hasar', base_speed: 'Hız', cargo_capacity: 'Ambar',
  is_for_sale: 'Satışta', title: 'Başlık', category: 'Kategori', currency: 'Para', price: 'Fiyat', discount_percent: 'İndirim %', is_active: 'Satışta',
  min_level: 'Sv', is_published: 'Yayında', pvp_enabled: 'PvP', is_closed: 'Kapalı', key: 'Anahtar',
};
const REV_STATUS: Record<RevisionView['status'], { label: string; kind: 'ok' | 'warn' | 'muted' | 'danger' | 'info' }> = {
  draft: { label: 'Taslak', kind: 'warn' },
  published: { label: 'Yayında', kind: 'ok' },
  superseded: { label: 'Eski sürüm', kind: 'muted' },
  rolled_back: { label: 'Geri alındı', kind: 'danger' },
  discarded: { label: 'Silindi', kind: 'muted' },
};

export function ContentListPage({ type }: { type: ContentType }) {
  const def = CONTENT_TYPE_DEFS[type];
  const { can } = useAuth();
  const { data, error } = useLoad(() => api<{ items: ContentListItem[]; columns: string[] }>('GET', `/admin/content/${type}`), [type]);
  const [filter, setFilter] = useState('');
  const items = useMemo(() => {
    const f = filter.trim().toLocaleLowerCase('tr-TR');
    return (data?.items ?? []).filter((i) => !f || Object.values(i.columns).some((v) => String(v ?? '').toLocaleLowerCase('tr-TR').includes(f)));
  }, [data, filter]);
  return (
    <Page
      title={def.plural}
      actions={type === 'quest' && can('quests.write') ? <Link className="btn btn-primary btn-small" to="/icerik/quest/yeni">Yeni etkinlik görevi</Link> : undefined}
    >
      <p className="muted small">{def.liveNote}</p>
      {error && <Alert>{error}</Alert>}
      <input className="filter" placeholder="Süz…" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="content-filter" />
      {data && (
        <div className="table-wrap">
          <table className="table" data-testid="content-list">
            <thead>
              <tr>
                {data.columns.map((c) => <th key={c}>{COLUMN_LABELS[c] ?? c}</th>)}
                <th>Sürüm</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  {data.columns.map((c, n) => (
                    <td key={c} className={typeof i.columns[c] === 'number' ? 'num' : ''}>
                      {n === 0 || c === 'title' || c === 'name' ? (
                        <Link to={`/icerik/${type}/${encodeURIComponent(i.id)}`} data-testid={n === 0 ? `content-${i.id}` : undefined}>{String(i.columns[c] ?? '—')}</Link>
                      ) : (
                        <ValueView kind="auto" value={i.columns[c]} />
                      )}
                    </td>
                  ))}
                  <td className="small">
                    {i.version ? `v${i.version}` : '—'} {i.draftId && <Badge kind="warn">taslak</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <Empty>Kayıt yok.</Empty>}
        </div>
      )}
    </Page>
  );
}

export function ContentDetailPage({ type }: { type: ContentType }) {
  const { id = '' } = useParams();
  const def = CONTENT_TYPE_DEFS[type];
  const { data: c, error, setData } = useLoad(() => api<{ content: ContentDetail }>('GET', `/admin/content/${type}/${encodeURIComponent(id)}`).then((r) => r.content), [type, id]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Form: taslak varsa taslaktaki, yoksa yayındaki değerlerle dolar
  useEffect(() => {
    if (!c) return;
    const src = c.draft?.data ?? c.current;
    setValues(Object.fromEntries(c.fields.map((f) => [f.key, getPath(src, f.key) ?? null])));
  }, [c]);

  const changes = useMemo(() => {
    if (!c) return {};
    const out: Record<string, unknown> = {};
    for (const f of c.fields) {
      const a = JSON.stringify(getPath(c.current, f.key) ?? null);
      const b = JSON.stringify(values[f.key] ?? null);
      if (a !== b) out[f.key] = values[f.key];
    }
    return out;
  }, [c, values]);

  const call = async (fn: () => Promise<{ content: ContentDetail }>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      setData((await fn()).content);
      setMsg({ kind: 'success', text: ok });
    } catch (e) {
      setMsg({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = (e: FormEvent) => {
    e.preventDefault();
    void call(() => api('POST', `/admin/content/${type}/${encodeURIComponent(id)}/drafts`, { changes, ...(note.trim() ? { note: note.trim() } : {}) }), 'Taslak kaydedildi. Farkı kontrol edip yayımlayabilirsin.');
  };

  if (error) return <Page title={def.label}><Alert>{error}</Alert></Page>;
  if (!c) return <Page title={def.label}><p className="muted">Yükleniyor…</p></Page>;
  return (
    <Page title={c.title} actions={<Link to={`/icerik/${type}`} className="btn btn-ghost btn-small">← {def.plural}</Link>}>
      {c.description && <p className="muted">{c.description}</p>}
      {msg && <Alert kind={msg.kind} testId="content-msg">{msg.text}</Alert>}
      <div className="grid-2">
        <form className="card" onSubmit={saveDraft}>
          <h2>{c.can.write ? 'Düzenle' : 'Değerler'}</h2>
          {c.can.write ? (
            <>
              <div className="form-grid">
                {c.fields.map((f: ContentField) => (
                  <FieldInput key={f.key} f={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                ))}
              </div>
              <label className="field">
                <span className="field-label">Değişiklik notu (denetim kaydına yazılır)</span>
                <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} data-testid="draft-note" />
              </label>
              <button type="submit" className="btn btn-primary" disabled={busy || Object.keys(changes).length === 0} data-testid="draft-save">
                Taslak olarak kaydet ({Object.keys(changes).length} değişiklik)
              </button>
            </>
          ) : (
            <dl className="kv">
              {c.fields.map((f) => (
                <div key={f.key} className="kv-row"><dt>{f.label}</dt><dd><ValueView kind={f.kind} value={getPath(c.current, f.key)} /></dd></div>
              ))}
            </dl>
          )}
        </form>
        <div className="card">
          <h2>Önizleme ve yayın</h2>
          <p className="small muted">{c.liveNote}</p>
          <ul className="impact" data-testid="impact">{c.impact.map((x) => <li key={x}>{x}</li>)}</ul>
          {c.draft ? (
            <div data-testid="draft-box">
              <h3>Taslak v{c.draft.version} — {c.draft.createdBy}, {formatDate(c.draft.createdAt)}</h3>
              <DiffTable diff={c.draft.diff} fields={c.fields} />
              {c.draft.note && <p className="small">Not: {c.draft.note}</p>}
              <div className="row-actions">
                {c.can.publish ? (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void call(() => api('POST', `/admin/content/${type}/revisions/${c.draft!.id}/publish`), 'Yayımlandı. Değişiklik oyuna uygulandı.')} data-testid="publish">
                    Yayınla
                  </button>
                ) : (
                  <span className="small muted">Yayımlama yetkin yok; yetkili bir yönetici yayımlamalı.</span>
                )}
                {c.can.write && (
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void call(() => api('POST', `/admin/content/${type}/revisions/${c.draft!.id}/discard`), 'Taslak silindi.')}>
                    Taslağı sil
                  </button>
                )}
              </div>
            </div>
          ) : (
            <Empty>Bekleyen taslak yok.</Empty>
          )}
        </div>
      </div>
      <div className="card">
        <h2>Sürüm geçmişi</h2>
        {c.revisions.length === 0 ? (
          <Empty>Henüz yayın yapılmadı. İlk taslakta mevcut değerler “sürüm 1 (ilk durum)” olarak kaydedilir.</Empty>
        ) : (
          <table className="table" data-testid="revisions">
            <thead><tr><th>Sürüm</th><th>Durum</th><th>Değişiklik</th><th>Kim / ne zaman</th><th /></tr></thead>
            <tbody>
              {c.revisions.map((r) => (
                <tr key={r.id}>
                  <td>v{r.version}</td>
                  <td><Badge kind={REV_STATUS[r.status].kind}>{REV_STATUS[r.status].label}</Badge></td>
                  <td className="small">
                    {r.diff.length ? r.diff.map((d) => `${d.label}: ${show(d.before)} → ${show(d.after)}`).join(' · ') : r.note ?? '—'}
                    {r.note && r.diff.length > 0 && <div className="muted">{r.note}</div>}
                  </td>
                  <td className="small muted">{r.createdBy} · {formatDate(r.publishedAt ?? r.createdAt)}</td>
                  <td>
                    {c.can.rollback && r.status !== 'published' && (
                      <button type="button" className="btn btn-small btn-secondary" disabled={busy} onClick={() => void call(() => api('POST', `/admin/content/${type}/revisions/${r.id}/rollback`, {}), `Sürüm ${r.version} geri yüklendi ve oyuna uygulandı.`)} data-testid={`rollback-${r.version}`}>
                        Bu sürüme dön
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}

const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'Evet' : 'Hayır') : Array.isArray(v) ? `${v.length} öğe` : typeof v === 'number' ? v.toLocaleString('tr-TR') : String(v));

function DiffTable({ diff, fields }: { diff: ContentDetail['draft'] extends infer R ? (R extends { diff: infer D } ? D : never) : never; fields: ContentField[] }) {
  const kind = (k: string) => fields.find((f) => f.key === k)?.kind ?? 'text';
  return (
    <table className="table diff" data-testid="diff">
      <thead><tr><th>Alan</th><th>Yayındaki</th><th>Yeni</th></tr></thead>
      <tbody>
        {diff.map((d) => (
          <tr key={d.key}>
            <td>{d.label}</td>
            <td className="old"><ValueView kind={kind(d.key)} value={d.before} /></td>
            <td className="new"><ValueView kind={kind(d.key)} value={d.after} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const OBJECTIVE_LABELS: Record<(typeof QUEST_CREATE_OBJECTIVES)[number], string> = {
  kill_npc: 'NPC yok et',
  visit_map: 'Harita ziyaret et',
  collect_cargo: 'Kargo topla',
  deal_damage: 'Hasar ver',
  travel_distance: 'Mesafe kat et',
  jump_portal: 'Geçitten atla',
};

/** Yeni görev yayımlanmadan oluşturulur; ardından düzenleme ekranında "Yayında" açılıp yayımlanır. */
export function QuestCreatePage() {
  const navigate = useNavigate();
  const now = new Date();
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [f, setF] = useState({
    code: '',
    category: 'event' as 'event' | 'main',
    title: '',
    description: '',
    minLevel: 1,
    startsAt: local(now),
    endsAt: local(new Date(now.getTime() + 7 * 86_400_000)),
    type: 'kill_npc' as (typeof QUEST_CREATE_OBJECTIVES)[number],
    target: 10,
    label: '',
    paramKey: 'npc',
    paramValues: '',
    credits: 5000,
    experience: 1000,
    honor: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: typeof s[k] === 'number' ? Number(e.target.value) : e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const values = f.paramValues.split(',').map((x) => x.trim()).filter(Boolean);
    try {
      const r = await api<{ id: number }>('POST', '/admin/quests', {
        code: f.code.trim(),
        category: f.category,
        title: f.title.trim(),
        description: f.description.trim(),
        minLevel: f.minLevel,
        ...(f.category === 'event' ? { startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString() } : {}),
        objective: { type: f.type, target: f.target, label: f.label.trim(), params: values.length ? { [f.paramKey]: values } : {} },
        reward: { credits: f.credits, experience: f.experience, honor: f.honor },
      });
      navigate(`/icerik/quest/${r.id}`);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Page title="Yeni görev">
      <p className="muted">Görev yayımlanmadan oluşturulur ve oyuncular görmez. Sonraki ekranda “Yayında” alanını açıp taslağı yayımladığında görev listelerinde görünür.</p>
      {error && <Alert>{error}</Alert>}
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span className="field-label">Kod (küçük harf, rakam, _)</span><input value={f.code} onChange={set('code')} data-testid="q-code" /></label>
          <label className="field"><span className="field-label">Tür</span>
            <select value={f.category} onChange={set('category')}><option value="event">Etkinlik</option><option value="main">Ana görev</option></select>
          </label>
          <label className="field"><span className="field-label">Başlık</span><input value={f.title} onChange={set('title')} data-testid="q-title" /></label>
          <label className="field"><span className="field-label">En düşük seviye</span><input type="number" min={1} max={50} value={f.minLevel} onChange={set('minLevel')} /></label>
          {f.category === 'event' && (
            <>
              <label className="field"><span className="field-label">Başlangıç</span><input type="datetime-local" value={f.startsAt} onChange={set('startsAt')} /></label>
              <label className="field"><span className="field-label">Bitiş</span><input type="datetime-local" value={f.endsAt} onChange={set('endsAt')} /></label>
            </>
          )}
        </div>
        <label className="field"><span className="field-label">Açıklama</span><textarea rows={3} value={f.description} onChange={set('description')} data-testid="q-desc" /></label>
        <h3>Hedef</h3>
        <div className="form-grid">
          <label className="field"><span className="field-label">Hedef türü</span>
            <select value={f.type} onChange={set('type')} data-testid="q-type">{QUEST_CREATE_OBJECTIVES.map((o) => <option key={o} value={o}>{OBJECTIVE_LABELS[o]}</option>)}</select>
          </label>
          <label className="field"><span className="field-label">Hedef sayısı</span><input type="number" min={1} value={f.target} onChange={set('target')} data-testid="q-target" /></label>
          <label className="field"><span className="field-label">Hedef metni</span><input value={f.label} onChange={set('label')} data-testid="q-label" /></label>
          <label className="field"><span className="field-label">Süzgeç</span>
            <select value={f.paramKey} onChange={set('paramKey')}><option value="npc">NPC kodu</option><option value="maps">Harita kodu</option><option value="family">NPC ailesi</option></select>
          </label>
          <label className="field"><span className="field-label">Değerler (virgülle; boş = hepsi)</span><input value={f.paramValues} onChange={set('paramValues')} placeholder="cakal, akrep" data-testid="q-params" /></label>
        </div>
        <h3>Ödül</h3>
        <div className="form-grid">
          <label className="field"><span className="field-label">Kredi</span><input type="number" min={0} value={f.credits} onChange={set('credits')} /></label>
          <label className="field"><span className="field-label">Deneyim</span><input type="number" min={0} value={f.experience} onChange={set('experience')} /></label>
          <label className="field"><span className="field-label">Şeref</span><input type="number" min={0} value={f.honor} onChange={set('honor')} /></label>
        </div>
        <button type="submit" className="btn btn-primary" data-testid="q-create">Görevi oluştur (yayımlanmaz)</button>
      </form>
    </Page>
  );
}
