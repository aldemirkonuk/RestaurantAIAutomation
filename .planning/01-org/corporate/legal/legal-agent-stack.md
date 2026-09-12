---
type: agent-stack
division: corporate
department: legal
status: designed
updated: 2026-08-27
metrics: [legal.instrument_chain_integrity, legal.request_to_executable_draft_days, legal.clause_library_hit_rate, legal.counsel_gate_compliance, legal.annex_satisfiability_signoff, nf_a.doneability_verdict]
links: ["[[legal-charter]]", "[[legal-schedule]]", "[[legal-loops]]", "[[legal-directive]]", "[[legal-premortem]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[instruments-equity-agent-stack]]", "[[commercial-workforce-agreements-agent-stack]]", "[[regulatory-posture-charter]]", "[[decision-office-charter]]"]
---

# Legal — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> **No agent in this department signs, files, sends, or executes anything.** Every output
> is a draft or a hold, addressed to a named human and then to outside counsel
> ([[legal-directive]] R1); nothing in this file is drafted legal text (R7). Mechanisms
> are referenced, never restated: harness → [[harness-runtime-charter]] (**OD-03 open**),
> model choice → [[model-routing-inference-economics-charter]], the mutation gate →
> [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `legal-intake-registrar` | Assign every request for paper to a lane (one-way door · repeatable · data instrument), keep the open-request ageing list true, and sweep this vault for clause-shaped prose — drafting nothing itself | NEW |

One row. Drafting and checking both belong to the two teams; lane assignment is the one
job that is genuinely departmental ([[legal-schedule]], per-request row).

## 2. Agent cards

```yaml
agent: legal-intake-registrar
unit: legal
triggers:
  - topic: legal.paper_requested        # publisher: NONE (gap — no request path exists; a request is a sentence to the founder today)
  - schedule: "weekly — open-request standup, ageing on open requests only"   # [[legal-schedule]]
  - schedule: "quarterly — R7 clause-language sweep; staleness sweep; L-LEG-5 team-shape review"
consumes:
  - the instrument register — NONE (gap): the register is a charter concept, not a file
  - "[[legal-directive]] lane rules R1–R7 (vault, read at task start)"
  - "the two team boards — [[instruments-equity-agenda-board]], [[commercial-workforce-agreements-agenda-board]] (Dataview output)"
emits:
  - "lane-routed register entries → [[instruments-equity-agent-stack|ie-chain-warden]] and [[commercial-workforce-agreements-agent-stack|cw-clause-steward]]"
  - "ageing list and R7 rewrite list → [[legal-agenda-full]] §Questions, as a vault PR"
  - "escalations → OPEN-DECISIONS.md, per [[legal-directive]] §Escalation trigger (six named conditions)"
  - nf_a events (task_type: legal_intake_route)
routing_class: extraction        # read the request, match it against a rule table; the lane rules are written, not inferred
quality_bar: "every routed request names its lane, its gates, and the date it was received; a request whose terms are absent is HOLD, never a best guess (R3). NONE (gap) — ADR 0017 defines no grader for legal work, and the terminal grade here is human: counsel review before signature"
autonomy:
  read: autonomous
  propose: autonomous            # lanes, holds and lists land as register entries and PRs
  mutate_stock_money_outbound: confirm    # constant; and this agent has no send, sign or file surface at all
memory: legal
escalates_to: "[[OPEN-DECISIONS]]"   # advisory is findings-only ([[ORG_STRUCTURE]] §3) — [[decision-office-charter]] does not approve or block instruments
```

**The card's own hard rule:** the registrar never infers a term and never drafts. R3 makes
inference a stop condition; M5 is what filling a hole with fluent prose produces.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `binding-surface-census` | T2 | Any new outbound-message path, or any code comment claiming one runtime's commitment guardrail is "ported verbatim" from another | A per-runtime table — pattern count, auto-send behaviour, guard present — every row read off disk; a divergence is named with `path:line` or the census says "no divergence" | **2026-08-25, ADR 0013**: `inbound-responder.service.ts:44-48` claimed verbatim parity; the measured counts were 19 / 8 / 3 across three runtimes, and the one that could actually bind the restaurant to a purchase ran the weakest list under two false parity comments | NEW |

One row, and the seam matters: the guardrail's canon, generator and CI job are
**engineering's** (§6); Legal owns only the question the census answers — *which surfaces
can bind Mudavym to another party*. Claiming the code would be the overreach the charter
refuses over `commercial-terms.ts`. The seven skills in [[legal-schedule]] are absent
deliberately: no past instance, and README §3.3 rule 3 deletes such a row.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]], Applied
AI); the commitment guardrail's CI enforcement (engineering, ADR 0013).

## 4. Memory

- **Procedural** — the one §3 skill. The six checkers in [[legal-schedule]] enter through
  [[skill-harvesting-charter]]'s queue after their first firing, not before.
- **Episodic** — nf_a `task_type: legal_intake_route`, plus read access to both teams'
  families (`assisted_draft`, `instrument_chain_check`). Needs `context.lane` and
  `context.instrument_type` as jsonb keys so queue ageing is one filter.
  **`nf_a.doneability_verdict` is strictest here** — "the agent produced a document" and
  "the document is safe to sign" are different claims ([[legal-charter]] §Metrics tie).
- **Semantic** — `memory/` beside this file, one fact per file, frontmatter carrying
  `source` · `confidence` · `last_verified`; index `legal-MEMORY.md`. Two founding facts
  would be files one and two: the 19/8/3 commitment-guardrail counts (source: ADR 0013,
  2026-08-25), and that the only counterparty-facing surfaces today are a stale privacy
  *notice* and a supplier-terms *parser*, neither an agreement. Every write is a PR.
- **Working** — this card, the `legal-MEMORY.md` index, charter §Mandate, the seven
  directive rules. Team charters and the future library are retrieval, never preloaded.

**Consolidation** — quarterly, alongside the existing staleness sweep in [[legal-schedule]]
(which does not yet name a consolidation job; adding the row is a one-line edit this
artifact does not make). Read the NF-A slice, **failures first** — a request that sat past
its close_time becomes a fact naming which gate held it, not "the queue was slow"; expire
facts unverified 90 days; propose candidates. One PR. Monthly was rejected: an empty
register reports "no delta" three runs running, which the anti-sprawl rule deletes.

## 5. Async contract

Loops ([[legal-loops]] — per-event, monthly, quarterly), NF-A events, vault PRs and skill
candidates only. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `legal.paper_requested` has no publisher | There is no request path — [[legal-charter]] §Boundaries owns one that does not exist. The weekly standup bounds the blind spot at 7 days |
| The instrument register has no home | Every `consumes` row above depends on it. Until it is a file, the registrar's input is a human recollection |
| Escalation is a doc edit, not an event | OPEN-DECISIONS.md and [[legal-agenda-full]] §Questions are read by whoever opens them; nothing notifies |
| The Annex co-signature's other side is a charter, not a running unit | [[regulatory-posture-charter]] must sign every DPA/BAA Annex. **CORP-F2 is open** (`corporate.md:495`): confirm the two-signature rule or give one team both halves. This artifact does not pick |

## 6. Evidence today

- **NEW — the registrar, the register, the request path, and all fifteen document types**
  (`.planning/foundation/teams/corporate.md:29` grades Legal `EXISTS —`, `PARTIAL —`,
  `NEW: all 15`).
- **EXISTS — the UCC commitment guardrail, this department's only running machinery.**
  Canon `apps/api-gateway/src/common/orchestrator/commitment-patterns.ts`; generated
  `services/agent-orchestrator/core/commitment_patterns.py` (marked GENERATED); generator
  `scripts/sync_commitment_patterns.py`; three drift guards —
  `services/agent-orchestrator/tests/test_commitment_patterns_sync.py`, the gateway spec
  `commitment-patterns.spec.ts`, and the blocking CI job `commitment-guardrail-sync` at
  `.github/workflows/ci.yml:58-74` — all proven to fail on a deleted pattern, then restored
  (ADR 0013). "No agent binds the company" as running code: engineering's, cited by Legal.
- **PARTIAL — the commercial surface.** `commercial-terms.ts:21-38` parses a supplier's
  `payment_terms` (line 33) with per-field provenance (line 38). The data side is built;
  the paper that would make it enforceable does not exist.
- **Correction to a 2026-08-24 claim.** The charter and schedule state `.claude/skills/` is
  absent. It now exists holding only `README.md`, which records "**Current state: zero
  committed skills**" (`.claude/skills/README.md:6`) — the directory claim is stale, its
  substance holds.
- **Open and left open:** OD-03, CORP-F2, the trim (L-LEG-5), and **CORP-F1 / OD-17**,
  which asked whether a team gets seven artifacts. This file makes it nine — that sharpens
  the fork, it does not answer it.
