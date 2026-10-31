import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inboundEmailSchema } from '@support-box/shared';
import { junkReason } from '../src/tickets/junk';

const dir = resolve(import.meta.dirname, '../../samples/emails');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const JUNK = new Set(['11-out-of-office.json', '12-bounce.json']);

describe('sample emails', () => {
  it('exist', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)('%s matches the webhook schema and junk expectations', (file) => {
    const parsed = inboundEmailSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    expect(junkReason(parsed) !== null).toBe(JUNK.has(file));
  });

  it('have unique message ids', () => {
    const ids = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).messageId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
