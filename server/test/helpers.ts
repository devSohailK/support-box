import { resolve } from 'node:path';
import request from 'supertest';
import type { ChatFn, ChatResult } from '../src/ai/client';
import { TriageRunner } from '../src/ai/triage';
import { createApp } from '../src/app';
import type { LoginLimiter } from '../src/auth/login-limiter';
import { seedUsers } from '../src/auth/seed';
import { openDb, type Db } from '../src/db';
import type { Mailer, OutgoingMail } from '../src/mail/mailer';

export const migrationsFolder = resolve(import.meta.dirname, '../drizzle');

export const TEST_PASSWORD = 'correct-horse-battery';
export const WEBHOOK_SECRET = 'test-webhook-secret-123';
export const TEST_USERS = [
  { role: 'admin' as const, email: 'admin@test.local', name: 'Ada' },
  { role: 'agent' as const, email: 'agent1@test.local', name: 'Ben' },
  { role: 'agent' as const, email: 'agent2@test.local', name: 'Cy' },
];

export const VALID_TRIAGE = {
  category: 'billing',
  urgency: 1,
  draft_reply: 'Hi, sorry about the double charge. We are looking into it. The Support Team',
};

export const chatResult = (content: unknown, overrides: Partial<ChatResult> = {}): ChatResult => ({
  content: typeof content === 'string' ? content : JSON.stringify(content),
  finishReason: 'stop',
  inputTokens: 120,
  outputTokens: 80,
  ...overrides,
});

/** A fake AI client that records calls and answers with the given results in order (last one repeats). */
export function fakeChat(...results: (ChatResult | Error)[]) {
  const calls: Parameters<ChatFn>[0][] = [];
  const queue = results.length ? results : [chatResult(VALID_TRIAGE)];
  const chat: ChatFn = async (req) => {
    calls.push(req);
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    return next;
  };
  return Object.assign(chat, { calls });
}

/** A fake mailer that records sends; pass an Error to make every send fail with it. */
export function fakeMailer(failWith?: Error) {
  const sent: OutgoingMail[] = [];
  let failure = failWith;
  const mailer: Mailer = {
    mode: 'demo',
    async send(mail) {
      if (failure) throw failure;
      sent.push(mail);
    },
  };
  return Object.assign(mailer, {
    sent,
    setFailure: (e?: Error) => {
      failure = e;
    },
  });
}

export function testDb() {
  return openDb(':memory:', migrationsFolder);
}

export async function testApp(
  opts: {
    db?: Db;
    loginLimiter?: LoginLimiter;
    chat?: ChatFn | null;
    mailer?: ReturnType<typeof fakeMailer>;
  } = {},
) {
  const db = opts.db ?? testDb();
  await seedUsers(db, { SEED_USERS: TEST_USERS, SEED_PASSWORD: TEST_PASSWORD }, 4);
  const chat = opts.chat === undefined ? fakeChat() : opts.chat;
  const triage = new TriageRunner(db, chat, 'test-model');
  const mailer = opts.mailer ?? fakeMailer();
  const app = createApp({
    db,
    config: { SESSION_SECRET: 'x'.repeat(32), COOKIE_SECURE: false, WEBHOOK_SECRET },
    triage,
    mailer,
    loginLimiter: opts.loginLimiter,
  });
  return { app, db, triage, mailer };
}

type App = Awaited<ReturnType<typeof testApp>>['app'];

/** Returns a supertest agent (keeps cookies) logged in as the given email. */
export async function loginAs(app: App, email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return agent;
}
