import { Router } from 'express';
import { and, eq, lt, ne, sql } from 'drizzle-orm';
import {
  createTicketSchema,
  reassignSchema,
  saveDraftSchema,
  sendReplySchema,
  ticketIdParamsSchema,
  ticketListQuerySchema,
  type CreateTicket,
  type Reassign,
  type SaveDraft,
  type SendReply,
  type TicketListQuery,
} from '@support-box/shared';
import { MAX_MANUAL_RETRIES, type TriageRunner } from '../ai/triage';
import { requireAuth, requireRole, type CurrentUser } from '../auth/middleware';
import type { Db } from '../db';
import { tickets, users } from '../db/schema';
import type { Mailer } from '../mail/mailer';
import { validate } from '../middleware/validate';
import { saveDraft, sendReply } from '../tickets/reply';
import {
  canEdit,
  countTickets,
  createTicket,
  getTicket,
  listAssignableUsers,
  listTickets,
} from '../tickets/service';

type IdParams = { id: number };

export function ticketsRouter(db: Db, triage: TriageRunner, mailer: Mailer) {
  const router = Router();
  router.use(requireAuth(db));

  router.get('/', validate({ query: ticketListQuerySchema }), (_req, res) => {
    const user = res.locals.user as CurrentUser;
    res.json(listTickets(db, res.locals.validated.query as TicketListQuery, user.id));
  });

  router.get('/counts', (_req, res) => {
    res.json(countTickets(db, (res.locals.user as CurrentUser).id));
  });

  router.post('/', validate({ body: createTicketSchema }), (_req, res) => {
    const input = res.locals.validated.body as CreateTicket;
    const ticket = createTicket(db, { ...input, source: 'form' });
    triage.enqueue(ticket.id);
    res.status(201).json(getTicket(db, ticket.id, res.locals.user as CurrentUser));
  });

  // Declared before /:id so "assignees" isn't parsed as an id.
  router.get('/assignees', requireRole('admin'), (_req, res) => {
    res.json(listAssignableUsers(db));
  });

  router.get('/:id', validate({ params: ticketIdParamsSchema }), (_req, res) => {
    const { id } = res.locals.validated.params as IdParams;
    const ticket = getTicket(db, id, res.locals.user as CurrentUser);
    if (!ticket) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(ticket);
  });

  router.post(
    '/:id/reassign',
    requireRole('admin'),
    validate({ params: ticketIdParamsSchema, body: reassignSchema }),
    (_req, res) => {
      const { id } = res.locals.validated.params as IdParams;
      const { assigneeId } = res.locals.validated.body as Reassign;
      const target = db.select().from(users).where(eq(users.id, assigneeId)).get();
      if (!target || !target.active) {
        res.status(400).json({ error: 'invalid_assignee' });
        return;
      }
      const result = db
        .update(tickets)
        .set({ assigneeId, updatedAt: new Date().toISOString() })
        .where(and(eq(tickets.id, id), ne(tickets.status, 'closed')))
        .run();
      if (result.changes === 0) {
        const exists = db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, id)).get();
        res.status(exists ? 409 : 404).json({ error: exists ? 'ticket_closed' : 'not_found' });
        return;
      }
      res.json(getTicket(db, id, res.locals.user as CurrentUser));
    },
  );

  router.put(
    '/:id/draft',
    validate({ params: ticketIdParamsSchema, body: saveDraftSchema }),
    (_req, res) => {
      const { id } = res.locals.validated.params as IdParams;
      const { draft } = res.locals.validated.body as SaveDraft;
      const user = res.locals.user as CurrentUser;
      const outcome = saveDraft(db, user, id, draft);
      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.json(getTicket(db, id, user));
    },
  );

  // The only way a reply leaves the system: an explicit agent action, recorded with who and when.
  router.post(
    '/:id/send',
    validate({ params: ticketIdParamsSchema, body: sendReplySchema }),
    async (_req, res, next) => {
      try {
        const { id } = res.locals.validated.params as IdParams;
        const { body } = res.locals.validated.body as SendReply;
        const user = res.locals.user as CurrentUser;
        const outcome = await sendReply(db, mailer, user, id, body);
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, message: outcome.message });
          return;
        }
        res.json(getTicket(db, id, user));
      } catch (err) {
        next(err);
      }
    },
  );

  // Manual retry after an AI error: the only way to make another AI call for a ticket.
  router.post('/:id/retry-ai', validate({ params: ticketIdParamsSchema }), (_req, res) => {
    const { id } = res.locals.validated.params as IdParams;
    const user = res.locals.user as CurrentUser;
    const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get();
    if (!ticket) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!canEdit(user, ticket.assigneeId)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (ticket.status !== 'ai_error') {
      res.status(409).json({ error: 'not_in_ai_error' });
      return;
    }
    // Conditional update so two quick clicks can't both pass the limit.
    const result = db
      .update(tickets)
      .set({ status: 'new', aiError: null, aiRetries: sql`${tickets.aiRetries} + 1`, updatedAt: new Date().toISOString() })
      .where(and(eq(tickets.id, id), eq(tickets.status, 'ai_error'), lt(tickets.aiRetries, MAX_MANUAL_RETRIES)))
      .run();
    if (result.changes === 0) {
      res.status(429).json({ error: 'retry_limit_reached' });
      return;
    }
    triage.enqueue(id, user.id);
    res.json(getTicket(db, id, user));
  });

  router.post('/:id/close', validate({ params: ticketIdParamsSchema }), (_req, res) => {
    const { id } = res.locals.validated.params as IdParams;
    const user = res.locals.user as CurrentUser;
    const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get();
    if (!ticket) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!canEdit(user, ticket.assigneeId)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (ticket.status === 'closed') {
      res.status(409).json({ error: 'ticket_closed' });
      return;
    }
    const now = new Date().toISOString();
    db.update(tickets)
      .set({ status: 'closed', closedAt: now, updatedAt: now })
      .where(eq(tickets.id, id))
      .run();
    res.json(getTicket(db, id, user));
  });

  return router;
}
