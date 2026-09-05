# 0127 — A house sees one arm, and the arm it saw is written down

- **Status:** Locked — the founder set the ratio on 2026-09-05, in session; both
  open questions answered the same day (batch 45) and built — see the addendum
- **Date:** 2026-09-05
- **Decider:** Aldemir (founder)
- **Keywords:** experiment, arm, assignment, ratio, hash, deterministic, per house, exposure, outcome, neural footprint, ux-optimizer, one-tap, note, die, seal, gesture, counts, verdict
- **Links:** [[0083-a-page-may-not-claim-a-write-it-never-makes]],
  [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]] (its
  2026-09-05 status line), [[0020-no-fabricated-answers]],
  `.planning/06-pages/dashboard.md` §1a/§9/§13,
  `apps/api-gateway/src/ux-optimizer/experiments.ts`,
  `supabase/migrations/20260905220000_a_house_sees_one_arm_of_an_experiment.sql`;
  addendum (2026-09-05, batch 45): [[0099-vendor-email-had-no-caller-identity]],
  `supabase/migrations/20260905235500_an_experiment_ends_on_a_derived_date.sql`,
  `apps/api-gateway/src/ux-optimizer/ux-optimizer.admin-routes.spec.ts`

## Context

On 2026-09-05 the one-tap desk's first real action landed (commit `be80f8b5`).
Part of that pass rationed the wax: **confirming a delivery** keeps the
hold-to-approve die because it books stock through a redeemed seal, and **a
hand-written note** was given a plain button, on the argument that a die meaning
"recorded" beside a die meaning "done" teaches people the seal means nothing.

Asked whether the note keeps the plain button or gets the die back, the founder
said, verbatim:

> lets try both, 80 percent simple 20 percent signature

That is not a flag flip. It is a request to run the product both ways and count
— which this codebase could not do.

### What was measured before anything was written

Two mechanisms already exist that look like they could carry it. Neither can.

1. **`restaurant_feature_flags`** (`apps/api-gateway/src/settings/feature-flag-registry.ts:54`)
   is a per-house **boolean a person sets by hand**. No ratio, no second arm, no
   assignment. Putting twenty per cent of houses on a variant would mean somebody
   choosing which twenty per cent — a decision dressed as a sample.
2. **`ux_overrides.rollout_pct` + `UxOptimizerService.rolloutBucket(userId)`**
   (`ux-optimizer.service.ts:597,616` before this change) is closer and wrong on
   four counts:
   - it buckets on the **user**, not the house, and the founder's unit is the house;
   - it compares one variant to *the product as built*, not two named arms;
   - it **records the assignment nowhere**, so a later edit to the percentage
     silently re-labels every outcome already collected;
   - the whole path returns `{ enabled: false, overrides: [] }` unless
     `UX_OPTIMIZER_ENABLED === "true"`, which defaults to `"false"` (`:78`).

So the ux-optimizer has an **override gate and no assignment store**. Two further
measurements shaped what follows:

3. **The client friction reporter is dark and has no callers.** `VITE_UX_OPTIMIZER`
   gates `apps/web/src/lib/uxSignals.ts:15`, and its only importer
   (`hooks/useUxOverrides.ts:19`) is imported by no page — `dashboard.md` §5 says
   "None". Routing exposures through `ux_signals` would have been routing them
   through a pipe with no water in it.
4. **`neural_footprint_event` already has the right shape and the right subject
   kind.** It is stimulus → internal state → choice → outcome, its
   `subject_type` check already admits `'operator'` ("staff/owner product actions
   ride this same spine, so page analytics is NF rather than a second store" —
   `20260824141116_neural_footprint_event.sql:21`), and its `outcome` column
   documents NULL as UNKNOWN and never success (`:32`). Measured: **no code
   writes an `operator` row today** — the model client is the only writer and it
   writes `subject_type: "agent"` (`model-client.service.ts:429`). This is the
   first use of the kind the column was reserved for.

## Options considered

### On the assignment mechanism

1. **A per-house feature flag somebody sets by hand.** Cheapest; reuses a table
   and a registry that exist. Rejected: it cannot produce a ratio, only a
   selection, and a selection made by the person who wants an answer is not a
   sample. It also has no place to record *when* a house joined, so the
   denominator would be unknowable.
2. **Reuse `rolloutBucket(userId)` and a `ux_override`.** Reuses the whole
   gated-rollout path. Rejected on the four counts above; the fatal one is that
   it is one arm against the baseline, so "die completes more than plain" is not
   a question it can be asked.
3. **A hash, and no table at all.** The arm is a pure function of
   `(experiment_key, restaurant_id)`, so storage looks redundant. **Rejected, and
   this is the load-bearing rejection.** The ratio is a constant in a source
   file, and a constant can be edited. The moment it is, a recompute moves houses
   between arms and every exposure already in the ledger is attributed to an arm
   that house was never shown — every individual row still correct, the whole
   comparison wrong, and nothing anywhere reporting a problem. That is the
   [[absence-reported-as-health]] shape in a new coat: the system re-derives its
   own history and serves the derivation as the record.
4. **A hash plus a frozen row (chosen).** The hash chooses; the row is what the
   house is *on*, and it carries the `bucket` and the `ratio` in force at
   assignment, so the assignment stays auditable against the source file instead
   of trusting it.

### On the hash

5. **The polynomial `h * 31 + charCode` that `rolloutBucket` uses.** Rejected:
   restaurant ids are UUIDs, which share a fixed layout and a version nibble, and
   defending a homebrew hash's uniformity over structured input is work nobody
   should have to do in order to trust a ratio. `sha256("<key>:<rid>")`'s first
   four bytes mod 100 needs no defence. Measured over 10,000 v4-shaped ids
   (`ts-node` over the shipped module, 2026-09-05): **2,054 land in the die arm
   — 20.54%** against a stated 20. `experiments.spec.ts` pins the band at
   18–22% rather than the exact figure, so a hash change is caught and a
   sampling wobble is not.

### On where the counts are read

6. **`/notifications`.** Rejected on the repository's own argument. The day-book
   is a RECORD — lines the house wrote, worked downwards until the account is
   ruled off — and that is precisely why the one-tap desk was moved *off* it on
   2026-09-03 (`notifications.md` §1b). A running tally is not a line the house
   wrote either.
7. **Inside the one-tap panel's own footer.** Rejected: it puts the count
   directly under the card being counted, where it is most likely to change the
   behaviour it measures.
8. **The dashboard's own signature footer (chosen).** On the page that holds the
   control, at its foot, away from the card.

### On what an "outcome" is

9. **Time from press to completion.** Rejected: pressing a button completes in
   ~0ms and holding the die completes in `pour.ms`'s 620 **by construction**, so
   that figure would measure a constant this repository chose rather than an
   operator. Time-to-complete is recorded from **exposure**, on the ledger's own
   `duration_ms`.
10. **Counting the die's early releases.** Rejected: a plain button has no
    partial gesture to release, so the plain arm would report zero for a reason
    that is a property of the control, and any comparison would read that zero as
    a fact about people. There is no field for it on the event at all.

## Decision

**An experiment assigns one arm per HOUSE, deterministically, and freezes what it
assigned; every exposure and outcome is written to the Neural Footprint ledger
with the arm stamped by the server; and nothing is ever applied — a person reads
the counts.**

Concretely, and locked:

- **D1. `note_close_control`, arms `plain` 80 / `die` 20.** Declared in
  `apps/api-gateway/src/ux-optimizer/experiments.ts` with the founder's words
  beside the numbers. The percentages must sum to 100 or the process fails at
  module load (`assertRatioIsWhole`), because a short ratio leaves a slice of
  houses in no arm and therefore silently unmeasured.
- **D2. The arm is `sha256("<experiment_key>:<restaurant_id>")`'s first four
  bytes mod 100**, laid against the arms' cumulative percentages in declared
  order. A caller with no restaurant gets bucket `-1` and NO arm — outside every
  arm rather than inside the biggest one, so an unidentifiable caller fails to
  "no assignment" and not to "counted as plain".
- **D3. The first arm declared is the fallback, and it must be the product as
  built.** `plain` is first. An unreadable experiment therefore falls back to
  what the house would have seen anyway, never to the variant.
- **D4. The stored row wins over the recomputed hash.** `ux_experiment_assignments`
  is `(restaurant_id, experiment_key)` primary key — the key *is* the rule that a
  house cannot be counted in two arms — plus `arm`, `bucket`, `ratio` and
  `assigned_at`. Editing the constant cannot re-label an exposure already
  recorded.
- **D5. A failed read is never an absent assignment.** `readAssignment` throws on
  `error` rather than resolving null; supabase-js resolves `{ data, error }`, so
  treating an error as "no row" would re-assign on every failure and scatter one
  house across both arms. Reading the report does **not** assign: looking at
  counts must not enrol a house.
- **D6. The server stamps the arm.** The event body carries only the event, the
  action id and a duration. A browser that could name its own arm could file its
  outcome against the other one — the same rule `reviewProposal` already keeps
  for the reviewer id.
- **D7. Three events, both arms, or none.** `exposed`, `completed`, `abandoned`.
  `outcome` is `'success'` only on a completion; an abandon is NULL, because a
  person who walks away from a note may have changed their mind, which is a
  correct refusal and not a defeat by the control. An event only one arm could
  produce is not recorded at all (D10 above).
- **D8. When the arm cannot be read, NOTHING is recorded.** The card shows the
  plain fallback and says it is a fallback; the server would stamp this house's
  *stored* arm, which may be the die, and filing a plain exposure under the die
  is worse than not counting it.
- **D9. The die on a note is a GESTURE, not a seal, and the card says so.** No
  `onChallenge` is passed, nothing is minted, nothing is redeemed. ADR 0116's
  addendum made an order approval a REDEEMED seal; a wax impression that looked
  identical on a row that only records a decision would empty the word. The
  original objection is not withdrawn — it is what the experiment is for.
- **D10. Counts, never a verdict.** The report line prints integers and the ratio
  and nothing else. The optimizer may one day REPORT which arm completes more; it
  may not act on it, and this experiment is deliberately outside
  `UX_OPTIMIZER_ENABLED` — a measurement that stops recording when a flag is off
  leaves a gap in the ledger that reads exactly like a period of nobody using the
  control.

## Consequences

### What becomes easier

- A question about the interface can be answered by running it both ways instead
  of by arguing. The mechanism is one spec object and one route away for the next
  one.
- The Neural Footprint ledger gets its first `operator` rows, which is the kind
  the column was reserved for on 2026-08-24 and had no writer until now.
- `check_read_columns_exist.py` now resolves a PostgREST JSON-path filter to its
  base column instead of counting it unreadable, so `.eq("context->>arm", …)` is
  CHECKED rather than shelved under a ceiling. That is a strengthening: the guard
  looks at three reads it previously did not.

### What becomes harder, or is given up

- **The report cannot answer the founder's question.** This is the honest cost
  and it is stated where it bites. Every read on this controller is scoped to the
  caller's restaurant, and assignment is per house, so **a house is on exactly
  one arm and the report can only ever show that arm's figures**. The cross-arm
  comparison the ratio exists to settle is a cross-tenant read, and no role in
  this codebase grants one. See the open question below. Printing `plain: 0`
  beside a die house's real numbers was refused: it would read as a verdict
  against an arm nobody here was shown.
- **The abandon count is a FLOOR.** An abandon is recorded when the card is left
  while still open; a browser tab closed outright records nothing, because the
  web app may not reach the gateway with a keepalive `fetch`
  (`apps/web/src/__tests__/no-raw-gateway-fetch.test.ts` — an allowlist entry
  would be needed, and that file is not this change's to edit). Both arms lose
  exactly the same cases, so the comparison holds and the absolute number does
  not. Every count is also a floor for D8's reason.
- **Two dies now sit on one screen and look the same at rest.** Measured in the
  captures (`$SP/shots-note-experiment/panel-die-*.png`): the delivery card's
  sealed hold and the note's gesture hold are visually identical until they are
  held, and only the sentence above each tells them apart. That is the founder's
  original objection, now visible; it is precisely the thing the counts are being
  gathered to settle, and it is the strongest argument for ending the experiment
  on the plain arm.
- Twenty per cent of houses, chosen by a hash, get an interface the other eighty
  do not. With a small number of houses that slice may be empty or may be one
  house — a ratio is not a guarantee (see below).

### What would trigger revisiting this

- **The counts becoming readable across arms.** Either a founder-scoped read, or
  a decision to serve cross-house aggregates. Until one of those, the ratio is
  being honoured but not being learned from.
- **The die arm landing on nobody, or on everybody who matters.** Measured
  2026-09-05: the one house the local gateway reaches
  (`550e8400-e29b-41d4-a716-446655440000`) hashes to bucket **99 — the die arm**.
  Production held ten restaurants and one real tenant at the last count; a 20%
  per-house split over that population is a coin flip about whether the die arm
  contains any real traffic at all.
- **The experiment ending.** When a person reads the counts and decides, the arm
  becomes the product and this spec is deleted, not left running.

## How it was proven

**Counts are from runs made on this tree, with the command named.** Nothing here
is quoted from another session.

- `jest src/ux-optimizer src/one-tap-actions` (from `apps/api-gateway`) —
  **90 passed / 6 suites**, of which 36 in the two new suites
  (`experiments.spec.ts` 18, `ux-optimizer.experiments.spec.ts` 18).
- `vitest run src/pages/dashboard/next` (from `apps/web`) — **59 passed /
  3 files**, of which 29 in `note-close-experiment.test.tsx`.
- `tsc --noEmit` — web clean; gateway `tsconfig.json` clean; gateway
  `tsconfig.spec.json` leaves **one** error, `src/team/notes.service.spec.ts:54`,
  which is another builder's file in the shared worktree and predates this pass.
- **The migration was applied to a real Postgres.** Docker is down, so the
  harness is PGlite (`$SP/pglite-probe/p4aw-experiment-assignments.mjs`):
  **10 passed / 0 failed** — the file applies, applies twice, accepts a real
  assignment, refuses a second arm for the same house (`23505` on the primary
  key) and a bucket of 100 (the CHECK), and **every in-file `DO $$` assertion was
  proven to FIRE** against a copy with exactly one thing broken (RLS removed,
  a client grant added, the primary key widened to include `arm`, the tenancy
  parent removed, the bucket range removed).
- **Pre-fix probes, run then deleted** (`git show HEAD:` into a same-depth file;
  no git state was changed). Web: **12 of 15** cases fail against the pre-fix
  `OneTapPanel`. The 3 that pass are the ones that should — "draws the plain
  button", "records nothing when the arm could not be read" and "records nothing
  for a delivery card" all describe behaviour this change preserves. Gateway:
  **18 of 18** fail, because the methods do not exist there; that is a weaker
  proof and is labelled as one.
- **Guards** (from the worktree root): `check_no_seeded_defaults`,
  `check_read_columns_exist` (+ `--self-test`), `check_queried_tables_exist`,
  `check_order_capture_contract`, `check_new_tables_are_locked_down`,
  `check_fk_targets_exist`, `check_flag_readby_anchors`,
  `check_adr_numbers_unique`, `check_a_count_is_recorded` — all **exit 0**.
  `bash scripts/check_gateway_boots.sh` — **PASS**. Migration prefix uniqueness
  (`ls supabase/migrations | cut -c1-14 | sort | uniq -d`) — empty.
- **Two guards are RED in the shared worktree and neither is this pass's.**
  `check_read_errors_not_swallowed` names
  `apps/api-gateway/src/procurement/procurement.service.ts:5875`;
  `check_decision_claims.sh` reports 226 checked / 223 holding, all three
  regressions on `merge_library_wines` (ADR-0076, OD-119). Both were proven
  pre-existing by running the guards over a `git archive HEAD` export into
  `$SP/p4aw-head` and then re-running them with only this pass's files copied in.
  That same method found the one guard this pass DID break — see below.
- **`eslint --quiet` was NOT run.** It cannot run anywhere in this checkout:
  `eslint-plugin-jsx-a11y` is referenced from `.eslintrc.cjs` and is not
  installed. Stated rather than skipped.
- **Live, read-only, against `127.0.0.1:4000` (production Supabase).** All three
  routes answer **401** unauthenticated and **404** on the wrong verb, so they
  exist and are class-guarded before any write.
  `GET /ux/experiments/note_close_control/report` authenticated answers **500 —
  "Could not find the table 'public.ux_experiment_assignments' in the schema
  cache"**: the migration is unapplied there, and the read fails AS A FAILURE
  rather than as an empty report, which is the rule this ADR turns on. **No
  production write was made and no assignment was created** — the assignment
  route was exercised unauthenticated only.
- **Captures**, both arms on both grounds, into `$SP/shots-note-experiment/`
  (`shoot-note-experiment.mjs`): real bundle, real components, real Mudavym
  tokens off `:5274`; **stubbed data**, because the tenant holds zero one-tap
  actions and the assignments table does not exist in production. Verified per
  shot that the assigned arm is drawn and the other is absent
  (`this arm drawn: 1 | other arm drawn: 0` in all four).

### A guard was strengthened rather than ceilinged

`check_read_columns_exist.py` counted this pass's three
`.eq("context->>experiment_key", …)` / `.eq("context->>arm", …)` filters as
UNREADABLE and went from 2 to 5, over its ceiling of 2. Raising the ceiling was
the invited fix and was refused: the guard exists so that a filter naming a
column no migration declares is caught, and a JSON path's BASE column is exactly
the half that raises 42703 and kills the whole query. It now resolves
`col->>key` to `col` and checks it — three reads it previously shelved are now
checked. Two self-test cases were added and **both fail against the un-fixed
guard** (measured by copying the pre-fix guard into `scripts/` under a throwaway
name, running `--self-test`, and deleting it).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-05 | Aldemir (founder) | "lets try both, 80 percent simple 20 percent signature" — ratio locked |
| 2026-09-05 | — | Created. Two open questions carried to the founder: who may read both arms, and what ends the experiment. |
| 2026-09-05 | Aldemir (founder), batch 45 | BOTH open questions answered and locked: the founder alone reads both arms' figures, and the experiment ends one quarter after its first exposure. Built the same day — see the addendum. |

## Open questions — the founder's, not an agent's

~~1. **Who may read both arms?**~~ **ANSWERED 2026-09-05 (batch 45): the founder
   alone.** Shape (a) — a founder-scoped read. Built without inventing a role;
   see the addendum for why the role was the wrong unit and what was used
   instead. `dashboard.md` §13.17.

~~2. **What ends the experiment?**~~ **ANSWERED 2026-09-05 (batch 45): a DATE —
   one quarter after the first exposure — and then the arm the founder names.**
   `dashboard.md` §13.18. One clause of the question was answered differently
   from how it was asked: `NOTE_CLOSE_CONTROL` is NOT deleted when the winner is
   named. See the addendum.

---

## Addendum — 2026-09-05 (batch 45): the founder reads both arms, and the experiment ends on a derived date

### The decision

Both open questions above were put to the founder the day they were filed. The
answers, as they reached this pass through the batch brief:

> the founder alone may read BOTH arms' figures, and the experiment ends one
> quarter after its first exposure

**A note on the quotation.** ADR 0127's body quotes the founder verbatim
("lets try both, 80 percent simple 20 percent signature") because that sentence
was carried into the session. No verbatim sentence was carried for batch 45, so
none is invented here: the block above is the decision as it was stated to this
pass, not a transcript, and it is marked as such rather than dressed as one.
`ExperimentSpec.founderWords` therefore still holds the ratio sentence and is
unchanged; the winner act carries its own `words` field for the founder to fill
when the arm is named.

### What was built

**D11. Both arms are readable, by the platform-admin service key, and never with
a house's identity beside an arm.** `GET /ux/experiments/:key/both-arms` returns,
per declared arm: `housesAssigned`, `exposures`, `completed`, `abandoned`,
`firstExposureAt` and the arm's declared `sharePct`; plus the window
(`firstExposureAt`, `quarterDays`, `endsAt`, `started`, `running`, `ended`) and
the winner (`winnerArm`, `winnerNamedAt`, `winnerWords`,
`endedWithNoWinnerNamed`). Every house figure is a `head: true` count, so no row
is ever selected on that path and there is no shape in which a restaurant id can
appear — which is the property that made granting a cross-house read defensible
at all, and it is asserted in the tests rather than described. `GET
/ux/experiments/:key/report` is untouched: still tenant-scoped, still one arm.

**D12. The gate is the credential, not a role.** `@Public()` +
`@UseGuards(ServiceKeyGuard)` — the `X-Admin-Key` / `ADMIN_API_KEY` service
credential ADR 0099 settled, which fails closed when the secret is unset. It is
the same shape `POST /communications/email` already uses, and `@Public()` there
does not mean unauthenticated: Nest requires every class and method guard to
pass, so `@Public()` only short-circuits the class-level `JwtAuthGuard` and lets
the method guard decide.

**D13. The experiment ends one quarter after its FIRST EXPOSURE, and the date is
derived and then frozen.** `EXPERIMENT_QUARTER_DAYS = 91`; the earliest exposure
across all houses plus that interval is written once to `ux_experiment_state`
(migration `20260905235500`) and never recomputed. After `ends_at`: no event is
recorded, no house is enrolled, and the assignment rows are kept as history.

**D14. The winner is named, once, by the same admin credential.** `POST
/ux/experiments/:key/winner` refuses an undeclared arm (400), an experiment that
has not started or has not ended (409, with the end date in the sentence), and a
second different arm (409). Naming the same arm again is idempotent. Once named,
`GET /ux/experiments/:key` returns that arm to EVERY house, with `armSource:
"winner"`, while `assignedArm` still carries what that house was actually shown.

**D15. There is no default winner, in code or in schema.** Until an arm is named,
an ended experiment reports `winnerArm: null` and `endedWithNoWinnerNamed: true`,
and the dashboard footer says *"This experiment has ended. No winner is recorded,
and none is assumed until the founder names one."* The first declared arm is a
RENDERING fallback (D3) and is never promoted to a result: a house that first
appears after the end is served it with `armSource: "fallback"` so the payload
cannot be misread, and a house that was assigned keeps its own arm.

**D16. A failed read of the experiment's state is a failure with its reason.**
`readExperimentState` throws; it never resolves null on error. Null means "asked,
and this experiment has not started". This is D5's rule applied to the second
table, and it matters more here than there: an error folded into null would make
an ENDED experiment look like a running one and quietly resume recording after
the founder ended it.

### The arithmetic of "one quarter", written out

91 days = 13 × 7, i.e. thirteen whole weeks.

- A **calendar quarter** is 90, 91 or 92 days depending which one it is, and the
  mean Gregorian quarter is 365.2425 / 4 = **91.31 days**. So 91 is within a day
  of every honest reading of the word.
- **Thirteen WHOLE WEEKS is why 91 and not 90 or 92**, and the reason is about
  restaurants rather than calendars: covers are strongly weekly-periodic, so a
  window that is not a whole number of weeks gives one weekday an extra turn and
  puts whichever weekday that happens to be into the answer. A 90-day window
  starting on a Saturday contains one more Saturday than Friday; the completion
  rate of a control would then carry a term nobody chose.
- **A calendar-month interval (`+ 3 months`) was rejected** for the same reason
  and one more: it is 89 to 92 days depending on the start date, so two
  experiments begun a fortnight apart would run for measurably different lengths
  and nothing on either report would say so.
- **Days, not months, also survive a leap year** — the interval is a fixed count
  of days on both sides of 29 February, pinned in `experiments.spec.ts`.

### Options considered

#### On who may read both arms

11. **A k-anonymity floor** — serve cross-house aggregates to any authenticated
    caller once at least *k* houses are in each arm. Rejected, and it was the
    hardest of the three to reject because it is the principled answer in
    general. Over this population it is not: production held ten restaurants and
    one real tenant at the last count, so any *k* worth the name would return
    nothing for months, and the report would spend the entire experiment saying
    "not enough houses" — withholding exactly the thing that was asked for while
    appearing to work. It also fails the founder's sentence directly: the founder
    would be one reader among all of them.
12. **Cross-house aggregates to any authenticated caller.** Rejected on the same
    population fact from the other side: with roughly one real tenant, "aggregate
    counts" is close to serving that tenant's own numbers to everybody.
13. **Invent a `platform_admin` role on the JWT.** This was the shape ADR 0127
    itself predicted ("inventing the first cross-house role in this codebase"),
    and it is the one that was rejected on execution. `role` is per-restaurant
    (`jwt.strategy.ts:56`) and every consumer of it — `RolesGuard`, the web's
    `ProtectedRoute`, the `team_access` CHECK constraint
    (`20260902200000_team_access_role_is_a_known_role.sql:63`), the
    `organization_members` CHECK in the baseline — reads it as a role *within* a
    house. Adding a fourth value would either widen those constraints (a
    migration touching tenancy, for one report) or introduce a second role axis
    that only one route reads. Both are a permission system arriving as a side
    effect of a measurement, which is how permission systems get built badly.
14. **The `X-Admin-Key` service credential (chosen).** It already exists, it
    already means precisely "a caller that is not a tenant", it carries no user
    and no restaurant so a route using it cannot accidentally read one, and it
    FAILS CLOSED when unset — a missing secret is a misconfiguration and never a
    permission. The cost is stated rather than hidden: it is a *shared* secret,
    so it identifies the deployment's operator and not a named person, and the
    both-arms read is therefore **not attributable to an individual**. That is
    acceptable for a READ of counts; it would not be acceptable for a write that
    moved money, and the winner write is the boundary case — see the risk below.

#### On what ends the experiment

15. **A sample-size rule** — end when each arm has *n* completions, or when a
    significance test crosses a threshold. Rejected, and this is the load-bearing
    rejection of the two. A stopping rule that depends on the data being
    collected is an *optional stopping* rule: repeatedly testing a running
    experiment and stopping the moment it crosses a bar inflates the false
    positive rate, and with two arms at 80/20 over a population of roughly one
    real tenant the die arm may never reach any *n* at all, so the rule's other
    branch is "runs forever" — which is exactly the state this question was asked
    to end. Worse, it would put the ARM in charge of when to stop looking at the
    arm. A calendar rule is decided before any data exists and cannot be moved by
    what the data says.
16. **Owners read their own arm and the founder ends it by hand.** The status quo
    plus a reminder. Rejected: nothing in the code stops it, so "by hand" means
    "when somebody remembers", and an experiment left running is a product with
    two faces — the very cost §9 records as measured (two dies on one screen,
    visually identical at rest). It also leaves the ratio honoured and nothing
    learned, which is the state ADR 0127 filed as the reason to ask.
17. **A typed end date, in the spec object.** Rejected for the reason the ratio is
    not trusted from the spec either: a constant in a source file can be edited,
    and an edited end date moves the finish line under an experiment already
    running, invisibly. Deriving from the first exposure and freezing the result
    is the same shape as the frozen assignment row, and the database refuses to
    move it.
18. **A generated column (`ends_at` computed from `first_exposure_at` and
    `quarter_days`).** Genuinely tempting — it makes the arithmetic
    unfalsifiable. Rejected narrowly: it also makes the interval unchangeable by
    any future correction the founder *did* authorise, and an explicit column
    frozen by a trigger says the same thing while leaving that door where a
    person can see it and open it deliberately.

### Consequences

#### What becomes easier

- The question the ratio exists to settle can now be answered. Both arms, one
  request, counts and dates.
- The experiment has an end that arrives on its own, so "an experiment left
  running is a product with two faces" stops being a standing risk and becomes a
  dated one.
- The mechanism generalises: any future `ExperimentSpec` gets the same window,
  the same both-arms report and the same write-once winner with no new code.

#### What becomes harder, or is given up

- **The both-arms read is not attributable to a person.** `X-Admin-Key` is a
  shared deployment secret; the report records nothing about who read it, and the
  winner row records `winner_words` and a timestamp but no actor. An actor column
  was deliberately NOT added, because the only honest value available on that
  path is "whoever holds the service key" and a column called `named_by` holding
  that would be worse than no column — it would look like an audit trail. If the
  founder wants the winner attributable, that needs a named credential, and that
  is a different decision.
- **A tenant learns, from `running: false`, that some house somewhere was exposed
  91 days ago.** That is the whole of the cross-house information any tenant
  payload carries: the dates themselves (`firstExposureAt`, `endsAt`) are on the
  admin report ONLY, and were deliberately kept off the per-house one, because a
  house's own end date is another house's first exposure.
- **Every count on the both-arms report is still a floor**, for both of ADR
  0127's reasons (a tab closed outright records no abandon; nothing at all is
  recorded while an arm is unreadable) and now for a third: nothing is recorded
  after the window closes, so a house still using the product past the end
  contributes nothing. Both arms lose the same cases in all three.
- **Nothing raises its hand when the window closes.** The end arrives on a date
  and no notification, no page and no log announces it; a founder who does not
  call the route does not learn that the experiment ended. Filed as
  `dashboard.md` §13.23 rather than left implicit.
- **The winner is named by `curl`.** There is no UI for either admin act. For the
  READ that is a deliberate choice (a page for one reader is a page to keep in
  step); for the WRITE it is a gap, and it is the same §13.23.
- **The spec object is not deleted when a winner is named**, which departs from
  what open question 2 asked for. Deleting `NOTE_CLOSE_CONTROL` would leave
  `ux_experiment_assignments` rows pointing at a key nothing declares, and the
  winner is served *from* the stored state row, so the spec has to outlive the
  decision. Retiring it — collapsing the winning arm into the component and
  removing the experiment entirely — is a later, separate act.

#### What would trigger revisiting this

- **A second experiment.** The window and the winner are per-`experiment_key`
  already, but the 91 days is a single global constant; the first experiment that
  wants a different length turns `quarter_days` from a stored audit trail into a
  stored parameter, which is a small change and a real decision.
- **The die arm ending empty.** ADR 0127 measured that the one house the local
  gateway reaches hashes to bucket 99 — the die arm — and that a 20% split over
  ten restaurants is a coin flip. If the quarter closes with `housesAssigned: 0`
  on either arm, the both-arms report will say so plainly, and the honest reading
  is that the experiment did not run rather than that an arm lost.
- **The service key being wanted for anything that spends money.** It is
  unattributable by design; that is fine for reading counts and naming a UI
  control, and it is the line.

### How it was proven

**Counts are from runs made on this tree, with the command named.** Nothing here
is quoted from another session.

- `npx jest src/ux-optimizer src/one-tap-actions` (from `apps/api-gateway`) —
  **134 passed / 7 suites**, of which **42 are new** in this pass
  (`experiments.spec.ts` +7, `ux-optimizer.experiments.spec.ts` +28,
  `ux-optimizer.admin-routes.spec.ts` 7 — a new file).
- `npx vitest run src/pages/dashboard/next` (from `apps/web`) — **68 passed /
  3 files**, of which 35 in `note-close-experiment.test.tsx` (**+6** this pass).
  (Re-measured after the branch merged `origin/main` mid-pass; the same command
  read 66 before that merge, the two extra being another builder's additions to
  `WaitingOnYou.seal.test.tsx`.)
- **`tsc` is clean of this pass's files in both apps, and is NOT clean of the
  worktree.** Re-measured after the merge, since both runs were wholly clean
  before it and are not now. `npx tsc --noEmit -p tsconfig.json` (gateway) errors
  in exactly one file, `src/communications/archive/house-mail-archive.service.ts`
  — **untracked** (`git status` reports `??`), another builder's new work in a
  directory this pass is forbidden to touch. `npx tsc --noEmit` (web) errors in
  three files, all `src/pages/orders/next/**`
  (`useOrdersNextData.ts`, which another builder has modified, plus the two test
  files it breaks under). **Grep-counted to zero for `ux-optimizer` and zero for
  `dashboard/next` in the respective runs.** `npx tsc --noEmit -p
  tsconfig.spec.json` (gateway) leaves errors in seven files, none of them this
  pass's — `communications/archive/**`, `communications/retention/**`,
  `communications/text/**`, `procurement/order-names-its-vendor.spec.ts` and
  `team/notes.service.spec.ts` — also grep-counted to zero for `ux-optimizer`,
  after the two casts in the new spec were widened to fix the only two errors
  this pass did introduce there.
- **Pre-fix probes, run then deleted.** Gateway: HEAD copies of `experiments.ts`,
  `ux-optimizer.service.ts`, `ux-optimizer.controller.ts`, `ux-optimizer.module.ts`,
  `ux-proposal-grounding.ts` and `dto/ux-optimizer.dto.ts` were written by
  `git show HEAD:` into a same-depth throwaway directory alongside copies of all
  three spec files (no git state was changed). **36 failed / 42 passed of 78.**
  Every one of the 36 is new in this pass. **Six new cases pass against pre-fix
  code and each is a case that SHOULD**: the three `ServiceKeyGuard` cases pin
  ADR 0099's guard, which this pass did not touch; "leaves every other route
  needing a token" is the property this change must PRESERVE; "still resolves its
  whole dependency graph" is the regression net for the guard that was added, and
  pre-fix there was no guard to break it; and "does not stamp a window when
  nothing has been exposed" passes VACUOUSLY pre-fix because nothing stamped a
  window at all — that one is a weak proof and is labelled as one. Web: HEAD's
  `note-close-experiment.ts` plus the new `describe` block, same method —
  **3 failed / 3 passed of 6**, the three passing being the two "says nothing
  about the window" cases (which pre-fix pass trivially, since there was no
  ending sentence to find) and "still prints this house's counts after the end".
- **The migration was applied to a real Postgres.** Docker is down, so the
  harness is PGlite (`$SP/pglite-probe/p4bd-experiment-state.mjs`, modelled on
  `p4aw-experiment-assignments.mjs`): **19 passed / 0 failed** — the file
  applies, applies twice, accepts a window, refuses a second window for the same
  experiment (`23505`), refuses a backwards window, refuses half a winner, writes
  a whole one, accepts the SAME winner again (idempotent), refuses a DIFFERENT
  one, and refuses to let `first_exposure_at`, `quarter_days` or `ends_at` be
  moved or the row be deleted. **Six of its seven in-file `DO $$` assertions were
  proven to FIRE** against a copy with exactly one thing broken (RLS removed, a
  client grant added, the primary key widened to `(experiment_key,
  first_exposure_at)`, `winner_is_whole` removed, `window_runs_forward` removed,
  the write-once trigger removed). The seventh is the table-exists guard, which
  cannot be broken without breaking the `CREATE` it checks — stated rather than
  counted as proven.
- **Guards** (from the worktree root, `/usr/local/bin/python3`):
  `check_new_tables_are_locked_down`, `check_fk_targets_exist`,
  `check_read_columns_exist`, `check_queried_tables_exist`,
  `check_read_errors_not_swallowed`, `check_route_exposure`,
  `check_flag_readby_anchors`, `check_windowed_figures`,
  `check_web_reads_gateway_dto_keys` — all **exit 0**. Migration prefix
  uniqueness (`ls supabase/migrations | cut -c1-14 | sort | uniq -d`) — empty.
- **`bash scripts/check_gateway_boots.sh` — PASS**, with the whole `AppModule`
  graph resolved and this pass's `ServiceKeyGuard` on the `ux` controller in it.
  This is the check that exists for the class of failure a new `@UseGuards`
  causes, and it is recorded here with its history rather than as a bare green:
  **it FAILED earlier in this pass and not on this pass's code** — a
  `ReferenceError: Cannot access 'IntegrationsOauthService' before
  initialization` while requiring
  `dist/communications/archive/house-mail-archive.service.js`, a circular import
  in `src/communications/**` which this pass is forbidden to touch and which
  `git show HEAD:` proved absent at HEAD (exit 128, another builder's untracked
  work), failing at module-require time before Nest DI ran at all. The branch
  then merged `origin/main` mid-pass and the boot went green. The narrower proof
  built while it was red is KEPT rather than deleted, because it answers the
  question directly and does not depend on the rest of the worktree compiling:
  `ux-optimizer.admin-routes.spec.ts` compiles `UxOptimizerModule` through
  `Test.createTestingModule` with the new guard attached and resolves
  `UxOptimizerController`.
- **NOT verified live.** Nothing was run against `127.0.0.1:4000`: no gateway is
  running (`curl /health/live` returns `000`), and the local gateway points at
  PRODUCTION, where neither this migration nor `20260905220000` is applied. So
  there is no 401/404/500 evidence for the two new routes and no real figure has
  ever come back from either. Stated rather than skipped; `dashboard.md` §13.24
  carries it. **No production write was made and no assignment, window or winner
  was created anywhere.**
- **`eslint --quiet` was NOT run.** It cannot run anywhere in this checkout:
  `eslint-plugin-jsx-a11y` is referenced from `.eslintrc.cjs` and is not
  installed. Stated rather than skipped.
- **No captures.** Nothing user-visible changed shape: the only web change is one
  extra sentence appended to the dashboard footer's existing report line, in the
  same element and the same tokens, and it is exercised by six unit cases rather
  than by a screenshot. Stated so the omission is a decision and not an oversight.

### What this addendum does NOT claim

- It does not claim the both-arms report has ever returned a real figure. Every
  count is proven against a stub and against PGlite; production does not have the
  table, and no house has been exposed to the experiment there.
- It does not claim the read is attributable to the founder personally. It is
  attributable to whoever holds `ADMIN_API_KEY`. See the risk above.
- It does not claim the end will be noticed. It arrives on a date and nothing
  announces it (`dashboard.md` §13.23).

## Review trail, continued (parent, 2026-09-05)

| Date | Who | What |
|---|---|---|
| 2026-09-05 | Claude (parent) | Correction: the commit message of 7a8d864c said "gateway and web tsc: 0 errors"; measured with tsconfig.json only. Under tsconfig.spec.json one pre-existing test-file type error (a main-merged notifications spec) stood at that tip, unrelated to this commit, fixed in 7bbc37c9. Batch 53 answered question 2: a notification to the founder when the window ends unnamed — being built. |
