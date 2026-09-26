import { API_URL } from "@/config";
import { refreshAccessToken, useSession } from "@/state/session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * The parsed error body, when the server sent JSON.
     *
     * Added 2026-09-05: a refusal can carry more than a sentence. A second
     * delivery answers 409 with the EARLIER delivery on it (founder, batch 46)
     * so a screen can show who booked the wine in and when instead of an error,
     * and keeping only `message` threw that away at the boundary.
     */
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

export interface RequestScope {
  userId: string;
  restaurantId: string;
}

interface RequestOptions {
  scope?: RequestScope;
  sealChallenge?: string;
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
  const {
    method = "GET",
    body,
    idempotencyKey,
    signal,
    timeoutMs = 15_000,
  } = options;
  const generation = useSession.getState().generation;
  const assertScope = () => {
    const session = useSession.getState();
    if (
      session.generation !== generation ||
      (options.scope &&
        (session.status !== "signedIn" ||
          session.user?.id !== options.scope.userId ||
          session.user?.restaurantId !== options.scope.restaurantId))
    )
      throw new ApiError(
        409,
        "The active account or branch changed. Review this action in its original branch.",
      );
  };

  const doFetch = async (token: string | null): Promise<Response> => {
    assertScope();
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
          ...(options.sealChallenge
            ? { "X-Seal-Challenge": options.sealChallenge }
            : {}),
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
    assertScope();
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
      errBody,
    );
  }

  assertScope();
  if (res.status === 204) return undefined as T;
  const result = (await res.json()) as T;
  assertScope();
  return result;
}
