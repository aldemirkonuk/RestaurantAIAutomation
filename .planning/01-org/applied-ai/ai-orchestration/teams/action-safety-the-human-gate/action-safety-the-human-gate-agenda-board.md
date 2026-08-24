---
type: agenda-board
division: applied-ai
department: ai-orchestration
team: action-safety-the-human-gate
status: provisional
metrics: [safety.unconfirmed_mutation_count, safety.median_time_to_confirm, safety.rejection_rate]
updated: 2026-08-24
links: ["[[action-safety-the-human-gate-charter]]", "[[action-safety-the-human-gate-agenda-full]]", "[[action-safety-the-human-gate-premortem]]", "[[action-safety-the-human-gate-loops]]", "[[ai-orchestration-agenda-board]]", "[[design-charter]]", "[[compliance-and-privacy-charter]]"]
---

# Action Safety & the Human Gate — Board

> **PROVISIONAL — no work done yet.**

> **The guarantee:** *Ask → propose → confirm → execute. AI never silently mutates
> stock, money, or outbound vendor email.* — `.planning/FUTURES.md` §8.1
> **Not a tunable.** Changing it is a supersede-ADR, not a PR.

## This team's artifacts

```dataview
TABLE type, status, updated
FROM "01-org/applied-ai/ai-orchestration/teams/action-safety-the-human-gate"
SORT type ASC
```

## Sibling teams — for seam checks

```dataview
TABLE WITHOUT ID file.link AS Team, status
FROM "01-org/applied-ai/ai-orchestration/teams"
WHERE type = "charter" AND team != this.team
SORT file.name ASC
```

## Numbers

| Metric | Today | Nature |
|---|---|---|
| `safety.unconfirmed_mutation_count` | **unmeasured** | Hard zero. Non-zero = **reportable incident**, not a bug |
| `safety.median_time_to_confirm` | **unmeasured** — data exists at `one-tap-actions.service.ts:245-246` | Trend line. **The real subject of this team** |
| `safety.rejection_rate` | **unmeasured** | A gate that never rejects is not gating |
| `safety.schema_coverage` | **partial** — 4 conventions, not 1 mechanism | Drive to 100% |
| `safety.allowlist_additions_vs_removals` | unmeasured | An allowlist that only grows is a feature list |

## The four conventions — each real, each independently forgettable

- [x] `agents/drift_agent.py:8-12` — *"Money / stock → `drift_findings` … never auto-applied"*
- [x] `one-tap-actions/` — 9 routes, `executed_by` / `executed_at` (`:245-246`), `action_executed` (`:267`)
- [x] Vendor-reply AI — drafts, one-tap approve, **never auto-sends**
- [x] `ux-optimizer/` — human-gated, **never auto-applies**
- [ ] **One schema behind all four** — `technology.md:441`, **NEW**

## Unresolved auto-execution path

- ⚠️ `agents/recurring_order_agent.py:14` — plain class, registered nowhere, no harness
  guarantees, feature list says **"Auto-execution with manager approval"**. Is that a
  confirmation or a standing autonomy tier? *Unanswered.*

## Unblocked now

- [ ] `median_time_to_confirm` + `rejection_rate` from existing columns — **watch the distribution, not the median**
- [ ] Define "mutation entry point"; publish `schema_coverage`
- [ ] Write down what a **confirmation** is — a human decision about a *specific, composed* action

## Blocked

- [ ] CI check: confirmation upstream of mutation *(needs the definition)*
- [ ] Per-family autonomy tiers + friction floor *(needs the definition + [[design-charter]] seam)*
- [ ] Confirmation → proposal snapshot link *(NF-A schema)*

## Watch signals

- [ ] `time_to_confirm` distribution **losing its long tail** — approval has become reflex
- [ ] `rejection_rate` approaching zero
- [ ] A new mutation path shipped outside the action schema
- [ ] A quarter with allowlist **additions and zero removals**
- [ ] Any confirmation record that cannot answer *"what was on the screen"*
- [ ] Any auto-execution path outside the one-tap action center

## Open forks

- [ ] Is a standing pre-approval a confirmation, or an autonomy tier?
- [ ] Design seam — surface (Design) vs friction floor on money/stock (here)
- [ ] How many confirmations per day is acceptable? *(a real attention budget)*
- [ ] Guest PII exports — [[compliance-and-privacy-charter]] owns the entry, we enforce?
- [ ] Who may change an autonomy tier? *(proposal: toward more autonomy = ADR; toward less = PR)*
