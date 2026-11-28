/**
 * Oyun içi sosyal arayüz (Aşama 12): sohbet paneli (6 kanal), grup paneli, grup davetleri, pilot menüsü.
 * İzin, hız sınırı, filtre ve engelleme sunucudadır; burası yalnızca niyet gönderir ve gelenleri gösterir.
 */
import { CHAT_CHANNEL_LABELS, CHAT_CHANNELS, type ChatChannel, type ChatMessageView, type PartyMemberView } from '@turkorbit/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { GameController } from '../../game/controller';
import { ReportDialog, type ReportTarget } from '../social/ReportDialog';
import { useController } from './GameHud';

type ChatTab = 'all' | ChatChannel;
const TAB_LABELS: Record<ChatTab, string> = { all: 'Tümü', ...CHAT_CHANNEL_LABELS };
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

interface MenuState {
  name: string;
  message?: ChatMessageView;
}

/** Sohbet: kanal sekmeleri, mesaj listesi, yazma alanı. Ada tıklayınca pilot menüsü açılır. */
export function ChatPanel({ c, dm, setDm, autoFocusKey }: { c: GameController; dm: string; setDm: (name: string) => void; autoFocusKey?: number }) {
  useController(c);
  const [tab, setTab] = useState<ChatTab>('all');
  const [text, setText] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const me = c.map.pilot.pilotName;

  useEffect(() => {
    c.setChatOpen(true);
    return () => c.setChatOpen(false);
  }, [c]);
  useEffect(() => {
    if (autoFocusKey) input.current?.focus();
  }, [autoFocusKey]);
  // Özel mesaj hedefi seçilince sekme açılır ve geçmiş yüklenir
  useEffect(() => {
    if (dm) {
      setTab('dm');
      void c.loadDmHistory(dm);
    }
  }, [c, dm]);

  const lines = useMemo(
    () =>
      c.state.chat.filter((m) => {
        if (hidden.has(m.from.name)) return false;
        if (tab === 'all') return true;
        if (tab !== m.ch) return false;
        return tab !== 'dm' || !dm || m.from.name.toLowerCase() === dm.toLowerCase() || m.to?.toLowerCase() === dm.toLowerCase();
      }),
    [c.state.chat, tab, dm, hidden],
  );
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const channel: ChatChannel = tab === 'all' ? 'global' : tab;
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (channel === 'dm' && !dm) {
      c.toast('error', 'Özel mesaj için önce bir pilot adı yaz veya mesajdaki ada tıkla.');
      return;
    }
    c.sendChat(channel, text, dm || undefined);
    setText('');
  };
  const block = async (name: string) => {
    try {
      await api('POST', '/social/block', { serverCode: 'TR1', pilotName: name });
      setHidden((h) => new Set(h).add(name));
      c.toast('success', `${name} engellendi. Mesajları artık sana iletilmeyecek.`);
    } catch (err) {
      c.toast('error', err instanceof ApiError ? err.message : 'Engellenemedi.');
    }
  };

  return (
    <div className="chat" data-testid="chat-panel">
      <div className="chat-tabs" role="tablist" aria-label="Sohbet kanalları">
        {(['all', ...CHAT_CHANNELS] as ChatTab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`chat-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)} data-testid={`chat-tab-${t}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="chat-log" ref={log} aria-live="polite" data-testid="chat-log">
        {lines.length === 0 && <p className="chat-empty">{tab === 'dm' && !dm ? 'Bir pilotun adına tıkla veya aşağıya adını yaz.' : 'Henüz mesaj yok.'}</p>}
        {lines.map((m) => (
          <div key={m.id} className={`chat-line ch-${m.ch}`} data-testid="chat-line">
            <span className="chat-time">{fmtTime(m.at)}</span>
            {tab === 'all' && <span className="chat-ch">[{CHAT_CHANNEL_LABELS[m.ch]}]</span>}
            <button type="button" className="chat-name" onClick={() => m.from.name !== me && setMenu({ name: m.from.name, message: m })}>
              {m.from.clanTag ? `[${m.from.clanTag}] ` : ''}
              {m.from.name}
            </button>
            {m.ch === 'dm' && m.to && m.from.name === me && (
              <>
                {' → '}
                <button type="button" className="chat-name" onClick={() => setMenu({ name: m.to! })}>
                  {m.to}
                </button>
              </>
            )}
            <span className="chat-text">: {m.b}</span>
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={send}>
        {channel === 'dm' && (
          <input className="chat-to" value={dm} onChange={(e) => setDm(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20))} placeholder="Pilot adı" aria-label="Özel mesaj alıcısı" data-testid="chat-to" />
        )}
        <input
          ref={input}
          id="chat-input"
          className="chat-input"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
          placeholder={`${CHAT_CHANNEL_LABELS[channel]} kanala yaz…`}
          aria-label="Sohbet mesajı"
          data-testid="chat-input"
        />
        <button type="submit" className="btn btn-small btn-primary" data-testid="chat-send">
          Gönder
        </button>
      </form>
      {menu && (
        <PilotMenu
          c={c}
          name={menu.name}
          onClose={() => setMenu(null)}
          onDm={() => {
            setDm(menu.name);
            setMenu(null);
          }}
          onBlock={() => {
            void block(menu.name);
            setMenu(null);
          }}
          onReport={() => {
            setReport(
              menu.message
                ? { type: 'chat_message', id: String(menu.message.id), label: `${menu.message.from.name}: ${menu.message.b}` }
                : { type: 'player', id: menu.name, label: `Pilot: ${menu.name}` },
            );
            setMenu(null);
          }}
        />
      )}
      {report && <ReportDialog target={report} onClose={() => setReport(null)} onDone={(t) => c.toast('success', t)} />}
    </div>
  );
}

function PilotMenu({ c, name, onClose, onDm, onBlock, onReport }: { c: GameController; name: string; onClose: () => void; onDm: () => void; onBlock: () => void; onReport: () => void }) {
  const inParty = c.state.party?.members.some((m) => m.name === name);
  return (
    <div className="chat-menu-backdrop" onClick={onClose}>
      <div className="chat-menu" role="menu" aria-label={`${name} için işlemler`} data-testid="pilot-menu" onClick={(e) => e.stopPropagation()}>
        <div className="chat-menu-title">{name}</div>
        <button type="button" role="menuitem" onClick={onDm}>
          Özel mesaj
        </button>
        {!inParty && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              c.partyAction('invite', name);
              onClose();
            }}
          >
            Gruba davet et
          </button>
        )}
        <a role="menuitem" href={`/pilot/TR1/${encodeURIComponent(name)}`} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          Profili aç ↗
        </a>
        <button type="button" role="menuitem" onClick={onBlock}>
          Engelle
        </button>
        <button type="button" role="menuitem" className="danger" onClick={onReport} data-testid="menu-report">
          Şikâyet et
        </button>
      </div>
    </div>
  );
}

// ====================================================================== grup
function MemberRow({ c, m, leaderView }: { c: GameController; m: PartyMemberView; leaderView: boolean }) {
  const where = m.map ? `${m.map.code}${m.x !== null && m.y !== null ? ` · ${Math.round(m.x / 100)}/${Math.round(m.y / 100)}` : ''}` : 'Konum gizli';
  return (
    <div className={`party-member${m.online ? '' : ' offline'}${m.you ? ' you' : ''}`} data-testid={`party-member-${m.name}`}>
      <div className="party-member-head">
        <b>
          {m.leader ? '★ ' : ''}
          {m.name}
        </b>
        <span className="hud-level">Sv {m.level}</span>
      </div>
      {m.online && m.hp !== null ? (
        <div className="party-bars">
          <div className="hud-bar hp tiny">
            <span style={{ width: `${m.hp}%` }} />
          </div>
          <div className="hud-bar sh tiny">
            <span style={{ width: `${m.sh ?? 0}%` }} />
          </div>
        </div>
      ) : (
        <div className="party-offline">Bağlantı yok</div>
      )}
      <div className="party-where" data-testid={`party-where-${m.name}`}>
        {where}
      </div>
      {leaderView && !m.you && (
        <div className="party-actions">
          <button type="button" className="btn btn-tiny btn-ghost" onClick={() => c.partyAction('promote', m.name)}>
            Lider yap
          </button>
          <button type="button" className="btn btn-tiny btn-ghost" onClick={() => c.partyAction('kick', m.name)}>
            Çıkar
          </button>
        </div>
      )}
    </div>
  );
}

/** Grup paneli: üyeler, can/kalkan, konum (üyenin iznine göre), davet, ayrılma. */
export function PartyPanel({ c }: { c: GameController }) {
  useController(c);
  const [name, setName] = useState('');
  const p = c.state.party;
  if (!p) return null;
  const leader = p.members.find((m) => m.you)?.leader ?? false;
  return (
    <div className="hud-panel hud-party" data-testid="party-panel">
      <div className="hud-party-head">
        <b>Grup</b>
        <span className="muted small">
          {p.members.length}/{p.max}
        </span>
        <button type="button" className="btn btn-tiny btn-ghost" onClick={() => c.partyAction('leave')} data-testid="party-leave">
          Ayrıl
        </button>
      </div>
      {p.members.map((m) => (
        <MemberRow key={m.name} c={c} m={m} leaderView={leader} />
      ))}
      {leader && p.members.length < p.max && (
        <form
          className="party-invite"
          onSubmit={(e) => {
            e.preventDefault();
            if (name) c.partyAction('invite', name);
            setName('');
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20))} placeholder="Pilot adı" aria-label="Gruba davet edilecek pilot" />
          <button type="submit" className="btn btn-tiny btn-secondary">
            Davet et
          </button>
        </form>
      )}
    </div>
  );
}

/** Gelen grup davetleri (süreleri dolunca kaybolur). */
export function PartyInvites({ c }: { c: GameController }) {
  useController(c);
  const [, setTick] = useState(0);
  const list = c.state.partyInvites.filter((i) => i.expiresAt > Date.now());
  useEffect(() => {
    if (list.length === 0) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [list.length]);
  if (list.length === 0) return null;
  return (
    <div className="party-invites">
      {list.map((i) => (
        <div key={i.from} className="hud-panel party-invite-card" role="alertdialog" aria-label="Grup daveti" data-testid="party-invite">
          <div>
            <b>{i.from}</b> <span className="muted small">(Sv {i.level} · {i.company})</span> seni gruba davet ediyor.
            <span className="muted small"> {Math.max(0, Math.ceil((i.expiresAt - Date.now()) / 1000))} sn</span>
          </div>
          <div className="party-invite-actions">
            <button type="button" className="btn btn-small btn-primary" onClick={() => c.partyAction('accept', i.from)} data-testid="party-accept">
              Kabul et
            </button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => c.partyAction('decline', i.from)}>
              Reddet
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Masaüstü: sol altta açılır-kapanır sohbet; telefon: çekmece (GamePage açar). */
export function ChatDock({ c, dm, setDm, focusKey }: { c: GameController; dm: string; setDm: (n: string) => void; focusKey: number }) {
  useController(c);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (focusKey) setOpen(true);
  }, [focusKey]);
  return (
    <div className={`hud-panel hud-chat${open ? '' : ' collapsed'}`}>
      <button type="button" className="hud-chat-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="chat-toggle">
        💬 Sohbet {!open && c.state.chatUnread > 0 ? `(${c.state.chatUnread})` : ''} <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <ChatPanel c={c} dm={dm} setDm={setDm} autoFocusKey={focusKey} />}
    </div>
  );
}
