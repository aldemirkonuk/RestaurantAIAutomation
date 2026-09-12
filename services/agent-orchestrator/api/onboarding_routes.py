"""
Onboarding Routes
=================
FastAPI router for restaurant onboarding endpoints.
Includes POST /api/v1/onboarding/extract for Claude Vision menu scanning.
"""

import hashlib
import logging
import smtplib
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.auth import require_admin_or_studio
from services.log_safety import sanitize_for_log
from services.claude_vision_extractor import (
    ClaudeExtractionResult,
    get_claude_vision_extractor,
)
from services.field_confidence import (
    route_fields_by_threshold,
    should_auto_block,
)
from jobs.haiku_tasks import haiku_enrich_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])

# Per-restaurant cost cap (USD) — HTTP 402 returned when exceeded
PER_RESTAURANT_CAP_USD = 2.00

# Auto-block threshold — wines below this completeness are held from promotion
AUTO_BLOCK_THRESHOLD = 0.3


# =============================================================================
# HELPERS
# =============================================================================


def _needs_enrichment(wine: dict) -> bool:
    """Return True if wine is missing any of region, country, grape_variety."""
    return not all(
        [
            wine.get("region"),
            wine.get("country"),
            wine.get("grape_variety"),
        ]
    )


class CapLedgerUnavailable(Exception):
    """The spend ledger could not be read, so the cap cannot be enforced.

    Raised — never swallowed — because an unreadable ledger must not be
    indistinguishable from "$0.00 spent". This endpoint bills the Anthropic
    account on every call; the only safe reading of "I don't know how much has
    been spent" is to refuse the call.
    """


def _preflight_cap_check(supabase, cap_key: str) -> float:
    """
    Query total extraction spend for this cap key from api_spend.
    Returns cumulative cost_usd.

    FAIL CLOSED: a query error raises CapLedgerUnavailable, which the endpoint
    turns into HTTP 503. This function used to return 0.0 on any exception,
    which meant a single Supabase hiccup silently removed the only spend limit
    on a paid-LLM endpoint. "Never block on infra error" is the wrong trade when
    the thing not being blocked is unbounded spend.
    """
    try:
        resp = (
            supabase.table("api_spend")
            .select("cost_usd")
            .eq("restaurant_id", cap_key)
            .execute()
        )
        if resp.data:
            return sum(row.get("cost_usd", 0.0) or 0.0 for row in resp.data)
        return 0.0
    except Exception as exc:
        # cap_key derives from the request (restaurant id) — escaped so it cannot
        # forge a second log entry (CodeQL py/log-injection).
        logger.error(
            "preflight_cap_check failed for %s — failing CLOSED: %s",
            sanitize_for_log(cap_key),
            exc,
        )
        raise CapLedgerUnavailable(str(exc)) from exc


def _resolve_cap_key(caller: dict, supabase, requested_restaurant_id: str) -> str:
    """Decide which restaurant the spend is billed against — server-side.

    The cap used to be keyed on `request.restaurant_id`, a value the caller
    supplies, so rotating one string reset the limit. The key must come from the
    caller's authenticated identity instead:

      * admin-key callers are the gateway and internal jobs. They are trusted
        server-to-server principals and already resolved the tenant before
        calling, so their body field is authoritative.
      * studio JWT callers are browsers. Their body field is ignored entirely;
        the restaurant is looked up from `users.user_id == <jwt sub>`, the same
        join api/studio_routes.py:355 already uses for actor identity.

    Raises CapLedgerUnavailable if the lookup fails (fail closed), and 403 if the
    authenticated user has no restaurant — spend that cannot be attributed
    cannot be capped, so it is not permitted.
    """
    if caller.get("kind") == "admin":
        return requested_restaurant_id

    subject = caller.get("subject")
    try:
        resp = (
            supabase.table("users")
            .select("restaurant_id")
            .eq("user_id", subject)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        # subject is a JWT claim: verified, but verified is not newline-free.
        logger.error(
            "cap key lookup failed for user %s — failing CLOSED: %s",
            sanitize_for_log(subject),
            exc,
        )
        raise CapLedgerUnavailable(str(exc)) from exc

    rows = resp.data or []
    resolved = rows[0].get("restaurant_id") if rows else None
    if not resolved:
        raise HTTPException(
            status_code=403,
            detail=(
                "No restaurant is linked to this account, so extraction spend "
                "cannot be attributed or capped. Ask an admin to link your user "
                "to a restaurant."
            ),
        )
    return str(resolved)


def _send_cap_alert_email(restaurant_id: str, spend: float) -> None:
    """Send per-restaurant cap breach alert email. Non-fatal."""
    try:
        from config.settings import get_settings

        settings = get_settings()
        if not all(
            [settings.manager_email, settings.gmail_user, settings.gmail_password]
        ):
            return
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[WineOps] Per-Restaurant Cap Reached — {restaurant_id[:8]}"
        msg["From"] = settings.gmail_user
        msg["To"] = settings.manager_email
        body = (
            f"Restaurant {restaurant_id} has reached the per-restaurant extraction cap.\n\n"
            f"Cumulative spend: ${spend:.4f}\n"
            f"Cap threshold:    ${PER_RESTAURANT_CAP_USD:.2f}\n\n"
            f"Further extraction requests for this restaurant will return HTTP 402 "
            f"until the cap is reset.\n"
        )
        msg.attach(MIMEText(body, "plain"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as server:
            server.login(settings.gmail_user, settings.gmail_password)
            server.sendmail(
                settings.gmail_user, settings.manager_email, msg.as_string()
            )
        # Called with cap_key, which is request.restaurant_id verbatim on the
        # admin-key path — same taint as the other two sites in this module.
        logger.info(
            "Cap alert email sent for restaurant %s (spend=%.4f)",
            sanitize_for_log(restaurant_id),
            spend,
        )
    except Exception as exc:
        logger.warning("Failed to send cap alert email: %s", exc)


def get_supabase_client():
    """Return Supabase client from settings. Returns None if not configured."""
    try:
        from config.settings import get_settings

        settings = get_settings()
        return getattr(settings, "supabase_client", None) or getattr(
            settings, "supabase", None
        )
    except Exception:
        return None


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================


class MenuScanRequest(BaseModel):
    """Request model for POST /api/v1/onboarding/extract"""

    restaurant_id: str
    images: Optional[List[str]] = None  # list of base64 page images (PNG/JPEG)
    pdf_base64: Optional[str] = None  # raw PDF base64 — routed to extract_pdf()

    class Config:
        populate_by_name = True


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.post("/extract")
async def extract_menu_scan(
    request: MenuScanRequest,
    caller: dict = Depends(require_admin_or_studio),
):
    """
    POST /api/v1/onboarding/extract

    Accepts menu images (base64, one per page), sends each to Claude Vision
    in parallel, returns structured wine JSON with cost tracking.

    AUTHENTICATION REQUIRED (X-Admin-Key or a studio-role Bearer token). This
    endpoint bills the Anthropic account on every call; it was reachable
    anonymously on the public Railway host until this was added.

    Returns:
        200: All pages extracted successfully
        207: Partial success (some pages failed, some succeeded)
        401: No/invalid credentials
        402: Per-restaurant spend cap exceeded
        403: Authenticated, but no restaurant to attribute the spend to
        422: Validation error (missing fields, unsupported input type)
        503: All pages failed extraction, or the spend ledger is unreadable
    """
    # Require either pdf_base64 or at least one image
    if not request.pdf_base64 and not request.images:
        raise HTTPException(
            status_code=422,
            detail="Provide either 'pdf_base64' (raw PDF) or 'images' (list of page base64)",
        )

    # Pre-flight per-restaurant cap check (COST-03).
    #
    # FAIL CLOSED throughout: no Supabase client means no ledger, which means the
    # cap cannot be enforced, which means the call is refused. Previously a
    # missing client skipped the check entirely and the extraction ran uncapped.
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(
            status_code=503,
            detail="Spend ledger unavailable — extraction refused (fail closed).",
        )

    # Key the cap on the authenticated identity, not on a request-body field.
    cap_key = _resolve_cap_key(caller, supabase, request.restaurant_id)
    try:
        prior_spend = _preflight_cap_check(supabase, cap_key)
    except CapLedgerUnavailable:
        raise HTTPException(
            status_code=503,
            detail="Spend ledger unavailable — extraction refused (fail closed).",
        )
    if prior_spend > PER_RESTAURANT_CAP_USD:
        _send_cap_alert_email(cap_key, prior_spend)
        raise HTTPException(
            status_code=402,
            detail=(
                f"Per-restaurant extraction cap exceeded "
                f"(spent ${prior_spend:.4f}, cap ${PER_RESTAURANT_CAP_USD:.2f}). "
                f"Contact support to reset."
            ),
        )

    # Run extraction — PDF native path or image pages path
    extractor = get_claude_vision_extractor()
    try:
        if request.pdf_base64:
            import base64 as _b64
            import binascii

            try:
                pdf_bytes = _b64.b64decode(request.pdf_base64)
            except (binascii.Error, ValueError) as exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid base64 in 'pdf_base64': {exc}",
                )
            result: ClaudeExtractionResult = await extractor.extract_pdf(
                pdf_bytes, cap_key
            )
        else:
            result: ClaudeExtractionResult = await extractor.extract_menu(
                request.images, restaurant_id=cap_key
            )
    except RuntimeError as e:
        logger.error(
            "All pages failed for restaurant %s: %s", sanitize_for_log(cap_key), e
        )
        raise HTTPException(status_code=503, detail=str(e))

    # Persist to Supabase (client already fetched and proven non-None above).
    cost_per_wine = (
        (result.total_cost_usd / result.total_wines) if result.total_wines > 0 else 0.0
    )

    if supabase:
        for wine in result.wines:
            try:
                # Build signature hash for deduplication
                sig_str = (
                    (
                        f"{wine.get('wine_name', '')}-"
                        f"{wine.get('producer', '')}-"
                        f"{wine.get('vintage', '')}"
                    )
                    .lower()
                    .strip()
                )
                signature_hash = hashlib.sha256(sig_str.encode()).hexdigest()
                # Reset per-wine submission_id so it is always freshly set from the insert response
                wine.pop("submission_id", None)

                # Phase 7: 3-tier field_confidence routing (FCONF-04)
                fc: Dict[str, Any] = wine.get("field_confidence") or {}
                accepted_fields, review_items, _rejected_fields = (
                    route_fields_by_threshold(fc)
                )

                # auto_blocked: field-ratio logic (CONTEXT.md D-02) — replaces old completeness threshold
                auto_blocked = (
                    should_auto_block(fc)
                    if fc
                    else (wine.get("completeness_score", 0.0) < AUTO_BLOCK_THRESHOLD)
                )

                # Payload: start from flat accepted fields, augment with session metadata
                # Rejected fields are omitted (left NULL in DB)
                _excluded = {"completeness_score", "needs_review", "field_confidence"}
                submission_payload: Dict[str, Any] = {
                    **{k: v for k, v in accepted_fields.items()},
                    "scan_session_id": result.scan_session_id,
                    "extraction_source": "claude_vision",
                    "extraction_cost_usd": cost_per_wine,
                    "needs_review": wine.get("needs_review", False),
                    "completeness_score": wine.get("completeness_score", 0.0),
                }

                insert_resp = (
                    supabase.table("master_wine_library_submissions")
                    .insert(
                        {
                            # Server-resolved, never the caller-supplied body
                            # field: a studio user must not be able to write
                            # submissions into another tenant by editing JSON.
                            "restaurant_id": cap_key,
                            "submitted_by": "claude_vision",
                            "payload": submission_payload,
                            "field_confidence": fc or None,
                            "signature_hash": signature_hash,
                            "status": "pending_review",
                            "auto_blocked": auto_blocked,
                            "created_at": datetime.utcnow().isoformat(),
                        }
                    )
                    .execute()
                )

                # Stamp the real Supabase UUID onto the wine so the frontend
                # can use it as submission_id for override requests.
                if insert_resp.data:
                    wine["submission_id"] = insert_resp.data[0]["id"]

                # Insert field_review_queue rows for mid-confidence fields (FCONF-05)
                if insert_resp.data and review_items:
                    submission_id = insert_resp.data[0]["id"]
                    queue_rows = [
                        {
                            "submission_id": submission_id,
                            "field_name": item["field_name"],
                            "current_value": item["current_value"],
                            "confidence": item["confidence"],
                            "source": item["source"],
                            "status": "pending",
                        }
                        for item in review_items
                    ]
                    try:
                        supabase.table("field_review_queue").insert(
                            queue_rows
                        ).execute()
                        logger.debug(
                            "Inserted %d field_review_queue rows for submission %s",
                            len(queue_rows),
                            submission_id,
                        )
                    except Exception as qe:
                        logger.warning(
                            "field_review_queue insert failed (non-fatal): %s", qe
                        )

                # Queue Haiku enrichment for wines missing region/country/grape_variety
                if insert_resp.data and _needs_enrichment(wine):
                    submission_id = insert_resp.data[0]["id"]
                    # Extract flat wine_name / vintage from FC or top-level
                    _wine_name = accepted_fields.get("wine_name") or wine.get(
                        "wine_name", ""
                    )
                    _vintage_raw = accepted_fields.get("vintage") or wine.get("vintage")
                    haiku_enrich_task.delay(
                        wine_id=submission_id,
                        wine_name=_wine_name,
                        vintage=str(_vintage_raw) if _vintage_raw else None,
                    )
                    logger.info(
                        "Queued haiku enrichment for submission_id=%s wine='%s'",
                        submission_id,
                        _wine_name,
                    )

            except Exception as e:
                logger.warning(
                    "Failed to persist wine '%s' (session=%s): %s",
                    wine.get("wine_name"),
                    result.scan_session_id,
                    e,
                )
                # Retry without submitted_by UUID if column type error
                if "invalid input syntax for type uuid" in str(e).lower():
                    try:
                        sig_str = (
                            (
                                f"{wine.get('wine_name', '')}-"
                                f"{wine.get('producer', '')}-"
                                f"{wine.get('vintage', '')}"
                            )
                            .lower()
                            .strip()
                        )
                        signature_hash = hashlib.sha256(sig_str.encode()).hexdigest()
                        supabase.table("master_wine_library_submissions").insert(
                            {
                                "restaurant_id": cap_key,
                                "submitted_by": None,
                                "payload": submission_payload,
                                "field_confidence": fc or None,
                                "signature_hash": signature_hash,
                                "status": "pending_review",
                                "created_at": datetime.utcnow().isoformat(),
                            }
                        ).execute()
                    except Exception as e2:
                        logger.error("Retry insert also failed: %s", e2)

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
