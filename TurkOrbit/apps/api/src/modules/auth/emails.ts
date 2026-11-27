import { BRAND, SUSPICIOUS_REASON_LABELS_TR } from '@turkorbit/shared';
import type { MailMessage } from '../../lib/mailer.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#060a18;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#e6ecff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#060a18;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0d1530;border:1px solid #23305e;border-radius:12px">
<tr><td style="padding:24px 28px;border-bottom:1px solid #23305e">
<div style="font-size:22px;font-weight:800;letter-spacing:3px;color:#ffffff">${BRAND.gameName}</div>
<div style="font-size:12px;color:#7f8bb8;letter-spacing:1px">${BRAND.domain}</div>
</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6;color:#d7def7">${bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #23305e;font-size:12px;color:#7f8bb8">
Bu e-posta ${BRAND.gameName} hesabınla ilgili bir işlem nedeniyle otomatik gönderildi. Yanıtlama.
Yardım için: ${BRAND.supportEmail}
</td></tr></table></td></tr></table></body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#e30a17;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#7f8bb8;word-break:break-all">Buton çalışmazsa bu bağlantıyı tarayıcına yapıştır:<br>${escapeHtml(url)}</p>`;
}

export function verificationEmail(to: string, username: string, url: string): MailMessage {
  const subject = `${BRAND.shortName}: E-posta adresini doğrula`;
  return {
    to,
    subject,
    text:
      `Merhaba ${username},\n\n${BRAND.gameName} hesabını etkinleştirmek için e-posta adresini doğrula:\n${url}\n\n` +
      'Bu bağlantı 24 saat geçerlidir. Bu kaydı sen yapmadıysan bu e-postayı yok sayabilirsin.\n',
    html: layout(
      subject,
      `<p>Merhaba <b>${escapeHtml(username)}</b>,</p>
<p>Galaksiye hoş geldin pilot! Hesabını etkinleştirmek için e-posta adresini doğrula.</p>
${button(url, 'E-postamı doğrula')}
<p>Bu bağlantı <b>24 saat</b> geçerlidir. Bu kaydı sen yapmadıysan bu e-postayı yok sayabilirsin.</p>`,
    ),
  };
}

export function alreadyRegisteredEmail(to: string, loginUrl: string, resetUrl: string): MailMessage {
  const subject = `${BRAND.shortName}: Bu e-posta ile zaten bir hesabın var`;
  return {
    to,
    subject,
    text:
      `Birisi bu e-posta adresiyle yeni bir ${BRAND.gameName} hesabı açmaya çalıştı, ancak bu adresle zaten bir hesabın var.\n\n` +
      `Giriş yap: ${loginUrl}\nParolanı mı unuttun? ${resetUrl}\n\nBu denemeyi sen yapmadıysan bir şey yapmana gerek yok.\n`,
    html: layout(
      subject,
      `<p>Birisi bu e-posta adresiyle yeni bir hesap açmaya çalıştı, ancak bu adresle <b>zaten bir hesabın var</b>.</p>
${button(loginUrl, 'Giriş yap')}
<p>Parolanı mı unuttun? <a style="color:#5fd4ff" href="${escapeHtml(resetUrl)}">Parolanı sıfırla</a>.</p>
<p>Bu denemeyi sen yapmadıysan bir şey yapmana gerek yok.</p>`,
    ),
  };
}

export function passwordResetEmail(to: string, username: string, url: string): MailMessage {
  const subject = `${BRAND.shortName}: Parola sıfırlama isteği`;
  return {
    to,
    subject,
    text:
      `Merhaba ${username},\n\nParolanı sıfırlamak için şu bağlantıyı aç:\n${url}\n\n` +
      'Bağlantı 30 dakika geçerlidir ve yalnızca bir kez kullanılabilir. Bu isteği sen yapmadıysan bu e-postayı yok say; parolan değişmez.\n',
    html: layout(
      subject,
      `<p>Merhaba <b>${escapeHtml(username)}</b>,</p>
<p>Hesabın için bir parola sıfırlama isteği aldık.</p>
${button(url, 'Yeni parola belirle')}
<p>Bağlantı <b>30 dakika</b> geçerlidir ve yalnızca bir kez kullanılabilir. Bu isteği sen yapmadıysan bu e-postayı yok say; parolan değişmez.</p>`,
    ),
  };
}

export function passwordChangedEmail(to: string, username: string, when: Date, resetUrl: string): MailMessage {
  const subject = `${BRAND.shortName}: Parolan değiştirildi`;
  const ts = when.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  return {
    to,
    subject,
    text:
      `Merhaba ${username},\n\nHesabının parolası ${ts} (TSİ) tarihinde değiştirildi ve diğer tüm cihazlardaki oturumlar kapatıldı.\n` +
      `Bu değişikliği sen yapmadıysan hemen parolanı sıfırla: ${resetUrl}\n`,
    html: layout(
      subject,
      `<p>Merhaba <b>${escapeHtml(username)}</b>,</p>
<p>Hesabının parolası <b>${escapeHtml(ts)}</b> (TSİ) tarihinde değiştirildi ve diğer cihazlardaki oturumlar kapatıldı.</p>
<p>Bu değişikliği <b>sen yapmadıysan</b> hemen parolanı sıfırla:</p>
${button(resetUrl, 'Parolamı sıfırla')}`,
    ),
  };
}

export function suspiciousLoginEmail(
  to: string,
  username: string,
  info: { when: Date; device: string; ipMasked: string | null; reasons: string[] },
  securityUrl: string,
): MailMessage {
  const subject = `${BRAND.shortName}: Hesabına yeni bir cihazdan giriş yapıldı`;
  const ts = info.when.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const reasons = info.reasons.map((r) => SUSPICIOUS_REASON_LABELS_TR[r] ?? r).join(', ');
  return {
    to,
    subject,
    text:
      `Merhaba ${username},\n\nHesabına alışılmadık bir girişi tespit ettik.\nZaman: ${ts} (TSİ)\nCihaz: ${info.device}\n` +
      `IP: ${info.ipMasked ?? 'bilinmiyor'}\nNeden: ${reasons}\n\nBu sen değilsen hemen parolanı değiştir ve oturumlarını kapat: ${securityUrl}\n`,
    html: layout(
      subject,
      `<p>Merhaba <b>${escapeHtml(username)}</b>,</p>
<p>Hesabına alışılmadık bir giriş tespit ettik:</p>
<ul><li>Zaman: <b>${escapeHtml(ts)}</b> (TSİ)</li><li>Cihaz: <b>${escapeHtml(info.device)}</b></li>
<li>IP: <b>${escapeHtml(info.ipMasked ?? 'bilinmiyor')}</b></li><li>Neden: ${escapeHtml(reasons)}</li></ul>
<p>Bu sen değilsen hemen parolanı değiştir ve diğer oturumları kapat.</p>
${button(securityUrl, 'Hesap güvenliğine git')}`,
    ),
  };
}

export function lockoutEmail(to: string, username: string, minutes: number, resetUrl: string): MailMessage {
  const subject = `${BRAND.shortName}: Çok sayıda başarısız giriş denemesi`;
  return {
    to,
    subject,
    text:
      `Merhaba ${username},\n\nHesabına art arda çok sayıda hatalı parola ile giriş denendi. Güvenliğin için girişler ${minutes} dakika durduruldu.\n` +
      `Bu sen değilsen parolanı sıfırlaman önerilir: ${resetUrl}\n`,
    html: layout(
      subject,
      `<p>Merhaba <b>${escapeHtml(username)}</b>,</p>
<p>Hesabına art arda çok sayıda hatalı parola ile giriş denendi. Güvenliğin için girişler <b>${minutes} dakika</b> durduruldu.</p>
<p>Bu sen değilsen parolanı sıfırlaman önerilir.</p>${button(resetUrl, 'Parolamı sıfırla')}`,
    ),
  };
}
