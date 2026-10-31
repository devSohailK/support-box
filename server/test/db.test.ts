import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { testDb } from './helpers';

describe('migrations', () => {
  it('create all tables', () => {
    const rows = testDb().all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' order by name`,
    );
    const tables = rows
      .map((r) => r.name)
      .filter((n) => !n.startsWith('__') && !n.startsWith('sqlite_'));
    expect(tables).toEqual(['ai_attempts', 'replies', 'sessions', 'tickets', 'users']);
  });
});
