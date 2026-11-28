/**
 * Görev panosu (Aşama 10). Hem /gorevler sayfasında hem oyun içi görev çekmecesinde kullanılır.
 * İlerleme sunucudan gelir; bu bileşen yalnızca kabul / bırak / yeniden çek / ödül al isteklerini gönderir.
 */
import {
  QUEST_CATEGORY_LABELS,
  QUEST_CHAIN_NAMES,
  type QuestCategory,
  type QuestClaimResponse,
  type QuestsResponse,
  type QuestView,
} from '@turkorbit/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { fmt } from '../../lib/format';
import { Alert, ErrorAlert } from '../ui';

const SERVER = 'TR1';
const TABS: QuestCategory[] = ['main', 'daily', 'weekly', 'event'];
const ORDER: Record<QuestView['status'], number> = { completed: 0, active: 1, available: 2, locked: 3, expired: 4, claimed: 5 };
const STATUS_LABEL: Record<QuestView['status'], string> = {
  completed: 'Ödül hazır',
  active: 'Devam ediyor',
  available: 'Alınabilir',
  locked: 'Kilitli',
  expired: 'Süresi doldu',
  claimed: 'Tamamlandı',
};
const STATUS_BADGE: Record<QuestView['status'], string> = {
  completed: 'badge-warn',
  active: 'badge-ok',
  available: 'badge-info',
  locked: 'badge-muted',
  expired: 'badge-danger',
  claimed: 'badge-muted',
};

export function rewardText(r: QuestClaimResponse['reward']): string {
  const parts: string[] = [];
  if (r.xp) parts.push(`+${fmt(r.xp)} deneyim`);
  if (r.honor) parts.push(`+${fmt(r.honor)} şeref`);
  for (const c of r.currencies) parts.push(`+${fmt(c.amount)} ${c.code === 'KREDI' ? 'Kredi' : c.code === 'AKCE' ? 'Akçe' : c.code}`);
  for (const it of r.items) parts.push(`${fmt(it.amount)} × ${it.name}`);
  return parts.join(' · ') || 'ödül yok';
}

function duration(ms: number): string {
  if (ms <= 0) return 'şimdi';
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d} gün ${h} sa`;
  if (h > 0) return `${h} sa ${mm} dk`;
  return `${mm} dk`;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });

interface Props {
  /** Oyun içi çekmece: daha sıkı yerleşim */
  compact?: boolean;
  /** Değiştiğinde liste yeniden istenir (oyun sunucusunun "quests" bildirimi) */
  reloadKey?: number;
  /** Liste her güncellendiğinde (oyun içi izleyici için) */
  onChange?: (q: QuestsResponse) => void;
  /** Ödül alındığında (oyun içi bildirim ve seviye) */
  onReward?: (text: string, level: number, levelUp: boolean) => void;
}

export function QuestBoard({ compact = false, reloadKey = 0, onChange, onReward }: Props) {
  const [data, setData] = useState<QuestsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<QuestCategory>('main');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info'; text: string } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [skew, setSkew] = useState(0);

  // Geri çağırımlar ref'te tutulur: ebeveyn her çizimde yeni fonksiyon verse de liste yeniden istenmez
  const cb = useRef({ onChange, onReward });
  cb.current = { onChange, onReward };
  const apply = useCallback((q: QuestsResponse) => {
    setData(q);
    setSkew(new Date(q.serverTime).getTime() - Date.now());
    cb.current.onChange?.(q);
  }, []);

  const load = useCallback(async () => {
    try {
      apply((await api<{ quests: QuestsResponse }>('GET', `/quests?server=${SERVER}`)).quests);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const act = async (action: 'accept' | 'abandon' | 'reroll' | 'claim', q: QuestView) => {
    setBusy(`${action}:${q.code}:${q.cycle}`);
    setNotice(null);
    try {
      const body: Record<string, string> = { serverCode: SERVER, code: q.code };
      if (action === 'claim') body.cycle = q.cycle;
      const r = await api<{ quests: QuestsResponse; reward?: QuestClaimResponse['reward']; replay?: boolean }>('POST', `/quests/${action}`, body);
      apply(r.quests);
      setError(null);
      if (action === 'claim' && r.reward) {
        const text = rewardText(r.reward);
        setNotice({ kind: 'success', text: r.replay ? 'Bu görevin ödülünü zaten almıştın.' : `Ödül alındı: ${text}` });
        if (!r.replay) cb.current.onReward?.(`${q.title}: ${text}`, r.reward.level, r.reward.levelUp);
      } else if (action === 'accept') setNotice({ kind: 'info', text: `"${q.title}" görev listene eklendi.` });
      else if (action === 'reroll') setNotice({ kind: 'info', text: `"${q.title}" yerine yeni bir görev geldi.` });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const byTab = useMemo(() => {
    const m: Record<QuestCategory, QuestView[]> = { main: [], daily: [], weekly: [], event: [] };
    for (const q of data?.quests ?? []) m[q.category].push(q);
    for (const k of TABS) m[k].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    return m;
  }, [data]);

  if (!data) {
    if (error instanceof ApiError && error.code === 'PILOT_NOT_FOUND') {
      return (
        <Alert kind="info">
          Görevleri görmek için önce bir pilot oluşturmalısın. <Link to="/pilot">Pilot oluştur</Link>
        </Alert>
      );
    }
    return error ? <ErrorAlert error={error} /> : <p className="muted" role="status">Görevler yükleniyor…</p>;
  }

  const now = nowMs + skew;
  const list = byTab[tab];
  const open = list.filter((q) => q.status !== 'claimed');
  const done = list.filter((q) => q.status === 'claimed');
  const rerolls = tab === 'daily' ? data.rerolls.daily : tab === 'weekly' ? data.rerolls.weekly : null;
  const rerollLeft = rerolls ? rerolls.max - rerolls.used : 0;

  return (
    <div className={`quest-board${compact ? ' compact' : ''}`} data-testid="quest-board">
      <div className="tabs" role="tablist" aria-label="Görev türleri">
        {TABS.map((t) => {
          const ready = byTab[t].filter((q) => q.status === 'completed').length;
          return (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)} data-testid={`quest-tab-${t}`}>
              {QUEST_CATEGORY_LABELS[t]}
              {ready > 0 && <span className="quest-ready-dot" aria-label={`${ready} ödül hazır`}>{ready}</span>}
            </button>
          );
        })}
      </div>

      <div className="quest-info muted small">
        {tab === 'daily' && <span>Günlük görevler {duration(new Date(data.cycles.nextDailyReset).getTime() - now)} sonra yenilenir (05:00 TSİ).</span>}
        {tab === 'weekly' && <span>Haftalık görevler {duration(new Date(data.cycles.nextWeeklyReset).getTime() - now)} sonra yenilenir (pazartesi 05:00 TSİ).</span>}
        {(tab === 'main' || tab === 'event') && (
          <span>
            Etkin ana/etkinlik görevi: {data.activeCount} / {data.maxActive}
          </span>
        )}
        {rerolls && (
          <span>
            {' '}
            · Yeniden çekme hakkı: {rerollLeft} / {rerolls.max}
          </span>
        )}
      </div>

      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {error !== null && <ErrorAlert error={error} />}

      {open.length === 0 && done.length === 0 && (
        <p className="muted">{tab === 'event' ? 'Şu anda açık bir etkinlik yok.' : 'Bu bölümde görev yok.'}</p>
      )}
      <ul className="quest-list" data-testid={`quest-list-${tab}`}>
        {open.map((q) => (
          <QuestCard key={`${q.code}:${q.cycle}`} q={q} busy={busy} compact={compact} rerollLeft={rerollLeft} onAct={act} now={now} />
        ))}
      </ul>
      {done.length > 0 && (
        <details className="quest-done">
          <summary>Tamamlanan görevler ({done.length})</summary>
          <ul className="quest-list">
            {done.map((q) => (
              <QuestCard key={`${q.code}:${q.cycle}`} q={q} busy={busy} compact={compact} rerollLeft={0} onAct={act} now={now} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function QuestCard({ q, busy, compact, rerollLeft, onAct, now }: {
  q: QuestView;
  busy: string | null;
  compact: boolean;
  rerollLeft: number;
  onAct: (a: 'accept' | 'abandon' | 'reroll' | 'claim', q: QuestView) => void;
  now: number;
}) {
  const isBusy = (a: string) => busy === `${a}:${q.code}:${q.cycle}`;
  const repeatable = q.category === 'daily' || q.category === 'weekly';
  const oldCycle = repeatable && q.status === 'completed' && q.cycle !== 'once';
  return (
    <li className={`quest quest-${q.status}`} data-testid={`quest-${q.code}`}>
      <div className="quest-head">
        <span className="quest-title">{q.title}</span>
        <span className={`badge ${STATUS_BADGE[q.status]}`}>{STATUS_LABEL[q.status]}</span>
      </div>
      {q.chain && (
        <div className="quest-chain small">
          {QUEST_CHAIN_NAMES[q.chain.code] ?? q.chain.code} · {q.chain.order}/{q.chain.total}
        </div>
      )}
      {!compact && <p className="quest-desc">{q.description}</p>}
      <ul className="quest-objectives">
        {q.objectives.map((o) => (
          <li key={o.id}>
            <div className="quest-obj-row">
              <span>{o.label}</span>
              <span className="mono">
                {fmt(o.current)} / {fmt(o.target)}
              </span>
            </div>
            <div className="bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (o.current / o.target) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="quest-rewards" aria-label="Ödüller">
        {q.rewards.map((r) => (
          <span key={`${r.type}:${r.code}`} className={`quest-reward reward-${r.code.toLowerCase().split('.')[0]}`}>
            {r.type === 'item' ? `${fmt(r.amount)} × ${r.name}` : `+${fmt(r.amount)} ${r.name}`}
          </span>
        ))}
      </div>
      {q.category === 'event' && q.endsAt && q.status !== 'locked' && <div className="muted small">Bitiş: {dateTime(q.endsAt)} ({new Date(q.endsAt).getTime() > now ? 'devam ediyor' : 'bitti'})</div>}
      {q.category === 'event' && q.status === 'locked' && q.startsAt && <div className="muted small">Başlangıç: {dateTime(q.startsAt)}</div>}
      {q.lockedReason && <div className="muted small">🔒 {q.lockedReason}</div>}
      {oldCycle && <div className="muted small">Önceki döngüden — ödülünü almayı unutma.</div>}
      <div className="quest-actions">
        {q.status === 'available' && (
          <button type="button" className="btn btn-secondary btn-small" disabled={busy !== null} onClick={() => onAct('accept', q)}>
            {isBusy('accept') ? 'Alınıyor…' : 'Kabul et'}
          </button>
        )}
        {q.status === 'completed' && (
          <button type="button" className="btn btn-claim btn-small" disabled={busy !== null} onClick={() => onAct('claim', q)}>
            {isBusy('claim') ? 'Alınıyor…' : 'Ödülü al'}
          </button>
        )}
        {q.status === 'active' && !repeatable && (
          <button type="button" className="btn btn-ghost btn-small" disabled={busy !== null} onClick={() => onAct('abandon', q)}>
            {isBusy('abandon') ? 'Bırakılıyor…' : 'Bırak'}
          </button>
        )}
        {q.status === 'active' && repeatable && rerollLeft > 0 && (
          <button type="button" className="btn btn-ghost btn-small" disabled={busy !== null} onClick={() => onAct('reroll', q)}>
            {isBusy('reroll') ? 'Çekiliyor…' : 'Yeniden çek'}
          </button>
        )}
      </div>
    </li>
  );
}
