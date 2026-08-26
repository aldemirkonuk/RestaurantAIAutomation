/**
 * Guard: nothing in the web app may talk to the API gateway with a raw `fetch`.
 *
 * On 2026-08-24 `analytics.controller.ts` gained a class-level
 * `@UseGuards(JwtAuthGuard)` to close an unauthenticated paid-LLM surface.
 * Three web surfaces (Recommendations, InsightCatalog, the ContextualInsights
 * rails) called it with `fetch` and no `Authorization` header, so they returned
 * 401 to real users until this was fixed. `jwt.strategy.ts` is header-only —
 * no cookie and no dev bypass rescues a call that omits the header.
 *
 * The shared axios client (`src/services/api/client.ts`) attaches the bearer
 * token, the `X-Restaurant-Id` header and the base URL, and retries once on a
 * 401 after refreshing. A raw `fetch` gets none of that, which means the next
 * controller that gets a guard silently breaks its callers again.
 *
 * The rule is deliberately coarse: a file may not contain BOTH a bare `fetch(`
 * and a gateway reference (`VITE_API_GATEWAY_URL` or a `/api/v1` path). The
 * allowlist below carries the exceptions, each with the reason it is one.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

/**
 * Every entry here is a call that is NOT the NestJS gateway, or cannot use
 * axios. Adding to this list requires a reason that survives review.
 */
const ALLOWLIST: Array<{ path: string; why: string }> = [
  {
    path: 'lib/uxSignals.ts',
    why: 'needs fetch({keepalive}) to survive page unload; axios cannot set it. Already sends the bearer.',
  },
  {
    path: 'lib/devAuthBypass.ts',
    why: 'dev-only pre-auth bootstrap with an X-Dev-Bypass header; must not go through the 401 refresh-and-redirect interceptor.',
  },
  {
    path: 'services/wineDetection.ts',
    why: '/api/v1/scan/* is the Python agent-orchestrator, not the gateway.',
  },
  {
    path: 'contexts/OnboardingContext.tsx',
    why: '/api/v1/onboarding/* is the Python agent-orchestrator, not the gateway.',
  },
]

/** `/api/v1/studio/*` is served by the orchestrator — apps/api-gateway has no studio module. */
const ALLOWED_DIRS = ['pages/studio']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Bare `fetch(` — not `refetch(`, `prefetch(`, `this.fetch(`. */
const BARE_FETCH = /(?<![\w.])fetch\s*\(/
const GATEWAY_REF = /VITE_API_GATEWAY_URL|\/api\/v1\//

describe('no raw fetch against the API gateway', () => {
  const allowed = new Set(ALLOWLIST.map((a) => a.path))

  it('every gateway call goes through services/api/client.ts', () => {
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/')
      if (allowed.has(rel)) continue
      if (ALLOWED_DIRS.some((d) => rel.startsWith(`${d}/`))) continue

      const source = readFileSync(file, 'utf8')
      if (BARE_FETCH.test(source) && GATEWAY_REF.test(source)) {
        offenders.push(rel)
      }
    }

    expect(
      offenders,
      `These files call the gateway with a raw fetch, so they send no ` +
        `Authorization header and will 401 the moment their controller is ` +
        `guarded. Use apiClient from services/api/client.ts, or add an ` +
        `allowlist entry with a reason.`,
    ).toEqual([])
  })

  it('keeps a reason attached to every allowlisted exception', () => {
    for (const entry of ALLOWLIST) {
      expect(entry.why.length).toBeGreaterThan(20)
    }
  })
})
