---
type: agent-stack
division: commercial
department: growth
status: designed
updated: 2026-08-27
metrics: [demand.uncovered_keyword_count, demand.wedge_share_of_corpus, content.published_units_per_week, content.faq_orphan_pages, editorial.claims_traceable_pct, editorial.gate_bypass_count, seo.indexed_pages, seo.soft_404_rate, answer_surface.assistant_citations, funnel.visit_to_activated_rate, funnel.measurable_steps, funnel.fabricated_social_proof_count]
links: ["[[growth-charter]]", "[[growth-schedule]]", "[[growth-loops]]", "[[growth-agenda-board]]", "[[growth-directive]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[ai-orchestration-charter]]", "[[decision-office-charter]]"]
---

# Growth — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Department-level stacks orchestrate the **unit**, not the teams' work: this card watches
> five team boards, six loops with close_times, and the two seams that have two owners each.
> Mechanisms are referenced, never restated — harness → [[harness-runtime-charter]] (**OD-03
> open**), model choice → [[model-routing-inference-economics-charter]], the mutation gate →
> [[action-safety-the-human-gate-charter]], the skill envelope → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `growth-board-keeper` | Publish the five team numbers and the three hard zeros as a **set**, never a score, and escalate any pipeline stage that is blocked or any requirement whose two owners mean it has none | NEW |

One row deliberately. Each of the five pipeline stages already has a team and a card; a
department agent that drafted, gated, or measured would duplicate one of them. Its whole job
is the thing no team can do from inside itself: read the five boards together.

## 2. Agent cards

```yaml
agent: growth-board-keeper
unit: growth
triggers:
  - schedule: "monthly — checklist versus outcome (L-GRO-6, close_time monthly)"  # [[growth-schedule]]
  - schedule: "weekly — gate health read (L-GRO-2, close_time weekly)"
  - topic: content.unit_published        # publisher: NONE (gap — no publishing target exists; §5)
consumes:
  - the five team agenda-boards (Dataview output) — published by the five team schedules
  - "[[growth-loops]] L-GRO-1…6 rows and their close_times"
  - nf_a events sliced by Growth task types (ADR 0006/0008) — publisher: G2's drafting path, unbuilt
emits:
  - "[[growth-agenda-board]] rollup — five numbers + three zeros, never averaged (charter §Metrics)"
  - "escalations into [[growth-agenda-full]] §Questions — consumer: [[decision-office-charter]]"
  - nf_a events (task_type: growth_board_rollup)
routing_class: extraction        # reading boards and counting is not judgment
quality_bar: "every row carries a value, the word 'blocked', or 'unmeasurable' with its failed precondition named; a single composite growth score is a failed run (charter §Metrics, ADR 0020)"
autonomy:
  read: autonomous
  propose: autonomous            # board edits and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant; publishing to a public URL is an outbound act and no Growth card holds it
memory: growth
escalates_to: "[[decision-office-charter]]"
```

**Open forks stay open.** CM-F1 (five teams or four) is recorded, not resolved: this stack is
written as five rosters because the directory is five teams. If CM-F1 lands on four, G3's card
moves inside G2's file and `editorial.gate_bypass_count` needs a new owner — no card's contents
change. CM-F2 and CM-F4 likewise untouched.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `checklist-outcome-assertion` | T2 | Monthly L-GRO-6, and any time a checklist item is proposed green | Every green item asserted against its bound outcome metric; an item whose metric is unreadable is recorded *unreadable*, never done | The 2026-08-24 charter pass graded both checklists against the working tree and found two entries false on inspection: the soft 404 (`vercel.json:12-15` above `apps/web/src/App.tsx:302`) and "no product analytics of any kind", corrected against `apps/web/src/lib/uxSignals.ts:15,20-23` | NEW |
| `seam-owner-check` | T2 | Any requirement or checklist item that names two owners | A written verdict naming the one unit that can ship it, or an escalation; "co-owned" with no shipper fails | The 404 seam — G4 owns the status code (`vercel.json:12-15`), G5 owns the page (`apps/web/src/components/ui/error-state.tsx:142`, routed nowhere) — was found by manual cross-reading in the same pass and recorded in [[growth-directive]] | NEW |

Consumed, owned elsewhere: the envelope and registry ([[skills-charter]]); the 30-day
unfired review ([[skill-lifecycle-anti-sprawl-charter]]). Growth authors, it does not govern.
The other seven proposals in [[growth-schedule]] belong to teams and appear on their stacks.

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation enter
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: growth_board_rollup`, plus read access to every G1–G5 task
  family. Needs `context.team` (G1…G5) and `context.pipeline_stage` as jsonb keys, so a
  per-stage slice is one filter rather than a join this department invents.
- **Semantic** — `memory/` beside this file, index `growth-MEMORY.md`. Its founding facts are
  already measured and would be its first three files: `seo.soft_404_rate` = 100% and the two
  layers causing it; `funnel.measurable_steps` = 0 for every pre-login step; and the published
  privacy promise at `apps/web/src/pages/Privacy.tsx:30-31` that any conventional analytics tag
  would falsify. Provenance frontmatter per ADR 0034; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team charters and
  the large planning corpus are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly, run beside the L-GRO-6 read; [[growth-schedule]] does not yet
carry the row and this wave does not edit it, so the row is proposed here and lands at that
document's next revision. Read the department's NF-A slice and the five boards since the last
run; write one fact per durable finding, **failures first** — a stage that went from *blocked*
to *reporting* gets a fact naming what unblocked it, not "improved"; expire facts unverified
for 90 days; emit skill candidates. One PR, and "no delta" is stated rather than skipped.

## 5. Async contract

Cross-unit interaction is loops in [[growth-loops]], NF-A events, vault artifacts and PRs, and
skill candidates. Never a synchronous call. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `content.unit_published` has no publisher | There is no publishing target: `apps/web/public/` holds seven files, none of them a crawl file, and the only public content route is `apps/web/src/App.tsx:161`. Until one exists, every content row reads *blocked*, never zero |
| The five team boards are renders, not events | Dataview output changes silently; nothing notifies this department. The weekly/monthly schedule bounds the lag at one close_time |
| Growth NF-A is not emitted | The cost half has an insertion point (`services/agent-orchestrator/services/spend_logger.py`); the drafting task that would use it does not exist, and the outcome half is G3's verdict, also unbuilt |
| Escalation to the Decision Office is a doc edit | An acceptable async path (vault PR), but nothing notifies — their schedule must poll [[growth-agenda-full]] §Questions |

## 6. Evidence today

- **NEW — the agent and both skills.** Nothing performs either procedure on a cadence; both
  were done once, by hand, in the 2026-08-24 generation session, which is the instance that
  justifies them.
- **PARTIAL — the substrate it would read.** The five agenda-boards exist as Dataview queries
  and the six loops carry close_times; no NF-A event in a Growth task family is emitted.
- **EXISTS — the defects it would report.** The two-layer soft 404 (`vercel.json:12-15`,
  `apps/web/src/App.tsx:302`), the dark post-login instrument
  (`apps/web/src/lib/uxSignals.ts:15,20-23`), and the published privacy position
  (`apps/web/src/pages/Privacy.tsx:30-31`) are all verified in the working tree.
- The honest consequence: run today, this agent's board is mostly *blocked* and *unmeasurable*
  rows. That is the correct output, not a broken one — ADR 0020's whole point.
