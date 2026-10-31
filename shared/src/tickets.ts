import { z } from 'zod';
import type { Category } from './triage';

export const ROLES = ['agent', 'admin'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const TICKET_STATUSES = ['new', 'open', 'ai_error', 'replied', 'closed'] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

// Statuses with no reply yet; these can become overdue.
export const UNREPLIED_STATUSES = ['new', 'open', 'ai_error'] as const satisfies readonly TicketStatus[];

export const OVERDUE_HOURS = 24;
export const PAGE_SIZE = 20;

export const MAX_BODY_CHARS = 10_000;

export const createTicketSchema = z.strictObject({
  fromEmail: z.email().trim().toLowerCase(),
  fromName: z.string().trim().max(200).optional(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(MAX_BODY_CHARS),
});
export type CreateTicket = z.infer<typeof createTicketSchema>;

export const ticketListQuerySchema = z.object({
  status: ticketStatusSchema.optional(),
  overdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  // Only tickets assigned to the current user (closed ones excluded unless a status is chosen).
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

export type TicketCounts = Record<TicketStatus, number> & {
  all: number;
  mine: number;
  overdue: number;
};

export const ticketIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const reassignSchema = z.strictObject({ assigneeId: z.number().int().positive() });
export type Reassign = z.infer<typeof reassignSchema>;

export const MAX_REPLY_CHARS = 5000;

export const saveDraftSchema = z.strictObject({ draft: z.string().max(MAX_REPLY_CHARS) });
export type SaveDraft = z.infer<typeof saveDraftSchema>;

export const sendReplySchema = z.strictObject({ body: z.string().trim().min(1).max(MAX_REPLY_CHARS) });
export type SendReply = z.infer<typeof sendReplySchema>;

export type UserRef = { id: number; name: string };

export type SentReply = {
  body: string;
  toEmail: string;
  subject: string;
  sentBy: UserRef;
  sentAt: string;
  mailMode: 'demo' | 'production';
  deliveryStatus: 'pending' | 'sent' | 'failed';
  deliveryError: string | null;
};

export type TicketSummary = {
  id: number;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  status: TicketStatus;
  category: Category | null;
  urgency: number | null;
  assignee: UserRef;
  createdAt: string;
  overdue: boolean;
  // Auto-reply, bounce or similar: skipped by the AI.
  automated: boolean;
};

export type TicketPage = {
  items: TicketSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type TicketDetail = TicketSummary & {
  body: string;
  source: 'webhook' | 'form';
  draft: string | null;
  aiError: string | null;
  aiSkipReason: string | null;
  aiRetriesLeft: number;
  closedAt: string | null;
  reply: SentReply | null;
  // Whether the current user may edit, send or close (assignee or admin).
  canEdit: boolean;
  otherFromSender: Pick<TicketSummary, 'id' | 'subject' | 'status' | 'createdAt'>[];
};

export type AssignableUser = UserRef & { role: Role; openTickets: number };
