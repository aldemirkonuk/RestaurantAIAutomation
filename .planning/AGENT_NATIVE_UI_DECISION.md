# Agent-Native UI — Decision Document

**Date:** 2026-07-27
**Status:** ⛔ **RECOMMENDATION: DO NOT BUILD** the proposed agent-native UI.
**Instead:** fix the security defects found during this review, then ship the
narrow deterministic slice in §7.

> This document exists because a proposal was made to make WineOps
> "agent-native": telemetry live, agent proposals auto-approved below a
> confidence threshold, and runtime overrides wired into real pages so the UI
> reshapes itself per user. Three independent reviews (a YC-partner business
> review, a failure premortem, and an architecture review) plus a direct code
> and database audit all point the same way. The audit also surfaced **six live
> security/correctness defects** in the existing dark feature that must be fixed
> or deleted regardless of the decision below.

---

## 1. The claim was accurate — and understated

The proposal asserted the app is "agent-powered, not agent-native," blocked on
three things. All three verified true. A fourth was missed.

| # | Claim | Verified | Evidence |
|---|-------|----------|----------|
| 1 | Telemetry not live | ✅ true | `VITE_UX_OPTIMIZER` unset (defaults off); no `.env` sets it |
| 2 | Proposals need human review | ✅ true | `AUTO_APPLY = false`; `UX_OPTIMIZER_ENABLED` defaults `"false"` |
| 3 | Overrides not wired to pages | ✅ true | `useUxOverrides` imported by **zero** files; **zero** elements carry `data-ux-key` |
| 4 | *(missed)* The agent has never run | ✅ true | `ux_signals`, `ux_proposals`, `ux_overrides`, `ux_learnings` = **0 rows each** |

**The dead chain.** Telemetry is worse than "off". The only caller of
`attachFrictionDetectors` / `reportTti` is `useUxOverrides.ts`, which **no page
mounts**:

```
page (none) → useUxOverrides (unmounted) → attachFrictionDetectors → POST /ux/signals
```

So flipping `VITE_UX_OPTIMIZER=true` collects **nothing**. The env flag is not
the blocker; the missing call site is.

**Nothing has ever been targetable.** `data-ux-key` appears exactly once in the
codebase — inside `uxSignals.ts`, in the function that *reads* it. No component
sets it. `elementKey()` therefore always falls through to a Tailwind class
fragment (`div.flex.items-center`), which is neither stable nor unique.

---

## 2. The finding that reframes the question

Before optimizing the UI, we checked whether there is usage to optimize.

| Table | Rows |
|---|---|
| `restaurants` | 10 — **all test fixtures** (`ADMIN 1`, `ADMIN ROOM`, `ALDEMIR`, `YAREN`, `Gullit's Tavern`…); 8 have zero inventory |
| `pos_checks` (POS feed) | **0** |
| `analytics_insights` (engine output) | **0** |
| `recommendation_actions` (user ever acted) | **0** |
| `procurement_orders` | **1** |
| `restaurant_inventory` | 70 |

**Implications, stated plainly:**

- The 573-type insight engine has produced **zero insights**, because
  `analytics_insights` is fed from `pos_checks`, which is empty. The analytics
  layer is untested against real data.
- **Nobody has ever acted on a recommendation.** Zero rows in
  `recommendation_actions` — the store built for exactly that.
- There are **no real users**. The premise of "each user gets a different
  experience based on role + behavior" has no users and no behavior.

An adaptive-UI agent needs weeks of telemetry from many users to say anything
true. At current scale it would be fitting noise and attaching a confidence
score to it.

---

## 3. Business review (YC-partner lens) — verdict: don't build

**Is it a wedge?** No. Nobody churns over section order. A wine buyer's
bottleneck is data entry and invoice reconciliation. MarginEdge won on
"photograph the invoice"; Partender on "tap the liquid line." Adaptive layout is
not a line item on a P&L, not a sentence in a cold call, not a pricing-page bullet.

**The environment is actively hostile to per-user layout:**

- **High staff turnover** → you are onboarding someone new every few months,
  forever. Training only works if the product looks the same for everyone.
- **Training is oral and physical** — "hit the blue button on the right." That
  sentence becomes *wrong* under personalization. You break the mechanism the
  product uses to spread inside an account.
- **Muscle memory during service.** A somm doing receiving at 4pm with a driver
  waiting doesn't read the screen; they tap a location. Moving it — even
  "better" — turns 5 seconds into 30 and creates resentment.
- **Support burden for one developer: severe.** "Where's receiving?" goes from a
  10-second answer to an investigation requiring reconstruction of that user's
  layout state.

**The steelman argues for something else.** The strongest case *for* is that the
surface is enormous (573 insight types, Studio, scheduling, sommelier chat,
calendar, reports) and a new user drowns. That is real — but the fix is to
**cut the surface** with role-based defaults in a week, deterministically, with
no telemetry. The agent treats the symptom of a scope problem.

**The uncomfortable pattern:** the 573-insight engine and the dark UX optimizer
are the same failure mode — combinatorially impressive systems built without a
paying customer pulling on them. Building a third to fix the first two is how
solo companies spend two years shipping nothing anyone buys.

---

## 4. ⚠️ Security & correctness defects found during this review

**These exist in `main` today.** The feature is dark, so impact is currently
limited — but `POST /ux/signals` and `GET /ux/overrides` are **live,
unauthenticated HTTP endpoints right now**. These are not hypothetical.

| # | Defect | Location | Severity | Why it matters |
|---|--------|----------|----------|----------------|
| D1 | **No auth on any `/ux/*` route.** Global guards are only `RateLimitGuard` + `TenantGuard`; `TenantGuard` L38-46 returns `true` when there is no user (its own comment: *"JwtAuthGuard should enforce where required"*) — and the ux controller has no `JwtAuthGuard` | `ux-optimizer.controller.ts`, `tenant.guard.ts` | 🔴 High | `POST /ux/proposals/:id/review {decision:"approve", rolloutPct:100}` is reachable **from any host on the internet**. `reviewedBy` is free text from the body — **the audit trail is self-reported by the caller**. Inert only because the kill switch is off |
| D2 | **Cross-tenant override leak.** `o.restaurant_id == null || !restaurantId || …` | service L500-502 | 🔴 High | Omit `restaurantId` and the filter passes **every tenant's** overrides. Also hit on first render before `AuthContext` resolves |
| D3 | **Public unvalidated insert.** `meta: Record<string, unknown>` written to `jsonb` verbatim; no schema, size cap, or scrubbing; no retention policy | controller + `ingestSignal` | 🔴 High | Anonymous internet write into Postgres. Unbounded growth. "No PII" is a *comment*, enforced by nothing |
| D4 | **PII leak path.** `elementKey()` returns `#${el.id}` **before** the `data-ux-key` check | `uxSignals.ts` L123 | 🟠 Med | Element IDs containing record identifiers, joined to `session_id` + `restaurant_id` + timestamp, reconstruct who opened which record when — an accidental staff-surveillance dataset |
| D5 | **`AUTO_APPLY` gates nothing.** Referenced only in a comment and its own declaration — never in a conditional | service L15, L27 | 🟠 Med | The "hard guardrail" is decorative. The real gate is *the absence of a caller*, i.e. a social convention |
| D6 | **`evaluateOverride` is unreachable** — no route, no cron, no caller | service L580 | 🟠 Med | The measure-and-learn half of the loop **never runs**. Auto-revert-on-regression — the core safety story — has never fired |

**Additional correctness defects** (lower severity while dark, fatal if enabled):

- **D7 — `.limit(5000)` with no `ORDER BY`** on the friction summary
  (`summarize`, L120). Past 5000 rows the "authoritative" summary is an
  arbitrary heap-order sample — and the LLM system prompt instructs the model
  *"authoritative; do not contradict"*.
- **D8 — Bucketing is per-tab, not per-user.** Session id lives in
  `sessionStorage` (`uxSignals.ts` L17); `sessionBucket(undefined)` returns
  `Math.floor(Math.random() * 100)`. Same human, new tab → different bucket →
  **different UI**. This alone produces UI flicker with a perfectly correct agent.
- **D9 — `before === 0 → liftPct = 0 → "neutral" → keep`** (evaluate, L~599).
  Introducing brand-new friction onto a previously clean surface is hardcoded to
  score as harmless — the most damaging regression class is invisible by construction.
- **D10 — Rollback can silently no-op.** `reviewProposal` upserts on
  `(restaurant_id, page, target_key)`, overwriting `proposal_id`. A later
  `rollback(firstProposalId)` matches zero rows, returns `{status:"rolled_back"}`
  anyway, and writes a "reverted" learning. **The override stays live.**
- **D11 — Kill switch is half a switch.** `enabled()` gates only
  `getActiveOverrides`; ingestion, proposal generation and rollback run
  regardless. The client half is a **build-time** Vite var, so killing telemetry
  needs a redeploy — and `useUxOverrides` never refetches, so flipping the server
  flag doesn't un-apply overrides in already-open sessions.
- **D12 — Rage-click detector measures speed, not distress.** `clickTimes` is
  **global to the window**, not per element (`uxSignals.ts` L80). Any 3 clicks
  within 700ms anywhere fire `rage_click`, attributed to whatever the third click
  hit. A somm stepping through a 40-bottle count emits a continuous rage-click
  stream. **The primary friction signal is a direct measure of user expertise.**

---

## 5. Premortem — how it fails (the top mechanisms)

Full premortem is long; these are the load-bearing failures.

**5.1 The metric trap (most important).** Friction telemetry measures
*attention*, and the value of a control surface is **inversely proportional** to
the attention it needs. An invoice-variance panel whose correct behavior is
"glance, see zero, move on" is indistinguishable from dead weight in every signal
collected. An agent that hides low-engagement surfaces will, given cycles,
hide every safety control in the product — *rubric-justified each time*
(progressive disclosure under Hick's law). This is not a bug; it is **the fixed
point of the objective function.**

**5.2 The expertise inversion.** Because of D12, rage clicks concentrate on the
workflows the best users run *fastest* — bulk count entry, order-line stepping,
dense tables. The agent reads that as suffering and proposes friction *into* the
expert paths. The rubric optimizes the novice's first ten minutes; the product's
value is in the expert's ten-thousandth minute.

**5.3 The trust catastrophe is caused by a storage choice, not by AI.** D8 means
one human, two tabs, two different layouts, same login. The failure mode is a
staff member photographing both screens asking "which one is real" — and the
framing that spreads is *"the app changes itself and they can't tell you what
you're looking at."*

**5.4 Debuggability collapse.** `ux_overrides` is **state, not code**. It isn't
in `git log`, can't be `git bisect`ed, isn't in staging, doesn't appear in deploy
history. The entire debugging toolchain assumes code determines UI; this system's
premise is that it doesn't. Combined with D10 (silent no-op rollback), an
incident becomes unfixable in the moment.

**5.5 Measurement is invalid at this scale.** No control/treatment split at
measurement time (counts pool treated and untreated), raw counts not rates,
windows not anchored to when the change went live, and restaurant traffic swings
30–60% week to week. At 11 restaurants the honest verdict on nearly every change
is **"we cannot tell."** A system that says so is more valuable than one that guesses.

**5.6 Auto-approval selects for the *least* evidence.** The heuristic fallback
assigns its **lowest confidence (0.35) to the zero-data case**. A rule of "below
threshold → auto-apply" therefore preferentially ships changes to the pages the
agent knows *least* about. And confidence is an LLM-emitted token coerced to a
float — never calibrated, and uncalibratable while D6 stands.

---

## 6. Decision

**Do not build the agent-native UI as proposed.** Specifically: do **not** turn
on auto-approval, do **not** wire runtime overrides into pages, and do **not**
personalize layout per user.

Two framing rules worth adopting permanently:

> **R1 — The artifact should be a commit, not a database row.**
> Let the agent *propose*; a human merges a PR. This single choice restores
> git history, bisect, staging, code review, CI, deploy history, `git revert`,
> and identical UI for all users — everything runtime override injection costs.

> **R2 — Personalize content, never layout.**
> Different data, sort order, defaults, notifications: fine. Different button
> locations: never. In a high-turnover, mid-service, screenshot-sharing
> environment, layout consistency *is* teachability, and teachability is what
> survives 4-month staff tenure.

---

## 7. What to do instead

### Phase 0 — Remediate (do this regardless; ~1 day) 🔴

The dark feature has live unauthenticated endpoints. Pick **one**:

- **Option A (recommended): delete the feature.** Drop the controller/module and
  the four tables. It has never run, has zero rows, and is currently a liability
  surface. Keep the design doc for future reference.
- **Option B: secure it in place.** Add `@UseGuards(JwtAuthGuard)` to the
  controller (D1); make `getActiveOverrides` **fail closed** without a tenant
  (D2); validate/allowlist `target_key` and drop or type `meta`, add retention
  (D3); move the `data-ux-key` check *before* the `#id` branch (D4); delete the
  decorative `AUTO_APPLY` constant or make it actually gate `reviewProposal` (D5).

Either way, **write the reversal criteria down before any future re-enable.**

### Phase 1 — The narrow slice that captures the value (~1 week)

1. **Three static role dashboards.** Buyer/Somm, GM/Owner, Manager-on-duty.
   Hard-coded, **identical for everyone in that role**, each screenshotable into
   a sales email. Gets ~80% of "the right things are surfaced" at ~5% of the cost
   and 0% of the support risk. This is the real fix for the surface-area problem.
2. **One "Today" card, pinned top of home, same position for every user**, fed by
   the **existing deterministic rules engine**: "4 wines below par before Friday,"
   "2 invoices with price variance >5%," "3 BTG bottles open >5 days."
   **Smart content, boring layout.** Demoable in a cold call.

### Phase 2 — Prove or kill the agent idea for free (~2 days, no UI shipped)

Run the ranking in **shadow only**: log whether the agent's top-ranked surface
matches the user's first meaningful action, against a baseline of the static role
default. Ship nothing. If static role ordering already hits ~75–80% (it likely
will), the agent's entire headroom is a few points on a metric no customer asked
for — and the idea is dead cleanly, with zero support risk.

### Phase 3 — Revisit only when the preconditions hold

Revisit at **~50+ paying locations**, and even then as an **internal** tool that
tells *you* what to redesign for everyone (Rule R1), not a runtime that reshapes
per user (Rule R2).

**Preconditions, all required:**
- [ ] Real paying customers with sustained multi-user daily usage
- [ ] `pos_checks` actually populated (the analytics engine has never had data)
- [ ] A registered slot allowlist — agent may target *only* explicitly tagged
      slots; empty allowlist ⇒ agent can do nothing (correct failure mode)
- [ ] An immutable-surface deny list: anything financial, legal, or destructive
      (`invoice-variance`, `compliance-*`, `order-confirm`, `count-submit`,
      `price-override`) — enforced in code before the row is written, not by prompt
- [ ] Durable **per-user** bucketing (never `sessionStorage`, never `Math.random()`)
- [ ] Override fingerprint on every session/Sentry event/support form, plus an
      admin "render exactly what this user sees" endpoint — **built before the
      first override ships**
- [ ] Task-outcome metrics (order completed, count finished, variance reviewed),
      not friction proxies; any drop in task completion reverts regardless of
      friction improvement
- [ ] `evaluateOverride` actually wired, with treatment/control split, rate
      normalization, windows anchored to `created_at`, and an
      `insufficient_data` verdict that refuses to guess below a sample threshold
- [ ] A no-change freeze during service hours (4pm–11pm local, and during any
      open order/count session)
- [ ] Written reversal criteria, dated, checked monthly

---

## 7b. If it is ever built: the architecture contract

An independent architecture review (which found D1/D2 **independently** — three
reviews converging on the same holes) produced the design below. Recording it so
the work isn't redone, **not** as approval to build.

**The governing principle:**

> **The agent selects among page-author-authored variants. It never authors UI.**

The LLM emits `{slotId: "orders.empty.headline", variantId: "v2"}` — a
*selection*, not a generation. That makes every change enumerable, reviewable,
diffable, screenshot-able and statistically tractable, and it closes the
prompt-injection path (today `target_key` and `meta` are attacker-controllable
and flow into the model prompt).

**Corollaries worth keeping even if the feature dies:**

- **`never` = the absence of a slot, expressed in the type system.** There is no
  `risk: 'never'` member to set, so it cannot be edited at 2am. Policy in a config
  value gets changed; policy in a type doesn't.
- **There is no `hidden`, only `collapsed`.** Content must stay reachable behind a
  disclosure the author renders — this is the structural fix for the §5.1 metric trap.
- **The compiled manifest is the schema; the database is untrusted input.** Client
  re-validates every patch against its own bundle; a mismatch renders defaults. A
  stale override after a refactor, or a compromised row, degrades to "exactly as today."
- **Publishing a manifest auto-disables overrides whose slot vanished.** Without
  this, the first refactor silently strands live overrides.
- **Copy and defaults never vary per user** — only `order` and `emphasis` do. So
  two colleagues always see the same words and the same default sort, and can talk
  about "the Runway column" and mean the same thing.
- **Change budget: one active override per page, one change per user per 7 days.**
  Muscle memory is worth more than any optimisation this agent will find.
- **Concurrent 20% holdout, sticky forever** — not before/after. Both arms live
  through the same Tuesday, the same holiday, the same unrelated deploy, so
  day-of-week and seasonality cancel by construction.
- **The escape hatch *is* the measurement.** Each user "Undo" emits
  `user_reverted`, the highest-weight guardrail; **3 reverts = automatic revert,
  no statistics involved.** The cheapest way for a user to say you're wrong is
  also the best data.
- **`?ux=off`** — the debugging primitive. "Does it repro with `?ux=off`?"
  instantly bisects agent-caused from real bugs.

**The statistical verdict, stated plainly:** detecting a 10% relative lift on a
50% baseline needs ~**800 conversions per arm**. One restaurant produces 20–50
task completions/day. *You cannot prove any of these changes helps — not one, not
ever, at this scale.* So the only honest design is **harm detection**: never claim
a win, revert aggressively (false reverts are free), and record
`kept_unproven` / `insufficient_data` rather than fabricating `improved`.

**Phase order** (only Phase 0 is recommended now): 0 secure & sanitise (1–2 d) →
1 observability only, UI provably cannot change (5–8 d) → 2 manual layouts, no LLM
(6–10 d) → 3 agent proposes / human approves (4–6 d) → 4 auto-ship (3–5 d + 8 wk
soak) → 5 per-user personalisation (needs ~10+ tenants).

Two judgements from that review worth quoting:

- *"A solo developer could stop permanently at Phase 3 and lose almost nothing.
  I'd plan to."* Phase 4 removes the human from the loop on a tool a working
  restaurant depends on during service, and buys list reordering.
- *"Phase 2 has the worst effort-to-visible-value ratio but is non-negotiable"* —
  skipping it to reach the LLM faster is the most likely way this ends badly.

---

## 8. The 30-day metric that should actually govern

**Three restaurants paying real money, and at least one logging in 4+ days a week
in week four.** Not signups, not pilots, not LOIs.

If that can't be reached, the layout was never the problem. If it can, those three
customers will say what to build next — and it will not be "the page should
rearrange itself."

---

## 9. Sources

- Direct code audit of `apps/api-gateway/src/ux-optimizer/*`,
  `apps/web/src/lib/uxSignals.ts`, `apps/web/src/hooks/useUxOverrides.ts`
- Live database audit (Supabase `exzueerziesmczwlhomd`)
- Business review (YC-partner lens)
- Failure premortem (12-month postmortem-from-the-future); every mechanism traced
  to a real defect in current code
- Architecture review of the slot/targeting contract — independently confirmed D1
  and D2 without being told about them (see §7b)
- Prior design doc: `.planning/UX_SELF_LEARNING_AGENT.md`
