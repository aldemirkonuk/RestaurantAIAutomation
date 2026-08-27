---
type: division-teams
division: intelligence
status: proposed
date: 2026-08-24
departments: [research-and-math, security, analytics-and-bi]
team_count: 9
links:
  - "[[ORG_STRUCTURE]]"
  - "[[README]]"
  - "[[ENDPOINTS]]"
  - "[[OPEN-DECISIONS]]"
keywords: [teams, intelligence, nf-a, nf-b, harness, evaluation, security, analytics]
---

# Intelligence Division — Team Layer

- **Status:** PROPOSED. The division and its three departments are LOCKED
  ([ORG_STRUCTURE §2](../ORG_STRUCTURE.md)); the team layer below is not.
- **Scope:** the third row of `Division → Department → Team`. Nine teams across
  three departments.
- **Companion:** every team here inherits the 7-artifact unit anatomy
  ([ORG_STRUCTURE §4](../ORG_STRUCTURE.md)) *only if* OD-17 resolves that way. A team is
  a charter and a metric first; it earns documents by doing work, not by existing.

---

## 0. The bar a team had to clear

Four gates. A candidate that failed any one of them is in §5 (rejected), not in §1–§3.

1. **Crisp sibling boundary.** One sentence naming what its sibling would do wrong
   if it absorbed this scope. "Related but different" is not a boundary.
2. **Evidence in the repo.** `EXISTS` (code on `main`), `PARTIAL` (half-built, cited),
   or `NEW` (nothing yet — and then it must cite the artifact that demands it).
3. **One primary metric it can lose on.** Tied to the neural footprint
   ([foundation §4.2](../README.md)) where the subject is an agent or a guest.
4. **A premortem line.** How it dies. Written before it starts (ORG_STRUCTURE §4).

---

## 1. Research & Math — 3 teams

**Department mandate** ([foundation §2.2](../README.md)): harness quality,
task-doneability, cost efficiency, NF-A.

The three teams are the three verbs that mandate implies: **build the runner**,
**grade the runner**, **record what the runner did**. Those are different jobs done
by different people with different tools, and — critically — a team that both runs
and grades its own harness grades its own homework. That is the same argument
ORG_STRUCTURE §3 uses to put Red Team outside the line.

### RM-1 · Harness & Model Routing

**Mandate.** Own the single boundary through which this codebase talks to a model:
the harness choice (OD-03), the call wrapper, retry/timeout/circuit-breaking, and
cheapest-capable-model routing (OD-04).

**Why distinct from siblings.** RM-2 decides *whether an output was good enough*;
RM-1 decides *how the output was produced and what it cost to produce*. If RM-2
absorbed this it would optimise the scorecard by spending more — the exact failure
the cost-efficiency mandate exists to prevent.

**Evidence — PARTIAL.**
- In-house candidate is real and non-trivial: `services/agent-orchestrator/core/base_agent.py`
  (1,053 lines) already carries retry with exponential backoff
  (`base_agent.py:224-225`, `_process_with_retry` at `:543`), idempotency
  (`:704`), DLQ (`:791`), and saga compensation (`:823-905`) across **27 agent
  modules** in `services/agent-orchestrator/agents/`.
- But that harness governs the *Python* side only. The **7 production model
  callsites in NestJS bypass it entirely**, each hand-rolling its own `fetch` to
  `https://api.anthropic.com/v1/messages`:
  `apps/api-gateway/src/analytics/consultants.service.ts:28`,
  `apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:16`,
  `apps/api-gateway/src/procurement/documents/document-extractor.service.ts:27`,
  `apps/api-gateway/src/menus/parsers/scan-parser.service.ts:10`,
  `apps/api-gateway/src/inventory/photo-count.service.ts:9`,
  `apps/api-gateway/src/vendor-intel/vendor-page-extractor.service.ts:13`,
  `apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts:44`
  (plus `scripts/enrich_wines.py:52`, `scripts/extract_menu_corpus.py:47`).
- **Of those seven, only `scan-parser.service.ts` contains any retry/backoff at all.**
  `consultants`, `document-extractor` and `inbound-responder` have zero — a 429 or a
  529 from the API surfaces to the user as a failed extraction.
- Model choice is scattered across five independent conventions: two hardcoded
  literals (`photo-count.service.ts:60`, `scan-parser.service.ts:261`), one module
  constant (`inbound-responder.service.ts:21`), and three separate env vars
  (`ANALYTICS_CONSULTANT_MODEL`, `DOCUMENT_EXTRACTION_MODEL`,
  `ANTHROPIC_EXTRACTION_MODEL`). There is no routing policy; there are seven local ones.
- This is the surface foundation README:49 already assigned to this department.

**Primary metric.** `nf_a.cost_per_completed_task` — USD per task carrying a
*passing* doneability verdict (not per API call; a retried failure is cost with no task).
Secondary: `nf_a.harness_overhead_ms` (wall-clock minus model time) — the number that
actually decides OD-03, since all three candidates can call an API.

**Premortem.** OD-03 is settled by reputation instead of by a bake-off on this repo's
own workloads, a harness is adopted, and the seven NestJS callsites are never migrated
onto it — so the org now maintains two harnesses and measures neither. The tell:
a decision record for OD-03 that cites GitHub stars and no latency table.

### RM-2 · Evaluation & Doneability

**Mandate.** Define what "done" means per task type, build the golden sets and
adversarial negatives that test it, and own the CI gates that block regressions —
including the anti-sprawl audit of the skill layer (`foundation §3.3`).

**Why distinct from siblings.** RM-1 owns the producer, RM-3 owns the recorder. RM-2
is the only team whose output is a *verdict*, and it must be able to fail RM-1's
harness. Merging it into RM-1 makes `task_success_rate` self-reported, which is
precisely the defect `v3.0-TECH-DEBT.md:127` (§44.2, "Hollow features that report
success") already names as a live problem class in this repo.

**Evidence — PARTIAL, and the strongest existing culture artifact in the codebase.**
- `scripts/eval_merge_policies.py` + `datasets/merge_eval/` (946KB `entries.json`,
  `adjudicated.json`, `manifest.json`) is a working falsification harness. Per
  `scripts/eval_guest_merge_policies.py:1-30`, the beverage identity key was tested
  against **732,874 free known-distinct pairs** and that test **killed three earlier
  designs, one of which committed 212 false merges**.
- `scripts/eval_guest_merge_policies.py` is the same gate for guests, deliberately
  **shipped before the data exists** ("a gate added after the data is a gate written
  by someone who already knows what the data looks like"), with a pass condition of
  exactly zero because a false guest merge is a disclosure, not a data-quality error.
- What is missing is everything else: `.planning/v3.0-TECH-DEBT.md:326-330` (§44.11
  "AI Eval Suites") specifies golden datasets and weekly CI evals with cost caps for
  wine extraction, email intelligence, agent decisions and analytic answers — and
  notes it **depends only on Phase 37, which is satisfied, so it is plannable now**
  and does not wait on the SimPOS simulator.
- Doneability criteria are asserted nowhere. `base_agent.py:144` computes a
  `success_rate`, but "success" there means *the message handler did not raise* —
  a definition under which a confidently wrong extraction is a success.

**Primary metric.** `nf_a.verified_task_success_rate` — success as scored by an
independent verdict, reported *alongside* `base_agent`'s self-reported rate. The gap
between the two is the team's real product. Hard gate inherited: false-merge count = 0.

**Premortem.** The golden sets are written by the same session that wrote the code
they grade, so they encode the author's imagination rather than reality — the failure
`eval_guest_merge_policies.py` explicitly calls out ("a policy self-graded against
probes its own author imagined"). Second-order: cost caps are omitted from the weekly
CI eval and the suite gets disabled the first month it costs more than it caught.

### RM-3 · Neural Footprint Instrumentation

**Mandate.** Own the NF event contract end to end — schema, emission, join keys,
retention — for every `subject_type`, so NF-A and NF-B remain one object rather than
two dashboards sharing a name (`foundation §4.1`).

**Why distinct from siblings.** RM-1 and RM-2 are both *clients* of the footprint —
one emits, one reads. Neither can own the contract without bending it toward its own
query pattern. This is plumbing with a schema decision attached (OD-11 is open), and
its failure mode — events that exist but cannot be joined — is invisible to both
siblings until someone tries to answer a question.

**Evidence — PARTIAL, and the halves do not meet.**
- The *reasoning* half exists: `base_agent.py:743-784` `log_decision()` writes
  `agent_name`, `decision_type`, `inputs`, `reasoning`, `output`, `confidence`,
  `correlation_id` to `decision_log`. That is a genuine `stimulus → internal state →
  choice` trace, which is the hard part of `foundation §4.4`.
- The *cost* half exists separately: `services/agent-orchestrator/services/spend_logger.py:41-77`
  writes `input_tokens`, `output_tokens`, `cost_usd` to `api_spend`.
- **Neither table carries the other's fields, and neither carries a doneability
  verdict or latency.** Of the eight NF-A fields named in `foundation §4.2` (task
  type, model, tokens, latency, retries, tool calls, verdict, cost), no single row
  anywhere holds more than four.
- **The NestJS side emits nothing at all.** Grepping `apps/api-gateway/src` for
  `api_spend`, `cost_usd` or `input_tokens` returns **zero hits** — so the seven
  production model callsites in RM-1's evidence run with no cost telemetry whatsoever.
- NF-B substrate is further along than NF-A: `supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`
  ships `guests` (:40), `guest_identifiers` with peppered `channel_hash` (:122, :195, :369),
  `guest_check_links` (:206), `erased_at` for erasure (:112), and the
  `guest_copresence_negatives` view (:532).

**Primary metric.** `nf_a.event_completeness` — share of model invocations that emit
one joinable event carrying all eight NF-A fields. Honest baseline today: **0% for
the NestJS surface**, partial for Python across two unjoined tables.

**Premortem.** OD-11 stalls on the column-level contract, so each team instruments
"temporarily" against its own table — and by the time the schema lands there are five
private footprints and no appetite to migrate. Second tell: `subject_type` ships with
only `agent` and `guest`, and the first operator-behaviour question (§3, AB-2) has
nowhere to land.

---

## 2. Security — 3 teams · ⚠️ **fewer is correct at v0**

**Department mandate** ([foundation §2.3](../README.md)): the §12C checklist plus a
live defect register that is already actionable.

### ⚠️ Read this before staffing three teams

SEC-1 and SEC-2 are **one campaign until OD-19 closes**. Classifying 137 unguarded
routes, guarding the real gaps, verifying the genuinely-public ones, and adding the CI
recurrence guard is a single sweep through a single file set. Splitting it into two
teams now installs a handoff seam in the middle of one sprint. **Recommendation: staff
SEC-1 and SEC-2 as one team holding two charters; split when the endpoint campaign
ships and the work becomes steady-state.** They are written separately below because
the charters really are different once that campaign is over — not because two teams
should start today.

SEC-3 is different in kind and should exist from day one regardless.

### Correction the department inherits on day one

The corpus circulates **"~86"** non-webhook endpoints lacking `JwtAuthGuard` and **≈51**
webhook routes (`technology.md:257`), while `foundation README.md:33-37` and
OD-19 (`OPEN-DECISIONS.md:30`) put those two at **94** and **32**. Summing `ENDPOINTS.md`'s
own per-module ⚠️ counts gives a third pair of numbers:

| Class | Modules | Routes |
|---|---|---|
| Needs classification | `analytics` 39 (`ENDPOINTS.md:10`), `notifications` 24 (`:300`), `communications` 18 (`:144`), `dashboard` 8 (`:197`), `contacts` 8 (`:167`), `procurement/recurring-orders` 6 (`:428`) | **103** |
| Labelled "webhook" | `simpos` 11 (`:536`), `toast` 10 (`:603`), `pos-hub` 10 (`:355`), `vendor-portal` 2 (`:656`), `inbound-email` 1 (`:120`) | **34** |
| | | **137** ✓ (`ENDPOINTS.md:6`) |

**The backlog is 103, not 86.** Correcting OD-19 is the first deliverable, because a
classification task that starts from the wrong denominator cannot report completion.

> **Superseded 2026-08-26.** OD-19 was re-measured against the current tree and its
> `137 − 32 − 11 = 94` arithmetic struck: **459** route decorators, **40** routes on the
> five controllers carrying no class-level `@UseGuards`, most of them public by intent.
> The denominator this section corrects is two guard-sweeps old. `ENDPOINTS.md` has
> **not** had the same correction and is still the stale atlas the row names.

### SEC-1 · Access Control & Tenant Isolation

**Mandate.** Own who is allowed to reach an authenticated route and whose data they
see: `JwtAuthGuard` coverage, `TenantGuard` semantics, RLS, and the CI check that
makes the whole defect class non-recurring.

**Why distinct from siblings.** SEC-1 governs *identity inside the app*; SEC-2
governs *traffic that legitimately has no identity*. The controls do not overlap —
a guard cannot secure a webhook and an HMAC cannot scope a tenant.

**Evidence — EXISTS (the defect), NEW (the team).**
- `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` returns `true` when
  there is no authenticated user, by design, logging a warning. Auth therefore
  depends entirely on each controller remembering `JwtAuthGuard` — 103 non-webhook
  routes currently do not.
- The class has already recurred twice: the `/ux/*` hole (closed —
  `ux-optimizer.controller.ts:55`) and `one-tap-actions` (`v3.0-TECH-DEBT.md:62-75`,
  §44.1a: no `@UseGuards`, `restaurantId` taken from the URL path, `userId`
  hardcoded `"system"`). Two independent instances of one pattern is the definition
  of systemic.
- Auth-context placeholders compound it: `v3.0-TECH-DEBT.md:262` (§44.6) —
  `ManualOverrideModal.tsx:112-113` hardcodes `managerId:'MGR_001'`, so an override
  ledger where every entry names the same fake manager is not an audit trail.

**Primary metric.** `unguarded_authenticated_surface` — count of non-webhook routes
reachable without a JWT. **Baseline 103 → target 0**, with a CI assertion so the
number cannot silently rise. Feeds NF-A indirectly: an unauthenticated write is an
agent action with no attributable subject, i.e. an unrecordable footprint.

**Premortem.** The 103 are classified in one heroic pass, the CI check is deferred
to "after the fix", and the count starts climbing again with the next controller —
producing a third instance of a defect class this org has now documented twice.

### SEC-2 · Perimeter & Ingress Integrity

**Mandate.** Own every unauthenticated request that is *supposed* to be
unauthenticated: webhook signature verification, public-content routes, CORS,
rate limiting, and secrets handling.

**Why distinct from siblings.** SEC-1's answer to an unauthenticated request is
"reject it." SEC-2's is "accept it, and prove it came from who it claims." Merging
them means the second question gets answered with the first team's tool, which is
how a webhook ends up behind a JWT and the integration silently breaks.

**Evidence — PARTIAL, with one live misclassification.**
- **The good case, as a template:** `apps/api-gateway/src/toast/toast.service.ts:98-126`
  does HMAC-SHA256 over the raw body and **fails closed** when no secret is configured
  (`:117`). That is the standard the other four modules should be measured against.
- **`vendor-portal` is not a webhook.** `apps/api-gateway/src/vendor-portal/vendor-portal.controller.ts:16-43`
  is two public `GET` routes serving a published catalogue page by `:slug`.
  `ENDPOINTS.md:656` labels it "webhook module — expected public, must verify
  signatures instead," which prescribes the wrong control entirely: the real risks
  are slug enumeration and unpublished-page leakage. **The classification file itself
  contains a classification error** — evidence that OD-19 needs judgment per route,
  not a per-module label.
- **Secret in a URL:** `apps/api-gateway/src/common/orchestrator/inbound-email.controller.ts:38-42,57-58`
  accepts its shared secret either as an `x-inbound-secret` header *or* as
  `?secret=` — a query-string credential that lands in access logs, proxies and
  referrers. It does fail closed with no secret configured, which is right.
- **Rate limiting is global but not distributed:** registered as an `APP_GUARD` at
  `apps/api-gateway/src/app.module.ts:120-121`, with sane tiers
  (`rate-limit.guard.ts:28-32`, incl. `ai: 20/60s`) — but backed by an in-memory
  `Map` whose own comment says "In production, use Redis for distributed rate
  limiting" (`:66-69`). On more than one instance the effective limit is
  *limit × instances*.
- Secrets surface is wide: **80 environment variables** (`EXTERNAL_CONNECTIONS.md`),
  plus `abc123.ngrok.io` and placeholder domains in source paths
  (`foundation README.md:44-46`).

**Primary metric.** `unverified_public_ingress` — public routes accepting a request
without a verified signature, shared secret, or explicit publish-state check.
Baseline unknown by design: establishing it *is* the first deliverable, and
`vendor-portal` proves the existing per-module labels cannot be trusted to produce it.

**Premortem.** Signature verification is added but the secret is left unset in one
environment and the code fails *open* rather than closed — inverting `toast.service.ts:117`'s
correct behaviour and producing a verified-looking endpoint that verifies nothing.

### SEC-3 · AI Surface Security

**Mandate.** Own the risks that arrive *through* a model rather than through a route:
prompt injection from untrusted content, action/tool allowlisting, denial-of-wallet
on inference endpoints, and PII or secrets leaking into prompts and logs.

**Why distinct from siblings.** SEC-1's tools are guards and RLS; SEC-2's are HMACs
and quotas. **Neither fixes prompt injection**, because the malicious input arrives
inside a legitimately authenticated, legitimately signed payload. Distinct also from
**Compliance & Privacy** (Corporate — owns lawful basis, DPAs, consent) and from the
**Ethics & Responsible AI** advisory (owns whether we *should*): SEC-3 owns whether an
attacker *can*.

**Evidence — EXISTS (the exposure), NEW (the team).**
- **Denial-of-wallet, live today.** `POST /analytics/consult/:restaurantId`
  (`ENDPOINTS.md:16`) is unguarded, and it invokes an Anthropic Opus call
  (`consultants.service.ts:20-28`). Worse, the toggle that gates it —
  `PUT /analytics/consultants/:restaurantId/toggle` (`ENDPOINTS.md:18`) — is
  **also unguarded**, so an anonymous caller can both enable the paid layer and
  drive it. The `ai: 20/60s` rate tier is the only brake, and it is per-instance
  in-memory (SEC-2).
- **Injection surface, live today.** `inbound-responder.service.ts` drafts vendor
  replies from inbound email — attacker-controlled text entering a model whose output
  becomes a staged business communication. The existing mitigation is architectural
  (never auto-send; human approval) and it is the right shape; nobody owns testing it.
- **Guest disclosure risk is already priced.** `scripts/eval_guest_merge_policies.py:28-30`
  states a false guest merge is "a DISCLOSURE — one person's dining history, spend"
  — not a data-quality error. The identity substrate exists
  (`20260819000000_guest_identity_minimal_slice.sql`), so the exposure is real, not
  hypothetical.
- The `ask → propose → confirm → execute` allowlist pattern is specified
  (`foundation README.md:258-260` §5 item 1; FUTURES §8.1) and is exactly this
  team's contract to enforce.

**Primary metric.** `nf_a.unauthenticated_inference_spend` — USD of model cost
attributable to calls whose originating request carried no authenticated subject.
Baseline today is **unmeasurable**, because the NestJS callsites emit no cost events
at all (RM-3) — which makes RM-3's instrumentation this team's hard dependency and
its first cross-team ask.

**Premortem.** The team writes an injection policy document and never builds a red-team
corpus, so the first real injection is discovered by a vendor receiving a strange
email. Second tell: the `/analytics/consult` hole is closed by SEC-1's endpoint sweep,
everyone treats denial-of-wallet as solved, and no per-tenant inference budget is ever
introduced.

---

## 3. Analytics & BI — 3 teams

**Department mandate** ([ORG_STRUCTURE §2](../ORG_STRUCTURE.md)): *"owns the metrics
narrative that sells the product, which is a different job from Data's substrate."*

The department already has the most existing code of the three: **11,748 lines**
across `apps/api-gateway/src/analytics/`. Three teams here are not aspiration —
they are three distinct existing failure modes.

**Boundary with Data (Technology division), stated once:** Data owns whether the
number *can be computed* (L0 corpora, POS traffic, pipelines). Analytics & BI owns
whether it is *correct, useful, and consistently named*. When a metric is wrong the
first question is which of those four words failed.

### AB-1 · Analytics Engine (Decision Science)

**Mandate.** Own the deterministic math — the pure, DB-free functions that turn
operational data into quantities, and their test suites.

**Why distinct from siblings.** AB-1 answers *"is the arithmetic right?"*, AB-2
answers *"is this worth saying?"*, AB-3 answers *"does this number mean the same
thing everywhere?"* An engine can be flawlessly correct and still ship a useless
insight; that is why AB-2 exists and why AB-1 cannot absorb it.

**Evidence — EXISTS, substantial.**
- `apps/api-gateway/src/analytics/engine/` carries `statistics.ts` (477),
  `finance.ts` (512), `vendor-price-consensus.ts` (454), `pricing-agility.ts` (398),
  `inventory-science.ts` (371), `forecasting.ts` (284), `risk.ts` (260),
  `cost-basis.ts` (253), `regression.ts` (222), `comparisons.ts` (214),
  `association.ts` (109), `linalg.ts` (82) — **with 10 `.spec.ts` files** covering them.
- The module is deliberately pure: `insight-catalog.ts:14-17` states the design
  intent — "pure data + pure functions (no NestJS/DB) so the candidate space is
  testable and countable."
- Reach is capped by data, not by math: `insight-catalog.ts:32-40` declares a
  `DataRequirement` union (`consumption | orders | inventory | checks | tables |
  venue | goals`) and `availableCandidates()` (`:557`) filters the space by what a
  restaurant actually has — a clean, already-implemented handoff point to Data.

**Primary metric.** `satisfiable_candidate_share` — share of `INSIGHT_CANDIDATES`
(`insight-catalog.ts:547`) whose `DataRequirement` set is met for a live restaurant.
This is the honest measure of engine reach and it names Data as the constraint
rather than hiding it. Feeds NF-B: `checks`-dependent candidates are the guest-side
half of the space, and `insight-catalog.spec.ts:43-48` already asserts the
with-checks space is strictly larger.

**Premortem.** New math is added faster than data arrives, so the catalogue grows
while `satisfiable_candidate_share` falls — an engine that is impressive in tests and
silent in production. The tell: a new `engine/*.ts` file whose `DataRequirement`
nobody can satisfy.

### AB-2 · Insight & Narrative Generation

**Mandate.** Own candidate scoring, ranking, verbalization, the toggle-gated LLM
consultant layer, and the recommendation-action loop that measures whether any of it
was worth reading.

**Why distinct from siblings.** AB-1's output is a number; AB-2's is a sentence a
manager acts on. Their metrics point in opposite directions under pressure — AB-1 is
rewarded for computing more, AB-2 for saying less. One team holding both quietly
resolves that tension toward volume, which is how a dashboard becomes noise.

**Evidence — EXISTS.**
- `insights/insight-generator.service.ts` (1,200 lines) executes the
  DIMENSION × MEASURE × COMPARATOR cross-product built in `insight-catalog.ts`
  (`DIMENSIONS:67`, `MEASURES:114`, `COMPARATORS:242`, validity matrices at `:279`
  and `:388`, `INSIGHT_CANDIDATES:547`), with `insight-verbalizer.ts` (167) and
  `insight-scheduler.service.ts` (183). `insight-catalog.spec.ts:10` asserts **≥200
  candidate types**, and `:63-98` asserts the *sentences* read correctly
  ("Tuesday sales", "12% lower", "Table 4 ranks #1 of 12") — verbalization is
  already treated as testable output, not decoration.
- `consultants.service.ts:7-24` is a genuinely well-designed LLM layer: default OFF,
  toggle-gated per restaurant, four personas, and *"the prompt forbids inventing
  numbers"* — every claim must cite the evidence pack. It sits **on top of** the
  deterministic math rather than replacing it.
- The feedback loop exists: `recommendation-actions.service.ts` (308) +
  `recommendations.service.ts` (417) record act / dismiss / snooze / done / pin.

**Primary metric.** `insight_acceptance_rate` — acted-or-pinned ÷ surfaced, from
`recommendation_actions`. A dismissed insight is a correct number that failed at
this team's actual job.

**⚠️ Schema gap this metric exposes.** The restaurant manager acting on a
recommendation is **neither an agent nor a guest**. `foundation §4.4` defines
`subject_type` as `agent | guest | bio`, so the single strongest human-preference
signal the product already collects **has no home in the neural footprint**. Raised
as a fork in §6 (INTEL-F3).

**Premortem.** The consultant layer is switched on by default "because it demos
well", its claims stop being checked against the evidence pack, and one confidently
fabricated number in front of a customer costs more credibility than the whole
insight engine earned. The existing default-OFF design (`consultants.service.ts:11`)
is the guardrail; the premortem is that someone flips it for a demo and forgets.

### AB-3 · Metric Contract & Truth Assurance

**Mandate.** Own the semantic layer — one definition per metric — and prove the
shipped product computes each one exactly, against ground truth.

**Why distinct from siblings.** AB-1 and AB-2 are both *authors* of numbers. AB-3 is
the only team whose job is to say a shipped number is wrong, and it must be able to
say that to both siblings. Same independence argument as RM-2, one department over.

**Evidence — PARTIAL, and the register calls it the top priority.**
- The semantic layer exists in embryo: `metric-registry.ts` (547 lines, **34 metric
  keys**) is the nearest thing to a single definition source.
- `.planning/v3.0-TECH-DEBT.md:322-325` (§44.10, Analytics & Insights Truth Suite)
  is marked **"Stated #1 eval priority"**: assert every dashboard KPI, report and
  analytic answer **exactly** against the simulator's ground-truth ledger. It is
  blocked on §44.7 (SimPOS simulator, `:309`), which makes that dependency this
  team's single most important escalation.
- The contract has already failed once, visibly:
  `.planning/ANALYTICS_FEATURE_CATALOG.md:1-20` catalogues **460 features** (tiers
  92 / 170 / 98 at `:931-936`) and its header read *"Planning only — not built"* for
  **two weeks after the engine shipped** — "a shipped engine sat behind a 'not built'
  label." The file's own warning is the charter: *"the header was wrong once already."*

**Boundary with RM-2 (Research & Math), stated explicitly.** RM-2 grades
**nondeterministic** model output — golden sets, judges, threshold pass conditions.
AB-3 grades **deterministic arithmetic** — exact equality against a ledger, no
judgment involved. Different technique, different pass condition. They share
vocabulary, not work.

**Primary metric.** `kpi_ground_truth_agreement` — share of shipped KPIs matching the
simulator ledger **exactly**. Baseline **0%, and honestly so**: it is unmeasurable
until §44.7 lands. Publishing the 0 is the point — it converts a blocked dependency
into a visible number.

**Premortem.** SimPOS (§44.7) slips, so "truth assurance" degrades into
self-consistency checks — the engine agreeing with itself — and the register's #1
eval priority is quietly reported as done. Second tell: `metric-registry.ts` gains a
35th metric that is also defined inline somewhere in `analytics.controller.ts` (837
lines), and the two drift.

---

## 4. Cross-boundary contracts

Six edges where an Intelligence team depends on someone it does not control. Each
should become a `loops.md` entry with a named close-time (ORG_STRUCTURE §5).

| From | To | Contract |
|---|---|---|
| RM-3 | Data (Technology) | RM-3 owns the NF **schema contract**; Data owns the **physical table and migration**. OD-11 must name both owners or it will be implemented twice. |
| RM-1 | Engineering | The seven NestJS callsites live in Engineering's modules. RM-1 owns the wrapper; Engineering owns adoption. Without a deprecation date the wrapper becomes an eighth convention. |
| SEC-3 | RM-3 | SEC-3's primary metric is unmeasurable until NestJS model calls emit cost events. **Hard dependency, not a nice-to-have.** |
| SEC-1 | Red Team (advisory) | SEC-1 builds the guards; Red Team attacks them. ORG_STRUCTURE §3 already forbids the same unit doing both. |
| AB-2 | Guest Experience (Product) | AB-2 owns the **operator-facing** narrative. Guest taste fingerprints and personalization (NF-B applied) belong to Guest Experience. AB-2 consumes NF-B in aggregate; it does not own the guest. |
| AB-3 | Engineering | §44.10 is blocked on §44.7 (SimPOS). AB-3's baseline is 0% until Engineering ships it — the escalation must be scheduled, not hoped for. |

---

## 5. Considered and rejected

Recorded so the next session does not re-propose them. Each carries an entry trigger,
following the pattern `foundation §4.3` used for NF-C.

| Candidate | Why not now | Entry trigger |
|---|---|---|
| **Applied ML / Model Training** (R&M) | `services/agent-orchestrator/training/` holds exactly three scripts (`train_invoice_scanner.py`, `train_label_scanner.py`, `train_menu_scanner.py`) with no live training loop, no eval set, and no served checkpoint. A team here would be symmetry, not work. Charter parks under RM-1. | A first-party model beats the API baseline on an RM-2 golden set **and** the cost delta justifies serving it. |
| **Cost & Efficiency** (R&M) | Cost routing *is* harness routing — the decision "which model for this task" cannot be split from "how the call is made." Splitting it creates a team that files tickets against RM-1. | Never as a team; it is RM-1's primary metric. |
| **Meta-Skills / T4** (R&M) | `foundation §3.2` assigns T4 (`skill-create`, `skill-review`) to this department, and §3.3's anti-sprawl rule ("no fire in 30 days → review for deletion") is a *measurement* job. Folded into RM-2, which already owns doneability criteria — step 2 of the skill protocol literally is "name the doneability criteria." Also: the repo has **one** project skill today (`.agents/skills/railway-config/SKILL.md`), so there is nothing yet to govern. | The skill registry exceeds ~15 skills, or two skills are found to overlap in production. |
| **Detection & Response / SecOps** (Security) | No SIEM, no on-call rotation, no incident history. `logs/logs` is a single endpoint. A response team with nothing to respond to writes runbooks nobody reads. | First real incident, or the first customer contract with a breach-notification SLA. |
| **Dashboards / Visualization** (A&BI) | That is Design (surface) plus Engineering (build). A&BI owns what the number *means*, not how it renders. | Never as an Intelligence team. |
| **Guest Analytics / NF-B** (A&BI) | Real scope, wrong division. Guest Experience sits under Product & Vision (ORG_STRUCTURE §2) and owns taste fingerprints and personalization. A&BI would duplicate it. | Never — see the §4 contract instead. |

---

## 6. New forks raised by this document

To be added to [`OPEN-DECISIONS.md`](../../decisions/OPEN-DECISIONS.md).

> **Renamespaced 2026-08-24.** First minted as bare `F-1`…`F-5` (ambiguous against
> Commercial's `CM-Fn`); reissued as `INTEL-Fn` — see [FORK-REGISTRY](../../02-advisory/decision-office/FORK-REGISTRY.md).
> `INTEL-F6`/`INTEL-F7` were minted later by Analytics & BI and are recorded there too.

| ID | Fork | Why it matters |
|---|---|---|
| **INTEL-F1** | **OD-19's denominator is wrong.** The corpus says "~86" non-webhook unguarded endpoints where README:37 and OD-19 said **94**; summing `ENDPOINTS.md`'s own per-module counts gives **103** (webhook-labelled: 34, not ≈51). Correct OD-19, or explain the 17. **Overtaken 2026-08-26:** OD-19 re-measured to **40**, `ENDPOINTS.md` not corrected with it (§ *Correction the department inherits*). | A classification task cannot report completion against a wrong denominator. |
| **INTEL-F2** | **`vendor-portal` is misclassified** as a webhook module needing signature verification (`ENDPOINTS.md:656`); it is two public `GET`-by-slug content routes (`vendor-portal.controller.ts:16-43`). Does OD-19 classify **per route** rather than per module? | The per-module labels prescribed the wrong control once already. |
| **INTEL-F3** | **NF has no `subject_type` for the restaurant operator.** `foundation §4.4` allows `agent | guest | bio`, but the strongest human-preference signal already collected — recommendation act/dismiss/snooze — is neither. Add `operator`, or route it outside NF? | Blocks AB-2's primary metric from having a home; interacts directly with OD-11. |
| **INTEL-F4** | **Do SEC-1 and SEC-2 start merged?** This document recommends one team with two charters until the endpoint campaign ships. Founder call. | Determines whether the org's largest live security campaign has one owner or a handoff. |
| **INTEL-F5** | **Are the seven raw-HTTP NestJS callsites in scope for OD-03?** They are the majority of production model traffic, and OD-03 is currently framed around the Python harness. If they are out of scope, the harness decision governs a minority of calls. | Decides whether OD-03 is a real decision or a partial one. |
