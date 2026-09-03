---
type: agent-stack
division: corporate
department: legal
team: commercial-workforce-agreements
status: designed
updated: 2026-08-27
metrics: [legal.request_to_executable_draft_days, legal.clause_library_hit_rate, legal.annex_satisfiability_signoff, legal.named_reviewer_coverage, nf_a.doneability_verdict]
links: ["[[commercial-workforce-agreements-charter]]", "[[commercial-workforce-agreements-schedule]]", "[[commercial-workforce-agreements-loops]]", "[[commercial-workforce-agreements-directive]]", "[[commercial-workforce-agreements-premortem]]", "[[0034-agent-stack-artifact]]", "[[legal-agent-stack]]", "[[instruments-equity-agent-stack]]", "[[skills-charter]]", "[[regulatory-posture-charter]]"]
---

# Commercial & Workforce Agreements — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team owns the most attractive and most dangerous agent surface in the company: a
> legal drafting assistant. The card is therefore written at the *less* impressive shape —
> **retrieval, never generation; `[GAP]` markers instead of graceful completion; a named
> human on every execution** ([[commercial-workforce-agreements-schedule]]). **No agent
> here sends, signs, files or executes**, and nothing here is drafted legal text (R7).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `cw-clause-steward` | Assemble a repeatable instrument out of reviewed clauses, mark every hole `[GAP]` rather than writing over it, and keep the hit-rate/turnaround metric pair and the redline log true | NEW |

One row. The nine instruments differ by counterparty, not by procedure — an agent per
document class would be nine wirings of one job.

## 2. Agent cards

```yaml
agent: cw-clause-steward
unit: commercial-workforce-agreements
triggers:
  - topic: legal.paper_requested         # lane = repeatable; publisher: NONE (gap — routed by hand, see [[legal-agent-stack]])
  - topic: counterparty.redline_received # publisher: NONE (gap — a redline arrives as an email attachment nothing watches)
  - schedule: "weekly — queue ageing on open requests only (L-CW-5, close_time weekly)"   # [[commercial-workforce-agreements-schedule]]
  - schedule: "monthly — library health, the metric pair (L-CW-1)"
consumes:
  - the clause library and its version-to-counterparty map — NONE (gap): the library does not exist (charter §Evidence)
  - "the fallback ladder rungs in [[commercial-workforce-agreements-directive]] — decided once by the founder with counsel, applied here, never set here"
  - "counterparty redlines (L-CW-3) and [[legal-directive]] R1–R7"
emits:
  - "an assembled draft carrying [GAP] markers → a named human reviewer (CW-5), then outside counsel — never a counterparty"
  - "redline log entries → legal.concessions_unlogged (target permanently 0)"
  - "hit-rate vs turnaround classification → [[commercial-workforce-agreements-agenda-board]] and the rollup in [[legal-agent-stack]]"
  - "a hold on any DPA/BAA until [[regulatory-posture-charter]] co-signs the Annex (L-CW-2) — consumer chartered, not running; CORP-F2 open"
  - nf_a events (task_type: assisted_draft)
routing_class: extraction        # assembly from a reviewed library is retrieval; a judgment-class legal draft is [[legal-premortem]] M5 written into a card
quality_bar: "nf_a.doneability_verdict defined as *a named human reviewed it and no [GAP] remains* — never *the agent completed* (charter §Metrics). A run emitting zero [GAP] markers is a defect until proven otherwise ([[commercial-workforce-agreements-schedule]])"
autonomy:
  read: autonomous
  propose: autonomous            # every output is a draft; drafts land for a named reviewer
  mutate_stock_money_outbound: confirm    # constant; and outbound here means a counterparty, so it is never this agent's to press
memory: commercial-workforce-agreements
escalates_to: "[[legal-charter]]"   # then OPEN-DECISIONS.md per [[legal-directive]] §Escalation (a redline outside every agreed rung is condition 3)
```

**The card's own hard rule:** `cw-clause-steward` never composes prose over a gap. The
version of this agent that demos best is the version that fails worst
([[commercial-workforce-agreements-premortem]] M4).

## 3. Skills

*Empty, and honestly so.* This team has repeated no procedure: zero requests, zero drafts,
zero redlines, zero DPAs, and no clause library to assemble from (charter §Evidence). The
five skills proposed in [[commercial-workforce-agreements-schedule]] — `legal-doc-draft`,
`clause-library-diff`, `redline-log`, `annex-obligation-map`, `live-version-map` — are
defensible designs with **no past instance to cite**, and README §3.3 rule 3 deletes such
a row rather than parking it. The first to earn one will be whichever fires first against
a real request.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]], Applied
AI); the UCC commitment guardrail (engineering + ADR 0013), today the only running control
stopping an agent's outbound message from committing the company — see §6.

## 4. Memory

- **Procedural** — none yet (§3). Growth path: the quarterly **library promotion pass** —
  counsel-seen clauses enter the library and the procedure that assembled them becomes a
  candidate in [[skill-harvesting-charter]]'s queue, still facing the §3.3 gate.
- **Episodic** — nf_a `task_type: assisted_draft`. Needs four jsonb `context` keys or the
  metric pair cannot be computed at all: `instrument_type`, `gap_marker_count`,
  `library_version`, and `reviewer_name` — **a name, never "AI"** (CW-5). Turnaround is a
  **median** over these rows, never a sum (L-CW-5).
- **Semantic** — `memory/` beside this file, one fact per file with `source` ·
  `confidence` · `last_verified`; index `commercial-workforce-agreements-MEMORY.md`. It
  holds what a fresh session otherwise re-derives wrongly: which rung each contentious
  section was decided at, and **which library version governed which counterparty on their
  signature date** — a question a current-library read answers confidently and wrongly.
  Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the ladder rungs for
  the sections in play. The library is retrieval **by section**, never preloaded: a
  whole-library context is the condition under which a model writes across sections
  instead of citing them.

**Consolidation** — monthly, alongside the existing library-health job (L-CW-1; that
schedule does not yet name a consolidation row, and adding it is a one-line edit this
artifact does not make). Read the NF-A slice, **failures first**: every zero-`[GAP]` run
becomes a fact naming the section written over, not "output looked complete"; a second
fresh write of the same section becomes a library candidate. Expire facts unverified 90
days. One PR; until requests exist it states "no delta" rather than going silent.

## 5. Async contract

Loops ([[commercial-workforce-agreements-loops]] — weekly, monthly, per-event close_times),
NF-A events, vault PRs and skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `legal.paper_requested` has no publisher | No request path exists anywhere in the department; the weekly queue job bounds the blind spot at 7 days, and reports "no open requests" until then |
| `counterparty.redline_received` has no publisher | A redline arrives as an attachment to a human; nothing emits an event. L-CW-3's close_time depends on a human forwarding it |
| The clause library has no home | Every assembly `consumes` row depends on it. Until it exists, `legal.clause_library_hit_rate` is 0% by definition, not by measurement |
| The Annex co-signer is chartered, not running | [[regulatory-posture-charter]] must sign each DPA/BAA Annex against a **named, existing** test. Erasure is graded untested end-to-end and GDPR/CCPA appear zero times in source (`corporate.md:31`), so the gate's first firing should fail. **CORP-F2 stays open** — this artifact does not pick a side |
| No grader exists for `nf_a.doneability_verdict` here | ADR 0017 verdicts are sidecar claims and none of its graders covers legal drafting. The verdict basis is a human signature — a rule that exists, a mechanism that does not |

## 6. Evidence today

- **NEW — the steward, the library, the ladder, the redline log, and all five skills.** No
  contract, template or clause library exists anywhere in the repo (`corporate.md:104-106`).
- **EXISTS — the downstream consumer, already built.**
  `apps/api-gateway/src/common/orchestrator/commercial-terms.ts:21-38` parses a supplier's
  currency, prices, MOQ, discount tiers, `payment_terms` (line 33) and per-field provenance
  (line 38). The company reads its suppliers' commercial terms as structured data and has
  never agreed any of them in writing. That parser is Engineering/procurement's; citing it
  is not claiming it.
- **EXISTS — the one control that already stops an agent short of committing us.** The UCC
  commitment guardrail: canon `commitment-patterns.ts`, generated
  `services/agent-orchestrator/core/commitment_patterns.py`, generator
  `scripts/sync_commitment_patterns.py`, and three drift guards — the Python sync test,
  the gateway spec, and the blocking CI job `commitment-guardrail-sync`
  (`.github/workflows/ci.yml:58-74`), all proven to fail on a deleted pattern (ADR 0013).
  It guards *outbound messages*, not drafts — this team's `[GAP]` and named-reviewer rules
  are the equivalent control for paper, and they are NEW.
- **PARTIAL — the skills substrate.** `.claude/skills/` now exists but holds only
  `README.md`, recording "**Current state: zero committed skills**"
  (`.claude/skills/README.md:6`) — the charter's "directory is absent" is stale, its
  substance holds.
- **NEW — everything in §4** except the NF-A tables themselves (ADR 0006/0008/0017).
