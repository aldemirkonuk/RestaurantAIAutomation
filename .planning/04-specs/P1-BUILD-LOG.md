---
type: build-log
id: P1
title: P1 Build Log
status: complete
updated: 2026-08-24
links: ["[[P1-NF-A-INSTRUMENTATION]]", "[[P1-EMITTER-ARCHITECTURE]]", "[[P1-PYTHON-EMITTER]]", "[[0008-nf-column-contract]]", "[[backtests-charter]]"]
---

# P1 Build Log — what was actually done, and how it was verified

> Written per non-negotiable #4: work that is not documented did not happen. This
> records the build as it ran, including the parts that failed first.
> Branch: `feat/p1-nf-instrumentation`.

## 1. Decisions taken into the build

All founder calls, recorded here so the build is traceable to them:

| Decision | Choice | Where locked |
|---|---|---|
| Column contract | **Path C** — full ADR 0006 shape now | [ADR 0008](../decisions/0008-nf-column-contract.md) |
| Fourth subject | **`operator`** added — page analytics rides the NF spine, not a second store | ADR 0008 review trail |
| Emitter shape | **Full model-client wrapper**, not a thin logger | this log §3 |
| Emit failure | **Never fail the model call** — but count drops | matches `spend_logger.py`'s "NEVER re-raise" |
| Retry | **Most complete**: transport-only retry **+ per-restaurant daily spend ceiling** | §3 |
| `outcome` day one | **Call-level**, stamped `outcome_basis: call_level_v0`, re-graded later by [[backtests-charter\|Backtests]] | §5 |
| `correlation_id` | **In P1** — gateway threading + fix the RabbitMQ bridge drop | §3 |
| Python D3 | **In scope** — both runtimes or neither | §4, **see the honesty note** |

Claude recommended Path A and was overruled; that argument is preserved in ADR 0008
rather than quietly dropped.

## 2. Step 1 — migration

`supabase/migrations/*_neural_footprint_event.sql`. The ADR 0008 schema exactly: one
polymorphic store, `subject_type in ('agent','guest','operator','bio')`, five partial
indexes so sparse columns never cost dense reads.

**Verification:** no local Postgres was reachable, so this was a *structural* check, not
an execution — stated plainly rather than implied. Checks passed: table created,
4 subject types, `outcome` nullable (NULL = unknown, never success), 5 indexes, balanced
parens, no `DROP`, idempotent (`if not exists` ×6).

`api_spend` and `decision_log` keep their writers and are **not dropped**.

## 3. Step 2 — gateway model-client wrapper

`apps/api-gateway/src/common/model-client/` — module, service, and `correlation.ts`.
All **7** call sites route through it: `ux-optimizer`, `vendor-page-extractor`,
`inbound-responder`, `photo-count`, `document-extractor`, `scan-parser`, `consultants`.

Preserved deliberately: `scan-parser`'s re-chunking on `stop_reason` is *semantic* retry
and must not be swallowed by transport retry; `inbound-responder`'s beta header and
temperature pass through verbatim.

**Verification:** `npx tsc --noEmit -p apps/api-gateway/tsconfig.json` — clean.
All 7 files confirmed importing `model-client`.

## 4. Step 3 — Python emitter

`SpendLogger` extended as the **sole dual-write entry point** (`api_spend` +
`neural_footprint_event`), with row-building in `services/neural_footprint.py`. New params
are **keyword-only with defaults**, which the research pass verified breaks zero of the 16
existing call sites. Client-per-call replaced with the existing `Settings.supabase_client`
singleton.

## 5. Step 4 — CI guard

`scripts/check_model_calls_logged.sh` + `model-call-ledger` job in `ci.yml`.

Two design rules that matter more than the check itself:

- **Never vacuous.** Five states exit **2** rather than green: wrapper directory missing
  or empty, zero gateway hits, zero Python call sites, `spend_logger.py` moved. A guard
  that cannot find what it checks is a failure, not a skip — the same principle
  `schema-parity.yml` states in its own header.
- **Proven to fail before being trusted.** A temp unlogged probe took the Python count
  18 → 19 and exited 1; deleting it returned to clean. Remaining states were proven on a
  byte-identical fixture: clean exit 0 · unlogged gateway file exit 1 · wrapper deleted
  exit 2 *with the Python section still evaluated* · debt file made to log exit 1 · all
  call sites removed exit 2, **not** a pass.

## 6. Things that failed first — recorded, not hidden

1. **My simpos gate broke the JSX.** Wrapping two `<Route>` elements in a fragment
   produced malformed output; `tsc` caught it (`TS1003`, `TS17015`). Reverted and gated
   per-route via the element instead. The lesson is the process working: the typecheck was
   run *before* claiming the fix, not after.
2. **I mis-read the CI job list.** I printed the last three jobs, saw no
   `model-call-ledger`, and said the agent had not added it. It was there at `ci.yml:63`.
   My error, corrected immediately.
3. **A reported "fail-open" finding was wrong.** Earlier in this chapter, an agent
   reported Toast's signature check as fail-open; the code already had an `else if` that
   refused unsigned input. A fix built on that report was written and **reverted**. This
   is why every agent claim in this build was re-verified in source.

## 7. Python D3 — closed, not grandfathered

The guard originally passed with **11 files on a shrink-only `PY_UNLOGGED_DEBT` ratchet**.
That was green-by-grandfathering, and it was **not** what the founder decided ("both
runtimes or neither — a ledger with known holes measures nothing reliably"). It is
recorded here because for a while the guard said PASS while the hole was still open.

All 11 now reach `SpendLogger` and were removed from the list:

```
calendar_agent · email_intel_agent · email_parsing_agent · provider_conversation_agent
rfq_agent · sommelier_agent · auction_wine_service · email_composer_service
wine_book_scraper · wine_field_parser · wine_matcher
```

**Debt list is now empty**, which surfaced a real bug in the guard: an empty bash array
under `set -u` is an unbound-variable error on macOS's bash 3.2. Fixed with a filtered
placeholder, so the goal state does not crash the check that measures it.

**Final guard state: 18 of 18 Python call sites log · 0 debt · gateway fully routed ·
exit 0.**

## 8. Done-when, honestly scored

From [P1 §6](P1-NF-A-INSTRUMENTATION.md):

| Criterion | State |
|---|---|
| §2 query returns rows for both runtimes | ⬜ Needs the migration applied + real traffic |
| All 7 gateway call sites emit | ✅ Wired; `tsc` clean; 770 gateway tests pass |
| CI guard fails a deliberately unlogged call site | ✅ Proven, transcript in §5 |
| Python side emits | ✅ 18/18 call sites; **785 passed, 3 skipped** |
| `nf_a.cost_per_completed_task` has a real number | ⬜ Needs applied migration + traffic |
| Loops blocked solely on NF-A emission move off `blocked` | ⬜ Pending the above |

**Verification actually run** (not asserted): `npx tsc --noEmit` clean · gateway jest
58 suites / 770 tests · `pytest tests/ -q` → **785 passed, 3 skipped, 71.67s** ·
`check_model_calls_logged.sh` → exit 0.

## 9. Open items this build leaves

| Item | Why it is not in P1 |
|---|---|
| `MODEL_DAILY_SPEND_CEILING_USD` default is **$5/day/restaurant** | The wrapper needed *a* number to be safe by default. The real figure is a founder call. |
| No live emission test against Supabase | No credentials available here. The insert shape matches the migration exactly, but a first real row is the proof. |
| Migration not yet applied | Needs `SUPABASE_POOLER_CONNECTION_STRING` (OD-49) or a manual apply. |
| Research store (wide, append-only) | Out of P1 scope by ADR 0008. |

**P1 is not done because code merged.** It is done when a number exists that nobody had
to assemble by hand. Code is the precondition, not the criterion.
