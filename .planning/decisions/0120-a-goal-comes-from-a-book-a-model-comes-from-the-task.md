# 0120 — A goal is chosen from a book of scenarios; a model is chosen by the task

- **Status:** Proposed
- **Date:** 2026-09-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** goals, scenarios, benchmarks, operator ranges, model routing, task class, metering, neural_footprint_event, sonnet, haiku, reports, recommendations
- **Links:** [[0020-honesty-first]] · [[0051-absence-is-not-zero]] · [[0113-the-assistant-proposes-the-seal-applies]] · `apps/api-gateway/src/analytics/goal-scenarios.ts` · `apps/api-gateway/src/common/model-client/model-routing.ts` · `.planning/06-pages/reports.md` §13 · `.planning/06-pages/recommendations.md` §13

## Context

Two founder instructions on 2026-09-04, recorded together because they land on the
same two surfaces and one of them pays for the other.

**(a) *"Sonnet 5 for asks, all tiers, metered."*** Asked whether a quick lookup
should really pay Sonnet's rate, the founder agreed that a lookup or a help-bot
turn should use Haiku. So the rule is by task, not by surface and not by tier.

**(b) *"we're going to create possible analytic scenarios a restaurant might set
as a goal."*** The goals desk on `/reports` and the "make this a goal" panel on
`/recommendations` both open on a dropdown of six metric KEYS
(`GoalsService.SUPPORTED_METRICS`, `goals.service.ts:49-87`). A manager who
already knows they want to hold purchasing spend can find `purchase_spend`; a
manager asking "what should we be holding ourselves to?" is given a vocabulary
and no book.

Six measurements shaped both halves, and each one changed the answer:

1. **A usage ledger already exists and already records five of the six things
   the founder asked to meter.** `neural_footprint_event` (migration
   `20260824141116`) carries one row per invocation, `input_tokens`,
   `output_tokens`, `cost_usd`, `restaurant_id` and `context.model`, written by
   `ModelClientService.persistNfEvent` (`model-client.service.ts:340-460`) for
   all nine of the gateway's model sites. Only "task class" and "who asked" were
   missing, and both fit in the existing `context` jsonb. **No new table, no
   migration.**
2. **Switching to Sonnet 5 would have silently disarmed the spend ceiling.**
   `MODEL_PRICING_USD_PER_MTOK` held Haiku 4.5 and Opus 4.8 only; an
   unrecognised model writes `cost_usd = NULL` (`:474`, deliberately, so a swap
   cannot write free rows), and `retryAllowedBySpendCeiling` sums `cost_usd`
   (`:545-548`) — NULL sums as nothing. The routing change would have made the
   two `compose` calls invisible to the valve that bounds them.
3. **"Ask the book" on `/reports` calls no model at all.** `AskTheBook.tsx`
   searches the deterministic insight feed and says so; there is no free-text
   question endpoint to route. The ask paths that DO reach a model are exactly
   two: `GoalsService.proposeCuttingSpec` and `AskAiService.propose`.
4. **Published operator ranges exist for RATIOS and almost never for LEVELS.**
   The NRA publishes a median food-cost ratio (32.0% of sales, fullservice,
   2024) and a median labour ratio (36.5%); nobody publishes what a room's wine
   revenue or cover count should be, because those depend on the size of the
   room. Four of the six measures this gateway can hold a goal on are absolute
   money or counts.
5. **Most of what operators actually set goals on, this product cannot hold.**
   Prime cost, food-cost ratio, labour ratio, pour cost, waste, days of stock,
   table turns, RevPASH, vendor concentration, OTIF, cash days and staff
   turnover — twelve of the twenty-one scenarios in the catalogue — have no
   `SUPPORTED_METRICS` key.
6. **Three of those twelve are closer than they look, and one is further.**
   `/analytics/financial/:rid` already computes `cogsRatio`, `primeCostRatio`,
   `inventoryTurnover` and `daysInventoryOutstanding`
   (`analytics.service.ts:444-467`). But `primeCostRatio` is called with `labor`
   defaulting to `0` (`:396`) and **no caller in the repo passes it** (grepped
   2026-09-04: `?labor=` exists on `analytics.controller.ts:143` and neither web
   nor mobile sends it), so today's "prime cost" is a COGS ratio wearing a
   prime-cost name — and that COGS ratio's denominator is a sell-price valuation
   of purchased stock (`:432-437`), not POS revenue.

## Options considered

**For the book of scenarios**

1. **A static, hand-written catalogue in the gateway, served by one route.**
   Every row cites the operator source it took its range from, with a URL and a
   date, and a row the goals module cannot serve says so and names the measure
   it would need. Costs: someone has to keep the citations true; the list is
   opinionated.
2. **Generate scenarios with a model at runtime.** Appealing because it needs no
   catalogue and adapts to any house. Rejected on ADR 0020 and on the same
   argument `report-cuttings.ts` makes about the cutting spec: a scenario is
   rendered next to real figures, and a model that invents "hold food cost under
   28%" is stating an operator benchmark it did not read. The catalogue's whole
   value is that each range carries a source; a generated one carries a
   plausible-sounding number and no source, which is worse than no range.
3. **Pre-fill a suggested target from the range.** Rejected outright. `rec-forward.ts`
   already made this argument for the recommendations sheet — *"The rule states a
   gap, not a target — Mudavym will not invent the number your house is held
   to"* — and it binds harder here, because a scenario is generic by
   construction. A median across 900 houses in a target box is a number this
   house did not choose, sitting where a number this house chose belongs.
4. **Show only the servable scenarios.** Rejected: a picker with nine entries
   tells the founder this product covers the field. It covers nine of
   twenty-one, and the twelve it does not cover are the more useful half — each
   one is a named gap with the measure it would take.

**For model routing**

1. **One model for everything.** Simplest; one line of config. Rejected because
   the founder's own follow-up rejected it: a lookup paying Sonnet's rate is
   waste, and a cutting spec paying Haiku's rate is the composition the
   `report-cuttings` validator has to keep catching.
2. **Route by surface** ("/reports gets X, Ask AI gets Y"). Rejected: the same
   surface does different work — Ask AI's `GET /ask-ai/candidates` is a read with
   no model at all, and its `propose` composes an executable action.
3. **Route by tier** (a `pro` house gets Sonnet, a `core` house gets Haiku).
   Rejected by the founder's own words — *"all tiers"* — and on principle: the
   tier bounds SPEND (`spend-tiers.ts`), and a house on a trial credit asking the
   same question deserves the same answer.
4. **Route by task class, with per-class env overrides.** Chosen.

## Decision

**A goal is chosen from a book of scenarios, and a model is chosen by the task.**

**The book.** `apps/api-gateway/src/analytics/goal-scenarios.ts` is a pure data
catalogue of 21 scenarios, served static and tenant-free by
`GET /analytics/goal-scenarios`. Each row carries: the metric key the goals
module already serves (or `null` plus `needsMetric` naming the measure it would
take), the direction, the period, the cutting on the reports sheet that draws it
(a `CUTTING_CATALOGUE` id), the recommendation rules whose prescription moves it,
and a RANGE that is either `{kind:"published"}` with the source's own words, its
URL, its date and a per-row caveat, or `{kind:"none"}` with the reason no range
exists. **No row carries a target, and a test asserts on the KEYS so one added
later fails even if it is left undefined.** The producer that would announce a
scenario is DERIVED from direction rather than stored, because the two producers'
own filters are the truth (`goal-reached.producer.ts:121` skips `at_most`;
`ceiling-held.producer.ts:95` selects it) and a stored copy could disagree with
them. `THE_CAVEAT` — *"a range from a report is a fact about the houses in that
report, not about yours"* — is one constant on the payload, not a per-row string
that can be edited away one row at a time.

Both goal sheets offer the book **above** the metric picker. It fills the name,
the measure, the direction and the period; the target stays empty and asked.
Unservable scenarios are listed and `disabled`, each naming the measure it would
need. On `/recommendations`, where the rule has already chosen the measure, the
book is an OVERRIDE and it states its cost: a goal swapped onto a different
figure drops `source_rule_key`, so that entry will not show as watched, and the
sheet says so before the button is pressed.

**The routing.** `apps/api-gateway/src/common/model-client/model-routing.ts`
maps three task classes to models — `lookup` → Haiku 4.5, `help` → Haiku 4.5,
`compose` → Sonnet 5 (`claude-sonnet-5`) — with precedence
**site env var → class env var → class default**, so an operator who already set
`ASK_AI_MODEL` or `GOAL_CUTTING_MODEL` on a running gateway keeps their
instruction. The two live sites are both `compose`. `claude-sonnet-5` was added
to the pricing table in the same change, and `isModelPriced` is exported so a
test can assert that no class routes to a model the cost ledger cannot price.

**The metering.** Three explicit keys on the existing NF row's `context`:
`task_class`, `model_routed_by` and `asked_by`. They are written as literal keys
at each call site rather than spread from a helper's return, so the row's shape
is readable from the source. `asked_by` is `null` — never a placeholder string —
when the site cannot name who asked, because an absent key means "this row
predates the field" and a null means "we recorded that we do not know".

## Consequences

- **Easier:** a manager can browse what a restaurant might hold itself to, with
  the operator source beside each one, without leaving the goal form. The twelve
  gaps become a visible, ordered work list rather than an absence. Model choice
  is one file, auditable per call from the ledger, and changeable per class
  without a deploy.
- **Harder / given up:** the catalogue's citations need re-verifying — a URL
  that moves or a report that is superseded is a stale quotation with a
  confident date on it, and nothing in CI can check that a page still says what
  it said. The two `compose` calls cost twice as much per token (Sonnet 5
  $2.00/$10.00 vs Haiku 4.5 $1.00/$5.00); both are small (400 and 1024 max
  output tokens) but a `core` house is on a $5 credit that does not reset.
- **Deliberately not done:** `ConsultantsService` keeps Opus and is not routed —
  the founder's decision does not cover deep analysis, and silently changing the
  model on the most expensive call in the gateway is not a decision to take in
  passing. The `lookup` and `help` classes are declared with no call site today;
  they exist so the next one lands routed instead of hand-picked.
- **Revisit when:** a `SUPPORTED_METRICS` entry is added (the parity test will
  demand a scenario for it); or `context.task_class` shows a class whose spend
  no longer matches the work it does; or an operator source in the table
  publishes a newer edition.

## Founder questions this leaves open

1. **The dated Haiku pin.** The founder wrote `claude-haiku-4-5-20251001`; the
   repo also uses the undated `claude-haiku-4-5` (`ASK_AI_MODEL`'s default), and
   Anthropic's own model table lists the undated id as canonical. Standardise on
   one, and which?
2. **The consultant's Opus call.** Fourth class, or fold it into `compose`?
3. **Which of the twelve gaps to close first.** `days_of_inventory` is nearest
   (the figure is computed; only a `SUPPORTED_METRICS` entry is missing);
   `prime_cost_pct` and `labour_cost_pct` need a labour feed that does not exist
   anywhere in this gateway.
4. **Whether a house may add its own scenario.** The catalogue is ours today. A
   tenant-authored scenario is a different object (it would need a metric key it
   cannot invent) and needs its own decision.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-04 | — | Created (Proposed) |
