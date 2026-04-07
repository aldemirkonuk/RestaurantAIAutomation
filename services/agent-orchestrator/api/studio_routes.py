"""
Studio Routes
=============
Phase 13: Dev Onboarding UI with Manual Override Access.

Endpoints:
  POST   /api/v1/studio/sessions                          — Start new ingestion session
  GET    /api/v1/studio/sessions/{id}                     — Get session timeline (DEVUI-08)
  POST   /api/v1/studio/overrides                         — Submit field override (DEVUI-05, D-12/D-13)
  GET    /api/v1/studio/queue                             — Pending approval queue (review_admin only)
  PATCH  /api/v1/studio/queue/{override_id}               — Approve or reject override
  POST   /api/v1/studio/invite                            — Generate invite token (review_admin only)
  POST   /api/v1/studio/invite/redeem                     — Redeem invite token (any authenticated user)
  GET    /api/v1/studio/metrics                           — Manual-authoring KPIs (DEVUI-09)
  GET    /api/v1/studio/me/roles                          — Current user's studio roles (no role restriction)
  GET    /api/v1/studio/contributors                      — List certified contributors (review_admin only)
  PATCH  /api/v1/studio/contributors/{user_id}/revoke     — Revoke contributor access
  PATCH  /api/v1/studio/contributors/{user_id}/enable     — Re-enable revoked contributor
  PATCH  /api/v1/studio/contributors/{user_id}/disable    — Disable contributor (alias for revoke)

Security:
  T-13-07: JWT verified via require_studio_role() in every endpoint
  T-13-10: Invite token brute-force: token is UUID (128-bit) — 10^38 combinations
  T-13-11: Reason bypass: validated server-side via DB old_confidence check, not client input
  T-13-12: Session leakage: actor_id == user["sub"] OR role in (review_admin, developer)
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from services.override_service import (
    require_studio_role,
    OverrideRequest,
    ApprovalDecision,
    InviteRequest,
    RedeemRequest,
    _get_supabase,
    _get_primary_studio_role,
    _get_user_studio_roles,
    _apply_override_to_submission,
    check_and_update_trust,
)

logger = logging.getLogger(__name__)

studio_router = APIRouter(prefix="/api/v1/studio", tags=["studio"])


class SessionCreateRequest(BaseModel):
    source_type: str  # 'pdf_upload' | 'url_crawl' | 'manual_seed'
    source_ref: Optional[str] = None
    scan_session_id: Optional[str] = None


# --- POST /sessions ---
@studio_router.post("/sessions")
def create_session(
    body: SessionCreateRequest,
    user: dict = Depends(require_studio_role("developer", "certified_contributor", "review_admin")),
):
    """Start a new onboarding session — records actor, source type, and optional scan_session_id."""
    if body.source_type not in ("pdf_upload", "url_crawl", "manual_seed"):
        raise HTTPException(status_code=422, detail="source_type must be pdf_upload, url_crawl, or manual_seed")
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        resp = supabase.table("onboarding_sessions").insert({
            "actor_id": user["sub"],
            "source_type": body.source_type,
            "source_ref": body.source_ref,
            "scan_session_id": body.scan_session_id,
            "status": "active",
        }).execute()
        return {"session": resp.data[0] if resp.data else {}}
    except Exception as exc:
        logger.error("create_session failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to create session")


# --- GET /sessions/{id} ---
@studio_router.get("/sessions/{session_id}")
def get_session_timeline(
    session_id: str,
    user: dict = Depends(require_studio_role("developer", "certified_contributor", "review_admin")),
):
    """
    GET /api/v1/studio/sessions/{id} — returns full session timeline (DEVUI-08).
    Includes: session metadata + chronological override_events for that session.
    T-13-12: actor_id == user["sub"] OR role in (review_admin, developer).
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        session_resp = (
            supabase.table("onboarding_sessions")
            .select("*")
            .eq("id", session_id)
            .maybe_single()
            .execute()
        )
        if not session_resp.data:
            raise HTTPException(status_code=404, detail="Session not found")
        session = session_resp.data

        # T-13-12: enforce visibility
        role = _get_primary_studio_role(user)
        if session["actor_id"] != user["sub"] and role not in ("review_admin", "developer"):
            raise HTTPException(status_code=403, detail="Not authorized to view this session")

        events_resp = (
            supabase.table("override_events")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=False)
            .execute()
        )
        return {
            "session": session,
            "events": events_resp.data or [],
            "event_count": len(events_resp.data or []),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_session_timeline failed for %s: %s", session_id, exc)
        raise HTTPException(status_code=503, detail="Database query failed")


# --- POST /overrides ---
@studio_router.post("/overrides")
def submit_override(
    body: OverrideRequest,
    user: dict = Depends(require_studio_role("developer", "certified_contributor", "review_admin")),
):
    """
    Submit a field override. Implements D-12/D-13 promotion policy.
    D-07 server-side: fetches old_confidence from DB; requires reason (min 5 chars) if >= 0.8.
    D-15: always logs to override_events regardless of promotion path.
    D-13: developer/review_admin → auto_promoted instantly.
    D-12: certified_contributor → pending (queue) unless promotion_policy == 'auto_promote'.
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # T-13-11: Fetch old_confidence from DB (server-side check, not client-supplied)
    old_confidence = None
    old_value = None
    try:
        sub_resp = (
            supabase.table("master_wine_library_submissions")
            .select("field_confidence")
            .eq("id", body.submission_id)
            .maybe_single()
            .execute()
        )
        if not sub_resp.data:
            raise HTTPException(status_code=404, detail="Submission not found")
        fc = sub_resp.data.get("field_confidence") or {}
        field_entry = fc.get(body.field_name)
        if field_entry and isinstance(field_entry, dict):
            old_confidence = field_entry.get("confidence")
            old_value = field_entry.get("value")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("submit_override: fetch submission %s failed: %s", body.submission_id, exc)
        raise HTTPException(status_code=503, detail="Failed to fetch submission")

    # D-07 server-side reason enforcement
    if old_confidence is not None and float(old_confidence) >= 0.8:
        if not body.reason or len(body.reason.strip()) < 5:
            raise HTTPException(
                status_code=422,
                detail="reason is required (min 5 chars) when overriding a field with confidence >= 0.8",
            )

    # Determine promotion path (D-12/D-13)
    role = _get_primary_studio_role(user)
    if role in ("developer", "review_admin"):
        promotion_status = "auto_promoted"
    else:
        # certified_contributor — check promotion_policy
        ur_rows = _get_user_studio_roles(supabase, user["sub"])
        cc_role = next((r for r in ur_rows if r["role"] == "certified_contributor"), None)
        if cc_role and cc_role.get("promotion_policy") == "auto_promote":
            promotion_status = "auto_promoted"
        else:
            promotion_status = "pending"

    # D-15: always log to override_events first
    try:
        ov_resp = supabase.table("override_events").insert({
            "session_id": body.session_id,
            "submission_id": body.submission_id,
            "actor_id": user["sub"],
            "field_name": body.field_name,
            "old_value": old_value,
            "new_value": body.new_value,
            "old_confidence": old_confidence,
            "reason": body.reason,
            "citation_url": body.citation_url,
            "citation_snippet": body.citation_snippet,
            "promotion_status": promotion_status,
        }).execute()
        override_id = ov_resp.data[0]["id"] if ov_resp.data else None
    except Exception as exc:
        logger.error("submit_override: override_events insert failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to log override")

    # If auto_promoted, apply immediately to field_confidence (DEVUI-06)
    if promotion_status == "auto_promoted":
        try:
            _apply_override_to_submission(supabase, body.submission_id, body.field_name, body.new_value, user["sub"])
        except Exception as exc:
            logger.error("submit_override: _apply_override_to_submission failed: %s", exc)
            # Non-fatal for the response — override is logged, promotion failed
            return {"status": "logged_apply_failed", "override_id": override_id, "detail": str(exc)}

    return {"status": promotion_status, "override_id": override_id}


# --- GET /queue ---
@studio_router.get("/queue")
def get_approval_queue(
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(require_studio_role("developer", "review_admin")),
):
    """GET /api/v1/studio/queue — pending overrides for review_admin approval (D-14)."""
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        count_resp = (
            supabase.table("override_events")
            .select("id", count="exact")
            .eq("promotion_status", "pending")
            .execute()
        )
        total = count_resp.count or 0
        rows_resp = (
            supabase.table("override_events")
            .select("*")
            .eq("promotion_status", "pending")
            .order("created_at", desc=False)
            .range(offset, offset + min(limit, 100) - 1)
            .execute()
        )
        return {"queue": rows_resp.data or [], "total": total, "limit": limit, "offset": offset}
    except Exception as exc:
        logger.error("get_approval_queue failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database query failed")


# --- PATCH /queue/{override_id} ---
@studio_router.patch("/queue/{override_id}")
def decide_override(
    override_id: str,
    body: ApprovalDecision,
    user: dict = Depends(require_studio_role("review_admin")),
):
    """PATCH /api/v1/studio/queue/{override_id} — approve or reject a pending override."""
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    ov_resp = supabase.table("override_events").select("*").eq("id", override_id).maybe_single().execute()
    if not ov_resp.data:
        raise HTTPException(status_code=404, detail="Override not found")
    ov = ov_resp.data
    if ov["promotion_status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Override already decided: {ov['promotion_status']}")

    approved = body.decision == "approved"
    supabase.table("override_events").update({
        "promotion_status": "approved" if approved else "rejected",
        "approved_by": user["sub"],
        "approval_note": body.note,
        "decided_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", override_id).execute()

    if approved:
        try:
            _apply_override_to_submission(
                supabase, ov["submission_id"], ov["field_name"], ov["new_value"], ov["actor_id"]
            )
        except Exception as exc:
            logger.error("decide_override: apply failed: %s", exc)

    # D-12: update trust counter for certified_contributors
    from config.settings import get_settings
    threshold = get_settings().trust_level_threshold
    actor_roles = _get_user_studio_roles(supabase, ov["actor_id"])
    role_names = [r["role"] for r in actor_roles]
    if "certified_contributor" in role_names and "developer" not in role_names:
        try:
            check_and_update_trust(supabase, ov["actor_id"], approved, threshold=threshold)
        except Exception as exc:
            logger.warning("decide_override: trust update failed (non-fatal): %s", exc)

    return {"decision": body.decision, "override_id": override_id}


# --- POST /invite ---
@studio_router.post("/invite")
def create_invite(
    body: InviteRequest,
    user: dict = Depends(require_studio_role("review_admin")),
):
    """POST /api/v1/studio/invite — generate single-use invite token (review_admin only) (DEVUI-07, D-03)."""
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        resp = supabase.table("invite_tokens").insert({
            "role": body.role,
            "created_by": user["sub"],
            "target_email": body.target_email,
        }).execute()
        row = resp.data[0] if resp.data else {}
        return {"token": row.get("token"), "role": row.get("role"), "expires_at": row.get("expires_at")}
    except Exception as exc:
        logger.error("create_invite failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to create invite token")


# --- POST /invite/redeem ---
@studio_router.post("/invite/redeem")
def redeem_invite(
    body: RedeemRequest,
    user: dict = Depends(require_studio_role("developer", "certified_contributor", "review_admin")),
):
    """
    POST /api/v1/studio/invite/redeem — consume invite token, grant role (D-03, D-04).
    Single-use: returns 409 if already used. Returns 410 if expired.
    Token in POST body, never in query string (Pitfall 2 from RESEARCH.md).
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        tok_resp = (
            supabase.table("invite_tokens")
            .select("*")
            .eq("token", body.token)
            .maybe_single()
            .execute()
        )
        if not tok_resp.data:
            raise HTTPException(status_code=404, detail="Invite token not found")
        tok = tok_resp.data
        if tok.get("used_at"):
            raise HTTPException(status_code=409, detail="Invite token already used")
        expires = datetime.fromisoformat(tok["expires_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=410, detail="Invite token has expired")

        # Mark token used
        supabase.table("invite_tokens").update({
            "used_at": datetime.now(timezone.utc).isoformat(),
            "used_by": user["sub"],
        }).eq("id", tok["id"]).execute()

        # Insert role — D-04: granted_by = token creator, not self
        supabase.table("user_roles").insert({
            "user_id": user["sub"],
            "role": tok["role"],
            "granted_by": tok["created_by"],
        }).execute()

        logger.info("Redeemed invite for user=%s role=%s", user["sub"], tok["role"])
        return {"role_granted": tok["role"], "message": f"Role '{tok['role']}' granted successfully"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("redeem_invite failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to redeem invite token")


# --- GET /metrics ---
@studio_router.get("/metrics")
def get_studio_metrics(
    user: dict = Depends(require_studio_role("developer", "review_admin")),
):
    """
    GET /api/v1/studio/metrics — manual-authoring KPIs (DEVUI-09).
    Returns: total_overrides, pending_queue, auto_promoted, accepted_overrides,
             rejected_overrides, acceptance_rate, avg_approval_latency_hours,
             active_contributors, computed_at.
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    computed_at = datetime.now(timezone.utc).isoformat()
    try:
        ov_resp = (
            supabase.table("override_events")
            .select("promotion_status, created_at, decided_at, actor_id, field_name, submission_id")
            .limit(10000)
            .execute()
        )
        overrides = ov_resp.data or []

        corr_resp = (
            supabase.table("field_corrections")
            .select("submission_id, field_name")
            .not_.is_("corrected_by", "null")
            .limit(10000)
            .execute()
        )
        corrections = corr_resp.data or []

        total = len(overrides)
        approved = sum(1 for o in overrides if o["promotion_status"] == "approved")
        auto_promoted = sum(1 for o in overrides if o["promotion_status"] == "auto_promoted")
        rejected = sum(1 for o in overrides if o["promotion_status"] == "rejected")
        pending = sum(1 for o in overrides if o["promotion_status"] == "pending")
        acceptance_rate = (approved + auto_promoted) / total if total > 0 else 0.0

        # SC-9: post-override correction rate — fraction of overridden fields later corrected
        correction_keys = {
            (c["submission_id"], c["field_name"]) for c in corrections
        }
        corrected_overrides = sum(
            1 for o in overrides
            if (o.get("submission_id"), o.get("field_name")) in correction_keys
        )
        post_override_correction_rate = corrected_overrides / total if total > 0 else 0.0

        # Approval latency p50 — only for manually decided overrides
        latencies = []
        for o in overrides:
            if o.get("created_at") and o.get("decided_at"):
                try:
                    created = datetime.fromisoformat(o["created_at"].replace("Z", "+00:00"))
                    decided = datetime.fromisoformat(o["decided_at"].replace("Z", "+00:00"))
                    latencies.append((decided - created).total_seconds() / 3600.0)
                except Exception:
                    pass
        latencies.sort()
        n = len(latencies)
        avg_approval_latency_hours = (
            (latencies[n // 2 - 1] + latencies[n // 2]) / 2 if n % 2 == 0 and n > 0
            else latencies[n // 2] if n > 0
            else 0.0
        )

        # Active contributors: distinct actors with any override in last 30 days
        thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        contrib_resp = (
            supabase.table("override_events")
            .select("actor_id")
            .gte("created_at", thirty_days_ago)
            .execute()
        )
        active_contributors_count = len({row["actor_id"] for row in (contrib_resp.data or [])})

        return {
            "total_overrides": total,
            "pending_queue": pending,
            "auto_promoted": auto_promoted,
            "accepted_overrides": approved,
            "rejected_overrides": rejected,
            "acceptance_rate": round(acceptance_rate, 4),
            "post_override_correction_rate": round(post_override_correction_rate, 4),
            "avg_approval_latency_hours": round(avg_approval_latency_hours, 4),
            "active_contributors": active_contributors_count,
            "computed_at": computed_at,
        }
    except Exception as exc:
        logger.error("get_studio_metrics failed: %s", exc)
        raise HTTPException(status_code=503, detail="Metrics computation failed")


# --- GET /me/roles ---
@studio_router.get("/me/roles")
def get_my_roles(
    authorization: Optional[str] = Header(None),
):
    """
    GET /api/v1/studio/me/roles — any authenticated user can call this (no role restriction).
    Decodes Bearer JWT to get user_id, then queries user_roles table.
    Returns active roles + promotion_policy for AuthContext to populate studioRoles.
    Called immediately after login — gracefully returns empty roles on any error.
    """
    import jwt as pyjwt
    from config.settings import get_settings

    if not authorization or not authorization.startswith("Bearer "):
        return {"roles": [], "promotion_policy": "queue", "consecutive_approved_overrides": 0}
    token = authorization.removeprefix("Bearer ")
    secret = get_settings().supabase_jwt_secret
    try:
        payload = pyjwt.decode(
            token, secret, algorithms=["HS256"], options={"verify_aud": False}
        )
    except Exception:
        return {"roles": [], "promotion_policy": "queue", "consecutive_approved_overrides": 0}

    user_id = payload.get("sub")
    supabase = _get_supabase()
    if not supabase or not user_id:
        return {"roles": [], "promotion_policy": "queue", "consecutive_approved_overrides": 0}

    try:
        resp = (
            supabase.table("user_roles")
            .select("role, promotion_policy, consecutive_approved_overrides")
            .eq("user_id", user_id)
            .is_("revoked_at", "null")
            .execute()
        )
        rows = resp.data or []
        roles = [r["role"] for r in rows]
        # Primary role's promotion_policy (highest trust wins: review_admin > developer > certified_contributor)
        primary = next(
            (r for r in rows if r["role"] == "review_admin"),
            next(
                (r for r in rows if r["role"] == "developer"),
                next((r for r in rows if r["role"] == "certified_contributor"), None),
            ),
        )
        promotion_policy = primary["promotion_policy"] if primary else "queue"
        consecutive = primary["consecutive_approved_overrides"] if primary else 0
        return {"roles": roles, "promotion_policy": promotion_policy, "consecutive_approved_overrides": consecutive}
    except Exception as exc:
        logger.error("get_my_roles failed for user %s: %s", user_id, exc)
        return {"roles": [], "promotion_policy": "queue", "consecutive_approved_overrides": 0}


# --- GET /contributors ---
@studio_router.get("/contributors")
def get_contributors(
    user: dict = Depends(require_studio_role("review_admin")),
):
    """
    GET /api/v1/studio/contributors — list active certified_contributors (review_admin only).
    Returns user_roles rows with role=certified_contributor and revoked_at IS NULL.
    Used by StudioCertify.tsx to populate ContributorTable.
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        resp = (
            supabase.table("user_roles")
            .select(
                "id, user_id, role, granted_at, consecutive_approved_overrides, "
                "promotion_policy, auto_promote_earned_at, revoked_at"
            )
            .eq("role", "certified_contributor")
            .is_("revoked_at", "null")
            .execute()
        )
        return {"contributors": resp.data or []}
    except Exception as exc:
        logger.error("get_contributors failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database query failed")


# --- PATCH /contributors/{user_id}/revoke ---
@studio_router.patch("/contributors/{user_id}/revoke")
def revoke_contributor(
    user_id: str,
    user: dict = Depends(require_studio_role("review_admin")),
):
    """PATCH /api/v1/studio/contributors/{user_id}/revoke — revoke contributor access (review_admin only)."""
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        supabase.table("user_roles").update(
            {"revoked_at": datetime.now(timezone.utc).isoformat()}
        ).eq("user_id", user_id).eq("role", "certified_contributor").execute()
        logger.info("review_admin %s revoked contributor %s", user["sub"], user_id)
        return {"revoked": True, "user_id": user_id}
    except Exception as exc:
        logger.error("revoke_contributor failed for %s: %s", user_id, exc)
        raise HTTPException(status_code=503, detail="Revoke failed")


# --- PATCH /contributors/{user_id}/enable ---
@studio_router.patch("/contributors/{user_id}/enable")
def enable_contributor(
    user_id: str,
    user: dict = Depends(require_studio_role("review_admin")),
):
    """PATCH /api/v1/studio/contributors/{user_id}/enable — re-enable a revoked contributor (review_admin only)."""
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        supabase.table("user_roles").update(
            {"revoked_at": None}
        ).eq("user_id", user_id).eq("role", "certified_contributor").execute()
        logger.info("review_admin %s enabled contributor %s", user["sub"], user_id)
        return {"enabled": True, "user_id": user_id}
    except Exception as exc:
        logger.error("enable_contributor failed for %s: %s", user_id, exc)
        raise HTTPException(status_code=503, detail="Enable failed")


# --- PATCH /contributors/{user_id}/disable ---
@studio_router.patch("/contributors/{user_id}/disable")
def disable_contributor(
    user_id: str,
    user: dict = Depends(require_studio_role("review_admin")),
):
    """
    PATCH /api/v1/studio/contributors/{user_id}/disable — disable contributor (alias for revoke).
    Kept as a separate endpoint for UI clarity: StudioCertify uses /disable for the toggle-off action.
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        supabase.table("user_roles").update(
            {"revoked_at": datetime.now(timezone.utc).isoformat()}
        ).eq("user_id", user_id).eq("role", "certified_contributor").execute()
        logger.info("review_admin %s disabled contributor %s", user["sub"], user_id)
        return {"disabled": True, "user_id": user_id}
    except Exception as exc:
        logger.error("disable_contributor failed for %s: %s", user_id, exc)
        raise HTTPException(status_code=503, detail="Disable failed")
