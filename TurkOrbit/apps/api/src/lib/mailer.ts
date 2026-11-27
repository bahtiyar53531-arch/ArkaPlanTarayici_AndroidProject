import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  close?(): Promise<void>;
}

/** Gerçek SMTP gönderimi (üretim: kendi SMTP sunucun veya bir e-posta servis sağlayıcısı). */
export class SmtpMailer implements Mailer {
  private readonly transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}

/**
 * SADECE GELİŞTİRME: e-postayı göndermek yerine konsola yazar (bağlantıları terminalden kopyalayabilirsin).
 * Üretimde loadConfig() bu taşıyıcıyı reddeder.
 */
export class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    console.info(
      `\n[mail:dev] Kime: ${message.to}\n[mail:dev] Konu: ${message.subject}\n${message.text}\n[mail:dev] ----`,
    );
  }
}

/** Testlerde gönderilen e-postaları bellekte tutar. */
export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
  }

  clear(): void {
    this.outbox.length = 0;
  }

  lastTo(to: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
}
