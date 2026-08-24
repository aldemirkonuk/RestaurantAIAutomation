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
| **OD-54** | 🔴 **SSRF** — `vendor-page-extractor.service.ts:142` fetches a user-controlled URL server-side (CodeQL critical). Pre-existing on main, not introduced by P1. | Needs an egress allowlist decision | Gateway can be pointed at internal addresses |
| **OD-56** | **22 Dependabot PRs open**, 9 CVEs flagged (node-tar, PostCSS, js-yaml, image-size) | Merging dependency bumps is yours | Known-vulnerable deps before customer data |
| OD-23 | Revenue target + pricing — the tier ceilings ($5 credit / $5 / $10) are placeholders I chose | No ADR records a price | Commercial stays provisional |
| OD-23 | Revenue target + pricing | Price is unrecorded in any ADR; the source doc is not in this repo; `PROJECT.md:135` contradicts a revenue sprint | All of Commercial stays provisional |
| OD-05 | Voice-agent audience (guest / staff / owner) | One sentence unblocks scoping | Cannot be scoped at all |
| OD-07 | Beli — build independently or partner | Strategic | Guest-app work cannot be classified |
| **OD-11** | **Pick a path in [P1 spec §4](../04-specs/P1-NF-A-INSTRUMENTATION.md)** — A (recommended), B, or C | The column contract is a schema decision, and P1 cannot start without it | **P1 is the bottleneck for 476 of 482 loops** |
| OD-01 | `.planning/` clean-slate restructure | Target shape is yours; end goal already agreed | Navigation tax every session |

## 🟡 In flight

| Item | State |
|---|---|
| PR #35 — P1 instrumentation + docs corpus | ✅ **Merged** 2026-08-24 |
| PR #33 — CI connectivity | ✅ **Merged** |
| PRs #31, #32 — security | ✅ **Merged.** All five holes verified closed on `main` |
| Everything is on `main` | 848 corpus docs · migration applied · guard green |

## 🟢 Next actions (no approval needed)

0. **First traffic** — everything emits; `nf_a.cost_per_completed_task` needs one real model call to produce its first number. That is the P1 done-gate.
0b. **Rebrand planning** — assigned to Media & Brand `brand-identity` (founder 2026-08-24):
   write the full plan (name map, mobile-slug install hazard, email/OAuth/domain sequencing)
   against the measured 336-line / 178-file surface. **Execution holds** until brand direction exists.


1. ~~P1 instrumentation~~ — **spec written** ([[P1-NF-A-INSTRUMENTATION]]). Now blocked on OD-11 above.
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
| **2026-10-23** | All **198** agendas hit the 60-day staleness rule **together** — they share one `updated` date | ✅ `watch_loops.py` |
| **2026-11-24** | **7 units** must judge whether they should still exist (Skills, Sales, Architecture Review, Red Team + 2 teams) | ✅ `watch_loops.py` |

**Now watched** (2026-08-24): `scripts/watch_loops.py` runs weekly via `.github/workflows/loop-watcher.yml`,
reports to the job summary, and never edits the corpus — a finding belongs in a unit's `questions.md`,
written by a person. This is the **6th running loop of 482**, and the first this chapter produced.
Earlier counts of "194 agendas" and "four triggers" came from an agent summary and were wrong;
the measured figures are 198 and 7.

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
