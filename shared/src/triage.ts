import { z } from 'zod';

export const CATEGORIES = ['billing', 'account', 'technical', 'feature_request', 'other'] as const;
export const categorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof categorySchema>;

// 1 = urgent, 2 = normal, 3 = low.
export const urgencySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Urgency = z.infer<typeof urgencySchema>;

// The exact shape the AI must return. Anything else is shown as an error, never as a draft.
export const triageSchema = z.strictObject({
  category: categorySchema,
  urgency: urgencySchema,
  draft_reply: z.string().trim().min(1).max(2000),
});
export type Triage = z.infer<typeof triageSchema>;
