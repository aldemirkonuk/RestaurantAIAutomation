import { publicRouteFor } from './seo/routes';

/** The auth store's persist key (`authStore.ts` names its store with this). */
export const AUTH_STORAGE_KEY = 'auth-storage';

/**
 * A refused refresh token ended the session. The one reaction to that, shared
 * by the API client's interceptor and the auth store's boot load, so whichever
 * of the two notices first, the person sees the same thing (ADR 0344).
 *
 * Both tokens and the store's persisted copy of the person go. A public page
 * (`/`, `/story`, `/register`, …) stays where it is for a dead session
 * (founder, 2026-10-29): it reloads, so the app boots with no session and
 * draws the page as it does for a stranger (at `/`, the landing, not the
 * dashboard). Any other page goes to /login.
 *
 * The reload cannot repeat: with no tokens left, the auth store's boot load
 * returns before asking `/auth/me`, and the API client rejects a tokenless 401
 * without refreshing or navigating.
 */
export function leaveDeadSession(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem(AUTH_STORAGE_KEY);
  if (publicRouteFor(window.location.pathname)) {
    window.location.reload();
  } else {
    window.location.href = '/login';
  }
}
