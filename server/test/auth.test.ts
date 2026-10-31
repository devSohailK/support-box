import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LoginLimiter } from '../src/auth/login-limiter';
import { requireRole } from '../src/auth/middleware';
import { seedUsers } from '../src/auth/seed';
import { users } from '../src/db/schema';
import { loginAs, TEST_PASSWORD, TEST_USERS, testApp, testDb } from './helpers';

const login = (app: express.Express, email: string, password: string) =>
  request(app).post('/api/auth/login').send({ email, password });

describe('login', () => {
  it('logs in with correct credentials and returns the user without the hash', async () => {
    const { app } = await testApp();
    const res = await login(app, 'Agent1@Test.local', TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'agent1@test.local', role: 'agent', name: 'Ben' });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^sb\.sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('gives the same 401 for wrong password and unknown email', async () => {
    const { app } = await testApp();
    const wrong = await login(app, 'agent1@test.local', 'nope');
    const unknown = await login(app, 'ghost@test.local', 'nope');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects inactive users', async () => {
    const { app, db } = await testApp();
    db.update(users).set({ active: false }).where(eq(users.email, 'agent2@test.local')).run();
    expect((await login(app, 'agent2@test.local', TEST_PASSWORD)).status).toBe(401);
  });

  it('blocks after 5 failed attempts, even with the right password', async () => {
    const { app } = await testApp({ loginLimiter: new LoginLimiter() });
    for (let i = 0; i < 5; i++) await login(app, 'agent1@test.local', 'bad');
    expect((await login(app, 'agent1@test.local', TEST_PASSWORD)).status).toBe(429);
  });

  it('rejects malformed bodies', async () => {
    const { app } = await testApp();
    expect((await login(app, 'not-an-email', 'x')).status).toBe(400);
  });

  it('rejects non-JSON writes (CSRF guard)', async () => {
    const { app } = await testApp();
    const res = await request(app)
      .post('/api/auth/login')
      .type('form')
      .send({ email: 'agent1@test.local', password: TEST_PASSWORD });
    expect(res.status).toBe(415);
  });
});

describe('session', () => {
  it('/me returns the current user, and 401 after logout', async () => {
    const { app } = await testApp();
    const agent = await loginAs(app, 'admin@test.local');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'admin@test.local', role: 'admin' });

    expect((await agent.post('/api/auth/logout').send({})).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('/me is 401 without a session', async () => {
    const { app } = await testApp();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('deactivating a user ends their access immediately', async () => {
    const { app, db } = await testApp();
    const agent = await loginAs(app, 'agent1@test.local');
    db.update(users).set({ active: false }).where(eq(users.email, 'agent1@test.local')).run();
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('requireRole', () => {
  const probe = (role: 'admin' | 'agent' | undefined) => {
    const app = express();
    app.use((_req, res, next) => {
      if (role) res.locals.user = { id: 1, email: 'x@test.local', name: 'X', role };
      next();
    });
    app.get('/', requireRole('admin'), (_req, res) => {
      res.json({ ok: true });
    });
    return request(app).get('/');
  };

  it('lets admins through', async () => {
    expect((await probe('admin')).status).toBe(200);
  });

  it('gives agents 403', async () => {
    expect((await probe('agent')).status).toBe(403);
  });

  it('gives 403 when there is no user', async () => {
    expect((await probe(undefined)).status).toBe(403);
  });
});

describe('seedUsers', () => {
  it('creates users once and never overwrites existing ones', async () => {
    const db = testDb();
    expect(await seedUsers(db, { SEED_USERS: TEST_USERS, SEED_PASSWORD: TEST_PASSWORD })).toBe(3);
    const before = db.select().from(users).where(eq(users.email, 'admin@test.local')).get();
    expect(
      await seedUsers(db, { SEED_USERS: TEST_USERS, SEED_PASSWORD: 'different-password' }),
    ).toBe(0);
    const after = db.select().from(users).where(eq(users.email, 'admin@test.local')).get();
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(before?.passwordHash).not.toContain(TEST_PASSWORD);
  });
});
