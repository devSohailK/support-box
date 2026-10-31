import type { Config } from '../config';
import type { Db } from '../db';
import { users } from '../db/schema';
import { hashPassword } from './passwords';

/** Creates SEED_USERS that don't exist yet. Existing users are never modified. */
export async function seedUsers(
  db: Db,
  config: Pick<Config, 'SEED_USERS' | 'SEED_PASSWORD'>,
  rounds?: number, // tests use a low cost; production uses the default
) {
  if (config.SEED_USERS.length === 0 || !config.SEED_PASSWORD) return 0;
  const passwordHash = await hashPassword(config.SEED_PASSWORD, rounds);
  let created = 0;
  for (const u of config.SEED_USERS) {
    const result = db
      .insert(users)
      .values({ email: u.email, name: u.name, role: u.role, passwordHash })
      .onConflictDoNothing({ target: users.email })
      .run();
    created += result.changes;
  }
  return created;
}
