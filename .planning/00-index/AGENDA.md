---
type: agenda
title: Agenda
status: live
updated: 2026-08-26
links: ["[[PLAN]]", "[[HOME]]", "[[OPEN-DECISIONS]]", "[[0029-p3-plan-of-record]]"]
---

# Agenda — what is happening now

> **Live.** Updated every session per CLAUDE.md §7. If this file is stale, the session
> that left it stale did not finish. Companion: [[PLAN]] — what gates what.
>
> **Design change 2026-08-25:** this file no longer copies register rows. The 08-24
> version listed OD-54 as blocking a day after it was resolved (and OD-56 as a
> dependency-merge task when it had been re-scoped: Python half fixed, Node half
> still open) — prose that duplicates [[OPEN-DECISIONS]] rots against it, so now
> it points instead.

**Current milestone: P3 — Grade, then scale** ([ADR 0029](../decisions/0029-p3-plan-of-record.md)).
Stage table: [STATE.md](../STATE.md). **P2 closed 2026-08-26** — five stages deployed
and verified, both held items resolved.

**The shape, in one line:** one gate (P3.0 doneability coverage), two lanes that run
alongside it because they depend on nothing it produces (P3.A mobile, P3.B kitchen
expansion), two stages behind it (P3.C Ask AI, P3.D model registry), and one candidate
**held** rather than queued (NF-B guests — blocked on OD-05/OD-07, a decision, not work).

## 🔴 Waiting on the founder

Canonical list: the 🔴 rows of [[OPEN-DECISIONS]]. Headlines only:

| Item | One line |
|---|---|
| ~~**Page retirements**~~ | ✅ **Closed 2026-08-26** — all four retired, each after a parity port ([ADR 0019](../decisions/0019-p2-build-scope.md) §B, [[RETIRED]]) |
| ~~**Gmail push enforcement**~~ | ✅ **Closed 2026-08-26** — enforcement is ON in production; OD-78's premise was wrong (the entry, not the config) |
| **OD-05 / OD-07** | Voice-agent audience · Beli build-vs-partner. **These two now block a built asset:** the 564-line guest slice has zero callers because they are unanswered ([ADR 0029](../decisions/0029-p3-plan-of-record.md) §3) |
| OD-73 | 12 tables with RLS off and full `anon` DML — **being worked by another session** (PR #119) |
| OD-72 | The other 142 RLS-on-zero-policy tables — policies, gateway, or RLS off |
| OD-64/66/67 · OD-68 | Toast-side defect cluster · `provider_important_dates` absent from production. Carried alongside P3, not behind it |
| OD-23 / OD-01 / OD-106 | Pricing · `.planning` restructure · design foundation (deferred by you 2026-08-26; P4 candidate) |

## 🟡 In flight

| Item | State |
|---|---|
| **P3.0 · P3.A · P3.B** | Open and startable. P3.A and P3.B may run at the same time as P3.0 — they share no files and no decisions |
| Main | PRs #68–#118 merged 2026-08-26. Latest: #118 rescued the §1a Features layer (47/47 page notes) and re-scoped ADR-0018's Surface claim, which had been selecting page notes by filename |
| Other sessions | #119 OD-73 RLS relock · #113 prose corrections · #86 studio.md self-contradiction (**stale** — needs a rebase past #118) |

## 🟢 Next actions (no approval needed)

1. **P3.0** — start at `04-specs/OD-59-VERDICT-CENSUS.md` §4 rows 2–9: synchronous,
   Trivial/Low, and the graders are **already running** — the results simply never
   reach the footprint. Two task types are already graded better than they are
   stamped; correcting the string costs nothing.
2. **P3.A / P3.B** — either may start immediately, in parallel with each other and
   with P3.0.
3. **`DocumentsPage` `?doc=` deep link** — the copy-link button builds a param the
   page never reads, so a shared link silently loses its target.
4. **Per-item inventory ledger view** — `inventory-ledger.controller.ts:210` serves
   the data and nothing renders it; this is why "View ledger" had to drop its param.
5. Mechanical register items (OD-30/32/33 cluster) — **verify each against the
   register before starting**; half-closed entries are the norm, not the exception.

**Not startable, and that is deliberate:** P3.C (Ask AI) and P3.D (model registry)
are behind the P3.0 gate. Scaffolding them "to get ahead" is the specific failure
[ADR 0029](../decisions/0029-p3-plan-of-record.md) §6.3 names.

## 📌 Standing watch

| Date | What fires | Watcher |
|---|---|---|
| **2026-10-23** | All **198** agendas hit the 60-day staleness rule together — they share one `updated` date | ✅ `watch_loops.py` (weekly, `.github/workflows/loop-watcher.yml`) |
| **2026-11-24** | **7 units** must judge whether they should still exist | ✅ `watch_loops.py` |

## Live queries

```dataview
TABLE open_questions AS "Open", updated
FROM "01-org" OR "02-advisory"
WHERE type = "questions" AND open_questions > 0
SORT open_questions DESC
```
