import { API_URL } from "@/config";
import { refreshAccessToken, useSession } from "@/state/session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** UUID for replay-safe mutations (the outbox sets this). */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Fetch wrapper: bearer auth, one refresh-and-retry on 401, JSON in/out,
 * 15s timeout. Mutations routed through the outbox carry an Idempotency-Key
 * so offline replays cannot double-fire.
 */
export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, idempotencyKey, signal, timeoutMs = 15_000 } = options;

  const doFetch = async (token: string | null): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      return await fetch(`${API_URL}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const token = useSession.getState().accessToken;
  let res = await doFetch(token);

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      // Session is dead — sign out so the UI lands on login, not a spinner.
      await useSession.getState().signOut();
      throw new ApiError(401, "Session expired. Sign in again.");
    }
    res = await doFetch(refreshed);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      errBody?.message ?? `Request failed (${res.status})`,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
