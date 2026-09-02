# 0067 — A failed read is never reported as an empty one

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** supabase-js, swallowed error, destructure, maybeSingle, silent failure, absence as health, fail open, ratchet, baseline, guard, em dash
- **Links:** [[0020-no-fabricated-answers]], [[0051-rebuilt-pages-show-live-data-only]], [[0053-analytics-cost-unknown-not-invented]], [[0058-order-status-is-an-enum-not-a-string]], [[0059-receiving-preserves-the-pair]], `.planning/03-scenarios/DELIVERY-AUDIT.md` §6, `scripts/check_read_errors_not_swallowed.py`

## Context

`supabase-js` **resolves** with `{ data, error }`. It does not throw. Three
consequences follow, and all three are in production today:

1. `const { data } = await client.from(t).select()` yields `[]` for **both** a
   failed query and a genuinely empty table.
2. `maybeSingle()` yields `data: null` for **both** "no row matched" and "the
   query failed".
3. A `try/catch` wrapped around either is **inert**. Nothing was thrown, so the
   handler never runs — and the presence of the `catch` block is what makes a
   reviewer stop reading.

Four independent auditors hunting this pattern found ~29 consequential
instances (`.planning/03-scenarios/DELIVERY-AUDIT.md` §6). A mechanical sweep
of `apps/`, `services/` and `packages/` at `origin/main` (1f4717cc) found
**215 across 47 first-party files**, excluding tests (995 files scanned).

What makes the class expensive is not the count. It is that several instances
read as **good news**:

- `providers.service.ts:116-130` — the 409 dedup guard discarded `error`, and
  `maybeSingle()` returns `null` for both cases, so a failed lookup read as *no
  duplicate exists* and the insert proceeded. The guard **failed open** and
  created the exact ambiguity it exists to prevent. (Fixed and merged before
  this ADR.)
- `vendor-catalogue.service.ts:75-95` — on **any** error it re-ran a silently
  *different* query that dropped `country`, `listing_tier`, the `q` text match
  and `type`, and returned that as the search the caller asked for. A search
  for "Breakthru" in Texas came back as the alphabetically-first 20 active
  vendors on earth. **Wrong results, not empty ones** — the only member of the
  class that fabricates rather than omits. Its stated hypothesis ("in case
  listing_tier column is absent") was also false: the column has existed since
  `supabase/migrations/20260807001652_vendor_listing_tier.sql`. So the branch
  guarded a condition that cannot occur, while silently handling every
  condition that can.
- `performance.service.ts:134-144` — a failed benchmark read reached
  `percentile([])`, which returned **0**, so the peer median rendered as $0 per
  cover and the band as [0, 0]. **Every server in every restaurant beat their
  team.**
- `insight-scheduler.service.ts:58-62` — `const { data: restaurants } = …`
  followed by `if (!restaurants?.length) return` no-opped the **entire hourly
  insight sweep, for every tenant, every category**, and `sweep()`'s own
  `try/catch` logged nothing because nothing threw.
- `pos-hub.service.ts:1098-1128` — the "is my POS connection live?" endpoint
  answered `0 checks, 0 sources` over a dead read, and Settings → POS rendered
  *"Ingestion (30d): 0 checks from this source"* — the same sentence a
  genuinely idle integration produces.
- `analytics.service.ts` — the sibling of `advanced-analytics.service.ts`, same
  directory and same tables. The sibling was hardened with `logQueryFailure`;
  this one was not, and its `Promise.allSettled` loaders turned both a
  rejection and a `{ error }` into an empty inventory.

This is the repo's standing cross-cutting fault — **a system reporting its own
ABSENCE as HEALTH** — expressed in a single line of destructuring. It is the
same class as [0051](0051-rebuilt-pages-show-live-data-only.md) (unknown must
not render as zero), [0053](0053-analytics-cost-unknown-not-invented.md) (an
unknown cost is not a cost of 0) and
[0058](0058-order-status-is-an-enum-not-a-string.md) (a query matching nothing
became a measured zero). Each of those scoped one surface. This one scopes the
*mechanism*, which is why it gets a guard rather than another sweep.

## Options considered

1. **Fix the named instances and move on.** Cheapest, and it is what the last
   four audits did — the population is still 215, so it demonstrably does not
   hold. Rejected on the evidence of its own track record.

2. **A guard that fails on every site.** Honest, and unmergeable: 215
   violations on the pre-fix tree means the guard is either merged red or
   turned off within a week, and *"a guard everybody disables is worse than
   none"*. It also cannot be delivered incrementally by any single session.

3. **A warn-only guard.** Green build, printed warnings. This is
   absence-as-health with extra steps: nothing forces the count down, and a
   warning that never blocks is read exactly as often as no warning.

4. **A guard with a checked-in baseline (a ratchet).** Every pre-existing site
   is recorded in `scripts/read_error_baseline.json`, keyed by *file + table +
   binding*. A site outside the baseline **fails the build**; a baseline row
   the tree no longer contains **also fails the build**, with instructions to
   delete it. New code cannot add a swallow, and the number can only shrink.

5. **A type-level fix — ban the destructure in ESLint / wrap the client.**
   Attractive and strictly better in the long run: a `queryOrThrow(client, …)`
   helper makes the defect unrepresentable rather than merely detected. Costs a
   migration of 215 call sites and an ADR on the wrapper's contract (what does
   it do about `maybeSingle`? about deliberate fail-open paths?). Not rejected
   — deferred, and named in "What would trigger revisiting" below.

## Decision

**Option 4, plus the fixes to the unowned instances.** A blocking CI guard,
`scripts/check_read_errors_not_swallowed.py`, ratcheted against a checked-in
baseline; six services fixed; the remainder recorded with its denominator.

The reasoning that carried it: the four prior audits each found this class and
each fixed a subset, and the subset regrew — because nothing in the build knew
the rule existed. What has to be true from here is not *"the 215 are fixed"*
(that is a burn-down, and it can be done by anyone at any pace) but *"the 216th
cannot be written"*. Only a blocking check makes that true, and only a baseline
makes a blocking check mergeable today. The baseline is not an amnesty: it is
the denominator, in the repo, that a burn-down decrements — and the guard fails
if it stops matching the tree, so the count cannot rot the way a number in
prose does (CLAUDE.md §5b).

### The guard's contract

    exit 0   checked, clean
    exit 1   checked, violations (each printed with file:line and a fix)
    exit 2   CANNOT CHECK — blocks in CI exactly like exit 1

**Exit 2 is the load-bearing part.** A guard that scans nothing and exits 0
commits the very fault it polices. It exits 2 when: the source roots are
missing; zero candidate `.ts`/`.tsx` files were scanned; the baseline is
missing, unparseable, or has an empty `sites` map; or the detector matched
**zero sites while the baseline lists hundreds** — which means the pattern
rotted, not that the codebase became clean. That last case is the one a naive
guard gets wrong, and it is covered by a self-test invariant.

`--self-test` proves 18 invariants against synthetic trees, including both the
violating and the clean shape, all five exit-2 paths, and the discriminations
below. It was run against a `git archive` of pristine `origin/main` and
**exited 1, naming exactly the 8 sites this branch fixes** — a guard nobody has
watched fail is not evidence of anything. `--root` exists so that check can be
repeated by anyone.

### Exceptions, and why the allowlist is nearly empty

`ALLOWLIST` in the guard takes a site key plus a **written justification**, in
the shape `check_proposal_preservation.py` already established. It ships
**empty**: every genuine exception found in the sweep was better expressed as
one of the two discriminations below, and an allowlist that is easy to reach
for becomes the disable switch. Adding a row is a deliberate, reviewable edit
to the guard's source that someone has to be willing to sign.

The two discriminations do the work an allowlist otherwise would:

- **A value refused the moment it arrives is not silent.** `const { data: user }
  = …; if (!user) throw new NotFoundException(…)` is still wrong — it reports a
  failed read as a missing row, a 404 for a 503 — but a human sees an error.
  Not flagged.
- **The fail-open shape still is.** `if (dupe) throw new ConflictException(…)`
  looks superficially identical and is the `providers.service.ts` bug: on a
  failed read it does **not** throw. Flagged. A self-test invariant pins both.

## Consequences

**Easier.** The 216th swallowed read cannot be merged. The burn-down has a
denominator that CI keeps honest, and the guard's failure text names the house
idiom (`logQueryFailure`, `advanced-analytics.service.ts:150`; the `allSettled`
variant, `insight-generator.service.ts:305-315`) so the fix does not have to be
rediscovered.

**Harder / given up.** 207 sites remain baselined — the guard makes them
visible and non-growing, not fixed. Two API responses changed shape:
`GET /pos-hub/status/:id` now carries `unavailable` with `totalChecks: null`,
and the member performance card's `analytic.median` / `analytic.band` are
nullable. Both render as an em dash per [0051](0051-rebuilt-pages-show-live-data-only.md);
a fix that turns a swallowed error into a displayed `0` has fixed nothing.
`vendor_catalogue` search now returns **503** where it used to return a wrong
list, which is a deliberate availability-for-correctness trade.

**Out of scope, deliberately** — named here rather than quietly dropped
(CLAUDE.md §0.5):

- **The refuse-on-falsy population** (37 sites at `origin/main`). Wrong, but
  loud. Fixing it is a separate operation with a separate blast radius on HTTP
  status codes.
- **Files owned by concurrent PRs**, skipped to avoid collisions and left in
  the baseline: `receiving.service.ts` and everything under receiving/receipts
  (#226, #228, #229), `toast.*` (#223), `communications` recurring-order
  reminders (#227), the orchestrator cross-runtime envelope (#218), mobile
  PulseStrip (#225). `receiving.service.ts:321-346` — the manager's
  money-recovery queue reading `totalAtRisk: 0` forever — is a §6 entry that
  this branch did **not** fix for that reason.
- **The bound-but-misused error.** `vendor-catalogue.service.ts` bound `error`
  and then did something worse with it than ignoring it. The guard cannot see
  that shape and does not claim to: binding the error is the line it draws.
  What a caller then does with it is a review question.
- **Writes.** This ADR is about reads. The write half is
  `pos-hub.fail-open.spec.ts` and its two merged fixes.

**Revisit when** any of these fires: the baseline stops shrinking for a
milestone (the ratchet has become wallpaper — escalate to option 5, the
`queryOrThrow` wrapper, which makes the defect unrepresentable); `ALLOWLIST`
reaches five entries (the discriminations are wrong, not the sites); or the
guard's exit-2 path fires in CI more than once (the detector is chasing a
moving target and should be replaced by a type-level rule).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created. Guard proven exit 1 against pristine `origin/main` (1f4717cc) at 8 sites, exit 0 after; `--self-test` 18 invariants pass; 11 behavioural tests, 8 of which fail pre-fix. |
