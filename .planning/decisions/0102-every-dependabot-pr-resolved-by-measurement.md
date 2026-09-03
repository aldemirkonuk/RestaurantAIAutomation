# 0102 — Resolve every Dependabot PR by measurement, and never by the PR's own diff

- **Status:** Proposed
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** dependabot, dependencies, pillow, surya-ocr, class-validator, framer-motion, zustand, pnpm, e2e-prod, supply-chain
- **Links:** [[0100-security-alerts-triaged-and-closed]], [[0087-phantom-dependency-pinned-real-one-unpinned]], [[0089-absence-reported-as-health]], PR for `chore/dependabot-backlog-resolved`

> **Number:** assigned **0102**, not 0101. `0101-the-audit-asks-for-the-build-the-merge-implies.md`
> is already claimed on a ref *and* in an unpushed peer worktree
> (`.claude/worktrees/heuristic-mclaren-649637`). Both sweeps were run before
> writing — `git for-each-ref` over every local and remote ref, and a
> `git worktree list` walk that reads each worktree's `.planning/decisions/`
> directly. This is the fourth consecutive ADR to hit the collision; the
> worktree sweep is the half that catches it.

## Context

ADR 0100 triaged 19 Dependabot PRs, closed 4, and left **15 open**: 8 it
recommended merging with evidence attached, and 7 it could not verify because
that worktree could not run an install. Fifteen open PRs is not a triage
outcome; it is a queue. This change resolves all fifteen.

0100 also left two methodology rules that this pass had to obey, and both
earned their keep here:

1. **Absence of a grep hit is not absence of a dependency** (0100 got `jspdf`
   and `prometheus-client` wrong before it got them right). Every package below
   was searched for dynamic `await import()`, lazy in-function imports, and
   multi-line guarded `try:` imports — not just top-level ones.
2. **A patched version is only patched against the CVE you looked up.** Every
   *target* version was re-queried against the GitHub Advisory DB
   (`GET /advisories?affects=<pkg>@<target>`), with a control query on the
   *current* version to prove the query was actually returning rows.

## Options considered

1. **Merge the 8 recommended, close the 7 unverifiable as "needs verification."**
   Cheap and dishonest: "needs verification" is the state they were already in,
   and it is the reason they had sat for up to five months. Rejected on the
   founder's explicit standard — an unverifiable major gets closed *saying so*,
   not deferred again.
2. **Merge each Dependabot PR in place, one at a time.** Eleven of the fifteen
   touch either `pnpm-lock.yaml` or `services/agent-orchestrator/requirements*.txt`,
   so each merge invalidates the rest and forces a Dependabot rebase. With
   `main` on `strict: true` and three-to-four concurrent sessions merging
   (see [[0091-merge-races-need-sequencing]]), fifteen sequential ~9-minute CI
   cycles is a starvation risk, not a plan.
3. **Verify each bump locally against the file that actually ships, apply the
   ones that pass in one branch, and close each Dependabot PR pointing at the
   commit that carries its exact change.** Chosen.

## Decision

All fifteen are resolved. **Three of the fifteen were wrong as authored**, and
merging any of the three would have broken something that CI or production
depends on.

### The count

| | Count |
|---|---|
| Open Dependabot PRs at start | **15** |
| Applied verbatim | **12** |
| Applied with a correction (PR as authored was broken) | **2** |
| Rejected, with the measured reason on the PR | **1** |
| Left open | **0** |

Fourteen are closed against a commit that carries their change; one (`#168`) is
closed against a reproduction of the failure it causes.

### The one that was rejected

**`#168` `@tanstack/react-query` 5.90.16 → 5.102.8 — rejected. It needs a
TypeScript upgrade this repo has deliberately pinned away from.**

Measured: with the bump applied and *every other bump still in place*,
`pnpm run type-check` — the exact command `ci.yml:829` runs — produces **14
`error TS7006: Parameter 'old' implicitly has an 'any' type`** across 7 files
(`GuidanceProvider.tsx:180`, `useNotificationQueries.ts:154`,
`useReportQueries.ts:61`, `useSommelierQueries.ts:103`,
`useStorageLocations.ts:141,154`, `useTemplates.ts:110,111,142`,
`useUserPreferences.ts:124`). Pinning react-query back to 5.90.16 and changing
nothing else takes that to **0**, so the attribution is unambiguous.

The cause is not the call sites, and it is not `setQueryData`'s signature —
that declaration is **byte-identical** between the two versions. It is one
missing line:

```
5.90.16  build/modern/*.d.ts:  type NoInfer<T> = [T][T extends any ? 0 : never];   (1 file declares it)
5.102.8  build/modern/*.d.ts:  — none —                                            (0 files declare it)
```

5.102.8 dropped its shim and relies on **TypeScript's built-in `NoInfer`, added
in TS 5.4**. This monorepo forces **TypeScript 5.3.3 repo-wide** through
`pnpm.overrides` (`package.json:68`) — which does not have it:

```
$ tsc --version                       Version 5.3.3
$ tsc --noEmit --strict probe.ts      error TS2304: Cannot find name 'NoInfer'.
```

`apps/web/tsconfig.json:7` sets `skipLibCheck: true`, so that TS2304 never
surfaces; the type silently degrades and the failure lands on our callbacks
instead. That is why this reads as fourteen call-site errors when it is really
one unmet compiler requirement.

Unblocking it means moving off the pinned TypeScript 5.3.3 — a repo-wide
override that `apps/api-gateway` (which asks for `~5.7.0`) is already living
under. That is a founder decision about the toolchain, not a dependency bump,
and it is **not** taken here. The bump itself is a minor within v5 carrying
**zero** advisories, so nothing is at risk by waiting.

### The two that were wrong as authored

**`#89` pillow 10.2.0 → 12.3.0 — applied to `requirements.prod.txt` only.**
The PR changes both requirements files. `requirements.txt` **cannot take it**:

```
pip install -r requirements.txt   (pillow==12.3.0)
  surya-ocr 0.6.0 depends on pillow<11.0.0 and >=10.2.0
  ERROR: ResolutionImpossible
```

`surya-ocr` declares `pillow (>=10.2.0,<11.0.0)` at **every** published version
— measured on the resolved 0.17.1, not assumed — so pip backtracks to
surya-ocr 0.6.0 and gives up. CI's `test-python` job runs
`pip install -r requirements.txt` (`ci.yml:1060`), so merging #89 as authored
turns that required context red.

The bump is still worth having where it counts: `Dockerfile:25-26` installs
`requirements.prod.txt`, which has **no** surya-ocr. That file now carries
`pillow==12.3.0`, closing the ten open Pillow advisories against 10.2.0
(GHSA-9hw9-ch79-4vh6 and friends, seven of them `high`) in the container that
actually ships. Both files carry a comment saying the divergence is deliberate
and naming the constraint that causes it, so the next reader does not "fix" it.

**`#2` pnpm/action-setup 2 → 6 — applied, plus the `version:` input removed.**
Bumping the action alone would have swapped one failure for another.
`e2e-prod.yml:93-96` passes `version: '8'`, and from v4 onward the action reads
`packageManager` from `package.json` and **throws** when both are present —
verified in the v6 source, not inferred from docs:

> `src/install-pnpm/run.ts` — `if (version) { if (packageManagerVersion && packageManagerVersion !== version) throw new Error("Multiple versions of pnpm specified: …") }`

**This uncovered a live outage that no Dependabot PR was about.** The root
`package.json` declares `engines.pnpm: ">=9.0.0"`, so the pnpm 8 that
`version: '8'` pins cannot install this repo at all. Reproduced locally against
a copy of the manifests, then confirmed against the real runner log for the
2026-09-02 nightly:

```
ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment
Expected version: >=9.0.0
Got: 8.15.9
```

Step 7 "Install frontend dependencies" **failed on every nightly run from
2026-08-26 to 2026-09-02** — eight consecutive nights, the full sample
available — and every one of the seven waves after it was `skipped`. Step 19,
**"Check for test failures", reported `success` on each of those runs.** The
entire production E2E suite has been reporting health from having run nothing.
That is [[0089-absence-reported-as-health]] verbatim, in the one place that was
supposed to catch a bad deploy — including the deploys this very change makes.

### What was measured, per package

Clean-environment bar per [[0087-phantom-dependency-pinned-real-one-unpinned]]:
install exit 0, the import resolving to the expected distribution and version,
`pip check` clean.

**Production Python — `requirements.prod.txt`, fresh venv, Python 3.11 (matches
`Dockerfile:5` and `ci.yml:19`):**

```
pip install -r requirements.prod.txt   exit 0
pip check                              No broken requirements found.
pillow             -> 12.3.0    prometheus-client -> 0.25.0    sqlalchemy -> 2.0.49
```

Then the API surface the repo actually calls, exercised in that venv rather
than read off a changelog — `Image.new`, `Image.open`, `.resize(Image.LANCZOS)`,
`.convert`, `ImageEnhance.Contrast` all work; `Image.ANTIALIAS` is gone but is
used **nowhere** in this repo (`grep` over all `*.py`: 19 `Image.open`, 5
`.resize(`, 3 `Image.LANCZOS`, 1 `ImageEnhance.Contrast`, 1 `Image.new`, zero
`ANTIALIAS`, zero `textsize`). All seven names
`core/observability.py:37-44` imports from `prometheus_client` import, and
`generate_latest` emits 22 sample lines from a live registry.
`core.observability` imports in that venv with `PROMETHEUS_AVAILABLE = True`.

`CONTENT_TYPE_LATEST` does change value in 0.25 (`version=1.0.0`, was
`0.0.4`), but it is only ever returned as a response header
(`observability.py:243`) and nothing in the repo asserts on it.

**Dev/CI Python — `requirements.txt` at the merged end state, fresh venv:**

```
pip install -r requirements.txt        exit 0
pip check                              No broken requirements found.
sentence-transformers 5.5.0   pytest-cov 7.1.0   pytest-mock 3.15.1
sqlalchemy 2.0.49             prometheus-client 0.25.0
pytest tests/ --cov=. --cov-report=xml
  1225 passed, 54 skipped in 118.93s     Coverage XML written to file coverage.xml
```

The coverage XML is the point of the pytest-cov line: 7.1.0 still honours the
exact `--cov=. --cov-report=xml` invocation `ci.yml:1064` uses.

**JavaScript — merged end state, `pnpm install` then the CI commands.** The
five bumps taken are `framer-motion` 10/11 → 13.2.0, `zustand` 4.5.7 → 5.0.15,
`class-validator` 0.14.3 → 0.15.1, `jspdf` 4.0.0 → 4.2.1 and
`@types/google.maps` 3.64 → 3.66.1:

| | control (`origin/main`, clean worktree) | with the five bumps taken |
|---|---|---|
| `pnpm run build` | 4/4 tasks | **4/4 tasks** |
| `pnpm run type-check` (`ci.yml:829`) | 4/4 tasks, **0** `error TS` | **4/4 tasks, 0 `error TS`** |
| api-gateway jest | 2128 passed, 14 skipped, 162 suites | **2128 passed, 14 skipped, 162 suites** |
| web vitest | 681 passed, 77 files | **681 passed, 77 files** |
| mobile jest | — | **227 passed, 10 suites** |

The control is a second worktree checked out at `origin/main` and installed
`--frozen-lockfile`, not a remembered number. It matters here: `apps/web`'s
`test` script is bare `vitest`, which without `CI=true` starts a **watch** that
never exits — a first attempt at this table sat for thirty minutes producing
nothing and looking like a slow test suite. Every run above sets `CI=true`, the
way the runner does.

**Two findings the tests alone would not have surfaced.**

`class-validator` 0.15.1 raises a real peer warning:
`@nestjs/mapped-types@2.0.5` (transitive, via `@nestjs/swagger@7.4.2`) declares
`class-validator@"^0.13.0 || ^0.14.0"`. Two things make it inert here rather
than a blocker: this repo uses **zero** mapped-types helpers (`PartialType`,
`PickType`, `OmitType`, `IntersectionType` appear in 0 files under
`apps/api-gateway/src`), so the code path that reads class-validator's metadata
storage is never entered; and `@nestjs/mapped-types@2.1.1` already widens that
peer to `^0.15.0`, so upstream considers the pair compatible. The warning is a
stale range on the version `@nestjs/swagger` pins, not a signal about 0.15.

`framer-motion` 13's only documented breaking change is that **13.0 drops
`@emotion/is-prop-valid`** as an optional dependency. No package manifest in
this repo depends on `emotion` or `styled-components` — the 0.8.8 copy in the
lockfile is framer-motion 11's own optional peer — and there is no
`MotionConfig`/`isValidProp` call site. The imported surface is only `motion`
(123 sites), `AnimatePresence` (87) and `Reorder` (5), all of which survive
10 → 13.

`zustand` 5: all 11 call sites (8 web, 3 mobile) are `import { create } from 'zustand'` plus
`zustand/middleware`, none passes the removed `equalityFn` second argument, and
neither app uses the removed default export. 0100 established this statically;
this change adds the runtime half it was missing (web build + web tests +
mobile typecheck).

### Advisory re-check on the target versions

Zero open advisories against **every** target version — `pillow@12.3.0`,
`scikit-learn@1.5.0`, `sentence-transformers@5.5.0`, `sqlalchemy@2.0.49`,
`prometheus-client@0.25.0`, `python-dotenv@1.2.2`, `pytest-cov@7.1.0`,
`pytest-mock@3.15.1`, `framer-motion@13.1.1`, `zustand@5.0.15`,
`class-validator@0.15.1`, `jspdf@4.2.1`, and `@tanstack/react-query@5.102.8`
(checked even though it is rejected — the rejection is a typing cost, not a
security one, and that distinction only holds if the check was actually run).

The query was proved live rather than assumed, by running it against the
*current* pins: `scikit-learn@1.4.0` returns GHSA-jw8x-6495-233v,
`pillow@10.2.0` returns ten, `jspdf@4.0.0` returns nine including the critical
GHSA-wfv2-pwc8-crg5 (HTML injection). An empty result set from a query that
returns nothing for everything proves nothing; these do not.

`jspdf` earns its merge on that alone, and it is genuinely reachable: both call
sites are `await import('jspdf')` (`tableExport.ts:215`,
`exportHelpers.ts:45`), which is exactly the dynamic shape 0100's first pass
missed, and the build emits a 390 kB `jspdf.es.min-*.js` chunk.

### Three of the fifteen change nothing that runs

Recorded because "merged" should not imply "effective":

- **`#6` sqlalchemy 2.0.25 → 2.0.49.** `sqlalchemy` is pinned in both
  requirements files and **imported by nothing** — zero hits for `sqlalchemy`,
  `create_engine`, `declarative_base` or `sessionmaker` across every `*.py` in
  the repo. Same shape as the `python-jose` phantom 0087 deleted.
- **`#8` pytest-mock 3.12.0 → 3.15.1.** Zero uses of the `mocker` fixture and
  zero `pytest_mock` imports anywhere.
- **`#87` python-dotenv and `#88` scikit-learn**, both in
  `services/self-evolution/requirements.txt`. That service is one 561-line
  `main.py` and a requirements file. It imports **neither** package (its only
  imports are fastapi, pydantic, a lazy `supabase`, and uvicorn), it has no
  Dockerfile, no `docker-compose.yml` entry, and no workflow installs its
  requirements — CI installs only `services/agent-orchestrator/requirements.txt`
  (`ci.yml:940`, `ci.yml:1060`). Both bumps are inert text edits.

They are applied anyway because the cost is zero and each clears a real
advisory row. Whether `services/self-evolution` should exist at all is a
separate question and is **not** decided here.

## Consequences

- Easier: the Dependabot queue is empty, and the production E2E suite can
  actually run for the first time since at least 2026-08-26.
- Harder: `pillow` now differs deliberately between the two requirements files
  (12.3.0 prod, 10.2.0 dev/CI). Tests that touch PIL — `tests/test_yolo_preview.py`
  — therefore run against 10.2.0 while production runs 12.3.0. Every PIL API
  this repo calls was exercised under 12.3.0 by hand, but that is a one-time
  measurement, not a standing gate.
- Given up: **no visual verification of framer-motion 10 → 13.** Build,
  typecheck and 681 web tests pass, but three majors of animation behaviour
  across 122 files cannot be proved by a test run. Motion 11's velocity and
  mount-render-timing changes are behavioural, not type errors. This is stated
  rather than implied by silence.
- Given up: `e2e-prod.yml` and `deploy.yml` at `pnpm/action-setup@v6` are not
  exercised by a pull-request CI run. `ci.yml` at v6 *is* — the five setup steps
  in the required contexts run from this branch's own workflow file — and the
  fixed `e2e-prod.yml` is verified separately by a `workflow_dispatch` against
  this branch.
- Revisit when: `surya-ocr` lifts its `pillow<11` cap (the two requirements
  files can converge again), or when `@nestjs/swagger` moves off
  `@nestjs/mapped-types@2.0.5` (the class-validator peer warning disappears).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-03 | — | Created |
