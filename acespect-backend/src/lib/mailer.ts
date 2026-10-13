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

/** Why the last send failed, so the admin "Send test email" button can say more than "failed". Never contains the password. */
export let lastMailError: string | null = null;

/** What the admin page shows: whether email is set up, from where, through which server (the address only, never the credentials). */
export function mailStatus(): { configured: boolean; from: string; host: string | null } {
  let host: string | null = null;
  try { if (env.SMTP_URL) { const u = new URL(env.SMTP_URL); host = `${u.hostname}${u.port ? ':' + u.port : ''}`; } } catch { host = 'unreadable SMTP_URL'; }
  return { configured: !!env.SMTP_URL, from: env.MAIL_FROM, host };
}

/** Checks the connection and sign-in to the mail server without sending anything. Returns null when fine, else the reason. */
export async function verifyMail(): Promise<string | null> {
  if (!isMailConfigured()) return 'No mail server is set up (SMTP_URL is empty).';
  try { await transport().verify(); return null; } catch (err) { return err instanceof Error ? err.message : String(err); }
}

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
    lastMailError = null;
    return 'SENT';
  } catch (err) {
    lastMailError = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn('[mailer] send failed', lastMailError);
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
