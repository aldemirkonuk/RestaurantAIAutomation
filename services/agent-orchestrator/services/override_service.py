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


def _decode_studio_jwt(authorization: Optional[str]) -> dict:
    """
    Verify a Bearer JWT and return its payload. Raises 401/503 — never returns unverified.

    Shared by require_studio_role() and require_authenticated_user() so there is exactly one
    place that decides whether a caller is who they say they are. The token is issued by the
    NestJS gateway (`apps/api-gateway/src/auth/auth.service.ts:435`), which signs with
    JWT_SECRET and embeds `app_metadata.roles` for exactly this consumer; that value must
    therefore equal SUPABASE_JWT_SECRET here or every studio call 401s. See ADR 0021.
    """
    import jwt as pyjwt  # PyJWT>=2.8.0
    from config.settings import get_settings

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ")
    secret = get_settings().supabase_jwt_secret
    if not secret:
        logger.error(
            "SUPABASE_JWT_SECRET not configured — studio endpoints cannot authenticate"
        )
        raise HTTPException(status_code=503, detail="Auth configuration error")
    try:
        return pyjwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"verify_aud": False},  # Supabase JWTs use anon key as audience
        )
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")


def require_authenticated_user():
    """
    FastAPI dependency factory — verifies the Bearer JWT and returns the payload, with no
    role requirement at all.

    This exists for endpoints whose authorization comes from something other than a
    pre-existing role. The only such endpoint today is POST /invite/redeem: an invitee has
    no studio role by definition — that is what the invite grants — so gating redemption on
    a studio role made the flow unusable by anyone it was meant for (ADR 0021).

    Authorization for those endpoints must come from elsewhere; redeem_invite binds it to
    the invite's target_email. "Authenticated" here means any account on the platform,
    including every restaurant user, so it is never sufficient on its own.
    """

    def _check(authorization: Optional[str] = Header(None)) -> dict:
        return _decode_studio_jwt(authorization)

    return _check


def require_studio_role(*required_roles: str):
    """
    FastAPI dependency factory — returns a callable suitable for Depends().
    Verifies Bearer JWT contains at least one required studio role.

    Strategy (two-tier):
      1. Check app_metadata.roles in the JWT (populated by Supabase JWT hook when configured).
      2. Fall back to a DB lookup on user_roles table (when JWT hook is not configured, which is
         the common dev/staging setup where roles live only in the DB).

    JWT signature is always verified against SUPABASE_JWT_SECRET.

    Usage:
        @router.post("/overrides")
        def submit(body: ..., user: dict = Depends(require_studio_role("developer", "review_admin"))):
            actor_id = user["sub"]
    """

    def _check(authorization: Optional[str] = Header(None)) -> dict:
        payload = _decode_studio_jwt(authorization)

        # Tier 1: JWT app_metadata.roles (populated by Supabase JWT hook if configured)
        app_meta = payload.get("app_metadata", {})
        jwt_roles = app_meta.get("roles", [])
        if any(r in jwt_roles for r in required_roles):
            return payload

        # Tier 2: DB fallback — query user_roles table when JWT hook is not configured
        user_id = payload.get("sub")
        if user_id:
            supabase = _get_supabase()
            if supabase:
                try:
                    resp = (
                        supabase.table("user_roles")
                        .select("role")
                        .eq("user_id", user_id)
                        .is_("revoked_at", "null")
                        .execute()
                    )
                    db_roles = [r["role"] for r in (resp.data or [])]
                    if any(r in db_roles for r in required_roles):
                        # Attach DB roles so downstream helpers (_get_primary_studio_role etc.) can read them
                        payload.setdefault("app_metadata", {})["roles"] = db_roles
                        return payload
                    jwt_roles = db_roles  # show accurate roles in error message
                except Exception as exc:
                    logger.warning(
                        "require_studio_role: DB role fallback failed for %s: %s",
                        user_id,
                        exc,
                    )

        raise HTTPException(
            status_code=403,
            detail=f"Requires one of: {list(required_roles)}. Your roles: {jwt_roles}",
        )

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
    """
    POST /api/v1/studio/invite request body.

    target_email is REQUIRED (ADR 0021). It was optional and written but never read, so the
    token alone authorized the grant — anyone it reached could claim the role, up to and
    including review_admin. redeem_invite now checks the redeeming JWT's email against it,
    which only works if minting cannot produce an unbound token.
    """

    role: str = Field(..., pattern="^(developer|certified_contributor|review_admin)$")
    target_email: str = Field(
        ..., min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    )


class RedeemRequest(BaseModel):
    """POST /api/v1/studio/invite/redeem request body. Token in body, never query string (Pitfall 2)."""

    token: str  # UUID string of the invite token


def normalize_email(value: Optional[str]) -> str:
    """Casefold + strip for comparison. Returns "" for None so callers fail closed on absence."""
    return value.strip().casefold() if isinstance(value, str) else ""


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


def _apply_override_to_submission(
    supabase, submission_id: str, field_name: str, new_value: str, actor_id: str
) -> None:
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
        logger.error(
            "_apply_override_to_submission: cannot import merge_field_confidence: %s",
            exc,
        )
        raise RuntimeError(f"field_confidence module unavailable: {exc}")

    try:
        resp = (
            supabase.table("master_wine_library_submissions")
            .select("field_confidence")
            .eq("id", submission_id)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            raise ValueError(f"Submission {submission_id} not found")
        existing_fc = (resp.data or {}).get("field_confidence") or {}
    except Exception as exc:
        logger.error(
            "_apply_override_to_submission: fetch submission %s failed: %s",
            submission_id,
            exc,
        )
        raise

    new_entry = {
        field_name: {"value": new_value, "confidence": 1.0, "source": "human_override"}
    }
    merged = merge_field_confidence(existing_fc, new_entry)

    supabase.table("master_wine_library_submissions").update(
        {"field_confidence": merged}
    ).eq("id", submission_id).execute()
    logger.info(
        "Applied override to submission %s field=%s by actor=%s",
        submission_id,
        field_name,
        actor_id,
    )


def _fc_value(fc, field_name):
    """Extract value from field_confidence entry, or None."""
    entry = fc.get(field_name)
    if not entry:
        return None
    return entry.get("value") if isinstance(entry, dict) else entry


def _maybe_promote_submission(supabase, submission_id: str) -> bool:
    """
    Attempt to promote a studio-approved submission to master_wine_library.

    Promotion is gated by three conditions (D-05):
      1. Submission status must be "pending_review" (not already decided)
      2. No remaining pending fields in field_review_queue
      3. should_auto_block(fc) returns False

    T-14-07: Only called after require_studio_role() has already verified the actor's role.
    T-14-08: Entire function is wrapped in try/except — promotion failure is non-fatal;
             the override response still succeeds.
    T-14-09: Promotion values come from server-side field_confidence JSONB, not user input.

    Returns True if the submission was promoted, False otherwise.
    """
    try:
        from services.field_confidence import should_auto_block, JSONB_ENRICHMENT_KEYS
        from datetime import datetime, timezone

        jsonb_cols = ", ".join(JSONB_ENRICHMENT_KEYS)
        resp = (
            supabase.table("master_wine_library_submissions")
            .select(
                f"id, payload, field_confidence, status, auto_blocked, restaurant_id, {jsonb_cols}"
            )
            .eq("id", submission_id)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            logger.warning(
                "_maybe_promote_submission: submission %s not found", submission_id
            )
            return False

        submission = resp.data
        if submission.get("status") != "pending_review":
            logger.debug(
                "_maybe_promote_submission: submission %s not in pending_review (status=%s)",
                submission_id,
                submission.get("status"),
            )
            return False

        # Gate 2: no remaining pending fields
        pending_resp = (
            supabase.table("field_review_queue")
            .select("id", count="exact")
            .eq("submission_id", submission_id)
            .eq("status", "pending")
            .execute()
        )
        remaining_pending = pending_resp.count or 0
        if remaining_pending > 0:
            logger.debug(
                "_maybe_promote_submission: %d pending fields remain for %s",
                remaining_pending,
                submission_id,
            )
            return False

        # Gate 3: field confidence ratio not auto-blocked
        fc = submission.get("field_confidence") or {}
        if should_auto_block(fc):
            logger.debug(
                "_maybe_promote_submission: submission %s is auto_blocked",
                submission_id,
            )
            return False

        # Build promotion row — mirrors quality_routes.patch_review_queue mapping (D-20)
        now_iso = datetime.now(timezone.utc).isoformat()
        promo_row = {
            "restaurant_id": submission.get("restaurant_id"),
            "submission_id": submission_id,
            "name": _fc_value(fc, "wine_name"),
            "producer": _fc_value(fc, "producer"),
            "vintage": _fc_value(fc, "vintage"),
            "region": _fc_value(fc, "region"),
            "sub_region": _fc_value(fc, "sub_region"),
            "appellation": _fc_value(fc, "appellation"),
            "country": _fc_value(fc, "country"),
            "grape_variety": _fc_value(fc, "grape_variety"),
            "wine_type": _fc_value(fc, "primary_type"),
            "color": _fc_value(fc, "color"),
            "alcohol_pct": _fc_value(fc, "alcohol_pct"),
            "sweetness_level": _fc_value(fc, "sweetness_level"),
            "tasting_notes": _fc_value(fc, "tasting_notes"),
            "description": _fc_value(fc, "description"),
            "food_pairing": _fc_value(fc, "food_pairing"),
            "producer_bio": _fc_value(fc, "producer_bio"),
            "avg_price": _fc_value(fc, "price_bottle"),
            "price_glass": _fc_value(fc, "price_glass"),
            "section_name": _fc_value(fc, "section_name"),
            "bin_number": _fc_value(fc, "bin_number"),
            "source": "studio_approved",
            "ai_enriched": True,
            "enrichment_source": "haiku",
            "created_at": now_iso,
        }
        for jk in JSONB_ENRICHMENT_KEYS:
            promo_row[jk] = submission.get(jk) or {}

        supabase.table("master_wine_library").insert(promo_row).execute()

        supabase.table("master_wine_library_submissions").update(
            {"status": "approved"}
        ).eq("id", submission_id).execute()

        logger.info(
            "_maybe_promote_submission: promoted submission %s → master_wine_library",
            submission_id,
        )
        return True

    except Exception as exc:
        logger.error("_maybe_promote_submission: failed for %s: %s", submission_id, exc)
        return False


def check_and_update_trust(
    supabase, user_id: str, approved: bool, threshold: int = 5
) -> None:
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
                .maybe_single()
                .execute()
            )
            count = (
                (ur_resp.data or {}).get("consecutive_approved_overrides", 0)
                if ur_resp.data
                else 0
            )
            if count >= threshold:
                supabase.table("user_roles").update(
                    {
                        "promotion_policy": "auto_promote",
                        "auto_promote_earned_at": "now()",
                    }
                ).eq("user_id", user_id).eq("role", "certified_contributor").execute()
                logger.info(
                    "User %s earned auto_promote status (threshold=%d)",
                    user_id,
                    threshold,
                )
        else:
            # Rejection resets streak
            supabase.table("user_roles").update(
                {"consecutive_approved_overrides": 0}
            ).eq("user_id", user_id).eq("role", "certified_contributor").execute()
            logger.info("User %s trust streak reset (rejection)", user_id)
    except Exception as exc:
        logger.error("check_and_update_trust failed for %s: %s", user_id, exc)
        raise
