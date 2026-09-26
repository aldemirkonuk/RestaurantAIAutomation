/**
 * The one place a refresh token is exchanged for a new session (ADR 0164,
 * item 2/3 of the 2026-09-19 hardening round).
 *
 * Before this module existed there were three independent implementations —
 * `AuthContext.tsx`'s exported `doRefresh` (used by the axios 401 interceptor),
 * `AuthContext.tsx`'s component-level `refreshTokenFn`, and a fourth inline
 * refresh inside `stores/authStore.ts`'s `loadUser` — each with its own
 * mostly-but-not-quite-identical rules for what counts as "sign the person
 * out" versus "keep trying". The `authStore.ts` copy in particular treated
 * ANY error other than a successfully-recovered 401 (a 503, a dropped
 * connection, a rate limit) as "wipe the tokens and redirect to /login",
 * which is exactly the failure `AuthContext.tsx` had already been fixed for
 * (see its `loadUser` comment) — the record in ADR 0164 claimed this was
 * fixed "on both web clients"; it was fixed on one.
 *
 * There is also a second, subtler bug this module fixes: the old `doRefresh`
 * declared a module-level `refreshPromise` and called itself "auto-refresh
 * with deduplication" in a comment, but never actually read or wrote that
 * variable — two callers racing (the axios interceptor and `authStore`'s
 * `loadUser`, say, both hitting a 401 around the same moment) fired two
 * independent `POST /auth/refresh` calls. If the gateway ever rotates the
 * refresh token on use, the loser of that race gets a rejected refresh token
 * and is signed out for no reason a person did. This module makes concurrent
 * callers share one in-flight request.
 */
import axios from "axios";
import {
  goToChooser,
  noteHouseEnded,
  storeSession,
} from "./houseMemory";

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || "http://localhost:4000";

let inFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refresh = localStorage.getItem("refreshToken");
  if (!refresh) return null;

  try {
    const response = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
      refreshToken: refresh,
    });
    const {
      accessToken,
      refreshToken: newRefresh,
      houseAccessEnded,
    } = response.data;
    storeSession(accessToken, newRefresh);
    // The person is no longer a member of the house this session was in (ADR
    // 0164, R5). The new session names no house; they choose, with one
    // sentence saying which house ended. Retrying the request would only be
    // refused again, so it is not retried.
    if (noteHouseEnded(accessToken, houseAccessEnded?.restaurantId)) {
      goToChooser();
      return null;
    }
    return accessToken;
  } catch (err) {
    // Only a refused refresh token ends the session. The gateway answers 503
    // for a read it could not make, and a dropped connection says nothing
    // about who the person is; clearing the tokens for either turned "try
    // again" into "sign in again" (ADR 0164, item 2/3).
    const status = (err as { response?: { status?: number } })?.response
      ?.status;
    if (status === 401) {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("activeRestaurantId");
    }
    return null;
  }
}

/**
 * Exchanges the stored refresh token for a new access token, or `null` when
 * it could not (the refresh token was missing or rejected, the read failed,
 * or the house it named just ended and the caller was sent to the chooser
 * instead). Concurrent callers within the same tab share one network
 * request and one outcome — this is the only correct way to call it, so
 * there is no non-deduplicated escape hatch.
 *
 * Callers that need to tell "this was a genuine sign-out" apart from "the
 * session was kept but this refresh returned no token" (a houseAccessEnded
 * redirect, or a 503) should check `localStorage.getItem("refreshToken")`
 * afterward: this function removes it only on the genuine sign-out path.
 */
export async function doRefresh(): Promise<string | null> {
  if (inFlight) return inFlight;
  inFlight = performRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Test-only: forces the next call to start a fresh request. */
export function __resetInFlightForTests(): void {
  inFlight = null;
}
