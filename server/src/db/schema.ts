import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { CATEGORIES, ROLES, TICKET_STATUSES } from '@support-box/shared';

const timestamp = (name: string) =>
  text(name)
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role', { enum: ROLES }).notNull(),
  passwordHash: text('password_hash').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  // Tie-breaker for least-loaded assignment.
  lastAssignedAt: text('last_assigned_at'),
  createdAt: timestamp('created_at'),
});

export const tickets = sqliteTable(
  'tickets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Set for webhook tickets; unique so redelivered emails are ignored.
    messageId: text('message_id').unique(),
    source: text('source', { enum: ['webhook', 'form'] }).notNull(),
    fromEmail: text('from_email').notNull(),
    fromName: text('from_name'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: TICKET_STATUSES }).notNull().default('new'),
    category: text('category', { enum: CATEGORIES }),
    urgency: integer('urgency'),
    // AI draft, edited in place by the agent; becomes the sent text.
    draft: text('draft'),
    aiError: text('ai_error'),
    aiSkipReason: text('ai_skip_reason'),
    aiRetries: integer('ai_retries').notNull().default(0),
    assigneeId: integer('assignee_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    closedAt: text('closed_at'),
  },
  (t) => [
    index('tickets_status_created_idx').on(t.status, t.createdAt),
    index('tickets_assignee_idx').on(t.assigneeId),
    index('tickets_from_email_idx').on(t.fromEmail),
  ],
);

// One sent reply per ticket; written before the SMTP send so a double click cannot send twice.
export const replies = sqliteTable(
  'replies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    sentById: integer('sent_by_id')
      .notNull()
      .references(() => users.id),
    sentAt: timestamp('sent_at'),
    mailMode: text('mail_mode', { enum: ['demo', 'production'] }).notNull(),
    deliveryStatus: text('delivery_status', { enum: ['pending', 'sent', 'failed'] })
      .notNull()
      .default('pending'),
    deliveryError: text('delivery_error'),
  },
  (t) => [uniqueIndex('replies_ticket_idx').on(t.ticketId)],
);

// Every AI call is logged, including manual retries, for cost tracking.
export const aiAttempts = sqliteTable(
  'ai_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id),
    triggeredById: integer('triggered_by_id').references(() => users.id),
    model: text('model').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    error: text('error'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: timestamp('created_at'),
  },
  (t) => [index('ai_attempts_ticket_idx').on(t.ticketId)],
);

// express-session storage, so logins survive restarts.
export const sessions = sqliteTable(
  'sessions',
  {
    sid: text('sid').primaryKey(),
    data: text('data').notNull(),
    expiresAt: integer('expires_at').notNull(), // epoch ms
  },
  (t) => [index('sessions_expires_idx').on(t.expiresAt)],
);
