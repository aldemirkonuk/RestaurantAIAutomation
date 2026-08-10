/**
 * Local-only convenience: silently obtains a real logged-in session for
 * DEV_AUTH_BYPASS_EMAIL so manual and automated localhost testing never has
 * to sit at the sign-in screen.
 *
 * A no-op in every other situation:
 *   - Production builds never run this branch — `import.meta.env.DEV` is a
 *     compile-time constant Vite strips out, so this whole check (and the
 *     network call inside it) does not exist in the built bundle.
 *   - Any developer running locally WITHOUT setting VITE_DEV_AUTH_BYPASS_SECRET
 *     gets the real sign-in screen, same as before this file existed.
 *   - Already having a token (a real login, or a previous bypass run) skips
 *     straight through — this never clobbers a session someone is using.
 *
 * The request is to a backend endpoint gated by its own five conditions (see
 * dev-bypass.util.ts) — this file's job is only to know when to ask, not to
 * decide whether the answer should be yes. If the backend says no (bypass
 * disabled, wrong secret, not on localhost), this fails silently into the
 * normal login screen rather than surfacing an error the user did not ask
 * for.
 */
const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

export async function applyDevAuthBypass(): Promise<void> {
  if (!import.meta.env.DEV) return

  const secret = import.meta.env.VITE_DEV_AUTH_BYPASS_SECRET as string | undefined
  if (!secret) return

  if (localStorage.getItem('accessToken')) return

  try {
    const res = await fetch(`${API_URL}/api/v1/auth/dev-bypass-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-Bypass': secret },
      body: '{}',
    })
    if (!res.ok) return
    const data = await res.json()
    if (data.accessToken) localStorage.setItem('accessToken', data.accessToken)
    if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken)
    if (data.accessToken) {
      // eslint-disable-next-line no-console
      console.info('[dev-auth-bypass] Signed in as the configured dev account (localhost only).')
    }
  } catch {
    // Backend unreachable or bypass disabled — fall through to the real
    // login screen exactly as if this file did not run.
  }
}
