/**
 * Studio API client (OD-82)
 * =========================
 * The studio talks to the **Python agent-orchestrator** (services/agent-orchestrator,
 * FastAPI, port 8000) — never to the NestJS gateway (port 4000).
 *
 * Do NOT route these calls through `services/api/client.ts`. That axios client is
 * pointed at the gateway, and the gateway has no studio module (`@Controller("studio"`
 * has zero hits in apps/api-gateway/src), so every studio path 404s there. A bare
 * relative `fetch('/api/v1/studio/…')` shares that fate: `apps/web/vite.config.ts`
 * proxies `/api` → `localhost:4000`, and `vercel.json` rewrites `/api` → the Railway
 * gateway. That routing gap is what took all three studio pages down — the comments
 * in the old call sites claiming "Vite proxy routes /api → FastAPI (port 8000)" were
 * simply wrong.
 *
 * Base URL: `VITE_AGENT_ORCHESTRATOR_URL`, the same var `CommandBar` was given and
 * that `components/scanner/CameraCapture.tsx` and `services/wineDetection.ts` already
 * use. The fallback is the local FastAPI port rather than `''`: CommandBar's `|| ''`
 * fell straight back to the broken relative path, so its "fix" only held when the env
 * var happened to be set — and `VITE_AGENT_ORCHESTRATOR_URL` is not in `env.example`.
 * (CameraCapture's intermediate `|| VITE_API_GATEWAY_URL` step is deliberately not
 * copied — that one points at the 4000 gateway and is the same misdirection again.)
 *
 * Auth: `Authorization: Bearer <accessToken>` from localStorage. The orchestrator's
 * studio routes are gated by `require_studio_role()`
 * (services/agent-orchestrator/services/override_service.py:34) which verifies the JWT
 * and checks `user_roles`. They do **not** accept `X-Admin-Key` — only
 * `/api/v1/onboarding/extract` does (`api/auth.py:46` `require_admin_or_studio`), and
 * it accepts a Bearer token too. So a browser can authenticate to every endpoint this
 * module calls.
 */

/** Orchestrator origin. Empty-string-safe: a trailing slash in the env var is trimmed. */
export const STUDIO_API_BASE: string = (
  (import.meta.env?.VITE_AGENT_ORCHESTRATOR_URL as string | undefined) ||
  'http://localhost:8000'
).replace(/\/+$/, '')

export function studioAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Carries the HTTP status so callers can branch (409 dedup) without re-reading the body. */
export class StudioApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'StudioApiError'
    this.status = status
  }
}

/**
 * FastAPI returns `{detail: string}` for HTTPException and `{detail: [{msg, loc}]}`
 * for request-validation failures. Empty bodies get a status-specific hint instead of
 * a bare number, because "HTTP 404" tells nobody that the call went to the wrong service.
 */
export async function readStudioError(resp: Response): Promise<string> {
  const raw = await resp.text().catch(() => '')
  if (!raw) {
    switch (resp.status) {
      case 401:
        return 'Not signed in, or the session token was rejected by the studio service (401).'
      case 403:
        return 'Your account does not hold the studio role this action requires (403).'
      case 404:
        return `Studio endpoint not found (404) at ${STUDIO_API_BASE} — check VITE_AGENT_ORCHESTRATOR_URL.`
      case 503:
        return 'Studio service unavailable (503). Ensure the agent-orchestrator (FastAPI, port 8000) is running.'
      default:
        return `HTTP ${resp.status}`
    }
  }
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown }
    const detail = parsed.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail
        .map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : String(x)))
        .join('; ')
    }
    if (detail != null && typeof detail === 'object') return JSON.stringify(detail)
    return raw.slice(0, 300)
  } catch {
    return raw.slice(0, 300)
  }
}

/** Human-readable message for anything thrown out of this module (or by fetch itself). */
export function studioErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Raw response against the orchestrator. Use this only when the caller must branch on
 * a specific status (e.g. 409 = already promoted); otherwise use `studioRequest`, which
 * cannot silently succeed on a failure.
 */
export function studioFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...studioAuthHeaders(),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  }
  return fetch(`${STUDIO_API_BASE}${path}`, { ...init, headers })
}

/**
 * Orchestrator call that **throws on any non-2xx**. Every studio handler goes through
 * this so a 404/401/403 can never be reported to the operator as a success — the bug
 * that made `/studio-certify` toast "Contributor revoked" for a revoke that never happened.
 */
export async function studioRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await studioFetch(path, init)
  if (!resp.ok) throw new StudioApiError(await readStudioError(resp), resp.status)
  if (resp.status === 204) return undefined as T
  return (await resp.json().catch(() => ({}))) as T
}

/** POST/PATCH with a JSON body — saves every call site repeating the same three lines. */
export function studioJsonRequest<T = unknown>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return studioRequest<T>(path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}
