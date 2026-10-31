import { describe, expect, it } from 'vitest';
import { triageSchema } from '../src';

const valid = { category: 'billing', urgency: 1, draft_reply: 'Hi, thanks for reaching out.' };

describe('triageSchema', () => {
  it('accepts the expected shape', () => {
    expect(triageSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['unknown category', { ...valid, category: 'refunds' }],
    ['urgency out of range', { ...valid, urgency: 99 }],
    ['urgency as string', { ...valid, urgency: '1' }],
    ['empty draft', { ...valid, draft_reply: '   ' }],
    ['draft too long', { ...valid, draft_reply: 'a'.repeat(2001) }],
    ['missing field', { category: 'billing', urgency: 2 }],
    ['extra field', { ...valid, assignee: 'admin' }],
  ])('rejects %s', (_label, input) => {
    expect(triageSchema.safeParse(input).success).toBe(false);
  });
});
