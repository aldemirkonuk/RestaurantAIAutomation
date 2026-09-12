---
type: agent-stack
division: commercial
department: sales
team: outbound-engine
status: designed
updated: 2026-08-27
metrics: [sales.qualified_conversation_rate, sales.sending_identity_isolated, sales.complaint_rate, sales.reply_rate, sales.claim_provenance_rate]
links: ["[[outbound-engine-charter]]", "[[outbound-engine-schedule]]", "[[outbound-engine-loops]]", "[[outbound-engine-premortem]]", "[[outbound-engine-directive]]", "[[0034-agent-stack-artifact]]", "[[sales-agent-stack]]", "[[design-partner-operations-agent-stack]]", "[[skills-charter]]", "[[action-safety-the-human-gate-charter]]", "[[compliance-privacy-charter]]", "[[media-brand-charter]]"]
---

# Outbound Engine — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> A dormant team gets the most tightly bounded card in the department, and the boundary is
> the point. **This agent sends nothing.** Outbound to a real prospect is the hardest-gated
> action family in the org — *ask → propose → confirm → execute*, FUTURES §8.1
> (`.planning/FUTURES.md:211`) — and while the entry trigger is unmet there is nothing to
> confirm either: **zero sends and zero spend are the correct output for this quarter.**
> There is exactly one customer and no pipeline; nothing below is a machine that is running.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `outbound-sentinel` | Hold the two things that can honestly be true before send #1 — the sending identity is isolated from the platform's transactional mail, and every claim in a draft traces to a credit that landed — and produce nothing that presumes a target list | NEW |

One row, and a narrow one. A dormant team with a second agent would be
[[outbound-engine-premortem]] M3 — *the machine invented a list* — arriving as an org chart.

## 2. Agent cards

```yaml
agent: outbound-sentinel
unit: outbound-engine
triggers:
  - schedule: "per-PR — identity guard (the only loop that runs today, oe-identity-isolation-guard)"   # [[outbound-engine-schedule]]
  - schedule: "monthly — entry-trigger check, so 'deferred' never quietly becomes 'abandoned'"
  - schedule: "quarterly — claim provenance audit (trivial while the allowlist is empty, which is the point)"
  - topic: sales.credit_landed        # publisher: [[design-partner-operations-agent-stack|dpo-account-steward]] (designed, not built)
  - topic: outbound.stop_requested    # publisher: NONE (gap — no sending surface exists, so no stop path exists either)
consumes:
  - "apps/api-gateway/src/communications/gmail.service.ts — the single transactional sending identity and its hardcoded fallback"
  - "apps/api-gateway/src/communications/communications.controller.ts — the inbound poller filtering against that same resolved address"
  - "env.example (EMAIL_BACKEND, SENDGRID_API_KEY) and services/agent-orchestrator/config/settings.py — the unused isolation seam"
  - "the claim allowlist — empty by design ([[outbound-engine-charter]] §Metrics)"
  - "drafts carrying customer-outcome claims — publisher: [[media-brand-charter]] (they write the sentences; this agent rules on what may be asserted)"
emits:
  - "sales.sending_identity_isolated (boolean) → oe-identity-isolation-guard and [[sales-agent-stack|sales-board-keeper]]"
  - "claim verdicts, permitted or pulled → [[media-brand-charter]]"
  - "the monthly trigger state → [[outbound-engine-agenda-board]]"
  - "the legal-basis question → [[compliance-privacy-charter]] (filed, never answered here)"
  - "nf_a events (task_type: outbound_guard_run, claim_audit, trigger_check)"
routing_class: mechanical
quality_bar: "the guard fails closed — if it cannot prove GmailService is unreachable from an outbound path it exits non-zero rather than passing (the repo's guard convention); a claim passes only when its credit landed on a named invoice; NONE (gap) for the drafting side, which has no grader and no corpus"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm
memory: outbound-engine
escalates_to: "[[sales-charter]]"
```

**The card's own hard rules — all three load-bearing.** (1) **No list, ever:** it does not
generate, enrich, scrape, purchase, infer, or "seed" a target list, and does not accept one
from another agent — a machine with no list will invent one if the card lets it. (2) **No
sends, and no send path:** it may draft structure (sequence shape, suppression design,
rubric) and every draft lands as a PR; it never holds a credential or reaches a mail
transport, and `mutate_stock_money_outbound: confirm` is the constant that would still apply
after send #1. (3) **It never patches what it guards:** the isolation fix is a configuration
decision plus a domain purchase, both behind the entry trigger.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `sending-identity-guard` | T3 | Any commit touching a sales or outbound path | Fails if `GmailService` is reachable from an outbound module; exits non-zero when it cannot check at all | The risk is real and live today — one Gmail identity carries vendor procurement mail and customer notifications ([[outbound-engine-charter]] §The one risk) — and the repo already runs nine grep-grade guards of exactly this shape: `scripts/check_no_direct_stock_writes.sh`, `check_no_raw_guest_channels.sh`, `check_no_guest_name_matching.sh`, `check_model_calls_logged.sh`, `check_schema_parity.sh` and siblings (verified 2026-08-27) | NEW |

One row. [[outbound-engine-schedule]] marks `suppression-honour-check` **gated — do not
author until sending exists**; that judgement is respected here rather than relaxed.
`claim-provenance-check` runs at department level and this team's schedule claims it too —
duplicate ownership is named in [[sales-agent-stack]] §3, not resolved here.

Consumed, owned elsewhere: `claim-provenance-check` ([[sales-agent-stack]]); the landed
credit ([[design-partner-operations-agent-stack]]); copy craft ([[media-brand-charter]]);
the legal basis for cold contact ([[compliance-privacy-charter]]).

## 4. Memory

- **Procedural** — the one §3 skill; candidates go to [[skill-harvesting-charter]]'s queue
  and face the §3.3 gate. A dormant team is the easiest place in the org to fill a registry
  with fiction, so the gate is the whole defence.
- **Episodic** — nf_a `task_type: outbound_guard_run`, `claim_audit`, `trigger_check`. The
  guard run is the only episodic record this team can honestly produce today; complaint
  rate, reply rate, and suppression latency have no events because there are no sends. Needs
  `context.claim_id` and `context.trigger_state` so the monthly re-decision is a series.
- **Semantic** — `memory/` beside this file, index `outbound-engine-MEMORY.md`. Founding
  facts: the single-identity risk and where it lives; the unused isolation seam; and the
  `prospects` naming trap — that module captures **vendors emailing a restaurant**, the
  opposite direction from Mudavym selling to restaurants, a shape to copy and not a pipeline
  to inherit. That fact is a memory file precisely so a future agent does not re-derive it
  wrongly. Frontmatter per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §The one risk and §Entry trigger. The
  communications modules are grep targets (CLAUDE.md §2), and per §6 their line numbers must
  be re-resolved on each read rather than trusted.

**Consolidation** — quarterly, matching the claim audit and the monthly trigger checks
between them. **Failures first,** inverted for a dormant team: the failure worth recording
is *activity*, not inactivity. A month in which this team produced output while the entry
trigger was unmet becomes a fact naming the mechanism ([[sales-premortem]] M5); a month of
nothing is a correct outcome, recorded as one. Expire facts unverified for 90 days. One PR;
"no delta" stated. [[outbound-engine-schedule]] does not carry this row yet: wave 2 may not
edit the eight existing artifacts (GENERATION_BRIEF §7.3), so the mirror is a follow-up.

## 5. Async contract

Cross-unit interaction is loops ([[outbound-engine-loops]] `oe-identity-isolation-guard` …
`oe-qualification-calibration`), NF-A events, vault PRs, and skill candidates only. Gap
rows, and on this card most of the table is a gap by design:

| Gap | Why it is a gap |
|---|---|
| `outbound.stop_requested` has no publisher | There is no sending surface, so there is no stop path. Recorded rather than assumed: an org that cannot reliably stop emailing someone should not start ([[outbound-engine-charter]] §Boundaries), and this row must be filled *before* send #1, not after |
| `sales.credit_landed` has a designed publisher, not a built one | [[design-partner-operations-agent-stack|dpo-account-steward]] is `status: designed`; until it exists the monthly trigger check reads `PROJECT.md` and the reconciliation by hand |
| The target-list half of the entry trigger has no publisher at all | It is a founder decision with no owner and no event ([[sales-charter]] §Explicit non-goals). The monthly check exists so the deferral is re-decided rather than drifted into |
| `sales.complaint_rate`, `reply_rate`, `suppression_integrity` have no producers | Zero sends. The three dormant loops will produce nothing for three runs *by design* and are exempt from the anti-sprawl rule only while marked dormant ([[outbound-engine-schedule]]) |

## 6. Evidence today

- **NEW — the sentinel, and everything that is actually this team's mandate.** No sequencing
  tool, no sending domain, no warmup, no suppression list, no rubric, no reply routing, no
  allowlist, no sends; across 62 migrations no lead, deal, opportunity, or pipeline schema
  of any kind ([[outbound-engine-charter]] §Evidence). Nothing on this page describes a
  pipeline, because there is not one.
- **EXISTS — the risk the sentinel would watch.** One transactional Gmail identity with a
  hardcoded fallback, carrying vendor procurement mail and customer notifications; the
  inbound poller filters against that same resolved address.
- **EXISTS — the guard pattern to copy.** Nine `scripts/check_*.sh` guards run today; the
  import ban is one more of the shape, buildable before there is anything to send — which is
  why [[sales-schedule]] calls it the one worth building first: deliverability lost is not
  recovered by noticing.
- **PARTIAL — the isolation seam** (`EMAIL_BACKEND` plus a reserved `SENDGRID_API_KEY`,
  unused: isolation is configuration plus a domain purchase, not architecture) — **and a
  reusable pattern pointing the other way**: `prospects.service.ts` captures unknown-sender
  **vendor** mail, dedupes by domain, never auto-replies, one-tap promotion. A shape, not a
  pipeline.
- **Citation drift, measured 2026-08-27, flagged rather than reconciled.** Four of this
  team's risk citations no longer resolve where the charter puts them: the sender fallback is
  at `gmail.service.ts:77-79` (charter: `:76-78`); the poller filters at
  `communications.controller.ts:1101-1102,1123` and `:1246-1247,1271`, while `:1028-1031` is
  now the Gmail push webhook; `env.example` has `EMAIL_BACKEND` at `:172` and
  `SENDGRID_API_KEY` at `:174` (charter: `:165`, `:167`); `settings.py` reads the key at
  `:223` (charter: `:202`). **Every finding holds — only the line numbers moved.** Filed here
  as the freshest past instance for `claim-provenance-check`; the eight existing artifacts
  are not this wave's to edit (GENERATION_BRIEF §7.3).
