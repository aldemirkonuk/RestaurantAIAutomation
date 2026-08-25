---
type: agenda-board
division: commercial
department: media-brand
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[media-brand-charter]]"
  - "[[media-brand-agenda-full]]"
---

# Media & Brand — Board

> **PROVISIONAL — no work done yet.**

## Every document in this department

```dataview
TABLE type, status, updated
FROM "01-org"
WHERE department = this.department
SORT team ASC, type ASC
```

## Team status roll-up

```dataview
TABLE WITHOUT ID
  team AS "Team",
  status AS "Evidence grade",
  updated AS "Last touched"
FROM "01-org"
WHERE department = this.department AND type = "charter" AND team
SORT team ASC
```

## Anything in this department stale for 60 days

```dataview
TABLE type, team, updated
FROM "01-org"
WHERE department = this.department AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops this department owns, by close-time

```dataview
TABLE team, status
FROM "01-org"
WHERE department = this.department AND type = "loops"
SORT team ASC
```

## Open

- [ ] M1 — confirm rename scope with founder (CM-F5, mobile install identity)
- [ ] M1 — write the two-pattern scan skill before editing any string
- [ ] M1 — tier-1 rename: 33 domain lines, name surface across web + mobile + email + iCal
- [ ] M1 — CI guard in `.github/workflows/ci.yml`
- [ ] M1 — voice guide, with its scope stated (published content, not internal docs)
- [ ] M1 — verify the 12-item reference shortlist; nothing adopted yet
- [ ] M2 — company story, structure first
- [ ] M2 — internal reference deck
- [ ] M2 — **BLOCKED:** ElevenLabs deck reference unreachable, founder must supply
- [ ] M4 — approval-register proposal to Compliance & Privacy
- [ ] M4 — **GATE:** no research until the register exists
- [ ] M3 — dormant. Watch item only: has an article cleared G3?

## Blocked / not ours

- CM-F5 workspace and deploy identifiers → Engineering
- Product analytics (M3's metric is unmeasurable without it) → Growth G5
- Consent legal basis → Compliance & Privacy
- YC path and the decision to apply → Strategy & Fundraising
