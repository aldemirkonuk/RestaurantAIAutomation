# Phase 37: Synthetic Restaurant Engine - Pattern Map

**Mapped:** 2026-07-27
**Files analyzed:** 18
**Analogs found:** 17 / 18

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `datasets/sim/menus/<archetype>.json` | config | file-I/O | `datasets/restaurant_menus/20260406_*.jsonl` + `web_crawler._persist_crawled_wines` | exact |
| `datasets/sim/archetypes/<archetype>.json` | config | transform | `scripts/e2e_restaurants.json` | role-match |
| `datasets/sim/manifest.json` | config | file-I/O | `scripts/e2e_restaurants.json` (pack index) | partial |
| `scripts/synth/__main__.py` + `cli.py` | utility | request-response | `scripts/e2e_crawl_harness.py` + root `package.json` `db:seed` | exact |
| `scripts/synth/recipes.py` | utility | transform | RESEARCH recipe shape + `e2e_restaurants.json` loader | role-match |
| `scripts/synth/snapshots.py` | service | file-I/O | `web_crawler._persist_crawled_wines` + `e2e_crawl_harness.py` | exact |
| `scripts/synth/ids.py` | utility | transform | `scripts/seed_database.py` uuid5 constants | exact |
| `scripts/synth/auth_personas.py` | service | request-response | `setup_e2e_anchor.py` Auth Admin | exact |
| `scripts/synth/seed.py` | service | CRUD / batch | Nest `menus.service` columns + `seed_database.py` upserts — **TX via psycopg2/RPC (not PostgREST)** | role-match |
| `scripts/synth/write_set.py` | utility | transform | `conftest_prod.py` `E2E_TABLES` registry | exact |
| `scripts/synth/teardown.py` | service | batch | `conftest_prod.py` `teardown_e2e_records` | exact |
| `tests/e2e/conftest_prod.py` (extend) | middleware | event-driven | self — import shared `teardown.py` | exact |
| `api/synth_routes.py` | route | request-response | `api/health_routes.py` + `api/research_routes.py` | exact |
| `supabase/migrations/*_sim_ground_truth.sql` | migration | CRUD | `20260726135000_menu_onboarding_catchup.sql` + `20260514200000_phase33_ura_membership.sql` | exact |
| `package.json` (`synth:*`) | config | request-response | `package.json` `db:seed` / `agents:test` | exact |
| `tests/test_synth_*.py` | test | request-response | `tests/test_health_routes.py` | role-match |
| Nest org/restaurant/menu **column contracts** (reference only — no Nest seed CLI) | service | CRUD | `organizations.service.ts`, `menus.service.ts`, `members.service.ts`, `team.service.ts` | exact |
| Optional `seed_sim_restaurant()` RPC | migration | CRUD | `20260710120300_phase2_multilocation_transfer.sql` SECURITY DEFINER fn | role-match |

---

## Pattern Assignments

### `datasets/sim/menus/<archetype>.json` (config, file-I/O)

**Analog:** `services/agent-orchestrator/services/web_crawler.py` + Phase 2 JSONL

**Core persist record shape** (lines 550–580):
```python
record = {
    "wine_name": wine_name,
    "producer": producer,
    "vintage": vintage,
    "primary_type": primary_type,
    "country": country,
    "region": region,
    "grape_variety": grape_variety,
    "price_reference": price_reference,  # → bottle_price (D-04: never invent)
    "price_glass": price_glass,          # → by_glass_price
    "signature_hash": signature_hash,
    "data_enrichment": {
        "source_url": source_url,
        "source_type": source_type,
        "restaurant_name": restaurant_name,
        "crawled_at": crawled_at,
        "extraction_model": wine.get("extraction_model", "gemini-2.5-flash"),
    },
}
```

**Verified live SKU example** (`datasets/restaurant_menus/20260406_the_tailors_son.jsonl`):
```json
{
  "wine_name": "PROSECCO",
  "producer": "OSVALDO",
  "price_reference": 52.0,
  "price_glass": 13.0,
  "signature_hash": "ecc229189c289f9197422fd911100b0d",
  "primary_type": "sparkling"
}
```

**Copy for Phase 37:** Wrap JSONL rows into frozen snapshot envelope `{ archetype_id, source_url, menu_quality, items: [...] }`. Map `price_reference`→`bottle_price`, `price_glass`→`by_glass_price`. Null prices stay null; set `menu_quality=partial` when priced ratio &lt; 0.9.

---

### `datasets/sim/archetypes/<archetype>.json` + `manifest.json` (config, transform)

**Analog:** `scripts/e2e_restaurants.json`

**Pack index pattern** (entire file):
```json
[
  {"name": "The Tailors Son", "url": "https://www.thetailorssonsf.com/menus/#wine-beer"},
  {"name": "Chicago Winery", "url": "https://www.chiwinery.com/menu/wine/"},
  {"name": "BLVD Steakhouse", "url": "https://www.blvdchicago.com/menu/wine-by-the-glass/"},
  {"name": "The Albert Chicago", "url": "https://thealbertchicago.com/beverage/"},
  {"name": "Siena Tavern", "url": "https://sienatavern.com/menus/", "expect_image_menu": true}
]
```

**Copy for Phase 37:** Same 1-URL→1-archetype mapping style; extend with `snapshot`, `defaults`, `opening_stock` per RESEARCH recipe shape. `manifest.json` = pack version + sha256 per snapshot (no existing manifest analog — invent from this index pattern).

---

### `scripts/synth/cli.py` + `__main__.py` + `package.json` synth scripts (utility, request-response)

**Analog A — dry-run default CLI:** `scripts/e2e_crawl_harness.py` (lines 8–12, 221–247, 382–407)

```python
# Dry-run when secrets missing — no network / no mutations
If GOOGLE_API_KEY is not set, the script runs in dry-run mode...

parser = argparse.ArgumentParser(description="Phase 2 E2E crawl harness")
parser.add_argument("--config", default=str(PROJECT_ROOT / "scripts" / "e2e_restaurants.json"), ...)
```

**Analog B — pnpm → Python:** root `package.json` lines 26–31:
```json
"db:seed": "python3 scripts/seed-database.py --environment local",
"agents:test": "cd services/agent-orchestrator && source venv/bin/activate && pytest"
```

**Copy for Phase 37:**
```json
"synth:refresh": "python3 -m scripts.synth refresh",
"synth:generate": "python3 -m scripts.synth generate",
"synth:teardown": "python3 -m scripts.synth teardown"
```
CLI: default dry-run; mutations require explicit `--apply` (D-16). Prefer `--apply` over inverting `--dry-run` so accidents are safe.

---

### `scripts/synth/snapshots.py` (service, file-I/O)

**Analog:** `WebCrawlerService.crawl_restaurant` (lines 162–279) + `_persist_crawled_wines` (453–588) + `e2e_crawl_harness.py` path setup

**Imports / path bootstrap** (`e2e_crawl_harness.py` 29–35):
```python
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "services" / "agent-orchestrator"))
MENUS_DIR = PROJECT_ROOT / "datasets" / "restaurant_menus"
```

**Refresh entrypoint** — call `crawl_restaurant(website_url, restaurant_name)`, then adapt `_persist_crawled_wines` output into `datasets/sim/menus/<id>.json` (not append-only JSONL).

**Generate path:** read frozen JSON only — never call Playwright/Gemini (D-01).

---

### `scripts/synth/ids.py` (utility, transform)

**Analog:** `scripts/seed_database.py` lines 42–48

```python
import uuid
PROVIDER_NAPA_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "Napa Valley Wine Distributors"))
LOC_MAIN_CELLAR = str(uuid.uuid5(uuid.NAMESPACE_DNS, "storage-main-cellar"))
```

**Copy for Phase 37 (adapt for live UUID PK + slug filter):**
```python
SIM_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # fixed project NS

def sim_restaurant_id(archetype_id: str) -> str:
    return str(uuid.uuid5(SIM_NS, f"sim.restaurant.{archetype_id}"))

def sim_slug(archetype_id: str) -> str:
    return f"sim-{archetype_id}"  # teardown: WHERE slug LIKE 'sim-%'
```

**Anti-pattern:** Do **not** copy `setup_e2e_anchor.py` string id `"e2e-test-restaurant"` into `restaurants.id` — live PK is UUID.

---

### `scripts/synth/auth_personas.py` (service, request-response)

**Analog:** `services/agent-orchestrator/scripts/setup_e2e_anchor.py` lines 29–116

**Env gate** (37–45):
```python
REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "E2E_TEST_EMAIL", "E2E_TEST_PASSWORD"]

def check_env() -> dict:
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        print(f"ERROR: Missing required environment variables: {missing}", file=sys.stderr)
        sys.exit(1)
    return {k: os.environ[k] for k in REQUIRED_ENV}
```

**Auth Admin create + idempotent 422** (81–116):
```python
url = f"{supabase_url}/auth/v1/admin/users"
headers = {
    "apikey": service_role_key,
    "Authorization": f"Bearer {service_role_key}",
    "Content-Type": "application/json",
}
payload = {
    "email": email,
    "password": password,
    "email_confirm": True,
    "app_metadata": {"roles": ["developer"]},
    "user_metadata": {"full_name": "E2E Test Service Account (Phase 25)"},
}
resp = httpx.post(url, json=payload, headers=headers, timeout=30.0)
if resp.status_code in (200, 201):
    ...
elif resp.status_code == 422 and ("already registered" in resp.text.lower() ...):
    print(f"✓ {email} already exists (idempotent — no action needed)")
```

**JWT for role-isolation tests** — copy `conftest_prod.py` `prod_jwt` (124–169): password grant, never log `access_token`.

**URA insert columns** — copy `members.service.ts` (243–251):
```typescript
.insert({
  user_id: targetUser.user_id,
  restaurant_id: restaurantId,
  role,  // 'owner' | 'manager' | 'staff'
  invited_via: null,
  is_active: true,
})
```

**Do NOT copy** `seed_database.seed_managers` bcrypt into Auth — passwords via Auth Admin only (D-19). Mirror `public.users` row without logging secrets.

**Role isolation assert** — copy `team.service.ts` `assertAccess` (38–60): staff forbidden when `required === "manager"`.

---

### `scripts/synth/seed.py` (service, CRUD / batch)

**Analog (column contracts):** Nest menus + orgs + seed_database  
**Analog (atomicity):** RESEARCH Pattern 3 — **psycopg2 TX or SECURITY DEFINER RPC** (no existing multi-table seed TX in Python; closest SQL fn: `transfer_stock` migration)

**Restaurant upsert columns** (`seed_database.py` 148–175) + **createLocation** (`organizations.service.ts` 477–492):
```python
# Combine: deterministic uuid5 id + sim-* slug + org link
{
  "id": sim_restaurant_id(archetype_id),  # UUID string
  "name": "...",
  "slug": f"sim-{archetype_id}",
  "organization_id": org_id,
  "city": "...",
  "country": "...",
  "timezone": "America/Chicago",
  "default_threshold_min": opening_stock.threshold_min,
  "cuisine_type": params.cuisine,
}
```

**menu_items insert** (`menus.service.ts` 276–303) — **fail closed** (throw on error):
```typescript
const menuItemRows = resolved.map(({ item, masterWineId }) => ({
  menu_id: menuId,
  restaurant_id: restaurantId,
  name: item.name,
  producer: item.producer ?? null,
  vintage: item.vintage ?? null,
  region: item.region ?? null,
  grape_variety: item.grape_variety ?? null,
  by_glass_price: item.by_glass_price ?? null,
  bottle_price: item.bottle_price ?? null,
  wine_library_id: masterWineId,
  source: method,           // use 'manual' or extend CHECK for 'sim'
  status: "approved",
}));
```

**restaurant_inventory** (`menus.service.ts` 441–474) — **anti-pattern to avoid for sim:**
```typescript
// Nest addToInventory: non-fatal warn + continue — DO NOT copy for D-10 / opening stock
this.logger.warn(`inventory seeding failed... (non-fatal)`);
continue;
```
Sim seed must set `stock_live` from archetype `opening_stock` and fail the TX if inventory insert fails.

**Schema table names** (`20260726135000_menu_onboarding_catchup.sql` 16–61): `restaurant_menus`, `menu_items` (not legacy names). Stock table = `restaurant_inventory` (not `inventory_stock`).

---

### `scripts/synth/write_set.py` + `teardown.py` (utility + service, batch)

**Analog:** `conftest_prod.py` lines 217–287

**Never-raise teardown + Sentry orphan tag:**
```python
# CRITICAL: NEVER raise. All teardown failures go to Sentry with e2e-orphan:true.
# The anchor record (id='e2e-test-restaurant') is NEVER deleted.
yield
...
except Exception as exc:
    failed_deletes.append({...})
if failed_deletes and _sentry_dsn:
    sentry_sdk.capture_message(
        "E2E teardown: orphaned records could not be deleted",
        level="warning",
        tags={"e2e-orphan": "true"},
        extra={"orphaned_records": failed_deletes},
    )
```

**Table registry pattern** (251–260) — extend, don't fork:
```python
E2E_TABLES = [
    "inventory_stock",  # NOTE: absent in live cloud — do NOT carry into SYNTH_WRITE_SET
    "notification_deliveries",
    ...
]
```

**Phase 37 adaptations:**
1. Single shared module: `SYNTH_WRITE_SET == TEARDOWN_TABLES` (D-11/D-12).
2. Resolve IDs via `restaurants.slug LIKE 'sim-%'` (not `restaurant_id = 'e2e-test-restaurant'`).
3. Tag Sentry `sim-orphan` (not only `e2e-orphan`).
4. Hard-exclude e2e anchor slug/id forever.
5. Never delete Auth users for SIM_* personas.
6. Import from `conftest_prod` session teardown OR have conftest call `teardown_sim()` — one list only (D-13).

---

### `api/synth_routes.py` (route, request-response)

**Analog:** `api/health_routes.py` `verify_admin_key` (39–50) + `api/research_routes.py` POST trigger (35–42, 520–538)

**Auth:**
```python
def verify_admin_key(x_admin_key: Optional[str] = Header(None)) -> str:
    expected = os.getenv("ADMIN_API_KEY", "")
    if not x_admin_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    if not expected or x_admin_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    return x_admin_key
```

**POST body validation** — copy Pydantic `TriggerRequest` style:
```python
class SynthGenerateRequest(BaseModel):
    archetype: str = Field(default="all")  # allowlist in handler
    apply: bool = Field(default=False)     # D-16: dry-run default
```

**Router registration** — copy `main.py` include pattern (130–160):
```python
from api.synth_routes import router as synth_router
app.include_router(synth_router)
```

**Thin wrapper:** routes call `scripts.synth` functions (refresh/generate/teardown); do not reimplement seed logic in Nest.

**Tests:** copy `tests/test_health_routes.py` — 401 without key, 200 with key, monkeypatch `ADMIN_API_KEY`.

---

### `supabase/migrations/*_sim_ground_truth.sql` (migration, CRUD)

**Analog A — CREATE TABLE IF NOT EXISTS + RLS:** `20260726135000_menu_onboarding_catchup.sql` (16–119)

```sql
CREATE TABLE IF NOT EXISTS restaurant_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  ...
);
ALTER TABLE restaurant_menus ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE ...) THEN
    CREATE POLICY ...;
  END IF;
END $$;
```

**Analog B — URA extend / membership:** `20260514200000_phase33_ura_membership.sql` (idempotent ALTER + RLS).

**Analog C — transactional RPC fallback:** `20260710120300_phase2_multilocation_transfer.sql` `CREATE OR REPLACE FUNCTION ... BEGIN ... END` if `DATABASE_URL` unavailable (RESEARCH A3).

**Oracle schema:** follow RESEARCH recommended `sim_ground_truth_runs` + `sim_ground_truth_facts` (service-role only; enable RLS, no anon write policies).

---

### Nest column / role references (no new Nest seed module)

| Concern | Analog | Lines / pattern |
|---------|--------|-----------------|
| Org + location create | `organizations.service.ts` | `createLocation` 426–498 — slug, city, timezone, organization_id |
| URA membership | `members.service.ts` | insert URA + org_members upsert 243–266 |
| Staff≠manager | `team.service.ts` | `assertAccess` 38–60; `listMembers` manager-gated 86–88 |
| Menu + inventory columns | `menus.service.ts` | PRICE_FIELDS, menu_items insert, restaurant_inventory |
| Org schema | `20260506000000_organizations.sql` | organizations + organization_members role CHECK |

---

## Shared Patterns

### Authentication (Auth Admin + JWT)
**Source:** `setup_e2e_anchor.py` + `conftest_prod.py` `prod_jwt`  
**Apply to:** `auth_personas.py`, role-isolation tests, never CLI dry-run dumps  
```python
# Create: POST /auth/v1/admin/users + email_confirm=True; 422 already-registered = OK
# Prove: POST /auth/v1/token?grant_type=password — never log access_token
# Env: SIM_OWNER_EMAIL/PASSWORD, SIM_MANAGER_*, SIM_STAFF_* (never commit)
```

### Admin API gate
**Source:** `health_routes.verify_admin_key` / `research_routes.verify_admin_token`  
**Apply to:** all `synth_routes` endpoints  
```python
Depends(verify_admin_key)  # X-Admin-Key == ADMIN_API_KEY
```

### Deterministic IDs
**Source:** `seed_database.py` uuid5  
**Apply to:** restaurants, orgs, provisional wines  
```python
str(uuid.uuid5(SIM_NS, f"sim.restaurant.{archetype_id}"))
```

### Teardown never-raise + orphan Sentry
**Source:** `conftest_prod.py` teardown_e2e_records  
**Apply to:** `teardown.py`, pytest session hook, `pnpm synth:teardown`  
```python
tags={"sim-orphan": "true"}  # extend e2e-orphan pattern
# NEVER delete e2e-test-restaurant / Auth SIM users
```

### Fail-closed seed (D-10)
**Source:** Nest `menu_items` insert throws; **anti-source:** Nest `addToInventory` non-fatal  
**Apply to:** `seed.py` — single SQL transaction for live write-set + oracle; rollback on any failure

### Validation
**Source:** FastAPI Pydantic (`research_routes.TriggerRequest`) + harness schema checks (`e2e_crawl_harness.validate_schema`)  
**Apply to:** recipe loader, snapshot schema, API bodies, archetype allowlist

### Dry-run safety (D-16)
**Source:** `e2e_crawl_harness` dry-run when key missing  
**Apply to:** CLI default + API `apply: false` default; dry-run prints counts/slugs only (no secrets)

---

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| `datasets/sim/manifest.json` sha256 pack index | config | file-I/O | No existing content-addressed dataset manifest; invent from `e2e_restaurants.json` + RESEARCH |
| Multi-table atomic seed in Python | service | CRUD | PostgREST seeds are sequential; use new `psycopg2` TX or SECURITY DEFINER RPC (A3) — SQL fn style exists (`transfer_stock`) but no sim seed RPC yet |

---

## Anti-Patterns (do not copy)

| Anti-pattern | Source | Why |
|--------------|--------|-----|
| String `restaurants.id = "e2e-test-restaurant"` | `setup_e2e_anchor.py` | Live PK is UUID |
| `E2E_TABLES` including `inventory_stock` | `conftest_prod.py` | Table absent in cloud; use `restaurant_inventory` |
| Non-fatal inventory insert | `menus.service.addToInventory` | Violates D-10 for sim |
| bcrypt `users.password_hash` as Auth | `seed_database.seed_managers` | Use Auth Admin; D-19 |
| Forked teardown list in CLI vs pytest | — | Violates D-13 |
| Live crawl inside default generate | — | Violates D-01 |

---

## Metadata

**Analog search scope:**  
`scripts/`, `services/agent-orchestrator/{scripts,services,api,tests}/`, `apps/api-gateway/src/{menus,organizations,restaurants,team}/`, `supabase/migrations/`, `datasets/restaurant_menus/`, root `package.json`

**Files scanned:** ~35 primary (8 deep-read analogs + supporting greps)  
**Pattern extraction date:** 2026-07-27  
**Strong analogs used:** `setup_e2e_anchor.py`, `conftest_prod.py`, `seed_database.py`, `web_crawler.py`, `e2e_crawl_harness.py`, `menus.service.ts`, `health_routes.py` / `research_routes.py`, menu/URA migrations
