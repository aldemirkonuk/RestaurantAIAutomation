# Phase 37: Synthetic Restaurant Engine - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a parameterized **synthetic restaurant factory** that:

1. Produces restaurant profiles from named archetype recipes + parameter overrides (cuisine, size, wine-program depth, sales volume, price tier, ordering rhythm)
2. Sources menus via **SOTA hybrid snapshots** (best extraction path → frozen JSON under `datasets/sim/`; generator replays; explicit refresh re-crawls)
3. Seeds cloud Supabase as `sim-*` tenants: org, restaurant, team (owner/manager/staff), menu, opening inventory
4. Writes a **dedicated bulletproof `sim_ground_truth*` oracle** in the same transaction as seed
5. Ships ≥5 live archetypes (fine dining, bistro, high-volume bar, cafe, Turkish clone) using Phase 2 E2E menu URLs as the snapshot pack base

After this phase, Phases 38–41 can drive SimPOS / analytics against real SKU diversity and an exact oracle — without polluting production tenants.

**Hard gate (from Phase 36):** Expand teardown to cover the generator write-set **before** first multi-archetype cloud seed. Never delete `e2e-test-restaurant`.

</domain>

<decisions>
## Implementation Decisions

### A. Menu sourcing
- **D-01:** **SOTA hybrid snapshots** — Use the finest extraction path available (v1.0 crawler + Claude Vision / PDF fallback as needed) to build high-quality frozen menu JSON under `datasets/sim/`. Generator **always replays snapshots** (deterministic, CI-safe). Explicit refresh command re-runs SOTA crawl/extract and updates snapshots.
- **D-02:** **Reuse Phase 2 E2E restaurant set** as the first snapshot pack base: The Tailors Son, Chicago Winery, BLVD Steakhouse, The Albert Chicago, Siena Tavern (`scripts/e2e_restaurants.json`), plus Turkish clone mapping for the fifth/sixth archetype slot as planned.
- **D-03:** **Accept + flag** on messy extracts — seed what extracted; set `menu_quality=partial` in ground truth; still counts toward SYNTH-05.
- **D-04:** **User owns menu types and selling prices** — menus come from existing real menus; sell prices are those decided on the source menu (generator does not invent sell prices).

### B. Archetype packs
- **D-05:** **Named recipes + parameter overrides** — Ship ≥5 named presets (fine dining, bistro, high-volume bar, cafe, Turkish clone) with defaults; knobs can override any preset.
- **D-06:** **URL → archetype mapping locked in planning** — Primary model is 1 snapshot URL → 1 archetype; optional parameter-skin variants allowed where useful (“both”).
- **D-07:** **Opening stock** — Fixed defaults per archetype, **configurable** in a per-archetype config file (not opaque rhythm magic only).

### C. Ground-truth ledger
- **D-08:** **Dedicated `sim_ground_truth*` tables** — Append-only / queryable oracle separate from (and in addition to) live `sim-%` app rows. Tagged-only oracle rejected as not bulletproof for Phase 41.
- **D-09:** **SOTA bulletproof schema** — Fact types rich enough for exact Phase 41 KPI asserts (opening stock, menu/sell prices, roster, SKU set, menu_quality, archetype_id, timestamps, etc.). Planner designs concrete columns/JSON shapes; prefer completeness over a thin stub.
- **D-10:** **Atomic seed + oracle** — Generator writes live seed and ground-truth facts together; **fail closed** if oracle write fails (no orphan live rows without oracle, and vice versa to the extent feasible).

### D. Teardown expansion
- **D-11:** **Strict gate** — Refuse multi-archetype cloud seed (`--apply`) until teardown registry covers **every table the generator writes**.
- **D-12:** **Coverage definition** — Generator write-set ↔ teardown list must be equal (not “all registry domains forever”).
- **D-13:** **Extend `conftest_prod.py` + shared script** — One teardown registry used by pytest and `pnpm synth:teardown`. Do not fork a parallel orphan list. Never delete `e2e-test-restaurant`. Teardown never raises (Sentry `sim-orphan`).

### E. Operator interface
- **D-14:** **Both CLI and API** — CLI for local/ops; thin API wrappers for CI/agents.
- **D-15:** **Root pnpm scripts → Python module** — Match `seed_database.py` / orchestrator scripts pattern (not Nest-only CLI).
- **D-16:** **Safety** — Default **`--dry-run`**; cloud mutations require explicit **`--apply`**.

### F. Team / auth personas
- **D-17:** **SOTA role isolation** — Three **distinct** Auth users (owner, manager, staff) with separate credentials. URA membership + role per `sim-*` restaurant. **Staff JWT must not access manager/owner capabilities** (RLS / role checks — bulletproof against staff entering manager account). Not a single shared login for all roles.
- **D-18:** Seed **owner + manager + staff** per restaurant (SYNTH-03).
- **D-19:** **Env-based secrets** — `SIM_OWNER_EMAIL`/`PASSWORD`, `SIM_MANAGER_*`, `SIM_STAFF_*` (names illustrative); never commit; never log JWTs/passwords. Reuse across archetypes via URA rows.

### Claude's Discretion
- Exact URL→archetype mapping table (within D-06) and which archetype is the Turkish clone slot
- Concrete `sim_ground_truth*` table/column design (within D-09 bulletproof bar)
- Whether optional parameter-skin variants ship in v1 of the factory or only named recipes
- Exact pnpm script names and API route paths
- Snapshot directory layout under `datasets/sim/`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase / campaign
- `.planning/ROADMAP.md` — Phase 37 success criteria + Testing Campaign locks
- `.planning/REQUIREMENTS.md` — SYNTH-01..05
- `.planning/phases/36-testing-foundation-functionality-registry/36-CONTEXT.md` — campaign decisions D-01..D-30
- `.planning/testing/SYNTHETIC-TENANT.md` — `sim-*` convention, RLS checklist, E2E_TABLES gap, Phase 37 hard gate
- `.planning/testing/FUNCTIONALITY-REGISTRY.md` — Table D domains for teardown coverage mapping
- `.planning/phases/36-testing-foundation-functionality-registry/36-PREMORTEM.md` — C2 teardown / orphan risks

### Menu / extraction
- `scripts/e2e_restaurants.json` — Phase 2 E2E URL pack
- `services/agent-orchestrator/services/web_crawler.py` — crawl pipeline
- `.planning/PROJECT.md` — live camera/OCR extraction stack targets (SOTA path context)

### Seed / teardown / auth
- `services/agent-orchestrator/tests/e2e/conftest_prod.py` — `E2E_TABLES`, JWT, teardown never-raise
- `scripts/setup_e2e_anchor.py` — permanent anchor pattern
- `scripts/seed_database.py` / `scripts/gen_seed_via_api.py` — existing seed patterns
- `apps/api-gateway/src/organizations/` — org/location create
- `apps/api-gateway/src/restaurants/` — restaurant + members
- `apps/api-gateway/src/menus/` / `apps/api-gateway/src/wines/` — menu/wine seed surfaces

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `WebCrawlerService` / extraction pipeline — build SOTA snapshots
- `e2e_restaurants.json` — five known good menu URLs
- `conftest_prod.py` teardown + `prod_jwt` — extend, don’t fork
- Org/restaurant/members Nest services — seed path targets
- Menus + wine submissions services — persist extracted SKUs

### Established Patterns
- Deterministic `e2e-%` / `sim-%` ID prefixes
- Service-role for seed/teardown only; JWT for user-path proof
- Teardown never raises; Sentry orphan tags

### Integration Points
- Cloud Supabase (D-07 campaign) as seed target
- Future Phase 38 SimPOS consumes seeded menus/inventory
- Future Phase 41 asserts against `sim_ground_truth*`

</code_context>

<specifics>
## Specific Ideas

- User will use **already existing menus**; sell prices come from those menus (D-04)
- Role isolation is a hard product/security preference: staff must not enter manager account (D-17)
- “Bulletproof” repeated for oracle + personas — prefer stricter fail-closed designs over convenience

</specifics>

<deferred>
## Deferred Ideas

- SimPOS provider, day simulator, control panel UI — Phase 38
- Breadth test suites / manual checklists bodies — Phases 39–40
- Analytics truth assertions against oracle — Phase 41
- Live crawl on every CI generate (rejected for Phase 37 default path)
- Unique Auth users per restaurant (rejected in favor of shared role users + URA)

None else — discussion stayed within phase scope

</deferred>

---

*Phase: 37-Synthetic Restaurant Engine*
*Context gathered: 2026-07-27*
