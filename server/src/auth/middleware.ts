import type { RequestHandler } from 'express';
import { eq } from 'drizzle-orm';
import type { Role } from '@support-box/shared';
import type { Db } from '../db';
import { users } from '../db/schema';

declare module 'express-session' {
  interface SessionData {
    userId: number;
  }
}

export type CurrentUser = { id: number; email: string; name: string; role: Role };

/**
 * Loads the session user from the database on every request, so deactivating
 * a user takes effect immediately. Sets res.locals.user.
 */
export function requireAuth(db: Db): RequestHandler {
  return (req, res, next) => {
    const userId = req.session.userId;
    const user =
      userId === undefined
        ? undefined
        : db
            .select({
              id: users.id,
              email: users.email,
              name: users.name,
              role: users.role,
              active: users.active,
            })
            .from(users)
            .where(eq(users.id, userId))
            .get();
    if (!user || !user.active) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const { active: _active, ...current } = user;
    res.locals.user = current satisfies CurrentUser;
    next();
  };
}

/** Use after requireAuth. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.user as CurrentUser | undefined;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

/**
 * CSRF guard: state-changing API calls must send JSON. Browsers can't send a
 * cross-site JSON request without a CORS preflight, which we never allow.
 */
export const requireJsonForWrites: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.is('application/json')) {
    next();
    return;
  }
  res.status(415).json({ error: 'json_required' });
};
