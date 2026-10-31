import type { Config } from '../config';

export type ChatRequest = { system: string; user: string };

export type ChatResult = {
  content: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

/** One chat completion. Implementations must not retry: one call per ticket. */
export type ChatFn = (req: ChatRequest) => Promise<ChatResult>;

const TIMEOUT_MS = 30_000;

/** Errors that are safe to show in the UI and store: no keys, no response bodies. */
export class AiCallError extends Error {}

type AiConfig = Pick<Config, 'AI_BASE_URL' | 'AI_API_KEY' | 'AI_MODEL' | 'AI_MAX_TOKENS'>;

/** OpenAI-compatible /chat/completions client (DeepSeek by default), with JSON output mode. */
export function createChatClient(config: AiConfig): ChatFn | null {
  const apiKey = config.AI_API_KEY;
  if (!apiKey) return null;
  const url = `${config.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`;

  return async ({ system, user }) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: config.AI_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          max_tokens: config.AI_MAX_TOKENS,
          temperature: 0.3,
          stream: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new AiCallError(timedOut ? 'AI request timed out' : 'Could not reach the AI service');
    }

    if (!res.ok) {
      const reason =
        res.status === 401 ? 'invalid API key' :
        res.status === 402 ? 'insufficient balance or spend cap reached' :
        res.status === 429 ? 'rate limited' :
        `HTTP ${res.status}`;
      throw new AiCallError(`AI service error: ${reason}`);
    }

    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const choice = data?.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      finishReason: choice?.finish_reason ?? null,
      inputTokens: data?.usage?.prompt_tokens ?? null,
      outputTokens: data?.usage?.completion_tokens ?? null,
    };
  };
}
