/**
 * Nightly production E2E — the browser walk (ADR 0135).
 *
 * Signs in as the configured account (E2E_TEST_EMAIL / E2E_TEST_PASSWORD),
 * reads the house's real `mudavym_design_*` flags, walks every page in
 * manifest.json twice — once with the per-browser override forcing the Mudavym
 * design, once forcing legacy — and records what each page HONESTLY said:
 * data, an empty state in words, a failed read in words, or a refusal. It
 * never asserts on a figure.
 *
 * Every check lands in the summary as pass / fail / absent / cannot_check
 * (see lib.ts). Run against production only through
 * .github/workflows/e2e-prod.yml; locally:
 *
 *   E2E_BASE_URL=http://127.0.0.1:5276 E2E_API_URL=http://localhost:4010 \
 *   E2E_TEST_EMAIL=… E2E_TEST_PASSWORD=… \
 *   npx playwright test --config playwright.nightly.config.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  AuthBudget,
  authHeaders,
  injectSession,
  loadManifest,
  mintSession,
  pathOf,
  readEnv,
  readPage,
  record,
  recordAndAssert,
  resolveRoute,
  settleDom,
  settleWalls,
  spaNavigate,
  type Manifest,
  type NightlyEnv,
  type Session,
} from './lib'

// Not `serial`: in serial mode one failed check would SKIP every later test,
// and the reporter would then have to call the legacy walk cannot_check. One
// worker + file order (playwright.nightly.config.ts) already gives the order
// these tests need; module state is shared because they run in one process.

let env: NightlyEnv
let manifest: Manifest
let session: Session | null = null
let houseId: string | null = null

/**
 * Playwright restarts the worker after any failed test, and module state goes
 * with it — a failed check in the override-on walk must not turn the legacy
 * walk into "no session". So every test re-mints when it has to (one
 * /auth/login + one /auth/me), and the set of pages the next-walk found
 * absent is written to disk for the legacy walk to read.
 */
const ABSENT_PATH = path.join(process.cwd(), 'test-results', 'nightly', 'absent-on-build.json')

function readAbsent(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(ABSENT_PATH, 'utf8')) as string[])
  } catch {
    return new Set()
  }
}

function writeAbsent(set: Set<string>): void {
  fs.mkdirSync(path.dirname(ABSENT_PATH), { recursive: true })
  fs.writeFileSync(ABSENT_PATH, JSON.stringify([...set].sort()))
}

async function ensureSession(request: APIRequestContext): Promise<boolean> {
  if (session && houseId) return true
  try {
    env = env ?? readEnv()
    session = await mintSession(request, env)
    houseId = session.user.restaurantId
  } catch (e) {
    record({ id: 'precondition.session', state: 'cannot_check', reason: `re-minting the session failed: ${(e as Error).message}` })
    return false
  }
  return Boolean(houseId)
}

// beforeAll runs again in every restarted worker, so the absent-set file is
// cleared in the FIRST test only (below), never here.
test.beforeAll(() => {
  manifest = loadManifest()
})

// ---------------------------------------------------------------------------
// 1. Preconditions — secrets, account, house
// ---------------------------------------------------------------------------

test('precondition: secrets, account and house are what the run needs', async ({ request }) => {
  fs.rmSync(ABSENT_PATH, { force: true })
  try {
    env = readEnv()
  } catch (e) {
    record({ id: 'precondition.secrets', state: 'cannot_check', reason: (e as Error).message })
    throw e
  }
  record({ id: 'precondition.secrets', state: 'pass', reason: `base ${env.baseUrl}, api ${env.apiUrl}, target ${env.target}` })

  try {
    session = await mintSession(request, env)
  } catch (e) {
    record({ id: 'precondition.account', state: 'cannot_check', reason: (e as Error).message })
    throw e
  }
  const u = session.user
  houseId = u.restaurantId
  record({
    id: 'precondition.account',
    state: 'pass',
    reason: `signed in via /auth/login as role ${u.role}`,
    evidence: { emailVerified: u.emailVerified, hasHouse: Boolean(houseId) },
  })
  recordAndAssert({
    id: 'precondition.account.verified',
    state: u.emailVerified === false ? 'cannot_check' : 'pass',
    reason:
      u.emailVerified === false
        ? 'the account email is unverified — ProtectedRoute sends every page to /verify-email, so no page can be walked'
        : 'the account email is verified (or the gateway does not report verification)',
  })
  recordAndAssert({
    id: 'precondition.house',
    state: houseId ? 'pass' : 'cannot_check',
    reason: houseId ? `the account belongs to house ${houseId}` : 'the account has no restaurant_id — grant it a simulator house first',
  })
})

// ---------------------------------------------------------------------------
// 2. The real sign-in form (two steps: identity, then method)
// ---------------------------------------------------------------------------

test('sign-in: the two-step login form signs the account in', async ({ page, request }) => {
  if (!(await ensureSession(request))) return
  const budget = new AuthBudget()
  budget.attach(page)
  await page.goto(`${env.baseUrl}/login`, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.fill('#email', env.email)
  await page.getByRole('button', { name: /continue/i }).click()
  const pw = page.locator('#password')
  const noMethod = page.getByText('This account has no sign-in method set up')
  await expect(pw.or(noMethod)).toBeVisible({ timeout: 15_000 })
  if (await noMethod.isVisible()) {
    recordAndAssert({ id: 'signin.ui', state: 'cannot_check', reason: 'the login page says this account has no sign-in method (no password, no provider)' })
    return
  }
  await pw.fill(env.password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  const wall = await settleWalls(page, manifest.shared_phrases.walls, 3, 2_000)
  recordAndAssert({
    id: 'signin.ui',
    state: wall ? 'fail' : 'pass',
    reason: wall ? `the form signed in but the app settled on ${wall} (${manifest.shared_phrases.walls[wall]})` : `landed on ${pathOf(page.url())}`,
    evidence: budget.summary(),
  })
})

// ---------------------------------------------------------------------------
// 3. The house's flags, as production actually has them
// ---------------------------------------------------------------------------

test('flags: every manifest page reports its flag for this house', async ({ request }) => {
  if (!(await ensureSession(request))) return
  let on = 0
  let off = 0
  let unregistered = 0
  for (const entry of manifest.pages) {
    const res = await request.post(`${env.apiUrl}/api/v1/settings/feature-flags/check`, {
      headers: authHeaders(session!, houseId),
      data: { restaurant_id: houseId, feature_name: entry.flag },
    })
    if (!res.ok()) {
      recordAndAssert({ id: `flag.${entry.slug}`, state: 'fail', reason: `/settings/feature-flags/check answered ${res.status()} for ${entry.flag}` })
      continue
    }
    const body = (await res.json()) as { enabled: boolean; active: boolean }
    if (!body.active) {
      unregistered += 1
      record({ id: `flag.${entry.slug}`, state: 'absent', reason: `${entry.flag} is not registered on this gateway build (active=false) — no code reads it`, evidence: body })
      continue
    }
    if (body.enabled) on += 1
    else off += 1
    const mismatch = (env.expectFlags === 'on' && !body.enabled) || (env.expectFlags === 'off' && body.enabled)
    recordAndAssert({
      id: `flag.${entry.slug}`,
      state: mismatch ? 'fail' : 'pass',
      reason: `${entry.flag} is ${body.enabled ? 'ON' : 'OFF'} for this house${env.expectFlags === 'report' ? ' (reported, not gated: E2E_EXPECT_FLAGS=report)' : ` — expected ${env.expectFlags}`}`,
      evidence: body,
    })
  }
  record({ id: 'flags.tally', state: 'pass', reason: `${on} on · ${off} off · ${unregistered} not registered on this build`, evidence: { on, off, unregistered, pages: manifest.pages.length } })
})

// ---------------------------------------------------------------------------
// 4 + 5. The two walks
// ---------------------------------------------------------------------------

type Mode = 'next' | 'legacy'

async function walk(page: Page, request: APIRequestContext, mode: Mode, restaurantId: string, overrides: Record<string, '1' | '0'>): Promise<void> {
  const absentOnBuild = readAbsent()
  const budget = new AuthBudget()
  budget.attach(page)
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`.slice(0, 300)))

  await injectSession(page, session!, restaurantId, overrides, manifest.override_prefix)
  await budget.beforeBoot(page)
  await page.goto(`${env.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 40_000 })
  await settleDom(page)
  const wall = await settleWalls(page, manifest.shared_phrases.walls)
  if (wall) {
    for (const entry of manifest.pages) {
      record({ id: `page.${entry.slug}.${mode}`, state: 'cannot_check', reason: `the app settled on ${wall} after boot (${manifest.shared_phrases.walls[wall]}); no page was walked` })
    }
    expect.soft(wall, `boot settled on ${wall}`).toBeNull()
    return
  }

  for (const entry of manifest.pages) {
    const errorsBefore = pageErrors.length
    const { route, reason: routeReason } = await resolveRoute(request, env, session!, restaurantId, entry)
    if (!route) {
      // The route exists; the HOUSE has nothing to open it on. That is an
      // absence in the house's data, said as one — not a missing precondition.
      record({ id: `page.${entry.slug}.${mode}`, state: 'absent', reason: routeReason })
      continue
    }
    await spaNavigate(page, route)
    const landed = pathOf(page.url())
    const wallNow = Object.keys(manifest.shared_phrases.walls).find((w) => landed.startsWith(w))
    if (wallNow) {
      recordAndAssert({ id: `page.${entry.slug}.${mode}`, state: wallNow === '/login' ? 'cannot_check' : 'fail', reason: `${route} sent the session to ${wallNow} (${manifest.shared_phrases.walls[wallNow]})` })
      if (wallNow === '/login') return // the token died; every later page would say the same thing
      continue
    }
    const reading = await readPage(page, manifest, entry)
    await test.info().attach(`${entry.slug}.${mode}.png`, { body: await page.screenshot(), contentType: 'image/png' })

    const newErrors = pageErrors.slice(errorsBefore)
    const evidence = { route, landed, nextRoots: reading.nextRoots, bodyChars: reading.bodyChars, klass: reading.klass, matched: reading.matched, testids: reading.matchedTestIds, pageErrors: newErrors, firstReadingWasFailedRead: reading.firstReadingWasFailedRead ?? false }

    if (reading.bodyChars < 40) {
      recordAndAssert({ id: `page.${entry.slug}.${mode}`, state: 'fail', reason: `${route} rendered ${reading.bodyChars} characters — a blank page`, evidence })
      continue
    }

    // The router's catch-all (`path="*"` → `/`) turns an unknown route into the
    // dashboard. Without this check a build that lacks the page would render
    // the dashboard's Mudavym root and the page would read as PRESENT.
    const routePath = route.split('?')[0]
    const landedElsewhere = landed !== routePath
    if (mode === 'next' && landedElsewhere) {
      if (landed === '/' && routePath !== '/') {
        absentOnBuild.add(entry.slug)
        record({ id: `page.${entry.slug}.next`, state: 'absent', reason: `${route} is not a route on this build — the router's catch-all sent it to /`, evidence })
      } else {
        recordAndAssert({ id: `page.${entry.slug}.next`, state: 'fail', reason: `${route} with the override on landed on ${landed}`, evidence })
      }
      continue
    }
    if (mode === 'legacy' && absentOnBuild.has(entry.slug)) {
      record({ id: `page.${entry.slug}.legacy`, state: 'absent', reason: `${route} is not a route on this build (see page.${entry.slug}.next)`, evidence })
      continue
    }

    if (mode === 'next') {
      if (entry.legacy === 'same') {
        recordAndAssert({ id: `page.${entry.slug}.next`, state: 'pass', reason: `${route} rendered (no page swap behind ${entry.flag}; .mudavym roots recorded, not asserted)`, evidence })
      } else if (reading.nextRoots === 0) {
        absentOnBuild.add(entry.slug)
        record({ id: `page.${entry.slug}.next`, state: 'absent', reason: `${route} is not gated on this build — with the override on, no ${manifest.next_root_selector} root rendered (legacy showed)`, evidence })
        continue
      } else {
        recordAndAssert({ id: `page.${entry.slug}.next`, state: 'pass', reason: `${route} rendered the Mudavym design (${reading.nextRoots} root${reading.nextRoots === 1 ? '' : 's'})`, evidence })
      }
      // What the page honestly said about its reads.
      if (reading.klass === 'failed_read') {
        record({ id: `page.${entry.slug}.next.honesty`, state: 'pass', reason: `the page named its failed read in words: “${[...reading.matched.failed_read, ...reading.matchedTestIds.failed_read][0]}”` })
        recordAndAssert({ id: `page.${entry.slug}.next.reads`, state: 'fail', reason: `a read behind ${route} failed on this build (the page said so; nothing invented)`, evidence })
      } else if (reading.klass === 'denied') {
        record({ id: `page.${entry.slug}.next.reads`, state: 'pass', reason: `the page reported a refusal in words: “${reading.matched.denied[0]}” — an honest denied state`, evidence })
      } else if (reading.klass === 'empty') {
        record({ id: `page.${entry.slug}.next.reads`, state: 'pass', reason: `honest empty state: “${reading.matched.empty[0]}”`, evidence })
      } else {
        record({ id: `page.${entry.slug}.next.reads`, state: 'pass', reason: 'rendered with data; no failed-read, denied or empty sentence present', evidence })
      }
      if (entry.provenance_required && reading.klass === 'data' && reading.nextRoots > 0) {
        const seen = reading.matched.provenance.length + reading.matchedTestIds.provenance.length
        recordAndAssert({ id: `page.${entry.slug}.next.provenance`, state: seen ? 'pass' : 'fail', reason: seen ? `provenance line present (“${reading.matched.provenance[0] ?? reading.matchedTestIds.provenance[0]}”)` : 'the page renders figures but no provenance line' })
      } else if (reading.matched.provenance.length || reading.matchedTestIds.provenance.length) {
        record({ id: `page.${entry.slug}.next.provenance`, state: 'pass', reason: `provenance wording present: “${reading.matched.provenance[0] ?? reading.matchedTestIds.provenance[0]}”` })
      }
    } else {
      // legacy pass
      if (entry.legacy === 'same') {
        recordAndAssert({ id: `page.${entry.slug}.legacy`, state: 'pass', reason: `${route} renders the same page either way (no page swap)`, evidence })
      } else if (entry.legacy.startsWith('redirect:')) {
        const target = entry.legacy.slice('redirect:'.length)
        recordAndAssert({ id: `page.${entry.slug}.legacy`, state: landed.startsWith(target) ? 'pass' : 'fail', reason: landed.startsWith(target) ? `${route} with the flag off redirected to ${target} as documented` : `${route} with the flag off landed on ${landed}, expected ${target}`, evidence })
      } else {
        recordAndAssert({ id: `page.${entry.slug}.legacy`, state: reading.nextRoots === 0 ? 'pass' : 'fail', reason: reading.nextRoots === 0 ? `${route} rendered the legacy page (no ${manifest.next_root_selector} root)` : `${route} rendered ${reading.nextRoots} Mudavym root(s) although the flag is off`, evidence })
      }
      if (reading.klass === 'failed_read') {
        recordAndAssert({ id: `page.${entry.slug}.legacy.reads`, state: 'fail', reason: `the legacy page reported a failed read: “${reading.matched.failed_read[0]}”`, evidence })
      }
      for (const alias of absentOnBuild.has(entry.slug) ? [] : entry.aliases ?? []) {
        await spaNavigate(page, alias.route)
        const aliasLanded = pathOf(page.url())
        const target = alias.legacy.startsWith('redirect:') ? alias.legacy.slice('redirect:'.length) : alias.route
        recordAndAssert({ id: `page.${entry.slug}.legacy.alias${alias.route.replace(/\//g, '.')}`, state: aliasLanded.startsWith(target) ? 'pass' : 'fail', reason: `${alias.route} with the flag off landed on ${aliasLanded} (expected ${target})` })
      }
    }
    if (newErrors.length) {
      recordAndAssert({ id: `page.${entry.slug}.${mode}.pageerrors`, state: 'fail', reason: `${newErrors.length} uncaught page error(s) on ${route}: ${newErrors[0]}`, evidence: { pageErrors: newErrors } })
    }
  }
  if (mode === 'next') writeAbsent(absentOnBuild)
  const pacing = budget.summary() as { auth_requests_max_per_route_in_any_60s: number }
  recordAndAssert({ id: `walk.${mode}.pacing`, state: pacing.auth_requests_max_per_route_in_any_60s < 10 ? 'pass' : 'fail', reason: `auth calls per route peaked at ${pacing.auth_requests_max_per_route_in_any_60s}/60 s against the gateway's 10 (rate-limit.guard.ts DEFAULT_RATE_LIMITS.auth)`, evidence: budget.summary() })
}

test('walk: every rebuilt page with the Mudavym override on', async ({ page, request }) => {
  if (!(await ensureSession(request))) return
  const overrides: Record<string, '1' | '0'> = {}
  for (const p of manifest.pages) overrides[p.slug] = '1'
  await walk(page, request, 'next', houseId!, overrides)
})

test('walk: every page with the flag off (legacy)', async ({ page, request }) => {
  if (!(await ensureSession(request))) return
  const legacyHouse = env.legacyRestaurantId
  const overrides: Record<string, '1' | '0'> = {}
  if (!legacyHouse) for (const p of manifest.pages) overrides[p.slug] = '0'
  record({
    id: 'walk.legacy.house',
    state: 'pass',
    reason: legacyHouse ? `legacy pass uses second house ${legacyHouse} with its real flags (E2E_LEGACY_RESTAURANT_ID)` : 'legacy pass uses the same house with the per-browser override forcing legacy (no second house configured)',
  })
  await walk(page, request, 'legacy', legacyHouse ?? houseId!, overrides)
})
