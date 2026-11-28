/**
 * Bildirim zili (Aşama 12): okunmamış sayısı 30 sn'de bir okunur; açılınca son bildirimler listelenir ve
 * okundu işaretlenir. Pilotu olmayan hesapta zil gösterilmez.
 */
import type { NotificationsResponse } from '@turkorbit/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { formatDate } from '../ui';

const SERVER = 'TR1';

export function NotificationBell() {
  const [unread, setUnread] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const poll = useCallback(() => {
    api<{ unread: number }>('GET', `/notifications/unread?server=${SERVER}`)
      .then((r) => setUnread(r.unread))
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'PILOT_NOT_FOUND') setUnread(null);
      });
  }, []);
  useEffect(() => {
    poll();
    const t = setInterval(poll, 30_000);
    return () => clearInterval(t);
  }, [poll]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (unread === null) return null;
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    try {
      const list = await api<NotificationsResponse>('GET', `/notifications?server=${SERVER}`);
      setData(list);
      if (list.unread > 0) {
        await api('POST', '/notifications/read', { serverCode: SERVER });
        setUnread(0);
      }
    } catch {
      setData({ items: [], unread: 0 });
    }
  };
  return (
    <div className="notif-wrap" ref={wrap}>
      <button type="button" className="btn btn-ghost notif-bell" aria-label={`Bildirimler${unread ? ` (${unread} okunmamış)` : ''}`} aria-expanded={open} onClick={() => void toggle()} data-testid="notif-bell">
        🔔
        {unread > 0 && <span className="quest-ready-dot" data-testid="notif-count">{Math.min(99, unread)}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Bildirimler" data-testid="notif-panel">
          {!data ? (
            <p className="muted small">Yükleniyor…</p>
          ) : data.items.length === 0 ? (
            <p className="muted small">Bildirim yok.</p>
          ) : (
            data.items.map((n) => {
              const body = (
                <>
                  <b>{n.title}</b>
                  {n.body && <span>{n.body}</span>}
                  <time>{formatDate(n.createdAt)}</time>
                </>
              );
              return n.link ? (
                <Link key={n.id} to={n.link} className={`notif-item${n.read ? '' : ' unread'}`} onClick={() => setOpen(false)}>
                  {body}
                </Link>
              ) : (
                <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`}>
                  {body}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
