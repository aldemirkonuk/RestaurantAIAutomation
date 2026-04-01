"""
Onboarding Routes
=================
FastAPI router for restaurant onboarding endpoints.
Includes POST /api/v1/onboarding/extract for Claude Vision menu scanning.
"""

import hashlib
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from services.claude_vision_extractor import (
    ClaudeExtractionResult,
    get_claude_vision_extractor,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])


# =============================================================================
# HELPERS
# =============================================================================

def get_supabase_client():
    """Return Supabase client from settings. Returns None if not configured."""
    try:
        from config.settings import get_settings
        settings = get_settings()
        return getattr(settings, "supabase_client", None) or getattr(settings, "supabase", None)
    except Exception:
        return None


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================

class MenuScanRequest(BaseModel):
    """Request model for POST /api/v1/onboarding/extract"""
    restaurant_id: str
    images: Optional[List[str]] = None   # list of base64 strings, one per page
    pdf_base64: Optional[str] = None     # NOT supported in Phase 1 — returns 422

    class Config:
        populate_by_name = True


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/extract")
async def extract_menu_scan(request: MenuScanRequest):
    """
    POST /api/v1/onboarding/extract

    Accepts menu images (base64, one per page), sends each to Claude Vision
    in parallel, returns structured wine JSON with cost tracking.

    Returns:
        200: All pages extracted successfully
        207: Partial success (some pages failed, some succeeded)
        422: Validation error (missing fields, unsupported input type)
        503: All pages failed extraction
    """
    # Phase 1: PDF path explicitly rejected
    if request.pdf_base64 is not None:
        raise HTTPException(
            status_code=422,
            detail="pdf_base64 not yet supported — send pre-converted page images",
        )

    # Require at least one image
    if not request.images:
        raise HTTPException(
            status_code=422,
            detail="at least one image required in 'images' list",
        )

    # Run extraction (parallel pages via asyncio.gather inside extractor)
    extractor = get_claude_vision_extractor()
    try:
        result: ClaudeExtractionResult = await extractor.extract_menu(request.images)
    except RuntimeError as e:
        # All pages failed
        logger.error(f"All pages failed for restaurant {request.restaurant_id}: {e}")
        raise HTTPException(status_code=503, detail=str(e))

    # Persist to Supabase
    supabase = get_supabase_client()
    cost_per_wine = (result.total_cost_usd / result.total_wines) if result.total_wines > 0 else 0.0

    if supabase:
        for wine in result.wines:
            try:
                sig_str = (
                    f"{wine.get('wine_name', '')}-"
                    f"{wine.get('producer', '')}-"
                    f"{wine.get('vintage', '')}"
                ).lower().strip()
                signature_hash = hashlib.sha256(sig_str.encode()).hexdigest()

                submission_payload: Dict[str, Any] = {
                    **{k: v for k, v in wine.items()
                       if k not in ("completeness_score", "needs_review")},
                    "scan_session_id": result.scan_session_id,
                    "extraction_source": "claude_vision",
                    "extraction_cost_usd": cost_per_wine,
                    "needs_review": wine.get("needs_review", False),
                    "completeness_score": wine.get("completeness_score", 0.0),
                }

                supabase.table("master_wine_library_submissions").insert({
                    "restaurant_id": request.restaurant_id,
                    "submitted_by": "claude_vision",
                    "payload": submission_payload,
                    "signature_hash": signature_hash,
                    "status": "pending_review",
                    "created_at": datetime.utcnow().isoformat(),
                }).execute()

            except Exception as e:
                logger.warning(
                    f"Failed to persist wine '{wine.get('wine_name')}' "
                    f"(session={result.scan_session_id}): {e}"
                )
                # If submitted_by UUID column type error: retry with submitted_by=None
                if "invalid input syntax for type uuid" in str(e).lower():
                    try:
                        sig_str = (
                            f"{wine.get('wine_name', '')}-"
                            f"{wine.get('producer', '')}-"
                            f"{wine.get('vintage', '')}"
                        ).lower().strip()
                        signature_hash = hashlib.sha256(sig_str.encode()).hexdigest()
                        supabase.table("master_wine_library_submissions").insert({
                            "restaurant_id": request.restaurant_id,
                            "submitted_by": None,
                            "payload": {
                                **{k: v for k, v in wine.items()
                                   if k not in ("completeness_score", "needs_review")},
                                "scan_session_id": result.scan_session_id,
                                "extraction_source": "claude_vision",
                                "extraction_cost_usd": cost_per_wine,
                                "needs_review": wine.get("needs_review", False),
                                "completeness_score": wine.get("completeness_score", 0.0),
                            },
                            "signature_hash": signature_hash,
                            "status": "pending_review",
                            "created_at": datetime.utcnow().isoformat(),
                        }).execute()
                    except Exception as e2:
                        logger.error(f"Retry insert also failed: {e2}")

    # Build response body
    response_body = {
        "scan_session_id": result.scan_session_id,
        "total_wines": result.total_wines,
        "total_cost_usd": result.total_cost_usd,
        "wines": result.wines,
        "pages_processed": result.pages_processed,
        "needs_review_count": result.needs_review_count,
        "page_errors": result.page_errors,
    }

    # HTTP 207 if partial failure (some pages failed, some wines extracted)
    if result.page_errors and result.wines:
        return JSONResponse(status_code=207, content=response_body)

    return response_body
