import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import { sql } from 'drizzle-orm';
import type { TriageRunner } from './ai/triage';
import type { Config } from './config';
import type { Db } from './db';
import type { Mailer } from './mail/mailer';
import { requireJsonForWrites } from './auth/middleware';
import type { LoginLimiter } from './auth/login-limiter';
import { SqliteSessionStore } from './auth/session-store';
import { authRouter, SESSION_COOKIE } from './routes/auth';
import { ticketsRouter } from './routes/tickets';
import { webhookRouter } from './routes/webhook';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type AppDeps = {
  db: Db;
  config: Pick<Config, 'SESSION_SECRET' | 'COOKIE_SECURE' | 'WEBHOOK_SECRET'>;
  triage: TriageRunner;
  mailer: Mailer;
  loginLimiter?: LoginLimiter;
};

export function createApp({ db, config, triage, mailer, loginLimiter }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Caddy

  // Machine-to-machine: secret header instead of a session, own body limit. Mounted before the global parser.
  app.use('/api/webhook', webhookRouter(db, config.WEBHOOK_SECRET, triage));

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    db.get(sql`select 1`);
    res.json({ ok: true });
  });

  app.use(
    '/api',
    session({
      name: SESSION_COOKIE,
      secret: config.SESSION_SECRET,
      store: new SqliteSessionStore(db),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.COOKIE_SECURE,
        maxAge: SESSION_TTL_MS,
      },
    }),
  );
  app.use('/api', requireJsonForWrites);
  app.use('/api/auth', authRouter(db, loginLimiter));
  app.use('/api/tickets', ticketsRouter(db, triage, mailer));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    // Client errors from the body parser (malformed JSON, too large) keep their status.
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status < 500) {
      res.status(status).json({ error: status === 413 ? 'payload_too_large' : 'bad_request' });
      return;
    }
    // Log the message only; request bodies may contain customer data or passwords.
    console.error('Unhandled error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);

  return app;
}
