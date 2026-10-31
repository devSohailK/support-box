import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatClient } from './ai/client';
import { TriageRunner } from './ai/triage';
import { createApp } from './app';
import { seedUsers } from './auth/seed';
import { loadConfig } from './config';
import { openDb } from './db';
import { createMailer } from './mail/mailer';

const config = loadConfig();
// Works for both src/index.ts (dev) and dist/index.js (build): both sit one level below server/.
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const db = openDb(config.DATABASE_PATH, migrationsFolder);

const created = await seedUsers(db, config);
if (created > 0) console.log(`Seeded ${created} user(s)`);

const chat = createChatClient(config);
const triage = new TriageRunner(db, chat, config.AI_MODEL);
console.log(chat ? `AI triage: ${config.AI_MODEL} via ${new URL(config.AI_BASE_URL).host}` : 'AI triage: not configured');
const resumed = triage.resumeUnattempted();
if (resumed > 0) console.log(`Resumed triage for ${resumed} ticket(s)`);

const mailer = createMailer(config);
console.log(`Mail: ${config.MAIL_MODE} mode via ${config.SMTP_HOST}:${config.SMTP_PORT}`);

createApp({ db, config, triage, mailer }).listen(config.PORT, () => {
  console.log(`API listening on :${config.PORT} (${config.NODE_ENV})`);
});
