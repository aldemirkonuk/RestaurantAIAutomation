---
type: schedule
division: product
department: product-vision
team: inbound-understanding
status: provisional
metrics: [inbound.false_accept_count, inbound.p50_time_to_approve_seconds]
updated: 2026-08-24
links: ["[[inbound-understanding-charter]]", "[[inbound-understanding-loops]]", "[[inbound-understanding-agenda-board]]", "[[product-vision-schedule]]", "[[connector-platform-trust-charter]]"]
---

# Inbound Understanding — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Weekly** | **False-accept audit sweep** — sample downstream records edited since last run; join each edit back to the proposal that created it; classify by materiality (quantity / SKU identity / total). This is the job that makes the primary metric honest. | `inbound.false_accept_count`, `nf_a.outcome` |
| **Weekly** | **Deliberate high-confidence sampling review** — a small random share of fast-path-eligible proposals routed to full field review. Disagreement rate is the leading indicator of rubber-stamping. | `inbound.sampled_high_confidence_disagreement_rate` |
| **Weekly** | **Approval-latency read** — p50 time-to-approve per document type. An approval faster than the document can be read is the alarm, not the goal. | `inbound.p50_time_to_approve_seconds` |
| **Weekly** | **Gate conformance check (CI)** — fail any diff introducing a confidence constant or approval component outside the shared contract. Honest about being a grep; its outcome-side twin is the false-accept sweep. | `inbound.threshold_constants_outside_contract` |
| **Weekly** | **Input-trust restatement** — republish `integration.verified_signature_coverage` (today **0 of 32**) and escalate if unchanged. Not ours to fix; ours to keep loud. | — |
| **Monthly** | **Held-out backtest run** — `invoice-match.backtest.spec.ts` extended set, reported *next to* tuned-set accuracy. Divergence is the M1 tell. | `inbound.held_out_set_accuracy` |
| **Monthly** | **Corpus census** — distinct vendor formats and document types seen. Acceptance rising while this rises is the impossible-if-honest combination. | `inbound.distinct_vendor_formats` |
| **Quarterly** | **Contract re-read** — all three modules re-checked against the guardrail contract, disagreements logged. | — |

**Anti-sprawl rule:** a scheduled job producing no action for **3 consecutive runs** is
downgraded or deleted. The honest first casualties here are the false-accept sweep and the
sampling review while `procurement_orders` = 1 — with almost no real proposals, they will
run empty. Suspend them with a named unblocker (*first restaurant with weekly inbound
volume*) rather than running them into fiction.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion. Per
foundation §3.3 each must name a trigger, doneability criteria, a **real past instance**,
and an owner. The repo has exactly one project skill today
(`.agents/skills/railway-config/SKILL.md`) — everything below is **proposed, not built**.

| Skill (proposed) | Tier | Trigger | Doneability | Past instance that justifies it |
|---|---|---|---|---|
| `inbound-gate-conformance` | T3 | Any diff under `apps/api-gateway/src/procurement/documents/`, `apps/api-gateway/src/communications/`, or `apps/api-gateway/src/procurement/recurring-orders.controller.ts` | Zero confidence constants and zero approval components outside the shared contract; a violation names the file and the contract clause | Three inbound modules shipped independently — Phase 0 email intelligence has its own "conservative reply gate", `document-extractor` has its own extraction confidence, and nothing reconciles them |
| `false-accept-join` | T2 | Weekly, or on demand after a correction is reported | Every downstream edit in the window is either joined to an originating proposal or explicitly marked as human-origin | `credit-ledger.ts` exists, meaning credit memos are modelled — the case where a wrong extraction is silently compensated is exactly the one no one currently detects |
| `document-corpus-census` | T1 | Monthly, or when a new vendor's first document arrives | A table of vendor → format → volume → held-out membership | The invoice backtest runs against the corpus it was tuned on; nobody can currently state how many distinct formats that is |
| `proposal-explainer` | T2 | A proposal is generated | The proposal surfaces its three lowest-confidence fields before its summary | The house pattern is already "draft, one-tap approve, never auto-send" — the missing half is showing the reviewer what to doubt |

**Deliberately not proposed:** an auto-accept skill at any confidence level. [[FUTURES]]
§8.1's principle and this team's own gate rule both forbid it, and a skill is not the place
to relitigate a decision.
