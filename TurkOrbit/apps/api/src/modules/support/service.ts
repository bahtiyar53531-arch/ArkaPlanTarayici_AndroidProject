/**
 * Destek servisi (Aşama 13).
 *
 *  - Talep numarası `TO-<yıl>-<6 hane>` veritabanı DİZİSİNDEN üretilir: eşzamanlı isteklerde bile çakışmaz
 *    (ayrıca UNIQUE kısıt). Oyuncu yalnızca kendi taleplerini görür; personel `support.*` yetkileriyle.
 *  - Durum akışı: ekip yanıtı bekleniyor ⇄ oyuncu yanıtı bekleniyor → çözüldü → kapatıldı. Çözülen talebe
 *    oyuncu yazarsa yeniden açılır; kapatılan talebe yazılamaz. Çözülen talepler N gün sonra kendiliğinden kapanır.
 *  - Ek dosya: türü İÇERİKTEN tespit edilir (PNG/JPEG/WEBP/PDF/TXT), boyut sınırı, mesaj başına sayı sınırı ve
 *    yükleme süresi. Dosya veritabanına değil depoya yazılır; yalnızca yetkili kişi "indirme" olarak alır.
 *  - İç notlar oyuncuya hiçbir uçtan gösterilmez. Personel yanıtında oyuncuya bildirim + e-posta gider.
 */
import {
  detectFileType,
  sanitizeFileName,
  supportCreateSchema,
  supportReplySchema,
  supportStaffReplySchema,
  supportUpdateSchema,
  ticketNumber,
  ATTACHMENT_LABEL,
  ATTACHMENT_TYPES,
  TICKET_NO_REGEX,
  type AttachmentType,
  type SupportLimits,
  type SupportMessageView,
  type SupportTicketSummary,
  type SupportTicketView,
} from '@turkorbit/shared';
import { createHash } from 'node:crypto';
import { withTransaction, type Db, type Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import type { Mailer } from '../../lib/mailer.js';
import type { FileStore } from '../../lib/storage.js';
import { getSetting, userHasPermission } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import { Notifier, Outbox } from '../social/notifications.js';
import { supportReplyEmail } from './emails.js';

const err = (code: ConstructorParameters<typeof AppError>[0], status: number, message: string) => new AppError(code, status, message);
const fmtMb = (n: number) => `${(n / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;

export interface SupportSettings {
  max_attachment_bytes: number;
  max_attachments_per_message: number;
  attach_window_minutes: number;
  max_open_tickets: number;
  auto_close_days: number;
}
export const DEFAULT_SUPPORT: SupportSettings = {
  max_attachment_bytes: 5 * 1024 * 1024,
  max_attachments_per_message: 3,
  attach_window_minutes: 30,
  max_open_tickets: 5,
  auto_close_days: 7,
};

export interface SupportUser {
  id: string;
  username: string;
}

interface TicketRow {
  id: string;
  ticket_no: string;
  user_id: string;
  username: string;
  email: string;
  category: SupportTicketSummary['category'];
  subject: string;
  status: SupportTicketSummary['status'];
  priority: SupportTicketSummary['priority'];
  assigned: string | null;
  platform: string | null;
  app_version: string | null;
  created_at: Date;
  updated_at: Date;
}

const TICKET_SELECT = `SELECT t.id::text, t.ticket_no, t.user_id, u.username::text AS username, u.email::text AS email, t.category, t.subject, t.status, t.priority,
    a.username::text AS assigned, t.platform, t.app_version, t.created_at, t.updated_at
  FROM support_tickets t JOIN users u ON u.id = t.user_id LEFT JOIN users a ON a.id = t.assigned_to`;

export class SupportService {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly o: { notifier: Notifier; store: FileStore; mailer: Mailer; publicWebUrl: string; clock?: () => Date },
  ) {}

  private now() {
    return this.o.clock?.() ?? new Date();
  }

  async settings(c: Queryable = this.db): Promise<SupportSettings> {
    return { ...DEFAULT_SUPPORT, ...(await getSetting<Partial<SupportSettings>>(c, 'support')) };
  }

  async limits(): Promise<SupportLimits> {
    const s = await this.settings();
    return { maxAttachmentBytes: s.max_attachment_bytes, maxAttachmentsPerMessage: s.max_attachments_per_message, types: [...ATTACHMENT_TYPES] };
  }

  private summary(r: TicketRow, staff: boolean): SupportTicketSummary {
    return {
      ticketNo: r.ticket_no,
      category: r.category,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      ...(staff ? { user: r.username, assignedTo: r.assigned } : {}),
    };
  }

  /** Çözülmüş ve süresi geçmiş talepleri kapatır (liste açılırken çalışır; zamanlayıcı gerektirmez). */
  private async autoClose(c: Queryable) {
    const s = await this.settings(c);
    await c.query(
      `UPDATE support_tickets SET status = 'closed', closed_at = $1 WHERE status = 'resolved' AND resolved_at < $1::timestamptz - make_interval(days => $2)`,
      [this.now(), s.auto_close_days],
    );
  }

  private async ticketRow(c: Queryable, ticketNo: string, lock = false): Promise<TicketRow> {
    if (!TICKET_NO_REGEX.test(ticketNo)) throw err('TICKET_NOT_FOUND', 404, 'Destek talebi bulunamadı.');
    if (lock) await c.query('SELECT id FROM support_tickets WHERE ticket_no = $1 FOR UPDATE', [ticketNo]);
    const r = await c.query<TicketRow>(`${TICKET_SELECT} WHERE t.ticket_no = $1`, [ticketNo]);
    if (!r.rows[0]) throw err('TICKET_NOT_FOUND', 404, 'Destek talebi bulunamadı.');
    return r.rows[0];
  }

  /** Oyuncu yalnızca kendi talebini görür; başkasının talebi "bulunamadı" (varlığı sızmaz). */
  private async ownTicket(c: Queryable, user: SupportUser, ticketNo: string, lock = false) {
    const t = await this.ticketRow(c, ticketNo, lock);
    if (t.user_id !== user.id) throw err('TICKET_NOT_FOUND', 404, 'Destek talebi bulunamadı.');
    return t;
  }

  private async view(c: Queryable, t: TicketRow, viewer: SupportUser, staff: boolean): Promise<SupportTicketView> {
    const s = await this.settings(c);
    const msgs = await c.query<{ id: string; author_id: string | null; author: string | null; is_staff: boolean; is_internal_note: boolean; body: string; created_at: Date }>(
      `SELECT m.id::text, m.author_id, u.username::text AS author, m.is_staff, m.is_internal_note, m.body, m.created_at
       FROM support_messages m LEFT JOIN users u ON u.id = m.author_id
       WHERE m.ticket_id = $1 ${staff ? '' : 'AND NOT m.is_internal_note'} ORDER BY m.id`,
      [t.id],
    );
    const atts = await c.query<{ id: string; message_id: string; file_name: string; mime_type: AttachmentType; size_bytes: number }>(
      `SELECT id::text, message_id::text, file_name, mime_type, size_bytes FROM support_attachments WHERE ticket_id = $1 ORDER BY id`,
      [t.id],
    );
    const byMsg = new Map<string, SupportMessageView['attachments']>();
    for (const a of atts.rows) byMsg.set(a.message_id, [...(byMsg.get(a.message_id) ?? []), { id: Number(a.id), fileName: a.file_name, mimeType: a.mime_type, sizeBytes: a.size_bytes }]);
    const now = this.now().getTime();
    const messages: SupportMessageView[] = msgs.rows.map((m) => {
      const list = byMsg.get(m.id) ?? [];
      return {
        id: Number(m.id),
        // Oyuncuya personelin kullanıcı adı yerine "Türk Orbit Destek" gösterilir
        author: m.is_staff && !staff ? 'Türk Orbit Destek' : m.author,
        isStaff: m.is_staff,
        internal: m.is_internal_note,
        body: m.body,
        createdAt: m.created_at.toISOString(),
        attachments: list,
        canAttach:
          m.author_id === viewer.id && t.status !== 'closed' && list.length < s.max_attachments_per_message && now - m.created_at.getTime() <= s.attach_window_minutes * 60_000,
      };
    });
    const blocked = t.status === 'closed' ? 'Bu talep kapatıldı. Yeni bir sorun için yeni talep oluşturabilirsin.' : null;
    return { ...this.summary(t, staff), messages, platform: t.platform, appVersion: t.app_version, canReply: blocked === null, replyBlockedReason: blocked };
  }

  // ================================================================== oyuncu
  async myTickets(user: SupportUser): Promise<SupportTicketSummary[]> {
    await this.autoClose(this.db);
    const r = await this.db.query<TicketRow>(`${TICKET_SELECT} WHERE t.user_id = $1 ORDER BY t.updated_at DESC LIMIT 100`, [user.id]);
    return r.rows.map((x) => this.summary(x, false));
  }

  async create(user: SupportUser, input: unknown, client: { platform: string | null; version: string | null }): Promise<{ ticket: SupportTicketView; messageId: number }> {
    const b = supportCreateSchema.parse(input);
    return withTransaction(this.db, async (c) => {
      // Kullanıcı başına açık talep sınırı (aynı kullanıcının eşzamanlı istekleri sıraya girer)
      await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const s = await this.settings(c);
      const open = await c.query<{ n: string }>(`SELECT count(*) AS n FROM support_tickets WHERE user_id = $1 AND status NOT IN ('resolved', 'closed')`, [user.id]);
      if (Number(open.rows[0]!.n) >= s.max_open_tickets) {
        throw err('TICKET_LIMIT', 409, `Aynı anda en fazla ${s.max_open_tickets} açık talebin olabilir. Mevcut taleplerine yanıt verebilir veya çözülenleri kapatabilirsin.`);
      }
      const seq = Number((await c.query<{ n: string }>(`SELECT nextval('support_ticket_seq') AS n`)).rows[0]!.n);
      const no = ticketNumber(this.now().getFullYear(), seq);
      const t = await c.query<{ id: string }>(
        `INSERT INTO support_tickets (ticket_no, user_id, category, subject, platform, app_version, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
        [no, user.id, b.category, b.subject, client.platform?.slice(0, 20) ?? null, client.version?.slice(0, 40) ?? null, this.now()],
      );
      const m = await c.query<{ id: string }>(
        `INSERT INTO support_messages (ticket_id, author_id, is_staff, body, created_at) VALUES ($1, $2, false, $3, $4) RETURNING id::text`,
        [t.rows[0]!.id, user.id, b.body, this.now()],
      );
      this.log.info({ ticketNo: no, category: b.category }, 'destek talebi oluşturuldu');
      const row = await this.ticketRow(c, no);
      return { ticket: await this.view(c, row, user, false), messageId: Number(m.rows[0]!.id) };
    });
  }

  async ticket(user: SupportUser, ticketNo: string): Promise<SupportTicketView> {
    await this.autoClose(this.db);
    const t = await this.ownTicket(this.db, user, ticketNo);
    return this.view(this.db, t, user, false);
  }

  async reply(user: SupportUser, ticketNo: string, input: unknown): Promise<{ ticket: SupportTicketView; messageId: number }> {
    const b = supportReplySchema.parse(input);
    return withTransaction(this.db, async (c) => {
      const t = await this.ownTicket(c, user, ticketNo, true);
      if (t.status === 'closed') throw err('TICKET_CLOSED', 409, 'Bu talep kapatıldı. Yeni bir sorun için yeni talep oluşturabilirsin.');
      const m = await c.query<{ id: string }>(`INSERT INTO support_messages (ticket_id, author_id, is_staff, body, created_at) VALUES ($1, $2, false, $3, $4) RETURNING id::text`, [
        t.id,
        user.id,
        b.body,
        this.now(),
      ]);
      // Oyuncu yazınca talep ekibe döner (çözülmüş talep yeniden açılır)
      await c.query(`UPDATE support_tickets SET status = 'waiting_staff', resolved_at = NULL WHERE id = $1`, [t.id]);
      return { ticket: await this.view(c, await this.ticketRow(c, ticketNo), user, false), messageId: Number(m.rows[0]!.id) };
    });
  }

  async close(user: SupportUser, ticketNo: string): Promise<SupportTicketView> {
    return withTransaction(this.db, async (c) => {
      const t = await this.ownTicket(c, user, ticketNo, true);
      if (t.status !== 'closed') await c.query(`UPDATE support_tickets SET status = 'closed', closed_at = $2 WHERE id = $1`, [t.id, this.now()]);
      return this.view(c, await this.ticketRow(c, ticketNo), user, false);
    });
  }

  // ================================================================== ek dosyalar
  /**
   * Mesaja dosya ekler: yalnızca mesajın yazarı, yükleme süresi içinde, mesaj başına sınırla.
   * Tür içerikten tespit edilir; istemcinin bildirdiği tür/uzantı yok sayılır.
   */
  async attach(user: SupportUser, ticketNo: string, messageId: number, file: { name: string; bytes: Buffer }, staff: boolean) {
    const s = await this.settings();
    if (file.bytes.length === 0) throw err('VALIDATION_ERROR', 400, 'Dosya boş.');
    if (file.bytes.length > s.max_attachment_bytes) {
      throw err('ATTACHMENT_TOO_LARGE', 413, `Dosya en fazla ${fmtMb(s.max_attachment_bytes)} olabilir.`);
    }
    const type = detectFileType(new Uint8Array(file.bytes.buffer, file.bytes.byteOffset, file.bytes.length));
    if (!type) throw err('ATTACHMENT_TYPE', 415, `Bu dosya türü desteklenmiyor. İzin verilenler: ${ATTACHMENT_LABEL}.`);
    // Önce dosya depoya yazılır; veritabanı işlemi başarısız olursa depodan silinir (artık dosya kalmaz)
    const key = await this.o.store.put(file.bytes);
    try {
      return await withTransaction(this.db, async (c) => {
        const t = staff ? await this.ticketRow(c, ticketNo, true) : await this.ownTicket(c, user, ticketNo, true);
        if (t.status === 'closed') throw err('TICKET_CLOSED', 409, 'Kapatılan talebe dosya eklenemez.');
        const m = await c.query<{ author_id: string | null; created_at: Date }>(
          'SELECT author_id, created_at FROM support_messages WHERE id = $1 AND ticket_id = $2 FOR UPDATE',
          [messageId, t.id],
        );
        const msg = m.rows[0];
        if (!msg || msg.author_id !== user.id) throw err('NOT_FOUND', 404, 'Mesaj bulunamadı.');
        if (this.now().getTime() - msg.created_at.getTime() > s.attach_window_minutes * 60_000) {
          throw err('ATTACHMENT_LIMIT', 409, `Dosyalar mesaj gönderildikten sonraki ${s.attach_window_minutes} dakika içinde eklenebilir. Yeni bir mesajla ekleyebilirsin.`);
        }
        const n = await c.query<{ n: string }>('SELECT count(*) AS n FROM support_attachments WHERE message_id = $1', [messageId]);
        if (Number(n.rows[0]!.n) >= s.max_attachments_per_message) {
          throw err('ATTACHMENT_LIMIT', 409, `Bir mesaja en fazla ${s.max_attachments_per_message} dosya eklenebilir.`);
        }
        const fileName = sanitizeFileName(file.name, type);
        const ins = await c.query<{ id: string }>(
          `INSERT INTO support_attachments (ticket_id, message_id, uploaded_by, storage_key, file_name, mime_type, size_bytes, sha256)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
          [t.id, messageId, user.id, key, fileName, type, file.bytes.length, createHash('sha256').update(file.bytes).digest()],
        );
        return { id: Number(ins.rows[0]!.id), fileName, mimeType: type, sizeBytes: file.bytes.length };
      });
    } catch (e) {
      await this.o.store.remove(key).catch(() => undefined);
      throw e;
    }
  }

  /** İndirme: talep sahibi veya `support.read` yetkili personel. İç nota eklenen dosya yalnızca personele. */
  /** Ek dosyaya erişim denetimi: talep sahibi (iç notlar hariç) veya support.read yetkili personel. */
  private async authorizeAttachment(userId: string, attachmentId: number) {
    const r = await this.db.query<{ storage_key: string; file_name: string; mime_type: AttachmentType; owner: string; internal: boolean }>(
      `SELECT a.storage_key, a.file_name, a.mime_type, t.user_id AS owner, m.is_internal_note AS internal
       FROM support_attachments a JOIN support_tickets t ON t.id = a.ticket_id JOIN support_messages m ON m.id = a.message_id WHERE a.id = $1`,
      [attachmentId],
    );
    const a = r.rows[0];
    const staff = a ? await userHasPermission(this.db, userId, 'support.read') : false;
    if (!a || (!staff && (a.owner !== userId || a.internal))) throw err('NOT_FOUND', 404, 'Dosya bulunamadı.');
    return a;
  }

  /** Mobil uygulama için indirme izni denetimi (bağlantı üretmeden önce). */
  async assertCanDownload(user: SupportUser, attachmentId: number): Promise<void> {
    await this.authorizeAttachment(user.id, attachmentId);
  }

  async download(user: SupportUser, attachmentId: number): Promise<{ bytes: Buffer; fileName: string; mimeType: AttachmentType }> {
    const a = await this.authorizeAttachment(user.id, attachmentId);
    const bytes = await this.o.store.get(a.storage_key);
    if (!bytes) throw err('NOT_FOUND', 404, 'Dosya bulunamadı.');
    return { bytes, fileName: a.file_name, mimeType: a.mime_type };
  }

  // ================================================================== personel (destek masası)
  async queue(filter: { status?: string; category?: string; mine?: boolean }, staff: SupportUser): Promise<SupportTicketSummary[]> {
    await this.autoClose(this.db);
    const status = filter.status && /^[a-z_]{3,20}$/.test(filter.status) ? filter.status : null;
    const category = filter.category && /^[a-z_]{3,20}$/.test(filter.category) ? filter.category : null;
    const r = await this.db.query<TicketRow>(
      `${TICKET_SELECT}
       WHERE ($1::text IS NULL AND t.status NOT IN ('closed') OR t.status = $1) AND ($2::text IS NULL OR t.category = $2) AND (NOT $3 OR t.assigned_to = $4)
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                CASE t.status WHEN 'waiting_staff' THEN 0 WHEN 'waiting_player' THEN 1 ELSE 2 END, t.updated_at
       LIMIT 200`,
      [status, category, filter.mine === true, staff.id],
    );
    return r.rows.map((x) => this.summary(x, true));
  }

  async staffTicket(staff: SupportUser, ticketNo: string): Promise<SupportTicketView> {
    return this.view(this.db, await this.ticketRow(this.db, ticketNo), staff, true);
  }

  async staffReply(staff: SupportUser, ticketNo: string, input: unknown): Promise<{ ticket: SupportTicketView; messageId: number }> {
    const b = supportStaffReplySchema.parse(input);
    const out = new Outbox();
    let mail: { to: string; username: string } | null = null;
    const res = await withTransaction(this.db, async (c) => {
      const t = await this.ticketRow(c, ticketNo, true);
      if (t.status === 'closed' && !b.internal) throw err('TICKET_CLOSED', 409, 'Kapatılan talebe yanıt yazılamaz; önce durumunu değiştir.');
      const m = await c.query<{ id: string }>(
        `INSERT INTO support_messages (ticket_id, author_id, is_staff, is_internal_note, body, created_at) VALUES ($1, $2, true, $3, $4, $5) RETURNING id::text`,
        [t.id, staff.id, b.internal, b.body, this.now()],
      );
      if (!b.internal) {
        await c.query(`UPDATE support_tickets SET status = 'waiting_player', assigned_to = COALESCE(assigned_to, $2) WHERE id = $1`, [t.id, staff.id]);
        const pilots = await c.query<{ id: string }>('SELECT id FROM players WHERE user_id = $1', [t.user_id]);
        for (const p of pilots.rows) {
          await this.o.notifier.create(c, out, p.id, {
            kind: 'support_reply',
            title: `Destek talebine yanıt geldi (${t.ticket_no})`,
            body: t.subject,
            link: `/destek/${t.ticket_no}`,
          });
        }
        mail = { to: t.email, username: t.username };
      }
      return { ticket: await this.view(c, await this.ticketRow(c, ticketNo), staff, true), messageId: Number(m.rows[0]!.id) };
    });
    await this.o.notifier.flush(out);
    if (mail) {
      const { to, username } = mail;
      await this.o.mailer
        .send(supportReplyEmail(to, username, ticketNo, `${this.o.publicWebUrl}/destek/${ticketNo}`))
        .catch((e: unknown) => this.log.warn({ err: e, ticketNo }, 'destek yanıt e-postası gönderilemedi'));
    }
    return res;
  }

  async staffUpdate(staff: SupportUser, ticketNo: string, input: unknown): Promise<SupportTicketView> {
    const b = supportUpdateSchema.parse(input);
    return withTransaction(this.db, async (c) => {
      const t = await this.ticketRow(c, ticketNo, true);
      if (b.status && b.status !== t.status) {
        await c.query(
          `UPDATE support_tickets SET status = $2,
             resolved_at = CASE WHEN $2 = 'resolved' THEN $3::timestamptz ELSE NULL END,
             closed_at = CASE WHEN $2 = 'closed' THEN $3::timestamptz ELSE NULL END WHERE id = $1`,
          [t.id, b.status, this.now()],
        );
      }
      if (b.priority) await c.query('UPDATE support_tickets SET priority = $2 WHERE id = $1', [t.id, b.priority]);
      if (b.assignToMe !== undefined) await c.query('UPDATE support_tickets SET assigned_to = $2 WHERE id = $1', [t.id, b.assignToMe ? staff.id : null]);
      await c.query(
        `INSERT INTO admin_audit_log (actor_user_id, actor_label, action, target_type, target_id, before_value, after_value, result)
         VALUES ($1, $2, 'support.ticket.update', 'support_ticket', $3, $4, $5, 'success')`,
        [staff.id, staff.username, ticketNo, JSON.stringify({ status: t.status, priority: t.priority, assigned: t.assigned }), JSON.stringify(b)],
      );
      return this.view(c, await this.ticketRow(c, ticketNo), staff, true);
    });
  }
}
