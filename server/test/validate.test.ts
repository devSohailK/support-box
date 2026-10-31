import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from '../src/middleware/validate';

const app = express();
app.use(express.json());
app.post(
  '/things/:id',
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.strictObject({ name: z.string().min(1) }),
  }),
  (_req, res) => {
    res.json(res.locals.validated);
  },
);

describe('validate middleware', () => {
  it('passes parsed values through', async () => {
    const res = await request(app).post('/things/7').send({ name: 'x' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { id: 7 }, body: { name: 'x' } });
  });

  it('rejects invalid params with 400', async () => {
    const res = await request(app).post('/things/abc').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.part).toBe('params');
  });

  it('rejects unknown body keys', async () => {
    const res = await request(app).post('/things/1').send({ name: 'x', role: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.part).toBe('body');
  });
});
