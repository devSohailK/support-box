#!/usr/bin/env node
// Posts the sample emails in samples/emails to the webhook, then re-sends the first one
// to show that duplicates are ignored.
//
//   npm run samples                         # http://localhost, secret from .env
//   npm run samples -- --url https://x.sslip.io
//   npm run samples -- --only 01            # just files starting with 01

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.WEBHOOK_URL ?? 'http://localhost' },
    only: { type: 'string' },
    delay: { type: 'string', default: '300' },
  },
});

const secret = process.env.WEBHOOK_SECRET;
if (!secret) {
  console.error('WEBHOOK_SECRET is not set. Run via `npm run samples` (loads .env) or export it.');
  process.exit(1);
}

const dir = join(import.meta.dirname, '..', 'samples', 'emails');
const files = (await readdir(dir))
  .filter((f) => f.endsWith('.json') && (!values.only || f.startsWith(values.only)))
  .sort();
if (files.length === 0) {
  console.error('No sample emails matched.');
  process.exit(1);
}

const endpoint = new URL('/api/webhook/email', values.url).toString();

async function send(file) {
  const body = await readFile(join(dir, file), 'utf8');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret },
    body,
  });
  const text = await res.text();
  console.log(`${String(res.status).padEnd(4)} ${file.padEnd(36)} ${text}`);
  return res.ok;
}

console.log(`Posting ${files.length} sample email(s) to ${endpoint}\n`);
let failures = 0;
for (const file of files) {
  if (!(await send(file))) failures++;
  await new Promise((r) => setTimeout(r, Number(values.delay)));
}
if (!values.only) {
  console.log('\nRe-sending the first email (expect "duplicate"):');
  if (!(await send(files[0]))) failures++;
}
process.exit(failures ? 1 : 0);
