/**
 * The session that changed its password keeps going (ADR 0225).
 *
 * A password change signs out every other session of the person, and ends
 * this session's old tokens too: the gateway answers the change with a new
 * pair, minted under the new session version, and only that pair works from
 * then on. This module stores it and tells whoever holds a connection built
 * on the old token (the websocket) to rebuild it.
 *
 * Same tab: a window event. Other tabs of this browser share localStorage, so
 * they already use the new tokens on their next request; their sockets were
 * closed by the gateway too, and learn to reconnect from the `storage` event
 * on RENEWED_KEY.
 */

export const SESSION_RENEWED_EVENT = 'mudavym:session-renewed'
export const RENEWED_KEY = 'mudavym.sessionRenewedAt'

export interface RenewedPair {
  accessToken?: unknown
  refreshToken?: unknown
}

/**
 * Store the pair a password change answered with and announce it. Returns
 * false (and stores nothing) when the answer carries no usable pair: an
 * older gateway that does not send one, in which case this session's tokens
 * are still the valid ones.
 */
export function storeRenewedSession(pair: RenewedPair | null | undefined): boolean {
  const access = pair?.accessToken
  const refresh = pair?.refreshToken
  if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh) {
    return false
  }
  try {
    localStorage.setItem('accessToken', access)
    localStorage.setItem('refreshToken', refresh)
    localStorage.setItem(RENEWED_KEY, String(Date.now()))
  } catch {
    return false
  }
  try {
    window.dispatchEvent(new Event(SESSION_RENEWED_EVENT))
  } catch {
    /* no window */
  }
  return true
}

/** Call `listener` whenever this session's tokens were renewed. Returns the unsubscribe. */
export function onSessionRenewed(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === RENEWED_KEY) listener()
  }
  window.addEventListener(SESSION_RENEWED_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(SESSION_RENEWED_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}
