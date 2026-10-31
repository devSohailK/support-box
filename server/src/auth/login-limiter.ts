const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

/** In-memory failed-login counter per email. Fine for one instance; resets on restart. */
export class LoginLimiter {
  private failures = new Map<string, { count: number; firstAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  isBlocked(key: string) {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (this.now() - entry.firstAt > WINDOW_MS) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= MAX_FAILURES;
  }

  recordFailure(key: string) {
    const entry = this.failures.get(key);
    if (!entry || this.now() - entry.firstAt > WINDOW_MS) {
      this.failures.set(key, { count: 1, firstAt: this.now() });
    } else {
      entry.count += 1;
    }
  }

  reset(key: string) {
    this.failures.delete(key);
  }
}
