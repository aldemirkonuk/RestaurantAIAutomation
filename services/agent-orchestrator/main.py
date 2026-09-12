"""
Agent Orchestrator — FastAPI Application Entry Point
====================================================
Registers all routers for the WineOps agent orchestration service.
"""

import json as _json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Load services/agent-orchestrator/.env so ADMIN_API_KEY and other vars match curl / IDE.
load_dotenv(Path(__file__).resolve().parent / ".env")

# ── Sentry SDK — init BEFORE app = FastAPI() so integrations register correctly ──
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from utils.sentry_client import scrub_sentry_event

_sentry_dsn = os.getenv("SENTRY_DSN")
_environment = os.getenv("ENVIRONMENT", "development")

if not _sentry_dsn:
    logging.getLogger(__name__).warning(
        "SENTRY_DSN not set — Sentry disabled. "
        "Set SENTRY_DSN in Railway dashboard environment variables to enable error tracking."
    )
else:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        traces_sample_rate=0.1,
        environment=_environment,
        # Already the SDK default, stated explicitly because it is a privacy
        # control and a silent default is not a control anyone can audit. Keeps
        # the SDK from attaching request bodies, cookies and client IPs on its
        # own. It does not cover anything set through set_user(), which is why
        # SentryClient.set_user takes opaque identifiers only.
        send_default_pii=False,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        before_send=scrub_sentry_event,
    )
# ── End Sentry ────────────────────────────────────────────────────────────────

from fastapi import FastAPI

from api.onboarding_routes import router as onboarding_router
from api.quality_routes import router as quality_router
from api.research_routes import research_router
from api.scan_routes import router_preview as preview_router
from api.analytics_routes import router as analytics_router
from api.studio_routes import studio_router

from core.orchestrator import AgentOrchestrator
from core.message_bus import MessageBus, set_message_bus
from config.settings import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_orchestrator: Optional[AgentOrchestrator] = None


def get_orchestrator() -> Optional[AgentOrchestrator]:
    """Return the running AgentOrchestrator instance. None if not started yet."""
    return _orchestrator


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start all CORE-tier agents on startup, shut them down on exit."""
    global _orchestrator
    settings = get_settings()
    bus = MessageBus(rabbitmq_url=settings.rabbitmq_url)
    try:
        await bus.connect()
    except Exception as exc:
        logger.warning(
            "RabbitMQ not available at startup (%s). "
            "Agents will not start. App will still serve HTTP routes.",
            exc,
        )
        yield
        return

    set_message_bus(bus)
    _orchestrator = AgentOrchestrator(message_bus=bus, settings=settings)
    try:
        await _orchestrator.initialize()
        await _orchestrator.start_all_agents()
        logger.info("All CORE agents started successfully.")
    except Exception as exc:
        logger.error("Agent startup failed: %s", exc)

    yield  # App serves requests here

    logger.info("Shutting down agents...")
    if _orchestrator:
        await _orchestrator.stop_all_agents()
    await bus.disconnect()
    logger.info("Agent shutdown complete.")


# ── Interactive docs are non-production only ──────────────────────────────────
# /docs, /redoc and /openapi.json were publicly reachable on the Railway host,
# enumerating every route of a service that bills the Anthropic account. In
# production the built-in mounts are removed and replaced (below, once
# verify_admin_key is importable) with X-Admin-Key-gated equivalents, so an
# operator can still `curl -H "X-Admin-Key: …" /openapi.json` while an anonymous
# visitor gets 401 instead of a map of the API.
_DOCS_PUBLIC = _environment.strip().lower() not in ("production", "prod")

app = FastAPI(
    title="WineOps Agent Orchestrator",
    description="Orchestrates AI agents for restaurant wine management.",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _DOCS_PUBLIC else None,
    redoc_url="/redoc" if _DOCS_PUBLIC else None,
    openapi_url="/openapi.json" if _DOCS_PUBLIC else None,
)

# ── CORS middleware — defense-in-depth for local dev and direct access (INFRA-01) ──
from fastapi.middleware.cors import CORSMiddleware

_allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", '["http://localhost:5173"]')
try:
    _allowed_origins = _json.loads(_allowed_origins_raw)
except _json.JSONDecodeError:
    logger.warning(
        "ALLOWED_ORIGINS env var is not valid JSON — defaulting to localhost:5173. "
        "Expected format: '[\"https://myapp.vercel.app\"]'"
    )
    _allowed_origins = ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# ── End CORS ──────────────────────────────────────────────────────────────────

# Register routers
app.include_router(onboarding_router)
app.include_router(quality_router)
app.include_router(research_router)
app.include_router(preview_router)
app.include_router(analytics_router)
app.include_router(studio_router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


# POS routes — imported at the very bottom to avoid circular import
# (pos_routes.py calls get_orchestrator() which is defined above)
from api.pos_routes import router as pos_router  # noqa: E402

app.include_router(pos_router)

# Health routes — imported at the bottom to avoid circular import
# (health_routes.py imports get_orchestrator() defined above in this file)
from api.health_routes import router as health_router  # noqa: E402

app.include_router(health_router)

# Procurement routes — HTTP trigger for draft generation (RabbitMQ-free fallback)
# Imported at the bottom because _run_draft_generation calls get_orchestrator()
from api.procurement_routes import router as procurement_router  # noqa: E402

app.include_router(procurement_router)

# Synth factory admin routes (Phase 37) — thin X-Admin-Key wrappers; dry-run default
from api.synth_routes import router as synth_router  # noqa: E402

app.include_router(synth_router)

# Toast integration routes — the six /api/v1/toast/* endpoints the NestJS
# gateway has called since 2026-04-13 against a router that was never built.
# Grouped with the bottom block for consistency with its neighbours; it has no
# circular-import constraint of its own.
from api.toast_routes import router as toast_router  # noqa: E402

app.include_router(toast_router)

# ── Admin-gated docs in production ────────────────────────────────────────────
# Registered here, after health_routes has been imported, so the one canonical
# X-Admin-Key dependency is reused rather than duplicated.
#
# Note: Swagger UI at /docs fetches /openapi.json from the browser and cannot
# attach the header, so in production /docs renders but cannot load its schema.
# That is intended — the schema is the sensitive artefact, and it stays
# retrievable via curl with the key.
if not _DOCS_PUBLIC:
    from fastapi import Depends  # noqa: E402
    from fastapi.openapi.docs import get_swagger_ui_html  # noqa: E402

    from api.health_routes import verify_admin_key  # noqa: E402

    @app.get("/openapi.json", include_in_schema=False)
    async def _protected_openapi(_key: str = Depends(verify_admin_key)):
        """OpenAPI schema — production requires X-Admin-Key."""
        return app.openapi()

    @app.get("/docs", include_in_schema=False)
    async def _protected_docs(_key: str = Depends(verify_admin_key)):
        """Swagger UI — production requires X-Admin-Key."""
        return get_swagger_ui_html(openapi_url="/openapi.json", title=app.title)
