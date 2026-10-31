import { and, eq, inArray } from 'drizzle-orm';
import type { SentReply } from '@support-box/shared';
import type { CurrentUser } from '../auth/middleware';
import type { Db } from '../db';
import { replies, tickets, users } from '../db/schema';
import { MailError, replySubject, type Mailer } from '../mail/mailer';
import { canEdit } from './service';

// Agents can send once the ticket is with them; a failed AI call doesn't block a manual reply.
const SENDABLE = ['open', 'ai_error'] as const;

export type SendOutcome =
  | { ok: true }
  | { ok: false; status: number; error: string; message?: string };

const nowIso = () => new Date().toISOString();

/**
 * Sends the agent's reply. The reply row is written BEFORE the SMTP call; the unique
 * ticket_id index (or the conditional update on a failed row) is the double-send lock.
 * Nothing here is ever triggered automatically.
 */
export async function sendReply(
  db: Db,
  mailer: Mailer,
  user: CurrentUser,
  ticketId: number,
  body: string,
): Promise<SendOutcome> {
  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
  if (!ticket) return { ok: false, status: 404, error: 'not_found' };
  if (!canEdit(user, ticket.assigneeId)) return { ok: false, status: 403, error: 'forbidden' };

  const subject = replySubject(ticket.subject);
  const previousStatus = ticket.status;

  // Claim the send: create the record, or take over a previously failed one.
  const claimed = db.transaction((tx) => {
    const fresh = tx
      .select({ status: tickets.status })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .get();
    if (!fresh || !(SENDABLE as readonly string[]).includes(fresh.status)) return false;

    const values = {
      toEmail: ticket.fromEmail,
      subject,
      body,
      sentById: user.id,
      sentAt: nowIso(),
      mailMode: mailer.mode,
      deliveryStatus: 'pending' as const,
      deliveryError: null,
    };
    const existing = tx.select().from(replies).where(eq(replies.ticketId, ticketId)).get();
    if (existing) {
      const retried = tx
        .update(replies)
        .set(values)
        .where(and(eq(replies.ticketId, ticketId), eq(replies.deliveryStatus, 'failed')))
        .run();
      if (retried.changes === 0) return false;
    } else {
      tx.insert(replies).values({ ticketId, ...values }).run();
    }
    // The edited draft becomes the sent text (the AI original is not kept, by design).
    tx.update(tickets)
      .set({ status: 'replied', draft: body, updatedAt: nowIso() })
      .where(and(eq(tickets.id, ticketId), inArray(tickets.status, [...SENDABLE])))
      .run();
    return true;
  });

  if (!claimed) {
    const current = db.select({ status: tickets.status }).from(tickets).where(eq(tickets.id, ticketId)).get();
    return current?.status === 'replied'
      ? { ok: false, status: 409, error: 'already_sent' }
      : current?.status === 'closed'
        ? { ok: false, status: 409, error: 'ticket_closed' }
        : { ok: false, status: 409, error: 'not_ready' };
  }

  try {
    await mailer.send({ to: ticket.fromEmail, subject, text: body, inReplyTo: ticket.messageId });
  } catch (err) {
    const message = err instanceof MailError ? err.message : 'Sending failed';
    db.transaction((tx) => {
      tx.update(replies)
        .set({ deliveryStatus: 'failed', deliveryError: message })
        .where(eq(replies.ticketId, ticketId))
        .run();
      // Back to where it was, so the agent can fix the problem and send again.
      tx.update(tickets)
        .set({ status: previousStatus, updatedAt: nowIso() })
        .where(and(eq(tickets.id, ticketId), eq(tickets.status, 'replied')))
        .run();
    });
    console.warn(`Reply for ticket ${ticketId} failed: ${message}`);
    return { ok: false, status: 502, error: 'send_failed', message };
  }

  db.update(replies)
    .set({ deliveryStatus: 'sent', sentAt: nowIso() })
    .where(eq(replies.ticketId, ticketId))
    .run();
  // Who and when are in the replies table; the log line carries no content.
  console.log(`Reply for ticket ${ticketId} sent by user ${user.id} (${mailer.mode})`);
  return { ok: true };
}

export function getReply(db: Db, ticketId: number): SentReply | null {
  const row = db
    .select({
      body: replies.body,
      toEmail: replies.toEmail,
      subject: replies.subject,
      sentAt: replies.sentAt,
      mailMode: replies.mailMode,
      deliveryStatus: replies.deliveryStatus,
      deliveryError: replies.deliveryError,
      sentById: users.id,
      sentByName: users.name,
    })
    .from(replies)
    .innerJoin(users, eq(users.id, replies.sentById))
    .where(eq(replies.ticketId, ticketId))
    .get();
  if (!row) return null;
  const { sentById, sentByName, ...rest } = row;
  return { ...rest, sentBy: { id: sentById, name: sentByName } };
}

/** Saves an in-progress edit of the draft. */
export function saveDraft(db: Db, user: CurrentUser, ticketId: number, draft: string): SendOutcome {
  const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
  if (!ticket) return { ok: false, status: 404, error: 'not_found' };
  if (!canEdit(user, ticket.assigneeId)) return { ok: false, status: 403, error: 'forbidden' };
  const result = db
    .update(tickets)
    .set({ draft, updatedAt: nowIso() })
    .where(and(eq(tickets.id, ticketId), inArray(tickets.status, [...SENDABLE])))
    .run();
  if (result.changes === 0) return { ok: false, status: 409, error: 'not_editable' };
  return { ok: true };
}
