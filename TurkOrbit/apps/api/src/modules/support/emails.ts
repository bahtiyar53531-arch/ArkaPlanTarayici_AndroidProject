import { BRAND } from '@turkorbit/shared';
import type { MailMessage } from '../../lib/mailer.js';
import { button, escapeHtml, layout } from '../auth/emails.js';

/** Destek ekibi yanıt verince oyuncuya gider. Yanıt metni e-postaya konmaz (hesaba giriş yapıp okunur). */
export function supportReplyEmail(to: string, username: string, ticketNo: string, url: string): MailMessage {
  const subject = `${BRAND.shortName}: Destek talebine yanıt geldi (${ticketNo})`;
  return {
    to,
    subject,
    text: `Merhaba ${username},\n\n${ticketNo} numaralı destek talebine ekibimiz yanıt verdi. Okumak ve yanıtlamak için:\n${url}\n\nBu e-postayı yanıtlama; yanıtını talep sayfasından yaz.\n`,
    html: layout(
      subject,
      `<p>Merhaba <b>${escapeHtml(username)}</b>,</p>
<p><b>${escapeHtml(ticketNo)}</b> numaralı destek talebine ekibimiz yanıt verdi.</p>
${button(url, 'Talebi aç')}
<p>Bu e-postayı yanıtlama; yanıtını talep sayfasından yaz. Ekip senden asla parolanı istemez.</p>`,
    ),
  };
}
