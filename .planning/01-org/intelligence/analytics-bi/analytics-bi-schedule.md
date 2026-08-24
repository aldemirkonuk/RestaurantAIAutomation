---
type: schedule
division: intelligence
department: analytics-bi
status: provisional
metrics: [analytics.metric_claim_divergence_count, analytics.satisfiable_candidate_share, analytics.insight_acceptance_rate, analytics.consultant_enabled_restaurants]
updated: 2026-08-24
links: ["[[analytics-bi-charter]]", "[[analytics-bi-loops]]", "[[analytics-bi-directive]]", "[[analytics-bi-agenda-board]]", "[[analytics-engine-schedule]]", "[[insight-narrative-generation-schedule]]", "[[metric-contract-truth-assurance-schedule]]", "[[decision-office-charter]]"]
---

# Analytics & BI — Schedule & Skills

## Recurring work

| Cadence | Job | Owner | Emits |
|---|---|---|---|
| Weekly | **Claim census** — grep every published count in `apps/web`, `apps/mobile`, `apps/api-gateway` OpenAPI strings, and `.planning/*.md`; diff each against the value the code produces at runtime | AB-3 | `analytics.metric_claim_divergence_count` |
| Weekly | **Candidate reach reading** — `availableCandidates()` per live restaurant; publish satisfiable share and the blocking `DataRequirement` | AB-1 | `analytics.satisfiable_candidate_share`, a data request to [[data-charter]] |
| Weekly | **Consultant enablement list** — every `analytics_insight_prefs` row with `category='consultants'`, `enabled=true`, its age, its named owner. Unowned rows revert to the default (OFF) | AB-2 | `analytics.consultant_enabled_restaurants` |
| Biweekly | **Acceptance join** — `recommendation_impressions ⋈ recommendation_actions`; report with an `insufficient_data` flag until volume supports the number | AB-2 | `analytics.insight_acceptance_rate`, `analytics.top_rank_ignore_rate` |
| Monthly | **Coverage inversion check** — engine spec cases vs untested service lines | Department | `analytics.engine_service_test_ratio` |
| Monthly | **Ground-truth restatement** — either an agreement percentage, or a dated restatement that §44.7 has not shipped. Three consecutive restatements escalate to the founder | AB-3 | `analytics.kpi_ground_truth_agreement` |
| Per publication | **Claim provenance check** — no analytics figure leaves the building without a `path:line` and its weakest defensible verb | AB-3 | `analytics.claims_without_provenance` |
| Quarterly | **Registry reconciliation** — `metric-registry.ts` keys vs `ANALYTICS_FEATURE_CATALOG.md` ids vs what the service actually computes | AB-3 | `analytics.registry_coverage_share` |

**Anti-sprawl:** a scheduled job that produces no action for **3 consecutive runs** is
downgraded or deleted (foundation §6). The job most at risk here is the monthly
ground-truth restatement — if it emits the same sentence three times, it has stopped being
a job and become a status field, and it moves to [[analytics-bi-agenda-board]] as a
standing counter with an escalation instead.

## Skills owned

Skills live in `.claude/skills/`. **None of these exist yet** — the repo has exactly one
project skill today (`.agents/skills/railway-config/SKILL.md`, foundation §3.1), so this
is a greenfield list, not an inventory. Each entry names the trigger, the doneability
criteria, and the real past instance that justifies it, per the §3.3 protocol.

| Skill | Tier | Trigger | Doneable when | Real past instance |
|---|---|---|---|---|
| `metric-claim-census` | T2 | Weekly, and before any external publication | Every published count matches the value its code produces, or is listed as a divergence with an owner | The 375-vs-573 split shipping in `commands.ts:99` and `InsightCatalog.tsx:2` today |
| `insight-candidate-reach` | T2 | Weekly; also on any PR touching `insight-catalog.ts` | Satisfiable share published with the blocking `DataRequirement` named | 573 types enumerated, 144 computable without POS — a gap nobody had measured before 2026-08-24 |
| `analytics-truth-check` | T2 | Any change under `apps/api-gateway/src/analytics/` | Every touched metric key still matches its `metric-registry.ts` definition and the shipped computation | `metric-registry.ts:8` calling the catalogue "the 360 features" while it holds 460 |
| `support-floor-audit` | T3 | Any diff touching a threshold constant in `insight-generator.service.ts` | The threshold is a named exported constant with a spec case | Five thresholds today (`:200`, `:550`, `:867`, `:1017`, `:1107`), none named, none tested |
| `consultant-toggle-review` | T2 | Weekly | Every enabled row has a named owner and an expiry inside one close-time | Default-OFF design (`consultants.service.ts:11,18`) with no expiry mechanism and an unguarded toggle route (`analytics.controller.ts:516`) |
| `published-claim-guard` | T2 | Before any deck, landing page, or changelog containing an analytics figure | The claim carries a `path:line` and uses the weakest verb its evidence supports | `YC_WEDGE_PLAN.md:31-33` — *"dollars recovered"* means *we asked* |

**Skill-count honesty.** Six proposed skills for one department, against a repo-wide
total of one. `intelligence.md:504` already notes that the skill registry is too small to
need governance ("there is nothing yet to govern"). This list should be treated as a
**candidate set**, and the department should ship two — `metric-claim-census` and
`insight-candidate-reach` — before writing the other four. A skill that has not fired in
30 days is reviewed for deletion (foundation §3.3); six skills created at once would fail
that test in a month.

## Cadence notes

- **Weekly is the department's default close-time**, matching L1, L3 and L6 in
  [[analytics-bi-loops]]. The exception is L2 (biweekly), because at 11 restaurants a
  weekly acceptance rate is noise (`AGENT_NATIVE_UI_DECISION.md:191-192`) and reporting it
  weekly would teach the department to read randomness as signal — which is the exact
  discipline this department is supposed to model for the rest of the org.
- **The claim census runs before every external publication, not only weekly.** A weekly
  job cannot catch a deck written on a Tuesday.
