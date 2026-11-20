/**
 * A request that never got an answer, said in words.
 *
 * axios names a dropped connection "Network Error" and nothing else: no status,
 * no body. That is the transport's word, not a sentence a person can act on, so
 * every place that puts a failed call's reason on screen says this instead
 * (r81 walk, /menu with the gateway aborted; /dishes #1907 and the till recipe
 * #1932 already did).
 *
 * Only a failure with NO response counts. A 5xx that axios also words as
 * "Network Error" (a proxy cutting the body) still arrived, so it keeps the
 * caller's own handling of an answered call.
 */
export const UNREACHABLE_WORDS = 'Mudavym could not be reached just now.';

export function isUnreachable(e: unknown): boolean {
  const sent = e as { code?: unknown; response?: unknown } | null | undefined;
  return sent?.code === 'ERR_NETWORK' && !sent.response;
}

/**
 * The reason to put inside a sentence for a failed call: the unreachable words,
 * else the error's own message, else `none`. Callers that prefer the gateway's
 * own sentence read `response.data.message` first and fall back to this.
 */
export function failureWords(e: unknown, none: string): string {
  if (isUnreachable(e)) return UNREACHABLE_WORDS;
  return e instanceof Error ? e.message : none;
}
