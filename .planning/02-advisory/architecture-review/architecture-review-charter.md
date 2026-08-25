---
type: charter
division: advisory
department: architecture-review
status: new
metrics: [arch.layer_violations_open, arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.duplicated_invariants, arch.diverged_invariant_count, arch.direct_provider_callsites, arch.layer_bypass_callsites]
updated: 2026-08-24
links: ["[[architecture-review-premortem]]", "[[architecture-review-agenda-full]]", "[[architecture-review-agenda-board]]", "[[architecture-review-directive]]", "[[architecture-review-loops]]", "[[architecture-review-schedule]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[engineering-charter]]", "[[data-charter]]", "[[reliability-sre-charter]]", "[[ai-orchestration-charter]]", "[[skills-charter]]", "[[product-vision-charter]]", "[[design-charter]]", "[[partnerships-integrations-charter]]", "[[security-charter]]", "[[research-math-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[schema-migrations-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[messaging-delivery-charter]]", "[[agent-fleet-charter]]", "[[agent-evaluation-gates-charter]]", "[[model-routing-inference-economics-charter]]", "[[action-safety-the-human-gate-charter]]", "[[legal-charter]]", "[[ORG_STRUCTURE]]", "[[README]]", "[[ENDPOINTS]]", "[[EXTERNAL_CONNECTIONS]]", "[[PAGE_MAP]]"]
---

# Architecture Review — Charter

Advisory function. **Sits outside the line** ([[ORG_STRUCTURE]] §3, [ADR 0007](../../decisions/0007-org-structure.md)).
No parent division. Siblings: [[red-team-charter]], [[decision-office-charter]].

## Mandate

Architecture Review owns **one rule**: the L0–L6 layer stack in [[README]] §1, where
*each layer may only depend on layers below it*. It reviews all of **Platform**,
**Applied AI**, and **Product** against that rule and writes findings. It builds
nothing, fixes nothing, and blocks nothing.

> ⚠️ **The mandate's wording is stale, and the gap is not cosmetic.**
> [[ORG_STRUCTURE]] §3 still reads *"All of Technology + Product"* — but Technology was
> split into **Platform** and **Applied AI** (§2), and **Research & Math** was promoted
> to a division of its own on 2026-08-24. Read literally, the scope now excludes
> Research & Math and Intelligence. **AR-4 — the finding that L4 cannot be joined — is
> addressed to [[neural-footprint-instrumentation-charter]], which sits in Research &
> Math and is therefore outside the mandate as written.** L4 is a *layer*; a layer stack
> reviewed everywhere except at its metric spine is not reviewed. Raised as a scope
> question, not resolved here → [[architecture-review-agenda-full]] §Questions #7.

It sits outside the line for a reason that is worth stating precisely, because it is
the entire justification for the function's existence:

> **A layer violation is structurally invisible to the department that commits it.**
> Both sides of a violation are locally correct. The web team writing a Supabase query
> in a React hook is shipping the feature it was asked for; the gateway team owning the
> same table in a NestJS service is doing the same. Neither is looking at the pair.
> Nobody inside either department has the vantage point from which the pair is visible,
> and no amount of diligence inside a department produces it.

Every finding in §Evidence below was committed by someone doing their job well. That is
the shape of the defect class, and it is why review has to be someone's whole job rather
than everyone's good intention.

## Boundaries

Owns outright:

- **The rule.** [[README]] §1's L0–L6 stack — its interpretation, and the layer
  assignment of code that does not obviously belong to one layer. A rule with no
  interpreter is a wall poster.
- **The finding log** — what has been found, when, at what severity, and **how old it
  is**. Age is a first-class field, not metadata; see [[architecture-review-premortem]] #1.
- **The invariant census** — the recurring question *"this rule must hold; where is it
  actually enforced, and is it enforced the same way in every place?"* This is the only
  method that finds the violations an import graph cannot see, and one of them is
  already live below (AR-2).
- **The severity ladder** — what counts as Sev-1 vs Sev-2 vs Sev-3
  ([[architecture-review-directive]]).
- **Proposing amendments to the stack itself.** The rule is a claim, not a law. If it is
  repeatedly argued down on the same seam, the finding is against the rule.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| **Fixing anything.** Ever. | The reviewed unit | We write; they fix. This function has no build capacity **by design** — capacity would create an incentive to review the things it wants to build |
| **Blocking or approving** a change | Nobody. Findings-only is **locked** (OD-16, [ADR 0007](../../decisions/0007-org-structure.md)) | The founder arbitrates. This is not a gate and must not be written as one |
| Whether a boundary is **exploitable** | [[security-charter]] *(Intelligence, in the line)* | We say *"L6 reaches L0 directly."* They say *"and here is what an anonymous caller does with it."* Same file, different question |
| Whether a **decision** is wrong | [[red-team-charter]] | We attack structure. They attack decisions and do premortem thinking ([[ORG_STRUCTURE]] §3) |
| Whether a decision **closed** | [[decision-office-charter]] | They own the ADR log, the open-decision queue, and close-times. We are one of their loudest inputs |
| What NF-A **means**; doneability methodology | [[research-math-charter]] | We find that L4 *cannot be computed* (AR-4). They define what it would say if it could |
| Which **model** runs a task, at what price | [[model-routing-inference-economics-charter]] | We find that seven callsites each hand-roll the same client (AR-3). Convergence is theirs to design |
| Code quality, naming, test coverage, performance | The reviewed units | A well-tested layer violation is still a violation; a badly-named legal dependency is not our finding. **Reviewing everything is reviewing nothing** |
| Guest-facing product judgement | [[product-vision-charter]], [[design-charter]] | We review Product's *structure*, not its taste |

### The overlap that will actually bite — three advisors, one `path:line`

[[security-charter]], [[red-team-charter]] and this function will land on the same file.
The resolution rule, stated now so it is not negotiated per-incident:

**The finding goes to whichever function's metric it moves.** If it moves two, **one
finding is written and the other function cross-links it.** Never two findings against
one `path:line` in one sweep — a duplicated finding is the same defect this function
exists to catch, committed by the reviewers.

## Metrics it moves

This function does not move a product metric. It moves **the number of places where the
dependency rule does not hold**, and — more importantly — **how long it takes for that
number to change after someone is told.**

| Metric | What it is | Value today |
|---|---|---|
| `arch.layer_violations_open` | Open findings by severity | **7 at founding** (below); no log exists to hold them |
| `arch.finding_age_days_max` | Age of the oldest open finding, in days | **The anti-theatre number.** 0 today because nothing has been raised |
| `arch.findings_closed_by_decision_ratio` | (fixed **or** accepted in writing) ÷ raised | Undefined. Target: **not 1.0** — see below |
| `arch.duplicated_invariants` | One rule enforced in ≥2 places | ≥3 known (AR-2, AR-5, AR-6) |
| `arch.diverged_invariant_count` | …of those, how many have **already** drifted apart | **1, verified** (AR-2) |
| `arch.direct_provider_callsites` | Callsites hand-rolling a model provider | **7** (AR-3) |
| `arch.layer_bypass_callsites` | L6 code reaching L0 without passing L1/L2 | **2 files, 5 statements** (AR-1) |

**No roll-up number, and a deliberate anti-target.** `findings_closed_by_decision_ratio`
at 1.0 would mean every finding this function raises is agreed with, which means it is
finding only the uncontroversial things. A healthy ratio has **accepted-in-writing** in
the numerator: *"yes, this is a violation; we are keeping it, here is the owner and the
date we revisit."* That is a successful outcome. Silence is the only failure.

## Evidence today

**Grade: NEW. Entirely.** There is no equivocating available here:

- **NEW — no finding log, no findings.** Nothing in the repo records an architectural
  finding against a unit.
- **NEW — no destination for a finding.** [[ORG_STRUCTURE]] §3 says findings land in the
  reviewed unit's `questions.md`. `find .planning -name questions.md` returns **nothing**,
  and the 7-artifact anatomy ([[ORG_STRUCTURE]] §4) does not create one. See AR-0.
- **NEW — no layer assignment.** [[README]] §1 names L0–L6 and gives each layer a
  sentence. No document maps a **directory** to a layer, so "is this a violation" has no
  mechanical answer yet.
- **NEW — no boundary check in CI.** One layer boundary in the whole repo has a running
  check, and it belongs to [[schema-migrations-charter]], not to us (AR-6).
- **PARTIAL — the rule itself exists**, in [[README]] §1, and is stated well:
  *"Each layer may only depend on layers below it. This is the single rule that keeps
  modules independently buildable."* A rule with no interpreter, no log, and no check.

**What this function has instead of a track record is a backlog.** Seven findings, each
verified against source this session. They are the strongest evidence available that the
function is needed, and none of them is evidence that it works.

---

### AR-0 · Sev-1 · A finding has nowhere to land — *against this function's own charter*

[[ORG_STRUCTURE]] §3 routes advisory findings to a unit's `questions.md`; §4's unit
anatomy creates seven files and none of them is `questions.md`. No such file exists
anywhere in `.planning/`. Every generated unit does have an
`agenda-full.md` → *"## Questions for the founder"* section, which is where open
questions actually accumulate today.

**Why Sev-1:** this is not pedantry about a filename. Findings-only authority means the
*only* thing this function produces is a written finding. A function whose sole output
has no defined destination has not been implemented, however many documents it has.
→ [[decision-office-charter]], `OPEN-DECISIONS.md`.

### AR-1 · Sev-1 · L6 reaches L0 directly, skipping L1, L2, and the gateway

`apps/web` (L6 Surfaces) queries and mutates Postgres tables straight from the browser:

- `apps/web/src/lib/supabase.ts:16-18` — an anon-key client, falling back to a
  placeholder client when unconfigured rather than failing.
- `apps/web/src/hooks/queries/useSommelierQueries.ts:25-26` (select), `:42-43` (upsert),
  `:56` (delete) on `sommelier_conversations`.
- `apps/web/src/hooks/queries/useReportQueries.ts:25-26` (select), `:36-37` (delete) on
  `generated_reports`.

The same `generated_reports` table is **also** owned at L2 by the gateway
(`apps/api-gateway/src/reports/reports.service.ts:54,72,100`, service-role). So one table
has two access paths at two layers under two different security models — RLS for the
browser path, `TenantGuard`/service-role for the gateway path.

**And the browser path's model is empty.** `generated_reports` has RLS enabled
(`supabase/migrations/20260805000000_baseline_from_production.sql:14383`) and **zero
`CREATE POLICY` statements anywhere in `supabase/migrations/`**. Under RLS, no policy
means no rows — the hook's `fetchReports` gets `[]` and no error, so it fails **silently
and looks like an empty state**. (`sommelier_conversations` does have policies, at
`:13897` and `:14017` — which is what makes the pair a *review* finding rather than a
uniform pattern: two adjacent hooks written the same way, one of which happens to work.)

→ [[client-surfaces-charter]], [[platform-api-charter]], [[schema-migrations-charter]];
exploitability to [[security-charter]].

### AR-2 · Sev-1 · One legal invariant, two runtimes, **already diverged**

`apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:44-48` states in a
comment that its commitment-detection guardrail is *"Ported verbatim from
services/agent-orchestrator/agents/provider_conversation_agent.py"*. The guardrail's job,
per the same comment, is UCC contract-formation risk: a draft matching any pattern
*"must NEVER auto-send."*

Counted this session:

| Copy | Location | Patterns |
|---|---|---|
| TypeScript (L2/L6, gateway) | `inbound-responder.service.ts:49-70` | **19** |
| Python (L3, agent) | `provider_conversation_agent.py:120-129` | **8** |

The TS copy has gained eleven patterns the Python copy never received — including
`place the order`, `go ahead and ship`, and the entire FR/IT/ES/DE multilingual set that
matters most in the fine-dining wine trade. **"Verbatim" has not been true for some
time.** The same guardrail is strictly weaker on the Python path, and nothing in the repo
would ever say so.

**Why this is the archetypal finding for this function.** No import scan finds it. No
test fails. Both files are correct in isolation, both teams behaved well, and the person
who added the French patterns to TS had no reason to know a second copy existed. This is
what the invariant census is for, and this finding is its seed case.

→ [[messaging-delivery-charter]], [[agent-fleet-charter]]; legal exposure to
[[legal-charter]]; the never-auto-send guarantee to [[action-safety-the-human-gate-charter]].

### AR-3 · Sev-2 · L3/L4 coupling — seven callsites, seven hand-rolled clients

Anthropic and Gemini are called over **raw HTTP, not their SDKs**
([[EXTERNAL_CONNECTIONS]]: *"Anthropic and Gemini appear as hosts but not as SDK
imports"*). Seven files in `apps/api-gateway/src` each declare their own endpoint
constant: `analytics/consultants.service.ts:28`,
`common/orchestrator/inbound-responder.service.ts:16`, `inventory/photo-count.service.ts:9`,
`menus/parsers/scan-parser.service.ts:10`,
`procurement/documents/document-extractor.service.ts:27`,
`ux-optimizer/ux-optimizer.service.ts:44`, `vendor-intel/vendor-page-extractor.service.ts:13`.

Retry, timeout and cost accounting are therefore per-callsite policy rather than layer
policy, and they do not agree:

| Callsite | Timeout | Retry |
|---|---|---|
| `consultants.service.ts` | **none** | none |
| `document-extractor.service.ts` | **none** | none |
| `ux-optimizer.service.ts` | **none** | none |
| `photo-count.service.ts:88` | 30 s | none |
| `inbound-responder.service.ts:768` | 60 s | none |
| `vendor-page-extractor.service.ts:86,144,192` | 8 s / 20 s / 120 s | none |
| `scan-parser.service.ts:301` | 180 s | **yes** — `:135-142`, splits into page-range chunks on truncation |

Exactly one of seven can recover from a failure. Three of seven have no timeout at all.
**The layer finding is not "no SDK"** — an SDK is one fix among several. It is that a
capability which belongs to L3 (the agent harness) is implemented seven times inside L6/L2
callsites, so L4 has no single place to attach to. AR-4 is the direct consequence.

→ [[model-routing-inference-economics-charter]], [[platform-api-charter]].

### AR-4 · Sev-1 · L4 emits nothing here, and cannot be joined there — **CLOSED 2026-08-25**

> **Corrected 2026-08-25 (P1).** Both halves below are fixed and the finding is
> historical: the NestJS side emits `neural_footprint_event` from all seven callsites
> via `common/model-client` (`model-client.service.ts:413`), and the Python side now
> carries the join keys — `SpendLogger.log()` takes `agent` and `correlation_id`
> (`services/agent-orchestrator/services/spend_logger.py:269,276`) and writes the same
> NF store (`:406`). See `.planning/STATE.md`. What remains open is verdict coverage
> ([[0017-doneability-verdicts-are-sidecar-claims]]), not emission or joinability.

[[README]] §1 grades L4 *"emits nothing yet."* Verified two ways, and the second is worse
than the first:

1. **NestJS side: zero.** `grep -rn "api_spend|cost_usd|input_tokens" apps/api-gateway/src`
   returns **0 hits**. All seven callsites in AR-3 spend money and record none of it.
2. **Python side: the two halves cannot be joined.** Both tables exist and both are
   written, but they were designed for different questions and share no key:

   | Table | Has | Lacks |
   |---|---|---|
   | `decision_log` (`baseline…sql:2687-2698`, written at `core/base_agent.py:745-784`) | `agent_name`, `reasoning`, `confidence`, `correlation_id` | tokens, model, **cost** |
   | `api_spend` (`baseline…sql:2231-2240`, written at `services/spend_logger.py:41-48`) | `provider`, `model`, tokens, `cost_usd` | agent, task, `correlation_id`, **verdict** |

   `SpendLogger.log()` takes no `agent` parameter (`spend_logger.py:41-48`), and
   `api_spend` has no `correlation_id` column. So *"what did this agent's reasoning
   cost?"* — the founding question of NF-A ([[README]] §4.1–4.2) — **cannot be answered
   by a query.** The reasoning is in one table, the cost is in another, and no column
   connects them.

**The layer claim:** [[README]] §1 puts L4 beneath L5 precisely so departments are
evaluated by a common spine. A spine that cannot be joined is not a spine. This is the
single most consequential structural defect in the repo, and it is invisible from inside
either department, because each table is correct for the purpose it was built for.

→ [[neural-footprint-instrumentation-charter]], [[research-math-charter]],
[[model-routing-inference-economics-charter]].

### AR-5 · Sev-1 · The tenant invariant is a per-controller convention, not an architecture

`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` returns `true` when there is no
authenticated user — deliberately, with a logged warning:

```ts
// If no authenticated user, allow through — JwtAuthGuard should enforce where required.
if (!user?.restaurantId) { … return true; }
```

The comment is honest and the code does what it says. The **architectural** consequence
is that multi-tenant isolation holds only where a second, independent decorator was
remembered. [[ENDPOINTS]] measures the result: **137 of 448 endpoints carry no
`JwtAuthGuard`**; after subtracting 32 webhook routes and 11 explicit `@Public()`, **94
are unguarded by omission** — 39 of them in `analytics` alone. *Corrected 2026-08-25:
stale as a present count — the primary controllers of all six named modules now carry a
class-level `@UseGuards(JwtAuthGuard)` (`analytics.controller.ts:51` and peers). Not
recounted route-by-route, so no replacement figure is asserted.*

**This is the shape of defect this function exists to catch, and it is worth being exact
about the division of labour.** OD-19 and OD-20 already track the *security* question:
which endpoints are real gaps, and the live `claude-opus-4-8` spend exposure at
`analytics.controller.ts`. Those are [[security-charter]]'s. **Ours is the different
question underneath**: an invariant that every layer depends on is enforced by convention
at one layer and by nothing at any other. Classifying 94 endpoints closes the incident;
it does not change the fact that endpoint number 449 will be unguarded by default.

→ [[security-charter]] (OD-19/OD-20, exploitability), [[platform-api-charter]] (the
invariant's shape).

### AR-6 · Sev-3 · The one boundary with a running check — and the precedent behind it

`scripts/check_schema_parity.sh:6-11` records what happened the last time a layer
boundary went unpoliced:

> *Before the 2026-08-05 baseline, production had drifted so far from this repo that a
> fresh database could not be built at all: 27 tables, 403 columns and 13 functions
> existed ONLY because DDL had been applied by hand.*

The script continues (`:9-12`) that those 13 functions were *"business logic with no
source anywhere — `calculate_sales_velocity`, `resolve_sku_to_inventory` — which would
have silently vanished had the database ever been rebuilt from migrations."*

**Graded Sev-3 because it is fixed**, and it is in this charter for two reasons. First,
it is the precedent: a boundary erodes silently, one reasonable hand-applied change at a
time, until it fails catastrophically and all at once. Second, it is the **template** —
`check_schema_parity.sh` is the only mechanism in the repo that closes a layer-boundary
loop automatically, and every check this function proposes should be built in its shape:
rebuild from the source of truth, diff against reality, exit non-zero.

→ [[schema-migrations-charter]] owns it. We read it.

---

## Open forks touching this function

- **AR-0 / the destination fork** — `questions.md`, or the reviewed unit's
  `agenda-full.md` §Questions? Needs an answer **before the first sweep**, not after.
  → [[decision-office-charter]].
- **The evaluation seam** — [[agent-evaluation-gates-charter]] (AI Orchestration,
  operations) vs [[evaluation-doneability-charter]] / [[research-math-charter]]
  (Research & Math, methodology). Numbered **OD-21** at `teams/technology.md:845`, which
  **collided** with the real OD-21 (Obsidian structural workflow,
  `OPEN-DECISIONS.md:25`, already locked); now **TECH-F3** ([[FORK-REGISTRY]]). This function's position: the seam is a
  **layer-ownership question about L4**, it is exactly the kind of overlap that resolves
  into duplication if left alone, and the instruction already on record is the right one —
  **if the line fails, merge; never duplicate.** We do not pick which side absorbs the
  other. → [[decision-office-charter]] issued the ID (**TECH-F3**); founder for the seam.
- **OD-26 — do structures only ratchet upward?** Raised by the Legal generator: 11 units
  carry split triggers, 3 carry merge triggers. This function carries a **merge trigger**
  ([[architecture-review-premortem]] #1) and believes the symmetric rule should be
  standing. We are a natural test case: an advisory function that produces no closed
  decisions is pure overhead.
- **OD-11 / L4 schema detail** — AR-4 is unfixable until the NF column contract exists.
- **OD-19 / OD-20** — AR-5's incident half. Not ours; named so the seam is legible.
