import { z } from 'zod';
import { MAX_BODY_CHARS } from './tickets';

const MAX_SUBJECT_CHARS = 200;

/**
 * Inbound email as posted to the webhook (by the sample script or the Gmail connector).
 * Long subjects and bodies are truncated, not rejected, so no email is lost.
 */
export const inboundEmailSchema = z.object({
  messageId: z.string().trim().min(1).max(500),
  from: z.email().trim().toLowerCase(),
  fromName: z.string().trim().max(200).optional(),
  subject: z
    .string()
    .trim()
    .max(5000)
    .transform((s) => (s || '(no subject)').slice(0, MAX_SUBJECT_CHARS)),
  body: z
    .string()
    .max(200_000)
    .transform((s) => s.trim().slice(0, MAX_BODY_CHARS)),
  // Only the headers we use for junk detection.
  headers: z
    .object({
      autoSubmitted: z.string().max(100).optional(),
      precedence: z.string().max(100).optional(),
    })
    .optional(),
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;

export type WebhookResponse =
  | { status: 'accepted'; ticketId: number }
  | { status: 'duplicate'; ticketId: number };
