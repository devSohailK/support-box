import { AlertCircle, ArrowLeft, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { MAX_BODY_CHARS, type TicketDetail } from '@support-box/shared';
import { api, ApiError } from '../api';
import { useCounts } from '../ui/counts';
import { TextField } from '../ui/TextField';
import { useToast } from '../ui/Toast';

export function NewTicketPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useCounts();
  const [form, setForm] = useState({ fromEmail: '', fromName: '', subject: '', body: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setFieldErrors((fe) => ({ ...fe, [key]: undefined }));
  };

  // Field-level checks first, so each problem shows next to its field.
  function check() {
    const fe: typeof fieldErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.fromEmail.trim())) fe.fromEmail = 'Enter an address like name@company.com';
    if (!form.subject.trim()) fe.subject = 'Add a short subject';
    if (!form.body.trim()) fe.body = 'Describe what the customer needs';
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!check()) return;
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

      <form className="form-card" onSubmit={onSubmit} noValidate>
        <div className="form-row">
          <TextField
            label="Customer email"
            type="email"
            value={form.fromEmail}
            onChange={set('fromEmail')}
            error={fieldErrors.fromEmail}
            required
            autoFocus
          />
          <TextField
            label="Customer name"
            value={form.fromName}
            onChange={set('fromName')}
            maxLength={200}
            supporting="Optional"
          />
        </div>
        <TextField
          label="Subject"
          value={form.subject}
          onChange={set('subject')}
          error={fieldErrors.subject}
          required
          maxLength={200}
        />
        <TextField
          multiline
          label="What the customer needs"
          value={form.body}
          onChange={set('body')}
          error={fieldErrors.body}
          required
          rows={9}
          maxLength={MAX_BODY_CHARS}
          supporting="Write it in the customer’s words where you can; the AI drafts a reply from this."
        />

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
