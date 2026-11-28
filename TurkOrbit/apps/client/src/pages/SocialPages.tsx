/**
 * Sosyal (/sosyal) — Aşama 12: arkadaşlar (çevrimiçi durum ve harita, arkadaşın iznine göre), istekler,
 * engellenenler ve gizlilik ayarları (konum paylaşımı, özel mesaj ve davet izinleri).
 */
import { LOCATION_SHARING, LOCATION_SHARING_LABELS, type FriendsResponse, type SocialSettings } from '@turkorbit/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { AccountLayout } from '../components/Layout';
import { Alert, ErrorAlert, formatDate } from '../components/ui';

const SERVER = 'TR1';
type Tab = 'friends' | 'requests' | 'blocked' | 'privacy';

export function SocialPage() {
  const [tab, setTab] = useState<Tab>('friends');
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<FriendsResponse>('GET', `/social/friends?server=${SERVER}`)
      .then(setData)
      .catch(setLoadError);
  }, []);
  useEffect(load, [load]);
  const run = async (method: 'POST' | 'PUT', url: string, body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setData(await api<FriendsResponse>(method, url, { serverCode: SERVER, ...body }));
      setNotice(ok);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'friends', label: `Arkadaşlar${data ? ` (${data.friends.length})` : ''}` },
    { key: 'requests', label: `İstekler${data?.incoming.length ? ` (${data.incoming.length})` : ''}` },
    { key: 'blocked', label: 'Engellenenler' },
    { key: 'privacy', label: 'Gizlilik' },
  ];
  return (
    <AccountLayout>
      <div className="page-head">
        <h1 className="page-title">Sosyal</h1>
      </div>
      {!data ? (
        loadError instanceof ApiError && loadError.code === 'PILOT_NOT_FOUND' ? (
          <Alert kind="info">
            Önce bir pilot oluşturmalısın. <Link to="/pilot">Pilot oluştur</Link>
          </Alert>
        ) : loadError ? (
          <ErrorAlert error={loadError} />
        ) : (
          <p className="muted">Yükleniyor…</p>
        )
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Sosyal bölümleri">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)} data-testid={`social-tab-${t.key}`}>
                {t.label}
              </button>
            ))}
          </div>
          {error ? <ErrorAlert error={error} /> : null}
          {notice && <Alert kind="success">{notice}</Alert>}
          {tab === 'friends' && <Friends data={data} busy={busy} run={run} />}
          {tab === 'requests' && <Requests data={data} busy={busy} run={run} />}
          {tab === 'blocked' && <Blocked data={data} busy={busy} run={run} />}
          {tab === 'privacy' && <Privacy settings={data.settings} busy={busy} run={run} />}
        </>
      )}
    </AccountLayout>
  );
}

type Run = (method: 'POST' | 'PUT', url: string, body: Record<string, unknown>, ok: string) => Promise<void>;

function Friends({ data, busy, run }: { data: FriendsResponse; busy: boolean; run: Run }) {
  const [name, setName] = useState('');
  return (
    <section className="panel" data-testid="friends-panel">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name) void run('POST', '/social/friends/request', { pilotName: name }, `${name} adlı pilota arkadaşlık isteği gönderildi.`).then(() => setName(''));
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20))} placeholder="Pilot adı" aria-label="Arkadaş eklenecek pilot" data-testid="friend-name" />
        <button type="submit" className="btn btn-small btn-secondary" disabled={!name || busy}>
          Arkadaş ekle
        </button>
        <span className="muted small">
          {data.friends.length}/{data.max}
        </span>
      </form>
      {data.friends.length === 0 && <p className="muted">Henüz arkadaşın yok.</p>}
      {data.friends.map((f) => (
        <div key={f.pilotName} className="friend-row" data-testid={`friend-${f.pilotName}`}>
          <span className={`online-dot${f.online ? ' on' : ''}`} title={f.online === null ? 'Durumunu gizliyor' : f.online ? 'Oyunda' : 'Çevrimdışı'} />
          <div className="grow">
            <Link to={`/pilot/${SERVER}/${encodeURIComponent(f.pilotName)}`}>
              {f.clanTag && <span className="clan-tag">[{f.clanTag}] </span>}
              {f.pilotName}
            </Link>{' '}
            <span className="muted small">
              Sv {f.level} · {f.company.code}
            </span>
            <div className="muted small">{f.online === null ? 'Çevrimiçi durumunu gizliyor' : f.online ? `Oyunda · ${f.map ? `${f.map.code} ${f.map.name}` : ''}` : 'Çevrimdışı'}</div>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void run('POST', '/social/friends/remove', { pilotName: f.pilotName }, `${f.pilotName} arkadaş listenden çıkarıldı.`)}>
              Çıkar
            </button>
            <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void run('POST', '/social/block', { pilotName: f.pilotName }, `${f.pilotName} engellendi.`)}>
              Engelle
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Requests({ data, busy, run }: { data: FriendsResponse; busy: boolean; run: Run }) {
  return (
    <section className="panel" data-testid="requests-panel">
      <h2>Gelen istekler</h2>
      {data.incoming.length === 0 && <p className="muted">Bekleyen istek yok.</p>}
      {data.incoming.map((r) => (
        <div key={r.pilotName} className="friend-row">
          <div className="grow">
            <Link to={`/pilot/${SERVER}/${encodeURIComponent(r.pilotName)}`}>{r.pilotName}</Link>{' '}
            <span className="muted small">
              Sv {r.level} · {r.company} · {formatDate(r.createdAt)}
            </span>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void run('POST', '/social/friends/respond', { pilotName: r.pilotName, accept: true }, `${r.pilotName} artık arkadaşın.`)} data-testid={`accept-${r.pilotName}`}>
              Kabul et
            </button>
            <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void run('POST', '/social/friends/respond', { pilotName: r.pilotName, accept: false }, 'İstek reddedildi.')}>
              Reddet
            </button>
          </div>
        </div>
      ))}
      <h2>Gönderdiğin istekler</h2>
      {data.outgoing.length === 0 && <p className="muted">Bekleyen istek yok.</p>}
      {data.outgoing.map((r) => (
        <div key={r.pilotName} className="friend-row">
          <div className="grow">
            {r.pilotName} <span className="muted small">· {formatDate(r.createdAt)}</span>
          </div>
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void run('POST', '/social/friends/remove', { pilotName: r.pilotName }, 'İstek geri çekildi.')}>
            Geri çek
          </button>
        </div>
      ))}
    </section>
  );
}

function Blocked({ data, busy, run }: { data: FriendsResponse; busy: boolean; run: Run }) {
  const [name, setName] = useState('');
  return (
    <section className="panel" data-testid="blocked-panel">
      <p className="muted small">Engellediğin pilotun sohbet mesajları sana iletilmez; sana özel mesaj, arkadaşlık isteği, grup veya klan daveti gönderemez.</p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name) void run('POST', '/social/block', { pilotName: name }, `${name} engellendi.`).then(() => setName(''));
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20))} placeholder="Pilot adı" aria-label="Engellenecek pilot" />
        <button type="submit" className="btn btn-small btn-danger" disabled={!name || busy}>
          Engelle
        </button>
      </form>
      {data.blocked.length === 0 && <p className="muted">Engellediğin pilot yok.</p>}
      {data.blocked.map((b) => (
        <div key={b.pilotName} className="friend-row">
          <div className="grow">
            {b.pilotName} <span className="muted small">· {formatDate(b.createdAt)}</span>
          </div>
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void run('POST', '/social/unblock', { pilotName: b.pilotName }, `${b.pilotName} adlı pilotun engeli kaldırıldı.`)}>
            Engeli kaldır
          </button>
        </div>
      ))}
    </section>
  );
}

function Privacy({ settings, busy, run }: { settings: SocialSettings; busy: boolean; run: Run }) {
  const [s, setS] = useState(settings);
  return (
    <section className="panel" data-testid="privacy-panel">
      <form
        className="privacy-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run('PUT', '/social/settings', { ...s }, 'Gizlilik ayarların kaydedildi.');
        }}
      >
        <label className="field">
          <span className="field-label">Grup üyeleri konumumu</span>
          <select value={s.locationSharing} onChange={(e) => setS({ ...s, locationSharing: e.target.value as SocialSettings['locationSharing'] })} data-testid="privacy-location">
            {LOCATION_SHARING.map((l) => (
              <option key={l} value={l}>
                {LOCATION_SHARING_LABELS[l]} görsün
              </option>
            ))}
          </select>
          <span className="muted small">Farklı haritadayken grup panelinde ne görüneceğini belirler.</span>
        </label>
        <label className="field">
          <span className="field-label">Özel mesajları</span>
          <select value={s.dmPolicy} onChange={(e) => setS({ ...s, dmPolicy: e.target.value as SocialSettings['dmPolicy'] })}>
            <option value="everyone">Herkesten al</option>
            <option value="friends">Yalnızca arkadaşlarımdan al</option>
            <option value="nobody">Kimseden alma</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Grup davetlerini</span>
          <select value={s.groupInvites} onChange={(e) => setS({ ...s, groupInvites: e.target.value as SocialSettings['groupInvites'] })}>
            <option value="everyone">Herkesten al</option>
            <option value="friends_clan">Yalnızca arkadaşlarımdan ve klanımdan al</option>
            <option value="nobody">Kimseden alma</option>
          </select>
        </label>
        <label className="perm-grid">
          <input type="checkbox" checked={s.friendsSeeOnline} onChange={(e) => setS({ ...s, friendsSeeOnline: e.target.checked })} /> Arkadaşlarım çevrimiçi olduğumu ve bulunduğum haritayı görebilsin
        </label>
        <label className="perm-grid">
          <input type="checkbox" checked={s.friendRequests} onChange={(e) => setS({ ...s, friendRequests: e.target.checked })} /> Arkadaşlık isteği alabileyim
        </label>
        <button type="submit" className="btn btn-primary btn-auto" disabled={busy} data-testid="privacy-save">
          Kaydet
        </button>
      </form>
    </section>
  );
}
