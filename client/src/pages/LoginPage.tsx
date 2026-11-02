import { Inbox, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { loginIntro, shake } from '../ui/motion';
import { TextField } from '../ui/TextField';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match an active account.',
  too_many_attempts: 'Too many failed attempts. Wait 15 minutes, then try again.',
  validation_error: 'Enter your work email and password.',
};

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    if (rootRef.current) loginIntro(rootRef.current);
  }, []);
  useEffect(() => {
    if (attempt) shake(formRef.current);
  }, [attempt]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(MESSAGES[code] ?? 'Sign-in failed. Check your connection and try again.');
      setAttempt((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login" ref={rootRef}>
      <section className="login-story" aria-hidden="true">
        <div className="brand">
          <span className="brand-mark">
            <Inbox size={18} strokeWidth={2.4} />
          </span>
          <span className="brand-name">Support Inbox</span>
        </div>
        <div className="story">
          <p className="story-line">Every customer email, one shared inbox.</p>
          <div className="story-flow">
            <div className="bubble bubble-customer">
              <span className="bubble-who">Priya</span>I was charged twice this month. Can you refund the extra charge?
            </div>
            <div className="bubble bubble-ai">
              <span className="bubble-who">
                <Sparkles size={14} /> Suggested reply
              </span>
              Hi Priya, sorry about the double charge. Our billing team is reviewing it now…
            </div>
            <div className="bubble bubble-sent">
              <span className="bubble-who">Sent by Ali, after review</span>
              Hi Priya, sorry about the double charge. The refund is on its way.
            </div>
          </div>
          <p className="story-note">AI drafts the reply. A person always reviews and sends it.</p>
        </div>
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={onSubmit} noValidate ref={formRef}>
          <h1>Sign in</h1>
          <p className="muted">Use the account your admin set up for you.</p>

          <div className="login-fields">
            <TextField
              label="Work email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error ? ' ' : null}
              autoFocus
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error}
            />
          </div>

          {/* The message itself shows under the password field; this announces it */}
          {error && (
            <span className="visually-hidden" role="alert">
              {error}
            </span>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting || !email || !password}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
}
