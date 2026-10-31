import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { TicketDetail } from '@support-box/shared';
import { replies, tickets } from '../src/db/schema';
import { MailError, replySubject } from '../src/mail/mailer';
import { loginAs, testApp, VALID_TRIAGE, WEBHOOK_SECRET } from './helpers';

type Ctx = Awaited<ReturnType<typeof testApp>>;

/** A webhook ticket, triaged by the fake AI, plus logged-in owner / other agent / admin. */
async function setup(opts: Parameters<typeof testApp>[0] = {}) {
  const ctx = await testApp(opts);
  const res = await request(ctx.app)
    .post('/api/webhook/email')
    .set('X-Webhook-Secret', WEBHOOK_SECRET)
    .send({
      messageId: '<orig-1@mail.example.com>',
      from: 'jane@example.com',
      fromName: 'Jane',
      subject: 'Charged twice',
      body: 'My card was charged twice.',
    });
  await ctx.triage.idle();
  const id = res.body.ticketId as number;
  const t = ctx.db.select().from(tickets).where(eq(tickets.id, id)).get()!;
  const [ownerEmail, otherEmail] =
    t.assigneeId === 2 ? ['agent1@test.local', 'agent2@test.local'] : ['agent2@test.local', 'agent1@test.local'];
  return {
    ...ctx,
    id,
    owner: await loginAs(ctx.app, ownerEmail),
    other: await loginAs(ctx.app, otherEmail),
    admin: await loginAs(ctx.app, 'admin@test.local'),
    ownerId: t.assigneeId,
  };
}

const ticketRow = (ctx: Ctx, id: number) => ctx.db.select().from(tickets).where(eq(tickets.id, id)).get()!;
const replyRows = (ctx: Ctx, id: number) => ctx.db.select().from(replies).where(eq(replies.ticketId, id)).all();

describe('send reply', () => {
  it('sends the edited text, threads it, records who and when, and marks the ticket replied', async () => {
    const s = await setup();
    const before = Date.now();
    const res = await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'Edited reply. The Support Team' });
    expect(res.status).toBe(200);

    expect(s.mailer.sent).toEqual([
      {
        to: 'jane@example.com',
        subject: 'Re: Charged twice',
        text: 'Edited reply. The Support Team',
        inReplyTo: '<orig-1@mail.example.com>',
      },
    ]);
    const t = res.body as TicketDetail;
    expect(t.status).toBe('replied');
    expect(t.draft).toBe('Edited reply. The Support Team'); // draft overwritten in place
    expect(t.reply).toMatchObject({
      body: 'Edited reply. The Support Team',
      toEmail: 'jane@example.com',
      sentBy: { id: s.ownerId },
      mailMode: 'demo',
      deliveryStatus: 'sent',
      deliveryError: null,
    });
    expect(Date.parse(t.reply!.sentAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('never sends without an explicit request: triage alone sends nothing', async () => {
    const s = await setup();
    expect(ticketRow(s, s.id).status).toBe('open');
    expect(s.mailer.sent).toHaveLength(0);
    expect(replyRows(s, s.id)).toHaveLength(0);
  });

  it('blocks a second send (double click) and sends only once', async () => {
    const s = await setup();
    const [a, b] = await Promise.all([
      s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'one' }),
      s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'two' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(s.mailer.sent).toHaveLength(1);
    expect(replyRows(s, s.id)).toHaveLength(1);
    const again = await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'three' });
    expect(again.body.error).toBe('already_sent');
  });

  it('only the assignee or an admin can send', async () => {
    const s = await setup();
    expect((await s.other.post(`/api/tickets/${s.id}/send`).send({ body: 'x' })).status).toBe(403);
    expect(s.mailer.sent).toHaveLength(0);
    const asAdmin = await s.admin.post(`/api/tickets/${s.id}/send`).send({ body: 'From admin' });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.reply.sentBy.name).toBe('Ada');
  });

  it('cannot send on a closed ticket', async () => {
    const s = await setup();
    await s.owner.post(`/api/tickets/${s.id}/close`).send({});
    const res = await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'late' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ticket_closed');
    expect(s.mailer.sent).toHaveLength(0);
  });

  it('allows a manual reply when the AI failed', async () => {
    const s = await setup();
    s.db.update(tickets).set({ status: 'ai_error', draft: null }).where(eq(tickets.id, s.id)).run();
    const res = await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'Written by hand' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('replied');
  });

  it('rejects empty or oversized bodies', async () => {
    const s = await setup();
    expect((await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: '   ' })).status).toBe(400);
    expect((await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'a'.repeat(5001) })).status).toBe(400);
    expect(s.mailer.sent).toHaveLength(0);
  });

  it('on SMTP failure: records the failure, restores the ticket, and allows sending again', async () => {
    const s = await setup();
    s.mailer.setFailure(new MailError('Could not connect to the mail server'));
    const failed = await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'First try' });
    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({ error: 'send_failed', message: 'Could not connect to the mail server' });
    expect(ticketRow(s, s.id).status).toBe('open');
    expect(replyRows(s, s.id)[0]).toMatchObject({ deliveryStatus: 'failed', deliveryError: 'Could not connect to the mail server' });

    s.mailer.setFailure(undefined);
    const ok = await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'Second try' });
    expect(ok.status).toBe(200);
    expect(replyRows(s, s.id)).toHaveLength(1);
    expect(replyRows(s, s.id)[0]).toMatchObject({ body: 'Second try', deliveryStatus: 'sent', deliveryError: null });
    expect(s.mailer.sent.map((m) => m.text)).toEqual(['Second try']);
  });

  it('does not leak unexpected mailer errors', async () => {
    const s = await setup();
    s.mailer.setFailure(new Error('535 auth failed for user secret@gmail.com pass=hunter2'));
    const res = await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'x' });
    expect(res.body.message).toBe('Sending failed');
  });

  it('lets the agent close the ticket after replying', async () => {
    const s = await setup();
    await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: 'Done' });
    const closed = await s.owner.post(`/api/tickets/${s.id}/close`).send({});
    expect(closed.body.status).toBe('closed');
    expect(closed.body.reply.deliveryStatus).toBe('sent');
  });
});

describe('save draft', () => {
  it('saves edits for the assignee', async () => {
    const s = await setup();
    const res = await s.owner.put(`/api/tickets/${s.id}/draft`).send({ draft: 'Work in progress' });
    expect(res.status).toBe(200);
    expect(res.body.draft).toBe('Work in progress');
    expect(s.mailer.sent).toHaveLength(0);
  });

  it('is forbidden for other agents and not possible after sending', async () => {
    const s = await setup();
    expect((await s.other.put(`/api/tickets/${s.id}/draft`).send({ draft: 'x' })).status).toBe(403);
    await s.owner.post(`/api/tickets/${s.id}/send`).send({ body: VALID_TRIAGE.draft_reply });
    expect((await s.owner.put(`/api/tickets/${s.id}/draft`).send({ draft: 'x' })).status).toBe(409);
  });
});

describe('replySubject', () => {
  it('adds Re: once', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
  });
});
