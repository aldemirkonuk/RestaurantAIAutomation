/**
 * Nightly production E2E — shared library (ADR 0135).
 *
 * Everything here exists so that the spec can say, for every page and every
 * precondition, ONE of four things and nothing else:
 *
 *   pass          the assertion held
 *   fail          the assertion ran and did not hold — a production signal
 *   absent        the surface is not on the build under test (a route not
 *                 gated, a flag no code reads) — an absence, never a pass
 *   cannot_check  a precondition is missing (secret, account, house, id) —
 *                 the check did not run, and must not read as a pass
 *
 * A page that renders its own "could not be read" sentence is recorded as
 * `failed_read`: the PAGE is honest (pass) and the READ failed (fail). Both
 * are written down. Nothing here ever asserts on a figure.
 *
 * Pacing: every route under /api/v1/auth/ is rate-limited to 10 requests per
 * 60 s per (IP, route) by apps/api-gateway/src/common/rate-limit/rate-limit.guard.ts
 * (DEFAULT_RATE_LIMITS.auth; generateKey appends the route). A fresh SPA boot
 * costs one GET /auth/me and one GET /auth/me/role, so the suite boots the app
 * ONCE per pass, navigates with pushState (no reload), and `AuthBudget` waits
 * whenever eight auth calls have fired inside any rolling minute.
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface PageNeeds {
  param: string
  list: string
  items_key: string
  id_key: string
}

export interface PageEntry {
  slug: string
  flag: string
  route: string
  /** "page" = a legacy page renders; "same" = no page swap; "redirect:/x" = legacy redirects. */
  legacy: string
  aliases?: { route: string; legacy: string }[]
  needs?: PageNeeds
  empty?: string[]
  failed_read?: string[]
  failed_read_testids?: string[]
  present_testids?: string[]
  provenance?: string[]
  provenance_testids?: string[]
  provenance_required?: boolean
  /** Sentences the page ALWAYS renders that contain a shared phrase; removed before matching. */
  static_text?: string[]
}

/** A signed-out door behind ADR 0133's one switch (VITE_MUDAVYM_PUBLIC). */
export interface PublicEntry {
  slug: string
  route: string
  file: string
  /** "public" = the page's own file reads the switch on the manifest's tree; "none" = it does not yet. */
  switch: 'public' | 'none'
  /** Sentences the route must render when opened with a harmless invalid param. */
  honest?: string[]
}

/** A signed-in route the new-pages list names that is not yet enrolled in MUDAVYM_PAGES. */
export interface PendingEntry {
  slug: string
  route: string
  file: string | null
  held_by: string
}

export interface Manifest {
  manifest_version: string
  flag_prefix: string
  override_prefix: string
  next_root_selector: string
  shared_phrases: {
    failed_read: string[]
    denied: string[]
    walls: Record<string, string>
  }
  pages: PageEntry[]
  public_override_key: string
  public_pages: PublicEntry[]
  signed_out_redirects: { route: string; to: string }[]
  pending_pages: PendingEntry[]
}

// apps/web is an ES module package, so there is no __dirname here.
export const MANIFEST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'manifest.json')

export function loadManifest(): Manifest {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8')
  const m = JSON.parse(raw) as Manifest
  // The empty-corpus guard: a manifest with no pages would make every walk
  // pass by walking nothing (absence-reported-as-health, instance 2).
  if (!Array.isArray(m.pages) || m.pages.length < 10) {
    throw new Error(`CANNOT CHECK — manifest at ${MANIFEST_PATH} lists ${m.pages?.length ?? 0} pages; expected the Mudavym set (20 on 2026-09-16; scripts/check_nightly_manifest.py holds it equal to MUDAVYM_PAGES).`)
  }
  if (!Array.isArray(m.public_pages) || !Array.isArray(m.pending_pages) || !Array.isArray(m.signed_out_redirects)) {
    throw new Error(`CANNOT CHECK — manifest at ${MANIFEST_PATH} lacks public_pages / pending_pages / signed_out_redirects (manifest_version ${m.manifest_version}).`)
  }
  return m
}

// ---------------------------------------------------------------------------
// The houses the walk may open (audit of PR #349, finding 1.3)
// ---------------------------------------------------------------------------

export interface SimHouses {
  measured: string
  name_prefix: string
  houses: { id: string; slug: string; name: string }[]
}

export function loadSimHouses(): SimHouses {
  const file = path.join(path.dirname(MANIFEST_PATH), 'sim-houses.json')
  const h = JSON.parse(fs.readFileSync(file, 'utf8')) as SimHouses
  if (!Array.isArray(h.houses) || h.houses.length === 0 || !h.name_prefix) {
    throw new Error(`CANNOT CHECK — ${file} lists no simulator house; the walk refuses to open any house without the list.`)
  }
  return h
}

/**
 * A house may be walked only when its id is on the committed simulator list AND
 * the gateway's own branch list names it with the simulator prefix. The walk
 * screenshots every page into a public artifact, so any other answer — an id
 * off the list, a renamed house, a branch read that failed — refuses the walk
 * as cannot_check. The gateway returns no slug (organizations.service.ts
 * getBranchesForUser), which is why the id list is committed.
 */
export async function checkSimHouse(
  request: APIRequestContext,
  env: NightlyEnv,
  session: Session,
  restaurantId: string | null,
): Promise<{ ok: boolean; reason: string }> {
  if (!restaurantId) return { ok: false, reason: 'no house id to check' }
  const sims = loadSimHouses()
  const listed = sims.houses.find((h) => h.id === restaurantId)
  if (!listed) {
    return { ok: false, reason: `house ${restaurantId} is not on apps/web/e2e/nightly/sim-houses.json (measured ${sims.measured}); the walk opens simulator houses only` }
  }
  const res = await request.get(`${env.apiUrl}/api/v1/organizations/branches`, { headers: authHeaders(session, restaurantId) })
  if (!res.ok()) {
    return { ok: false, reason: `/organizations/branches answered ${res.status()}, so the house's name cannot be confirmed` }
  }
  const branches = (await res.json()) as { id: string; name: string }[]
  const branch = Array.isArray(branches) ? branches.find((b) => b.id === restaurantId) : undefined
  if (!branch) {
    return { ok: false, reason: `the account's branch list does not include ${listed.slug} (${restaurantId})` }
  }
  if (!branch.name.startsWith(sims.name_prefix)) {
    return { ok: false, reason: `house ${restaurantId} is listed as ${listed.slug} but the gateway names it "${branch.name}", not "${sims.name_prefix}…" — refused until someone re-measures the list` }
  }
  return { ok: true, reason: `${listed.slug} ("${branch.name}") is a simulator house on the committed list` }
}

// ---------------------------------------------------------------------------
// Founder's recorded design calls — reported beside pages, never gating
// ---------------------------------------------------------------------------

export interface DesignCall {
  source: string
  kind: 'verdict' | 'board'
  call?: string
  at?: string
  label?: string
  state?: string
  as_of?: string | null
}

export function loadDesignCalls(): Record<string, DesignCall[]> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(path.dirname(MANIFEST_PATH), 'design-verdicts.json'), 'utf8')) as { pages?: Record<string, DesignCall[]> }
    return raw.pages ?? {}
  } catch {
    return {}
  }
}

export function describeCall(c: DesignCall): string {
  return c.kind === 'verdict' ? `${c.call} (${c.source}, ${(c.at ?? '').slice(0, 10)})` : `${c.label} · ${c.state} (${c.source}, ${c.as_of ?? 'undated'})`
}

// ---------------------------------------------------------------------------
// Read-only, enforced rather than promised (audit of PR #349, fix-list item 5)
// ---------------------------------------------------------------------------

/**
 * Every request the page makes is routed through here. A GET, HEAD or OPTIONS
 * passes. Any other method is ABORTED unless its path is one of the two
 * read-shaped POSTs the app makes to render at all: the token refresh and the
 * per-house flag read (useMudavymDesign.ts fetchFlag). Everything aborted is
 * listed — the app's own view telemetry (/ux/signals, /events) is a write to
 * production, and a page whose function needed a write shows up here by name.
 */
export const READ_SHAPED_POSTS = ['/api/v1/auth/refresh', '/api/v1/settings/feature-flags/check']

export class ReadOnlyGuard {
  public blocked: string[] = []

  async attach(page: Page): Promise<void> {
    await page.route('**/*', async (route) => {
      const req = route.request()
      const method = req.method()
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue()
      const p = pathOf(req.url())
      if (READ_SHAPED_POSTS.includes(p)) return route.continue()
      this.blocked.push(`${method} ${new URL(req.url()).host}${p}`)
      return route.abort('blockedbyclient')
    })
  }

  summary(): { blocked: number; distinct: string[] } {
    return { blocked: this.blocked.length, distinct: [...new Set(this.blocked)].sort() }
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface NightlyEnv {
  baseUrl: string
  apiUrl: string
  email: string
  password: string
  /** report | on | off — what the run expects the house's flags to be. */
  expectFlags: 'report' | 'on' | 'off'
  /** Optional second house whose flags are OFF, for the legacy pass. */
  legacyRestaurantId: string | null
  target: 'production' | 'local'
}

export function readEnv(): NightlyEnv {
  const baseUrl = (process.env.E2E_BASE_URL ?? '').replace(/\/$/, '')
  const apiUrl = (process.env.E2E_API_URL ?? process.env.API_GATEWAY_URL ?? '').replace(/\/$/, '')
  const email = process.env.E2E_TEST_EMAIL ?? ''
  const password = process.env.E2E_TEST_PASSWORD ?? ''
  const missing = [
    ['E2E_BASE_URL', baseUrl],
    ['E2E_API_URL (or API_GATEWAY_URL)', apiUrl],
    ['E2E_TEST_EMAIL', email],
    ['E2E_TEST_PASSWORD', password],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) {
    throw new Error(`CANNOT CHECK — missing: ${missing.join(', ')}. This run asserts nothing about production.`)
  }
  const expectFlagsRaw = (process.env.E2E_EXPECT_FLAGS ?? 'report').toLowerCase()
  const expectFlags = expectFlagsRaw === 'on' || expectFlagsRaw === 'off' ? expectFlagsRaw : 'report'
  const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl)
  return {
    baseUrl,
    apiUrl,
    email,
    password,
    expectFlags,
    legacyRestaurantId: process.env.E2E_LEGACY_RESTAURANT_ID || null,
    target: isLocal ? 'local' : 'production',
  }
}

// ---------------------------------------------------------------------------
// Four-state recording — the spec's only channel to the summary
// ---------------------------------------------------------------------------

export type CheckState = 'pass' | 'fail' | 'absent' | 'cannot_check'

export interface CheckRecord {
  /** Stable id, e.g. "page.dashboard.next" or "precondition.account". */
  id: string
  state: CheckState
  /** One sentence a reader can act on. Never a secret value. */
  reason: string
  /** Free-form evidence: URL landed on, phrases matched, counts. */
  evidence?: Record<string, unknown>
}

/** Attach one record to the running test; the honest reporter collects them. */
export function record(rec: CheckRecord): void {
  test.info().annotations.push({ type: 'nightly-check', description: JSON.stringify(rec) })
}

/** Record AND fail the test when a check fails or cannot run. */
export function recordAndAssert(rec: CheckRecord): void {
  record(rec)
  if (rec.state === 'fail' || rec.state === 'cannot_check') {
    expect.soft(rec.state, `${rec.id}: ${rec.reason}`).toBe('pass')
  }
}

// ---------------------------------------------------------------------------
// Session — minted through the product's own login door
// ---------------------------------------------------------------------------

export interface Session {
  accessToken: string
  refreshToken: string
  user: {
    userId: string
    email: string
    role: string
    restaurantId: string | null
    emailVerified: boolean | null
  }
}

/**
 * POST /auth/login then GET /auth/me. Two auth-bucket requests, once per run.
 * The token is held in memory only — never written to disk, XML or logs.
 */
export async function mintSession(request: APIRequestContext, env: NightlyEnv): Promise<Session> {
  const login = await request.post(`${env.apiUrl}/api/v1/auth/login`, {
    data: { email: env.email, password: env.password },
  })
  if (login.status() === 429) {
    throw new Error('CANNOT CHECK — /auth/login answered 429: the auth rate limit (10/60 s per IP+route) is already spent. Do not retry inside the minute.')
  }
  if (!login.ok()) {
    throw new Error(`CANNOT CHECK — /auth/login answered ${login.status()} for E2E_TEST_EMAIL; the account or its password is not what the secrets say.`)
  }
  const body = (await login.json()) as { accessToken?: string; refreshToken?: string }
  if (!body.accessToken || !body.refreshToken) {
    throw new Error('CANNOT CHECK — /auth/login returned no token pair; the response shape changed.')
  }
  const me = await request.get(`${env.apiUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${body.accessToken}` },
  })
  if (!me.ok()) {
    throw new Error(`CANNOT CHECK — /auth/me answered ${me.status()} with a token /auth/login just issued.`)
  }
  const meBody = (await me.json()) as { user?: Session['user'] }
  if (!meBody.user) {
    throw new Error('CANNOT CHECK — /auth/me returned no user; the response shape changed.')
  }
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, user: meBody.user }
}

export function authHeaders(session: Session, restaurantId: string | null): Record<string, string> {
  const h: Record<string, string> = { authorization: `Bearer ${session.accessToken}` }
  if (restaurantId) h['X-Restaurant-Id'] = restaurantId
  return h
}

/**
 * Put the session and the per-page overrides into localStorage BEFORE the SPA
 * boots. `overrides` maps page slug -> '1' | '0' (see useMudavymDesign.ts:
 * "1"/"on" forces the redesign, "0"/"off" forces legacy, absence falls through
 * to the house's real flag).
 */
export async function injectSession(
  page: Page,
  session: Session,
  restaurantId: string | null,
  overrides: Record<string, '1' | '0'>,
  overridePrefix: string,
): Promise<void> {
  await page.addInitScript(
    (args: { access: string; refresh: string; rid: string | null; ov: Record<string, string>; prefix: string }) => {
      try {
        window.localStorage.setItem('accessToken', args.access)
        window.localStorage.setItem('refreshToken', args.refresh)
        if (args.rid) window.localStorage.setItem('activeRestaurantId', args.rid)
        for (const [slug, v] of Object.entries(args.ov)) {
          window.localStorage.setItem(`${args.prefix}${slug}`, v)
        }
      } catch {
        /* storage blocked — the page will land on /login and the walk records it */
      }
    },
    {
      access: session.accessToken,
      refresh: session.refreshToken,
      rid: restaurantId,
      ov: overrides,
      prefix: overridePrefix,
    },
  )
}

// ---------------------------------------------------------------------------
// Auth-bucket budget
// ---------------------------------------------------------------------------

export class AuthBudget {
  /** Timestamps per auth route — the guard keys its bucket on (IP, route). */
  private stamps = new Map<string, number[]>()
  public total = 0
  public maxInAnyMinute = 0
  public waits = 0

  constructor(
    private readonly limitPerRoutePerMinute = 8,
    private readonly windowMs = 60_000,
  ) {}

  attach(page: Page): void {
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('/api/v1/auth/')) this.note(pathOf(url))
    })
  }

  note(route: string): void {
    const now = Date.now()
    this.total += 1
    const list = this.stamps.get(route) ?? []
    list.push(now)
    this.stamps.set(route, list)
    this.prune(now)
    this.maxInAnyMinute = Math.max(this.maxInAnyMinute, ...[...this.stamps.values()].map((l) => l.length))
  }

  private prune(now: number): void {
    for (const [route, list] of this.stamps) this.stamps.set(route, list.filter((t) => now - t < this.windowMs))
  }

  /** Await until every auth route has fewer than the per-route limit in the trailing window. */
  async beforeBoot(page: Page): Promise<void> {
    for (;;) {
      this.prune(Date.now())
      const hot = [...this.stamps.entries()].filter(([, l]) => l.length >= this.limitPerRoutePerMinute)
      if (!hot.length) return
      const oldest = Math.min(...hot.map(([, l]) => l[0]))
      this.waits += 1
      await page.waitForTimeout(Math.max(500, this.windowMs - (Date.now() - oldest) + 250))
    }
  }

  summary(): Record<string, unknown> {
    const perRoute: Record<string, number> = {}
    for (const [route, list] of this.stamps) perRoute[route] = list.length
    return { auth_requests_total: this.total, auth_requests_max_per_route_in_any_60s: this.maxInAnyMinute, per_route_limit: 10, budget_waits: this.waits, per_route_last_60s: perRoute }
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Wait until the rendered text stops changing (two samples 700 ms apart agree
 * and the body holds something). `networkidle` is the wrong tool here: legacy
 * pages poll, so idle never arrives, and a page can be text-stable long before
 * its last request settles.
 */
export async function settleDom(page: Page, maxPolls = 14, everyMs = 700): Promise<void> {
  let last = ''
  for (let i = 0; i < maxPolls; i++) {
    await page.waitForTimeout(everyMs)
    const now = (await page.locator('body').innerText().catch(() => '')) ?? ''
    if (now.length >= 40 && now === last) return
    last = now
  }
}

/** Client-side navigation: no reload, so no fresh /auth/me. BrowserRouter listens to popstate. */
export async function spaNavigate(page: Page, route: string): Promise<void> {
  await page.evaluate((r) => {
    window.history.pushState({}, '', r)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, route)
  await settleDom(page)
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/**
 * After a boot the SPA flashes /login for a moment while it reads the token
 * back out of localStorage (visual-sweep memory: poll ~6×3 s before calling a
 * wall real). Returns the wall name if the URL settled on one.
 */
export async function settleWalls(page: Page, walls: Record<string, string>, polls = 6, everyMs = 3_000): Promise<string | null> {
  let hit: string | null = null
  for (let i = 0; i < polls; i++) {
    const p = pathOf(page.url())
    hit = Object.keys(walls).find((w) => p.startsWith(w)) ?? null
    if (!hit) return null
    await page.waitForTimeout(everyMs)
  }
  return hit
}

// ---------------------------------------------------------------------------
// Classification — what did the page honestly say?
// ---------------------------------------------------------------------------

export type RenderClass = 'data' | 'empty' | 'failed_read' | 'denied'

export interface Reading {
  nextRoots: number
  pathname: string
  bodyChars: number
  matched: { failed_read: string[]; empty: string[]; denied: string[]; provenance: string[] }
  matchedTestIds: { failed_read: string[]; present: string[]; provenance: string[] }
  klass: RenderClass
  /** True when an early sample read as a failed read and a later one was taken. */
  firstReadingWasFailedRead?: boolean
}

function straighten(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase()
}

/**
 * Read the page; if the first reading says "failed read", read again after a
 * pause. Some legacy pages print their could-not-be-read sentence while a
 * query is still LOADING (ManagerShiftDesk.tsx:128 `rosterKnown = data !==
 * undefined`), so a single early sample would report a loading state as a
 * failed read — the fault the suite exists to catch, committed by the suite.
 */
export async function readPage(page: Page, m: Manifest, entry: PageEntry): Promise<Reading> {
  const first = await readPageOnce(page, m, entry)
  if (first.klass !== 'failed_read') return first
  await page.waitForTimeout(2_500)
  await settleDom(page, 6)
  const second = await readPageOnce(page, m, entry)
  return { ...second, firstReadingWasFailedRead: true }
}

async function readPageOnce(page: Page, m: Manifest, entry: PageEntry): Promise<Reading> {
  const nextRoots = await page.locator(m.next_root_selector).count()
  let body = straighten((await page.locator('body').innerText().catch(() => '')) ?? '')
  for (const t of entry.static_text ?? []) body = body.split(straighten(t)).join(' ')
  const find = (phrases: string[] | undefined) => (phrases ?? []).filter((p) => body.includes(straighten(p)))
  const testIds = async (ids: string[] | undefined) => {
    const out: string[] = []
    for (const id of ids ?? []) {
      if ((await page.getByTestId(id).count()) > 0) out.push(id)
    }
    return out
  }
  const matched = {
    failed_read: [...new Set([...find(entry.failed_read), ...find(m.shared_phrases.failed_read)])],
    empty: find(entry.empty),
    denied: find(m.shared_phrases.denied),
    provenance: find(entry.provenance),
  }
  const matchedTestIds = {
    failed_read: await testIds(entry.failed_read_testids),
    present: await testIds(entry.present_testids),
    provenance: await testIds(entry.provenance_testids),
  }
  let klass: RenderClass = 'data'
  if (matched.failed_read.length || matchedTestIds.failed_read.length) klass = 'failed_read'
  else if (matched.denied.length) klass = 'denied'
  else if (matched.empty.length) klass = 'empty'
  return { nextRoots, pathname: pathOf(page.url()), bodyChars: body.length, matched, matchedTestIds, klass }
}

/** Resolve "{param}" in a route from a read-only list endpoint; null when the house has none. */
export async function resolveRoute(
  request: APIRequestContext,
  env: NightlyEnv,
  session: Session,
  restaurantId: string | null,
  entry: PageEntry,
): Promise<{ route: string | null; reason: string }> {
  if (!entry.needs) return { route: entry.route, reason: 'static route' }
  const res = await request.get(`${env.apiUrl}/api/v1${entry.needs.list}`, {
    headers: authHeaders(session, restaurantId),
    params: { limit: '5', page: '1' },
  })
  if (!res.ok()) {
    return { route: null, reason: `${entry.needs.list} answered ${res.status()} — the id this route needs cannot be read` }
  }
  const body = (await res.json()) as Record<string, unknown>
  const items = (Array.isArray(body) ? body : (body[entry.needs.items_key] as unknown[])) ?? []
  const first = items.find((it) => it && typeof it === 'object' && (it as Record<string, unknown>)[entry.needs!.id_key])
  if (!first) {
    return { route: null, reason: `${entry.needs.list} holds no row for this house, so there is no ${entry.needs.param} to open the route on` }
  }
  const id = String((first as Record<string, unknown>)[entry.needs.id_key])
  return { route: entry.route.replace(`{${entry.needs.param}}`, id), reason: `id from ${entry.needs.list}` }
}
