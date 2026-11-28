/**
 * Bildirimler (Aşama 12): veritabanına yazılır (web sayfasındaki zil), pilot oyundaysa oyun sunucusu üzerinden
 * anında iletilir. Bildirim transaction içinde oluşturulur; anlık iletim transaction BİTTİKTEN sonra yapılır
 * (geri alınan bir işlemin bildirimi gönderilmez).
 */
import type { NotificationView, NotificationsResponse } from '@turkorbit/shared';
import type { Db, Queryable } from '../../db/pool.js';
import type { GameBridge } from '../game/bridge.js';

export interface NewNotification {
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  data?: Record<string, unknown>;
}

interface Row {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
}

const view = (r: Row): NotificationView => ({
  id: Number(r.id),
  kind: r.kind,
  title: r.title,
  body: r.body,
  link: r.link,
  read: r.read_at !== null,
  createdAt: r.created_at.toISOString(),
});

/** Bir işlem boyunca oluşturulan bildirimler; işlem bitince `flush` ile anlık iletilir. */
export class Outbox {
  readonly items: Array<{ playerId: string; n: NotificationView }> = [];
  /** Oyun sunucusunun sosyal bilgisini (klan, engel, ayar) yeniden okuması gereken pilotlar */
  readonly social = new Set<string>();
  /** Diplomasisi değişen klanlar */
  readonly relations = new Set<string>();
  /** Doğrudan iletilecek ham mesajlar */
  readonly raw: Array<{ playerId: string; msg: unknown }> = [];
}

export class Notifier {
  constructor(
    private readonly bridge: GameBridge | null,
    private readonly keep = 200,
  ) {}

  /** Transaction içinde çağrılır. */
  async create(c: Queryable, out: Outbox, playerId: string, n: NewNotification): Promise<void> {
    const r = await c.query<Row>(
      `INSERT INTO notifications (player_id, kind, title, body, link, data) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text, kind, title, body, link, read_at, created_at`,
      [playerId, n.kind, n.title.slice(0, 120), n.body ? n.body.slice(0, 300) : null, n.link ?? null, JSON.stringify(n.data ?? {})],
    );
    out.items.push({ playerId, n: view(r.rows[0]!) });
  }

  /** Transaction bittikten sonra: anlık iletim ve oyun sunucusu bilgilendirmesi. Hata işlemi geri almaz. */
  async flush(out: Outbox): Promise<void> {
    if (!this.bridge) return;
    const tasks: Array<Promise<unknown>> = [];
    for (const it of out.items) tasks.push(this.bridge.deliver(it.playerId, { t: 'notif', n: it.n }));
    for (const it of out.raw) tasks.push(this.bridge.deliver(it.playerId, it.msg));
    for (const id of out.social) tasks.push(this.bridge.notifyPlayerUpdated(id, 'social'));
    if (out.relations.size) tasks.push(this.bridge.notifyRelationsChanged([...out.relations]));
    await Promise.all(tasks);
  }

  async list(db: Queryable, playerId: string, limit = 30): Promise<NotificationsResponse> {
    const [items, unread] = await Promise.all([
      db.query<Row>(
        `SELECT id::text, kind, title, body, link, read_at, created_at FROM notifications WHERE player_id = $1 ORDER BY id DESC LIMIT $2`,
        [playerId, limit],
      ),
      db.query<{ n: string }>(`SELECT count(*) AS n FROM notifications WHERE player_id = $1 AND read_at IS NULL`, [playerId]),
    ]);
    return { items: items.rows.map(view), unread: Number(unread.rows[0]!.n) };
  }

  async unread(db: Queryable, playerId: string): Promise<number> {
    const r = await db.query<{ n: string }>(`SELECT count(*) AS n FROM notifications WHERE player_id = $1 AND read_at IS NULL`, [playerId]);
    return Number(r.rows[0]!.n);
  }

  /** ids yoksa tümü okundu sayılır. Yalnızca pilotun kendi bildirimleri etkilenir. */
  async markRead(db: Queryable, playerId: string, ids?: number[]): Promise<number> {
    const r = ids?.length
      ? await db.query(`UPDATE notifications SET read_at = now() WHERE player_id = $1 AND read_at IS NULL AND id = ANY($2::bigint[])`, [playerId, ids])
      : await db.query(`UPDATE notifications SET read_at = now() WHERE player_id = $1 AND read_at IS NULL`, [playerId]);
    return r.rowCount ?? 0;
  }

  /** Pilot başına en yeni `keep` bildirim tutulur (eskiler silinir). */
  async prune(db: Db | Queryable, playerId: string): Promise<void> {
    await db.query(
      `DELETE FROM notifications WHERE player_id = $1 AND id < (
         SELECT id FROM notifications WHERE player_id = $1 ORDER BY id DESC OFFSET $2 LIMIT 1)`,
      [playerId, this.keep - 1],
    );
  }
}
