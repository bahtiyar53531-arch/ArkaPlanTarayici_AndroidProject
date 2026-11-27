import {
  LEDGER_REASON_LABELS_TR,
  SHIP_CLASS_LABELS_TR,
  type CompanyInfo,
  type GameServerInfo,
  type LedgerEntry,
  type PilotProfile,
  type PublicPilotProfile,
} from '@turkorbit/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AccountLayout, PublicLayout } from '../components/Layout';
import { ShipArt } from '../components/ShipArt';
import { Alert, Card, ErrorAlert, formatDate } from '../components/ui';

const nf = new Intl.NumberFormat('tr-TR');
const fmt = (n: number) => nf.format(n);

function formatPlaytime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${fmt(h)} sa ${m} dk`;
}

function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 100;
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

// ====================================================================== /pilot
export function PilotPage() {
  const [pilots, setPilots] = useState<PilotProfile[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setPilots((await api<{ pilots: PilotProfile[] }>('GET', '/players/me')).pilots);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AccountLayout>
      <ErrorAlert error={error} />
      {pilots === null && !error && <p className="muted">Pilot bilgileri yükleniyor…</p>}
      {pilots && pilots.length === 0 && <CreatePilotWizard onCreated={(p) => setPilots([p])} />}
      {pilots && pilots[0] && (
        <PilotProfileView pilot={pilots[0]} onChange={(p) => setPilots([p, ...pilots.slice(1)])} />
      )}
    </AccountLayout>
  );
}

// ====================================================================== pilot oluşturma
function CreatePilotWizard({ onCreated }: { onCreated: (p: PilotProfile) => void }) {
  const { me } = useAuth();
  const [servers, setServers] = useState<GameServerInfo[]>([]);
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [server, setServer] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ servers: GameServerInfo[] }>('GET', '/game/servers')
      .then((r) => {
        setServers(r.servers);
        const open = r.servers.filter((s) => s.isOpen && !s.isMaintenance);
        if (open.length === 1) setServer(open[0]!.code);
      })
      .catch(setError);
  }, []);
  useEffect(() => {
    if (!server) return;
    api<{ companies: CompanyInfo[] }>('GET', `/game/companies?server=${encodeURIComponent(server)}`)
      .then((r) => setCompanies(r.companies))
      .catch(setError);
  }, [server]);

  const verified = me?.user.emailVerified ?? false;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!server || !company) return;
    setBusy(true);
    setError(null);
    try {
      onCreated((await api<{ pilot: PilotProfile }>('POST', '/players', { serverCode: server, companyCode: company })).pilot);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const chosen = companies.find((c) => c.code === company);
  return (
    <form onSubmit={create} className="wizard">
      <h1 className="page-title">Pilotunu oluştur</h1>
      <p className="muted">
        Pilot adın <b>{me?.user.username}</b> olacak. Seçimlerin tüm cihazlarında (PC, web, Android, iOS) aynı karakteri kullanır.
      </p>
      {!verified && (
        <Alert kind="warning">
          Pilot oluşturmak için önce e-posta adresini doğrulamalısın. <Link to="/hesap">Hesabım</Link> sayfasından doğrulama
          e-postasını yeniden isteyebilirsin.
        </Alert>
      )}
      <ErrorAlert error={error} />

      <section className="panel">
        <h2>1. Sunucu</h2>
        <div className="choice-grid">
          {servers.map((s) => {
            const disabled = !s.isOpen || s.isMaintenance;
            return (
              <label key={s.code} className={`choice${server === s.code ? ' selected' : ''}${disabled ? ' disabled' : ''}`}>
                <input type="radio" name="server" value={s.code} disabled={disabled} checked={server === s.code}
                  onChange={() => { setServer(s.code); setCompany(null); }} />
                <span className="choice-title">{s.name} <span className="mono muted">({s.code})</span></span>
                <span className="choice-meta">
                  {disabled ? (s.isMaintenance ? 'Bakımda' : 'Yeni pilot kabul etmiyor') : `${fmt(s.pilotCount)} pilot`}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>2. Şirket</h2>
        <p className="muted">Şirket seçimin başlangıç bölgeni belirler. Daha sonra 30 günde bir, ücret karşılığında değiştirilebilir.</p>
        <div className="choice-grid companies">
          {companies.map((c) => (
            <label key={c.code} className={`choice company${company === c.code ? ' selected' : ''}`} style={{ '--company': c.colorHex } as React.CSSProperties}>
              <input type="radio" name="company" value={c.code} checked={company === c.code} onChange={() => setCompany(c.code)} />
              <span className="company-stripe" />
              <span className="choice-title">{c.name}</span>
              <span className="company-motto">“{c.motto}”</span>
              <span className="choice-desc">{c.description}</span>
              <span className="choice-meta">Odak: {c.focus} · Başlangıç: {c.homeMap.code} {c.homeMap.name}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>3. Onay</h2>
        {chosen ? (
          <p>
            <b>{me?.user.username}</b>, <b style={{ color: chosen.colorHex }}>{chosen.name}</b> pilotu olarak{' '}
            <b>{chosen.homeMap.code} {chosen.homeMap.name}</b> bölgesinde Kırlangıç gemisiyle göreve başlayacak.
          </p>
        ) : (
          <p className="muted">Devam etmek için bir sunucu ve şirket seç.</p>
        )}
        <button type="submit" className="btn btn-primary" disabled={!server || !company || !verified || busy}>
          {busy ? 'Oluşturuluyor…' : 'Pilotu oluştur'}
        </button>
      </section>
    </form>
  );
}

// ====================================================================== profil
function PilotProfileView({ pilot, onChange }: { pilot: PilotProfile; onChange: (p: PilotProfile) => void }) {
  const lv = pilot.level;
  const rankSpan = pilot.rank.next ? pilot.rank.next.minPoints - pilot.rank.minPoints : 1;
  return (
    <>
      <section className="panel hero" style={{ '--company': pilot.company.colorHex } as React.CSSProperties}>
        <div className="hero-ship">
          {pilot.activeShip && <ShipArt spriteKey={pilot.activeShip.spriteKey} color={pilot.company.colorHex} size={168} />}
        </div>
        <div className="hero-body">
          <div className="hero-top">
            <h1 className="pilot-name">{pilot.pilotName}</h1>
            <span className="company-badge">{pilot.company.name}</span>
          </div>
          <div className="hero-sub">
            <span className="mono">Oyuncu ID #{pilot.playerId}</span> · {pilot.server.name} ·{' '}
            <Link to={`/pilot/${pilot.server.code}/${pilot.pilotName}`}>Herkese açık profilim</Link>
          </div>
          <MottoEditor pilot={pilot} onChange={onChange} />
          <div className="hero-progress">
            <div>
              <div className="progress-label">
                <span className="level-badge">Sv {lv.level}</span>
                <span className="muted">
                  {lv.nextLevelXp === null ? 'Maksimum seviye' : `${fmt(lv.experience)} / ${fmt(lv.nextLevelXp)} deneyim`}
                </span>
              </div>
              <Bar value={lv.experience - lv.levelStartXp} max={(lv.nextLevelXp ?? lv.experience) - lv.levelStartXp} />
            </div>
            <div>
              <div className="progress-label">
                <span className="rank-badge">{pilot.rank.name}</span>
                <span className="muted">
                  {pilot.rank.next ? `${fmt(pilot.rank.points)} / ${fmt(pilot.rank.next.minPoints)} rütbe puanı · sonraki: ${pilot.rank.next.name}` : `${fmt(pilot.rank.points)} rütbe puanı`}
                </span>
              </div>
              <Bar value={pilot.rank.points - pilot.rank.minPoints} max={rankSpan} color="var(--warn)" />
            </div>
          </div>
        </div>
      </section>

      <div className="tiles">
        {pilot.currencies.map((c) => (
          <Tile key={c.code} label={c.name} value={fmt(c.balance)} accent={c.isPremium ? 'gold' : undefined} />
        ))}
        <Tile label="Şeref" value={fmt(pilot.honor)} />
        <Tile label="Oyun süresi" value={formatPlaytime(pilot.playtimeSeconds)} />
      </div>

      <div className="grid">
        {pilot.activeShip && (
          <section className="panel">
            <h2>Aktif gemi</h2>
            <div className="ship-row">
              <ShipArt spriteKey={pilot.activeShip.spriteKey} color={pilot.company.colorHex} size={88} />
              <div>
                <div className="list-title">{pilot.activeShip.name} <span className="muted">· {shipClassTr(pilot.activeShip.shipClass)}</span></div>
                <div className="list-meta">Can {fmt(pilot.activeShip.hitpoints)} / {fmt(pilot.activeShip.maxHitpoints)}</div>
                <Bar value={pilot.activeShip.hitpoints} max={pilot.activeShip.maxHitpoints} color="var(--ok)" />
              </div>
            </div>
            <dl className="kv compact">
              <dt>Hız</dt><dd>{fmt(pilot.activeShip.speed)}</dd>
              <dt>Kargo</dt><dd>{fmt(pilot.activeShip.cargoCapacity)}</dd>
              <dt>Slotlar</dt>
              <dd>{pilot.activeShip.slots.laser} lazer · {pilot.activeShip.slots.generator} jeneratör · {pilot.activeShip.slots.extra} ekstra · {pilot.activeShip.slots.drone} drone</dd>
            </dl>
            <Link className="btn btn-secondary btn-small" to="/hangar">Hangara git</Link>
          </section>
        )}
        <section className="panel">
          <h2>Konum</h2>
          <dl className="kv compact">
            <dt>Harita</dt><dd><b>{pilot.map.code}</b> {pilot.map.name}</dd>
            <dt>Bölge</dt><dd>{pilot.map.pvpEnabled ? <span className="badge badge-danger">PvP açık</span> : <span className="badge badge-ok">Güvenli bölge</span>}</dd>
            <dt>Koordinat</dt><dd className="mono">{fmt(pilot.map.x)} / {fmt(pilot.map.y)}</dd>
            <dt>Son çevrimiçi</dt><dd>{pilot.lastOnlineAt ? formatDate(pilot.lastOnlineAt) : 'Henüz oyun dünyasına girmedin'}</dd>
            <dt>Pilot oluşturuldu</dt><dd>{formatDate(pilot.createdAt)}</dd>
          </dl>
          <Link className="btn btn-primary btn-small" to="/oyna">Uzaya çık</Link>
        </section>
      </div>

      <section className="panel">
        <h2>Savaş ve NPC istatistikleri</h2>
        <div className="stat-grid">
          <Stat label="Yok edilen NPC" value={pilot.stats.npcKills} />
          <Stat label="Yenilen pilot" value={pilot.stats.playerKills} />
          <Stat label="Yenilgi" value={pilot.stats.deaths} />
          <Stat label="Tamamlanan kapı" value={pilot.stats.gatesCompleted} />
          <Stat label="Toplanan kargo" value={pilot.stats.cargoCollected} />
          <Stat label="Verilen hasar" value={pilot.stats.damageDealt} />
          <Stat label="Alınan hasar" value={pilot.stats.damageTaken} />
        </div>
        <p className="muted small">İstatistikleri yalnızca oyun sunucusu yazar; istemciden değiştirilemez.</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Başarımlar</h2>
          <span className="muted">{pilot.achievements.earned} / {pilot.achievements.total}</span>
        </div>
        <ul className="achievements">
          {pilot.achievements.items.map((a) => (
            <li key={a.code} className={a.completedAt ? 'done' : ''}>
              <div className="ach-head">
                <span className="ach-name">{a.completedAt ? '★ ' : ''}{a.name}</span>
                <span className="muted small">{a.completedAt ? formatDate(a.completedAt) : `${fmt(a.progress)} / ${fmt(a.target)}`}</span>
              </div>
              <div className="muted small">{a.description}</div>
              {!a.completedAt && <Bar value={a.progress} max={a.target} />}
            </li>
          ))}
        </ul>
      </section>

      <CompanyChangePanel pilot={pilot} onChange={onChange} />
      <LedgerPanel pilot={pilot} />

      <section className="panel">
        <h2>Yakında bu profilde</h2>
        <ul className="upcoming">
          <li><b>Klan</b>: klan üyeliği ve rütbesi (Aşama 12)</li>
          <li><b>Arkadaşlar</b>: arkadaş listesi ve çevrimiçi durumu (Aşama 12)</li>
          <li><b>Görev ilerlemesi</b>: ana, günlük, haftalık ve etkinlik görevleri (Aşama 10)</li>
        </ul>
      </section>
    </>
  );
}

function shipClassTr(c: string) {
  return SHIP_CLASS_LABELS_TR[c] ?? c;
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: 'gold' }) {
  return (
    <div className={`tile${accent ? ` tile-${accent}` : ''}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat-value">{fmt(value)}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function MottoEditor({ pilot, onChange }: { pilot: PilotProfile; onChange: (p: PilotProfile) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(pilot.motto ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ pilot: PilotProfile }>('PATCH', '/players/me', { serverCode: pilot.server.code, motto: value });
      onChange(r.pilot);
      setEditing(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="motto">
        <span className={pilot.motto ? '' : 'muted'}>{pilot.motto ? `“${pilot.motto}”` : 'Henüz bir pilot sloganın yok.'}</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => { setValue(pilot.motto ?? ''); setEditing(true); }}>
          Sloganı düzenle
        </button>
      </div>
    );
  }
  return (
    <form className="motto-form" onSubmit={save}>
      <ErrorAlert error={error} />
      <label className="sr-only" htmlFor="motto">Pilot sloganı</label>
      <input id="motto" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} autoFocus placeholder="Galakside seni anlatan bir cümle (en fazla 80 karakter)" />
      <div className="motto-actions">
        <span className="muted small">{value.length}/80</span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditing(false)}>Vazgeç</button>
        <button type="submit" className="btn btn-secondary btn-small" disabled={busy}>Kaydet</button>
      </div>
    </form>
  );
}

function CompanyChangePanel({ pilot, onChange }: { pilot: PilotProfile; onChange: (p: PilotProfile) => void }) {
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ companies: CompanyInfo[] }>('GET', `/game/companies?server=${pilot.server.code}`).then((r) => setCompanies(r.companies)).catch(() => undefined);
  }, [pilot.server.code]);

  const cc = pilot.companyChange;
  const balance = pilot.currencies.find((c) => c.code === cc.cost.currency);
  const currencyName = balance?.name ?? cc.cost.currency;

  async function change() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ pilot: PilotProfile }>('POST', '/players/me/company', { serverCode: pilot.server.code, companyCode: target });
      onChange(r.pilot);
      setNotice(`Artık ${r.pilot.company.name} pilotusun. Yeni başlangıç bölgen: ${r.pilot.map.code} ${r.pilot.map.name}.`);
      setConfirming(false);
      setTarget('');
    } catch (err) {
      setError(err);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Şirket</h2>
      {notice && <Alert kind="success">{notice}</Alert>}
      <ErrorAlert error={error} />
      <p>
        Şu an <b style={{ color: pilot.company.colorHex }}>{pilot.company.name}</b> üyesisin. Şirket değiştirmek{' '}
        <b>{fmt(cc.cost.amount)} {currencyName}</b> tutar ve {cc.cooldownDays} günde bir yapılabilir.
      </p>
      {cc.availableAt ? (
        <p className="muted">Bir sonraki değişiklik: <b>{formatDate(cc.availableAt)}</b></p>
      ) : (
        <div className="company-change">
          <label className="sr-only" htmlFor="target-company">Yeni şirket</label>
          <select id="target-company" value={target} onChange={(e) => { setTarget(e.target.value); setConfirming(false); }}>
            <option value="">Yeni şirket seç…</option>
            {companies.filter((c) => c.code !== pilot.company.code).map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
          {!confirming ? (
            <button type="button" className="btn btn-secondary" disabled={!target} onClick={() => setConfirming(true)}>Şirketi değiştir</button>
          ) : (
            <div className="confirm">
              <span>{fmt(cc.cost.amount)} {currencyName} hesabından düşülecek ve yeni şirketin başlangıç bölgesine taşınacaksın. Emin misin?</span>
              <button type="button" className="btn btn-danger" onClick={change} disabled={busy}>{busy ? 'İşleniyor…' : 'Evet, değiştir'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Vazgeç</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function LedgerPanel({ pilot }: { pilot: PilotProfile }) {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  useEffect(() => {
    api<{ entries: LedgerEntry[] }>('GET', `/players/me/ledger?server=${pilot.server.code}`).then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [pilot]);
  const names = Object.fromEntries(pilot.currencies.map((c) => [c.code, c.name]));
  return (
    <section className="panel">
      <h2>Para hareketleri</h2>
      <p className="muted small">Her para hareketi değiştirilemez bir deftere kaydedilir. Son 50 işlem:</p>
      <ul className="list">
        {(entries ?? []).map((e) => (
          <li key={e.id} className="list-item ledger-item">
            <div>
              <div className="list-title">{LEDGER_REASON_LABELS_TR[e.reason] ?? e.reason}</div>
              <div className="list-meta">{formatDate(e.createdAt)}</div>
            </div>
            <div className="ledger-amount">
              <span className={e.delta > 0 ? 'plus' : 'minus'}>{e.delta > 0 ? '+' : ''}{fmt(e.delta)} {names[e.currency] ?? e.currency}</span>
              <span className="muted small">Bakiye: {fmt(e.balanceAfter)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ====================================================================== herkese açık profil
export function PublicPilotPage() {
  const { server = '', name = '' } = useParams();
  const { me } = useAuth();
  const [pilot, setPilot] = useState<PublicPilotProfile | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setPilot(null);
    setError(null);
    api<{ pilot: PublicPilotProfile }>('GET', `/pilots/${encodeURIComponent(server)}/${encodeURIComponent(name)}`)
      .then((r) => setPilot(r.pilot))
      .catch(setError);
  }, [server, name]);

  const Layout = me ? AccountLayout : PublicLayout;

  if (error) {
    return (
      <Layout>
        <Card title="Pilot bulunamadı">
          <Alert kind="error">{error instanceof ApiError ? error.message : 'Profil yüklenemedi.'}</Alert>
        </Card>
      </Layout>
    );
  }
  if (!pilot) return <Layout><p className="muted">Yükleniyor…</p></Layout>;
  return (
    <Layout>
      <section className="panel hero" style={{ '--company': pilot.company.colorHex } as React.CSSProperties}>
        <div className="hero-ship">{pilot.activeShip && <ShipArt spriteKey={pilot.activeShip.spriteKey} color={pilot.company.colorHex} size={150} />}</div>
        <div className="hero-body">
          <div className="hero-top">
            <h1 className="pilot-name">{pilot.pilotName}</h1>
            <span className="company-badge">{pilot.company.name}</span>
          </div>
          <div className="hero-sub"><span className="mono">Oyuncu ID #{pilot.playerId}</span> · {pilot.server.name} · {formatDate(pilot.createdAt)} tarihinden beri pilot</div>
          {pilot.motto && <div className="motto">“{pilot.motto}”</div>}
          <div className="tiles inline">
            <Tile label="Seviye" value={String(pilot.level)} />
            <Tile label="Rütbe" value={pilot.rank.name} />
            <Tile label="Şeref" value={fmt(pilot.honor)} />
          </div>
        </div>
      </section>
      <section className="panel">
        <h2>İstatistikler</h2>
        <div className="stat-grid">
          <Stat label="Yok edilen NPC" value={pilot.stats.npcKills} />
          <Stat label="Yenilen pilot" value={pilot.stats.playerKills} />
          <Stat label="Tamamlanan kapı" value={pilot.stats.gatesCompleted} />
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Kazanılan başarımlar</h2><span className="muted">{pilot.achievements.earned} / {pilot.achievements.total}</span></div>
        <ul className="achievements">
          {pilot.achievements.items.map((a) => (
            <li key={a.code} className="done"><div className="ach-head"><span className="ach-name">★ {a.name}</span>{a.completedAt && <span className="muted small">{formatDate(a.completedAt)}</span>}</div></li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}
