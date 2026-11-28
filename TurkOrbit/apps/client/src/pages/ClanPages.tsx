/**
 * Klan sayfaları (Aşama 12): /klan (klanın veya klan arama/kurma) ve /klan/:server/:tag (herkese açık klan sayfası).
 * Görünürlük için yetkiler burada da okunur; asıl denetim sunucudadır (yetkisiz istek CLAN_PERMISSION ile döner).
 */
import {
  CLAN_PERMISSION_LABELS,
  CLAN_PERMISSIONS,
  DIPLOMACY_LABELS,
  hasClanPermission,
  outranks,
  type ClanPermission,
  type ClanPublicView,
  type ClanRankView,
  type ClanResponse,
  type ClanSummary,
  type MyClanView,
} from '@turkorbit/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AccountLayout, PublicLayout } from '../components/Layout';
import { ReportDialog } from '../components/social/ReportDialog';
import { Alert, ErrorAlert, formatDate } from '../components/ui';
import { fmt, money } from '../lib/format';

const SERVER = 'TR1';
const LEDGER_LABELS: Record<string, string> = {
  clan_deposit: 'Yatırma',
  clan_payout: 'Ödeme',
  clan_tax: 'Vergi',
  clan_disband: 'Dağıtma iadesi',
};

type ClanTab = 'overview' | 'members' | 'applications' | 'treasury' | 'diplomacy' | 'ranks' | 'events';

/** POST + yanıtı uygula; hata mesajı ve başarı bildirimi */
function useClanAction(setData: (d: ClanResponse) => void) {
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (url: string, body: Record<string, unknown>, ok?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const r = await api<ClanResponse>('POST', url, { serverCode: SERVER, ...body });
        setData(r);
        if (ok) setNotice(ok);
        return true;
      } catch (e) {
        setError(e);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [setData],
  );
  return { run, error, notice, busy, setNotice };
}

export function ClanPage() {
  const [data, setData] = useState<ClanResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const load = useCallback(() => {
    api<ClanResponse>('GET', `/clan?server=${SERVER}`)
      .then(setData)
      .catch(setLoadError);
  }, []);
  useEffect(load, [load]);
  const action = useClanAction(setData);
  return (
    <AccountLayout>
      <div className="page-head">
        <h1 className="page-title">Klan</h1>
      </div>
      {!data ? (
        loadError instanceof ApiError && loadError.code === 'PILOT_NOT_FOUND' ? (
          <Alert kind="info">
            Klan işlemleri için önce bir pilot oluşturmalısın. <Link to="/pilot">Pilot oluştur</Link>
          </Alert>
        ) : loadError ? (
          <ErrorAlert error={loadError} />
        ) : (
          <p className="muted">Yükleniyor…</p>
        )
      ) : (
        <>
          {action.error ? <ErrorAlert error={action.error} /> : null}
          {action.notice && <Alert kind="success">{action.notice}</Alert>}
          {data.clan ? <MyClan clan={data.clan} action={action} /> : <NoClan data={data} action={action} />}
        </>
      )}
    </AccountLayout>
  );
}

type Action = ReturnType<typeof useClanAction>;

// ====================================================================== klansız pilot
function NoClan({ data, action }: { data: ClanResponse; action: Action }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<ClanSummary[] | null>(null);
  const [form, setForm] = useState({ tag: '', name: '', description: '' });
  const [msg, setMsg] = useState<Record<string, string>>({});
  const search = useCallback((term: string) => {
    api<{ clans: ClanSummary[] }>('GET', `/clans?server=${SERVER}&q=${encodeURIComponent(term)}`)
      .then((r) => setList(r.clans))
      .catch(() => setList([]));
  }, []);
  useEffect(() => search(''), [search]);
  const canCreate = data.level >= data.createMinLevel;
  return (
    <>
      {data.invitations.length > 0 && (
        <section className="panel" data-testid="clan-invitations">
          <h2>Klan davetleri</h2>
          {data.invitations.map((i) => (
            <div key={i.id} className="app-row">
              <div className="grow">
                <span className="clan-tag">[{i.tag}]</span> {i.name}
                <div className="muted small">
                  {i.invitedBy ? `${i.invitedBy} davet etti · ` : ''}son gün {formatDate(i.expiresAt)}
                </div>
              </div>
              <div className="row-actions">
                <button type="button" className="btn btn-small btn-primary" disabled={action.busy} onClick={() => void action.run('/clan/invitations/respond', { id: i.id, accept: true }, `[${i.tag}] klanına katıldın.`)}>
                  Katıl
                </button>
                <button type="button" className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => void action.run('/clan/invitations/respond', { id: i.id, accept: false }, 'Davet reddedildi.')}>
                  Reddet
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {data.applications.length > 0 && (
        <section className="panel">
          <h2>Bekleyen başvurularım</h2>
          {data.applications.map((a) => (
            <div key={a.id} className="app-row">
              <div className="grow">
                <span className="clan-tag">[{a.tag}]</span> {a.name} <span className="muted small">· {formatDate(a.createdAt)}</span>
              </div>
              <button type="button" className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => void action.run('/clan/applications/withdraw', { id: a.id }, 'Başvuru geri çekildi.')}>
                Geri çek
              </button>
            </div>
          ))}
        </section>
      )}
      <section className="panel" data-testid="clan-search">
        <div className="panel-head">
          <h2>Klan ara</h2>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              search(q);
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Etiket veya ad" aria-label="Klan ara" />
            <button type="submit" className="btn btn-small btn-secondary">
              Ara
            </button>
          </form>
        </div>
        {list === null ? (
          <p className="muted">Yükleniyor…</p>
        ) : list.length === 0 ? (
          <p className="muted">Klan bulunamadı. İlk klanı sen kurabilirsin.</p>
        ) : (
          list.map((c) => (
            <div key={c.tag} className="app-row" data-testid={`clan-row-${c.tag}`}>
              <div className="grow">
                <Link to={`/klan/${SERVER}/${encodeURIComponent(c.tag)}`}>
                  <span className="clan-tag">[{c.tag}]</span> {c.name}
                </Link>
                <div className="muted small">
                  {c.members}/{c.maxMembers} üye · lider {c.leader ?? '—'} · en az Sv {c.minLevel} · vergi %{c.taxPercent}
                  {!c.isRecruiting && ' · üye almıyor'}
                </div>
              </div>
              {c.isRecruiting && (
                <div className="row-actions">
                  <input value={msg[c.tag] ?? ''} maxLength={200} onChange={(e) => setMsg((m) => ({ ...m, [c.tag]: e.target.value }))} placeholder="Kısa mesaj (isteğe bağlı)" aria-label={`${c.tag} başvuru mesajı`} className="app-msg" />
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    disabled={action.busy}
                    onClick={() => void action.run('/clan/apply', { tag: c.tag, ...(msg[c.tag] ? { message: msg[c.tag] } : {}) }, `[${c.tag}] klanına başvurdun. Yetkililer kabul edince bildirim alacaksın.`)}
                  >
                    Başvur
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </section>
      <section className="panel" data-testid="clan-create">
        <h2>Klan kur</h2>
        <p className="muted small">
          Kuruluş ücreti: <b>{money(data.createCost.amount, data.createCost.currency)}</b> · En az {data.createMinLevel}. seviye (sen: {data.level}). Etiket 2–5 harf/rakam, ad 3–30 karakter.
        </p>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run('/clan/create', { tag: form.tag, name: form.name, ...(form.description.trim() ? { description: form.description } : {}), requestId: crypto.randomUUID() }, 'Klanın kuruldu!');
          }}
        >
          <label className="field">
            <span className="field-label">Etiket</span>
            <input value={form.tag} maxLength={5} onChange={(e) => setForm({ ...form, tag: e.target.value })} data-testid="clan-tag-input" required />
          </label>
          <label className="field">
            <span className="field-label">Ad</span>
            <input value={form.name} maxLength={30} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="clan-name-input" required />
          </label>
          <label className="field grow-field">
            <span className="field-label">Açıklama (isteğe bağlı)</span>
            <input value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!canCreate || action.busy} data-testid="clan-create-btn">
            {canCreate ? 'Klanı kur' : `${data.createMinLevel}. seviyede açılır`}
          </button>
        </form>
      </section>
    </>
  );
}

// ====================================================================== klan üyesi
function MyClan({ clan, action }: { clan: MyClanView; action: Action }) {
  const [tab, setTab] = useState<ClanTab>('overview');
  const can = (p: ClanPermission) => hasClanPermission(clan.myRank, p);
  const tabs: Array<{ key: ClanTab; label: string; show: boolean }> = [
    { key: 'overview', label: 'Genel', show: true },
    { key: 'members', label: `Üyeler (${clan.members})`, show: true },
    { key: 'applications', label: `Başvurular${clan.applications.length ? ` (${clan.applications.length})` : ''}`, show: can('invite') },
    { key: 'treasury', label: 'Hazine', show: true },
    { key: 'diplomacy', label: 'Diplomasi', show: true },
    { key: 'ranks', label: 'Rütbeler', show: true },
    { key: 'events', label: 'Kayıtlar', show: true },
  ];
  return (
    <>
      <section className="panel clan-head" data-testid="my-clan">
        <div className="panel-head">
          <div>
            <h2>
              <span className="clan-tag">[{clan.tag}]</span> {clan.name}
            </h2>
            <div className="clan-stats">
              <span>
                {clan.members}/{clan.maxMembers} üye
              </span>
              <span>Lider: {clan.leader ?? '—'}</span>
              <span>Rütben: {clan.myRank.name}</span>
              <span>Hazine: {money(clan.treasury.balance, 'KREDI')}</span>
              <span>Vergi: %{clan.taxPercent}</span>
            </div>
          </div>
          <Link className="btn btn-small btn-secondary" to={`/klan/${SERVER}/${encodeURIComponent(clan.tag)}`}>
            Açık klan sayfası
          </Link>
        </div>
      </section>
      <div className="tabs" role="tablist" aria-label="Klan bölümleri">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)} data-testid={`clan-tab-${t.key}`}>
              {t.label}
            </button>
          ))}
      </div>
      {tab === 'overview' && <Overview clan={clan} action={action} />}
      {tab === 'members' && <Members clan={clan} action={action} />}
      {tab === 'applications' && <Applications clan={clan} action={action} />}
      {tab === 'treasury' && <Treasury clan={clan} action={action} />}
      {tab === 'diplomacy' && <Diplomacy clan={clan} action={action} />}
      {tab === 'ranks' && <Ranks clan={clan} action={action} />}
      {tab === 'events' && (
        <section className="panel">
          <ul className="event-list">
            {clan.events.map((e) => (
              <li key={e.id}>
                <time>{formatDate(e.createdAt)}</time>
                {e.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Overview({ clan, action }: { clan: MyClanView; action: Action }) {
  const editable = hasClanPermission(clan.myRank, 'edit_info');
  const [desc, setDesc] = useState(clan.description ?? '');
  const [recruiting, setRecruiting] = useState(clan.isRecruiting);
  const [minLevel, setMinLevel] = useState(clan.minLevel);
  const [tax, setTax] = useState(clan.taxPercent);
  const [confirm, setConfirm] = useState<'leave' | 'disband' | null>(null);
  return (
    <section className="panel">
      <h2>Klan bilgileri</h2>
      {editable ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run('/clan/update', { description: desc.trim() ? desc : null, isRecruiting: recruiting, minLevel, ...(clan.myRank.isLeader ? { taxPercent: tax } : {}) }, 'Klan bilgileri güncellendi.');
          }}
        >
          <label className="field grow-field">
            <span className="field-label">Açıklama</span>
            <input value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Başvuru için en az seviye</span>
            <input type="number" min={1} max={50} value={minLevel} onChange={(e) => setMinLevel(Number(e.target.value) || 1)} />
          </label>
          {clan.myRank.isLeader && (
            <label className="field">
              <span className="field-label">Klan vergisi (NPC Kredi ödülünden)</span>
              <select value={tax} onChange={(e) => setTax(Number(e.target.value))} data-testid="clan-tax">
                {[0, 1, 2, 3, 4, 5].map((t) => (
                  <option key={t} value={t}>
                    %{t}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="perm-grid">
            <input type="checkbox" checked={recruiting} onChange={(e) => setRecruiting(e.target.checked)} /> Üye alıyor
          </label>
          <button type="submit" className="btn btn-secondary" disabled={action.busy}>
            Kaydet
          </button>
        </form>
      ) : (
        <p>{clan.description ?? <span className="muted">Açıklama yok.</span>}</p>
      )}
      <div className="row-actions" style={{ marginTop: 14 }}>
        {!clan.myRank.isLeader && (
          <button type="button" className="btn btn-danger" onClick={() => setConfirm('leave')}>
            Klandan ayrıl
          </button>
        )}
        {clan.myRank.isLeader && (
          <button type="button" className="btn btn-danger" onClick={() => setConfirm('disband')}>
            Klanı dağıt
          </button>
        )}
      </div>
      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal-card" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>{confirm === 'leave' ? 'Klandan ayrıl' : 'Klanı dağıt'}</h2>
            <p>
              {confirm === 'leave'
                ? `[${clan.tag}] klanından ayrılmak istediğine emin misin?`
                : `[${clan.tag}] klanı kalıcı olarak dağıtılacak. Hazinedeki ${money(clan.treasury.balance, 'KREDI')} sana iade edilir, tüm üyeler bildirim alır ve diplomasi ilişkileri sona erer.`}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
                Vazgeç
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={action.busy}
                data-testid="confirm-clan"
                onClick={() => {
                  void action.run(confirm === 'leave' ? '/clan/leave' : '/clan/disband', {}, confirm === 'leave' ? 'Klandan ayrıldın.' : 'Klan dağıtıldı.');
                  setConfirm(null);
                }}
              >
                {confirm === 'leave' ? 'Ayrıl' : 'Dağıt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Members({ clan, action }: { clan: MyClanView; action: Action }) {
  const me = clan.myRank;
  const [invite, setInvite] = useState('');
  const rankOf = (id: number) => clan.ranks.find((r) => r.id === id)!;
  return (
    <section className="panel" data-testid="clan-members">
      {hasClanPermission(me, 'invite') && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run('/clan/invite', { pilotName: invite }, `${invite} adlı pilota davet gönderildi.`).then((ok) => ok && setInvite(''));
          }}
        >
          <input value={invite} onChange={(e) => setInvite(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20))} placeholder="Pilot adı" aria-label="Davet edilecek pilot" data-testid="clan-invite-input" />
          <button type="submit" className="btn btn-small btn-secondary" disabled={!invite || action.busy}>
            Klana davet et
          </button>
        </form>
      )}
      {clan.invitations.length > 0 && (
        <p className="muted small">
          Bekleyen davetler:{' '}
          {clan.invitations.map((i) => (
            <span key={i.id} className="badge badge-muted" style={{ marginRight: 6 }}>
              {i.pilotName}{' '}
              <button type="button" className="link-btn" aria-label={`${i.pilotName} davetini iptal et`} onClick={() => void action.run('/clan/invitations/cancel', { id: i.id }, 'Davet iptal edildi.')}>
                ×
              </button>
            </span>
          ))}
        </p>
      )}
      {clan.memberList.map((m) => {
        const target = rankOf(m.rankId);
        const manageable = outranks(me, target) && m.rankName !== me.name;
        return (
          <div key={m.pilotName} className="member-row" data-testid={`member-${m.pilotName}`}>
            <span className={`online-dot${m.online ? ' on' : ''}`} title={m.online ? 'Oyunda' : 'Çevrimdışı'} />
            <div className="grow">
              <Link to={`/pilot/${SERVER}/${encodeURIComponent(m.pilotName)}`}>{m.pilotName}</Link>{' '}
              <span className="muted small">
                Sv {m.level} · {m.company.code} · {formatDate(m.joinedAt)}
              </span>
            </div>
            {hasClanPermission(me, 'promote') && manageable ? (
              <select
                value={m.rankId}
                aria-label={`${m.pilotName} rütbesi`}
                onChange={(e) => void action.run('/clan/members/rank', { pilotName: m.pilotName, rankId: Number(e.target.value) }, `${m.pilotName} rütbesi güncellendi.`)}
              >
                {clan.ranks
                  .filter((r) => !r.isLeader && (me.isLeader || r.sortOrder > me.sortOrder))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            ) : (
              <span className="badge badge-info">{m.rankName}</span>
            )}
            <div className="row-actions">
              {hasClanPermission(me, 'kick') && manageable && (
                <button type="button" className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => void action.run('/clan/kick', { pilotName: m.pilotName }, `${m.pilotName} klandan çıkarıldı.`)}>
                  Çıkar
                </button>
              )}
              {me.isLeader && !target.isLeader && (
                <button type="button" className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => void action.run('/clan/transfer', { pilotName: m.pilotName }, `Liderlik ${m.pilotName} adlı pilota devredildi.`)}>
                  Liderliği devret
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Applications({ clan, action }: { clan: MyClanView; action: Action }) {
  if (clan.applications.length === 0) return <section className="panel"><p className="muted">Bekleyen başvuru yok.</p></section>;
  return (
    <section className="panel" data-testid="clan-applications">
      {clan.applications.map((a) => (
        <div key={a.id} className="app-row">
          <div className="grow">
            <b>{a.pilotName}</b> <span className="muted small">Sv {a.level} · {a.company} · {formatDate(a.createdAt)}</span>
            {a.message && <div className="small">“{a.message}”</div>}
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-small btn-primary" disabled={action.busy} onClick={() => void action.run('/clan/applications/decide', { id: a.id, accept: true }, `${a.pilotName} klana katıldı.`)}>
              Kabul et
            </button>
            <button type="button" className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => void action.run('/clan/applications/decide', { id: a.id, accept: false }, 'Başvuru reddedildi.')}>
              Reddet
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Treasury({ clan, action }: { clan: MyClanView; action: Action }) {
  const [dep, setDep] = useState('');
  const [pay, setPay] = useState({ name: '', amount: '' });
  return (
    <section className="panel" data-testid="clan-treasury">
      <h2>
        Hazine: <span data-testid="treasury-balance">{money(clan.treasury.balance, 'KREDI')}</span>
      </h2>
      <p className="muted small">Hazine hareketleri değiştirilemez bir defterde tutulur. Vergi, üyelerin NPC Kredi ödüllerinden otomatik aktarılır.</p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const amount = Number(dep);
          if (!Number.isInteger(amount) || amount <= 0) return;
          void action.run('/clan/treasury/deposit', { amount, requestId: crypto.randomUUID() }, `${fmt(amount)} Kredi hazineye yatırıldı.`).then((ok) => ok && setDep(''));
        }}
      >
        <input type="number" min={1} value={dep} onChange={(e) => setDep(e.target.value)} placeholder="Kredi" aria-label="Yatırılacak Kredi" data-testid="deposit-amount" />
        <button type="submit" className="btn btn-small btn-secondary" disabled={action.busy}>
          Hazineye yatır
        </button>
      </form>
      {hasClanPermission(clan.myRank, 'treasury') && (
        <form
          className="inline-form"
          style={{ marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            const amount = Number(pay.amount);
            if (!pay.name || !Number.isInteger(amount) || amount <= 0) return;
            void action.run('/clan/treasury/withdraw', { pilotName: pay.name, amount, requestId: crypto.randomUUID() }, `${pay.name} adlı üyeye ${fmt(amount)} Kredi ödendi.`);
          }}
        >
          <select value={pay.name} onChange={(e) => setPay({ ...pay, name: e.target.value })} aria-label="Ödeme yapılacak üye">
            <option value="">Üye seç</option>
            {clan.memberList.map((m) => (
              <option key={m.pilotName} value={m.pilotName}>
                {m.pilotName}
              </option>
            ))}
          </select>
          <input type="number" min={1} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="Kredi" aria-label="Ödenecek Kredi" />
          <button type="submit" className="btn btn-small btn-secondary" disabled={action.busy}>
            Hazineden öde
          </button>
        </form>
      )}
      <table className="ledger-mini" style={{ marginTop: 12 }}>
        <tbody>
          {clan.treasury.entries.map((e) => (
            <tr key={e.id}>
              <td className="muted">{formatDate(e.createdAt)}</td>
              <td>
                {LEDGER_LABELS[e.reason] ?? e.reason}
                {e.pilotName ? ` · ${e.pilotName}` : ''}
                {e.actorName && e.actorName !== e.pilotName ? ` (${e.actorName})` : ''}
              </td>
              <td className={`num ${e.delta > 0 ? 'pos' : 'neg'}`}>
                {e.delta > 0 ? '+' : ''}
                {fmt(e.delta)}
              </td>
              <td className="num muted">{fmt(e.balanceAfter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Diplomacy({ clan, action }: { clan: MyClanView; action: Action }) {
  const can = hasClanPermission(clan.myRank, 'diplomacy');
  const [tag, setTag] = useState('');
  const [relation, setRelation] = useState<'alliance' | 'non_aggression'>('alliance');
  return (
    <section className="panel" data-testid="clan-diplomacy">
      <p className="muted small">
        İttifak ve saldırmazlık anlaşmasındaki klanların pilotları birbirine saldıramaz. Savaştaki klanlar, aynı şirketten olsalar bile PvP haritalarında savaşabilir.
      </p>
      {clan.relations.length === 0 && <p className="muted">Diplomatik ilişki yok.</p>}
      {clan.relations.map((r) => (
        <div key={r.tag} className="rel-row" data-testid={`rel-${r.tag}`}>
          <div className="grow">
            <Link to={`/klan/${SERVER}/${encodeURIComponent(r.tag)}`}>
              <span className="clan-tag">[{r.tag}]</span> {r.name}
            </Link>{' '}
            <span className={`badge ${r.relation === 'war' ? 'badge-danger' : r.status === 'active' ? 'badge-ok' : 'badge-warn'}`}>
              {DIPLOMACY_LABELS[r.relation]}
              {r.status === 'proposed' ? (r.ours ? ' · önerdik' : ' · öneri geldi') : ''}
            </span>
            {r.peace && <span className="badge badge-info" style={{ marginLeft: 6 }}>{r.peace === 'ours' ? 'Barış önerdik' : 'Barış önerdiler'}</span>}
            <div className="muted small">{formatDate(r.since)}</div>
          </div>
          {can && (
            <div className="row-actions">
              {r.status === 'proposed' && !r.ours && (
                <>
                  <button type="button" className="btn btn-small btn-primary" disabled={action.busy} onClick={() => void action.run('/clan/diplomacy/respond', { tag: r.tag, accept: true }, `${DIPLOMACY_LABELS[r.relation]} kabul edildi.`)}>
                    Kabul et
                  </button>
                  <button type="button" className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => void action.run('/clan/diplomacy/respond', { tag: r.tag, accept: false }, 'Öneri reddedildi.')}>
                    Reddet
                  </button>
                </>
              )}
              {r.status === 'proposed' && r.ours && (
                <button type="button" className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => void action.run('/clan/diplomacy/end', { tag: r.tag }, 'Öneri geri çekildi.')}>
                  Geri çek
                </button>
              )}
              {r.status === 'active' && r.relation !== 'war' && (
                <button type="button" className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => void action.run('/clan/diplomacy/end', { tag: r.tag }, 'Anlaşma sona erdi.')}>
                  Anlaşmayı bitir
                </button>
              )}
              {r.relation === 'war' && r.peace !== 'ours' && (
                <button type="button" className="btn btn-small btn-secondary" disabled={action.busy} onClick={() => void action.run('/clan/diplomacy/end', { tag: r.tag }, r.peace === 'theirs' ? 'Savaş sona erdi.' : 'Barış önerildi.')}>
                  {r.peace === 'theirs' ? 'Barışı kabul et' : 'Barış öner'}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {can && (
        <form className="inline-form" style={{ marginTop: 12 }} onSubmit={(e) => e.preventDefault()}>
          <input value={tag} maxLength={5} onChange={(e) => setTag(e.target.value)} placeholder="Klan etiketi" aria-label="Diplomasi için klan etiketi" data-testid="dip-tag" />
          <select value={relation} onChange={(e) => setRelation(e.target.value as typeof relation)} aria-label="Öneri türü">
            <option value="alliance">İttifak</option>
            <option value="non_aggression">Saldırmazlık</option>
          </select>
          <button type="button" className="btn btn-small btn-secondary" disabled={!tag || action.busy} onClick={() => void action.run('/clan/diplomacy/propose', { tag, relation }, `[${tag.toLocaleUpperCase('tr-TR')}] klanına öneri gönderildi.`)}>
            Öner
          </button>
          <button type="button" className="btn btn-small btn-danger" disabled={!tag || action.busy} onClick={() => void action.run('/clan/diplomacy/war', { tag }, `[${tag.toLocaleUpperCase('tr-TR')}] klanına savaş ilan edildi.`)} data-testid="dip-war">
            Savaş ilan et
          </button>
        </form>
      )}
    </section>
  );
}

function RankEditor({ rank, action }: { rank: ClanRankView; action: Action }) {
  const [name, setName] = useState(rank.name);
  const [perms, setPerms] = useState<ClanPermission[]>(rank.permissions);
  return (
    <div className="member-row">
      <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} aria-label="Rütbe adı" className="rank-name" />
      <div className="perm-grid grow">
        {CLAN_PERMISSIONS.map((p) => (
          <label key={p}>
            <input type="checkbox" checked={rank.isLeader || perms.includes(p)} disabled={rank.isLeader} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
            {CLAN_PERMISSION_LABELS[p]}
          </label>
        ))}
      </div>
      <button type="button" className="btn btn-small btn-secondary" disabled={action.busy} onClick={() => void action.run('/clan/ranks/update', { rankId: rank.id, name, permissions: perms }, 'Rütbe güncellendi.')}>
        Kaydet
      </button>
    </div>
  );
}

function Ranks({ clan, action }: { clan: MyClanView; action: Action }) {
  return (
    <section className="panel" data-testid="clan-ranks">
      {clan.myRank.isLeader ? (
        clan.ranks.map((r) => <RankEditor key={r.id} rank={r} action={action} />)
      ) : (
        clan.ranks.map((r) => (
          <div key={r.id} className="member-row">
            <b>{r.name}</b>
            <span className="muted small grow">{r.isLeader ? 'Tüm yetkiler' : r.permissions.map((p) => CLAN_PERMISSION_LABELS[p]).join(', ') || 'Yetki yok'}</span>
            <span className="muted small">{r.members} üye</span>
          </div>
        ))
      )}
    </section>
  );
}

// ====================================================================== açık klan sayfası
export function PublicClanPage() {
  const { server = SERVER, tag = '' } = useParams();
  const { me } = useAuth();
  const [clan, setClan] = useState<ClanPublicView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  useEffect(() => {
    api<{ clan: ClanPublicView }>('GET', `/clans/${encodeURIComponent(server)}/${encodeURIComponent(tag)}`)
      .then((r) => setClan(r.clan))
      .catch(setError);
  }, [server, tag]);
  const Wrap = me ? AccountLayout : PublicLayout;
  return (
    <Wrap>
      {!clan ? (
        error ? <ErrorAlert error={error} /> : <p className="muted">Yükleniyor…</p>
      ) : (
        <section className="panel" data-testid="public-clan">
          <div className="panel-head">
            <h1 className="page-title">
              <span className="clan-tag">[{clan.tag}]</span> {clan.name}
            </h1>
            {me && (
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setReport(true)}>
                Şikâyet et
              </button>
            )}
          </div>
          {notice && <Alert kind="success">{notice}</Alert>}
          <div className="clan-stats">
            <span>
              {clan.members}/{clan.maxMembers} üye
            </span>
            <span>Lider: {clan.leader ?? '—'}</span>
            <span>Kuruluş: {formatDate(clan.createdAt)}</span>
            <span>{clan.isRecruiting ? `Üye alıyor (en az Sv ${clan.minLevel})` : 'Üye almıyor'}</span>
          </div>
          {clan.description && <p>{clan.description}</p>}
          {clan.relations.length > 0 && (
            <>
              <h2>Diplomasi</h2>
              {clan.relations.map((r) => (
                <div key={r.tag} className="rel-row">
                  <Link to={`/klan/${server}/${encodeURIComponent(r.tag)}`}>
                    <span className="clan-tag">[{r.tag}]</span> {r.name}
                  </Link>
                  <span className={`badge ${r.relation === 'war' ? 'badge-danger' : 'badge-ok'}`}>{DIPLOMACY_LABELS[r.relation]}</span>
                </div>
              ))}
            </>
          )}
          <h2>Üyeler</h2>
          {clan.memberList.map((m) => (
            <div key={m.pilotName} className="member-row">
              <Link to={`/pilot/${server}/${encodeURIComponent(m.pilotName)}`}>{m.pilotName}</Link>
              <span className="muted small">
                Sv {m.level} · {m.company}
              </span>
              <span className="badge badge-info">{m.rankName}</span>
            </div>
          ))}
        </section>
      )}
      {report && clan && <ReportDialog target={{ type: 'clan', id: clan.tag, label: `Klan: [${clan.tag}] ${clan.name}` }} onClose={() => setReport(false)} onDone={setNotice} />}
    </Wrap>
  );
}
