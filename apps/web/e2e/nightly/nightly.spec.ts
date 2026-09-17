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
 * It also opens the signed-in routes still waiting for a design (pending_pages)
 * and the signed-out doors behind ADR 0133's one switch (public_pages), refuses
 * any house not on sim-houses.json, and aborts every write the app attempts.
 * apps/web/e2e/README.md explains the whole suite.
 *
 * Every check lands in the summary as pass / fail / absent / cannot_check
 * (see lib.ts). Run against production only through
 * .github/workflows/e2e-prod.yml; locally:
 *
 *   E2E_BASE_URL=http://127.0.0.1:5276 E2E_API_URL=http://localhost:4010 \
 *   E2E_TEST_EMAIL=… E2E_TEST_PASSWORD=… \
 *   npx playwright test --config playwright.nightly.config.ts
 */

import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import {
  AuthBudget,
  authHeaders,
  gateway,
  checkSimHouse,
  describeCall,
  loadDesignCalls,
  ReadOnlyGuard,
  injectSession,
  loadManifest,
  mintSession,
  pathOf,
  readEnv,
  readPage,
  record,
  recordAndAssert,
  resolveRoute,
  safeMessage,
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
 * /auth/login + one /auth/me). Each walk measures its own landings; nothing
 * one walk found is trusted by the next (audit 2026-09-17, correctness 1).
 */
const budget = new AuthBudget()

async function ensureSession(request: APIRequestContext): Promise<boolean> {
  if (session && houseId) return true
  try {
    env = env ?? readEnv()
    session = await mintSession(request, env)
    houseId = session.user.restaurantId
  } catch (e) {
    record({ id: 'precondition.session', state: 'cannot_check', reason: `re-minting the session failed: ${safeMessage(e)}` })
    return false
  }
  return Boolean(houseId)
}

/**
 * The gateway scopes every read by the sign-in token's own house — it never
 * reads X-Restaurant-Id — so the house that gets screenshotted is
 * session.user.restaurantId, whatever else is configured. Every test that
 * opens a signed-in page checks THAT house first (audit 2026-09-17, security N1).
 */
async function ensureSimSession(request: APIRequestContext, id: string): Promise<boolean> {
  if (!(await ensureSession(request))) return false
  const sim = await checkSimHouse(request, env, session!, houseId)
  if (!sim.ok) {
    recordAndAssert({ id: `${id}.house`, state: 'cannot_check', reason: `refused: ${sim.reason}` })
    return false
  }
  return true
}

test.beforeAll(() => {
  manifest = loadManifest()
})

// ---------------------------------------------------------------------------
// 1. Preconditions — secrets, account, house
// ---------------------------------------------------------------------------

test('precondition: secrets, account and house are what the run needs', async ({ request }) => {
  try {
    env = readEnv()
  } catch (e) {
    record({ id: 'precondition.secrets', state: 'cannot_check', reason: safeMessage(e) })
    throw new Error(safeMessage(e))
  }
  record({ id: 'precondition.secrets', state: 'pass', reason: `base ${env.baseUrl}, api ${env.apiUrl}, target ${env.target}` })

  try {
    session = await mintSession(request, env)
  } catch (e) {
    record({ id: 'precondition.account', state: 'cannot_check', reason: safeMessage(e) })
    throw new Error(safeMessage(e))
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
  if (!houseId) return
  const sim = await checkSimHouse(request, env, session, houseId)
  recordAndAssert({ id: 'precondition.house.sim', state: sim.ok ? 'pass' : 'cannot_check', reason: sim.reason })
  if (env.legacyRestaurantId && env.legacyRestaurantId !== houseId) {
    // Founder's call 2026-09-17: refuse. The gateway takes the house from the
    // token, so a second house needs a second account (F3 reopened).
    recordAndAssert({
      id: 'precondition.legacy_house',
      state: 'cannot_check',
      reason: `E2E_LEGACY_RESTAURANT_ID names a house other than the account's own; the gateway scopes by the sign-in token and never reads X-Restaurant-Id, so that house cannot be walked with this account (the legacy walk uses the account's house with the design forced off)`,
    })
  }
})

// ---------------------------------------------------------------------------
// 2. The real sign-in form (two steps: identity, then method)
// ---------------------------------------------------------------------------

test('sign-in: the two-step login form signs the account in', async ({ page, request }) => {
  if (!(await ensureSimSession(request, 'signin'))) return
  budget.attach(page)
  // The form's own two POSTs are the thing under test; every other write the
  // app attempts after landing is aborted and listed (security N2).
  const guard = new ReadOnlyGuard(['/api/v1/auth/sign-in-methods', '/api/v1/auth/login'])
  await guard.attach(page)
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
  try {
    await pw.fill(env.password)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
  } catch (e) {
    // The login page keeps the typed password on an error, and Playwright
    // snapshots every input's value into error-context.md when a test fails;
    // a failed fill() also prints the value in its call log. Empty the field
    // and throw only a scrubbed first line (re-audit 2026-09-17, B2).
    // Record BEFORE clearing: the clear has no action timeout, so on a detached
    // field it would hang to the test timeout and take the diagnosis with it.
    recordAndAssert({ id: 'signin.ui', state: 'fail', reason: `the form did not sign the account in: ${safeMessage(e)}`, evidence: budget.summary() })
    await page.locator('#password').fill('', { timeout: 5_000 }).catch(() => undefined)
    throw new Error(`signin.ui: ${safeMessage(e)}`)
  }
  const wall = await settleWalls(page, manifest.shared_phrases.walls, 3, 2_000)
  recordAndAssert({
    id: 'signin.ui',
    state: wall ? 'fail' : 'pass',
    reason: wall ? `the form signed in but the app settled on ${wall} (${manifest.shared_phrases.walls[wall]})` : `landed on ${pathOf(page.url())}`,
    evidence: budget.summary(),
  })
  const ro = guard.summary()
  record({ id: 'signin.readonly', state: 'pass', reason: ro.blocked ? `${ro.blocked} write(s) beyond the form's own were aborted: ${ro.distinct.join(', ')}` : 'no write beyond the form', evidence: ro })
})

// ---------------------------------------------------------------------------
// 3. The house's flags, as production actually has them
// ---------------------------------------------------------------------------

test('flags: every manifest page reports its flag for this house', async ({ request }) => {
  if (!(await ensureSimSession(request, 'flags'))) return
  let on = 0
  let off = 0
  let unregistered = 0
  for (const entry of manifest.pages) {
    const res = await gateway(request, 'post', `${env.apiUrl}/api/v1/settings/feature-flags/check`, {
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

async function walk(page: Page, request: APIRequestContext, mode: Mode, overrides: Record<string, '1' | '0'>): Promise<void> {
  // Re-checked here, not trusted from the precondition test: a worker restart
  // loses module state, and the walk is the step that screenshots the house.
  // The house is the TOKEN's (see ensureSimSession), never a configured id.
  if (!(await ensureSimSession(request, `walk.${mode}`))) return
  const restaurantId = houseId!
  if (mode === 'legacy') {
    record({ id: 'walk.legacy.house', state: 'pass', reason: "legacy pass uses the account's own simulator house with the per-browser override forcing legacy (a second house is refused: the gateway scopes by the sign-in token)" })
  }
  const designCalls = loadDesignCalls()
  budget.attach(page)
  const guard = new ReadOnlyGuard()
  await guard.attach(page)
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
    const { route, reason: routeReason, state: routeState } = await resolveRoute(request, env, session!, restaurantId, entry)
    if (!route) {
      // `absent`: the house has nothing to open the route on — an absence in the
      // house's data. `cannot_check`: the list read itself failed.
      recordAndAssert({ id: `page.${entry.slug}.${mode}`, state: routeState ?? 'absent', reason: routeReason })
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
    const evidence = { route, landed, founderCalls: (designCalls[entry.slug] ?? []).map(describeCall), nextRoots: reading.nextRoots, bodyChars: reading.bodyChars, klass: reading.klass, matched: reading.matched, testids: reading.matchedTestIds, pageErrors: newErrors, firstReadingWasFailedRead: reading.firstReadingWasFailedRead ?? false }

    if (reading.bodyChars < 40) {
      recordAndAssert({ id: `page.${entry.slug}.${mode}`, state: 'fail', reason: `${route} rendered ${reading.bodyChars} characters — a blank page`, evidence })
      continue
    }

    // The router's catch-all (`path="*"` → `/`) turns an unknown route into the
    // dashboard. Without this check a build that lacks the page would render
    // the dashboard's Mudavym root and the page would read as PRESENT. Every
    // page here is in MUDAVYM_PAGES (scripts/check_nightly_manifest.py holds
    // the manifest equal to it), so landing elsewhere is a FAIL, never an
    // absence: the route broke, or production is behind main (correctness 2).
    const routePath = route.split('?')[0]
    const landedElsewhere = landed !== routePath
    const redirects = mode === 'legacy' && entry.legacy.startsWith('redirect:')
    if (landedElsewhere && !redirects) {
      recordAndAssert({
        id: `page.${entry.slug}.${mode}`,
        state: 'fail',
        reason: landed === '/' && routePath !== '/' ? `${route} is not a route on the build under test (the catch-all sent it to /) although MUDAVYM_PAGES enrols it — the route broke, or production is behind main` : `${route} landed on ${landed}`,
        evidence,
      })
      continue
    }

    if (mode === 'next') {
      if (entry.legacy === 'same') {
        recordAndAssert({ id: `page.${entry.slug}.next`, state: 'pass', reason: `${route} rendered (no page swap behind ${entry.flag}; .mudavym roots recorded, not asserted)`, evidence })
      } else if (reading.nextRoots === 0) {
        recordAndAssert({ id: `page.${entry.slug}.next`, state: 'fail', reason: `${route} rendered no ${manifest.next_root_selector} root with the override on although MUDAVYM_PAGES enrols it — the override, the gate or the page is broken on this build, or production is behind main`, evidence })
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
      for (const alias of entry.aliases ?? []) {
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
  if (mode === 'next') await walkPending(page)
  const ro = guard.summary()
  record({
    id: `walk.${mode}.readonly`,
    state: 'pass',
    reason: ro.blocked ? `${ro.blocked} write(s) the app attempted were aborted before leaving the browser: ${ro.distinct.join(', ')}` : 'the app attempted no write during the walk',
    evidence: ro,
  })
  const pacing = budget.summary() as { auth_requests_max_per_route_in_any_60s: number }
  recordAndAssert({ id: `walk.${mode}.pacing`, state: pacing.auth_requests_max_per_route_in_any_60s < 10 ? 'pass' : 'fail', reason: `auth calls per route peaked at ${pacing.auth_requests_max_per_route_in_any_60s}/60 s against the gateway's 10 (rate-limit.guard.ts DEFAULT_RATE_LIMITS.auth)`, evidence: budget.summary() })
}

/**
 * The signed-in routes the new-pages list names that are not enrolled in
 * MUDAVYM_PAGES yet. The override key is set for each anyway, so the day one
 * enrols without the manifest moving, its Mudavym root renders here and the
 * walk says so instead of calling it absent from a note.
 */
async function walkPending(page: Page): Promise<void> {
  for (const entry of manifest.pending_pages) {
    await spaNavigate(page, entry.route)
    const landed = pathOf(page.url())
    const roots = await page.locator(manifest.next_root_selector).count()
    if (landed === '/' && entry.route !== '/') {
      record({ id: `pending.${entry.slug}`, state: 'absent', reason: `${entry.route} is not a route on this build (the catch-all sent it to /); held by ${entry.held_by}` })
    } else if (landed !== entry.route) {
      record({ id: `pending.${entry.slug}`, state: 'absent', reason: `${entry.route} landed on ${landed} for this account; held by ${entry.held_by}`, evidence: { landed } })
    } else if (roots === 0) {
      record({ id: `pending.${entry.slug}`, state: 'absent', reason: `${entry.route} renders its current page with no ${manifest.next_root_selector} root — not rebuilt yet (${entry.held_by})`, evidence: { landed, roots } })
    } else {
      recordAndAssert({ id: `pending.${entry.slug}`, state: 'fail', reason: `${entry.route} rendered ${roots} Mudavym root(s) but the manifest still lists it as pending — move it into pages with its sentences`, evidence: { landed, roots } })
    }
  }
}

test('walk: every rebuilt page with the Mudavym override on', async ({ page, request }) => {
  const overrides: Record<string, '1' | '0'> = {}
  for (const p of manifest.pages) overrides[p.slug] = '1'
  for (const p of manifest.pending_pages) overrides[p.slug] = '1'
  await walk(page, request, 'next', overrides)
})

test('walk: every page with the flag off (legacy)', async ({ page, request }) => {
  const overrides: Record<string, '1' | '0'> = {}
  for (const p of manifest.pages) overrides[p.slug] = '0'
  await walk(page, request, 'legacy', overrides)
})

// ---------------------------------------------------------------------------
// 6. The signed-out doors (ADR 0133: one switch, VITE_MUDAVYM_PUBLIC)
// ---------------------------------------------------------------------------

type PublicPass = 'default' | 'on' | 'off'

async function openSignedOut(browser: Browser, pass: PublicPass): Promise<{ page: Page; close: () => Promise<void>; guard: ReadOnlyGuard; errors: string[] }> {
  const context = await browser.newContext()
  if (pass !== 'default') {
    await context.addInitScript(
      (a: { key: string; value: string }) => {
        try {
          window.localStorage.setItem(a.key, a.value)
        } catch {
          /* storage blocked — recorded by the switch check */
        }
      },
      { key: manifest.public_override_key, value: pass === 'on' ? '1' : '0' },
    )
  }
  const page = await context.newPage()
  const guard = new ReadOnlyGuard()
  await guard.attach(page)
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`.slice(0, 300)))
  await page.goto(`${env.baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 40_000 })
  await settleDom(page)
  return { page, close: () => context.close(), guard, errors }
}

async function readPublic(page: Page, route: string): Promise<{ landed: string; roots: number; body: string }> {
  await spaNavigate(page, route)
  const body = ((await page.locator('body').innerText().catch(() => '')) ?? '').replace(/[‘’]/g, "'").toLowerCase()
  return { landed: pathOf(page.url()), roots: await page.locator(manifest.next_root_selector).count(), body }
}

test('public: the signed-out doors, with the one switch as built and forced each way', async ({ browser }) => {
  try {
    env = env ?? readEnv()
  } catch (e) {
    record({ id: 'public.precondition', state: 'cannot_check', reason: safeMessage(e) })
    return
  }

  // As built: what a stranger sees on this deploy, reported, not gated.
  const asBuilt = await openSignedOut(browser, 'default')
  const loginRoots = await asBuilt.page.locator(manifest.next_root_selector).count()
  record({
    id: 'public.switch',
    state: 'pass',
    reason: `VITE_MUDAVYM_PUBLIC reads ${loginRoots > 0 ? 'ON' : 'OFF'} on this build (measured on /login: ${loginRoots} ${manifest.next_root_selector} root${loginRoots === 1 ? '' : 's'}; reported, not gated)`,
  })
  await asBuilt.close()

  for (const pass of ['on', 'off'] as const) {
    const s = await openSignedOut(browser, pass)
    for (const entry of manifest.public_pages) {
      const before = s.errors.length
      const r = await readPublic(s.page, entry.route)
      const id = `public.${entry.slug}.${pass}`
      const shot = await s.page.screenshot()
      await test.info().attach(`public.${entry.slug}.${pass}.png`, { body: shot, contentType: 'image/png' })
      if (r.body.length < 40) {
        recordAndAssert({ id, state: 'fail', reason: `${entry.route} rendered ${r.body.length} characters signed out — a blank page`, evidence: r })
        continue
      }
      if (pass === 'on') {
        if (entry.switch === 'public') {
          if (r.roots > 0) recordAndAssert({ id, state: 'pass', reason: `${entry.route} rendered the Mudavym public design with the switch forced on`, evidence: { landed: r.landed, roots: r.roots } })
          else recordAndAssert({ id, state: 'fail', reason: `${entry.route} rendered no ${manifest.next_root_selector} root with the switch forced on although ${entry.file} reads the switch — the override or the page is broken, or production is behind main`, evidence: { landed: r.landed } })
        } else if (r.roots === 0) {
          record({ id, state: 'absent', reason: `${entry.route} is not rebuilt on this build — ${entry.file} reads no switch (ADR 0133's public wave)`, evidence: { landed: r.landed } })
        } else {
          recordAndAssert({ id, state: 'fail', reason: `${entry.route} rendered ${r.roots} Mudavym root(s) but the manifest says its file reads no switch — update public_pages`, evidence: { landed: r.landed, roots: r.roots } })
        }
      } else if (entry.switch === 'public') {
        recordAndAssert({ id, state: r.roots === 0 ? 'pass' : 'fail', reason: r.roots === 0 ? `${entry.route} rendered its legacy design with the switch forced off` : `${entry.route} rendered ${r.roots} Mudavym root(s) with the switch forced off`, evidence: { landed: r.landed, roots: r.roots } })
      }
      if (entry.honest?.length && pass === 'off') {
        const said = entry.honest.find((h) => r.body.includes(h.replace(/[‘’]/g, "'").toLowerCase()))
        recordAndAssert({ id: `public.${entry.slug}.honest`, state: said ? 'pass' : 'fail', reason: said ? `${entry.route} named the dead link in words: “${said}”` : `${entry.route} opened with an invalid value and said none of: ${entry.honest.join(' / ')}`, evidence: { landed: r.landed } })
      }
      const errs = s.errors.slice(before)
      if (errs.length) recordAndAssert({ id: `${id}.pageerrors`, state: 'fail', reason: `${errs.length} uncaught page error(s) on ${entry.route}: ${errs[0]}` })
    }
    if (pass === 'off') {
      for (const redirect of manifest.signed_out_redirects) {
        const r = await readPublic(s.page, redirect.route)
        recordAndAssert({ id: `public.redirect${redirect.route.replace(/\//g, '.')}`, state: r.landed.startsWith(redirect.to) ? 'pass' : 'fail', reason: r.landed.startsWith(redirect.to) ? `${redirect.route} sent a signed-out visitor to ${redirect.to}` : `${redirect.route} signed out landed on ${r.landed}, expected ${redirect.to}` })
      }
    }
    const ro = s.guard.summary()
    record({ id: `public.${pass}.readonly`, state: 'pass', reason: ro.blocked ? `${ro.blocked} write(s) aborted in the browser: ${ro.distinct.join(', ')}` : 'no write attempted', evidence: ro })
    await s.close()
  }
})
