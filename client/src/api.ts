export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    // Human-readable detail when the server provides one (e.g. why sending failed).
    readonly detail?: string,
  ) {
    super(code);
  }
}

/**
 * JSON fetch against our own /api. Writes always send a JSON body: the server
 * rejects non-JSON writes as a CSRF guard.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const method = init.method ?? 'GET';
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request_failed', data.message);
  return data as T;
}
