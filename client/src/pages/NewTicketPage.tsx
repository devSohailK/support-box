import { AlertCircle, ArrowLeft, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { MAX_BODY_CHARS, type TicketDetail } from '@support-box/shared';
import { api, ApiError } from '../api';
import { useCounts } from '../ui/counts';
import { useToast } from '../ui/Toast';

export function NewTicketPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useCounts();
  const [form, setForm] = useState({ fromEmail: '', fromName: '', subject: '', body: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ticket = await api<TicketDetail>('/tickets', {
        method: 'POST',
        body: { ...form, fromName: form.fromName || undefined },
      });
      refresh();
      toast(`Ticket #${ticket.id} logged and assigned to ${ticket.assignee.name}`);
      navigate(`/tickets/${ticket.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'validation_error'
          ? 'Check the customer email address, and fill in the subject and message.'
          : 'The ticket wasn’t saved. Check your connection and try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="page-narrow">
      <Link to="/" className="btn btn-ghost btn-sm back">
        <ArrowLeft size={16} aria-hidden="true" />
        All tickets
      </Link>
      <header className="page-head">
        <div>
          <h1>Log a ticket</h1>
          <p className="page-sub">For requests that came in by phone or chat. It’s assigned to whoever has the fewest open tickets.</p>
        </div>
      </header>

      <form className="form-card" onSubmit={onSubmit}>
        <div className="form-row">
          <label className="field">
            <span className="field-label">Customer email</span>
            <input className="input" type="email" value={form.fromEmail} onChange={set('fromEmail')} required autoFocus />
          </label>
          <label className="field">
            <span className="field-label">
              Customer name <span className="muted">(optional)</span>
            </span>
            <input className="input" value={form.fromName} onChange={set('fromName')} maxLength={200} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Subject</span>
          <input className="input" value={form.subject} onChange={set('subject')} required maxLength={200} />
        </label>
        <label className="field">
          <span className="field-label">What the customer needs</span>
          <textarea
            className="textarea"
            value={form.body}
            onChange={set('body')}
            required
            rows={9}
            maxLength={MAX_BODY_CHARS}
          />
          <span className="field-hint">Write it in the customer’s words where you can; the AI drafts a reply from this.</span>
        </label>

        {error && (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="form-actions">
          <span className="muted small form-note">
            <Sparkles size={16} aria-hidden="true" />
            An AI draft is ready a few seconds after you log it.
          </span>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Logging…' : 'Log ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
