import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { TicketDetail, TicketPage } from '@support-box/shared';
import { tickets, users } from '../src/db/schema';
import { createTicket, pickAssignee } from '../src/tickets/service';
import { loginAs, testApp } from './helpers';

const sample = (n: number, fromEmail = `customer${n}@example.com`) => ({
  source: 'form' as const,
  fromEmail,
  subject: `Subject ${n}`,
  body: `Body ${n}`,
});

const userId = (db: Awaited<ReturnType<typeof testApp>>['db'], email: string) =>
  db.select().from(users).where(eq(users.email, email)).get()!.id;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

describe('auto-assignment', () => {
  it('spreads tickets evenly across active agents, never to the admin', async () => {
    const { db } = await testApp();
    const assignees = Array.from({ length: 4 }, (_, i) => createTicket(db, sample(i)).assigneeId);
    const ben = userId(db, 'agent1@test.local');
    const cy = userId(db, 'agent2@test.local');
    expect(assignees).toEqual([ben, cy, ben, cy]);
  });

  it('picks the agent with the fewest non-closed tickets', async () => {
    const { db } = await testApp();
    const ben = userId(db, 'agent1@test.local');
    const cy = userId(db, 'agent2@test.local');
    createTicket(db, sample(1)); // ben
    createTicket(db, sample(2)); // cy
    createTicket(db, sample(3)); // ben (2 vs 1)
    // Cy closes theirs: Cy now has 0 open, Ben 2.
    db.update(tickets).set({ status: 'closed' }).where(eq(tickets.assigneeId, cy)).run();
    expect(pickAssignee(db)).toBe(cy);
    createTicket(db, sample(4));
    expect(pickAssignee(db)).toBe(cy); // Cy 1 vs Ben 2
    expect(ben).not.toBe(cy);
  });

  it('skips inactive agents and falls back to an admin when none are active', async () => {
    const { db } = await testApp();
    db.update(users).set({ active: false }).where(eq(users.email, 'agent1@test.local')).run();
    expect(pickAssignee(db)).toBe(userId(db, 'agent2@test.local'));
    db.update(users).set({ active: false }).where(eq(users.email, 'agent2@test.local')).run();
    expect(pickAssignee(db)).toBe(userId(db, 'admin@test.local'));
  });
});

describe('POST /api/tickets', () => {
  it('creates a ticket from the form, assigned and in status new', async () => {
    const { app } = await testApp();
    const agent = await loginAs(app, 'agent1@test.local');
    const res = await agent.post('/api/tickets').send({
      fromEmail: 'Jane@Example.com',
      fromName: 'Jane',
      subject: 'Cannot log in',
      body: 'Help please',
    });
    expect(res.status).toBe(201);
    const t = res.body as TicketDetail;
    expect(t).toMatchObject({ fromEmail: 'jane@example.com', status: 'new', source: 'form' });
    expect(t.assignee.name).toBeTruthy();
  });

  it('validates input and rejects unknown fields', async () => {
    const { app } = await testApp();
    const agent = await loginAs(app, 'agent1@test.local');
    expect((await agent.post('/api/tickets').send({ fromEmail: 'x', subject: '', body: '' })).status).toBe(400);
    const sneaky = await agent.post('/api/tickets').send({
      fromEmail: 'a@b.com',
      subject: 's',
      body: 'b',
      assigneeId: 1,
    });
    expect(sneaky.status).toBe(400);
  });

  it('requires login', async () => {
    const { app } = await testApp();
    expect((await request(app).get('/api/tickets')).status).toBe(401);
  });
});

describe('GET /api/tickets', () => {
  it('pages results newest first, 20 per page', async () => {
    const { app, db } = await testApp();
    for (let i = 1; i <= 25; i++) createTicket(db, sample(i));
    const agent = await loginAs(app, 'agent1@test.local');

    const p1 = (await agent.get('/api/tickets')).body as TicketPage;
    expect(p1).toMatchObject({ page: 1, pageSize: 20, total: 25, totalPages: 2 });
    expect(p1.items).toHaveLength(20);
    expect(p1.items[0]!.subject).toBe('Subject 25');

    const p2 = (await agent.get('/api/tickets?page=2')).body as TicketPage;
    expect(p2.items.map((t) => t.subject)).toEqual([5, 4, 3, 2, 1].map((n) => `Subject ${n}`));
  });

  it('filters by status', async () => {
    const { app, db } = await testApp();
    const a = createTicket(db, sample(1));
    createTicket(db, sample(2));
    db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, a.id)).run();
    const agent = await loginAs(app, 'agent1@test.local');

    const closed = (await agent.get('/api/tickets?status=closed')).body as TicketPage;
    expect(closed.items.map((t) => t.id)).toEqual([a.id]);
    expect((await agent.get('/api/tickets?status=bogus')).status).toBe(400);
  });

  it('marks and filters overdue: older than 24h and not replied', async () => {
    const { app, db } = await testApp();
    const old = createTicket(db, sample(1));
    const oldReplied = createTicket(db, sample(2));
    const fresh = createTicket(db, sample(3));
    db.update(tickets).set({ createdAt: hoursAgo(25) }).where(eq(tickets.id, old.id)).run();
    db.update(tickets)
      .set({ createdAt: hoursAgo(30), status: 'replied' })
      .where(eq(tickets.id, oldReplied.id))
      .run();
    const agent = await loginAs(app, 'agent1@test.local');

    const all = (await agent.get('/api/tickets')).body as TicketPage;
    const flags = Object.fromEntries(all.items.map((t) => [t.id, t.overdue]));
    expect(flags).toEqual({ [old.id]: true, [oldReplied.id]: false, [fresh.id]: false });

    const overdue = (await agent.get('/api/tickets?overdue=true')).body as TicketPage;
    expect(overdue.items.map((t) => t.id)).toEqual([old.id]);

    const combined = (await agent.get('/api/tickets?overdue=true&status=open')).body as TicketPage;
    expect(combined.total).toBe(0);
  });
});

describe('GET /api/tickets/:id', () => {
  it('shows all tickets to everyone, with canEdit only for the assignee or an admin', async () => {
    const { app, db } = await testApp();
    const t = createTicket(db, sample(1)); // assigned to Ben (agent1)
    const ben = await loginAs(app, 'agent1@test.local');
    const cy = await loginAs(app, 'agent2@test.local');
    const admin = await loginAs(app, 'admin@test.local');

    expect((await ben.get(`/api/tickets/${t.id}`)).body.canEdit).toBe(true);
    const asCy = await cy.get(`/api/tickets/${t.id}`);
    expect(asCy.status).toBe(200);
    expect(asCy.body.canEdit).toBe(false);
    expect((await admin.get(`/api/tickets/${t.id}`)).body.canEdit).toBe(true);
  });

  it('lists other tickets from the same sender', async () => {
    const { app, db } = await testApp();
    const first = createTicket(db, sample(1, 'repeat@example.com'));
    const second = createTicket(db, sample(2, 'repeat@example.com'));
    createTicket(db, sample(3, 'someone-else@example.com'));
    const agent = await loginAs(app, 'agent1@test.local');
    const res = (await agent.get(`/api/tickets/${second.id}`)).body as TicketDetail;
    expect(res.otherFromSender.map((t) => t.id)).toEqual([first.id]);
  });

  it('404s for missing tickets and 400s for bad ids', async () => {
    const { app } = await testApp();
    const agent = await loginAs(app, 'agent1@test.local');
    expect((await agent.get('/api/tickets/999')).status).toBe(404);
    expect((await agent.get('/api/tickets/abc')).status).toBe(400);
  });
});

describe('reassign', () => {
  it('lets admins reassign to an active user', async () => {
    const { app, db } = await testApp();
    const t = createTicket(db, sample(1));
    const cy = userId(db, 'agent2@test.local');
    const admin = await loginAs(app, 'admin@test.local');
    const res = await admin.post(`/api/tickets/${t.id}/reassign`).send({ assigneeId: cy });
    expect(res.status).toBe(200);
    expect(res.body.assignee.id).toBe(cy);
  });

  it('forbids agents, even on their own ticket', async () => {
    const { app, db } = await testApp();
    const t = createTicket(db, sample(1)); // Ben's
    const ben = await loginAs(app, 'agent1@test.local');
    const res = await ben
      .post(`/api/tickets/${t.id}/reassign`)
      .send({ assigneeId: userId(db, 'agent2@test.local') });
    expect(res.status).toBe(403);
    expect(db.select().from(tickets).where(eq(tickets.id, t.id)).get()!.assigneeId).toBe(t.assigneeId);
  });

  it('rejects inactive or unknown assignees and closed tickets', async () => {
    const { app, db } = await testApp();
    const t = createTicket(db, sample(1));
    const admin = await loginAs(app, 'admin@test.local');
    db.update(users).set({ active: false }).where(eq(users.email, 'agent2@test.local')).run();
    const inactive = userId(db, 'agent2@test.local');
    expect((await admin.post(`/api/tickets/${t.id}/reassign`).send({ assigneeId: inactive })).status).toBe(400);
    expect((await admin.post(`/api/tickets/${t.id}/reassign`).send({ assigneeId: 999 })).status).toBe(400);

    db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, t.id)).run();
    const ben = userId(db, 'agent1@test.local');
    expect((await admin.post(`/api/tickets/${t.id}/reassign`).send({ assigneeId: ben })).status).toBe(409);
  });

  it('lists assignable users with their open counts (admin only)', async () => {
    const { app, db } = await testApp();
    createTicket(db, sample(1));
    const admin = await loginAs(app, 'admin@test.local');
    const res = await admin.get('/api/tickets/assignees');
    expect(res.status).toBe(200);
    expect(res.body.map((u: { name: string; openTickets: number }) => [u.name, u.openTickets])).toEqual([
      ['Ada', 0],
      ['Ben', 1],
      ['Cy', 0],
    ]);
    const agent = await loginAs(app, 'agent1@test.local');
    expect((await agent.get('/api/tickets/assignees')).status).toBe(403);
  });
});

describe('close', () => {
  it('lets the assignee close, and records closedAt', async () => {
    const { app, db } = await testApp();
    const t = createTicket(db, sample(1)); // Ben's
    const ben = await loginAs(app, 'agent1@test.local');
    const res = await ben.post(`/api/tickets/${t.id}/close`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(res.body.closedAt).toBeTruthy();
    expect((await ben.post(`/api/tickets/${t.id}/close`).send({})).status).toBe(409);
  });

  it('forbids other agents but allows admins', async () => {
    const { app, db } = await testApp();
    const t = createTicket(db, sample(1)); // Ben's
    const cy = await loginAs(app, 'agent2@test.local');
    expect((await cy.post(`/api/tickets/${t.id}/close`).send({})).status).toBe(403);
    const admin = await loginAs(app, 'admin@test.local');
    expect((await admin.post(`/api/tickets/${t.id}/close`).send({})).status).toBe(200);
  });
});

describe('mine filter and counts', () => {
  it('lists only my non-closed tickets, and counts by status, mine and overdue', async () => {
    const { app, db } = await testApp();
    const a = createTicket(db, sample(1)); // Ben
    const b = createTicket(db, sample(2)); // Cy
    const c = createTicket(db, sample(3)); // Ben
    db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, c.id)).run();
    db.update(tickets).set({ createdAt: hoursAgo(30) }).where(eq(tickets.id, b.id)).run();
    const ben = await loginAs(app, 'agent1@test.local');

    const mine = (await ben.get('/api/tickets?mine=true')).body as TicketPage;
    expect(mine.items.map((t) => t.id)).toEqual([a.id]);
    const mineClosed = (await ben.get('/api/tickets?mine=true&status=closed')).body as TicketPage;
    expect(mineClosed.items.map((t) => t.id)).toEqual([c.id]);

    const counts = (await ben.get('/api/tickets/counts')).body;
    expect(counts).toEqual({ new: 2, open: 0, ai_error: 0, replied: 0, closed: 1, all: 3, mine: 1, overdue: 1 });
  });
});

describe('default list', () => {
  it('leaves out closed tickets unless the closed status is asked for, and flags automated ones', async () => {
    const { app, db } = await testApp();
    const open = createTicket(db, sample(1));
    const closed = createTicket(db, sample(2));
    const junk = createTicket(db, { ...sample(3), aiSkipReason: 'automated sender' });
    db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, closed.id)).run();
    const ben = await loginAs(app, 'agent1@test.local');
    const all = (await ben.get('/api/tickets')).body as TicketPage;
    expect(all.items.map((t) => t.id).sort()).toEqual([open.id, junk.id].sort());
    expect(Object.fromEntries(all.items.map((t) => [t.id, t.automated]))).toEqual({ [open.id]: false, [junk.id]: true });
  });
});
