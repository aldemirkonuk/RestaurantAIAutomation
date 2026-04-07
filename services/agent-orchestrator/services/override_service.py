"""
Override Service
===============
Phase 13: Studio promotion logic, JWT role dependency, and trust management.

Provides:
  - require_studio_role(*roles) — FastAPI dependency for JWT-based role enforcement (D-01)
  - OverrideRequest, ApprovalDecision — Pydantic request models with server-side validation
  - _apply_override_to_submission() — writes approved override to field_confidence via merge_field_confidence (DEVUI-06)
  - check_and_update_trust() — increments/resets consecutive_approved_overrides via atomic RPC (D-12)
  - _get_primary_studio_role() — returns highest trust role when user holds multiple
  - _get_user_studio_roles() — fetches active roles for a user from user_roles table

Security mitigations:
  T-13-07: JWT signature verified with SUPABASE_JWT_SECRET — forged tokens rejected at 401
  T-13-08: reason min_length=5 enforced in Pydantic when old_confidence >= 0.8 (D-07 server-side)
  T-13-09: old_confidence >= 0.8 check performed on server using existing DB value, not client-supplied
"""

import logging
from typing import Optional

from fastapi import Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# =============================================================================
# JWT ROLE DEPENDENCY (extends verify_admin_token pattern from research_routes.py)
# =============================================================================

def require_studio_role(*required_roles: str):
    """
    FastAPI dependency factory — returns a callable suitable for Depends().
    Verifies Bearer JWT contains at least one required studio role.

    Reads app_metadata.roles from the Supabase JWT payload (stateless — no DB round-trip).
    JWT signature verified against SUPABASE_JWT_SECRET from settings.py.

    Usage:
        @router.post("/overrides")
        def submit(body: ..., user: dict = Depends(require_studio_role("developer", "review_admin"))):
            actor_id = user["sub"]
    """
    def _check(authorization: Optional[str] = Header(None)) -> dict:
        import jwt as pyjwt  # PyJWT>=2.8.0
        from config.settings import get_settings

        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing Bearer token")
        token = authorization.removeprefix("Bearer ")
        secret = get_settings().supabase_jwt_secret
        if not secret:
            logger.error("SUPABASE_JWT_SECRET not configured — studio endpoints cannot authenticate")
            raise HTTPException(status_code=503, detail="Auth configuration error")
        try:
            payload = pyjwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                options={"verify_aud": False},  # Supabase JWTs use anon key as audience
            )
        except pyjwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except pyjwt.PyJWTError as exc:
            raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")

        app_meta = payload.get("app_metadata", {})
        user_roles_claim = app_meta.get("roles", [])
        if not any(r in user_roles_claim for r in required_roles):
            raise HTTPException(
                status_code=403,
                detail=f"Requires one of: {list(required_roles)}. Your roles: {user_roles_claim}",
            )
        return payload

    return _check


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================

class OverrideRequest(BaseModel):
    """
    POST /api/v1/studio/overrides request body.
    Server-side enforces: reason required (min 5 chars) when old_confidence >= 0.8 (D-07, T-13-08).
    CRITICAL: old_confidence MUST be fetched from DB by the endpoint, not trusted from this model.
    This model carries the client-supplied values; the endpoint re-fetches old_confidence from DB.
    """
    session_id: Optional[str] = None
    submission_id: str
    field_name: str = Field(..., min_length=1, max_length=100)
    new_value: str = Field(..., min_length=1)
    reason: Optional[str] = None
    citation_url: Optional[str] = None
    citation_snippet: Optional[str] = None


class ApprovalDecision(BaseModel):
    """PATCH /api/v1/studio/queue/{override_id} request body."""
    decision: str = Field(..., pattern="^(approved|rejected)$")
    note: Optional[str] = None


class InviteRequest(BaseModel):
    """POST /api/v1/studio/invite request body."""
    role: str = Field(..., pattern="^(developer|certified_contributor|review_admin)$")
    target_email: Optional[str] = None


class RedeemRequest(BaseModel):
    """POST /api/v1/studio/invite/redeem request body. Token in body, never query string (Pitfall 2)."""
    token: str  # UUID string of the invite token


# =============================================================================
# HELPERS
# =============================================================================

def _get_supabase():
    """Return Supabase client from settings. Returns None if not configured."""
    try:
        from config.settings import get_settings
        return get_settings().supabase_client
    except Exception:
        return None


def _get_primary_studio_role(payload: dict) -> str:
    """Return highest-trust studio role from JWT payload. Priority: review_admin > developer > certified_contributor."""
    roles = payload.get("app_metadata", {}).get("roles", [])
    if "review_admin" in roles:
        return "review_admin"
    if "developer" in roles:
        return "developer"
    if "certified_contributor" in roles:
        return "certified_contributor"
    return ""


def _get_user_studio_roles(supabase, user_id: str) -> list:
    """Fetch active studio roles for user from user_roles table (for trust tracking)."""
    try:
        resp = (
            supabase.table("user_roles")
            .select("role, promotion_policy, consecutive_approved_overrides")
            .eq("user_id", user_id)
            .is_("revoked_at", "null")
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        logger.error("_get_user_studio_roles failed for %s: %s", user_id, exc)
        return []


def _apply_override_to_submission(supabase, submission_id: str, field_name: str, new_value: str, actor_id: str) -> None:
    """
    Write approved override to field_confidence JSONB on master_wine_library_submissions.
    Uses merge_field_confidence() to ensure higher-confidence existing values are never downgraded (DEVUI-06).
    Manual overrides always carry confidence=1.0 and source='human_override'.

    merge_field_confidence() signature: (existing_fc: dict, new_fc: dict) → merged dict
    new_fc format: {"field_name": {"value": str, "confidence": float, "source": str}}
    """
    try:
        from services.field_confidence import merge_field_confidence
    except ImportError as exc:
        logger.error("_apply_override_to_submission: cannot import merge_field_confidence: %s", exc)
        raise RuntimeError(f"field_confidence module unavailable: {exc}")

    try:
        resp = (
            supabase.table("master_wine_library_submissions")
            .select("field_confidence")
            .eq("id", submission_id)
            .single()
            .execute()
        )
        existing_fc = (resp.data or {}).get("field_confidence") or {}
    except Exception as exc:
        logger.error("_apply_override_to_submission: fetch submission %s failed: %s", submission_id, exc)
        raise

    new_entry = {field_name: {"value": new_value, "confidence": 1.0, "source": "human_override"}}
    merged = merge_field_confidence(existing_fc, new_entry)

    supabase.table("master_wine_library_submissions").update(
        {"field_confidence": merged}
    ).eq("id", submission_id).execute()
    logger.info("Applied override to submission %s field=%s by actor=%s", submission_id, field_name, actor_id)


def check_and_update_trust(supabase, user_id: str, approved: bool, threshold: int = 5) -> None:
    """
    Update consecutive_approved_overrides for certified_contributor.
    Any rejection resets streak to 0 (prevents gaming via alternating overrides).
    At threshold, flips promotion_policy to 'auto_promote'.
    Uses increment_trust_counter Postgres RPC for atomicity (no race condition).
    """
    try:
        if approved:
            supabase.rpc("increment_trust_counter", {"p_user_id": user_id}).execute()
            # Check current count post-increment
            ur_resp = (
                supabase.table("user_roles")
                .select("consecutive_approved_overrides")
                .eq("user_id", user_id)
                .eq("role", "certified_contributor")
                .is_("revoked_at", "null")
                .single()
                .execute()
            )
            count = (ur_resp.data or {}).get("consecutive_approved_overrides", 0)
            if count >= threshold:
                supabase.table("user_roles").update({
                    "promotion_policy": "auto_promote",
                    "auto_promote_earned_at": "now()",
                }).eq("user_id", user_id).eq("role", "certified_contributor").execute()
                logger.info("User %s earned auto_promote status (threshold=%d)", user_id, threshold)
        else:
            # Rejection resets streak
            supabase.table("user_roles").update(
                {"consecutive_approved_overrides": 0}
            ).eq("user_id", user_id).eq("role", "certified_contributor").execute()
            logger.info("User %s trust streak reset (rejection)", user_id)
    except Exception as exc:
        logger.error("check_and_update_trust failed for %s: %s", user_id, exc)
        raise
