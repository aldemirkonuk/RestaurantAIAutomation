---
type: agenda-board
division: platform
department: engineering
team: catalogue-identity
status: provisional
metrics: [identity.false_merge_count, identity.false_split_count]
updated: 2026-08-24
links: ["[[catalogue-identity-charter]]", "[[catalogue-identity-agenda-full]]", "[[catalogue-identity-loops]]", "[[engineering-agenda-board]]"]
---

# Catalogue & Identity — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/platform/engineering"
WHERE team = this.team
SORT type ASC
```

## Sibling teams — same department, same board

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Evidence
FROM "01-org/platform/engineering"
WHERE type = "charter" AND team AND team != this.team
SORT team ASC
```

## Stale here (60-day rule)

```dataview
LIST rows.file.link
FROM "01-org/platform/engineering"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
GROUP BY type
```

## Counters

- [ ] `identity.false_merge_count` — **unreadable**: no labelled set exists
- [ ] `identity.false_split_count` — **unreadable**: same blocker
- [ ] Never reported as one number. Two columns or nothing.
- [ ] Producer collapse ratio — not instrumented
- [ ] Un-merges this period — 0 reviewed, report format not written
- [ ] Dish identity — **deferred by design**, design doc warm

## Open

- [ ] Labelled identity set — scope, size, adjudicator
- [ ] `eval_merge_policies` promoted from script to CI gate
- [ ] Outcome-side twin for `check_no_guest_name_matching.sh`
