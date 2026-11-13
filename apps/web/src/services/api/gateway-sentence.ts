/**
 * What a failed request should say to the person who made it.
 *
 * Axios puts "Request failed with status code 400" on `error.message` for
 * every non-2xx answer. The gateway's own sentence ("An entry cannot end
 * before the day it starts.") is in `response.data.message`, and it is the
 * only text that says what to change. Sheets and forms across the app print
 * `error.message`, so they printed the transport's words (QUEUE r22 calendar,
 * team #817 follow-up).
 *
 * The order, first match wins:
 *  1. the gateway's own words: `message` (a string, or Nest's list of field
 *     messages), else `error`, unless it is only Nest's stock name for the
 *     status ("Bad Request", "Forbidden resource", "Internal server error");
 *  2. a plain sentence for the status;
 *  3. a plain sentence for "no answer came back".
 *
 * A 5xx keeps the gateway's sentence too: several routes fail closed with a
 * worded 500 on purpose. It never prints a status code or the word "axios".
 *
 * A 5xx, a timeout or a lost connection may come after a write landed, so
 * their plain sentences never say "nothing was saved" or "try again"; a caller
 * that knows it was a write adds that (see `isUnconfirmedWrite`).
 */

/** Nest's default texts: a status's name, not a reason. */
const STOCK = new Set(
  [
    "bad request",
    "unauthorized",
    "forbidden",
    "forbidden resource",
    "not found",
    "method not allowed",
    "not acceptable",
    "request timeout",
    "conflict",
    "gone",
    "payload too large",
    "unsupported media type",
    "unprocessable entity",
    "too many requests",
    "throttlerexception: too many requests",
    "internal server error",
    "not implemented",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "http exception",
    "error",
  ].map((s) => s.toLowerCase()),
);

/** "Cannot POST /api/v1/x" is Express's 404 for a route that does not exist. */
const NO_ROUTE = /^cannot (get|post|put|patch|delete|head|options) \//i;

function asSentence(raw: unknown): string | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text || STOCK.has(text.toLowerCase()) || NO_ROUTE.test(text))
      return null;
    // An HTML error page from a proxy is not a sentence.
    if (text.startsWith("<")) return null;
    return text;
  }
  if (Array.isArray(raw)) {
    const parts = raw.map(asSentence).filter((s): s is string => !!s);
    if (!parts.length) return null;
    return parts.map((p) => p.replace(/[.;]\s*$/, "")).join("; ") + ".";
  }
  if (raw && typeof raw === "object") {
    return asSentence((raw as { message?: unknown }).message);
  }
  return null;
}

/** The gateway's own sentence for this failure, or null when it gave none. */
export function gatewaySentence(error: unknown): string | null {
  const response = (error as { response?: { data?: unknown } } | null)
    ?.response;
  if (!response) return null;
  const body = response.data;
  if (typeof body === "string")
    return body.length <= 300 ? asSentence(body) : null;
  if (!body || typeof body !== "object") return null;
  const b = body as { message?: unknown; error?: unknown };
  return asSentence(b.message) ?? asSentence(b.error);
}

function statusSentence(status: number): string {
  if (status === 400 || status === 422)
    return "That was not accepted as written. Check the fields and try again.";
  if (status === 401)
    return "Your session has ended. Sign in again to continue.";
  if (status === 403) return "You do not have access to that.";
  if (status === 404)
    return "That could not be found. It may have been removed.";
  if (status === 409)
    return "That changed since this page read it. Reload, then try again.";
  if (status === 413) return "That is too large to send.";
  if (status === 429)
    return "Too many tries just now. Wait a moment, then try again.";
  if (status >= 500)
    return "The server ran into a problem before it could confirm that.";
  return "That was not accepted.";
}

/**
 * The sentence to show for a failed request: the gateway's own, else a plain
 * one. Null when `error` is not a request failure (no status and no request
 * went out), so the caller keeps its own text.
 */
export function requestFailureSentence(error: unknown): string | null {
  const said = gatewaySentence(error);
  if (said) return said;
  const e = error as {
    response?: { status?: unknown };
    request?: unknown;
    code?: unknown;
  } | null;
  const status = e?.response?.status;
  if (typeof status === "number") return statusSentence(status);
  if (e?.code === "ERR_CANCELED") return null;
  if (e?.code === "ECONNABORTED" || e?.code === "ETIMEDOUT") {
    return "The server took too long to answer.";
  }
  if (e?.request != null || e?.code === "ERR_NETWORK") {
    return "The server did not answer. Check the connection.";
  }
  return null;
}
