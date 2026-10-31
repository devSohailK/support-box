import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_CHARS } from '@support-box/shared';
import { tickets } from '../src/db/schema';
import { junkReason } from '../src/tickets/junk';
import { testApp, WEBHOOK_SECRET } from './helpers';

const email = (overrides: Record<string, unknown> = {}) => ({
  messageId: '<abc-123@mail.example.com>',
  from: 'Jane@Example.com',
  fromName: 'Jane Doe',
  subject: 'I was charged twice',
  body: 'Hi, my card was charged twice this month.',
  ...overrides,
});

const post = (app: Awaited<ReturnType<typeof testApp>>['app'], body: unknown, secret = WEBHOOK_SECRET) =>
  request(app).post('/api/webhook/email').set('X-Webhook-Secret', secret).send(body as object);

describe('POST /api/webhook/email', () => {
  it('creates an assigned ticket and returns 202, without a session', async () => {
    const { app, db, triage } = await testApp();
    const res = await post(app, email());
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    await triage.idle();
    const t = db.select().from(tickets).where(eq(tickets.id, res.body.ticketId)).get()!;
    expect(t).toMatchObject({
      source: 'webhook',
      messageId: '<abc-123@mail.example.com>',
      fromEmail: 'jane@example.com',
      fromName: 'Jane Doe',
      status: 'open', // triaged by the fake AI client
      aiSkipReason: null,
    });
    expect(t.assigneeId).toBeGreaterThan(0);
  });

  it('rejects a missing or wrong secret before creating anything', async () => {
    const { app, db } = await testApp();
    expect((await request(app).post('/api/webhook/email').send(email())).status).toBe(401);
    expect((await post(app, email(), 'wrong-secret')).status).toBe(401);
    expect(db.select().from(tickets).all()).toHaveLength(0);
  });

  it('ignores redelivery of the same messageId', async () => {
    const { app, db } = await testApp();
    const first = await post(app, email());
    const again = await post(app, email({ subject: 'changed' }));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ status: 'duplicate', ticketId: first.body.ticketId });
    expect(db.select().from(tickets).all()).toHaveLength(1);
  });

  it('truncates long bodies and subjects instead of rejecting', async () => {
    const { app, db } = await testApp();
    const res = await post(app, email({ body: 'a'.repeat(50_000), subject: 's'.repeat(500) }));
    expect(res.status).toBe(202);
    const t = db.select().from(tickets).where(eq(tickets.id, res.body.ticketId)).get()!;
    expect(t.body).toHaveLength(MAX_BODY_CHARS);
    expect(t.subject).toHaveLength(200);
  });

  it('uses a placeholder for an empty subject', async () => {
    const { app, db } = await testApp();
    const res = await post(app, email({ subject: '  ' }));
    const t = db.select().from(tickets).where(eq(tickets.id, res.body.ticketId)).get()!;
    expect(t.subject).toBe('(no subject)');
  });

  it('keeps junk as a ticket but marks it to skip the AI call', async () => {
    const { app, db } = await testApp();
    const res = await post(
      app,
      email({ from: 'mailer-daemon@mail.example.com', body: 'Delivery failed' }),
    );
    expect(res.status).toBe(202);
    const t = db.select().from(tickets).where(eq(tickets.id, res.body.ticketId)).get()!;
    expect(t.aiSkipReason).toBe('automated sender');
  });

  it('validates the payload', async () => {
    const { app } = await testApp();
    expect((await post(app, email({ from: 'not-an-email' }))).status).toBe(400);
    expect((await post(app, { subject: 'x' })).status).toBe(400);
  });

  it('returns 400 for malformed JSON and 413 for oversized payloads', async () => {
    const { app } = await testApp();
    const bad = await request(app)
      .post('/api/webhook/email')
      .set('X-Webhook-Secret', WEBHOOK_SECRET)
      .set('Content-Type', 'application/json')
      .send('{"oops"');
    expect(bad.status).toBe(400);
    const huge = await post(app, email({ body: 'a'.repeat(1_100_000) }));
    expect(huge.status).toBe(413);
  });
});

describe('junkReason', () => {
  const base = { from: 'jane@example.com', body: 'Hello' };

  it.each([
    ['empty body', { ...base, body: '' }, 'empty body'],
    ['noreply sender', { ...base, from: 'noreply@shop.com' }, 'automated sender'],
    ['no-reply sender', { ...base, from: 'no-reply@shop.com' }, 'automated sender'],
    ['do-not-reply sender', { ...base, from: 'do-not-reply@shop.com' }, 'automated sender'],
    ['bounce', { ...base, from: 'MAILER-DAEMON@mx.example.com' }, 'automated sender'],
    ['out of office', { ...base, headers: { autoSubmitted: 'auto-replied' } }, 'auto-submitted'],
    ['bulk', { ...base, headers: { precedence: 'bulk' } }, 'bulk or auto-reply'],
  ])('flags %s', (_label, input, reason) => {
    expect(junkReason(input)).toBe(reason);
  });

  it.each([
    ['normal email', base],
    ['Auto-Submitted: no', { ...base, headers: { autoSubmitted: 'no' } }],
    ['name that starts with noreply-ish text', { ...base, from: 'noreen@example.com' }],
  ])('does not flag %s', (_label, input) => {
    expect(junkReason(input)).toBeNull();
  });
});
