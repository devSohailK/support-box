import { aliasedTable, and, asc, count, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  OVERDUE_HOURS,
  PAGE_SIZE,
  UNREPLIED_STATUSES,
  type AssignableUser,
  type CreateTicket,
  type TicketDetail,
  type TicketListQuery,
  type TicketCounts,
  type TicketPage,
  type TicketStatus,
  type TicketSummary,
} from '@support-box/shared';
import { MAX_MANUAL_RETRIES } from '../ai/triage';
import type { CurrentUser } from '../auth/middleware';
import type { Db } from '../db';
import { tickets, users } from '../db/schema';
import { getReply } from './reply';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const nowIso = () => new Date().toISOString();
const overdueCutoff = (now = Date.now()) =>
  new Date(now - OVERDUE_HOURS * 60 * 60 * 1000).toISOString();

const isOverdue = (status: string, createdAt: string, cutoff: string) =>
  (UNREPLIED_STATUSES as readonly string[]).includes(status) && createdAt < cutoff;

/**
 * Least-loaded active agent (fewest non-closed tickets); ties go to whoever was
 * assigned least recently, then lowest id. Falls back to the first active admin
 * so a ticket is never unassigned.
 */
export function pickAssignee(tx: Tx | Db): number {
  const load = tx
    .select({ assigneeId: tickets.assigneeId, n: count().as('n') })
    .from(tickets)
    .where(ne(tickets.status, 'closed'))
    .groupBy(tickets.assigneeId)
    .as('load');

  const agent = tx
    .select({ id: users.id })
    .from(users)
    .leftJoin(load, eq(load.assigneeId, users.id))
    .where(and(eq(users.role, 'agent'), eq(users.active, true)))
    .orderBy(
      sql`coalesce(${load.n}, 0)`,
      sql`${users.lastAssignedAt} is not null`, // never-assigned first
      asc(users.lastAssignedAt),
      asc(users.id),
    )
    .limit(1)
    .get();
  if (agent) return agent.id;

  const admin = tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true)))
    .orderBy(asc(users.id))
    .limit(1)
    .get();
  if (admin) return admin.id;

  throw new Error('No active user available to assign the ticket to');
}

export type NewTicket = CreateTicket & {
  source: 'webhook' | 'form';
  messageId?: string;
  // Set for junk (auto-replies, bounces, empty bodies): the ticket is kept but gets no AI call.
  aiSkipReason?: string | null;
};

/** Inserts a ticket and assigns it in one transaction, so concurrent arrivals can't pick the same agent. */
export function createTicket(db: Db, input: NewTicket) {
  return db.transaction((tx) => {
    const assigneeId = pickAssignee(tx);
    const ticket = tx
      .insert(tickets)
      .values({
        source: input.source,
        messageId: input.messageId,
        fromEmail: input.fromEmail,
        fromName: input.fromName || null,
        subject: input.subject,
        body: input.body,
        aiSkipReason: input.aiSkipReason ?? null,
        // "new" means waiting for AI triage; skipped tickets go straight to the agent.
        status: input.aiSkipReason ? 'open' : 'new',
        assigneeId,
      })
      .returning()
      .get();
    tx.update(users).set({ lastAssignedAt: nowIso() }).where(eq(users.id, assigneeId)).run();
    return ticket;
  });
}

const assignee = aliasedTable(users, 'assignee');

const summaryColumns = {
  id: tickets.id,
  subject: tickets.subject,
  fromEmail: tickets.fromEmail,
  fromName: tickets.fromName,
  status: tickets.status,
  category: tickets.category,
  urgency: tickets.urgency,
  createdAt: tickets.createdAt,
  automated: sql<boolean>`${tickets.aiSkipReason} is not null`.mapWith(Boolean),
  assigneeId: assignee.id,
  assigneeName: assignee.name,
};

type SummaryRow = Omit<TicketSummary, 'assignee' | 'overdue'> & {
  assigneeId: number;
  assigneeName: string;
};

function toSummary(row: SummaryRow, cutoff: string): TicketSummary {
  const { assigneeId, assigneeName, ...rest } = row;
  return {
    ...rest,
    assignee: { id: assigneeId, name: assigneeName },
    overdue: isOverdue(row.status, row.createdAt, cutoff),
  };
}

export function listTickets(db: Db, query: TicketListQuery, userId: number): TicketPage {
  const cutoff = overdueCutoff();
  const where = and(
    query.status ? eq(tickets.status, query.status) : undefined,
    query.mine ? eq(tickets.assigneeId, userId) : undefined,
    // "Any status" means any status still in play; closed tickets have their own view.
    query.status ? undefined : ne(tickets.status, 'closed'),
    query.overdue
      ? and(inArray(tickets.status, [...UNREPLIED_STATUSES]), lt(tickets.createdAt, cutoff))
      : undefined,
  );

  const total = db.select({ n: count() }).from(tickets).where(where).get()?.n ?? 0;
  const rows = db
    .select(summaryColumns)
    .from(tickets)
    .innerJoin(assignee, eq(assignee.id, tickets.assigneeId))
    .where(where)
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(PAGE_SIZE)
    .offset((query.page - 1) * PAGE_SIZE)
    .all();

  return {
    items: rows.map((r) => toSummary(r, cutoff)),
    page: query.page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** Badge counts for the sidebar and status tabs. */
export function countTickets(db: Db, userId: number): TicketCounts {
  const cutoff = overdueCutoff();
  const byStatus = db
    .select({ status: tickets.status, n: count() })
    .from(tickets)
    .groupBy(tickets.status)
    .all();
  const counts = { new: 0, open: 0, ai_error: 0, replied: 0, closed: 0 } as Record<TicketStatus, number>;
  for (const r of byStatus) counts[r.status] = r.n;
  const mine =
    db
      .select({ n: count() })
      .from(tickets)
      .where(and(eq(tickets.assigneeId, userId), ne(tickets.status, 'closed')))
      .get()?.n ?? 0;
  const mineActionable =
    db
      .select({ n: count() })
      .from(tickets)
      .where(and(eq(tickets.assigneeId, userId), inArray(tickets.status, ['open', 'ai_error'])))
      .get()?.n ?? 0;
  const overdue =
    db
      .select({ n: count() })
      .from(tickets)
      .where(and(inArray(tickets.status, [...UNREPLIED_STATUSES]), lt(tickets.createdAt, cutoff)))
      .get()?.n ?? 0;
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  return { ...counts, all, mine, mineActionable, overdue };
}

export const canEdit = (user: CurrentUser, assigneeId: number) =>
  user.role === 'admin' || user.id === assigneeId;

export function getTicket(db: Db, id: number, user: CurrentUser): TicketDetail | null {
  const row = db
    .select({
      ...summaryColumns,
      body: tickets.body,
      source: tickets.source,
      draft: tickets.draft,
      aiError: tickets.aiError,
      aiSkipReason: tickets.aiSkipReason,
      aiRetries: tickets.aiRetries,
      closedAt: tickets.closedAt,
    })
    .from(tickets)
    .innerJoin(assignee, eq(assignee.id, tickets.assigneeId))
    .where(eq(tickets.id, id))
    .get();
  if (!row) return null;

  const { body, source, draft, aiError, aiSkipReason, aiRetries, closedAt, ...summary } = row;
  const otherFromSender = db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      status: tickets.status,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(and(eq(tickets.fromEmail, row.fromEmail), ne(tickets.id, id)))
    .orderBy(desc(tickets.createdAt))
    .limit(10)
    .all();

  return {
    ...toSummary(summary, overdueCutoff()),
    body,
    source,
    draft,
    aiError,
    aiSkipReason,
    aiRetriesLeft: Math.max(0, MAX_MANUAL_RETRIES - aiRetries),
    closedAt,
    reply: getReply(db, id),
    canEdit: canEdit(user, row.assigneeId),
    otherFromSender,
  };
}

export function listAssignableUsers(db: Db): AssignableUser[] {
  const load = db
    .select({ assigneeId: tickets.assigneeId, n: count().as('n') })
    .from(tickets)
    .where(ne(tickets.status, 'closed'))
    .groupBy(tickets.assigneeId)
    .as('load');
  return db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      openTickets: sql<number>`coalesce(${load.n}, 0)`,
    })
    .from(users)
    .leftJoin(load, eq(load.assigneeId, users.id))
    .where(eq(users.active, true))
    .orderBy(asc(users.name))
    .all();
}
