---
type: schedule
division: corporate
department: legal
team: commercial-workforce-agreements
status: provisional
metrics: [legal.clause_library_hit_rate, legal.request_to_executable_draft_days, legal.named_reviewer_coverage]
updated: 2026-08-24
links: ["[[commercial-workforce-agreements-charter]]", "[[commercial-workforce-agreements-loops]]", "[[commercial-workforce-agreements-agenda-board]]", "[[commercial-workforce-agreements-directive]]", "[[legal-schedule]]", "[[skills-charter]]", "[[regulatory-posture-charter]]", "[[README|foundation-README]]"]
---

# Commercial & Workforce Agreements — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per request | Intake and lane check — is this ours, or a one-way door? Is it a data instrument? | Register entry; routing to [[instruments-equity-charter]] or the CW-6 gate |
| Per agreement | Redline ladder maintenance — L-CW-3. Which clause moved, to which rung, why | Redline log; `legal.concessions_unlogged` (target permanently 0) |
| Per data instrument | Annex satisfiability co-signature with [[regulatory-posture-charter]] — L-CW-2 | Hold or release; a named test per Annex commitment |
| Per execution | Reviewer check — CW-5. A name, never "AI" | `legal.named_reviewer_coverage` |
| Weekly | Turnaround and queue ageing — L-CW-5. **Only once requests exist**; until then it reports "no open requests" | Median + round-trips, never summed; ageing on **open** requests |
| Monthly | Library health, the metric pair — L-CW-1 | Hit rate vs turnaround classification; fresh-write list; escalation on a second fresh write of the same section |
| Monthly | Assisted-draft doneability — L-CW-4 *(dormant until the skill exists)* | `[GAP]`-marker rate; a zero rate is a defect |
| Quarterly | **Library promotion pass** — counsel-seen clauses from executed agreements enter the library | New reviewed sections; provenance per clause |
| Quarterly | **Uncited-section review** — any section never cited in six months is reviewed for deletion (CW-7) | Deletion list |
| Quarterly | **Live-version audit** — which library version governs which live counterparty | Divergence list |
| Quarterly | Clause-language sweep of this vault — [[legal-directive]] R7 | Rewrite list. Expected empty |

The **live-version audit** is the one line here that is easy to skip and expensive to skip.
Once the library has versions, "what did we promise *this* customer" is answered by the
version that governed on their signature date, not by the current library. A library with
no version-to-counterparty map produces confident wrong answers, which is worse than the
twenty-PDF problem it replaced.

**No daily cadence.** Nothing here fails daily, and a job that produces no action for three
runs gets deleted by the org's own anti-sprawl rule (GENERATION_BRIEF §3.8).

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**`.claude/skills/` does not exist in this repo.** [[README|foundation-README]] §3.2 names
`legal-doc-draft` as a T2 department skill (line 145) — that name is currently the entire
skill surface, and this team owns it.

| Proposed skill | Shape | Fires on | Hard constraint |
|---|---|---|---|
| `legal-doc-draft` | **Retrieval** | A request in the repeatable class | Assembles reviewed clauses; emits `[GAP]` where the library is empty; **never composes prose over a gap**. A zero-`[GAP]` run is a defect until proven otherwise |
| `clause-library-diff` | Checker | Any redline; any fresh-written section | Reports what diverged from the reviewed clause and which rung it landed on |
| `redline-log` | Recorder | Every counterparty markup | Concession recorded or the agreement is not executable |
| `annex-obligation-map` | Checker | Any DPA/BAA entering counsel review | Each Annex commitment must map to a **named, existing** test — not a planned one. Co-owned with [[regulatory-posture-charter]] |
| `live-version-map` | Checker | Quarterly | Which library version governs which live counterparty |

### The one design decision worth stating plainly

`legal-doc-draft` is the most obviously useful skill in this entire org — a legal drafting
agent in an AI-native company is the demo that writes itself — and it is the single most
dangerous one, for exactly the reason it is attractive: **fluent, correct-looking output is
what a language model produces most reliably, and fluent-but-wrong is the failure mode that
legal paper punishes hardest.**

So the skill is deliberately built at the *less* impressive shape. Retrieval, not
generation. `[GAP]` markers instead of graceful completion. A named human on every
execution. `nf_a.doneability_verdict` defined as *"a named human reviewed it"* rather than
*"the agent completed"*. The version of this skill that demos best is the version that
fails worst, and choosing the other one has to be a written decision rather than a
preference — because the pressure to improve the demo will be real and recurring
([[commercial-workforce-agreements-premortem]] M4).

Registry ownership sits with [[skills-charter]] (Applied AI), not here.
