---
type: agenda-board
division: corporate
department: legal
team: instruments-equity
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[instruments-equity-charter]]", "[[instruments-equity-agenda-full]]", "[[instruments-equity-loops]]", "[[instruments-equity-schedule]]", "[[instruments-equity-premortem]]", "[[legal-agenda-board]]"]
---

# Instruments & Equity — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/legal/teams/instruments-equity"
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

## Stale — the activation signal, not just a hygiene check

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/corporate/legal/teams/instruments-equity"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

For most teams this query is hygiene. For this one it is **the merge signal**: a team that
is armed rather than running goes stale as its normal state, and L-IE-5 reads exactly this
alongside the count of instruments issued. Note the query cannot see a **date-only** bump —
[[instruments-equity-schedule]]'s quarterly activation check reads `git log --stat` on this
directory to catch that.

## Loops missing a close-time

```dataview
LIST
FROM "01-org/corporate/legal/teams/instruments-equity"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## The six instruments — register, hand-maintained until one exists

| Instrument | State | Chain complete? | Counsel reviewed? |
|---|---|---|---|
| Founder agreement | — none — | n/a | n/a |
| IP assignment | — none — | n/a | n/a |
| SAFE | — none — | n/a | n/a |
| Board consent | — none — | n/a | n/a |
| Stock purchase agreement | — none — | n/a | n/a |
| Advisor agreement | — none — | n/a | n/a |

**Six rows, six dashes. That is the accurate picture** (`corporate.md:75-79`), and it is
kept as a table rather than a sentence so that the first row to change is visible against
five that did not.

## Standing counters

- [ ] `legal.instrument_chain_integrity` — **0 of 0.** Only 100% passes; 0 of 0 is unread, not good
- [ ] `legal.counsel_gate_compliance` — **0 of 0.** No counsel engaged
- [ ] `legal.consent_record_completeness` — **0 of 0.** Defined on **ordering**, not presence
- [ ] `legal.cap_table_tie_out_divergence` — **no cap table exists**
- [ ] `legal.days_from_engagement_to_request` — target **0**; unmeasured

## Open items

- [ ] **M2 — no IP-assignment row.** The one premortem signal that is visible *today* and
      has no loop watching it, because it is a single absent row rather than a recurring
      measurement. It stays on this board until it closes once
- [ ] Waiting period for IE-1 — **not yet a number**
- [ ] Counsel — **not engaged**
- [ ] Register states — **not defined**
- [ ] "Consequence model" contents per instrument type — **undefined**, so IE-2 is currently
      unenforceable
- [ ] Commitment list (L-IE-4 first run) — **never run**
- [ ] Executed-original retention location — **undefined**

## Gates that must exist before the thing they gate arrives

- [ ] Counsel engaged — before the first one-way-door instrument
- [ ] IE-1 waiting period — before the first request, not before the first *urgent* request
- [ ] Consent-ordering refusal in the register — before the first board action
- [ ] Cap table as a derived artifact — before the first equity instrument, so the paper is
      the source from row one
