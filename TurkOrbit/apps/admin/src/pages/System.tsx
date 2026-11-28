import type { GameNodeStatus } from '@turkorbit/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ActionDialog, Alert, Badge, Empty, Page, fmt, formatDate, useLoad } from '../ui';

interface SystemState {
  nodes: GameNodeStatus[];
  api: { uptimeSec: number; rssMb: number; dbMs: number; redisMs: number };
  maintenance: { enabled: boolean; message: string };
  online: number;
}

export function SystemPage() {
  const { can } = useAuth();
  const { data, error, reload } = useLoad(() => api<SystemState>('GET', '/admin/system'), []);
  const [dlg, setDlg] = useState<'on' | 'off' | 'broadcast' | null>(null);
  const [message, setMessage] = useState('Türk Orbit bakımda. Kısa süre içinde geri döneceğiz.');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(reload, 10_000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    if (data?.maintenance.enabled) setMessage(data.maintenance.message);
  }, [data?.maintenance.enabled, data?.maintenance.message]);
  return (
    <Page title="Sunucular ve bakım">
      {error && <Alert>{error}</Alert>}
      {msg && <Alert kind="success" testId="system-msg">{msg}</Alert>}
      {data && (
        <>
          <div className="card">
            <h2>Bakım modu {data.maintenance.enabled ? <Badge kind="danger">AÇIK</Badge> : <Badge kind="ok">kapalı</Badge>}</h2>
            <p className="muted small">Açıkken oyuna yalnızca personel girebilir; oyundaki oyuncular mesajla çıkarılır. Site, forum ve destek açık kalır.</p>
            {can('system.maintenance') ? (
              <>
                <label className="field">
                  <span className="field-label">Oyunculara gösterilecek mesaj</span>
                  <input value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)} data-testid="maint-message" />
                </label>
                {data.maintenance.enabled ? (
                  <button type="button" className="btn btn-primary" onClick={() => setDlg('off')} data-testid="maint-off">Bakımı bitir</button>
                ) : (
                  <button type="button" className="btn btn-danger" disabled={message.trim().length < 5} onClick={() => setDlg('on')} data-testid="maint-on">Bakım modunu aç</button>
                )}
              </>
            ) : (
              <p className="small">Mesaj: {data.maintenance.message}</p>
            )}
          </div>
          {can('system.notifications') && (
            <div className="card">
              <h2>Oyun içi duyuru</h2>
              <p className="muted small">Tüm oyun sunucularındaki çevrimiçi pilotlara anında gösterilir ({fmt(data.online)} pilot çevrimiçi).</p>
              <div className="inline">
                <input value={text} maxLength={200} placeholder="Duyuru metni" onChange={(e) => setText(e.target.value)} data-testid="broadcast-text" />
                <button type="button" className="btn btn-secondary" disabled={text.trim().length < 3} onClick={() => setDlg('broadcast')} data-testid="broadcast-send">Gönder</button>
              </div>
            </div>
          )}
          <div className="card">
            <h2>Oyun sunucusu süreçleri</h2>
            {data.nodes.length === 0 ? (
              <Empty>Son 15 saniyede nabız gönderen oyun sunucusu yok.</Empty>
            ) : (
              <table className="table" data-testid="system-nodes">
                <thead><tr><th>Süreç</th><th>Başlangıç</th><th>Son nabız</th><th>Bağlantı</th><th>Pilot</th><th>Haritalar</th><th>NPC</th><th>Tik</th><th>Bellek</th></tr></thead>
                <tbody>
                  {data.nodes.map((n) => (
                    <tr key={n.id}>
                      <td className="mono small">{n.id}</td>
                      <td className="small">{formatDate(n.startedAt)}</td>
                      <td className="small">{formatDate(n.at)}</td>
                      <td>{fmt(n.connections)}</td>
                      <td>{fmt(n.players)}</td>
                      <td className="small">{Object.entries(n.maps).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</td>
                      <td>{fmt(n.npcs)}</td>
                      <td>{n.tickMs} ms</td>
                      <td>{fmt(n.rssMb)} MB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small muted">
              API süreci: {Math.floor(data.api.uptimeSec / 60)} dk çalışıyor · {fmt(data.api.rssMb)} MB · PostgreSQL {data.api.dbMs} ms · Redis{' '}
              {data.api.redisMs >= 0 ? `${data.api.redisMs} ms` : 'bağlı değil'}
            </p>
            <p className="small muted">Sunucu başlatma/durdurma ve yedekleme bu panelden yapılmaz (kabuk komutu çalıştırılmaz); kurulum rehberindeki systemd/yedek adımları kullanılır.</p>
          </div>
        </>
      )}
      {dlg && (
        <ActionDialog
          title={dlg === 'on' ? 'Bakım modunu aç' : dlg === 'off' ? 'Bakımı bitir' : 'Duyuru gönder'}
          description={dlg === 'on' ? 'Oyundaki tüm oyuncular (personel hariç) mesajla çıkarılacak.' : dlg === 'broadcast' ? `“${text}”` : undefined}
          confirm={dlg === 'broadcast' ? 'Gönder' : 'Onayla'}
          danger={dlg === 'on'}
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            if (dlg === 'broadcast') {
              const r = await api<{ online: number }>('POST', '/admin/system/broadcast', { text: text.trim(), reason: v.reason });
              setMsg(`Duyuru gönderildi (${fmt(r.online)} çevrimiçi pilot).`);
              setText('');
            } else {
              await api('POST', '/admin/system/maintenance', { enabled: dlg === 'on', message: dlg === 'on' ? message.trim() : 'Bakım tamamlandı.', reason: v.reason });
              setMsg(dlg === 'on' ? 'Bakım modu açıldı.' : 'Bakım modu kapatıldı.');
            }
            reload();
          }}
        />
      )}
    </Page>
  );
}
