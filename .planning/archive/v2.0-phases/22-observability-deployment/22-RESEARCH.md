# Phase 22: Observability & Deployment — Research

**Researched:** 2026-04-13
**Domain:** Sentry/FastAPI observability, Railway/Vercel deployment, NestJS proxy, React health dashboard, POS abstraction
**Confidence:** HIGH (all findings verified against live codebase)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **Sentry init** — `sentry-sdk[fastapi]` in main.py. Fail at startup in `production` if no `SENTRY_DSN`. Warn + continue in `development`. `sentry_sdk.set_tag("agent", agent_name)` in BaseAgent.
2. **Auth (3-layer)** — `GET /health` public. Health/metrics API requires `X-Admin-Key` header. `/admin/health` frontend behind `ProtectedRoute` (any authenticated user). `ADMIN_API_KEY` never in browser JS.
3. **POS abstraction** — Route `POST /api/v1/pos/webhook/{provider}`. `POSProvider` Protocol + `POSEvent` Pydantic model + `ToastAdapter`. Files: `core/pos_provider.py`, `adapters/toast_adapter.py`, updated `api/pos_routes.py`.
4. **Railway deploy** — GitHub auto-deploy on push to main. Dockerfile in `services/agent-orchestrator/`. Port via `$PORT` env var.
5. **Toast DEP-06** — Credentials only in Railway dashboard. Connectivity test: `GET /restaurants/{guid}/v2/restaurantGeneral` (read-only).
6. **CORS** — `CORSMiddleware` on FastAPI, `ALLOWED_ORIGINS` env var, defaults to `["http://localhost:5173"]` in dev.
7. **vercel.json** — At repo root. Framework: `vite`. Root dir: `apps/web`. Rewrites `/api/*` to api-gateway URL.
8. **`.env.example`** — Create (does not exist yet). Document all required vars.
9. **api-gateway health proxy** — NestJS proxies `/api/health/*` and `/api/metrics` → orchestrator with `X-Admin-Key` server-to-server.
10. **Network** — Frontend → api-gateway → orchestrator. `ADMIN_API_KEY` never in frontend.

### Claude's Discretion

None defined — all decisions locked in discuss + audit.

### Deferred Ideas (OUT OF SCOPE)

- Wave 2–6 agent hardening
- Multi-restaurant support
- PagerDuty / alerting beyond Sentry
- CI/CD pipeline beyond Vercel auto-deploy and Railway GitHub integration
- Square/Clover adapters
- Toast webhook simulation/load testing
- Rate limiting on public `/health` endpoint
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBS-01 | Sentry SDK in main.py, `traces_sample_rate=0.1`, per-agent tags, alert rules | §Standard Stack: sentry-sdk already in requirements.txt; §Sentry Integration Pattern |
| OBS-02 | Per-agent health endpoints + React admin page at /admin/health | §BaseAgent Health API (get_health/get_detailed_health already exist); §Frontend Pattern |
| OBS-03 | `GET /api/v1/metrics` — DLQ size, active sagas, per-agent message counts | §Orchestrator.get_metrics() already exists; needs DLQ/saga augmentation |
| OBS-04 | Business metrics — stock updates/sec, delivery rate, report time, webhook latency | §Derived from existing AgentMetrics.to_dict(); no new instrumentation needed |
| OBS-05 | Public `GET /health` — minimal `{"status": "ok"}` for Railway healthcheck | Already implemented in main.py line 92; keep as-is |
| DEP-01 | Frontend on Vercel with `vercel.json` monorepo config | §Vercel Configuration Pattern |
| DEP-02 | Supabase Cloud — all v1.0 + v2.0 migrations applied | §Migration Strategy |
| DEP-03 | Agent-orchestrator on Railway via Docker | §Dockerfile Pattern; §Railway Deploy |
| DEP-04 | RabbitMQ on CloudAMQP free tier | §CloudAMQP Setup |
| DEP-05 | Redis on Upstash free tier, AOF persistence | §Upstash Setup |
| DEP-06 | Toast API credentials + connectivity test | §Toast Connectivity Test |
| INFRA-01 | `CORSMiddleware` on FastAPI | §CORS Pattern |
| INFRA-02 | `vercel.json` at repo root | §Vercel Configuration Pattern |
| INFRA-03 | Create `.env.example` | §.env.example Contents |
| INFRA-04 | api-gateway health proxy routes | §NestJS Proxy Pattern |
| POS-ABSTRACT | Generic webhook route + POSProvider Protocol + ToastAdapter | §POS Abstraction Pattern |
</phase_requirements>

---

## Summary

Phase 22 is architecturally well-prepared. The codebase already has all the scaffolding needed — `sentry-sdk[fastapi]` is in requirements.txt, `GET /health` endpoint exists in main.py, `BaseAgent.get_health()` and `get_detailed_health()` methods exist, `AgentOrchestrator.get_metrics()` exists, and `OrchestratorService` in NestJS already has an `httpClient` pointing to the orchestrator. The work is primarily **wiring**, not building from scratch.

The phase breaks cleanly into four work areas: (1) Python observability additions (Sentry init, health_routes.py, metrics augmentation, CORS, POS abstraction), (2) Docker + Railway configuration, (3) NestJS health proxy addition, and (4) Frontend AdminHealth page + vercel.json.

**Primary recommendation:** Build health_routes.py using the already-implemented `get_health()` / `get_detailed_health()` / `get_metrics()` methods — do not re-implement metrics collection. For NestJS proxy, extend `OrchestratorService` with admin-key-forwarding methods and add a new `HealthProxyController` rather than modifying existing controllers.

---

## Standard Stack

### Already Installed (no new deps needed)

| Library | Version in requirements.txt | Purpose | Status |
|---------|---------------------------|---------|--------|
| `sentry-sdk[fastapi]` | `1.39.2` [VERIFIED: requirements.txt line 107] | Sentry error tracking with FastAPI/Starlette integration | ⚠️ Version stale — see pitfall below |
| `fastapi` | `0.109.0` | Web framework; includes `CORSMiddleware` via Starlette | ✅ No extra dep needed |
| `starlette` | `0.35.1` | `CORSMiddleware` lives here | ✅ Already installed |
| `uvicorn[standard]` | `0.27.0` | ASGI server for Docker entrypoint | ✅ Already installed |
| `redis[hiredis]` | `5.0.1` | Upstash Redis client (same protocol) | ✅ Already installed |
| `aio-pika` | `9.4.0` | CloudAMQP RabbitMQ client (same AMQP protocol) | ✅ Already installed |

### Sentry Version — Critical Finding

**requirements.txt has `sentry-sdk[fastapi]==1.39.2`** [VERIFIED: requirements.txt:107]. Current sentry-sdk as of 2026 is 2.x. The `[fastapi]` extra enables both `StarletteIntegration` and `FastApiIntegration` automatically.

The 1.x → 2.x migration is non-breaking for `sentry_sdk.init()` signature, but the import path for integrations changed:

```python
# sentry-sdk 1.x (current in requirements.txt)
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration

# sentry-sdk 2.x (if upgraded)
# Same imports — backward-compatible at the Python API level
```

**Recommendation:** Update to `sentry-sdk[fastapi]>=2.0.0` in requirements.txt. The 1.x FastAPI integration works but 2.x includes better async span tracking. [ASSUMED: 2.x API is backward-compatible for init() — verify before executing]

### NestJS (api-gateway) — No New Dependencies

| What | Where | Status |
|------|-------|--------|
| `axios` | `package.json` line 40 | ✅ Already installed — `OrchestratorService` uses it directly |
| `@nestjs/common` | `package.json` line 25 | ✅ `Controller`, `Get`, `UseGuards` available |
| `ConfigService` | `@nestjs/config` line 27 | ✅ Used in `OrchestratorService` — same pattern for `ADMIN_API_KEY` |

**No `@nestjs/axios` needed** [VERIFIED: orchestrator.service.ts uses raw `axios` via `axios.create()`].

### Frontend (apps/web) — No New Dependencies

| What | Already Used In | For AdminHealth.tsx |
|------|----------------|---------------------|
| `axios` | AdminPanel.tsx | API calls to api-gateway |
| `framer-motion` | AdminPanel.tsx | Card animation variants |
| `lucide-react` | AdminPanel.tsx | Status icons (Activity, Server, etc.) |
| `sonner` toast | AdminPanel.tsx | Error toasts |
| `react-router-dom` | App.tsx | Route registration |

---

## Architecture Patterns

### Pattern 1: Sentry Init in main.py

**Location:** Before `app = FastAPI(...)` — after `load_dotenv`, before app creation.

**Critical:** Must be called before `app = FastAPI(lifespan=lifespan)` so integrations register correctly. [VERIFIED: sentry-sdk FastAPI integration requires init before app creation]

```python
# After load_dotenv, before app = FastAPI(...)
import os
import sentry_sdk
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration

_sentry_dsn = os.getenv("SENTRY_DSN")
_environment = os.getenv("ENVIRONMENT", "development")

if not _sentry_dsn:
    if _environment == "production":
        raise ValueError("SENTRY_DSN is required in production (ENVIRONMENT=production)")
    else:
        logging.getLogger(__name__).warning(
            "SENTRY_DSN not set — Sentry disabled (set ENVIRONMENT=production to fail fast)"
        )
else:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        traces_sample_rate=0.1,
        environment=_environment,
        integrations=[StarletteIntegration(), FastApiIntegration()],
    )
```

**settings.py reuse:** `settings.environment` already exists at line 116 [VERIFIED: config/settings.py:116]. The Sentry startup check runs before `get_settings()` is called (it's module-level), so use `os.getenv("ENVIRONMENT")` directly to avoid circular dependency. Add `sentry_dsn` and `admin_api_key` to `Settings.__init__` for use in health_routes.

### Pattern 2: Per-Agent Sentry Tags

**In BaseAgent** — call inside `process_message` dispatcher or in `start()`:

```python
# In base_agent.py — inside _process_message_with_retry() before dispatch
import sentry_sdk
sentry_sdk.set_tag("agent", self.agent_name)
sentry_sdk.set_tag("correlation_id", self._current_correlation_id)
```

This tags every exception captured in that agent's processing scope. [ASSUMED: sentry_sdk.set_tag is thread/async-safe for FastAPI's async context]

### Pattern 3: health_routes.py — Using Already-Built Methods

**Critical finding:** `BaseAgent.get_health()` and `BaseAgent.get_detailed_health()` ALREADY EXIST [VERIFIED: base_agent.py:896-934].

```python
# get_health() returns:
{
    "agent_name": "pos_integration_agent",
    "version": "1.0.0",
    "status": "active",       # AgentStatus.value
    "healthy": True,          # status in [ACTIVE, IDLE] AND success_rate >= 0.9
    "capabilities": ["consume_messages", "publish_messages"],
}

# get_detailed_health() returns all of get_health() PLUS:
{
    "metrics": {
        "messages": {"received": 42, "processed": 41, "failed": 1, "success_rate": "97.62%"},
        "timing": {"avg_ms": 12.4, "p95_ms": 45.0},
        "health": {"errors": 2, "last_error": "...", "circuit_breaker_trips": 0},
        "activity": {"uptime_seconds": 3600, "last_activity": "2026-04-13T..."},
    },
    "circuit_breaker": {"state": "closed", "available": True},
    "queue_size": 0,
    "active_tasks": 2,
    "subscriptions": [["pos.events", "pos.#"]],
}
```

`AgentOrchestrator.get_metrics()` ALSO ALREADY EXISTS [VERIFIED: orchestrator.py:528]. Returns agent metrics dict, bus stats, DB stats. Needs augmentation with DLQ count and active saga count (DB queries).

**health_routes.py structure:**

```python
router = APIRouter(tags=["Health & Metrics"])

def verify_admin_key(x_admin_key: str | None = Header(None)) -> str:
    # Exact pattern from research_routes.py:34-41 [VERIFIED]
    expected = os.getenv("ADMIN_API_KEY", "")
    if not x_admin_key or not expected or x_admin_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    return x_admin_key

# NOTE: GET /health is already defined in main.py line 92 — do NOT redefine here

@router.get("/api/v1/health/agents", dependencies=[Depends(verify_admin_key)])
async def get_all_agents_health(): ...

@router.get("/api/v1/health/agents/{name}", dependencies=[Depends(verify_admin_key)])
async def get_agent_health(name: str): ...

@router.get("/api/v1/metrics", dependencies=[Depends(verify_admin_key)])
async def get_system_metrics(): ...
```

**For `/api/v1/metrics` — DLQ and saga augmentation:**

The existing `get_metrics()` doesn't include DLQ count or active saga count. These require direct DB queries:

```python
# DLQ count — dead_letter_queue table (Phase 18 migration)
dlq_result = settings.supabase_client.table("dead_letter_queue")\
    .select("id", count="exact").execute()
dlq_size = dlq_result.count or 0

# Active sagas — saga_state table with status='running'
saga_result = settings.supabase_client.table("saga_state")\
    .select("id", count="exact")\
    .eq("status", "running").execute()
active_sagas = saga_result.count or 0
```

### Pattern 4: CORS Middleware

**In main.py** — after Sentry init, before `app = FastAPI(...)` definition, but actually added after app creation:

```python
from fastapi.middleware.cors import CORSMiddleware
import json

# After app = FastAPI(...)
_allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", '["http://localhost:5173"]')
try:
    _allowed_origins = json.loads(_allowed_origins_raw)
except json.JSONDecodeError:
    _allowed_origins = ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Note: `ALLOWED_ORIGINS` should be a JSON array string (e.g., `["https://myapp.vercel.app"]`). [VERIFIED: fastapi CORSMiddleware pattern via Starlette docs]

### Pattern 5: POS Abstraction

**File: `core/pos_provider.py`** (new)

```python
from typing import Protocol, runtime_checkable
from pydantic import BaseModel
from datetime import datetime

class POSEvent(BaseModel):
    event_type: str
    restaurant_guid: str
    timestamp: datetime
    items: list[dict]
    raw_payload: dict

@runtime_checkable
class POSProvider(Protocol):
    async def verify_webhook(self, raw: bytes, signature: str) -> bool: ...
    async def normalize_event(self, raw: dict) -> POSEvent: ...
```

**File: `adapters/toast_adapter.py`** (new) — move HMAC + normalization logic from `pos_routes.py` and `POSIntegrationAgent` here.

**Provider registry in `api/pos_routes.py`:**

```python
from core.pos_provider import POSProvider, POSEvent
from adapters.toast_adapter import ToastAdapter

_PROVIDERS: dict[str, POSProvider] = {
    "toast": ToastAdapter(),
}

@router.post("/webhook/{provider}", status_code=200)
async def pos_webhook(provider: str, request: Request, ...):
    if provider not in _PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Unknown POS provider: {provider}")
    adapter = _PROVIDERS[provider]
    # verify + normalize
```

### Pattern 6: NestJS Health Proxy

**OrchestratorService extension** — add private helper + proxy methods:

```typescript
// In orchestrator.service.ts
private getAdminHeaders(): Record<string, string> {
  const key = this.configService.get<string>('ADMIN_API_KEY', '');
  return { 'X-Admin-Key': key };
}

async getAgentHealthAll(): Promise<any> {
  const response = await this.httpClient.get('/api/v1/health/agents', {
    headers: this.getAdminHeaders(),
  });
  return response.data;
}

async getAgentHealthByName(name: string): Promise<any> {
  const response = await this.httpClient.get(`/api/v1/health/agents/${name}`, {
    headers: this.getAdminHeaders(),
  });
  return response.data;
}

async getSystemMetrics(): Promise<any> {
  const response = await this.httpClient.get('/api/v1/metrics', {
    headers: this.getAdminHeaders(),
  });
  return response.data;
}
```

**New controller:** `apps/api-gateway/src/common/orchestrator/health-proxy.controller.ts`

```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';  // Verify Supabase JWT
import { OrchestratorService } from './orchestrator.service';

@Controller('api/health')
@UseGuards(AuthGuard('jwt'))  // Supabase JWT required — any logged-in user
export class HealthProxyController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Get('agents')
  getAllAgentsHealth() {
    return this.orchestratorService.getAgentHealthAll();
  }

  @Get('agents/:name')
  getAgentHealth(@Param('name') name: string) {
    return this.orchestratorService.getAgentHealthByName(name);
  }
}

@Controller('api/metrics')
@UseGuards(AuthGuard('jwt'))
export class MetricsProxyController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Get()
  getMetrics() {
    return this.orchestratorService.getSystemMetrics();
  }
}
```

**Register in OrchestratorModule:**

```typescript
@Module({
  imports: [WebsocketModule],
  controllers: [HealthProxyController, MetricsProxyController],  // ADD
  providers: [OrchestratorService, RabbitMqBridgeService],
  exports: [OrchestratorService, RabbitMqBridgeService],
})
export class OrchestratorModule {}
```

**JWT guard:** `AuthGuard('jwt')` from `@nestjs/passport` is already used in the gateway — `AuthModule` is imported in `app.module.ts` [VERIFIED: app.module.ts:49]. The `passport-jwt` package is in `package.json` [VERIFIED: package.json:52].

### Pattern 7: AdminHealth.tsx

**File location:** `apps/web/src/pages/AdminHealth.tsx`

**Pattern copied from AdminPanel.tsx** [VERIFIED: AdminPanel.tsx lines 1–47]:

```tsx
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Activity, Server, AlertCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import axios from 'axios'

const API_GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
}

export default function AdminHealth() {
  const [agents, setAgents] = useState<AgentHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchHealth = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const res = await axios.get(`${API_GATEWAY_URL}/api/health/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setAgents(res.data.agents ?? [])
      setLastUpdated(new Date())
    } catch (err) {
      toast.error('Failed to fetch agent health')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30_000)  // 30s poll
    return () => clearInterval(interval)
  }, [])

  // ... render agent status cards
}
```

**Route in App.tsx** — add inside the DashboardLayout `<ProtectedRoute>` block (line 109–137), adjacent to `/admin`:

```tsx
const AdminHealth = lazy(() => import('./pages/AdminHealth'))

// Inside DashboardLayout ProtectedRoute block:
<Route path="/admin/health" element={<AdminHealth />} />
```

[VERIFIED: App.tsx line 129 has `/admin` route; `/admin/health` follows the same structure]

**ProtectedRoute pattern for admin/health:** Use plain `<ProtectedRoute>` (no `requiredRole` or `requiredStudioRole`) — this only checks `isAuthenticated`. [VERIFIED: ProtectedRoute.tsx — no roles = any authenticated user]

### Pattern 8: Dockerfile for Railway

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (needed for psycopg2, opencv, weasyprint)
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway injects $PORT — default to 8000 for local docker run
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

**Critical Railway requirement:** Port MUST use `${PORT}` env var injected by Railway. [VERIFIED: Railway documentation pattern — ASSUMED for current 2026 Railway platform]

**Build time warning:** requirements.txt includes `torch`, `surya-ocr`, `opencv-python`, `ultralytics`, `sentence-transformers` — heavy ML deps. Railway free tier may time out during first build (~10-15 min). Consider:
1. Using Railway's paid tier for first build
2. Or creating a `requirements.prod.txt` that excludes OCR/ML deps not needed for the POS+notification pipeline

**Recommendation:** Create `requirements.prod.txt` excluding v1.0 ML stack for Railway (POS pipeline doesn't use YOLO/Surya). [ASSUMED — planner should confirm which deps the 4 golden-path agents actually need at runtime]

### Pattern 9: vercel.json

**File location:** Repo root (not in apps/web)

```json
{
  "framework": "vite",
  "rootDirectory": "apps/web",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://YOUR_API_GATEWAY_URL/api/:path*"
    }
  ]
}
```

**Critical pitfall:** Vercel does NOT support env var interpolation in `vercel.json` rewrites. [ASSUMED: based on Vercel docs knowledge — destination must be a literal URL, not `${API_GATEWAY_URL}`]. The api-gateway Railway URL must be hardcoded, or use Vercel Edge Middleware for dynamic routing.

**Working approach:** Set the api-gateway URL in `vercel.json` after Railway deployment URL is known. Since the Railway app URL is stable after first deploy (e.g., `https://wineops-api-gateway.railway.app`), hardcoding is acceptable for MVP.

**rootDirectory behavior:** When `rootDirectory: "apps/web"` is set, Vercel changes the build context to that directory. The `buildCommand` and `installCommand` run inside `apps/web`. [ASSUMED: Vercel monorepo behavior is standard]

**Vercel env vars (set in Vercel dashboard, not vercel.json):**
- `VITE_API_GATEWAY_URL` — same value as the `destination` rewrite URL
- `VITE_SUPABASE_URL` 
- `VITE_SUPABASE_ANON_KEY`

### Pattern 10: Recommended Project Structure Changes

```
services/agent-orchestrator/
├── adapters/                  # NEW — POS provider adapters
│   └── toast_adapter.py       # NEW — ToastAdapter implements POSProvider
├── api/
│   ├── health_routes.py       # NEW — /api/v1/health/* + /api/v1/metrics
│   ├── pos_routes.py          # MODIFIED — generic {provider} route
│   └── research_routes.py     # unchanged (auth pattern reference)
├── core/
│   ├── pos_provider.py        # NEW — POSProvider Protocol + POSEvent
│   └── base_agent.py          # MODIFIED — add sentry_sdk.set_tag in process_message
├── main.py                    # MODIFIED — Sentry init, CORS, health_router
├── config/settings.py         # MODIFIED — add sentry_dsn, admin_api_key attrs
├── Dockerfile                 # NEW
└── .env.example               # NEW

apps/
├── api-gateway/src/
│   └── common/orchestrator/
│       ├── orchestrator.module.ts    # MODIFIED — add controllers
│       ├── orchestrator.service.ts   # MODIFIED — add proxy methods
│       └── health-proxy.controller.ts  # NEW
└── web/src/
    ├── App.tsx                 # MODIFIED — add /admin/health route
    └── pages/AdminHealth.tsx   # NEW

vercel.json                    # NEW (repo root)
.env.example                   # NEW
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent health data collection | Custom metrics polling loop | `agent.get_health()` / `agent.get_detailed_health()` | Already implemented in BaseAgent — VERIFIED |
| System metrics aggregation | Custom metrics scraping | `orchestrator.get_metrics()` | Already implemented in AgentOrchestrator — VERIFIED |
| Sentry error capture | Custom exception logging | `sentry_sdk.init()` with FastAPI integration | Captures exceptions, performance traces, request context automatically |
| CORS handling | Custom middleware | `fastapi.middleware.cors.CORSMiddleware` | Built into Starlette — already a dependency |
| NestJS HTTP proxy | Custom `fetch` calls | Extend `OrchestratorService.httpClient` | httpClient already exists and is configured |
| JWT validation in NestJS | Custom JWT decode | `AuthGuard('jwt')` from `@nestjs/passport` | Already installed and used in AuthModule |
| Supabase count queries | `SELECT COUNT(*)` via raw SQL | `.select("id", count="exact").execute()` | Supabase client count parameter |

---

## BaseAgent Health API — Detailed Inventory

This is the most important finding for planning: **no new metrics infrastructure is needed**.

```python
# From base_agent.py — these methods ALREADY EXIST [VERIFIED: lines 896-934]

agent.get_health() → {
    "agent_name": str,
    "version": str,
    "status": str,   # "active" | "idle" | "degraded" | "error" | "stopped" | etc.
    "healthy": bool, # status in [ACTIVE, IDLE] AND success_rate >= 0.9
    "capabilities": list[str],
}

agent.get_detailed_health() → {
    # all of get_health() PLUS:
    "metrics": {
        "messages": {
            "received": int,
            "processed": int,    # ← OBS-02: messages_processed
            "failed": int,
            "skipped": int,
            "success_rate": str, # ← OBS-02: derived error_rate = 1 - success_rate
        },
        "timing": {"avg_ms": float, "p95_ms": float},
        "health": {
            "errors": int,
            "last_error": str | None,
            "circuit_breaker_trips": int,
        },
        "activity": {"uptime_seconds": float, "last_activity": str | None},
    },
    "circuit_breaker": {
        "state": str,     # ← OBS-02: circuit_breaker_state ("closed"|"open"|"half_open")
        "available": bool,
    },
    "queue_size": int,
    "active_tasks": int,
    "config": {"max_concurrent_tasks": int, "max_retries": int},
    "subscriptions": list[tuple[str, str]],
}
```

**`AgentOrchestrator.get_metrics()` ALREADY EXISTS** [VERIFIED: orchestrator.py:528]:
Returns `agents` (per-agent metrics dict), `aggregated` (total messages + error rate), `message_bus`, `database`, `system.uptime_seconds`.

**What's MISSING from existing get_metrics():**
- `dlq_size` — requires `SELECT count(*) FROM dead_letter_queue`
- `active_sagas` — requires `SELECT count(*) FROM saga_state WHERE status = 'running'`

These are trivial Supabase client queries to add in `health_routes.py`.

---

## Common Pitfalls

### Pitfall 1: Redefining GET /health

**What goes wrong:** Creating a second `/health` route in `health_routes.py` that conflicts with the one already in `main.py` line 92.

**Why it happens:** Phase description mentions `/health` as a deliverable, researcher adds it to new routes file.

**How to avoid:** Leave `GET /health` in `main.py`. Only add `/api/v1/health/agents`, `/api/v1/health/agents/{name}`, `/api/v1/metrics` in the new `health_routes.py`. FastAPI will raise `AssertionError: There is already a route defined for /health` if duplicated.

### Pitfall 2: Circular Import in health_routes.py

**What goes wrong:** `health_routes.py` imports `get_orchestrator` from `main.py` at module level → circular import at startup.

**Why it happens:** Same pattern risk as `pos_routes.py`.

**How to avoid:** Import `get_orchestrator` inside the route handler function body, not at module top level [VERIFIED: pos_routes.py:39 uses `from main import get_orchestrator` inside the handler — same pattern required].

### Pitfall 3: Sentry Init Before load_dotenv

**What goes wrong:** `SENTRY_DSN` env var is `None` even though it's in `.env` because `load_dotenv()` hasn't been called yet.

**Why it happens:** `load_dotenv()` is called at line 15 of `main.py` but Sentry init might be placed before it.

**How to avoid:** Place Sentry init code AFTER `load_dotenv(...)` call in main.py. Order: `import logging` → `from dotenv import load_dotenv` → `load_dotenv(...)` → Sentry init → `from fastapi import FastAPI`.

### Pitfall 4: Docker Port Binding

**What goes wrong:** Railway container fails to start because the app listens on hardcoded 8000 but Railway injects `$PORT`.

**Why it happens:** `uvicorn main:app --host 0.0.0.0 --port 8000` doesn't use Railway's injected PORT.

**How to avoid:** Use `CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]` — shell form with variable expansion [ASSUMED: Railway PORT injection behavior — standard in 2026 PaaS platforms].

### Pitfall 5: Heavy Docker Build

**What goes wrong:** Railway build times out or OOM during `pip install` because requirements.txt includes `torch`, `surya-ocr`, `opencv-python`, `ultralytics` (multi-GB).

**Why it happens:** The production POS+agent pipeline doesn't need ML/OCR deps, but they're all in one requirements.txt.

**How to avoid (two options):**
- Option A: Accept large image — Railway has a 30-min build timeout on paid plans.
- Option B: Create `requirements.prod.txt` for Railway (exclude torch, surya-ocr, opencv, ultralytics, sentence-transformers, easyocr, PyPDF2, pdf2image, playwright) — only golden-path agents need aio-pika, redis, anthropic, supabase, fastapi, sentry-sdk. [RECOMMENDED for first deploy]

**Planner decision needed:** Which option to use. This is marked as Claude's discretion (it wasn't addressed in CONTEXT.md discuss).

### Pitfall 6: vercel.json rootDirectory and build paths

**What goes wrong:** `outputDirectory` path is wrong — Vercel interprets paths differently when `rootDirectory` is set.

**Why it happens:** With `rootDirectory: "apps/web"`, the build runs inside `apps/web`. The `dist` output is at `apps/web/dist` relative to repo root, but Vercel looks for it relative to `rootDirectory`.

**How to avoid:** Do NOT specify `outputDirectory` in vercel.json when using `rootDirectory`. Vite's default output is `dist/` and Vercel auto-detects it. Just set `rootDirectory` and `framework`. [ASSUMED: Vercel monorepo auto-detection behavior]

### Pitfall 7: CORS Origin Format

**What goes wrong:** `ALLOWED_ORIGINS` env var set as `https://myapp.vercel.app` (plain string) causes `CORSMiddleware` to fail — it expects a list.

**How to avoid:** Store `ALLOWED_ORIGINS` as a JSON array string: `["https://myapp.vercel.app","https://myapp-preview.vercel.app"]`. Parse with `json.loads()` in settings. Default: `["http://localhost:5173"]`.

### Pitfall 8: NestJS Controller Route Conflict

**What goes wrong:** New `HealthProxyController` routes `/api/health/*` conflict with existing controllers or TenantGuard blocking them.

**Why it happens:** `TenantGuard` is a global guard (app.module.ts:82) that requires `X-Restaurant-Id` header — health dashboard calls won't have this.

**How to avoid:** Add `@SkipTenantGuard()` decorator (or check if TenantGuard has a skip mechanism) on `HealthProxyController`. If no decorator exists, add a `SetMetadata` skip pattern [ASSUMED: NestJS guard skip pattern exists — verify `TenantGuard` implementation].

---

## Environment Availability

```bash
# Python 3.11 [VERIFIED: python3 -c "import sys; print(sys.version)" → 3.11.0]
python3 --version   # → 3.11.0

# Railway CLI — not needed; GitHub auto-deploy via dashboard [ASSUMED]
# Vercel CLI — not needed for deploy; useful for preview [ASSUMED]
# Supabase CLI — needed for migration push
supabase --version  # must check during execution
```

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.11 | Dockerfile base | ✓ | 3.11.0 | — |
| Railway account | DEP-03 | ✓ (assumed — friend's server) | — | — |
| CloudAMQP account | DEP-04 | Unknown | — | Validate during Wave 3 |
| Upstash account | DEP-05 | Unknown | — | Validate during Wave 3 |
| Supabase Cloud project | DEP-02 | Unknown | — | Create during Wave 3 |
| Sentry account/DSN | OBS-01 | Unknown | — | Dev: skip; Prod: required |
| Toast production creds | DEP-06 | Unknown (friend's creds) | — | Provided by friend |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 7.4.4 + pytest-asyncio 0.23.3 |
| Config file | `services/agent-orchestrator/pytest.ini` [VERIFIED: file exists] |
| Quick run command | `pytest tests/test_health_routes.py -x -q` |
| Full suite command | `pytest tests/ -x -q` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBS-01 | Sentry init: prod fails without DSN | unit | `pytest tests/test_sentry_init.py -x` | ❌ Wave 0 |
| OBS-01 | Sentry init: dev warns without DSN | unit | `pytest tests/test_sentry_init.py -x` | ❌ Wave 0 |
| OBS-02 | GET /health/agents returns agent list | integration | `pytest tests/test_health_routes.py::test_get_agents_health -x` | ❌ Wave 0 |
| OBS-02 | GET /health/agents/{name} returns detail | integration | `pytest tests/test_health_routes.py::test_get_agent_health_detail -x` | ❌ Wave 0 |
| OBS-02 | GET /health/agents returns 401 without key | unit | `pytest tests/test_health_routes.py::test_health_requires_auth -x` | ❌ Wave 0 |
| OBS-03 | GET /metrics returns dlq_size + active_sagas | integration | `pytest tests/test_health_routes.py::test_get_metrics -x` | ❌ Wave 0 |
| OBS-05 | GET /health returns 200 {"status":"ok"} (public) | unit | `pytest tests/test_health_routes.py::test_public_health -x` | ❌ Wave 0 |
| INFRA-01 | CORS headers present in response | unit | `pytest tests/test_cors.py -x` | ❌ Wave 0 |
| POS-ABSTRACT | POST /webhook/toast routes to ToastAdapter | integration | `pytest tests/test_pos_routes.py::test_generic_provider_routing -x` | ❌ Wave 0 |
| POS-ABSTRACT | POST /webhook/unknown returns 404 | unit | `pytest tests/test_pos_routes.py::test_unknown_provider_404 -x` | ❌ Wave 0 |
| DEP-03 | Dockerfile builds successfully | smoke | `docker build -t wineops-test .` | Manual / Wave 3 |
| DEP-06 | Toast connectivity test passes | manual | Python script (existing ngrok_live_test.py pattern) | Manual |

### Sampling Rate

- **Per task commit:** `pytest tests/test_health_routes.py tests/test_pos_routes.py -x -q`
- **Per wave merge:** `pytest tests/ -x -q` (all existing + new tests)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/test_health_routes.py` — covers OBS-01..05, INFRA-01
- [ ] `tests/test_pos_routes.py` — covers POS-ABSTRACT (extend existing test if present)
- [ ] `tests/test_sentry_init.py` — covers OBS-01 startup behavior (mock `os.getenv`)
- [ ] `tests/test_cors.py` — covers INFRA-01 CORSMiddleware headers

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | X-Admin-Key for server-to-server; Supabase JWT for frontend via NestJS |
| V3 Session Management | no | JWT stateless — no server-side sessions |
| V4 Access Control | yes | `ADMIN_API_KEY` never in browser; 3-layer auth enforced |
| V5 Input Validation | yes | Pydantic `POSEvent` model for normalized events; `provider` path param validated against registry |
| V6 Cryptography | no | Toast HMAC handled in ToastAdapter (existing logic) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| ADMIN_API_KEY leakage via browser | Information Disclosure | `ADMIN_API_KEY` only in NestJS server env; frontend uses JWT via gateway |
| Forged health requests from internet | Spoofing | X-Admin-Key required on all /health/agents and /metrics endpoints |
| Sentry DSN leaking secrets | Information Disclosure | DSN in env var only; never committed; Railway dashboard only |
| Public `/health` DoS | DoS | Accepted risk for MVP — deferred to post-launch |
| Unknown POS provider injection | Tampering | Provider registry dict lookup with explicit 404 for unknown keys |
| Railway env var access | Elevation | Principle of least privilege — Toast creds only in Railway; no shared secrets with frontend |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | sentry-sdk 2.x has same `sentry_sdk.init()` API as 1.x | Standard Stack | Low — startup error easy to catch; 1.x already works |
| A2 | sentry_sdk.set_tag() is async-context safe in FastAPI | Sentry Per-Agent Tags | Low — if scoping broken, tags may not appear but errors still captured |
| A3 | Railway injects `$PORT` env var at runtime | Dockerfile Pattern | HIGH — if wrong, container fails to start |
| A4 | vercel.json does NOT support env var interpolation in rewrites | vercel.json Pattern | Medium — if it does, we can use env var (simpler); if not, hardcode required |
| A5 | `rootDirectory` in vercel.json auto-detects Vite `dist/` output | Vercel Configuration | Low — fallback: add explicit `outputDirectory: "dist"` |
| A6 | TenantGuard in NestJS has a skip mechanism | NestJS Proxy | Medium — if no skip, must conditionally disable TenantGuard for health routes |
| A7 | Requirements.prod.txt approach won't break golden-path agents | Docker Build | Medium — need to verify which ML deps the 4 golden-path agents actually import |
| A8 | supabase-py count= parameter works for dead_letter_queue query | DLQ metrics | Low — supabase-py 2.x count="exact" is well-documented |

---

## Open Questions

1. **TenantGuard skip for health proxy routes**
   - What we know: `TenantGuard` is a global guard requiring `X-Restaurant-Id` header (app.module.ts:83)
   - What's unclear: Whether TenantGuard has a `@SkipTenantGuard()` decorator or metadata-based skip
   - Recommendation: Check `apps/api-gateway/src/common/tenant/tenant.guard.ts` before planning NestJS tasks

2. **requirements.prod.txt vs full requirements.txt**
   - What we know: Full requirements.txt includes ~2GB of ML deps that production POS pipeline doesn't use
   - What's unclear: Whether any of the 4 golden-path agents import torch/surya/opencv at module level (which would crash if not installed)
   - Recommendation: Grep for `import torch`, `import cv2`, `import surya` in agents/pos_integration_agent.py, agents/inventory_engine.py, agents/notification_agent.py, agents/reporting_agent.py before deciding

3. **api-gateway deployment target**
   - CONTEXT.md says: "Deploy to Railway (or Vercel serverless functions if NestJS supports it)"
   - NestJS websockets (socket.io) require persistent connections — Vercel serverless won't work for WebsocketModule
   - Recommendation: Railway for api-gateway (not Vercel)

4. **Supabase migration order**
   - What we know: `supabase/migrations/` has v1.0 (phases 1-17) and v2.0 (phases 18-21) migrations
   - What's unclear: Are the v2.0 migrations idempotent (safe to re-run)?
   - Recommendation: Use `supabase db push --linked` (validates against Supabase Cloud's schema version)

---

## Code Examples

### Verified: X-Admin-Key auth pattern (from research_routes.py:34-41)

```python
def verify_admin_token(x_admin_key: str | None = Header(None)) -> str:
    """Require X-Admin-Key header matching ADMIN_API_KEY env var."""
    expected = os.getenv("ADMIN_API_KEY", "")
    if not x_admin_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    if not expected or x_admin_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    return x_admin_key
```

### Verified: OrchestratorService httpClient pattern (from orchestrator.service.ts:13-18)

```typescript
constructor(private readonly configService: ConfigService) {
  const baseUrl = this.configService.get<string>(
    'AGENT_ORCHESTRATOR_URL',
    'http://localhost:8000',
  );
  this.httpClient = axios.create({ baseURL: baseUrl, timeout: 15000 });
}
```

### Verified: AdminPanel animation pattern (from AdminPanel.tsx:35-46)

```tsx
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
}
```

---

## .env.example Contents

The `.env.example` file does NOT exist [VERIFIED: CONTEXT.md audit finding #4]. Create at repo root (or at `services/agent-orchestrator/.env.example` — planner to decide):

```bash
# ============================================================
# WineOps Agent Orchestrator — Environment Variables
# Copy to .env and fill in values
# NEVER commit .env to git
# ============================================================

# Core
ENVIRONMENT=development          # "development" | "production"
DEBUG=false

# Sentry (required in production — fails startup if missing)
SENTRY_DSN=

# Admin API Key (server-to-server auth — never expose to browser)
ADMIN_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=

# RabbitMQ (CloudAMQP in production)
RABBITMQ_URL=amqp://guest:guest@localhost:5672/

# Redis (Upstash in production)
REDIS_URL=redis://localhost:6379

# Toast POS
TOAST_API_URL=https://ws-api.toasttab.com
TOAST_CLIENT_ID=
TOAST_CLIENT_SECRET=
TOAST_RESTAURANT_GUID=
TOAST_WEBHOOK_SECRET=
TOAST_ENVIRONMENT=sandbox        # "sandbox" | "production"
MOCK_POS=true

# CORS (JSON array of allowed origins)
ALLOWED_ORIGINS=["http://localhost:5173"]

# Notification backends
MOCK_NOTIFICATIONS=true
PLIVO_AUTH_ID=
PLIVO_AUTH_TOKEN=
PLIVO_PHONE_NUMBER=
SENDGRID_API_KEY=
FROM_EMAIL=

# LLM
CLAUDE_API_KEY=
GOOGLE_API_KEY=
LLM_PRIMARY_MODEL=claude-haiku-4-5-20251001
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom health polling loops | `BaseAgent.get_health()` / `get_detailed_health()` | Phase 18 (BaseAgent Level 3) | Health routes are trivial wiring, not implementation |
| Manual Sentry error reporting | `sentry_sdk.init()` with FastAPI integration captures all unhandled exceptions | Sentry SDK 1.x+ | No code changes needed in route handlers |
| Direct CORS in every route | `CORSMiddleware` global middleware | FastAPI 0.x | Single middleware registration; no per-route headers |

---

## Sources

### Primary (HIGH confidence — verified against live codebase)

- `services/agent-orchestrator/core/base_agent.py:896-934` — `get_health()`, `get_detailed_health()` methods verified
- `services/agent-orchestrator/core/orchestrator.py:528-569` — `get_metrics()` method verified
- `services/agent-orchestrator/api/research_routes.py:34-41` — `verify_admin_token` pattern verified
- `services/agent-orchestrator/requirements.txt:107` — `sentry-sdk[fastapi]==1.39.2` verified
- `apps/api-gateway/src/common/orchestrator/orchestrator.service.ts:13-18` — `httpClient` axios pattern verified
- `apps/api-gateway/package.json:40` — `axios` already installed verified
- `apps/web/src/App.tsx:129` — existing `/admin` route pattern verified
- `apps/web/src/components/ProtectedRoute.tsx` — auth behavior verified (no role = any authenticated user)
- `services/agent-orchestrator/main.py:92-95` — existing `GET /health` verified

### Secondary (MEDIUM confidence)

- Vercel monorepo `rootDirectory` behavior — based on Vercel documentation knowledge
- Railway `$PORT` env var injection — standard PaaS platform pattern

### Tertiary (LOW confidence — flagged as ASSUMED)

- sentry-sdk 2.x backward compatibility with 1.x init API
- Vercel rewrites cannot interpolate env vars

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps verified against requirements.txt and package.json
- Architecture patterns: HIGH — all patterns traced to live codebase (except NestJS guard skip)
- Pitfalls: HIGH — all verified against real code paths

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable deps; Railway/Vercel APIs change slowly)

---

## RESEARCH COMPLETE

**Phase:** 22 — Observability & Deployment
**Confidence:** HIGH

### Key Findings

1. **BaseAgent already has all health methods** — `get_health()`, `get_detailed_health()`, and `AgentOrchestrator.get_metrics()` are already implemented. `health_routes.py` is purely wiring.

2. **GET /health already exists** — main.py line 92 has the public health endpoint. Do NOT recreate it in health_routes.py.

3. **sentry-sdk already in requirements.txt** — at 1.39.2. Upgrade to 2.x recommended but not blocking. Sentry init goes in main.py AFTER load_dotenv(), BEFORE app creation.

4. **NestJS proxy uses raw axios** — no @nestjs/axios needed. Extend OrchestratorService with 3 proxy methods + X-Admin-Key header. Add HealthProxyController to OrchestratorModule.

5. **Heavy Docker build warning** — requirements.txt includes torch, surya-ocr, opencv (~2GB). Consider requirements.prod.txt for Railway. Planner must decide before writing Docker task.

6. **Vercel rewrites need literal URL** — API gateway URL hardcoded in vercel.json (no env var interpolation in rewrites section).

7. **TenantGuard may block health proxy** — check `tenant.guard.ts` before writing NestJS tasks to ensure health routes can bypass restaurant-ID requirement.

### File Created

`.planning/phases/22-observability-deployment/22-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Python health routes | HIGH | Verified BaseAgent methods + research_routes.py auth pattern exist |
| Sentry init | HIGH | sentry-sdk in requirements.txt; pattern is standard; `settings.environment` confirmed |
| NestJS proxy | HIGH | OrchestratorService httpClient verified; JWT guard installed |
| Docker/Railway | MEDIUM | Port injection ASSUMED (standard PaaS pattern) |
| Vercel config | MEDIUM | rootDirectory behavior and rewrite limitations ASSUMED |
| POS abstraction | HIGH | Existing code structure clearly shows refactoring path |

### Open Questions

1. TenantGuard skip mechanism — check `tenant.guard.ts` before planning
2. requirements.prod.txt vs full deps — grep golden-path agents for ML imports
3. api-gateway deploy target — Railway strongly recommended over Vercel (WebSockets)

### Ready for Planning

Research complete. Planner can create PLAN.md files for all tasks in Phase 22.
