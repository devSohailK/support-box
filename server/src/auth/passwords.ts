import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export function hashPassword(password: string, rounds = ROUNDS) {
  return bcrypt.hash(password, rounds);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', ROUNDS);
