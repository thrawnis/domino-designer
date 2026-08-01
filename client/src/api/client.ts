export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

interface ZodFlattenedError {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
}

/**
 * Extracts a human-readable message from an error, preferring the specific
 * per-field reason (e.g. "Password must be at least 10 characters") over the
 * server's generic top-level message (e.g. "Invalid input"), which is all
 * `err.message` alone gives you for a Zod validation failure.
 */
export function describeApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const details = err.details as ZodFlattenedError | undefined;
    const messages = [
      ...(details?.formErrors ?? []),
      ...Object.values(details?.fieldErrors ?? {}).flatMap((m) => m ?? []),
    ];
    return messages.length > 0 ? messages.join(' ') : err.message;
  }
  return fallback;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'X-Requested-With': 'domino-designer',
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText, body?.details);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data !== undefined ? JSON.stringify(data) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
