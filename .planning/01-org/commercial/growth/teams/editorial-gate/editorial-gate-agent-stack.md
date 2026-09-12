---
type: agent-stack
division: commercial
department: growth
team: editorial-gate
status: designed
updated: 2026-08-27
metrics: [editorial.claims_traceable_pct, editorial.gate_bypass_count, editorial.rejection_rate, editorial.overstated_claim_catches]
links: ["[[editorial-gate-charter]]", "[[editorial-gate-schedule]]", "[[editorial-gate-loops]]", "[[editorial-gate-premortem]]", "[[0034-agent-stack-artifact]]", "[[growth-agent-stack]]", "[[content-production-charter]]", "[[design-partner-operations-charter]]", "[[skills-charter]]"]
---

# Editorial Gate — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> G3 is **the mandatory human pass**, so this is the most constrained card in Growth: its agent
> prepares what a human reads and records that the human decided. **It produces no verdict, and
> that absence is the design.** Mechanisms referenced only: harness → [[harness-runtime-charter]]
> (**OD-03 open**), the mutation gate → [[action-safety-the-human-gate-charter]] (FUTURES §8.1),
> verdicts as sidecar claims → [[0017-doneability-verdicts-are-sidecar-claims]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `gate-preparer` | Put an unmapped-claim list and a construction flag list in front of the human before the pass, and after it make the verdict a committed object — so a bypass is an absent file in version control rather than a forgotten conversation | NEW |

## 2. Agent cards

```yaml
agent: gate-preparer
unit: editorial-gate
triggers:
  - topic: draft.submitted        # publisher: [[content-production-charter]] — its draft + provenance record
  - schedule: "weekly — bypass diff: published pages with no committed verdict artifact"
  - schedule: "quarterly — published-claim re-audit (L-G3-3), complete and not sampled"
consumes:
  - the draft and its provenance record, from G2
  - the banned-construction list — this team's own document. NONE today (gap)
  - the voice guide — publisher [[brand-identity-charter]]. NONE today (gap)
  - "verified-recovery evidence — publisher: [[design-partner-operations-charter]] (an 812 credit memo observed against a later invoice)"
emits:
  - "an unmapped-claim list and a flag list → the human reviewer. Neither carries a pass/fail field"
  - "editorial.gate_bypass_count → [[growth-agenda-board]] (consumer: [[growth-agent-stack]]'s rollup)"
  - "the human's verdict, recorded as the doneability half of G2's nf_a article_draft events (ADR 0017)"
  - nf_a events (task_type: gate_prepare)
routing_class: extraction        # mapping sentences to sources and matching a list is extraction; the judgment is the human's and is not on this card
quality_bar: "the output must contain no pass/fail field. A run that emits anything a downstream step could consume as a verdict is a failed run, not a strict one"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: editorial-gate
escalates_to: "[[growth-charter]]"
```

**This card has no `decide` action family, deliberately.** FUTURES §8.1's tiers are read,
propose, and mutate; the gate's verdict is none of them, because it is not this agent's to make.
Writing the verdict artifact is a *record of a human decision*, not a decision. If anything
downstream ever reads `gate-preparer`'s output as a gate result, [[editorial-gate-premortem]] M1
has happened without anyone deciding to do it — [[editorial-gate-schedule]] calls that the single
most important line in its document, and it is repeated here on purpose.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `claim-provenance-audit` | T2 | Per unit at submission, and quarterly over the corpus | Every factual sentence mapped to a source, or a list of the unmapped ones. **It produces a list, never a verdict** | The catch is already on the record: [[YC_WEDGE_PLAN]]:31-33 states that until an 812 credit memo lands on a later invoice, "dollars recovered" describes a **request**, not a receipt — found and written down by hand, and the stronger claim is still being made verbally, which is why [[editorial-gate-schedule]]'s quarterly recovery-claim verification can run before a single page exists | NEW |

The schedule's three other proposals — `banned-construction-check`, `verdict-artifact-write` and
`published-claim-sweep` — cite no past instance and are **not rows here** (README §3.3). The
first carries a definitional constraint that survives the row's absence: it emits a flag list and
**no verdict field**, and if it ever gains one the mandatory human pass has been automated.
Consumed, owned elsewhere: the registry ([[skills-charter]]); the voice guide it enforces
([[brand-identity-charter]]); the recovery evidence ([[design-partner-operations-charter]]).

## 4. Memory

- **Procedural** — the §3 skill; candidates via [[skill-harvesting-charter]]'s queue, and this
  team asks that the 30-day unfired review never retire a skill whose absence makes the gate faster.
- **Episodic** — nf_a `task_type: gate_prepare`, and this unit is the **producer** of the outcome
  half of G2's `article_draft` events. Needs `context.unit_id` and `context.check_failed`
  (`claims` | `banned` | `voice`) as jsonb keys, so `editorial.rejection_rate` can be read by
  check rather than as one number — the charter reads that rate in both directions and a single
  figure cannot tell a well-trained writer from a gate that stopped looking.
- **Semantic** — `memory/` beside this file, index `editorial-gate-MEMORY.md`. Its founding fact
  is the claim-strength rule with `source` = [[YC_WEDGE_PLAN]]:31-33, and every firing of that
  rule becomes another fact. **One expiry exception, stated because it is the whole risk:** the
  recovery-claim fact must never expire into silence at 90 days — it expires into the quarterly
  re-verification with S1, because a lapsed fact here is how the stronger claim gets published.
- **Working** — this card, the MEMORY index, charter §Mandate and "The claim this gate exists
  for", the banned list, and the draft under review. Nothing else preloads.

**Consolidation** — monthly, with the rule-amendment read (L-G3-2). Failures first: every case
decided with **no citable clause** becomes either a banned-list entry or an amendment request to
[[brand-identity-charter]], because a rule applied without a clause is the gate enforcing taste;
expire at 90 days with the exception above. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops in [[editorial-gate-loops]], NF-A events, vault PRs and skill
candidates. The gate itself is a human step and is not an interface any other unit may call.
Gap rows:

| Gap | Why it is a gap |
|---|---|
| The voice guide has no publisher | Check 3 has nothing external to point at (charter §Evidence). Until [[brand-identity-charter]] writes it, the gate is defending an opinion, and an opinion loses an argument with a deadline |
| `draft.submitted` has no publisher | There is no draft anywhere in the repo and no publishing target. The card's triggers are real; its input is not |
| `editorial.gate_bypass_count` = 0 for the wrong reason | The weekly bypass diff needs a set of published pages to diff against, and there are none. The number must be reported as **0 (no corpus)**, never as 0 (clean) — the two look identical on a board and mean opposite things |
| Verified-recovery evidence is quarterly and manual | [[design-partner-operations-charter]] produces it; nothing notifies. The quarterly job is the only mechanism, which is acceptable for a claim that changes rarely and unacceptable if it is ever quoted between runs |

## 6. Evidence today

- **NEW as a function.** No banned-construction document, no provenance format, and no recorded
  verdict anywhere in the repo. Nothing to gate: no draft, no article, no answer page.
- **EXISTS — the structural precedent that makes this native rather than imported.** Human
  approval before an outward-facing artifact leaves the building is this codebase's shipped
  default: vendor-reply drafts are staged and never auto-sent, and one-tap recommendation actions
  require a person.
- **EXISTS — the discipline, written in code.**
  `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:119-120` — a zero-price Offer is a
  valid document and a false statement. A well-formed, unsourced article is the same object; and
  `apps/web/src/pages/Privacy.tsx:8-11` holds it in the other direction, a public page whose header
  says it must change when the code does.
- **EXISTS — the claim the gate exists for**, documented and dated at [[YC_WEDGE_PLAN]]:31-33.
- **NEW — the agent, the skill, and every memory layer** except the NF-A tables (ADR 0006/0008).
