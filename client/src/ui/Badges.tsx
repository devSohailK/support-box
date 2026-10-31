import { Clock } from 'lucide-react';
import type { Category, TicketStatus } from '@support-box/shared';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'Drafting',
  open: 'Needs reply',
  ai_error: 'AI failed',
  replied: 'Replied',
  closed: 'Closed',
};

export const STATUS_HELP: Record<TicketStatus, string> = {
  new: 'The AI is preparing a draft reply',
  open: 'Ready for an agent to review and send',
  ai_error: 'The AI draft could not be used; retry or write the reply',
  replied: 'A reply was sent; close the ticket when done',
  closed: 'Finished',
};

const URGENCY_LABELS: Record<number, string> = { 1: 'Urgent', 2: 'Normal', 3: 'Low' };

export const CATEGORY_LABELS: Record<Category, string> = {
  billing: 'Billing',
  account: 'Account',
  technical: 'Technical',
  feature_request: 'Feature request',
  other: 'Other',
};

export function StatusPill({ status }: { status: TicketStatus }) {
  return (
    <span className={`pill pill-dot status-${status}`} title={STATUS_HELP[status]}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function UrgencyPill({ urgency }: { urgency: number | null }) {
  if (urgency === null) return null;
  return <span className={`pill urgency-${urgency}`}>{URGENCY_LABELS[urgency] ?? `Urgency ${urgency}`}</span>;
}

export function CategoryTag({ category }: { category: Category | null }) {
  if (!category) return null;
  return <span className="tag">{CATEGORY_LABELS[category]}</span>;
}

export function OverduePill() {
  return (
    <span className="pill overdue" title="Older than 24 hours with no reply">
      <Clock size={12} aria-hidden="true" />
      Overdue
    </span>
  );
}
