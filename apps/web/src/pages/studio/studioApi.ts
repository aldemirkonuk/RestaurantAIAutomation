/**
 * Studio API client (OD-82, then ADR 0021)
 * ========================================
 * The studio talks to the orchestrator **through the NestJS gateway**, on relative paths.
 *
 * This module originally pointed straight at the orchestrator on
 * `VITE_AGENT_ORCHESTRATOR_URL`, because at the time the gateway genuinely had no studio
 * module and every relative `/api/v1/studio/…` 404'd there. That diagnosis was right and
 * the direct base URL fixed it. In parallel, a second pass closed the same gap the other
 * way — by giving the gateway a studio proxy — and the founder chose the gateway
 * (ADR 0021). Reasons, briefly: it is what ADR 0012 already decided for this codebase; it
 * keeps one origin and one auth boundary, so no CORS and no orchestrator URL shipped into
 * the browser bundle; and the invite send has to be gateway-side regardless, because that
 * is where the mail credentials live — so the gateway was in this path either way.
 *
 * What did NOT change, and is the valuable part of the original fix: every call still goes
 * through `studioRequest`, which throws on any non-2xx. That is what stopped a 404 being
 * reported to the operator as a successful revoke.
 *
 * Routing: `apps/web/vite.config.ts` proxies `/api` → gateway :4000 in dev, and
 * `vercel.json` rewrites `/api` → the Railway gateway in prod. The gateway forwards
 * `/api/v1/studio/*` (`common/orchestrator/studio-proxy.controller.ts`) and
 * `/api/v1/onboarding/extract` (`onboarding-proxy.controller.ts`) to the orchestrator,
 * passing the caller's own bearer token through.
 *
 * Auth: `Authorization: Bearer <accessToken>` from localStorage. The gateway's
 * JwtAuthGuard validates it, then the orchestrator re-verifies the same token and does the
 * per-endpoint role check (`services/override_service.py:34`). This requires the gateway's
 * `JWT_SECRET` and the orchestrator's `SUPABASE_JWT_SECRET` to hold the same value —
 * verified equal in production (both hash to `641ddc1b5254`).
 */

/**
 * Empty: studio calls are relative, so they follow the same `/api` proxy/rewrite as the
 * rest of the app and land on the gateway. Deliberately not an env var — a configurable
 * origin here is what allowed the browser to be pointed at the wrong service.
 */
export const STUDIO_API_BASE: string = ''

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
        return 'Studio endpoint not found (404) — the gateway is not forwarding this studio path to the orchestrator.'
      case 503:
        return 'Studio service unavailable (503). Check that the orchestrator is up and AGENT_ORCHESTRATOR_URL is set on the gateway.'
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

/**
 * What the orchestrator reports happened to the WINE after an override was applied
 * (`library` on POST /overrides and PATCH /queue/{id}). The override's own status
 * ("auto_promoted") never says this: until 2026-11-07 the library insert failed on
 * every promotion while the contributor read "Override saved" (QA round 5, B-1).
 */
export interface LibraryReport {
  library?: string
  library_detail?: string
}

export interface StudioNotice {
  tone: 'success' | 'info' | 'error'
  title: string
  description?: string
}

/**
 * The toast for a library outcome, or null when there is nothing to say (the wine
 * still has fields waiting for review). An outcome this code does not know is not
 * read as success (ADR 0020): it says it could not tell.
 */
export function libraryNotice(report: LibraryReport | null | undefined): StudioNotice | null {
  const outcome = report?.library
  if (!outcome || outcome === 'not_ready') return null
  const description = report?.library_detail
  if (outcome === 'promoted') return { tone: 'success', title: 'Added to the wine library', description }
  if (outcome === 'already_in_library') {
    return { tone: 'info', title: 'Already in the wine library', description }
  }
  if (outcome === 'failed') {
    return {
      tone: 'error',
      title: 'The wine did not reach the library',
      description: description ?? 'Nothing was added. Try again, or tell a reviewer.',
    }
  }
  return {
    tone: 'error',
    title: 'Could not tell whether the wine reached the library',
    description: 'Check the wine library before promoting it again.',
  }
}
