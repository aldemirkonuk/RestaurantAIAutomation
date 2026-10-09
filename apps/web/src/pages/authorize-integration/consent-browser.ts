/** A proof belongs to the initiating tab, not a shareable provider URL. */
const PREFIX = 'mudavym.oauth.'
const TTL = 10 * 60 * 1000

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export async function prepareConsentBrowser() {
  const proof = hex(crypto.getRandomValues(new Uint8Array(32)))
  const browserRequestId = crypto.randomUUID()
  const browserProofHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof))))
  // A failed storage write stops the ceremony before its challenge is minted.
  sessionStorage.setItem(PREFIX + browserRequestId, JSON.stringify({ proof, expiresAt: Date.now() + TTL }))
  for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
    const key = sessionStorage.key(i)
    if (!key?.startsWith(PREFIX) || key === PREFIX + browserRequestId) continue
    try {
      if (JSON.parse(sessionStorage.getItem(key) ?? '{}').expiresAt <= Date.now()) sessionStorage.removeItem(key)
    } catch { sessionStorage.removeItem(key) }
  }
  return { browserRequestId, browserProofHash }
}

export function readConsentBrowser(requestId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) return null
  try {
    const value = JSON.parse(sessionStorage.getItem(PREFIX + requestId) ?? 'null')
    return value && value.expiresAt > Date.now() && /^[a-f0-9]{64}$/.test(value.proof) ? String(value.proof) : null
  } catch { return null }
}

export function forgetConsentBrowser(requestId: string) {
  try { sessionStorage.removeItem(PREFIX + requestId) } catch { /* Navigation need not depend on cleanup. */ }
}

/**
 * The pages a consent flow may start from, and so the only pages it may return
 * to (F-279). Each one shows the outcome line (IntegrationReturnNotice), so a
 * person lands where they pressed Connect and reads what happened there.
 * Exact paths, not prefixes: a new start page is added here on purpose.
 */
export const RETURN_PAGES: readonly string[] = ['/communications', '/connections', '/profile', '/settings']
const OUTCOME_KEYS = ['integration_status', 'integration', 'integration_reason']

export function sameSiteReturnPath(value: string | null) {
  // Control characters are the point of the check: a path carrying one is refused.
  // eslint-disable-next-line no-control-regex
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20\x7f]/.test(value)) return '/settings'
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin && RETURN_PAGES.includes(url.pathname)
      ? `${url.pathname}${url.search}${url.hash}`
      : '/settings'
  } catch { return '/settings' }
}

/**
 * Where a finished consent flow lands, as a same-origin path. A page on the
 * list keeps its own query (the letter panel's place, the settings tab); any
 * other path is never followed — the person lands on /profile, where their own
 * grants live, carrying only the outcome so the line still shows.
 */
export function returnLanding(url: URL): string {
  if (RETURN_PAGES.includes(url.pathname)) return `${url.pathname}${url.search}${url.hash}`
  const outcome = new URLSearchParams()
  for (const key of OUTCOME_KEYS) {
    const value = url.searchParams.get(key)
    if (value !== null) outcome.set(key, value)
  }
  const query = outcome.toString()
  return query ? `/profile?${query}` : '/profile'
}
