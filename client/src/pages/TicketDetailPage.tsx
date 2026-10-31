import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Info,
  Mail,
  PenLine,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MAX_REPLY_CHARS, type AssignableUser, type TicketDetail } from '@support-box/shared';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../ui/Avatar';
import { CATEGORY_LABELS, OverduePill, StatusPill, UrgencyPill } from '../ui/Badges';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useCounts } from '../ui/counts';
import { formatDate, RelativeTime } from '../ui/time';
import { useToast } from '../ui/Toast';

const ERRORS: Record<string, string> = {
  forbidden: 'Only the assigned agent or an admin can do that.',
  ticket_closed: 'This ticket is closed, so it can’t be changed.',
  invalid_assignee: 'That person can’t take tickets right now.',
  retry_limit_reached: 'No AI retries left for this ticket. Write the reply yourself.',
  not_in_ai_error: 'This ticket already has a draft.',
  already_sent: 'A reply was already sent for this ticket.',
  not_ready: 'This ticket can’t be replied to yet.',
  not_editable: 'The draft can no longer be edited.',
  validation_error: 'The reply is empty or longer than 5,000 characters.',
};

// Plain-language versions of the server's junk reasons.
const SKIP_REASONS: Record<string, string> = {
  'empty body': 'the email has no text',
  'automated sender': 'it came from a no-reply or bounce address',
  'auto-submitted': 'it is an automatic reply, such as an out-of-office',
  'bulk or auto-reply': 'it is bulk or automated mail',
};

type Act = (path: string, body?: unknown, method?: 'POST' | 'PUT') => Promise<TicketDetail | null>;

export function TicketDetailPage() {
  const { id = '' } = useParams();
  // Remount per ticket so state from the previous ticket never leaks across links.
  return <TicketView key={id} id={id} />;
}

function TicketView({ id }: { id: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh: refreshCounts } = useCounts();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<TicketDetail>(`/tickets/${id}`)
      .then((t) => !cancelled && setTicket(t))
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError && err.status === 404
            ? 'This ticket doesn’t exist. It may have been mistyped in the address.'
            : 'The ticket couldn’t be loaded. Check your connection and reload the page.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // While the background AI call runs, check back every 2s (stops after about a minute).
  const waitingForAi = ticket?.status === 'new' && !ticket.aiSkipReason;
  useEffect(() => {
    if (!waitingForAi) return;
    let polls = 0;
    const timer = setInterval(() => {
      if (++polls > 30) return clearInterval(timer);
      api<TicketDetail>(`/tickets/${id}`)
        .then((t) => {
          if (t.status !== 'new') {
            setTicket(t);
            refreshCounts();
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [id, waitingForAi, refreshCounts]);

  const act: Act = useCallback(
    async (path, body, method = 'POST') => {
      setBusy(true);
      setActionError(null);
      try {
        const t = await api<TicketDetail>(path, { method, body });
        setTicket(t);
        refreshCounts();
        return t;
      } catch (err) {
        const message =
          err instanceof ApiError ? (err.code === 'send_failed' ? err.detail : ERRORS[err.code]) : undefined;
        setActionError(message || 'That didn’t work. Check your connection and try again.');
        // A failed send is recorded on the ticket, so reload it.
        if (err instanceof ApiError && err.code === 'send_failed') {
          api<TicketDetail>(`/tickets/${id}`).then(setTicket).catch(() => undefined);
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [id, refreshCounts],
  );

  if (loadError) {
    return (
      <div className="page-narrow">
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{loadError}</span>
        </div>
        <p style={{ marginTop: 16 }}>
          <Link to="/">Back to all tickets</Link>
        </p>
      </div>
    );
  }
  if (!ticket) return <DetailSkeleton />;

  const isClosed = ticket.status === 'closed';
  const sent = ticket.reply && ticket.reply.deliveryStatus !== 'failed' ? ticket.reply : null;

  async function close() {
    const t = await act(`/tickets/${ticket!.id}/close`);
    setConfirmClose(false);
    if (t) toast('Ticket closed');
  }

  return (
    <div className="page detail-page">
      <button className="btn btn-ghost btn-sm back" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </button>

      <header className="detail-head">
        <h1>{ticket.subject}</h1>
        <div className="detail-badges">
          <StatusPill status={ticket.status} />
          {ticket.overdue && <OverduePill />}
          <span className="muted small">Ticket #{ticket.id}</span>
        </div>
      </header>

      <div className="detail-grid">
        <section className="thread" aria-label="Conversation">
          <article className="message message-customer">
            <header className="message-head">
              <Avatar name={ticket.fromName || ticket.fromEmail} seed={ticket.fromEmail} size={40} />
              <div className="message-who">
                <strong>{ticket.fromName || ticket.fromEmail}</strong>
                {ticket.fromName && <span className="muted small">{ticket.fromEmail}</span>}
              </div>
              <span className="muted xs">
                <RelativeTime iso={ticket.createdAt} />
              </span>
            </header>
            <div className="message-body">{ticket.body}</div>
          </article>

          {actionError && (
            <div className="alert alert-danger" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{actionError}</span>
            </div>
          )}

          {sent ? (
            <SentReply ticket={ticket} />
          ) : isClosed ? (
            <div className="alert alert-info">
              <Info size={18} aria-hidden="true" />
              <span>Closed without a reply.</span>
            </div>
          ) : (
            <>
              <AiStatus ticket={ticket} busy={busy} act={act} />
              <Composer ticket={ticket} busy={busy} act={act} />
            </>
          )}
        </section>

        <aside className="side" aria-label="Ticket details">
          <div className="panel">
            <h2 className="panel-title">Details</h2>
            <dl className="props">
              <div>
                <dt>Assigned to</dt>
                <dd>
                  <AssigneeControl ticket={ticket} busy={busy} act={act} />
                </dd>
              </div>
              <div>
                <dt>Urgency</dt>
                <dd>{ticket.urgency ? <UrgencyPill urgency={ticket.urgency} /> : <Pending ticket={ticket} />}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{ticket.category ? CATEGORY_LABELS[ticket.category] : <Pending ticket={ticket} />}</dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>
                  {formatDate(ticket.createdAt)}
                  <div className="muted xs">{ticket.source === 'webhook' ? 'By email' : 'Logged by hand'}</div>
                </dd>
              </div>
              {isClosed && ticket.closedAt && (
                <div>
                  <dt>Closed</dt>
                  <dd>{formatDate(ticket.closedAt)}</dd>
                </div>
              )}
            </dl>
            {ticket.canEdit && !isClosed && (
              <button className="btn btn-secondary panel-action" disabled={busy} onClick={() => setConfirmClose(true)}>
                <CheckCircle2 size={18} aria-hidden="true" />
                Close ticket
              </button>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">From the same sender</h2>
            {ticket.otherFromSender.length === 0 ? (
              <p className="muted small">No other tickets from {ticket.fromName || ticket.fromEmail}.</p>
            ) : (
              <ul className="related">
                {ticket.otherFromSender.map((t) => (
                  <li key={t.id}>
                    <Link to={`/tickets/${t.id}`} className="related-link">
                      <span className="related-subject">{t.subject}</span>
                      <span className="related-meta">
                        <StatusPill status={t.status} />
                        <span className="muted xs">
                          <RelativeTime iso={t.createdAt} />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Close this ticket?"
        confirmLabel="Close ticket"
        busyLabel="Closing…"
        busy={busy}
        onConfirm={() => void close()}
        onCancel={() => setConfirmClose(false)}
      >
        {sent
          ? 'The reply has been sent. Closing moves the ticket out of the open views.'
          : 'No reply has been sent. Close it only if none is needed, for example a duplicate or an automated email.'}
      </ConfirmDialog>
    </div>
  );
}

function Pending({ ticket }: { ticket: TicketDetail }) {
  return <span className="muted">{ticket.status === 'new' && !ticket.aiSkipReason ? 'Being set by AI…' : 'Not set'}</span>;
}

function AiStatus({ ticket, busy, act }: { ticket: TicketDetail; busy: boolean; act: Act }) {
  const toast = useToast();

  if (ticket.aiSkipReason) {
    return (
      <div className="alert alert-info">
        <Bot size={18} aria-hidden="true" />
        <span>
          No AI draft, because {SKIP_REASONS[ticket.aiSkipReason] ?? 'this looks like an automated email'}. Close the
          ticket if it needs no reply.
        </span>
      </div>
    );
  }
  if (ticket.status === 'new') {
    return (
      <div className="ai-working" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div>
          <strong>Drafting a reply</strong>
          <div className="small muted">The AI is reading the email. This usually takes a few seconds.</div>
        </div>
      </div>
    );
  }
  if (ticket.status === 'ai_error') {
    return (
      <div className="alert alert-danger ai-failed" role="alert">
        <AlertCircle size={18} aria-hidden="true" />
        <div className="ai-failed-body">
          <strong>The AI draft couldn’t be used</strong>
          <span>{ticket.aiError}</span>
          {ticket.canEdit && (
            <div className="ai-failed-actions">
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy || ticket.aiRetriesLeft === 0}
                onClick={async () => {
                  if (await act(`/tickets/${ticket.id}/retry-ai`)) toast('Drafting the reply again');
                }}
              >
                <RotateCcw size={16} aria-hidden="true" />
                Try the AI again
              </button>
              <span className="xs">
                {ticket.aiRetriesLeft === 0
                  ? 'No retries left. Write the reply below.'
                  : `${ticket.aiRetriesLeft} ${ticket.aiRetriesLeft === 1 ? 'retry' : 'retries'} left, or write the reply below.`}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
}

function Composer({ ticket, busy, act }: { ticket: TicketDetail; busy: boolean; act: Act }) {
  const toast = useToast();
  const [text, setText] = useState(ticket.draft ?? '');
  const [savedText, setSavedText] = useState(ticket.draft ?? '');
  const [confirming, setConfirming] = useState(false);
  const dirty = text !== savedText;
  const fromAi = Boolean(ticket.draft) && !ticket.aiSkipReason && ticket.status === 'open';
  const failed = ticket.reply?.deliveryStatus === 'failed' ? ticket.reply : null;
  const recipient = ticket.fromName || ticket.fromEmail;

  if (ticket.status === 'new' && !ticket.aiSkipReason) return null;

  if (!ticket.canEdit) {
    return (
      <div className={`composer is-readonly${fromAi ? ' is-ai' : ''}`}>
        <div className="composer-head">
          {fromAi ? <Sparkles size={16} aria-hidden="true" /> : <PenLine size={16} aria-hidden="true" />}
          <span>{fromAi ? 'Suggested reply' : 'Draft'}</span>
        </div>
        <div className="composer-readonly">{ticket.draft || <span className="muted">No draft yet.</span>}</div>
        <p className="composer-foot muted small">
          Only {ticket.assignee.name} or an admin can edit and send this reply.
        </p>
      </div>
    );
  }

  async function save() {
    if (await act(`/tickets/${ticket.id}/draft`, { draft: text }, 'PUT')) {
      setSavedText(text);
      toast('Draft saved');
    }
  }

  async function send() {
    const t = await act(`/tickets/${ticket.id}/send`, { body: text });
    setConfirming(false);
    if (t) toast(`Reply sent to ${recipient}`);
  }

  return (
    <div className={`composer${fromAi ? ' is-ai' : ''}`}>
      <div className="composer-head">
        {fromAi ? <Sparkles size={16} aria-hidden="true" /> : <PenLine size={16} aria-hidden="true" />}
        <span>{fromAi ? 'Suggested reply. Review and edit before sending.' : `Reply to ${recipient}`}</span>
      </div>

      {failed && (
        <div className="alert alert-danger composer-alert" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>
            <strong>Not sent:</strong> {failed.deliveryError}. Fix the problem, then send again.
          </span>
        </div>
      )}

      <label className="visually-hidden" htmlFor="reply">
        Reply to {recipient}
      </label>
      <textarea
        id="reply"
        className="composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        maxLength={MAX_REPLY_CHARS}
        placeholder={`Write your reply to ${recipient}…`}
      />

      <div className="composer-foot">
        <span className="muted xs">
          {dirty ? 'Unsaved changes' : `${text.length.toLocaleString()} / ${MAX_REPLY_CHARS.toLocaleString()}`}
        </span>
        <span className="spacer" />
        <button className="btn btn-ghost" disabled={busy || !dirty} onClick={() => void save()}>
          Save draft
        </button>
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => setConfirming(true)}>
          <Send size={16} aria-hidden="true" />
          Send reply
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Send this reply to ${recipient}?`}
        confirmLabel="Send reply"
        busyLabel="Sending…"
        busy={busy}
        onConfirm={() => void send()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          It goes to <strong>{ticket.fromEmail}</strong> and is recorded with your name. Sent emails can’t be
          recalled.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function SentReply({ ticket }: { ticket: TicketDetail }) {
  const reply = ticket.reply!;
  return (
    <article className="message message-sent">
      <header className="message-head">
        <Avatar name={reply.sentBy.name} size={40} />
        <div className="message-who">
          <strong>
            {reply.deliveryStatus === 'sent' ? 'Sent' : 'Sending'} by {reply.sentBy.name}
          </strong>
          <span className="small">to {reply.toEmail}</span>
        </div>
        <span className="xs">
          <RelativeTime iso={reply.sentAt} />
        </span>
      </header>
      <div className="message-body">{reply.body}</div>
      {reply.mailMode === 'demo' && (
        <footer className="message-note">
          <Mail size={14} aria-hidden="true" />
          Demo mode: caught by Mailpit, not delivered to the customer.
        </footer>
      )}
    </article>
  );
}

function AssigneeControl({ ticket, busy, act }: { ticket: TicketDetail; busy: boolean; act: Act }) {
  const { user } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const canReassign = user?.role === 'admin' && ticket.status !== 'closed';

  useEffect(() => {
    if (!canReassign) return;
    api<AssignableUser[]>('/tickets/assignees')
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [canReassign, ticket.assignee.id]);

  if (!canReassign || users.length === 0) {
    return (
      <span className="assignee">
        <Avatar name={ticket.assignee.name} size={24} />
        {ticket.assignee.name}
      </span>
    );
  }

  return (
    <select
      className="select select-sm"
      value={ticket.assignee.id}
      disabled={busy}
      aria-label="Reassign ticket"
      onChange={async (e) => {
        const next = users.find((u) => u.id === Number(e.target.value));
        if (await act(`/tickets/${ticket.id}/reassign`, { assigneeId: Number(e.target.value) })) {
          toast(`Reassigned to ${next?.name ?? 'new owner'}`);
        }
      }}
    >
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} ({u.openTickets} open{u.role === 'admin' ? ', admin' : ''})
        </option>
      ))}
    </select>
  );
}

function DetailSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading ticket">
      <span className="skeleton" style={{ display: 'block', width: '50%', height: 28, marginTop: 56 }} />
      <div className="detail-grid" style={{ marginTop: 24 }}>
        <span className="skeleton" style={{ display: 'block', height: 220, borderRadius: 18 }} />
        <span className="skeleton" style={{ display: 'block', height: 220, borderRadius: 18 }} />
      </div>
    </div>
  );
}
