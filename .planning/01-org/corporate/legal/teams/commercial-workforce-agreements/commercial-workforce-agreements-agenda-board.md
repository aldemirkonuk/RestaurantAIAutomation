---
type: agenda-board
division: corporate
department: legal
team: commercial-workforce-agreements
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[commercial-workforce-agreements-charter]]", "[[commercial-workforce-agreements-agenda-full]]", "[[commercial-workforce-agreements-loops]]", "[[commercial-workforce-agreements-schedule]]", "[[commercial-workforce-agreements-premortem]]", "[[legal-agenda-board]]"]
---

# Commercial & Workforce Agreements — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/legal/teams/commercial-workforce-agreements"
SORT type ASC
```

## Where this team sits in the department

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/corporate/legal"
WHERE type = "charter"
SORT team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/corporate/legal/teams/commercial-workforce-agreements"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

Feeds [[legal-loops]] L-LEG-5 alongside the count of executed agreements. A date-only bump
is invisible here — the quarterly check reads `git log --stat` on this directory to catch
it, because that is [[legal-premortem]] M1's disguise.

## Loops missing a close-time

```dataview
LIST
FROM "01-org/corporate/legal/teams/commercial-workforce-agreements"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Anything here that drifted into clause language — [[legal-directive]] R7

```dataview
LIST
FROM "01-org/corporate/legal/teams/commercial-workforce-agreements"
WHERE file.name != this.file.name
  AND (contains(lower(file.content), "hereby")
    OR contains(lower(file.content), "whereas,")
    OR contains(lower(file.content), "the parties agree"))
```

Expected: **empty**. This is the team whose subject matter most invites drafted text into
its own charter, so the check matters most here. A hit is the cheapest possible early
sighting of [[commercial-workforce-agreements-premortem]] M4 — caught in our directory
rather than at a counterparty.

The `file.name != this.file.name` clause matters: without it the query matches itself,
since naming the trigger words is how you search for them. A detector that is permanently
red is a detector nobody reads.

## The nine instruments — hand-maintained until one exists

| Instrument | Library sections | Ladder rungs set | Executed |
|---|---|---|---|
| NDA | — | — | 0 |
| MSA | — | — | 0 |
| Statement of work | — | — | 0 |
| Professional services agreement | — | — | 0 |
| Letter of intent | — | — | 0 |
| Employment agreement | — | — | 0 |
| Contractor agreement | — | — | 0 |
| Data processing agreement | — | — | 0 |
| Business associate agreement | — | — | 0 |

Nine rows, all empty (`corporate.md:104-106`). Kept as a table so the first row to change is
visible against eight that did not.

## The metric pair — read together, never separately

- [ ] `legal.clause_library_hit_rate` — **0%.** Leading indicator
- [ ] `legal.request_to_executable_draft_days` — **unmeasurable.** Lagging indicator
- [ ] **Alarm condition:** turnaround improving while hit rate does not → drafts are being
      *generated*, not assembled ([[commercial-workforce-agreements-premortem]] M4).
      Escalates as a metric finding, before any incident exists

## Standing counters

- [ ] `legal.annex_satisfiability_signoff` — **0 of 0.** Gate not wired
- [ ] `legal.named_reviewer_coverage` — **0 of 0.** Target 100%; "AI" is not a name
- [ ] `legal.concessions_unlogged` — target permanently **0**
- [ ] `legal.gap_marker_rate` — **n/a.** A zero rate would be a defect, not excellence
- [ ] `nf_a.doneability_verdict` — **n/a.** `.claude/skills/` does not exist

## Open items

- [ ] Definition of **"executable"** — must be fixed before the first measurement
- [ ] Two-signature gate — **not wired.** First firing is expected to **fail** (erasure
      untested end-to-end, `corporate.md:31`) and that failure is the baseline
- [ ] Clause-library skeleton — **not started**
- [ ] Fallback-ladder structure — **not started**; rungs are the founder's to set
- [ ] Redline log contents — **undefined**
- [ ] `legal-doc-draft` — **deliberately deferred this cycle.** Recorded as a decision, not
      an omission ([[commercial-workforce-agreements-agenda-full]])
- [ ] Route `apps/web/src/pages/Privacy.tsx:23` stale brand to Compliance §3.2 — not ours
      to fix, ours to hand over

## Triggers being watched

- [ ] **Workforce Paper split** — first W-2 hire, or first contractor in a second
      jurisdiction (`corporate.md:126`)
- [ ] **Department merge** — [[legal-loops]] L-LEG-5, second quarterly review
- [ ] **CORP-F2** — DPA/BAA instrument vs obligation; staged, not yet in `OPEN-DECISIONS.md`
