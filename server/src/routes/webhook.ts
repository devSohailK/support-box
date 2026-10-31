import { createHash, timingSafeEqual } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import { eq } from 'drizzle-orm';
import { inboundEmailSchema, type InboundEmail, type WebhookResponse } from '@support-box/shared';
import type { TriageRunner } from '../ai/triage';
import type { Db } from '../db';
import { tickets } from '../db/schema';
import { validate } from '../middleware/validate';
import { junkReason } from '../tickets/junk';
import { createTicket } from '../tickets/service';

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time check of X-Webhook-Secret, before the body is even parsed. */
function requireWebhookSecret(secret: string): RequestHandler {
  const expected = sha256(secret);
  return (req, res, next) => {
    const given = req.get('x-webhook-secret');
    if (!given || !timingSafeEqual(sha256(given), expected)) {
      res.status(401).json({ error: 'invalid_webhook_secret' });
      return;
    }
    next();
  };
}

const findByMessageId = (db: Db, messageId: string) =>
  db.select({ id: tickets.id }).from(tickets).where(eq(tickets.messageId, messageId)).get();

export function webhookRouter(db: Db, secret: string, triage: TriageRunner) {
  const router = Router();

  router.post(
    '/email',
    requireWebhookSecret(secret),
    // Larger limit than the rest of the API: real emails can be long; we truncate after parsing.
    express.json({ limit: '1mb' }),
    validate({ body: inboundEmailSchema }),
    (_req, res) => {
      const email = res.locals.validated.body as InboundEmail;

      // Redelivery of the same email: acknowledge, but no new ticket and no new AI call.
      const existing = findByMessageId(db, email.messageId);
      if (existing) {
        res.status(200).json({ status: 'duplicate', ticketId: existing.id } satisfies WebhookResponse);
        return;
      }

      try {
        const ticket = createTicket(db, {
          source: 'webhook',
          messageId: email.messageId,
          fromEmail: email.from,
          fromName: email.fromName,
          subject: email.subject,
          body: email.body,
          aiSkipReason: junkReason(email),
        });
        // Respond now; the single AI call happens in the background.
        triage.enqueue(ticket.id);
        res.status(202).json({ status: 'accepted', ticketId: ticket.id } satisfies WebhookResponse);
      } catch (err) {
        // Two deliveries racing past the check above: the unique index wins.
        const raced = findByMessageId(db, email.messageId);
        if (raced) {
          res.status(200).json({ status: 'duplicate', ticketId: raced.id } satisfies WebhookResponse);
          return;
        }
        throw err;
      }
    },
  );

  return router;
}
