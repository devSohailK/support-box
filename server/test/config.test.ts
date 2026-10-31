import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = { SESSION_SECRET: 'x'.repeat(32), WEBHOOK_SECRET: 'w'.repeat(16) };

describe('loadConfig', () => {
  it('parses SEED_USERS', () => {
    const config = loadConfig({
      ...base,
      SEED_USERS: 'admin:Sara@Team.local:Sara Khan, agent:ali@team.local:Ali',
      SEED_PASSWORD: 'long-enough',
    });
    expect(config.SEED_USERS).toEqual([
      { role: 'admin', email: 'sara@team.local', name: 'Sara Khan' },
      { role: 'agent', email: 'ali@team.local', name: 'Ali' },
    ]);
  });

  it('rejects a bad seed role without echoing secrets', () => {
    expect(() =>
      loadConfig({ ...base, SEED_USERS: 'boss:x@team.local:X', SEED_PASSWORD: 'long-enough' }),
    ).toThrow(/SEED_USERS/);
  });

  it('requires SEED_PASSWORD when SEED_USERS is set', () => {
    expect(() => loadConfig({ ...base, SEED_USERS: 'agent:a@team.local:A' })).toThrow(
      /SEED_PASSWORD/,
    );
  });

  it('rejects a short SESSION_SECRET without printing it', () => {
    let message = '';
    try {
      loadConfig({ ...base, SESSION_SECRET: 'short-secret-value' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/SESSION_SECRET/);
    expect(message).not.toContain('short-secret-value');
  });

  it('refuses demo mail mode with a real SMTP server', () => {
    expect(() => loadConfig({ ...base, MAIL_MODE: 'demo', SMTP_HOST: 'smtp.gmail.com' })).toThrow(
      /MAIL_MODE=demo/,
    );
    expect(loadConfig({ ...base, MAIL_MODE: 'demo', SMTP_HOST: 'mailpit' }).MAIL_MODE).toBe('demo');
  });

  it('requires SMTP credentials in production mail mode', () => {
    expect(() =>
      loadConfig({ ...base, MAIL_MODE: 'production', SMTP_HOST: 'smtp.gmail.com' }),
    ).toThrow(/SMTP_USER/);
  });

  it('reads COOKIE_SECURE as a boolean', () => {
    expect(loadConfig({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(loadConfig(base).COOKIE_SECURE).toBe(false);
  });
});
