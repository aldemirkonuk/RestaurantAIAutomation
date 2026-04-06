"""
Agent Orchestrator — FastAPI Application Entry Point
====================================================
Registers all routers for the WineOps agent orchestration service.
"""

import logging

from fastapi import FastAPI

from api.onboarding_routes import router as onboarding_router
from api.quality_routes import router as quality_router
from api.research_routes import research_router
from api.scan_routes import router_preview as preview_router
from api.analytics_routes import router as analytics_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="WineOps Agent Orchestrator",
    description="Orchestrates AI agents for restaurant wine management.",
    version="1.0.0",
)

# Register routers
app.include_router(onboarding_router)
app.include_router(quality_router)
app.include_router(research_router)
app.include_router(preview_router)
app.include_router(analytics_router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}
