---
type: agenda
title: Agenda
status: live
updated: 2026-08-24
links: ["[[PLAN]]", "[[HOME]]", "[[OPEN-DECISIONS]]"]
---

# Agenda — what is happening now

> **Live.** Updated every session per CLAUDE.md §7. If this file is stale, the session
> that left it stale did not finish. Companion: [[PLAN]] — what gates what.

## 🔴 Waiting on the founder

Nothing below can move without a decision or an action only Aldemir can take.

| # | Item | Why it is blocked on you | Cost of waiting |
|---|---|---|---|
| OD-49 | Add repo secret `SUPABASE_POOLER_CONNECTION_STRING` | Claude cannot set secrets, and will not handle the credential | The drift guard is **off**; schema parity has never compared anything |
| PR [#33](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/33) | Review + merge the CI connectivity fix | Merge is yours | Failure stays a traceback instead of an instruction |
| OD-23 | Revenue target + pricing | Price is unrecorded in any ADR; the source doc is not in this repo; `PROJECT.md:135` contradicts a revenue sprint | All of Commercial stays provisional |
| OD-05 | Voice-agent audience (guest / staff / owner) | One sentence unblocks scoping | Cannot be scoped at all |
| OD-07 | Beli — build independently or partner | Strategic | Guest-app work cannot be classified |
| OD-01 | `.planning/` clean-slate restructure | Target shape is yours; end goal already agreed | Navigation tax every session |

## 🟡 In flight

| Item | State |
|---|---|
| Branch `docs/foundation-memory-instructions-decisions` | Open — the whole corporate structure + scenarios. Not yet PR'd |
| PR #33 — CI connectivity | Open, awaiting review |
| PRs #31, #32 — security | ✅ **Merged.** All five holes verified closed on `main` |

## 🟢 Next actions (no approval needed)

1. **P1 instrumentation** ([[PLAN]] §1) — add `agent`/`task_type` to `SpendLogger`, join
   `api_spend` ↔ `decision_log`, emit from the 7 gateway call sites. Unblocks the most.
2. **OD-30/OD-42** — reconcile fork numbering. 7 namespaces; 30% of docs cite an
   ambiguous ID. Decision Office's first assignment, mechanical.
3. **OD-32** — 171 documents write an unresolvable `[[README]]` across 45 same-named files.
4. **OD-47** — normalise 102 `close_time` values to a closed vocabulary.
5. **OD-33** — pin the insight count in a test. Four values circulate (348/375/573/`>=200`);
   the shipped UI says 375, the measured truth is **573**, and the only assertion is `>= 200`
   so all of them pass.

## 📌 Standing watch — nobody is watching these yet

| Date | What fires | Watcher |
|---|---|---|
| **2026-10-23** | All 194 agendas hit the 60-day staleness rule **together** — they share one `updated` date | ❌ none |
| **2026-11-24** | Four dated retirement/merge triggers land at once (Skills, Sales, Legal, advisory) | ❌ none |

Both are Decision Office loops on paper. Neither runs. This is [[PLAN]] §0's point in miniature.

## Live queries

```dataview
TABLE open_questions AS "Open", updated
FROM "01-org" OR "02-advisory"
WHERE type = "questions" AND open_questions > 0
SORT open_questions DESC
```

Units whose agenda has gone stale (fires from 2026-10-23):

```dataview
TABLE updated, status
FROM "01-org" OR "02-advisory"
WHERE type = "agenda-full" AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```
