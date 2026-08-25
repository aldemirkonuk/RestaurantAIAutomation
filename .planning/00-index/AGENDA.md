---
type: agenda
title: Agenda
status: live
updated: 2026-08-25
links: ["[[PLAN]]", "[[HOME]]", "[[OPEN-DECISIONS]]"]
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

**Current milestone: P2 — Web complete + deploy** ([ADR 0018](../decisions/0018-p2-plan-of-record.md)).
Stage table: [STATE.md](../STATE.md).

## 🔴 Waiting on the founder

Canonical list: the 🔴 rows of [[OPEN-DECISIONS]]. Headlines only:

| Item | One line |
|---|---|
| **Page retirements** | [ADR 0019](../decisions/0019-p2-build-scope.md) §B: retire `/calendar-classic`, `/inventory-legacy`, `/wine-agent`, `/wineagent-alias`? Deletion is irreversible and each needs a parity check, so it waits for your yes. `/inventory-legacy` also hosts a modal posting to a nonexistent endpoint (44.1e) |
| **Gmail push enforcement** | Verification is built but staged OPEN so the deploy could not kill live inbound email. Set `GMAIL_PUBSUB_AUDIENCE` + `GMAIL_PUBSUB_SERVICE_ACCOUNT` on Railway (values come from the Pub/Sub subscription), then `GMAIL_PUBSUB_REQUIRE_AUTH=true` |
| **OD-73** | 12 tables with RLS **off** and full `anon` DML — including the procurement invoice store and `user_oauth_accounts`; filed 2026-08-25 at your instruction, awaiting the call |
| OD-72 | The other 142 RLS-on-zero-policy tables — policies, gateway, or RLS off |
| OD-64/66/67 | Toast-side defect cluster (mirrored voids, second depletion path) |
| OD-23 / OD-05 / OD-07 / OD-01 | Pricing · voice-agent audience · Beli · `.planning` restructure — unchanged |

## 🟡 In flight

| Item | State |
|---|---|
| Nothing | P2 closed through deploy 2026-08-25 |
| Main | PRs #52–#67 merged 2026-08-25. Production verified after each: guarded routes 401, `nf_verdict` live with RLS, Toast reads closed, nine public test routes closed, web bundle free of dead-route literals |

## 🟢 Next actions (no approval needed)

1. **OD-75** — move ~10 Python `outcome="success"` emits below the `json.loads` that can fail; stamp `parse_v1`. Bug fix and doneability-basis upgrade in one.
2. **`DocumentsPage` `?doc=` deep link** — the copy-link button builds a param the page never reads, so a shared link silently loses its target.
3. **Per-item inventory ledger view** — `inventory-ledger.controller.ts:210` serves the data and nothing renders it; this is why "View ledger" had to drop its param.
3. Mechanical register items (OD-30/32/33 cluster) — **verify each against the register before starting**; the 08-25 audit found half-closed entries are the norm, not the exception.

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
