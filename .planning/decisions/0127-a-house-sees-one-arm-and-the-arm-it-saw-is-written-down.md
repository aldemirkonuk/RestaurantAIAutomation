# 0127 — A house sees one arm, and the arm it saw is written down

- **Status:** Locked — the founder set the ratio on 2026-09-05, in session
- **Date:** 2026-09-05
- **Decider:** Aldemir (founder)
- **Keywords:** experiment, arm, assignment, ratio, hash, deterministic, per house, exposure, outcome, neural footprint, ux-optimizer, one-tap, note, die, seal, gesture, counts, verdict
- **Links:** [[0083-a-page-may-not-claim-a-write-it-never-makes]],
  [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]] (its
  2026-09-05 status line), [[0020-no-fabricated-answers]],
  `.planning/06-pages/dashboard.md` §1a/§9/§13,
  `apps/api-gateway/src/ux-optimizer/experiments.ts`,
  `supabase/migrations/20260905220000_a_house_sees_one_arm_of_an_experiment.sql`

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

## Open questions — the founder's, not an agent's

1. **Who may read both arms?** As built, nobody can: the report is tenant-scoped
   and a house is on one arm. Three shapes, none of them this pass's to pick —
   (a) a founder-scoped read, which means inventing the first cross-house role in
   this codebase; (b) cross-house aggregate counts served to any authenticated
   caller, which with roughly one real tenant is close to serving that tenant's
   own numbers to everyone; (c) a k-anonymity floor, which over today's
   population would return nothing for months and withhold exactly what was
   asked for. Until one is chosen the ratio is honoured and nothing is learned
   from it. `dashboard.md` §13.17.
2. **What ends the experiment?** Nothing in the code stops it, and an experiment
   left running is a product with two faces. Name the trigger — a count, a date,
   or simply a look — and say what happens when it fires: the winning arm becomes
   the control, `NOTE_CLOSE_CONTROL` is deleted, and the assignment rows are kept
   as the record of what each house was shown. `dashboard.md` §13.18.
