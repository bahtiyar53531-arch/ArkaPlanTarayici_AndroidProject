/**
 * Forum (Aşama 13): oyun hesabıyla ortak. Okuma herkese açık; yazmak için giriş + doğrulanmış e-posta.
 * Mesajlar düz metin olarak gösterilir (HTML yorumlanmaz); satır sonları korunur.
 */
import type { ForumCategoryView, ForumPostView, ForumSearchResult, ForumThreadSummary, ForumThreadView } from '@turkorbit/shared';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AccountLayout, PublicLayout } from '../components/Layout';
import { ReportDialog, type ReportTarget } from '../components/social/ReportDialog';
import { Alert, ErrorAlert, formatDate } from '../components/ui';
import { fmt } from '../lib/format';

function Wrap({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  if (me) return <AccountLayout>{children}</AccountLayout>;
  // Misafir düzeninin ana alanı ortalanmış tek kart içindir; forum tam genişlikte tek sütun akar.
  return (
    <PublicLayout>
      <div className="public-wide">{children}</div>
    </PublicLayout>
  );
}

function SearchBox({ initial = '' }: { initial?: string }) {
  const [q, setQ] = useState(initial);
  const navigate = useNavigate();
  return (
    <form
      className="inline-form forum-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length >= 2) navigate(`/forum/ara?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Forumda ara" aria-label="Forumda ara" maxLength={120} data-testid="forum-search-input" />
      <button type="submit" className="btn btn-small btn-secondary">
        Ara
      </button>
    </form>
  );
}

function Pager({ page, pages, to }: { page: number; pages: number; to: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Sayfalar">
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <Link key={p} to={to(p)} className={`pager-link${p === page ? ' active' : ''}`} aria-current={p === page ? 'page' : undefined}>
          {p}
        </Link>
      ))}
    </nav>
  );
}

// ====================================================================== bölümler
export function ForumIndexPage() {
  const [cats, setCats] = useState<ForumCategoryView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<{ categories: ForumCategoryView[] }>('GET', '/forum/categories')
      .then((r) => setCats(r.categories))
      .catch(setError);
  }, []);
  return (
    <Wrap>
      <div className="page-head">
        <h1 className="page-title">Forum</h1>
        <SearchBox />
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {!cats ? (
        <p className="muted">Yükleniyor…</p>
      ) : (
        <section className="panel forum-cats" data-testid="forum-categories">
          {cats.map((c) => (
            <div key={c.slug} className="forum-cat" data-testid={`forum-cat-${c.slug}`}>
              <div className="grow">
                <Link to={`/forum/${c.slug}`} className="forum-cat-name">
                  {c.name}
                </Link>
                {c.description && <div className="muted small">{c.description}</div>}
              </div>
              <div className="forum-cat-stats muted small">
                {fmt(c.threads)} konu · {fmt(c.posts)} mesaj
              </div>
              <div className="forum-cat-last small">
                {c.last ? (
                  <>
                    <Link to={`/forum/konu/${c.last.threadId}`}>{c.last.title}</Link>
                    <div className="muted">
                      {c.last.by ?? 'Türk Orbit Ekibi'} · {formatDate(c.last.at)}
                    </div>
                  </>
                ) : (
                  <span className="muted">Henüz konu yok</span>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </Wrap>
  );
}

// ====================================================================== bölüm (konu listesi)
interface ThreadList {
  category: { slug: string; name: string; description: string | null; canPost: boolean };
  threads: ForumThreadSummary[];
  page: number;
  pages: number;
  total: number;
}

export function ForumCategoryPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const page = Number(params.get('sayfa')) || 1;
  const { me } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<ThreadList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setData(null);
    api<ThreadList>('GET', `/forum/c/${encodeURIComponent(slug)}?page=${page}`)
      .then(setData)
      .catch(setError);
  }, [slug, page]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: number }>('POST', '/forum/threads', { category: slug, title: form.title, body: form.body });
      navigate(`/forum/konu/${r.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Wrap>
      <nav className="crumbs small">
        <Link to="/forum">Forum</Link> › {data?.category.name ?? '…'}
      </nav>
      <div className="page-head">
        <h1 className="page-title">{data?.category.name ?? 'Forum'}</h1>
        {data?.category.canPost && !form && (
          <button type="button" className="btn btn-primary btn-auto" onClick={() => setForm({ title: '', body: '' })} data-testid="new-thread">
            Yeni konu
          </button>
        )}
      </div>
      {data?.category.description && <p className="muted">{data.category.description}</p>}
      {!me && <Alert kind="info">Konu açmak ve yanıt yazmak için <Link to="/giris">giriş yap</Link>.</Alert>}
      {error ? <ErrorAlert error={error} /> : null}
      {form && (
        <form className="panel forum-form" onSubmit={create} data-testid="thread-form">
          <label className="field">
            <span className="field-label">Başlık</span>
            <input value={form.title} maxLength={140} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={5} data-testid="thread-title" />
          </label>
          <label className="field">
            <span className="field-label">Mesaj</span>
            <textarea value={form.body} maxLength={20000} rows={8} onChange={(e) => setForm({ ...form, body: e.target.value })} required data-testid="thread-body" />
          </label>
          <div className="row-actions">
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="thread-submit">
              {busy ? 'Gönderiliyor…' : 'Konuyu aç'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>
              Vazgeç
            </button>
          </div>
        </form>
      )}
      {!data ? (
        !error && <p className="muted">Yükleniyor…</p>
      ) : (
        <section className="panel" data-testid="thread-list">
          {data.threads.length === 0 && <p className="muted">Bu bölümde henüz konu yok.</p>}
          {data.threads.map((t) => (
            <div key={t.id} className={`forum-thread-row${t.isPinned ? ' pinned' : ''}`}>
              <div className="grow">
                {t.isPinned && <span className="badge badge-info">Sabit</span>} {t.isLocked && <span className="badge badge-muted">🔒 Kilitli</span>}{' '}
                <Link to={`/forum/konu/${t.id}`} className="forum-thread-title">
                  {t.title}
                </Link>
                <div className="muted small">
                  {t.author ?? 'Türk Orbit Ekibi'} · {formatDate(t.createdAt)}
                </div>
              </div>
              <div className="muted small forum-thread-stats">
                {fmt(t.replies)} yanıt · {fmt(t.views)} görüntülenme
              </div>
              <div className="muted small forum-thread-last">
                {t.lastPoster ?? 'Türk Orbit Ekibi'}
                <br />
                {formatDate(t.lastPostAt)}
              </div>
            </div>
          ))}
          <Pager page={data.page} pages={data.pages} to={(p) => `/forum/${slug}?sayfa=${p}`} />
        </section>
      )}
    </Wrap>
  );
}

// ====================================================================== konu
function PostBody({ text }: { text: string }) {
  return <div className="forum-body">{text}</div>;
}

function Author({ a }: { a: ForumPostView['author'] }) {
  return (
    <div className="forum-author">
      <b>{a.username ?? (a.staffRole ? 'Türk Orbit Ekibi' : 'Silinmiş hesap')}</b>
      {a.staffRole && <span className="badge badge-warn">{a.staffRole}</span>}
      {a.pilot && (
        <span className="muted small">
          {a.pilot.clanTag && <span className="clan-tag">[{a.pilot.clanTag}] </span>}
          {a.pilot.company} · Sv {a.pilot.level}
        </span>
      )}
      {a.username && <span className="muted small">{fmt(a.postCount)} mesaj</span>}
    </div>
  );
}

export function ForumThreadPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const page = Number(params.get('sayfa')) || 1;
  const navigate = useNavigate();
  const { me } = useAuth();
  const [t, setT] = useState<ForumThreadView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [quote, setQuote] = useState<ForumPostView | null>(null);
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const load = useCallback(() => {
    api<{ thread: ForumThreadView }>('GET', `/forum/t/${encodeURIComponent(id)}?page=${page}`)
      .then((r) => {
        setT(r.thread);
        setError(null);
      })
      .catch(setError);
  }, [id, page]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const reply = async (e: FormEvent) => {
    e.preventDefault();
    if (!t || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ postId: number; page: number }>('POST', `/forum/t/${t.id}/replies`, { body, ...(quote ? { quotedPostId: quote.id } : {}) });
      setBody('');
      setQuote(null);
      if (r.page !== page) navigate(`/forum/konu/${t.id}?sayfa=${r.page}`);
      else load();
      setNotice('Yanıtın gönderildi.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!t) {
    return <Wrap>{error ? <ErrorAlert error={error} /> : <p className="muted">Yükleniyor…</p>}</Wrap>;
  }
  return (
    <Wrap>
      <nav className="crumbs small">
        <Link to="/forum">Forum</Link> › <Link to={`/forum/${t.category.slug}`}>{t.category.name}</Link>
      </nav>
      <div className="page-head">
        <h1 className="page-title forum-title" data-testid="thread-title-h">
          {t.isLocked && <span title="Kilitli">🔒 </span>}
          {t.title}
        </h1>
        <div className="page-head-actions">
          <span className="muted small">
            {fmt(t.replies)} yanıt · {fmt(t.views)} görüntülenme
          </span>
          {me && (
            <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void act(() => api('POST', `/forum/t/${t.id}/follow`, { on: !t.following }), t.following ? 'Takipten çıktın.' : 'Konuyu takip ediyorsun; yeni yanıtlarda bildirim alacaksın.')} data-testid="follow-btn">
              {t.following ? 'Takipten çık' : 'Takip et'}
            </button>
          )}
          {me && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setReport({ type: 'forum_thread', id: String(t.id), label: `Konu: ${t.title}` })}>
              Konuyu şikâyet et
            </button>
          )}
        </div>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {notice && <Alert kind="success">{notice}</Alert>}
      {t.canModerate && (
        <section className="panel mod-bar" data-testid="mod-bar">
          <b>Moderasyon:</b>
          <button type="button" className="btn btn-small btn-secondary" disabled={busy} onClick={() => void act(() => api('POST', `/forum/t/${t.id}/moderate`, { action: t.isPinned ? 'unpin' : 'pin' }), t.isPinned ? 'Sabitleme kaldırıldı.' : 'Konu sabitlendi.')}>
            {t.isPinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
          </button>
          <button type="button" className="btn btn-small btn-secondary" disabled={busy} onClick={() => void act(() => api('POST', `/forum/t/${t.id}/moderate`, { action: t.isLocked ? 'unlock' : 'lock' }), t.isLocked ? 'Kilit açıldı.' : 'Konu kilitlendi.')} data-testid="mod-lock">
            {t.isLocked ? 'Kilidi aç' : 'Kilitle'}
          </button>
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Taşınacak bölüm">
            <option value="">Bölüme taşı…</option>
            {t.categories
              .filter((c) => c.slug !== t.category.slug)
              .map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
          </select>
          <button type="button" className="btn btn-small btn-secondary" disabled={!moveTo || busy} onClick={() => void act(() => api('POST', `/forum/t/${t.id}/moderate`, { action: 'move', category: moveTo }), 'Konu taşındı.')}>
            Taşı
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt('Silme sebebi (konu sahibine bildirilir):') ?? undefined;
              void act(() => api('POST', `/forum/t/${t.id}/moderate`, { action: 'delete', ...(reason ? { reason } : {}) }), 'Konu silindi (yalnızca moderatörler görebilir).');
            }}
          >
            Konuyu sil
          </button>
        </section>
      )}
      <section className="forum-posts" data-testid="post-list">
        {t.posts.map((p) => (
          <article key={p.id} className={`panel forum-post${p.deleted ? ' deleted' : ''}`} id={`m${p.id}`} data-testid={`post-${p.id}`}>
            <header className="forum-post-head">
              <Author a={p.author} />
              <span className="muted small">
                {formatDate(p.createdAt)}
                {p.editedAt && ' · düzenlendi'}
              </span>
            </header>
            {p.quoted && (
              <blockquote className="forum-quote">
                <div className="muted small">{p.quoted.author ?? 'Bir pilot'} yazdı:</div>
                {p.quoted.excerpt ?? <i className="muted">Alıntılanan mesaj silindi.</i>}
              </blockquote>
            )}
            {p.deleted ? (
              <p className="muted">
                <i>{p.deleted.by === 'author' ? 'Bu mesaj yazarı tarafından silindi.' : `Bu mesaj moderatör tarafından silindi${p.deleted.reason ? `: ${p.deleted.reason}` : '.'}`}</i>
              </p>
            ) : editing?.id === p.id ? (
              <form
                className="forum-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(() => api('PATCH', `/forum/posts/${p.id}`, { body: editing.body }), 'Mesaj düzenlendi.').then(() => setEditing(null));
                }}
              >
                <textarea value={editing.body} rows={6} maxLength={20000} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="Mesajı düzenle" />
                <div className="row-actions">
                  <button type="submit" className="btn btn-small btn-primary" disabled={busy}>
                    Kaydet
                  </button>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing(null)}>
                    Vazgeç
                  </button>
                </div>
              </form>
            ) : (
              <PostBody text={p.body ?? ''} />
            )}
            {!p.deleted && (
              <footer className="forum-post-actions">
                <button
                  type="button"
                  className={`btn btn-small btn-ghost like-btn${p.likedByMe ? ' liked' : ''}`}
                  disabled={!me || busy}
                  aria-pressed={p.likedByMe}
                  onClick={() => void act(() => api('POST', `/forum/posts/${p.id}/like`, { on: !p.likedByMe }))}
                  data-testid={`like-${p.id}`}
                >
                  👍 {fmt(p.likes)}
                </button>
                {t.canReply && (
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    onClick={() => {
                      setQuote(p);
                      document.getElementById('reply-box')?.scrollIntoView({ block: 'center' });
                    }}
                  >
                    Alıntıla
                  </button>
                )}
                {p.canEdit && (
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing({ id: p.id, body: p.body ?? '' })}>
                    Düzenle
                  </button>
                )}
                {p.canDelete && (
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    disabled={busy}
                    onClick={() => {
                      const own = p.author.username === me?.user.username;
                      const reason = own ? undefined : (window.prompt('Silme sebebi (yazara bildirilir):') ?? undefined);
                      if (own && !window.confirm('Mesajın silinsin mi?')) return;
                      void act(() => api('POST', `/forum/posts/${p.id}/delete`, reason ? { reason } : {}), 'Mesaj silindi.');
                    }}
                  >
                    Sil
                  </button>
                )}
                {me && p.author.username !== me.user.username && (
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => setReport({ type: 'forum_post', id: String(p.id), label: `${p.author.username ?? 'Mesaj'}: ${(p.body ?? '').slice(0, 140)}` })} data-testid={`report-${p.id}`}>
                    Şikâyet et
                  </button>
                )}
              </footer>
            )}
          </article>
        ))}
      </section>
      <Pager page={t.page} pages={t.pages} to={(p) => `/forum/konu/${t.id}?sayfa=${p}`} />
      <section className="panel" id="reply-box">
        {t.canReply ? (
          <form className="forum-form" onSubmit={reply} data-testid="reply-form">
            <h2>Yanıt yaz</h2>
            {quote && (
              <blockquote className="forum-quote">
                <div className="muted small">
                  {quote.author.username ?? 'Bir pilot'} alıntılanıyor ·{' '}
                  <button type="button" className="link-btn" onClick={() => setQuote(null)}>
                    kaldır
                  </button>
                </div>
                {(quote.body ?? '').slice(0, 300)}
              </blockquote>
            )}
            <textarea value={body} rows={6} maxLength={20000} onChange={(e) => setBody(e.target.value)} aria-label="Yanıtın" data-testid="reply-body" />
            <button type="submit" className="btn btn-primary btn-auto" disabled={busy || !body.trim()} data-testid="reply-submit">
              {busy ? 'Gönderiliyor…' : 'Yanıtla'}
            </button>
          </form>
        ) : (
          <p className="muted" data-testid="reply-blocked">
            {t.replyBlockedReason}
            {!me && (
              <>
                {' '}
                <Link to="/giris">Giriş yap</Link>
              </>
            )}
          </p>
        )}
      </section>
      {report && (
        <ReportDialog
          target={report}
          onClose={() => setReport(null)}
          onDone={setNotice}
          send={(reason, details) =>
            api('POST', report.type === 'forum_post' ? `/forum/posts/${report.id}/report` : `/forum/t/${report.id}/report`, { reason, ...(details ? { details } : {}) })
          }
        />
      )}
    </Wrap>
  );
}

// ====================================================================== arama
/** [[eşleşen]] işaretleri güvenli biçimde vurgulanır (HTML yorumlanmaz). */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[\[.*?\]\])/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('[[') && p.endsWith(']]') ? (
          <mark key={i}>{p.slice(2, -2)}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

export function ForumSearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const [res, setRes] = useState<ForumSearchResult[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setRes(null);
    setError(null);
    if (q.trim().length < 2) return;
    api<{ results: ForumSearchResult[] }>('GET', `/forum/search?q=${encodeURIComponent(q)}`)
      .then((r) => setRes(r.results))
      .catch(setError);
  }, [q]);
  return (
    <Wrap>
      <nav className="crumbs small">
        <Link to="/forum">Forum</Link> › Arama
      </nav>
      <div className="page-head">
        <h1 className="page-title">Arama</h1>
        <SearchBox initial={q} />
      </div>
      {error instanceof ApiError ? <ErrorAlert error={error} /> : null}
      {res && (
        <section className="panel" data-testid="search-results">
          <p className="muted small">
            “{q}” için {res.length} sonuç
          </p>
          {res.map((r) => (
            <div key={r.threadId} className="forum-thread-row">
              <div className="grow">
                <Link to={`/forum/konu/${r.threadId}`} className="forum-thread-title">
                  {r.title}
                </Link>
                <div className="muted small">
                  {r.category} · {formatDate(r.at)}
                </div>
                <div className="small search-snippet">
                  <Snippet text={r.snippet} />
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
    </Wrap>
  );
}
