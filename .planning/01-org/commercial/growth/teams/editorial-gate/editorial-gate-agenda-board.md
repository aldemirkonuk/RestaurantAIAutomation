---
type: agenda-board
division: commercial
department: growth
team: editorial-gate
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[editorial-gate-charter]]", "[[editorial-gate-agenda-full]]", "[[editorial-gate-loops]]", "[[editorial-gate-schedule]]", "[[growth-agenda-board]]"]
---

# Editorial Gate — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/growth/teams/editorial-gate"
SORT type ASC
```

## Where this team sits in Growth

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/commercial/growth"
WHERE type = "charter"
SORT default(team, "") ASC
```

## Stale — untouched in 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/commercial/growth/teams/editorial-gate"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

- [ ] `editorial.claims_traceable_pct` — **n/a**: nothing published, provenance format unwritten. Target **100%**
- [ ] `editorial.gate_bypass_count` — **0**. Absolute. Also carried on [[growth-agenda-board]],
      one level above whoever could suspend the gate
- [ ] `editorial.rejection_rate` — **n/a**. Read in both directions: 0% for two close-times
      means the gate is not reading
- [ ] `editorial.overstated_claim_catches` — **0**, trivially. A quarter with publications and
      zero catches needs the verdicts read, not celebrated

## The claim this gate exists for

- [ ] **"Dollars recovered" means *we asked*, not *we received*** ([[YC_WEDGE_PLAN]]:31-33).
      Publishable only where an 812 credit memo has been observed against a later invoice,
      sourced through [[design-partner-operations-charter]]
- [ ] Honest alternatives that are still strong claims: *dollars identified*, *credit requested*
- [ ] Canary word: **"restaurants"**, plural. There is one design partner, and its Toast
      credentials are still unconfigured

## The four founding artifacts — none blocked on anything

- [ ] Provenance format — what a source is, and what a claim with no source does (removed, not softened)
- [ ] Banned-construction list — a reason per entry. "Streamlined" is entry one; em dashes entry two;
      press-release register needs worked examples, not a definition
- [ ] Verdict artifact — one file per unit, one field per check, committed
- [ ] Claim-strength rule, agreed with [[design-partner-operations-charter]] before there is a
      number to argue over

## Blocking

- [ ] **No voice guide** — [[brand-identity-charter]] owns it. Until it exists, check 4 records
      **"no guide"** rather than passing
- [ ] **Verdict artifact location undecided** — coupled to the content-repository question
- [ ] **Nothing to gate** — no draft, no publishing target

## Standing rules

- [ ] Checks run in order. Claims first, always. A return stops at the first failed check
- [ ] **The gate returns; it never rewrites.** A co-author cannot judge
- [ ] *Return* = the prose is wrong. *Reject* = the claim is wrong. Not a severity scale
- [ ] No throughput target. A gate with a throughput target is a queue
- [ ] No exemption by content category, including "these are just FAQ answers"
- [ ] The banned-construction list governs **published content only** — not this vault, not
      code comments, not commit messages
