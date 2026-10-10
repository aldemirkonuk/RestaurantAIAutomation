import { useCallback, useRef } from 'react';
import axios from 'axios';

/**
 * A create whose answer never came back (F-1083, rehit of F-338).
 *
 * A timeout or a 5xx can land after the row was written, so "nothing was
 * saved" is a promise the sheet cannot back. A 409 with reason
 * `still_running` is the same case seen from the other side: the gateway is
 * still saving this key from the last try (lib/queue-owner.ts `statusOf`).
 */
export function writeOutcomeUnknown(err: unknown): boolean {
  const response = (err as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  const status = response?.status;
  if (typeof status === 'number') {
    return (
      status >= 500 ||
      (status === 409 &&
        (response?.data as { reason?: unknown } | null | undefined)?.reason === 'still_running')
    );
  }
  // The same reading as `isUnconfirmedWrite` (services/api/client.ts), kept
  // here rather than imported: a page test that mocks the client module would
  // otherwise lose this check with it. A request that went out and got nothing
  // back is a timeout or a dropped connection.
  return Boolean(axios.isAxiosError(err) && err.request && !err.response);
}

function newNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** FNV-1a over the body's JSON: the same words give the same key. */
function bodyHash(body: unknown): string {
  const text = JSON.stringify(body) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * One Idempotency-Key per draft (F-1083), for a create the gateway has no
 * other guard against doubling. The gateway's IdempotencyInterceptor answers a
 * repeated key with the row it already wrote, so "Try again" after a lost
 * answer cannot write the same thing twice.
 *
 * The key carries a hash of the body: a draft edited after the lost answer is
 * a different write, and must not be answered with the old row. `renew()`
 * after a confirmed save, so a sheet that stays mounted can add the same
 * words again on purpose.
 */
export function useDraftWriteKey(scope: string) {
  const nonce = useRef<string | null>(null);
  if (nonce.current === null) nonce.current = newNonce();
  const keyFor = useCallback(
    (body: unknown) => `${scope}:${nonce.current}:${bodyHash(body)}`,
    [scope],
  );
  const renew = useCallback(() => {
    nonce.current = newNonce();
  }, []);
  return { keyFor, renew };
}
