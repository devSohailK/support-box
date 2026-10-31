import nodemailer from 'nodemailer';
import type { Config } from '../config';

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  // Message-ID of the customer's email, so the reply threads in their mail client.
  inReplyTo?: string | null;
};

export type Mailer = {
  mode: 'demo' | 'production';
  send(mail: OutgoingMail): Promise<void>;
};

/** Errors safe to show agents: no credentials, no server dumps. */
export class MailError extends Error {}

type MailConfig = Pick<
  Config,
  | 'MAIL_MODE'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_SECURE'
  | 'SMTP_USER'
  | 'SMTP_PASSWORD'
  | 'SMTP_FROM'
  | 'SMTP_REPLY_TO'
>;

export function createMailer(config: MailConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE, // true for 465; false uses STARTTLS when offered (587)
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    mode: config.MAIL_MODE,
    async send(mail) {
      try {
        await transport.sendMail({
          from: config.SMTP_FROM,
          replyTo: config.SMTP_REPLY_TO || undefined,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          inReplyTo: mail.inReplyTo ?? undefined,
          references: mail.inReplyTo ?? undefined,
        });
      } catch (err) {
        const code = (err as { code?: string; responseCode?: number })?.code;
        const reason =
          code === 'EAUTH' ? 'SMTP login failed (check SMTP_USER / SMTP_PASSWORD)' :
          code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ETIMEDOUT' || code === 'EDNS'
            ? 'Could not connect to the mail server'
            : code === 'EENVELOPE' ? 'The recipient address was rejected'
            : 'The mail server refused the message';
        throw new MailError(reason);
      }
    },
  };
}

export function replySubject(subject: string) {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}
