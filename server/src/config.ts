import { z } from 'zod';
import { roleSchema } from '@support-box/shared';

// "role:email:name,role:email:name"
const seedUsersSchema = z
  .string()
  .default('')
  .transform((raw, ctx) => {
    const users = [];
    for (const entry of raw.split(',').map((e) => e.trim()).filter(Boolean)) {
      const [role, email, ...nameParts] = entry.split(':');
      const parsed = z
        .object({ role: roleSchema, email: z.email().toLowerCase(), name: z.string().trim().min(1) })
        .safeParse({ role, email, name: nameParts.join(':') });
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: `invalid entry "${entry}"` });
        return z.NEVER;
      }
      users.push(parsed.data);
    }
    return users;
  });

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

// Only settings used so far are validated here; later steps add theirs.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/app.db'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Secure cookies need HTTPS; false only for local plain-HTTP runs.
  COOKIE_SECURE: booleanString.default(false),
  SEED_USERS: seedUsersSchema,
  SEED_PASSWORD: z.string().min(8, 'must be at least 8 characters').optional(),
  WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters'),
  // Any OpenAI-compatible chat completions API. Without a key, tickets show "AI not configured".
  AI_BASE_URL: z.url().default('https://api.deepseek.com'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().min(1).default('deepseek-chat'),
  AI_MAX_TOKENS: z.coerce.number().int().min(100).max(2000).default(700),
  // demo = Mailpit catches everything; production = real SMTP provider (e.g. Gmail app password).
  MAIL_MODE: z.enum(['demo', 'production']).default('demo'),
  SMTP_HOST: z.string().min(1).default('mailpit'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(3).default('Support <support@team.local>'),
  // Optional: where customer replies should go (e.g. yourname+support@gmail.com so they get the label).
  SMTP_REPLY_TO: z.string().optional(),
});

// Demo mode must never be able to email a real customer.
const DEMO_SMTP_HOSTS = new Set(['mailpit', 'localhost', '127.0.0.1']);

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report which variables are wrong and why, never their values.
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const c = parsed.data;
  if (c.SEED_USERS.length > 0 && !c.SEED_PASSWORD) {
    throw new Error('Invalid environment configuration: SEED_PASSWORD is required when SEED_USERS is set');
  }
  if (c.MAIL_MODE === 'demo' && !DEMO_SMTP_HOSTS.has(c.SMTP_HOST)) {
    throw new Error(
      'Invalid environment configuration: SMTP_HOST: MAIL_MODE=demo only allows a local catcher (mailpit/localhost)',
    );
  }
  if (c.MAIL_MODE === 'production' && (!c.SMTP_USER || !c.SMTP_PASSWORD)) {
    throw new Error('Invalid environment configuration: SMTP_USER and SMTP_PASSWORD are required in production mail mode');
  }
  return c;
}
