import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { loginRequestSchema, type LoginRequest, type SessionUser } from '@support-box/shared';
import type { Db } from '../db';
import { users } from '../db/schema';
import { requireAuth } from '../auth/middleware';
import { LoginLimiter } from '../auth/login-limiter';
import { DUMMY_HASH, verifyPassword } from '../auth/passwords';
import { validate } from '../middleware/validate';

export const SESSION_COOKIE = 'sb.sid';

export function authRouter(db: Db, limiter = new LoginLimiter()) {
  const router = Router();

  router.post('/login', validate({ body: loginRequestSchema }), async (req, res, next) => {
    try {
      const { email, password } = res.locals.validated.body as LoginRequest;
      if (limiter.isBlocked(email)) {
        res.status(429).json({ error: 'too_many_attempts' });
        return;
      }
      const user = db.select().from(users).where(eq(users.email, email)).get();
      const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !user.active || !passwordOk) {
        limiter.recordFailure(email);
        // Same response for unknown email, wrong password and inactive user.
        res.status(401).json({ error: 'invalid_credentials' });
        return;
      }
      limiter.reset(email);
      // New session id on login prevents session fixation.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          const body: SessionUser = { id: user.id, email: user.email, name: user.name, role: user.role };
          res.json({ user: body });
        });
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie(SESSION_COOKIE);
      res.status(204).end();
    });
  });

  router.get('/me', requireAuth(db), (_req, res) => {
    res.json({ user: res.locals.user as SessionUser });
  });

  return router;
}
