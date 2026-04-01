"""
Agent Orchestrator — FastAPI Application Entry Point
====================================================
Registers all routers for the WineOps agent orchestration service.
"""

import logging

from fastapi import FastAPI

from api.onboarding_routes import router as onboarding_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="WineOps Agent Orchestrator",
    description="Orchestrates AI agents for restaurant wine management.",
    version="1.0.0",
)

# Register routers
app.include_router(onboarding_router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}
