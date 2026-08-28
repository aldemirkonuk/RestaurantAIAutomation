---
type: agenda-board
division: advisory
department: red-team
status: active
metrics: [rt.finding_return_hours, rt.locked_decision_challenge_rate, rt.reaffirmation_rate, rt.finding_actionability, rt.open_finding_age_days, rt.undeclared_decision_count, rt.self_selected_target_share]
updated: 2026-08-28
links: ["[[red-team-charter]]", "[[red-team-premortem]]", "[[red-team-directive]]", "[[red-team-loops]]", "[[red-team-schedule]]", "[[red-team-agent-stack]]", "[[red-team-questions]]", "[[red-team-agenda-full]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[security-charter]]", "[[knowledge-documentation-charter]]", "[[exploration-studio-charter]]", "[[compliance-privacy-charter]]", "[[0039-activation-plan-of-record]]", "[[0037-nfb-erasure-is-crypto-shredding]]"]
---

# Red Team — Board

Live view of [[red-team-agenda-full]] (dated 2026-08-28). Tasks live there; this page holds
the queries and the counters.

> **Dataview executes inside Obsidian only.** `.planning/.obsidian/plugins/dataview` is
> committed, but nothing materialises these fences to text — an agent reading this file by
> `grep` sees empty blocks. Every counter below therefore states **where its value came
> from**, and any number without a source is a failed publication.

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

- [ ] **39 ADR files · 29 Locked · 0 attacked** — `rt.locked_decision_challenge_rate` = **0 of 29** *(counted in `.planning/decisions/`, 2026-08-28)*
- [ ] **Seven are inside the O1 7-day window right now**: 0036, 0037, 0038, 0039 (locked 2026-08-28) and 0032, 0033, 0035 (2026-08-27). The window does not recur
- [ ] **39 open rows** in `OPEN-DECISIONS.md`; IDs now run past OD-110 *(counted in the §Open table, 2026-08-28)*
- [ ] The other 22 Locked ADRs are past their window — the first sweep is a **backlog sweep** and is published as two numbers, never one percentage (**RT-3**)

## Cycle 1 — the cap is spent, and that is the point

Seven open findings is the ceiling ([[red-team-charter]] §The attack budget). This is the
first cycle in which it binds.

- [ ] **RT-1** ADR 0039 — the plan of record that commissioned this page · O1 + O3 · close **2026-09-04**
- [ ] **RT-2** ADR 0037 — NF-B erasure is crypto-shredding; founding target T1, arrived as a decision · O1 + O3 · close **2026-09-04**
- [ ] **F-W1** the 60-day rule fires as two mass events → [[decision-office-charter]] · **2026-09-04**
- [ ] **F-W2** dated-trigger noise; the real 2026-11-24 signal is being drowned → [[decision-office-charter]] · **2026-09-04**
- [ ] **F-W5** 30 of 73 sketch dirs unindexed, **10 of them from before this wave** → [[exploration-studio-charter]] · **2026-09-04**
- [ ] **F-W4** ethics scope is not ours → [[compliance-privacy-charter]] · **2026-09-04**
- [ ] **O2 reserved · RT-6** OD-04, oldest open fork never attacked · **2026-09-25**
- [ ] **Deferred by the cap, not forgotten:** F-W6 (citation re-anchoring) and both dated wave-3 referrals — `security-agenda-full.md:201`, `skills-agenda-full.md:163`. To open an eighth, close one

## RT-0 · the wave-3 premortem — six mechanisms, graded

| # | Mechanism | Grade | The number |
|---|---|---|---|
| **W1** | The staleness rule fires as a mass event, twice | **LIVE** | 200 agenda files: **154** at 2026-08-24, **46** at 2026-08-28. Cliffs 2026-10-23 and 2026-10-27 |
| **W2** | The watcher goes deaf on dated triggers | **LIVE** | Horizon events **0 → 6**, **18** unit-slots, all false. Counterfactual scan, 2026-08-28 |
| **W3** | Ambition outruns evidence | **LATENT** | **4%** of 379 task rows carry no evidence token; 63% carry no strict `file:line`. The first number is the honest one |
| **W4** | The referral queue eats the function | **LIVE** | C3: **82 → 436** lines, **67 → 99** units. Findings filed: still **0** |
| **W5** | Canvases nobody can reach | **LIVE** | **73** sketch dirs, **43** manifest rows, **30** gaps — **10 predate this wave** |
| **W6** | The wave re-anchors line citations into itself | **LIVE** | **11** line-anchored citations from 9 files point into documents rewritten today |

- [ ] Rejected seeds are listed in [[red-team-agenda-full]] §Seeds examined and rejected, **with the reason** — including one measurement discarded because the script was wrong

## Self-emission check — this directory's contribution to the watcher

The counter-pressure this function actually controls: a future date and a
`merge|retire|collapse|fold` word never share a line here **unless the date is a genuine
existence rule**.

```dataview
LIST
FROM "02-advisory/red-team"
WHERE type = "agenda-full" OR type = "agenda-board"
```

- [ ] Expected contribution: **exactly one** dated-trigger line, the 2026-11-24 row in [[red-team-agenda-full]] Track 4 — Red Team's own existence rule, which *should* fire
- [ ] Verified 2026-08-28: `watch_loops.py --asof 2026-08-28` names this directory **zero** times inside the 30-day horizon
- [ ] Any second line is a self-inflicted false positive and is fixed before the finding about everyone else's ships

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
- [ ] Code `path:line` as **evidence** is fine — RT-2 cites a migration line. Code as the **subject** of a target is the defect
- [ ] `file.name != this.file.name` excludes this file — listing the trigger words is how you search for them

## Units that referred a finding to us

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

- [ ] **436 referral lines across 99 unit directories**, 0 answered *(corpus scan, 2026-08-28; the charter's baseline was 82 / 67)*
- [ ] `rt.self_selected_target_share` — cycle 1 is **5 self-selected of 7**. Below 60% is [[red-team-premortem]] M4
- [ ] Two wave-3 referrals arrived **with dates attached**. Referrals get no privileged lane ([[red-team-directive]] R2) — neither is in cycle 1

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

- [ ] Cannot see a **date-only** bump. The quarterly sweep reads `git log --stat` and counts a content-free diff as untouched
- [ ] This directory's own cliff is **2026-10-27**. If nothing here changes by then, RT-0 was decoration, and the charter's exit condition is the standing consequence — [[red-team-agenda-full]] §What this premortem cannot prevent
- [ ] *(That line is written without the word the trigger regex reads. Keeping it out took one edit and a re-run — which is the entire cost of the counter-pressure F-W2 asks of everyone else.)*

## Standing counters — sources named, no jobs exist

- [ ] `rt.locked_decision_challenge_rate` — **0 of 29** · source: file count in `.planning/decisions/`
- [ ] `rt.finding_return_hours` — **no instrument.** `finding-return-clock` is ineligible under §3.3 until a finding exists. The delivery target now does exist: **100** `questions.md` files
- [ ] `rt.finding_actionability` — **n/a.** Target 100%, no acceptable second number ([[red-team-directive]] R4)
- [ ] `rt.reaffirmation_rate` — **n/a.** Target is *neither tail*; 100% is [[red-team-premortem]] M2. Reported only beside actionability
- [ ] `rt.open_finding_age_days` — **n/a.** The founding instance closed: OD-20 is Resolved and the controller is guarded. The failure class did not close — see W1
- [ ] `rt.undeclared_decision_count` — **unswept.** RT-9 gives it a first real value; `FORK-REGISTRY.md` may already have closed the `OD-Cx` class or merely renamed it
- [ ] `nf_a.doneability_verdict` — **PARTIAL, a dependency and not a reading** ([[red-team-agent-stack]] §6)

## Gates that must exist before the thing they gate arrives

- [ ] A finding register with an open count, so the 7-cap is enforced rather than remembered — it binds **this cycle**
- [ ] L-RT-6's 30-day conversion wired to [[decision-office-charter]] — before finding #1 ages
- [ ] `decision.locked` has **no publisher** ([[red-team-agent-stack]] §5): nothing emits when an ADR reaches Locked, and O1's window is the tightest clock in advisory. Seven windows are open today and were noticed by hand
- [ ] The 2026-11-24 criteria defined **before** the date, by someone who does not know the answer — **RT-11**

## Cycle discipline

- [ ] 3 of 7 slots reserved before any referral is read — O1 newest lock · O2 oldest fork · O3 founder-locked
- [ ] A cycle with **zero** founder-locked targets is a filed finding **against Red Team** ([[red-team-directive]] R8). Cycle 1 has two
- [ ] Findings-only. Nothing on this page blocks anything, and nothing here schedules another unit's work ([[0007-org-structure]], OD-16)
