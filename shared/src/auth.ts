import { z } from 'zod';
import { roleSchema } from './tickets';

export const loginRequestSchema = z.strictObject({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
