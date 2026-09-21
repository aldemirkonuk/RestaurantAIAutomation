# 0207 — A vendor is scored on what it did, from the house's own records

- **Status:** Locked 2026-09-21 for the pick (sketch 117 direction A, with B's Roll Call and C's Docket) — the founder's. The builder's choices listed under *Decision · what the builder chose* are **Proposed** until the founder answers the questions at the foot.
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** vendor scorecard, operational vendor scorecard, vendor sentiment, providers, TwinSheet, ledger card, roll call, docket, on time, lines as ordered, price as agreed, reply time, credits recovered, minimum sample, windowed trend, shadow run, labelled evaluation, tenant scope, house-scoped, sketch 117
- **Links:** [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] row 31 (the brief) and rows 22, 23, 25; [[0103-a-delivery-is-agreed-before-it-is-verified]] and ADR 0104 (the agreed invoice, the door); ADR 0112 (the Sheet); ADR 0119 (the agreed price states its unit); ADR 0054 (Proposed; sketch 117 cites it for *landed vs agreed* — not used here); `.planning/sketches/117-vendor-scorecard/README.md`; `.planning/06-pages/providers.md` §1a, §4; PR #416 (provider-intelligence house scope, a peer's — not duplicated here)

## Context

The founder was asked whether the vendor sentiment behind `/documents-reports` had deep, robust pipelines with promising results (ADR 0149 row 25). The research answered **hollow**: two unrelated writers of a three-word label, no evaluation, no calibration, `provider_sentiment_history` at 0 rows, `provider_performance_metrics` at 0 rows with a reader and no writer, 27 conversation rows from one vendor, a trend that reads a flat series as "declining" (`provider-intelligence.service.ts:399-404`, first point against last), and two cross-tenant reads on the intelligence routes.

His answer is recorded as ADR 0149 row 31, in the register's own words (the transcript itself is not in the repository, so this is the recorded answer, not a verbatim transcript):

> "An operational vendor scorecard: what vendors do, measured from records (on time, short or refused lines, price agreement, reply latency, credits recovered), tone a minor input, a labelled evaluation and a shadow run before any alert"

The lane brief that carried it adds, from the same answer: *every figure opens to its rows*, and *windowed trends with a minimum sample*. Sketch 117 drew three directions. On **2026-09-21 (evening)** the founder picked, as relayed by the orchestrating session and recorded in its memory (`founder-answers-2026-09-21-round5.md:135`, not in this repository): **direction A, "The Ledger Card"** — the ledger card in the vendor sheet on `/providers` plus one behavioural fact on the vendor card — **with B's "Roll Call" as a second view of `/providers`, and C's "Docket" as the rows surface behind each figure** (A's per-measure tables become one filtered day book); **not** in the Sorting Office.

## Options considered

1. **A alone — the ledger card in the sheet.** Smallest distance from the built page and the MERGE verdict (`MAKEOVER-VERDICTS.md:129-132, :337-346`). Needs one per-vendor read and five rows reads. Leaves "which vendor is slipping, against which" unanswered.
2. **B alone — the Roll Call.** Answers the Monday question, but on a thin corpus it is a page of italics, and it has no place where a single vendor's rows are read.
3. **C alone — the Docket in the Sorting Office.** The strongest reading of "every figure opens to its rows", but it moves vendors back into `/documents-reports` the week ADR 0149 row 25 moved the vendor conversation list out, and it is the costliest read.
4. **A as the spine, B as a second view, C's day book as the rows surface — chosen by the founder.** One read shape serves all three: the house-wide read is the per-vendor read repeated, and the day book is the per-vendor read's rows.
5. *Doing nothing* leaves the legacy sentiment tab as the only vendor-behaviour surface: a model's label with no evaluation, counted twice per message, on a route that leaked across tenants.

## Decision

**Build option 4, read-only, with no alert of any kind.** Everything a figure says is a count of this house's own records; the figure is computed from the same dated entries the Docket lists, so a tally always equals its rows.

### What is built

- **The read** — three routes on their own prefix, house from the token only (`houseOf`, refusing a session that names no house with 403 before any table is read):
  - `GET /vendor-scorecard?window=30|90|365` — the Roll Call: every vendor of the house, each with the five measures.
  - `GET /vendor-scorecard/:providerId?window=` — the ledger card. A vendor of another house is 404, the same answer as no vendor.
  - `GET /vendor-scorecard/:providerId/docket?window=&measure=` — the Docket: every dated entry in the window, newest first, optionally one measure's.
  - Each measure answers **value, denominator (sample), window, minimum-sample rule and one of four outcomes**: `answered` · `too_few` (the count is printed, never a zero figure) · `not_collected` (this house's register has never held such a record — "not late — unknown") · `could_not_read` (the register refused; the reason is on that line and the other lines stand). The prior window of the same length is a window, both counts printed, and is a comparison only when both reach the minimum; no direction word, no slope, no first-against-last.
  - Every register read is paged (PostgREST caps an unranged select) and refuses to score a register larger than it can read whole.
  - Files: `apps/api-gateway/src/providers/scorecard/vendor-scorecard.ts` (pure), `vendor-scorecard.service.ts`, `vendor-scorecard.controller.ts`, registered in `providers.module.ts`.
- **The ledger card** — *What they did*, a new section of the TwinSheet on `/providers`: window chips (30 · 90 · 365 d), five lines each a fraction with its denominator, the sentence of what was left out and why, the prior window's own count, a link whose count equals the rows it opens, tone as a sixth minor line in no figure, *How this is scored*, and the sentence that no alert is sent. `apps/web/src/pages/providers/next/scorecard/LedgerCard.tsx`.
- **One fact on the vendor card** — a fourth row, *Did · 90 d — 12 of 14 on time*, or the refusal in italic words (*2 deliveries — too few to score*, *nothing in 90 d — nothing to score*, *could not be read*). Read from the Roll Call answer; the card computes nothing.
- **The Roll Call** — `/providers` gains a *Book · Scorecard* segmented control (`?view=scorecard`). Every cell a count over a count with its prior window; rows ordered by the orders on the on-time line (a scanning order, not a rank); sorting by a measure puts vendors that cannot score on it **in their own group**, under a rule that says so; a failed register is written into every cell of its column; an empty book draws no table; phone width folds each row into a block. `scorecard/RollCall.tsx`.
- **The Docket** — a second Sheet (stacked on the vendor sheet by the page's SheetStack) opened from a ledger line or a Roll Call cell: the five tallies as filters over one answer, the entries newest first, every *listed and not counted* entry saying why, an unanswered message listed as *open — not counted, not forgotten*, a failed register as a band — *missing from this list, not absent from the record*. `scorecard/DocketSheet.tsx`.

### The five measures, as built — from the records that exist

| Measure | Counted from | A hit | Listed, not counted | Minimum |
|---|---|---|---|---|
| On time | `procurement_orders` that arrived (`ORDER_ARRIVED_STATUSES`, `delivered_at` in the window) | landed by 23:59:59 UTC on `expected_delivery_date` — the built rule of `getVendorScorecard`, verbatim | no expected date; **open** — placed (`ORDER_OPEN_WITH_VENDOR_STATUSES`) and past its expected date, not landed (dated at the deadline, also carried on the card's fact as *· N overdue*) | 5 |
| Lines as ordered | the latest door event with a verdict per order line (`procurement_receipt_events.outcome`, ADR 0103's door) | `accepted`, nothing refused, no damage photograph | counted at the door with no verdict | 5 |
| Price as agreed | order lines verified in the window (`match_verified_at`) | the verdict **recorded** at verification, `price_verified = true` | no invoiced price; not checked; no agreed price it can be compared with (resolved by the same `agreedPricePerBottleForDoor` the verification ran — a keg price is never compared with a bottle price) | 5 |
| Reply time | `procurement_conversations`: our message `SENT`/`AUTO_SENT`/`DELIVERED` to their next received message **in the same thread** — the Gmail thread when the row carries one, else `thread_key` (see below); a second chase before they answer opens no second wait | — (median hours) | send never confirmed; no thread on record; open (no reply yet) | 5 answered |
| Credits | `procurement_credits` opened in the window, attributed to the claim's `provider_id` or else its order's, in the currency its **order** states | allowed on claims settled `credited`, over asked on every claim; `promised` in the denominator only; two currencies are two totals, never added; an order with no stated currency prints a bare amount | — | 1 claim |

**Found while building, and handled in the read:** `openCreditClaim` (`procurement.service.ts`, the only writer of `procurement_credits`) records neither `provider_id` nor `currency`, and the column defaults to `'USD'`. A vendor filter on `provider_id` would have shown every vendor *no claims*, and printing the column would have called a Turkish house's lira dollars (the ADR 0117 Q25 shape). The read never filters claims by vendor in SQL, attributes each claim through its house-scoped order, and never reads `procurement_credits.currency`. The writer itself is untouched here — see *Not built*.

**Found at last call, and handled in the read:** `procurement_conversations.thread_key` is filled by `set_conversation_thread_key()` (baseline trigger, `BEFORE INSERT OR UPDATE`) **only while it is empty**. An agent's draft (`provider_communication_agent.py`, `provider_conversation_agent.py`) is inserted before it is sent, with no Gmail thread, so it is keyed `msg:<id>` and keeps that key after the send writes `gmail_thread_id` (`procurement.service.ts` approve and auto-send paths); the vendor's reply arrives keyed `gm:<thread>`. Matching on `thread_key` would have listed every answered first message as *no reply yet* and held reply time at *too few*. The read keys a row by `gm:` + its Gmail thread when it has one (the key the same SQL function gives a row that had its thread at insert), else `thread_key`, else `thread_id`. `AUTO_SENT` (the auto-send sweep's status, written with `sent_at` once the message has gone) counts as a send; before the fix it was listed as *never confirmed*. The trigger itself is untouched — see *Not built*.

**Also found at last call:** the on-time figure counted arrivals only, so a vendor holding orders weeks past their date read *5 of 5 on time* with the non-deliveries absent from the page — absence read as health. The read now also takes the house's orders placed with the vendor (`CONFIRMED`, `IN_TRANSIT`) whose expected date falls in the windows, and lists each one past its date as an **open** entry beside the figure — *past its expected date and not landed — not counted, not forgotten* — and on the card's fact (*5 of 5 on time · 2 overdue*). It is not counted into the figure: the built rule scores arrivals, and whether a non-delivery counts as late is question 8 below. The link and the Roll Call say *orders*, not *deliveries*, because those rows are no longer all deliveries.

`not_collected` is decided per house, per register, by a single "has this house ever held such a row" read: an order with an expected date; a door event; a verified line; any vendor mail; any credit claim.

### What the builder chose (Proposed — each changes one component, none changes the read)

1. **Route prefix `/vendor-scorecard`**, not `providers/scorecard`: `ProvidersController`'s `@Get(":id")` would swallow a static `providers/scorecard`, and this lane keeps out of `providers.controller.ts` (lane E is rebuilding the vendor sheet beside it).
2. **A line is an order row.** `procurement_orders` is line-shaped (one `inventory_id`, one quantity), so "lines as ordered" counts door verdicts per order. ADR 0149 row 23's append-only line-verdict record with a person and a photograph is **not built**; when it lands, this measure moves to it.
3. **Price as agreed uses the verdict recorded at verification**, not a re-derivation, and excludes a line whose agreed price the door function cannot compare.
4. **Minimums 5 · 5 · 5 · 5 are sketch 117's placeholders; credits' minimum of 1 claim** is the builder's (a sum of money, every claim on its row).
5. **The on-time rule keeps the built UTC deadline.** A house in Istanbul whose delivery lands at 01:30 local on the next day is on time by this rule; the house's time zone is not applied (the same as `getVendorScorecard`).
6. **Tone** is a sixth, minor line — counts of a model's labels and "no person has labelled one" — in no figure and not a Roll Call column.
7. **The legacy *What the platform has learned* panel stays**, below the ledger card, unchanged.
8. **No role gate.** Every member of the house reads the scorecard, as they already read the credits and orders registers it counts (`credits.controller.ts` carries no role gate).
9. **The card's fact is a fraction** (A's drawing), and the chrome is English with the house's formats.

### Not built, and why (follow-ups, in dependency order)

- **The shadow run and the labelled set.** No alert ships until both exist and agree. That needs a candidates table (rule, fired-at, evidence) and a labels table appended never replaced, each actor an FK to `public.users(user_id)`, RLS on; and the rules and the gate (how many labels, how much agreement) are the founder's. No migration was written in this lane.
- **The line-verdict record** (ADR 0149 row 23) and **deliveries by provider** (`GET /procurement/deliveries` takes only `state` and `limit`).
- **Landed vs agreed** (sketch 117 cites ADR 0054, which is Proposed) — not used.
- **The claim writer** — `openCreditClaim` should record the claim's vendor and its order's currency when it opens the claim, so the row stands on its own; this lane reads around the gap rather than editing the procurement service.
- **The e-İrsaliye lapse** (`deliveries.lapsed_at`, ADR 0103 D3) is not yet an entry in the Docket.
- **The stored thread key** — `set_conversation_thread_key()` should re-key a row when a send first gives it a Gmail thread; until it does, the conversation thread list (`list_conversation_threads`, grouped by `thread_key`) shows an agent's first message and the vendor's answer as two threads. The scorecard reads around it (above); the trigger belongs to the conversations owner.
- **Two sketch 117 details:** a conditional refusal printed with the window that would score (*365 d · 7 of 8 — that window scores*) — the window chips reach it by hand; and the two actions on a vendor with no orders — a quiet vendor gets the sentence and no lines, without them.
- **The tenant leaks** named by the research (`GET /providers/intelligence/compare`, `GET /providers/:id/sentiment`) are closed by **PR #416** (open on 2026-09-21, a peer's lane); this lane does not touch `provider-intelligence.*`. The first-against-last trend at `provider-intelligence.service.ts:399-404` is not fixed here either — the scorecard does not read it.

## Consequences

- The vendor sheet and the Roll Call say what a vendor did in counts anyone can open, and say plainly when there are too few records to say anything. On today's production corpus most lines will read *too few* or *not collected* for a while; that is the honest state, not a defect.
- A new register or a new house cannot make a figure lie by absence: a missing register is a line that says so, never a zero.
- Five register reads per open sheet and per Roll Call. Paged and capped; a house past 20,000 rows in one window on one register reads *could not read* on that line until the read is narrowed.
- **Revisit when:** the founder names the shadow rules and the gate; ADR 0149 row 23's line record lands; a second house with real volume makes the minimums measurable instead of drawn.

## Verification (2026-09-21, worktree `wt-scorecard` at `origin/main` 34c33a76a)

- `vendor-scorecard.spec.ts` — 28 cases on the pure module, nothing mocked; includes the sketch's Skurnik credits record ($286.00 of $412.50), a claim with no recorded currency, and the invariant *every tally equals its rows* in every measure, both windows, at 30/90/365 days.
- `vendor-scorecard-is-house-scoped.spec.ts` — 17 cases against the real service and controller over an in-memory store that honours its filters, seeded with a second house whose rows are cross-linked to the first house's vendor (and a claim naming no vendor on the other house's order). **Mutation: each of the 15 `.eq("restaurant_id", house)` clauses removed one at a time — 15/15 killed (the 16th, on the outstanding-orders read added at last call, killed there too); `houseOf` made to return `""` instead of refusing — killed; restore byte-identical, green.** `jest src/providers`: 11 suites, 152 tests pass (148 before the last-call cases).
- Web: `LedgerCard.test.tsx` (12), `RollCall.test.tsx` (6), `ProvidersNext.test.tsx` (+7, 16 total) — the providers page suite 71/71. `tsc --noEmit` clean in `apps/web` and in both gateway configs; `check_gateway_boots.sh` PASS; eslint clean on every touched file.
- Seen, not only tested: the real `ProvidersNext` rendered in a throwaway Vite harness (fake adapter, fixtures computed by the real `buildVendorScorecard`, deleted after) at 1440 and 375 px — the card's fact, the ledger card in the sheet, the stacked Docket, the Roll Call with a failed register in every cell of its column, and the phone blocks with no sideways scroll.
- CLAIMS row `ADR-0207-VENDOR-SCORECARD-HOUSE-SCOPED` (static, python only) — mutation-tested: each of the 15 removed house clauses, a removed refusal and a handler bypassing `houseOf` exit 1; a clause moved into a comment exits 1; a missing file exits 2; the tree as built exits 0. `check_decision_claims.sh` 405/405.
- `check_money_states_its_currency.py` gained one allowlist row, for the web test fixture (it states a claim's order currency so the views can be asserted to print the stated one); product code adds no pinned currency.

## Founder questions (open; none blocks what is built)

1. **Shadow rules and the gate** — which rules would alert, how many labels and how much agreement before one ships, and where the label control lives (B's centred panel — a question — or C's popover — a choice, ADR 0112).
2. **Minimum samples** — keep 5 per delivery-borne and reply line, and 1 claim for credits?
3. **The card's fact** — a fraction (*12 of 14 on time*, built) or a sentence (*late twice in 14*)?
4. **Staff** — see every line (built), have the whole card withheld (A), or have the money lines withheld by kind (C)?
5. **The legacy panel and its Sentiment tab** — keep below the ledger card (built) or retire, given the scorecard says tone is not scored?
6. **On-time deadline** — keep the built UTC rule, or the house's local midnight?
7. **The Roll Call for a Turkish house** — English chrome with tr-TR formats (built) or Turkish chrome (B's drawing)?
8. **An order past its date that never landed** — listed as open beside the on-time figure and on the card's fact (built), or counted into the figure as late (the usual on-time-in-full reading, which changes the built `getVendorScorecard` rule)?

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | scorecard lane (builder) | Created with the build; pick recorded; builder's choices marked Proposed |
| 2026-09-21 | last call (Opus) | Reply time fixed in the read: Gmail thread first (a sent draft keeps its insert-time `msg:` key), `AUTO_SENT` counted as a send. On time: orders past their date and not landed listed as open and carried on the card's fact (question 8). The Docket no longer labels an open claim *not counted* (it is in what was asked). A vendor missing from a Roll Call that answered draws the dash, not *could not be read*. Seven cases added; each fix reverted once and its case went red. |
