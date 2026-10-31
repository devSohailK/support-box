import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers';

describe('health', () => {
  it('returns ok when the database responds', async () => {
    const { app } = await testApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const { app } = await testApp();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });
});
