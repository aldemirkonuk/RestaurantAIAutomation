# Phase 37: Synthetic Restaurant Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-27
**Phase:** 37-Synthetic Restaurant Engine
**Areas discussed:** A Menu sourcing, B Archetype packs, C Ground-truth ledger, D Teardown expansion, E Operator interface, F Team/auth personas

---

## A. Menu sourcing

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid snapshots | Crawl once → frozen JSON → replay | |
| Live crawl every generate | Always hit web at seed | |
| Curated-only | Hand-picked menus | |
| SOTA hybrid | Finest extraction → frozen snapshots; refresh re-runs SOTA | ✓ |

**User's choice:** SOTA hybrid; reuse Phase 2 E2E set; accept+flag partial (`menu_quality=partial`)
**Notes:** Later clarified user owns menu types/sell prices from existing menus

---

## B. Archetype packs

| Option | Description | Selected |
|--------|-------------|----------|
| Named recipes + overrides | Presets + knobs | ✓ |
| Knobs-only | No named packs | |
| Fixed recipes only | No knobs | |

**B2 mapping:** Planning locks 1 URL→1 archetype; optional parameter skins (“maybe both?”)
**B3 stock:** Fixed defaults per archetype, configurable in config file

---

## C. Ground-truth ledger

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated `sim_ground_truth*` | Bulletproof oracle tables | ✓ (locked for SOTA) |
| Tagged rows only | Live tables as oracle | |
| Hybrid events | Small event ledger + live rows | |

**C2:** SOTA / bulletproof schema for Phase 41 KPI exactness  
**C3:** Same generator transaction (fail closed) ✓  
**Notes:** User emphasized existing menus decide sell prices

---

## D. Teardown expansion

| Option | Description | Selected |
|--------|-------------|----------|
| Strict gate | No multi-archetype seed until write-set covered | ✓ |
| Staged | Expand per archetype | |
| Document-only | Best effort | |

**D2:** Cover generator write-set ✓  
**D3:** Extend conftest_prod + shared script ✓  

---

## E. Operator interface

| Option | Description | Selected |
|--------|-------------|----------|
| CLI + CI script only | | |
| API only | | |
| Both CLI + API | | ✓ |

**E2:** Root pnpm → Python ✓  
**E3:** dry-run default + explicit `--apply` ✓  

---

## F. Team / auth personas

| Option | Description | Selected |
|--------|-------------|----------|
| Shared role credential set + URA | | (base) |
| Unique users per restaurant | | |
| Service-role only (no Auth) | | |
| SOTA role isolation | Distinct owner/manager/staff Auth; RLS blocks staff→manager | ✓ |

**F2:** Owner + manager + staff ✓  
**F3:** Env-based secrets ✓  
**Notes:** Explicit: prevent staff entering manager account

---

## Claude's Discretion

- Exact URL→archetype table and Turkish clone slot
- Concrete `sim_ground_truth*` schema within bulletproof bar
- Snapshot directory layout; script/API path names
- Whether parameter-skin variants ship in v1

## Deferred Ideas

- Phase 38 SimPOS / simulator / control panel
- Phases 39–41 breadth + analytics assert consumption of oracle
