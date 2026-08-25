# Phase 37: Synthetic Restaurant Engine - Research

**Researched:** 2026-07-27
**Domain:** Synthetic tenant factory — menu snapshot pipeline, cloud Supabase seed, ground-truth oracle, teardown gate, CLI/API ops
**Confidence:** HIGH

## Summary

Phase 37 builds a parameterized **synthetic restaurant factory** that freezes real menus under `datasets/sim/`, replays them deterministically into cloud Supabase as `sim-*` tenants, and writes a dedicated `sim_ground_truth*` oracle in the same fail-closed transaction as the live seed. Locked CONTEXT decisions D-01..D-19 already choose SOTA hybrid snapshots (not live CI crawls), Phase 2 E2E URLs as the first pack, dedicated oracle tables (not tagged app rows), strict write-set↔teardown equality before `--apply`, CLI+API with default dry-run, and three distinct Auth personas (owner/manager/staff).

Live cloud schema (`Restaurant_Wine_Ops` / `exzueerziesmczwlhomd`) confirms **`restaurants.id` is UUID**, **`inventory_stock` does not exist** (canonical stock is `restaurant_inventory`), and **no `sim_ground_truth*` tables exist yet**. Phase 25’s string id `e2e-test-restaurant` and `E2E_TABLES` entry for `inventory_stock` are **not aligned with live schema** — Phase 37 must implement teardown against the generator’s real write-set (UUID + `slug LIKE 'sim-%'`), while still never deleting any e2e anchor and extending (not forking) `conftest_prod.py` + a shared teardown module.

Existing assets are strong: Phase 2 JSONL menus already under `datasets/restaurant_menus/` (754 SKUs across five URLs, most with sell prices), `WebCrawlerService.crawl_restaurant` + `_persist_crawled_wines`, Nest `menus.service` persist path (`restaurant_menus` → `menu_items` → `restaurant_inventory`), Auth Admin pattern in `setup_e2e_anchor.py`, and URA role checks that already reject `staff` for manager-gated actions.

**Primary recommendation:** Implement a Python package `scripts/synth/` (pnpm-wrapped) that (1) materializes frozen snapshots from existing Phase 2 JSONL + optional refresh crawl, (2) seeds cloud via a **single Postgres transaction** writing org/restaurant/URA/menu/inventory + `sim_ground_truth_*`, (3) shares one `SYNTH_WRITE_SET` / teardown registry with pytest, and (4) refuses multi-archetype `--apply` until teardown coverage equals that write-set.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### A. Menu sourcing
- **D-01:** **SOTA hybrid snapshots** — Use the finest extraction path available (v1.0 crawler + Claude Vision / PDF fallback as needed) to build high-quality frozen menu JSON under `datasets/sim/`. Generator **always replays snapshots** (deterministic, CI-safe). Explicit refresh command re-runs SOTA crawl/extract and updates snapshots.
- **D-02:** **Reuse Phase 2 E2E restaurant set** as the first snapshot pack base: The Tailors Son, Chicago Winery, BLVD Steakhouse, The Albert Chicago, Siena Tavern (`scripts/e2e_restaurants.json`), plus Turkish clone mapping for the fifth/sixth archetype slot as planned.
- **D-03:** **Accept + flag** on messy extracts — seed what extracted; set `menu_quality=partial` in ground truth; still counts toward SYNTH-05.
- **D-04:** **User owns menu types and selling prices** — menus come from existing real menus; sell prices are those decided on the source menu (generator does not invent sell prices).

#### B. Archetype packs
- **D-05:** **Named recipes + parameter overrides** — Ship ≥5 named presets (fine dining, bistro, high-volume bar, cafe, Turkish clone) with defaults; knobs can override any preset.
- **D-06:** **URL → archetype mapping locked in planning** — Primary model is 1 snapshot URL → 1 archetype; optional parameter-skin variants allowed where useful (“both”).
- **D-07:** **Opening stock** — Fixed defaults per archetype, **configurable** in a per-archetype config file (not opaque rhythm magic only).

#### C. Ground-truth ledger
- **D-08:** **Dedicated `sim_ground_truth*` tables** — Append-only / queryable oracle separate from (and in addition to) live `sim-%` app rows. Tagged-only oracle rejected as not bulletproof for Phase 41.
- **D-09:** **SOTA bulletproof schema** — Fact types rich enough for exact Phase 41 KPI asserts (opening stock, menu/sell prices, roster, SKU set, menu_quality, archetype_id, timestamps, etc.). Planner designs concrete columns/JSON shapes; prefer completeness over a thin stub.
- **D-10:** **Atomic seed + oracle** — Generator writes live seed and ground-truth facts together; **fail closed** if oracle write fails (no orphan live rows without oracle, and vice versa to the extent feasible).

#### D. Teardown expansion
- **D-11:** **Strict gate** — Refuse multi-archetype cloud seed (`--apply`) until teardown registry covers **every table the generator writes**.
- **D-12:** **Coverage definition** — Generator write-set ↔ teardown list must be equal (not “all registry domains forever”).
- **D-13:** **Extend `conftest_prod.py` + shared script** — One teardown registry used by pytest and `pnpm synth:teardown`. Do not fork a parallel orphan list. Never delete `e2e-test-restaurant`. Teardown never raises (Sentry `sim-orphan`).

#### E. Operator interface
- **D-14:** **Both CLI and API** — CLI for local/ops; thin API wrappers for CI/agents.
- **D-15:** **Root pnpm scripts → Python module** — Match `seed_database.py` / orchestrator scripts pattern (not Nest-only CLI).
- **D-16:** **Safety** — Default **`--dry-run`**; cloud mutations require explicit **`--apply`**.

#### F. Team / auth personas
- **D-17:** **SOTA role isolation** — Three **distinct** Auth users (owner, manager, staff) with separate credentials. URA membership + role per `sim-*` restaurant. **Staff JWT must not access manager/owner capabilities** (RLS / role checks — bulletproof against staff entering manager account). Not a single shared login for all roles.
- **D-18:** Seed **owner + manager + staff** per restaurant (SYNTH-03).
- **D-19:** **Env-based secrets** — `SIM_OWNER_EMAIL`/`PASSWORD`, `SIM_MANAGER_*`, `SIM_STAFF_*` (names illustrative); never commit; never log JWTs/passwords. Reuse across archetypes via URA rows.

### Claude's Discretion
- Exact URL→archetype mapping table (within D-06) and which archetype is the Turkish clone slot
- Concrete `sim_ground_truth*` table/column design (within D-09 bulletproof bar)
- Whether optional parameter-skin variants ship in v1 of the factory or only named recipes
- Exact pnpm script names and API route paths
- Snapshot directory layout under `datasets/sim/`

### Deferred Ideas (OUT OF SCOPE)
- SimPOS provider, day simulator, control panel UI — Phase 38
- Breadth test suites / manual checklists bodies — Phases 39–40
- Analytics truth assertions against oracle — Phase 41
- Live crawl on every CI generate (rejected for Phase 37 default path)
- Unique Auth users per restaurant (rejected in favor of shared role users + URA)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNTH-01 | Parameterized generator: cuisine, size, wine-program depth, sales volume, price tier, ordering rhythm → full restaurant profile | Named recipe YAML/JSON + override knobs; profile written to `restaurants` + `sim_ground_truth_runs.params` |
| SYNTH-02 | Menus sourced from real web menus (reuse v1.0 crawler/extraction) — real SKU diversity | Snapshot pipeline from Phase 2 JSONL + `WebCrawlerService`; refresh updates `datasets/sim/`; generator replays only |
| SYNTH-03 | Seed cloud: org, restaurant, team (owner/manager/staff), menu, opening inventory | Write-set tables + Auth Admin + URA; Nest menus/inventory column mapping |
| SYNTH-04 | Ground-truth ledger records every generated fact — oracle for analytics | Dedicated `sim_ground_truth_runs` + `sim_ground_truth_facts` (append-only), atomic with seed |
| SYNTH-05 | ≥5 distinct archetypes live | Recommended 5-archetype mapping + Turkish Avli slot; opening-stock configs |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Snapshot crawl / refresh | API / Backend (orchestrator Python) | CDN / Static (`datasets/sim/`) | Reuses `WebCrawlerService`; frozen files are the CI source of truth |
| Archetype recipe + overrides | Browser / Client (config files in repo) | API / Backend (loader) | Config is git-versioned; generator loads + validates |
| Cloud seed (org/restaurant/menu/inventory) | Database / Storage | API / Backend (seed script) | Service-role writes to Supabase; transactional SQL preferred |
| Auth user provisioning | API / Backend (Auth Admin) | Database / Storage (`users`, URA) | Match `setup_e2e_anchor.py` Admin API pattern |
| Ground-truth oracle | Database / Storage | API / Backend | Dedicated tables; Phase 41 reads via SQL/API |
| Teardown gate + sweep | API / Backend (shared module) | Database / Storage | One registry for CLI + pytest; never-raise + Sentry |
| Operator CLI | Browser / Client (pnpm → Python) | — | Local/ops entrypoint |
| Thin admin API | API / Backend (FastAPI) | Frontend Server (—) | `X-Admin-Key` wrappers for CI/agents; no Nest-only CLI |
| Role isolation proof | API / Backend (Nest RolesGuard / URA) | Database / Storage (RLS) | Staff JWT must fail manager routes |

---

## Project Constraints (from CLAUDE.md)

No root `CLAUDE.md` found in this workspace. [VERIFIED: filesystem]

Relevant project skill conventions still apply from `.cursor/skills/` / `.agents/skills/` (Railway config, fix-error, reasoning protocol) — none override Phase 37 stack choices. Prefer existing monorepo patterns: root `pnpm` scripts → Python under `scripts/` or `services/agent-orchestrator/`, Supabase migrations under `supabase/migrations/`, never commit secrets.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python 3.11 | 3.11.0 (local) | Generator / teardown / refresh | Matches orchestrator runtime [VERIFIED: `python3 --version`] |
| supabase-py | ≥2.10.0 (req); 2.28.0 installed | Service-role seed reads/writes | Already used by `seed_database.py` / E2E [VERIFIED: requirements.txt + local install] |
| httpx | 0.28.1 installed | Auth Admin API (create users) | Pattern from `setup_e2e_anchor.py` [VERIFIED] |
| psycopg2-binary | 2.9.9 (req) | **Transactional** multi-table seed + oracle | PostgREST cannot atomically span tables; D-10 needs SQL `BEGIN` [VERIFIED: requirements.txt] |
| pydantic | 2.x (2.12.5 local / 2.6.0 pinned in req) | Recipe + snapshot schema validation | Already orchestrator standard [VERIFIED] |
| FastAPI | 0.109.0 | Thin `/api/v1/admin/synth/*` routes | Existing admin route style + `X-Admin-Key` [VERIFIED] |
| pytest | 7.4.4 | Unit + gate tests | Existing `pytest.ini` + `prod_e2e` marker [VERIFIED] |
| Playwright (async) | project install | Snapshot refresh crawl | Required by `web_crawler.py` [VERIFIED: code import] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| PyYAML / JSON | stdlib JSON + PyYAML if present | Archetype recipe files | Prefer JSON if avoiding new dep; YAML OK if already in env |
| sentry-sdk | project existing | `sim-orphan` teardown reports | Extend `conftest_prod.py` pattern |
| bcrypt | seed_database | Only if writing `users.password_hash` for legacy rows | Prefer Auth-only passwords; mirror `users` row without logging secrets |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct SQL transaction | NestJS seed endpoints only | Nest path reuses menus.service but cannot easily fail-closed with oracle in one TX; reject for D-10 |
| Tagged columns on app tables as oracle | Dedicated `sim_ground_truth*` | Rejected by D-08 |
| Live crawl every generate | Frozen snapshots | Rejected by D-01 / deferred |
| TEXT `restaurants.id` = `sim-*` | UUID5 + `slug LIKE 'sim-%'` | Live PK is UUID [VERIFIED: cloud `information_schema`] — must not insert non-UUID ids |

**Installation:** No new packages required if using JSON recipes + existing orchestrator venv. Optional:

```bash
# only if planner chooses YAML recipes and PyYAML missing
pip install pyyaml
```

**Version verification:** supabase-py 2.28.0 local / ≥2.10.0 pinned; FastAPI 0.109.0; pytest 7.4.4; Node supabase-js latest registry 2.110.x (Nest side only if API gateway wraps — Phase 37 primary path is Python). [VERIFIED: npm registry + local metadata]

---

## Architecture Patterns

### System Architecture Diagram

```text
                    ┌─────────────────────────┐
  Operator / CI ───▶│ pnpm synth:*  (CLI)     │
                    │ FastAPI /admin/synth/*  │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
     ┌────────────────┐ ┌──────────────┐ ┌──────────────────┐
     │ refresh        │ │ generate     │ │ teardown         │
     │ (SOTA crawl)   │ │ (replay)     │ │ (shared registry)│
     └───────┬────────┘ └──────┬───────┘ └────────┬─────────┘
             │                 │                  │
             ▼                 │                  │
   datasets/sim/menus/*.json   │                  │
   datasets/sim/archetypes/*   │                  │
             │                 │                  │
             └────────▶────────┤                  │
                               ▼                  ▼
                    ┌──────────────────────────────────┐
                    │ Postgres TX (service role / DSN) │
                    │  organizations                   │
                    │  restaurants (UUID + slug sim-*) │
                    │  users + user_restaurant_access  │
                    │  restaurant_menus / menu_items   │
                    │  restaurant_inventory            │
                    │  sim_ground_truth_runs/facts     │
                    │  COMMIT or ROLLBACK (fail-closed)│
                    └──────────────────────────────────┘
                               │
                               ▼
                    Auth Admin API (3 users once)
                    URA rows per sim restaurant
```

### Recommended Project Structure

```text
datasets/sim/
├── menus/
│   ├── fine-dining.json          # frozen snapshot (SKU array + meta)
│   ├── bistro.json
│   ├── high-volume-bar.json
│   ├── cafe.json
│   └── turkish-clone.json
├── archetypes/
│   ├── fine-dining.json          # recipe + opening_stock + snapshot ref
│   ├── bistro.json
│   ├── high-volume-bar.json
│   ├── cafe.json
│   └── turkish-clone.json
└── manifest.json                 # pack version, hash per snapshot

scripts/synth/
├── __init__.py
├── __main__.py                   # python -m scripts.synth
├── cli.py                        # argparse: refresh|generate|teardown
├── recipes.py                    # load + validate archetype configs
├── snapshots.py                  # load/replay + refresh via crawler
├── seed.py                       # transactional write-set + oracle
├── teardown.py                   # shared registry (imported by conftest)
├── auth_personas.py              # ensure 3 Auth users; never log secrets
├── write_set.py                  # SYNTH_WRITE_SET == TEARDOWN_TABLES gate
└── ids.py                        # uuid5 helpers for sim restaurants

services/agent-orchestrator/api/synth_routes.py   # thin X-Admin-Key API
supabase/migrations/YYYYMMDDHHMMSS_sim_ground_truth.sql
services/agent-orchestrator/tests/test_synth_*.py
```

### Pattern 1: SOTA hybrid snapshots (D-01)
**What:** Refresh builds/updates frozen JSON under `datasets/sim/`; generate never hits the network.
**When to use:** Always for generate/CI; refresh only when operators intentionally update menus.
**Example:**
```python
# Source: services/agent-orchestrator/services/web_crawler.py (crawl_restaurant, _persist_crawled_wines)
# Refresh adapts existing JSONL → datasets/sim/menus/<archetype>.json
snapshot = {
  "archetype_id": "bistro",
  "source_url": "https://www.thetailorssonsf.com/menus/#wine-beer",
  "source_name": "The Tailors Son",
  "extracted_at": "2026-04-06T00:00:00+00:00",
  "extraction_model": "gemini-2.5-flash",
  "menu_quality": "full",  # or "partial" per D-03
  "items": [
    {
      "wine_name": "PROSECCO",
      "producer": "OSVALDO",
      "vintage": None,
      "bottle_price": 52.0,   # from price_reference — D-04 do not invent
      "by_glass_price": 13.0,  # from price_glass
      "signature_hash": "ecc22918...",
      # ...region, country, grape_variety, primary_type
    }
  ],
}
```

### Pattern 2: Deterministic UUID + sim slug (ID strategy)
**What:** Live `restaurants.id` is UUID — do **not** use string PK `sim-bistro`. Use `uuid5` + `slug`.
**When to use:** Every sim restaurant / org id.
```python
# Source: live schema information_schema + scripts/seed_database.py uuid5 pattern
import uuid
SIM_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # or project-fixed NS

def sim_restaurant_id(archetype_id: str) -> str:
    return str(uuid.uuid5(SIM_NS, f"sim.restaurant.{archetype_id}"))

def sim_slug(archetype_id: str) -> str:
    return f"sim-{archetype_id}"  # teardown filter: slug LIKE 'sim-%'
```

### Pattern 3: Fail-closed atomic seed (D-10)
**What:** One `BEGIN … COMMIT` writing live rows + oracle facts; any failure → `ROLLBACK`.
**When to use:** Every `--apply` generate.
**Anti-pattern:** Fire-and-forget PostgREST inserts across tables (Nest `addToInventory` is non-fatal — do **not** copy that for sim seed).

### Pattern 4: Write-set ↔ teardown equality gate (D-11/D-12)
**What:** Single constant list; `--apply` for ≥2 archetypes aborts if gate fails.
```python
SYNTH_WRITE_SET = [
  "organizations",
  "organization_members",
  "restaurants",
  "users",  # mirror rows only — Auth users are NOT deleted
  "user_restaurant_access",
  "restaurant_menus",
  "menu_items",
  "restaurant_inventory",
  "master_wine_library",  # always in write-set; seed inserts provisional sim wines
  "master_wine_library_submissions",  # always in write-set when seed writes submissions
  "sim_ground_truth_facts",
  "sim_ground_truth_runs",
]
assert set(SYNTH_WRITE_SET) == set(TEARDOWN_TABLES)
# Teardown for library tables: sim-filtered only (source=sim / uuid5 sim.wine.*) — never wholesale wipe
```

### Anti-Patterns to Avoid
- **Inventing sell prices:** Violates D-04; leave null and flag `menu_quality=partial` if source missing price.
- **Forking a second teardown list** in CLI vs pytest (violates D-13).
- **Deleting Auth users or `e2e-test-restaurant`:** Personas are shared; anchor coexistence is mandatory.
- **Service-role as RLS proof:** SYNTHETIC-TENANT checklist — JWT path required for role isolation tests.
- **Live crawl in default generate:** Violates D-01.
- **String restaurant ids:** Live PK is UUID [VERIFIED: cloud].
- **Seeding `inventory_stock`:** Table absent in cloud; use `restaurant_inventory.stock_live` [VERIFIED: `to_regclass` null].

---

## Discretion Recommendations (planner may treat as defaults)

### URL → archetype mapping (D-06)

| Archetype ID | Display | Source restaurant | Snapshot seed | Rationale |
|--------------|---------|-------------------|---------------|-----------|
| `fine-dining` | Fine dining | BLVD Steakhouse | `20260406_blvd_steakhouse.jsonl` (56 SKUs, all priced) | Steakhouse / premium glass list |
| `bistro` | Bistro | The Tailors Son | `20260406_the_tailors_son.jsonl` (342 SKUs) | Deep wine-bar / bistro program |
| `high-volume-bar` | High-volume bar | Chicago Winery | `20260406_chicago_winery.jsonl` (113 SKUs) | Wine-forward volume venue |
| `cafe` | Cafe | The Albert Chicago | `20260406_the_albert_chicago.jsonl` (36 SKUs) | Small list ≈ cafe program depth |
| `turkish-clone` | Turkish restaurant clone | **Avli Taverna Lincoln Park** | Build via refresh from labeled pages / crawl; images already in `datasets/wine_menus/labels/train/Avli_*` | Only Turkish-forward asset in repo; not in `e2e_restaurants.json` — refresh required |

**Optional sixth skin (v1: skip):** Siena Tavern (`expect_image_menu: true`) as Vision-path regression snapshot — not a sixth live archetype unless SYNTH-05 bar is raised. [ASSUMED: v1 ships 5 named recipes only — within Claude's Discretion]

### Snapshot layout
`datasets/sim/menus/<archetype_id>.json` + `datasets/sim/archetypes/<archetype_id>.json` + `datasets/sim/manifest.json`.

### pnpm / API names
```json
"synth:refresh": "python3 -m scripts.synth refresh",
"synth:generate": "python3 -m scripts.synth generate",
"synth:teardown": "python3 -m scripts.synth teardown"
```
API (FastAPI): `POST /api/v1/admin/synth/refresh|generate|teardown` with `X-Admin-Key`, body `{ "archetype": "bistro"|"all", "apply": false }`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Menu HTML/PDF/Vision extract | Custom scraper | `WebCrawlerService` + existing extractors | Edge cases (robots, image menus, PDF) already handled |
| Auth user create | Raw SQL into `auth.users` | Supabase Auth Admin API (`setup_e2e_anchor.py`) | Password hashing / confirmation handled by Auth |
| Multi-table atomicity | Hope PostgREST succeeds | `psycopg2` transaction or SQL function | D-10 fail-closed |
| Role checks | Ad-hoc if email contains "staff" | Existing `TeamService.assertAccess` / `RolesGuard` | Staff already forbidden on manager actions [VERIFIED: team.service.ts] |
| UUID generation | Random UUIDs per run | `uuid5` from archetype id | Idempotent re-seed / teardown |
| Teardown discovery | Ad-hoc DELETE scripts | Shared `teardown.py` registry | Premortem C2 orphan risk |

**Key insight:** The hard parts are **transactional seed+oracle** and **write-set-equal teardown against UUID tenants** — not menu creativity.

---

## Runtime State Inventory

> Migration + cloud seed phase — runtime systems matter after code lands.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No `sim-*` restaurants in cloud today; no `sim_ground_truth*` tables [VERIFIED: SQL] | Migration for oracle tables; seed creates new rows |
| Live service config | Supabase Auth users for SIM_* do not exist yet; Phase 25 e2e Auth user may exist ops-side | Code creates/ensures 3 Auth users via Admin API; **do not delete** on teardown |
| OS-registered state | None — verified by no launchd/pm2 sim units in scope | none |
| Secrets/env vars | Need `SIM_OWNER_EMAIL/PASSWORD`, `SIM_MANAGER_*`, `SIM_STAFF_*`, plus existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `DATABASE_URL` for TX, `ADMIN_API_KEY` for API, crawl keys for refresh only | Document in `.env.example` names only; GitHub Actions secrets for CI apply |
| Build artifacts | `datasets/sim/` missing today; Phase 2 JSONL present under `datasets/restaurant_menus/` [VERIFIED] | Create sim pack from JSONL; commit snapshots |

**Nothing found / verified empty:** OS-registered sim state — None. Prior sim DB rows — None.

---

## Common Pitfalls

### Pitfall 1: Orphan production rows (Premortem C2)
**What goes wrong:** Seed writes tables not in teardown → silent cloud pollution; Phase 41 oracle diffs polluted.
**Why it happens:** Copying Phase 25’s 8-table `E2E_TABLES` without expanding to generator write-set; `inventory_stock` doesn’t even exist live.
**How to avoid:** D-11 gate; derive teardown from `SYNTH_WRITE_SET`; delete children by `restaurant_id IN (SELECT id FROM restaurants WHERE slug LIKE 'sim-%')` ordered FK-safe; never raise — Sentry `sim-orphan`.
**Warning signs:** `--apply` succeeds without gate test; table count drift between seed.py and teardown.py.

### Pitfall 2: Fail-open oracle (D-10)
**What goes wrong:** Live menu/inventory seeded but oracle insert fails → Phase 41 asserts against missing truth or worse, invents baseline from live rows.
**Why it happens:** Sequential PostgREST calls without transaction.
**How to avoid:** Single DB transaction; on oracle failure rollback entire seed; CLI exits non-zero.
**Warning signs:** Partial restaurants with empty `sim_ground_truth_runs`.

### Pitfall 3: Cloud secrets / JWT leakage (D-19)
**What goes wrong:** Passwords or JWTs in logs, JUnit, dry-run dumps, committed `.env`.
**Why it happens:** Debug prints of Auth responses; dry-run printing full user payloads.
**How to avoid:** Redact secrets; dry-run prints counts + slugs only; never write JWT to disk (SYNTHETIC-TENANT anti-pattern).
**Warning signs:** CI logs containing `eyJ` or password strings.

### Pitfall 4: Invented or null sell prices treated as truth
**What goes wrong:** Generator fills placeholder prices → Phase 41 “exact” KPIs are wrong vs real menu economics.
**Why it happens:** Some extracts lack `price_reference` / `price_glass` (e.g. Siena partial pricing).
**How to avoid:** D-04 — copy source prices only; null stays null; set `menu_quality=partial` when priced_sku_ratio < threshold (recommend <0.9).
**Warning signs:** Oracle `menu_price` facts with round numbers not in snapshot.

### Pitfall 5: UUID vs `sim-*` string confusion
**What goes wrong:** Inserts into `restaurants.id` with `sim-bistro` fail or corrupt FK assumptions; teardown `LIKE 'sim-%'` on UUID columns matches nothing.
**Why it happens:** SYNTHETIC-TENANT conceptual text assumed string restaurant ids (Phase 25 style).
**How to avoid:** UUID5 ids + **slug** prefix `sim-`; teardown resolves IDs via slug query first.
**Warning signs:** Seed errors “invalid input syntax for type uuid”.

### Pitfall 6: Staff shares manager credentials
**What goes wrong:** One Auth user with role flipped in URA — staff can obtain manager JWT by logging into shared account.
**Why it happens:** Convenience vs D-17.
**How to avoid:** Three Auth users; URA role per restaurant; test staff JWT → 403 on manager route (`listMembers` / invites).
**Warning signs:** Single `SIM_EMAIL` env var.

### Pitfall 7: Deleting shared Auth users on teardown
**What goes wrong:** Teardown removes SIM_* Auth users while other archetypes still need them.
**How to avoid:** Teardown deletes URA rows + restaurant subtree + oracle only; Auth users are durable fixtures (like e2e service account).

---

## Code Examples

### Archetype recipe shape (opening stock configurable — D-07)
```json
{
  "archetype_id": "bistro",
  "display_name": "Casual Bistro",
  "snapshot": "datasets/sim/menus/bistro.json",
  "defaults": {
    "cuisine": "italian-american",
    "size": "medium",
    "wine_program_depth": "deep",
    "sales_volume": "medium",
    "price_tier": "mid",
    "ordering_rhythm": "twice_weekly"
  },
  "opening_stock": {
    "default_bottles": 12,
    "min_bottles": 2,
    "max_bottles": 36,
    "by_price_tier": { "entry": 24, "mid": 12, "premium": 6 },
    "by_primary_type": { "sparkling": 18, "red": 12, "white": 12 },
    "threshold_min": 5
  },
  "restaurant": {
    "name": "Sim Bistro",
    "timezone": "America/Chicago",
    "city": "Chicago",
    "country": "USA"
  }
}
```

### Seed write-set (Nest/DB-aligned columns)
```python
# restaurants: id=uuid5, slug='sim-bistro', organization_id=..., name, timezone, city, country, default_threshold_min
# restaurant_menus: restaurant_id, name='Wine List', menu_type='beverage', status='active'
# menu_items: name, producer, vintage, region, country, grape_variety,
#             bottle_price=snapshot.bottle_price, by_glass_price=snapshot.by_glass_price,
#             wine_library_id=..., source='manual', status='approved'
# restaurant_inventory: restaurant_id, master_wine_id, wine_name, stock_live=opening, threshold_min, custom_price=bottle_price, is_active=true
# user_restaurant_access: user_id, restaurant_id, role in ('owner','manager','staff'), is_active=true
```
[VERIFIED: live columns for `menu_items`, `restaurant_inventory`, `user_restaurant_access`; Nest `menus.service.ts` PRICE_FIELDS]

### Auth persona ensure (D-17..D-19)
```python
# Source pattern: services/agent-orchestrator/scripts/setup_e2e_anchor.py
# POST {SUPABASE_URL}/auth/v1/admin/users with service role
# email_confirm=True; on 422 already registered → OK (idempotent)
# Then upsert public.users (user_id=auth id, email, name, role) — no password logged
# Then upsert URA for each sim restaurant_id with distinct roles
```

### Teardown sweep (shared)
```python
def teardown_sim(conn, sentry_dsn=None):
    try:
        ids = fetch_sim_restaurant_ids(conn)  # WHERE slug LIKE 'sim-%'
        # FK-safe order: facts → inventory → menu_items → menus → ura → restaurants → orgs (if sim-only)
        # NEVER delete restaurants where slug = 'e2e-test-restaurant' or id known anchor
        # NEVER delete auth.users for SIM_* personas
    except Exception as exc:
        capture_sim_orphan(exc)  # NEVER raise
```

### Ground-truth schema (recommended — D-08/D-09)
```sql
-- Source: designed for Phase 41 KPI exactness (ROADMAP Phase 41 success criteria)
CREATE TABLE IF NOT EXISTS sim_ground_truth_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  archetype_id TEXT NOT NULL,
  seed_version TEXT NOT NULL,
  menu_quality TEXT NOT NULL CHECK (menu_quality IN ('full', 'partial')),
  snapshot_path TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  params JSONB NOT NULL,           -- cuisine, size, wine_program_depth, sales_volume, price_tier, ordering_rhythm
  sku_count INTEGER NOT NULL,
  priced_sku_count INTEGER NOT NULL,
  seeded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id)           -- one active oracle run per sim restaurant (re-seed replaces in TX)
);

CREATE TABLE IF NOT EXISTS sim_ground_truth_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES sim_ground_truth_runs(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL CHECK (fact_type IN (
    'profile', 'roster', 'sku', 'menu_price', 'opening_stock', 'menu_quality_meta'
  )),
  sku_key TEXT,                    -- signature_hash when applicable
  entity_ref JSONB NOT NULL DEFAULT '{}',
  payload JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sim_gt_facts_rest_type
  ON sim_ground_truth_facts (restaurant_id, fact_type);
CREATE INDEX IF NOT EXISTS idx_sim_gt_facts_run_sku
  ON sim_ground_truth_facts (run_id, fact_type, sku_key);

ALTER TABLE sim_ground_truth_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_ground_truth_facts ENABLE ROW LEVEL SECURITY;
-- Service-role for seed/teardown/Phase 41 CI; no anon write policies.
```

**Payload contracts (Phase 41-ready):**
- `opening_stock`: `{ "stock_live": 12, "threshold_min": 5, "wine_name": "...", "master_wine_id": "..." }`
- `menu_price`: `{ "bottle_price": 52.0, "by_glass_price": 13.0, "currency": "USD" }`
- `roster`: `{ "role": "staff", "user_id": "...", "email_domain": "wineops.internal" }` — never password
- `sku`: `{ "signature_hash": "...", "name": "...", "producer": "...", "vintage": "..." }`
- `profile`: full SYNTH-01 params echo

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 25 string `e2e-test-restaurant` + `inventory_stock` | UUID restaurants + `restaurant_inventory` | Schema evolution 2026; confirmed live 2026-07-27 | Phase 37 must not copy E2E_TABLES verbatim as write-set |
| Live crawl every test | Frozen `datasets/sim` snapshots | Phase 37 D-01 | CI deterministic |
| Tagged app rows as truth | Dedicated `sim_ground_truth*` | Phase 37 D-08 | Phase 41 exact asserts |
| Single e2e Auth developer user | Three role-isolated SIM users | Phase 37 D-17 | Staff≠manager JWT |

**Deprecated/outdated:**
- Assuming `restaurants.id` can be non-UUID text for sim tenants
- Treating `E2E_TABLES` (8 tables) as sufficient for multi-archetype seed
- Nest `addToInventory` non-fatal pattern for sim opening stock (must set `stock_live` explicitly)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | v1 ships 5 named recipes only (no parameter-skin variants) | Discretion | Extra plan tasks if user wants skins in v1 |
| A2 | Avli Taverna is Turkish clone source | Mapping | **RESOLVED** — locked Avli |
| A3 | Prefer `seed_sim_restaurant` RPC for atomic seed | Atomic seed | **RESOLVED** — RPC primary; DSN secondary |
| A4 | Priced ratio &lt; 0.9 ⇒ `menu_quality=partial` threshold | Pitfall 4 | Adjust threshold after first refresh |
| A5 | Provisional `master_wine_library` always in write-set; teardown sim-filtered | Write-set | **RESOLVED** — 37-03 handlers required |

**If A3 were wrong (historical):** Prefer SECURITY DEFINER `seed_sim_restaurant` — now the locked primary path.

---

## Open Questions (RESOLVED)

1. **Transactional transport: psycopg2 DSN vs RPC?** — **RESOLVED**
   - **Lock:** Prefer `seed_sim_restaurant(payload jsonb)` SECURITY DEFINER RPC as the primary fail-closed atomic TX for live seed + oracle (D-10). Do **not** use multi-call PostgREST as the apply path.
   - Optional `DATABASE_URL` / psycopg2 path is secondary only (same payload builder); never DSN-only as the sole plan.
   - Plans: 37-02 Task 1/3.

2. **Turkish clone final URL?** — **RESOLVED**
   - **Lock:** Turkish archetype = **Avli Taverna Lincoln Park** (RESEARCH default mapping). Bootstrap from Avli PDF/images / refresh crawl; `menu_quality=partial` OK (D-03).
   - Plans: 37-01 Task 3.

3. **Should generator insert into `master_wine_library` or only link existing?** — **RESOLVED**
   - **Lock:** Generator **does** insert provisional wines with deterministic UUID5 ids (`sim.wine.*`) and/or metadata `source=sim`.
   - `master_wine_library` + `master_wine_library_submissions` are **always** members of `SYNTH_WRITE_SET` / `TEARDOWN_TABLES` (not "if used").
   - Teardown deletes **sim-filtered only** (provisional/sim-tagged / UUID5 under `sim.wine.*`) — **never** wipe the shared library wholesale.
   - Plans: 37-01 write_set; 37-02 seed; 37-03 teardown Task 1.

4. **Phase 25 `e2e-test-restaurant` anchor absent from live restaurants list** — **RESOLVED**
   - **Lock:** Teardown **always** hard-guards never-delete for `e2e-test-restaurant` (slug/id), whether or not the row is present in cloud. Do not block Phase 37 on anchor presence.
   - Plans: 37-03 Task 1.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.11 | Generator CLI | ✓ | 3.11.0 | — |
| pnpm | Root scripts | ✓ | 9.15.9 | `python3 -m scripts.synth` direct |
| supabase-py | Seed | ✓ | 2.28.0 | — |
| Playwright | Snapshot refresh | ✓ (CLI present) | installed | Skip refresh; use existing JSONL → sim pack |
| Cloud Supabase `exzueerziesmczwlhomd` | Seed/teardown | ✓ ACTIVE_HEALTHY | PG 17.6 | — |
| `SUPABASE_SERVICE_ROLE_KEY` / SIM_* secrets | `--apply` | ✗ not probed in session | — | Dry-run only until secrets set |
| `DATABASE_URL` | Atomic TX | ? | — | SQL RPC fallback (A3) |
| Crawl API keys (Gemini/Claude) | `synth:refresh` | ? | — | Bootstrap sim pack from existing JSONL without refresh |

**Missing dependencies with no fallback:**
- Cloud `--apply` blocked without service-role + SIM_* secrets (document; do not invent)

**Missing dependencies with fallback:**
- Refresh API keys → build v1 snapshots from `datasets/restaurant_menus/20260406_*.jsonl`
- DATABASE_URL → SECURITY DEFINER seed RPC

---

## Validation Architecture

> `workflow.nyquist_validation` is **true** in `.planning/config.json` [VERIFIED].

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 7.4.4 (+ pytest-asyncio) |
| Config file | `services/agent-orchestrator/pytest.ini` |
| Quick run command | `cd services/agent-orchestrator && pytest tests/test_synth_write_set_gate.py tests/test_synth_recipes.py -q` |
| Full suite command | `cd services/agent-orchestrator && pytest tests/test_synth_*.py -q` |
| Nest (optional) | `pnpm --filter api-gateway test -- --testPathPattern=synth` only if Nest wrappers added (not required) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNTH-01 | Recipe loads defaults + overrides → profile dict | unit | `pytest tests/test_synth_recipes.py -q` | ❌ Wave 0 |
| SYNTH-02 | Generate reads snapshot only (no network mock) | unit | `pytest tests/test_synth_snapshots.py -q` | ❌ Wave 0 |
| SYNTH-02 | Refresh writes `datasets/sim/menus/*.json` schema | unit | `pytest tests/test_synth_snapshot_schema.py -q` | ❌ Wave 0 |
| SYNTH-03 | Dry-run plan lists write-set tables/rows counts | unit | `pytest tests/test_synth_seed_plan.py -q` | ❌ Wave 0 |
| SYNTH-03 | Staff role ≠ manager in URA fixture mapping | unit | `pytest tests/test_synth_auth_personas.py -q` | ❌ Wave 0 |
| SYNTH-04 | Oracle fact types include opening_stock, menu_price, roster, sku | unit | `pytest tests/test_synth_oracle_schema.py -q` | ❌ Wave 0 |
| SYNTH-04 | Seed aborts when oracle insert fails (TX rollback) | unit/integration | `pytest tests/test_synth_atomic_seed.py -q` | ❌ Wave 0 |
| SYNTH-05 | ≥5 archetype configs present + mapped snapshots | unit | `pytest tests/test_synth_archetypes_present.py -q` | ❌ Wave 0 |
| D-11 gate | `--apply` multi-archetype refused if write-set ≠ teardown | unit | `pytest tests/test_synth_write_set_gate.py -q` | ❌ Wave 0 |
| D-13 | Teardown never raises + skips e2e anchor | unit | `pytest tests/test_synth_teardown_safety.py -q` | ❌ Wave 0 |
| D-16 | Default CLI is dry-run (no apply without flag) | unit | `pytest tests/test_synth_cli_defaults.py -q` | ❌ Wave 0 |
| D-17 | Staff JWT cannot call manager-gated path | integration/manual-cloud | `pytest tests/e2e/test_synth_role_isolation.py -m prod_e2e` | ❌ Wave 0 (needs secrets) |

### Sampling Rate
- **Per task commit:** quick synth unit tests above
- **Per wave merge:** full `tests/test_synth_*.py`
- **Phase gate:** Full synth suite green + dry-run generate for all 5 archetypes; `--apply` only with secrets + gate green

### Wave 0 Gaps
- [ ] `services/agent-orchestrator/tests/test_synth_write_set_gate.py` — covers D-11/D-12
- [ ] `services/agent-orchestrator/tests/test_synth_recipes.py` — SYNTH-01
- [ ] `services/agent-orchestrator/tests/test_synth_snapshots.py` — SYNTH-02 replay/no-network
- [ ] `services/agent-orchestrator/tests/test_synth_oracle_schema.py` — SYNTH-04 fact types
- [ ] `services/agent-orchestrator/tests/test_synth_atomic_seed.py` — D-10 fail-closed (sqlite or mocked conn OK)
- [ ] `services/agent-orchestrator/tests/test_synth_archetypes_present.py` — SYNTH-05
- [ ] `services/agent-orchestrator/tests/test_synth_teardown_safety.py` — never-raise + anchor guard
- [ ] `scripts/synth/write_set.py` shared module imported by tests + CLI + conftest
- [ ] Migration file for `sim_ground_truth_*` (implementation wave, but schema tests can use SQL fixtures)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth Admin create + password grant; distinct SIM_* users |
| V3 Session Management | yes | JWT via password grant for isolation tests; never log/store JWT |
| V4 Access Control | yes | URA roles + Nest `assertAccess` / `RolesGuard`; staff denied manager |
| V5 Input Validation | yes | Pydantic for recipes/API body; archetype_id allowlist |
| V6 Cryptography | no new | Auth handles password hashes — never hand-roll |
| V7 Error Handling | yes | Teardown never raises; Sentry `sim-orphan` |
| V10 Malicious Inputs | yes | Admin API requires `X-Admin-Key`; dry-run default |

### Known Threat Patterns for synthetic cloud seed

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Production tenant wipe via teardown | Tampering / DoS | `slug LIKE 'sim-%'` only; hard-exclude e2e anchor; dry-run default |
| Privilege escalation staff→manager | Elevation | Distinct Auth users; URA role checks; automated 403 test |
| Secret exfiltration in CI logs | Information disclosure | Redaction; env-only secrets; never print passwords/JWTs |
| Oracle spoofing via service-role from web | Spoofing | No client access to seed routes; Admin key server-side only |
| Library pollution / orphan wines | Tampering | Include provisional wines in write-set teardown |

---

## Sources

### Primary (HIGH confidence)
- Live Supabase `exzueerziesmczwlhomd` via MCP `execute_sql` — `restaurants.id` UUID; no `inventory_stock`; no `sim_ground_truth*`; URA columns; menu_items/restaurant_inventory columns (2026-07-27)
- `.planning/phases/37-synthetic-restaurant-engine/37-CONTEXT.md` — D-01..D-19
- `.planning/testing/SYNTHETIC-TENANT.md` — sim convention, E2E_TABLES gap, hard gate
- `.planning/phases/36-testing-foundation-functionality-registry/36-PREMORTEM.md` — C2 orphan risk
- `scripts/e2e_restaurants.json` + `datasets/restaurant_menus/20260406_*.jsonl` — SKU/price counts
- `services/agent-orchestrator/services/web_crawler.py` — crawl + persist entrypoints
- `services/agent-orchestrator/tests/e2e/conftest_prod.py` — teardown never-raise, E2E_TABLES
- `services/agent-orchestrator/scripts/setup_e2e_anchor.py` — Auth Admin pattern
- `apps/api-gateway/src/menus/menus.service.ts` — menu_items + inventory seed columns
- `apps/api-gateway/src/team/team.service.ts` — staff denied for manager
- `supabase/migrations/20260726135000_menu_onboarding_catchup.sql` — restaurant_menus / menu_items
- `.planning/config.json` — nyquist_validation true

### Secondary (MEDIUM confidence)
- Phase 25 RESEARCH/plans — e2e string-id paradigm (superseded for sim UUID strategy but teardown ethics still apply)
- ROADMAP Phase 41 success criteria — drives oracle fact richness

### Tertiary (LOW confidence)
- Avli as Turkish clone URL — **RESOLVED** (locked Avli; see Open Questions)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against repo pins + local installs + live DB
- Architecture: HIGH — constrained by locked CONTEXT + confirmed schema gaps
- Pitfalls: HIGH — premortem C2 + live schema mismatches are concrete

**Research date:** 2026-07-27
**Valid until:** 2026-08-27 (30 days; re-verify cloud schema if migrations land)

---

## RESEARCH COMPLETE

**Phase:** 37 - Synthetic Restaurant Engine
**Confidence:** HIGH

### Key Findings
- Live cloud uses **UUID** `restaurants.id` and **`restaurant_inventory`** (not `inventory_stock`); sim tenants must use UUID5 + `slug LIKE 'sim-%'` for teardown.
- Bootstrap snapshots from existing Phase 2 JSONL (754 SKUs); generator always replays `datasets/sim/`; refresh is explicit.
- Seed write-set = org + restaurant + users/URA + menus/items + inventory + `sim_ground_truth_runs/facts`; gate `--apply` until teardown equals this set.
- Atomic SQL transaction required for D-10; PostgREST-only multi-insert is fail-open.
- Three Auth personas via Admin API + URA; staff already blocked by Nest manager gates — prove with JWT test.

### File Created
`.planning/phases/37-synthetic-restaurant-engine/37-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Repo + registry + live DB verified |
| Architecture | HIGH | Locked decisions + concrete write-set |
| Pitfalls | HIGH | Premortem C2 + schema drift confirmed |

### Open Questions
All four prior open questions are **RESOLVED** (see `## Open Questions (RESOLVED)`): RPC preferred; Avli Turkish; sim-filtered library teardown always in write-set; e2e anchor always hard-guarded.

### Ready for Planning
Research complete. Planner can now create PLAN.md files.
