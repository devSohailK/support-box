import type { InboundEmail } from '@support-box/shared';

const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([+.-].*)?@/i;
const BULK_PRECEDENCE = /^(bulk|junk|list|auto_reply)$/i;

/**
 * Returns why an email should skip the AI call, or null if it should be triaged.
 * The ticket is still created so nothing disappears silently.
 */
export function junkReason(email: Pick<InboundEmail, 'from' | 'body' | 'headers'>): string | null {
  if (!email.body) return 'empty body';
  if (AUTOMATED_SENDER.test(email.from)) return 'automated sender';
  const autoSubmitted = email.headers?.autoSubmitted?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return 'auto-submitted';
  if (email.headers?.precedence && BULK_PRECEDENCE.test(email.headers.precedence.trim())) {
    return 'bulk or auto-reply';
  }
  return null;
}
