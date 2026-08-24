---
type: charter
division: platform
department: data
team: pos-operational-telemetry-ingest
status: partial
metrics: [pos.line_resolution_rate, pos.worst_restaurant_resolution_rate, pos.unresolved_queue_depth, sales.density, nf_b.exposure_events]
updated: 2026-08-24
links: ["[[pos-operational-telemetry-ingest-premortem]]", "[[pos-operational-telemetry-ingest-agenda-full]]", "[[pos-operational-telemetry-ingest-agenda-board]]", "[[pos-operational-telemetry-ingest-directive]]", "[[pos-operational-telemetry-ingest-loops]]", "[[pos-operational-telemetry-ingest-schedule]]", "[[data-charter]]", "[[integration-engineering-charter]]", "[[catalogue-identity-charter]]", "[[corpora-enrichment-charter]]", "[[substrate-quality-coverage-charter]]", "[[analytics-bi-charter]]", "[[technology]]", "[[README]]"]
---

# POS & Operational Telemetry Ingest — Charter

Parent: **Data** ([[data-charter]]), division **Platform**. Team §5.4 in
`.planning/foundation/teams/technology.md:649`.

## Mandate

This team owns **real operational traffic as an L0 asset: POS checks, tables, sales
velocity, line-item resolution, and the review queues for what does not resolve**
(`technology.md:651-652`). It is the only place the company learns what restaurants actually
sold, to whom, and how fast.

## Why it is distinct from its siblings

It is **the only data source whose schema the company does not own and cannot re-run. A
missed webhook is a permanently missing Tuesday** (`technology.md:654-655`).

Every other producer in this department can retry. Enrichment can re-run a wine.
Annotation can re-label a document. Synthetic generation can regenerate the entire corpus
from `manifest.json`. This team gets **one pass at a stream it does not control**, in a
schema that a third party may change without notice, and the loss is silent and permanent.

### And distinct from `[[integration-engineering-charter]]` on a crisp line

Integration Engineering owns *"the webhook verified, returned 200, and nothing was
dropped."* This team owns *"the check lines resolved to real catalogue items and velocity is
computable."* **Delivery vs. fitness. A payload can be perfectly delivered and useless**
(`technology.md:657-660`; the seam is enumerated at `technology.md:859`).

That line is the reason this team exists, and it is also the line most likely to be
re-litigated in an incident, which is why it is stated on the charter rather than left to
memory.

## Boundaries

Owns outright:

- **The unresolved substrate** —
  `supabase/migrations/20260805133000_pos_unresolved_lines_and_review_queues.sql`, which
  creates `pos_unresolved_lines`, `pos_catalog_match_proposals` and `drift_findings`
  (`:12,47,82`). These three tables *are* the team's mandate in schema form.
- **Counting and correlation columns** —
  `supabase/migrations/20260805132000_counting_catalog_and_correlation_columns.sql`.
- **The ingest surfaces** — `apps/api-gateway/src/pos-hub/` (10 routes, including
  `catalog-matcher.service.ts`, `pos-provider.registry.ts`, `pos-adapters.ts`),
  `apps/api-gateway/src/toast/` (10 routes).
- **The ingest agents** — `services/agent-orchestrator/agents/pos_integration_agent.py`,
  `services/agent-orchestrator/adapters/toast_adapter.py`.
- **The POS-agnostic substrate** — the `pos_checks` / `tables` schema behind the analytics
  engine.
- **Line resolution and its repair** — deciding whether a check line resolved, queuing what
  did not, and driving the queue down.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Webhook delivery, signatures, retries, drops | [[integration-engineering-charter]] | Delivered correctly vs. usable as L0 (`technology.md:859`) |
| What counts as the same product | [[catalogue-identity-charter]] | We propose matches; Engineering owns identity |
| Analytics, baselines, insights over this data | [[analytics-bi-charter]] *(Intelligence)* | We supply the substrate; they tell the story |
| Whether a row publishes | [[substrate-quality-coverage-charter]] | Author ≠ auditor |
| Simulated POS traffic | [[synthetic-generation-simulation-charter]] | SimPOS is not observed data, ever (decision C31) |
| The partner relationship with a POS vendor | Partnerships & Integrations *(Product)* | They own the deal; the wire is Integration's; fitness is ours |
| Guest consent and lawful basis | Compliance & Privacy *(Corporate)* | We hold `nf_b.*` inputs; they hold the right to hold them |

## Metrics it moves

**Primary: `pos.line_resolution_rate`** — POS check lines that resolve to a catalogue item
without human repair, **reported per restaurant, since one badly-mapped account can hide
behind a healthy fleet average** (`technology.md:672-675`).

The reporting rule is part of the metric, not a presentation preference. The department
reports **minimum and distribution**, never mean
([[pos-operational-telemetry-ingest-directive]]).

Secondary:

- `pos.worst_restaurant_resolution_rate` — the number a fleet average is designed to hide.
- `pos.unresolved_queue_depth` — with its **trend**, not just its level. A stable deep queue
  and a growing shallow one are different diseases.
- `sales.density` — one of the department's three L0 numbers ([[data-loops]] loop 1). This is
  the corpus half of the mandate and it is the thin half.
- `pos.provider_schema_drift_findings` — `drift_findings` rows
  (`…pos_unresolved_lines_and_review_queues.sql:82`), which is how a third party changing its
  schema becomes visible.

**Neural-footprint tie.** This team is the primary real source of `nf_b.*`: an unresolved
check line is a **guest choice that was never recorded** ([[README]] §4.2 — dish/wine
exposure, choice, repeat). Guest-signal loss is not proportional to unresolved rate, it is
concentrated — unresolved lines cluster on unusual items, which are exactly the items that
carry the most preference information.

## Evidence today

**PARTIAL — and the split is precise: the pipes EXIST, the corpus does not**
(`technology.md:662-670`), re-verified 2026-08-24.

**EXISTS:**

- `supabase/migrations/20260805133000_pos_unresolved_lines_and_review_queues.sql`
  (`pos_unresolved_lines`, `pos_catalog_match_proposals`, `drift_findings`)
- `supabase/migrations/20260805132000_counting_catalog_and_correlation_columns.sql`
- `apps/api-gateway/src/pos-hub/` (10 routes; catalog matcher, provider registry, adapters,
  with specs), `apps/api-gateway/src/toast/` (10 routes; auth service, DTOs, specs)
- `services/agent-orchestrator/agents/pos_integration_agent.py`,
  `services/agent-orchestrator/adapters/toast_adapter.py`
- POS-agnostic `pos_checks`/`tables` schema behind the analytics engine
- `apps/api-gateway/src/analytics/` (39 routes) consuming this substrate — **all unguarded**
  (`technology.md:668`; the guard question belongs to [[security-charter]] and
  [[platform-api-charter]], the *dependency* is ours to note)

**PARTIAL:**

- **Sales metrics are named as thin** in [[README]] §1. The pipes exist, the corpus does not.
  This team is graded `partial` on that basis and not on the state of its code.
- **No published line-resolution rate**, per restaurant or otherwise. The tables that would
  let it be computed exist; the number does not.
- **No unresolved-queue owner.** The queue exists in schema and has no name attached to
  draining it — which is [[pos-operational-telemetry-ingest-premortem]] M1's mechanism, not
  its symptom.

**One provider.** Toast is the only adapter present. `pos-provider.registry.ts` and
`pos-adapters.ts` suggest the abstraction anticipates more, and the abstraction has never
been tested against a second real provider — recorded honestly rather than counted as
multi-provider capability.
