---
type: schedule
division: commercial
department: finance-pricing
team: unit-economics-pricing
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[unit-economics-pricing-charter]]", "[[unit-economics-pricing-loops]]", "[[unit-economics-pricing-agenda-board]]", "[[unit-economics-pricing-directive]]", "[[finance-pricing-schedule]]", "[[inference-cost-charter]]", "[[skills-charter]]", "[[decision-office-charter]]", "[[OPEN-DECISIONS]]"]
---

# Unit Economics & Pricing — Schedule & Skills

> ⏸ **Dormant team.** The schedule is short on purpose. Everything here either runs
> pre-trigger or is explicitly gated — and a dormant team with a long schedule is a team
> that has quietly started working.

## Recurring work

| Cadence | Job | Emits | State |
|---|---|---|---|
| Weekly | **Entry-trigger watch** — L-UEP-1. Count restaurants excluding the design partner. **Record the value even when zero** | `fin.non_design_partner_restaurant_count` | Pre-trigger, runs today |
| Weekly | **Founder question** — the non-database half of the trigger. "Has pricing un-deferred?" asked in writing each cycle | `fin.founder_pricing_deferral_state` | Pre-trigger, runs today |
| Weekly | **Price-quote register sweep** — L-UEP-2. Every externally-quoted number, its date, recipient, framing | `fin.external_price_quotes_logged`, `fin.unregistered_quote_incidents` | Pre-trigger, runs today |
| Per PR | **`no-price-proposed-guard`** — grep over this team's directory for a proposed price, tier, or rate | Pass/fail | Proposed to CI |
| Monthly | **Cost-to-serve publication** — L-UEP-3 | `fin.cost_to_serve_per_restaurant_month` (one inseparable string) | ⛔ **GATED** on [[inference-cost-charter]]'s callsite census |
| Monthly | **Gross margin** — L-UEP-4 | `fin.gross_margin_per_restaurant_month` | ⛔ **GATED** on the entry trigger |
| Quarterly | **Dormancy review** — is `new` still the right grade, and is the trigger definition still unambiguous? | Recommendation to [[decision-office-charter]] | Pre-trigger, runs today |
| Quarterly | Charter staleness sweep — untouched 60+ days is finished or fiction | Archive or revision | Pre-trigger, runs today |

**Why the weekly cadence for a team with nothing to do.** Both weekly jobs are minutes of
work, and both counter failures that occur *because nobody was looking*
([[unit-economics-pricing-premortem]] M1, M2). Monthly would be cheaper and would also be
enough time for a second restaurant to onboard, get billed nothing, and be forgotten.

**Anti-sprawl, and the exception this team argues for.** A job producing no action for 3
consecutive runs is downgraded or deleted (`foundation README §6`). The trigger watch will
produce "no action" for many consecutive runs by design — **that is a passing result, not a
stale job**, because its output is a recorded zero and the recorded zero is the evidence
that the check ran. The rule is therefore restated for this team: *the trigger watch is
reviewed for deletion when the trigger itself is retired, not when it returns zero.*
Everything else here is subject to the rule as written.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Nothing below exists yet.** The repo holds exactly one project skill
(`.agents/skills/railway-config/SKILL.md`, `foundation README §3.1`). Each carries the four
things `foundation README §3.3` requires — trigger, doneability criterion, a real past
instance, and an owner.

| Skill | Trigger | Doneability criterion | Real past instance |
|---|---|---|---|
| `pricing-trigger-check` | Weekly L-UEP-1 | The count is read and recorded — **including zero** — and the founder question is asked in writing | None yet, by construction. The instance this exists to prevent is a second restaurant onboarding unnoticed, which is [[unit-economics-pricing-premortem]] M2 |
| `price-quote-register` | Any externally-quoted number | The quote is in the register within one close-time of being sent | **Live case:** `$20–50/mo` is described as *locked* in [[OPEN-DECISIONS]]:27 with no ADR behind it — seven ADRs exist (0001–0007), none about pricing. A register would have captured where that number came from |
| `no-price-proposed-guard` | Per PR touching this team's directory | No proposed price, tier, rate or per-unit charge under `teams/unit-economics-pricing/` | Same live case. Precedent in-repo: `scripts/check_no_direct_stock_writes.sh`, `scripts/check_no_guest_name_matching.sh` — this codebase already enforces invariants with cheap greps rather than good intentions |
| `cost-to-serve-report` | Monthly L-UEP-3, **after un-gating** | The figure ships as one inseparable string — lower bound + coverage % + "excluding infrastructure" — or does not ship | `api_spend.restaurant_id` is nullable and enrichment passes `None` by design (`spend_logger.py:59`); a naive `GROUP BY restaurant_id` today would produce a confident undercount |

Ownership of the skill **registry** sits with [[skills-charter]] (Applied AI). This team
authors skills against its own jobs; it does not govern the registry.

## Dependencies this schedule assumes

| Assumption | Owner | State |
|---|---|---|
| Callsite census exists, so coverage % is known | [[inference-cost-charter]] | **Not started** — gates L-UEP-3 |
| A restaurant table queryable for non-design-partner accounts | [[catalogue-identity-charter]] / Engineering | Assumed; the exact query is **not verified by this session** |
| The trigger's definition is unambiguous (is a signed-but-unbilled account a trigger?) | Founder | **Open** — Q2 of [[unit-economics-pricing-agenda-full]] |
| Someone tells this team when a number is quoted externally | Founder, Sales, Media & Brand | **No mechanism exists.** The register depends on disclosure, which is its weakest point — `fin.unregistered_quote_incidents` is the only detector |
