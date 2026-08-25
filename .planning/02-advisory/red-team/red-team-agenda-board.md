---
type: agenda-board
division: advisory
department: red-team
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[red-team-charter]]", "[[red-team-premortem]]", "[[red-team-directive]]", "[[red-team-loops]]", "[[red-team-schedule]]", "[[red-team-agenda-full]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[security-charter]]"]
---

# Red Team — Board

> **PROVISIONAL — no work done yet.**

## Every Red Team artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "02-advisory/red-team"
SORT type ASC
```

## The attack surface — every decision on disk

```dataview
LIST
FROM "decisions"
WHERE file.name != "README" AND file.name != "TEMPLATE"
SORT file.name ASC
```

- [ ] 7 ADRs · **0 attacked** · `rt.locked_decision_challenge_rate` = **0 of 7**
- [ ] 23 open forks in `OPEN-DECISIONS.md` · **0 attacked**
- [ ] All 7 ADRs locked 2026-08-24 — all outside the L-RT-1 7-day window. First run is a **backlog sweep**, not a clean 100%

## Units that referred a finding to us — 82 lines, 67 units, 0 answered

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  division AS Division,
  type AS Artifact
FROM "01-org"
WHERE contains(file.content, "red-team-charter")
  AND (type = "premortem" OR type = "directive")
SORT division ASC, file.name ASC
```

- [ ] `rt.self_selected_target_share` = **0%** — every known target is inbound. Below 60% is [[red-team-premortem]] M4

## Advisory peers — is anyone reviewing the reviewers?

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  department AS Function,
  type AS Type,
  status AS Status
FROM "02-advisory"
WHERE type = "charter" OR type = "premortem"
SORT department ASC
```

- [ ] [[red-team-directive]] E5 — findings against advisory go straight to the founder. Self-review is not review

## Scope-drift detector — expect EMPTY

```dataview
LIST
FROM "02-advisory/red-team"
WHERE file.name != this.file.name
  AND (contains(lower(file.content), "threat model")
    OR contains(lower(file.content), "cve-")
    OR contains(lower(file.content), "run a scan"))
```

- [ ] A hit = [[red-team-premortem]] M5. Red Team attacks **reasoning**; [[security-charter]] attacks **systems**
- [ ] Code `path:line` as **evidence** is fine. Code as the **subject** of a target is the defect
- [ ] `file.name != this.file.name` excludes this file — listing the trigger words is how you search for them

## Loops without a close-time — expect EMPTY

```dataview
LIST
FROM "02-advisory/red-team"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Stale — 60 days untouched is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "02-advisory/red-team"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

- [ ] Cannot see a **date-only** bump. Quarterly sweep reads `git log --stat` on this directory and counts a content-free diff as untouched

## Standing counters — hand-entered, no jobs exist

- [ ] `rt.finding_return_hours` — **unmeasurable.** 0 findings; no `questions.md` exists anywhere in the corpus
- [ ] `rt.locked_decision_challenge_rate` — **0 of 7**
- [ ] `rt.reaffirmation_rate` — **n/a.** Target is *neither tail*; 100% is [[red-team-premortem]] M2
- [ ] `rt.finding_actionability` — **n/a.** Target 100%, no acceptable second number
- [ ] `rt.open_finding_age_days` — **n/a** for us; **1 known instance** of the failure (OD-20 → PR #31, open and unmerged)
- [ ] `rt.undeclared_decision_count` — **≥9 known**, never swept
- [ ] `rt.self_selected_target_share` — **0%**

## The seven targets — [[red-team-agenda-full]]

- [ ] **T1** ADR 0006 — append-only research store vs NF-B erasure · *not in the register* → **RT-F1**
- [ ] **T2** OD-23 — $20k/30d, rated <10% by its own author · attack the *derivation*
- [ ] **T3** ADR 0007 — 693 docs; the decision is currently **unfalsifiable** · O3 mandatory slot → **RT-F2**
- [ ] **T4** OD-26 — split triggers **15** vs merge **3**; was 11 vs 3 hours earlier → **RT-F3**
- [ ] **T5** OD-24 — 28 docs, **0** committed skills (`git ls-files` → no `SKILL.md`)
- [ ] **T6** `decisions/README.md` says *"8 items"* (**23**) and *"5 divisions, 20 departments"* (**6 / 19**) → **RT-F4**
- [ ] **T7** `OD-C1`–`OD-C8` staged in Corporate docs, **none** in the register; `OD-C5` cited 38× → **RT-F5**

## Forks staged here — NOT OD IDs ([[red-team-directive]] R7)

- [ ] **RT-F1** NF-B erasability vs append-only research store — pair with OD-11
- [ ] **RT-F2** One number that makes ADR 0007 falsifiable
- [ ] **RT-F3** Symmetric split/merge trigger rule
- [ ] **RT-F4** Generate `decisions/README.md` instead of maintaining it
- [ ] **RT-F5** Non-OD prefix + `§Forks to register` for locally staged forks
- [ ] **RT-F6** Is the 7-finding cap right? — first self-attack

## Gates that must exist before the thing they gate arrives

- [ ] First `questions.md` in the corpus — created by the first finding, not before
- [ ] Finding register with an open-count, so the 7-cap is enforceable rather than remembered
- [ ] L-RT-6 30-day conversion wired to [[decision-office-charter]] — before finding #1 ages
- [ ] Merge condition evaluated at the **second** quarterly L-RT-5 run

## Cycle discipline

- [ ] 3 of 7 slots reserved before any referral is read — O1 newest lock · O2 oldest fork · O3 founder-locked
- [ ] A cycle with **zero** founder-locked targets is a filed finding **against Red Team** ([[red-team-directive]] R8)
- [ ] Findings-only. Nothing here blocks anything ([[0007-org-structure]], OD-16)
