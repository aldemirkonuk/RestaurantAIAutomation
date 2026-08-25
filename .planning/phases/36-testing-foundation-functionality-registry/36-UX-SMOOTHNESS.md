# Phase 36 — UX Smoothness Audit (Operator Lens)

**Audited:** 2026-07-27  
**Lens:** Solo founder using Phase 36 outputs day-to-day while running Phases 37–43 + manual pathway passes (D-08)  
**Scope:** Plans 36-01 / 36-02 / 36-03 + CONTEXT/RESEARCH + spot-check of `apps/web` surfaces Phase 43 will walk  
**Not in scope:** Building Phase 38 control panel UI; rewriting product UX

---

## 1. Operator journey map

| Step | Founder action | Artifact they touch | Cognitive job | Smooth if… |
|------|----------------|---------------------|---------------|------------|
| A. Orient | “Where do I start this campaign?” | `.planning/testing/README.md` (36-03 Task 2) | Find the front door | README opens with a 60-second path, not a file dump |
| B. Ask “how tested is X?” | Pick a surface (e.g. Inventory, Login) | `FUNCTIONALITY-REGISTRY.md` (36-01 Task 2) → group # | Map page → group in &lt;30s | Group # + route table is scannable; slug locked |
| C. See maturity | Glance scoreboard | `TESTING-SCORECARD.md` (36-02 Task 2) | Decide what to work / pass next | 11 rows only; Gaps column is actionable, not essay |
| D. Dig evidence | Open a scorecard Evidence cell | `EXISTING-TEST-INVENTORY.md` (36-02 Task 1) + CI jobs | Trust the score | Inventory is agent-facing; founder rarely scrolls 140+ rows |
| E. Run breadth (39–40) | Agent writes suites; founder does checklists | Future `checklists/g{N}-*.md` + scorecard update | Execute + tick boxes | Checklist filenames match registry group #; evidence links back |
| F. Drive sim (38) | Use web control panel on sim tenant | `SYNTHETIC-TENANT.md` + later panel route | Know which restaurant is fake | `sim-*` naming already coherent; panel route reserved in registry |
| G. Manual pass (43) | Walk web / scanner / admin with prepared lists | Checklists + UX catalog distillates + scorecard final | Catch dead/mocked paths without inventing the list | Phase 36 seeds known traps into Gaps / registry notes |
| H. CI loop | Push → red/green; nightly E2E | `ci.yml` / `e2e-prod.yml` comments (36-03) + README honesty | Don’t confuse skeleton with green CI | Honesty line present; promotion rules require job names (36-01 Task 1) |

**Intended happy path (founder):** README → SCORECARD (11 rows) → one REGISTRY group section → checklist for that group. Inventory and Rubric are secondary (agent + promotion).

**Friction today in the plans:** Steps A and G are under-specified. README (36-03 Task 2 **C**) indexes files + score-update protocol + CI links — good for agents, weak as an operator entry. Checklist directory is ROADMAP-promised for Phase 39 (`checklists/`) but Phase 36 does not reserve IA or naming. Scorecard Gaps (36-02 Task 2) are technical (“No Nest specs”) — they do not yet flag operator-visible dead ends that will burn manual-pass time.

---

## 2. Friction points (ranked)

### BLOCKER

_None for Phase 36 execute itself._ Plans correctly stay doc/CI-skeleton; they do not invent a second E2E paradigm or force green CI. Shipping without the HIGH amendments below will not fail TFND-01..06 — it will make **founder use of the outputs** noisy through 39–43.

### HIGH

| ID | Friction | Why it hurts the founder | Where |
|----|----------|--------------------------|-------|
| H1 | No operator “start here” path in README | Founder opens `.planning/testing/` and faces 5 peer docs of equal weight; likely opens inventory first and stalls | 36-03 Task 2 **C**; PATTERNS README sketch |
| H2 | Inventory (~142 rows) is the wrong primary UI | `runs?`/`passes?` tables are agent/CI truth; human scanning them to answer “is Identity ready?” is high load | 36-02 Task 1 full table; mitigated only if scorecard is the front door |
| H3 | Gaps column won’t seed operator traps | Manual passes (D-08 / Phase 43) will rediscover catalog-known dead ends (Forgot password, mocked scanner persist, admin localStorage) unless Gaps/registry note them now | 36-02 Task 2 score assignment; no must_have for UX trap seeds |
| H4 | Checklist IA not reserved | ROADMAP Phase 39 writes `.planning/testing/checklists/` — Phase 36 never stubs path or filename convention → later rename churn vs registry group #s | 36-03 README only; deferred to 39 without contract |
| H5 | Phase 38 control panel not named in registry | CONTEXT D-27 locks control panel; registry Table B (36-01 Task 2) maps today’s `App.tsx` routes only — no reserved row for future sim panel → later IA drift vs groups 4/11 | 36-01 Task 2 Table B |

### MEDIUM

| ID | Friction | Why it hurts | Where |
|----|----------|--------------|-------|
| M1 | Group slug not locked | 36-02 allows `3-inventory` **or** `3 Inventory Operations` — inventory vs scorecard vs checklists will disagree | 36-02 Task 1 step 4 |
| M2 | Dual routes confuse checklist authors | `/inventory` vs `/inventory-legacy`; `/calendar` vs `/calendar-classic`; unrouted `RecurringOrders` | RESEARCH §B + 36-01 Task 2 (orphan noted — good); need “canonical for manual pass” column or note |
| M3 | CI honesty vs founder interpretation | Comment-only TFND-05 + red-Black honesty is cognitively correct, but easy to misread as “testing campaign CI is done/green” | 36-03 Task 2; 36-02 Task 2 CI honesty note |
| M4 | No link to `UX_PATHS_CATALOG.md` | Catalog already tags ✅/⚠️/❌/🚫 — gold for Phase 43 checklists — but testing artifacts don’t point to it | All three plans silent |
| M5 | Holistic T1 scoring hides UI holes | Group can be T1 from Nest/agent tests while web auth/scanner/admin remain manual-only landmines | 36-02 Task 2 scoring protocol (by design) — Gaps must compensate |

### LOW

| ID | Friction | Note |
|----|----------|------|
| L1 | Rubric as standalone file | Fine — link from scorecard; founder rarely needs it except promotions |
| L2 | `also_touches` secondary notes | Good for agents; founder can ignore |
| L3 | Wave 1 parallel 36-01 ∥ 36-02 | Scorecard may briefly lack RUBRIC link if 01 unfinished — 36-03 depends on both; acceptable |

---

## 3. Concrete plan amendments

Doc-only. No Phase 38 UI. Exact must_haves / task edits.

### 36-01-PLAN.md (Task 2 — FUNCTIONALITY-REGISTRY)

**Add to Required structure after Table B (Web routes):**

1. **Canonical manual-pass routes** — one short list (or column `manual_pass: yes|legacy|orphan`) stating:
   - Prefer `/inventory` (command) over `/inventory-legacy`
   - Prefer `/calendar` (modular) over `/calendar-classic`
   - `RecurringOrders` = orphan (already required) — **not** a Phase 43 tick until routed
2. **Reserved future surface (Phase 38)** — one registry row (not an App.tsx route yet):
   - Proposed path: `/sim` or `/admin/sim` (pick one in execution; document choice)
   - Primary group: **4 POS & Sales Ingestion** (panel fires orders); `also_touches: 11` (ops/chaos controls)
   - Status: `planned — Phase 38`; do not invent UI here
3. **Operator trap notes (cross-link)** — in Mapping rules or a 5-bullet “Manual pathway watchlist” section, require citing these as first-class Gaps fodder (not product fixes):
   - Auth: Forgot password → non-existent route; Remember me unbound (`Login.tsx` / UX catalog §20)
   - Scanner: GetStarted scan/CSV/manual live; Wine Library menu-scanner persistence still mocked (catalog §E / NEW-211–213)
   - Admin: `/admin` settings localStorage-only; `/admin/health` live poll (catalog §18 / AdminPanel comment NEW-544)
   - Dashboard: dead Reorder / empty Top Wines / stub calendar quick action (catalog §3)
   - Shell: decorative ⌘K historically noted — verify against shipped command palette before checklist writing

**New must_have truth:**

- `"Registry Table B marks canonical vs legacy/orphan routes and reserves one Phase 38 sim control-panel path with primary group 4"`

**New acceptance grep:**

- `rg -n 'manual_pass|Phase 38|/sim|inventory-legacy' .planning/testing/FUNCTIONALITY-REGISTRY.md`

### 36-02-PLAN.md (Task 1 + Task 2)

**Task 1 — lock slug:**

- Change step 4 from “`3-inventory` or `3 Inventory Operations` consistently” → **required slug form only:** `N-shortname` where shortnames are fixed:

```
1-identity | 2-catalog | 3-inventory | 4-pos | 5-procurement | 6-comms | 7-calendar | 8-analytics | 9-notifications | 10-ai | 11-platform
```

**Task 2 — Gaps seed (operator smoothness):**

- Add step 9: For groups **1, 2, 3, 8, 11**, Gaps column MUST include ≥1 **operator-visible** bullet drawn from registry watchlist / UX catalog (dead button, mocked path, dual route), separate from “No Nest specs”.
- Add Evidence optional 4th cite style: `UX_PATHS_CATALOG.md §N` when the gap is a known UI trap (path only — do not paste 860 NEW rows).

**New must_have truths:**

- `"Inventory group column uses locked N-shortname slugs only"`
- `"Scorecard Gaps for groups 1, 2, 3, 8, 11 each include ≥1 operator-visible UX trap (not only missing automated tests)"`

### 36-03-PLAN.md (Task 2 — README + IA stub)

**Expand README section C:**

1. **Operator quickstart** (top of file, before artifact table) — exact 4 lines intent:
   1. Open `TESTING-SCORECARD.md` — 11-row board
   2. Pick a group → open that section in `FUNCTIONALITY-REGISTRY.md`
   3. For manual work → `checklists/` (stub now; filled in 39–40 / 43)
   4. For score fights → `RUBRIC.md` + inventory evidence paths — do not browse inventory first
2. **Directory contract** — create empty `.planning/testing/checklists/README.md` stating:
   - Filename: `g{N}-{slug}-manual.md` (e.g. `g1-identity-manual.md`)
   - One checklist per group; Phase 39 owns g1–4; Phase 40 owns g5–7+9; Phase 43 owns scanner/admin/journey overlays
   - Each checklist header links: registry group, scorecard row, 3–7 canonical routes
3. **Cross-link** — one line to `.planning/UX_PATHS_CATALOG.md` as “status oracle for ✅/⚠️/❌ before writing checklist steps”
4. **CI interpretation banner** — strengthen honesty line: “TFND-05 = wiring documented; main may still be red; do not promote scores from green-wishful thinking”

**New must_have truths:**

- `"README opens with Operator quickstart (scorecard-first)"`
- `"checklists/README.md exists with g{N}-{slug}-manual.md naming contract"`
- `"README links UX_PATHS_CATALOG.md"`

**New artifact:**

- path: `.planning/testing/checklists/README.md`

---

## 4. Naming / IA recommendations for `.planning/testing/`

Keep the five TFND files flat (already planned). Add one child dir only:

```
.planning/testing/
├── README.md                      # Operator front door + TFND index
├── FUNCTIONALITY-REGISTRY.md      # 11 groups + surfaces (+ Phase 38 reserved row)
├── RUBRIC.md                      # T0–T4 (agent/promotion)
├── EXISTING-TEST-INVENTORY.md     # Agent/CI corpus — not human homepage
├── TESTING-SCORECARD.md           # Founder homepage (11 rows)
├── SYNTHETIC-TENANT.md            # sim-* contract (feeds 37–38)
└── checklists/
    ├── README.md                  # naming + ownership by phase
    └── g{N}-{slug}-manual.md      # filled 39–43 — stub dir only in 36
```

**Scannability rules:**

| Rule | Detail |
|------|--------|
| Group display | Scorecard & registry headers: `# N · Locked Name` (e.g. `# 3 · Inventory Operations`) |
| Group machine id | Everywhere else (inventory, checklist filenames, evidence tags): `N-shortname` only |
| Scorecard column order | Keep `| # | Group | Score | Evidence | Gaps | Next phase |` — founder reads left→right: who → how mature → proof → pain → owner |
| Inventory TOC | Optional one-liner in inventory Methodology: “Humans: use scorecard. This file is completeness evidence.” |
| Sim tenant | Keep `sim-*` / `e2e-test-restaurant` coexistence language (36-03 Task 1) — Phase 38 panel should show restaurant id with `sim-` prefix visible in UI later |
| Control panel | Reserve `/sim` (prefer) under group 4; avoid burying only under `/admin` so ops ≠ platform health |

**Do not:** merge inventory into scorecard; invent `testing-campaign.yml`; create per-group mega folders in Phase 36.

---

## 5. Spot-check: web surfaces → scorecard first-class flags

These are smoothness gaps the registry/scorecard should **flag**, not fix, in Phase 36:

| Surface | Route(s) | Group | Operator reality (2026-07-27) | Scorecard Gaps seed |
|---------|----------|-------|-------------------------------|---------------------|
| Auth login | `/login` | 1 | Demo login works; **Forgot password** → dead route; **Remember me** unbound | “Auth: dead forgot-password + unbound remember-me — checklist must mark expected fail vs bug” |
| Onboarding / scanner | `/get-started` | 2 (+1) | Scan / CSV / manual import path is the real scanner journey for founders | “Manual scanner pass = GetStarted import triad; do not only test Wine Library mocked scan” |
| Wine Library scan | `/wines` | 2 | Menu scanner UX exists; persistence still mocked per catalog | “Scanner persistence mocked — T2 web claim needs harness or explicit manual caveat” |
| Inventory command | `/inventory` | 3 | Dense but real ops surface (attention rail, receiving, cellar map) | “Canonical inventory path = command page; legacy route out of Phase 43 happy path” |
| Receiving | `/receiving/:orderId/door` + in-page workspace | 5 (`also_touches` 3) | Three-way match is high-value manual path | Keep RESEARCH A2; Gaps: “Receiving owned by 5 — inventory checklist cross-links only” |
| Dashboard | `/` | 8 | KPI modals live; Reorder dead; Top Wines empty; calendar stub | “Dashboard: assert which CTAs are live before Phase 41 truth pass” |
| Communications | `/communications` | 6 | Classified list + send history + templates — heavy page | Breadth 40 checklist: triage/draft path only first; don’t boil the ocean |
| Admin panel | `/admin` | 11 | Saves to **localStorage**; Restart/integrations partial | “Admin Panel = simulated config — Phase 43 verify honesty, not persistence” |
| Admin health | `/admin/health` | 11 | Live `/api/v1/health/agents` poll + detail (NEW-548) | “Health is the real admin verification surface for JRNY-03” |
| Recurring orders | _(unrouted)_ | 5 | Vitest exists; no route | Already planned anomaly — keep; never put on manual happy path |
| Phase 38 panel | `/sim` (reserved) | 4 | Doesn’t exist yet | Registry reserved row only |

---

## 6. Verdict

### Fix before execute

Plans are strong on TFND correctness and CI non-scope-creep. They are **not yet smooth enough for the solo founder** who must live in scorecard → checklist → manual pass without drowning in inventory.

**Minimum bar before `/gsd-execute-phase 36`:** land the HIGH amendments in §3 (operator README, locked slugs, Gaps UX seeds for groups 1/2/3/8/11, `checklists/` naming stub, Phase 38 reserved route row). Estimated plan-edit cost: small; estimated founder friction avoided across 39–43: large.

After those amendments: **Smooth enough — ship** Phase 36 execution. Do not expand into building checklists, fixing Forgot password, or scaffolding the SimPOS panel.

---

## UX SMOOTHNESS COMPLETE
