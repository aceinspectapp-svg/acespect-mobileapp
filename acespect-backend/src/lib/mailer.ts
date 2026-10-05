import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

let transporter: Transporter | null = null;
export const isMailConfigured = () => !!env.SMTP_URL;

/** The last few messages this process was asked to send. Local development and tests read it; it is never filled in production. */
export const outbox: Array<{ to: string; subject: string; text: string }> = [];

function transport(): Transporter {
  transporter ??= nodemailer.createTransport(env.SMTP_URL);
  return transporter;
}

export type MailResult = 'SENT' | 'SKIPPED' | 'FAILED';

/**
 * Send an email. With no SMTP_URL configured the message is skipped (not an
 * error), so every flow still works with in-app notifications only.
 * Callers keep message bodies minimal: an event and a sign-in link, never
 * photos or detailed defect text (REQ-NOT-001).
 */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  if (env.NODE_ENV !== 'production') {
    outbox.push({ to, subject, text });
    if (outbox.length > 50) outbox.shift();
  }
  if (!isMailConfigured()) return 'SKIPPED';
  try {
    await transport().sendMail({ from: env.MAIL_FROM, to, subject, text, html });
    return 'SENT';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[mailer] send failed', err instanceof Error ? err.message : err);
    return 'FAILED';
  }
}

/** Optional SMS gateway webhook (REQ-NOT-003 option). */
export async function sendSms(to: string, message: string): Promise<MailResult> {
  if (!env.SMS_WEBHOOK_URL) return 'SKIPPED';
  try {
    const res = await fetch(env.SMS_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, message }) });
    return res.ok ? 'SENT' : 'FAILED';
  } catch {
    return 'FAILED';
  }
}
