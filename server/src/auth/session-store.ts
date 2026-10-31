import { eq, lt } from 'drizzle-orm';
import session from 'express-session';
import type { Db } from '../db';
import { sessions } from '../db/schema';

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

/** Minimal express-session store on our own SQLite database. */
export class SqliteSessionStore extends session.Store {
  constructor(private readonly db: Db) {
    super();
  }

  private expiry(sess: session.SessionData) {
    const expires = sess.cookie?.expires;
    return expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS;
  }

  get(sid: string, cb: (err: unknown, sess?: session.SessionData | null) => void) {
    try {
      const row = this.db.select().from(sessions).where(eq(sessions.sid, sid)).get();
      if (!row || row.expiresAt <= Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data) as session.SessionData);
    } catch (err) {
      cb(err);
    }
  }

  set(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void) {
    try {
      const values = { sid, data: JSON.stringify(sess), expiresAt: this.expiry(sess) };
      this.db
        .insert(sessions)
        .values(values)
        .onConflictDoUpdate({ target: sessions.sid, set: values })
        .run();
      // Cheap housekeeping instead of a timer.
      this.db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid: string, cb?: (err?: unknown) => void) {
    try {
      this.db.delete(sessions).where(eq(sessions.sid, sid)).run();
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void) {
    try {
      this.db
        .update(sessions)
        .set({ expiresAt: this.expiry(sess) })
        .where(eq(sessions.sid, sid))
        .run();
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }
}
