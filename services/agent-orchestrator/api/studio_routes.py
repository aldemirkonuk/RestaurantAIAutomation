"""
Studio Routes
=============
Phase 13: Dev Onboarding UI with Manual Override Access.

Endpoints:
  POST   /api/v1/studio/sessions                          — Start new ingestion session
  POST   /api/v1/studio/submissions                       — Create a hand-entered record's submission
  GET    /api/v1/studio/sessions/{id}                     — Get session timeline (DEVUI-08)
  POST   /api/v1/studio/overrides                         — Submit field override (DEVUI-05, D-12/D-13)
  GET    /api/v1/studio/queue                             — Pending approval queue (review_admin only)
  PATCH  /api/v1/studio/queue/{override_id}               — Approve or reject override
  POST   /api/v1/studio/invite                            — Generate invite token (review_admin only)
  POST   /api/v1/studio/invite/redeem                     — Redeem invite token (any authenticated user,
                                                            must match the invite's target_email)
  GET    /api/v1/studio/metrics                           — Manual-authoring KPIs (DEVUI-09)
  GET    /api/v1/studio/me/roles                          — Current user's studio roles (no role restriction)
  GET    /api/v1/studio/contributors                      — List certified contributors (review_admin only)
  PATCH  /api/v1/studio/contributors/{user_id}/revoke     — Revoke contributor access
  PATCH  /api/v1/studio/contributors/{user_id}/enable     — Re-enable revoked contributor
  PATCH  /api/v1/studio/contributors/{user_id}/disable    — Disable contributor (alias for revoke)

Security:
  T-13-07: JWT verified in every endpoint (require_studio_role, or require_authenticated_user
           on /invite/redeem where the invite itself is the authorization — ADR 0021)
  F-761:   Every write uses require_live_studio_role, which re-reads user_roles, so a revoked
           contributor loses write access at once rather than when their token expires
  T-13-10: Invite token brute-force: token is UUID (128-bit) — 10^38 combinations
  T-13-11: Reason bypass: validated server-side via DB old_confidence check, not client input
  T-13-12: Session leakage: actor_id == user["sub"] OR role in (review_admin, developer)
  T-13-13: Invite misdelivery: redemption is bound to the invite's target_email, so a token
           that leaks or is forwarded cannot grant a role to whoever holds it (ADR 0021)
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from services.override_service import (
    require_studio_role,
    require_live_studio_role,
    require_authenticated_user,
    normalize_email,
    sanitize_for_log,
    OverrideRequest,
    ApprovalDecision,
    InviteRequest,
    RedeemRequest,
    _get_supabase,
    _get_primary_studio_role,
    _get_user_studio_roles,
    _apply_override_to_submission,
    _fc_value,
    _maybe_promote_submission,
    build_library_row,
    check_and_update_trust,
)

logger = logging.getLogger(__name__)

studio_router = APIRouter(prefix="/api/v1/studio", tags=["studio"])


# 'image_upload' is a photo of a list (F-755): the bar has always accepted one and sent
# this value, and the allow-list here and the DB CHECK (20270104000000) did not.
SESSION_SOURCE_TYPES = ("pdf_upload", "image_upload", "url_crawl", "manual_seed")


class SessionCreateRequest(BaseModel):
    source_type: str  # one of SESSION_SOURCE_TYPES
    source_ref: Optional[str] = None
    scan_session_id: Optional[str] = None


class PromoteRequest(BaseModel):
    submission_id: str


class ManualSubmissionRequest(BaseModel):
    session_id: Optional[str] = None
    wine_name: Optional[str] = None


# --- POST /sessions ---
@studio_router.post("/sessions")
def create_session(
    body: SessionCreateRequest,
    user: dict = Depends(
        require_live_studio_role("developer", "certified_contributor", "review_admin")
    ),
):
    """Start a new onboarding session — records actor, source type, and optional scan_session_id."""
    if body.source_type not in SESSION_SOURCE_TYPES:
        raise HTTPException(
            status_code=422,
            detail="source_type must be pdf_upload, image_upload, url_crawl, or manual_seed",
        )
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        resp = (
            supabase.table("onboarding_sessions")
            .insert(
                {
                    "actor_id": user["sub"],
                    "source_type": body.source_type,
                    "source_ref": body.source_ref,
                    "scan_session_id": body.scan_session_id,
                    "status": "active",
                }
            )
            .execute()
        )
        return {"session": resp.data[0] if resp.data else {}}
    except Exception as exc:
        logger.error("create_session failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to create session")


# --- POST /submissions ---
@studio_router.post("/submissions")
def create_manual_submission(
    body: ManualSubmissionRequest,
    user: dict = Depends(
        require_studio_role("developer", "certified_contributor", "review_admin")
    ),
):
    """
    Create the submission row behind a hand-entered "Empty record" (F-756).

    The bar used to give that record a random client UUID with no row behind it,
    so every cell save and Promote 404'd on "Submission not found". The record now
    uses this row's id. A typed wine name is a person's entry, so it is stored the
    way a cell save stores one (confidence 1.0, human_override).
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    wine_name = (body.wine_name or "").strip() or None
    payload: dict = {"extraction_source": "manual_seed", "session_id": body.session_id}
    field_confidence: dict = {}
    if wine_name:
        payload["wine_name"] = wine_name
        field_confidence["wine_name"] = {
            "value": wine_name,
            "confidence": 1.0,
            "source": "human_override",
        }
    try:
        # Tenant from the caller's own user row, never the body — the same lookup
        # onboarding extraction uses (onboarding_routes._resolve_cap_key).
        user_resp = (
            supabase.table("users")
            .select("restaurant_id")
            .eq("user_id", user["sub"])
            .limit(1)
            .execute()
        )
        user_rows = user_resp.data or []
        restaurant_id = user_rows[0].get("restaurant_id") if user_rows else None
        resp = (
            supabase.table("master_wine_library_submissions")
            .insert(
                {
                    "restaurant_id": restaurant_id,
                    "submitted_by": "studio_manual",
                    "payload": payload,
                    "field_confidence": field_confidence,
                    "status": "pending_review",
                }
            )
            .execute()
        )
    except Exception as exc:
        logger.error("create_manual_submission failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to create submission")
    row = resp.data[0] if resp.data else None
    if not row or not row.get("id"):
        raise HTTPException(status_code=503, detail="Failed to create submission")
    return {"submission": {"id": row["id"]}}


# --- GET /sessions/{id} ---
@studio_router.get("/sessions/{session_id}")
def get_session_timeline(
    session_id: str,
    user: dict = Depends(
        require_studio_role("developer", "certified_contributor", "review_admin")
    ),
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
        if session["actor_id"] != user["sub"] and role not in (
            "review_admin",
            "developer",
        ):
            raise HTTPException(
                status_code=403, detail="Not authorized to view this session"
            )

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
        logger.error(
            "get_session_timeline failed for %s: %s",
            sanitize_for_log(session_id),
            exc,
        )
        raise HTTPException(status_code=503, detail="Database query failed")


# --- POST /overrides ---
@studio_router.post("/overrides")
def submit_override(
    body: OverrideRequest,
    user: dict = Depends(
        require_live_studio_role("developer", "certified_contributor", "review_admin")
    ),
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
        logger.error(
            "submit_override: fetch submission %s failed: %s",
            sanitize_for_log(body.submission_id),
            exc,
        )
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
        cc_role = next(
            (r for r in ur_rows if r["role"] == "certified_contributor"), None
        )
        if cc_role and cc_role.get("promotion_policy") == "auto_promote":
            promotion_status = "auto_promoted"
        else:
            promotion_status = "pending"

    # D-15: always log to override_events first
    try:
        ov_resp = (
            supabase.table("override_events")
            .insert(
                {
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
                }
            )
            .execute()
        )
        override_id = ov_resp.data[0]["id"] if ov_resp.data else None
    except Exception as exc:
        logger.error("submit_override: override_events insert failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to log override")

    # If auto_promoted, apply immediately to field_confidence (DEVUI-06)
    if promotion_status == "auto_promoted":
        try:
            _apply_override_to_submission(
                supabase,
                body.submission_id,
                body.field_name,
                body.new_value,
                user["sub"],
            )
        except Exception as exc:
            logger.error(
                "submit_override: _apply_override_to_submission failed: %s", exc
            )
            # Non-fatal for the response — override is logged, promotion failed.
            # The exception text stays in the server log (above) and is not
            # echoed to the caller: str(exc) on a database or driver error
            # carries table names, column names and occasionally connection
            # details, none of which the client needs to handle this outcome
            # (CodeQL py/stack-trace-exposure).
            return {
                "status": "logged_apply_failed",
                "override_id": override_id,
                "detail": "Override recorded, but promotion failed. See server logs.",
            }

        # T-14-08: attempt library promotion — non-fatal, but the outcome is returned
        # so a failed library write is not reported as a plain success (F-754).
        library = _maybe_promote_submission(supabase, body.submission_id)
        return {
            "status": promotion_status,
            "override_id": override_id,
            "library": library,
        }

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
        queue = _hydrate_queue_rows(supabase, rows_resp.data or [])
        return {
            "queue": queue,
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    except Exception as exc:
        logger.error("get_approval_queue failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database query failed")


def _queue_identity(sub: dict) -> dict:
    """Wine name and vintage for a queue row (F-760). Gateway submissions keep the
    name under payload 'name' (wine-submissions.service.ts:153); studio extraction
    keeps it under 'wine_name' (onboarding_routes.py:353), or only in
    field_confidence when it fell below the accept threshold."""
    payload = sub.get("payload") or {}
    fc = sub.get("field_confidence") or {}

    def pick(*values):
        return next((v for v in values if v not in (None, "")), None)

    return {
        "wine_name": pick(
            payload.get("name"), payload.get("wine_name"), _fc_value(fc, "wine_name")
        ),
        "vintage": pick(payload.get("vintage"), _fc_value(fc, "vintage")),
    }


def _hydrate_queue_rows(supabase, rows: list[dict]) -> list[dict]:
    """Fills in wine_name/vintage (from the submission payload), actor_email,
    actor_role, and trust_count for each pending override row.

    GET /queue previously did a bare select("*") on override_events, which
    has none of these columns — QueueRow.tsx rendered "(unknown)" for every
    wine and never showed the trust bar for certified contributors. This
    performs three small batch lookups instead of N+1 queries per row.
    """
    if not rows:
        return rows

    submission_ids = list({r["submission_id"] for r in rows if r.get("submission_id")})
    actor_ids = list({r["actor_id"] for r in rows if r.get("actor_id")})

    identity_by_submission: dict[str, dict] = {}
    if submission_ids:
        try:
            sub_resp = (
                supabase.table("master_wine_library_submissions")
                .select("id, payload, field_confidence")
                .in_("id", submission_ids)
                .execute()
            )
            for sub in sub_resp.data or []:
                identity_by_submission[sub["id"]] = _queue_identity(sub)
        except Exception as exc:
            logger.warning("_hydrate_queue_rows: submission lookup failed: %s", exc)

    email_by_actor: dict[str, str] = {}
    if actor_ids:
        try:
            user_resp = (
                supabase.table("users")
                .select("user_id, email")
                .in_("user_id", actor_ids)
                .execute()
            )
            for u in user_resp.data or []:
                email_by_actor[u["user_id"]] = u.get("email")
        except Exception as exc:
            logger.warning("_hydrate_queue_rows: user lookup failed: %s", exc)

    role_by_actor: dict[str, str] = {}
    trust_by_actor: dict[str, int] = {}
    if actor_ids:
        try:
            role_resp = (
                supabase.table("user_roles")
                .select("user_id, role, consecutive_approved_overrides")
                .in_("user_id", actor_ids)
                .is_("revoked_at", "null")
                .execute()
            )
            for role_row in role_resp.data or []:
                uid = role_row["user_id"]
                # Prefer certified_contributor if a user has multiple active roles —
                # it is the only role with trust progress to show.
                if (
                    uid not in role_by_actor
                    or role_row["role"] == "certified_contributor"
                ):
                    role_by_actor[uid] = role_row["role"]
                    trust_by_actor[uid] = (
                        role_row.get("consecutive_approved_overrides") or 0
                    )
        except Exception as exc:
            logger.warning("_hydrate_queue_rows: role lookup failed: %s", exc)

    hydrated = []
    for row in rows:
        identity = identity_by_submission.get(row.get("submission_id"), {})
        actor_id = row.get("actor_id")
        vintage = identity.get("vintage")
        hydrated.append(
            {
                **row,
                "wine_name": identity.get("wine_name"),
                "vintage": str(vintage) if vintage is not None else None,
                "actor_email": email_by_actor.get(actor_id),
                "actor_role": role_by_actor.get(actor_id),
                "trust_count": trust_by_actor.get(actor_id),
            }
        )
    return hydrated


# --- PATCH /queue/{override_id} ---
@studio_router.patch("/queue/{override_id}")
def decide_override(
    override_id: str,
    body: ApprovalDecision,
    user: dict = Depends(require_live_studio_role("review_admin")),
):
    """PATCH /api/v1/studio/queue/{override_id} — approve or reject a pending override."""
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    ov_resp = (
        supabase.table("override_events")
        .select("*")
        .eq("id", override_id)
        .maybe_single()
        .execute()
    )
    if not ov_resp.data:
        raise HTTPException(status_code=404, detail="Override not found")
    ov = ov_resp.data
    if ov["promotion_status"] != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Override already decided: {ov['promotion_status']}",
        )

    approved = body.decision == "approved"
    library = None
    # The pending check above is only a fast path for a clear 409. The promotion_status
    # predicate on the write is what decides (F-758): two reviewers deciding the same row
    # at once both pass the read, but only one UPDATE can still match 'pending'. No row
    # back = someone else decided it first, so this request must not apply or count trust.
    decided = (
        supabase.table("override_events")
        .update(
            {
                "promotion_status": "approved" if approved else "rejected",
                "approved_by": user["sub"],
                "approval_note": body.note,
                "decided_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", override_id)
        .eq("promotion_status", "pending")
        .execute()
    )
    if not decided.data:
        raise HTTPException(
            status_code=409, detail="Someone already decided this change."
        )

    if approved:
        try:
            _apply_override_to_submission(
                supabase,
                ov["submission_id"],
                ov["field_name"],
                ov["new_value"],
                ov["actor_id"],
            )
        except Exception as exc:
            logger.error("decide_override: apply failed: %s", exc)
            # F-759: an approval whose value never reached the wine must not read as
            # approved. Put the row back in the queue (so it can be approved again) and
            # skip promotion and the trust counter, which would otherwise reward a change
            # that did not land.
            try:
                supabase.table("override_events").update(
                    {
                        "promotion_status": "pending",
                        "approved_by": None,
                        "approval_note": None,
                        "decided_at": None,
                    }
                ).eq("id", override_id).eq("promotion_status", "approved").execute()
            except Exception as revert_exc:
                logger.error(
                    "decide_override: could not return %s to the queue: %s",
                    sanitize_for_log(override_id),
                    revert_exc,
                )
            raise HTTPException(
                status_code=503,
                detail="The change could not be applied to the wine, so it is back in the queue. Try approving it again.",
            )

        # T-14-08: attempt library promotion — non-fatal, but the outcome is returned
        # so the approver is told when the wine did not reach the library (F-754).
        library = _maybe_promote_submission(supabase, ov["submission_id"])

    # D-12: update trust counter for certified_contributors
    from config.settings import get_settings

    threshold = get_settings().trust_level_threshold
    actor_roles = _get_user_studio_roles(supabase, ov["actor_id"])
    role_names = [r["role"] for r in actor_roles]
    if "certified_contributor" in role_names and "developer" not in role_names:
        try:
            check_and_update_trust(
                supabase, ov["actor_id"], approved, threshold=threshold
            )
        except Exception as exc:
            logger.warning("decide_override: trust update failed (non-fatal): %s", exc)

    result = {"decision": body.decision, "override_id": override_id}
    if library is not None:
        result["library"] = library
    return result


# --- POST /invite ---
@studio_router.post("/invite")
def create_invite(
    body: InviteRequest,
    user: dict = Depends(require_live_studio_role("review_admin")),
):
    """
    POST /api/v1/studio/invite — generate single-use invite token (review_admin only) (DEVUI-07, D-03).
    target_email is required and is what redeem_invite binds the grant to (ADR 0021) — the
    token is a capability to claim *that* address's invite, not a bearer capability.
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        resp = (
            supabase.table("invite_tokens")
            .insert(
                {
                    "role": body.role,
                    "created_by": user["sub"],
                    "target_email": body.target_email,
                }
            )
            .execute()
        )
        row = resp.data[0] if resp.data else {}
        return {
            "token": row.get("token"),
            "role": row.get("role"),
            "expires_at": row.get("expires_at"),
        }
    except Exception as exc:
        logger.error("create_invite failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to create invite token")


# --- POST /invite/redeem ---
@studio_router.post("/invite/redeem")
def redeem_invite(
    body: RedeemRequest,
    user: dict = Depends(require_authenticated_user()),
):
    """
    POST /api/v1/studio/invite/redeem — consume invite token, grant role (D-03, D-04, ADR 0021).

    Authorization is the invite, not a pre-existing role: an invitee holds no studio role —
    that is what is being granted — so this endpoint requires only a verified JWT. The grant
    is bound to the invite's target_email, which the redeeming account must match. Without
    that binding "any authenticated user" would mean any restaurant account on the platform.

    Single-use: 409 if already used or already held. 410 if expired. 403 on email mismatch.
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

        # Bind the grant to the invited address. Fail closed: a token minted without a
        # target_email (rows predating ADR 0021) or a JWT carrying no email is not redeemable.
        invited = normalize_email(tok.get("target_email"))
        caller = normalize_email(user.get("email"))
        if not invited or not caller or invited != caller:
            logger.warning(
                "redeem_invite rejected: token=%s invited_set=%s caller_set=%s match=False",
                tok["id"],
                bool(invited),
                bool(caller),
            )
            raise HTTPException(
                status_code=403,
                detail="This invite was issued to a different email address.",
            )

        # Already holds the role — don't burn the token on a no-op. Revoked rows are read
        # too: user_roles is UNIQUE (user_id, role), so a re-invited contributor already
        # has a row, and inserting a second one failed every re-invite (F-757).
        existing = (
            supabase.table("user_roles")
            .select("role, revoked_at")
            .eq("user_id", user["sub"])
            .eq("role", tok["role"])
            .execute()
        )
        if any(not r.get("revoked_at") for r in (existing.data or [])):
            raise HTTPException(
                status_code=409, detail=f"You already hold the '{tok['role']}' role"
            )

        # Claim the token atomically: the used_at IS NULL predicate is what makes this
        # single-use under concurrency. The read above can go stale between check and write,
        # so the write itself must be the one that decides. No rows back = lost the race.
        claim = (
            supabase.table("invite_tokens")
            .update(
                {
                    "used_at": datetime.now(timezone.utc).isoformat(),
                    "used_by": user["sub"],
                }
            )
            .eq("id", tok["id"])
            .is_("used_at", "null")
            .execute()
        )
        if not claim.data:
            raise HTTPException(status_code=409, detail="Invite token already used")

        # Grant role — D-04: granted_by = token creator, not self. A revoked row is
        # restored in place as a fresh grant: trust earned before the revocation does not
        # carry over, so the contributor starts back on the review queue.
        try:
            if existing.data:
                supabase.table("user_roles").update(
                    {
                        "revoked_at": None,
                        "granted_by": tok["created_by"],
                        "granted_at": datetime.now(timezone.utc).isoformat(),
                        "consecutive_approved_overrides": 0,
                        "promotion_policy": "queue",
                        "auto_promote_earned_at": None,
                    }
                ).eq("user_id", user["sub"]).eq("role", tok["role"]).execute()
            else:
                supabase.table("user_roles").insert(
                    {
                        "user_id": user["sub"],
                        "role": tok["role"],
                        "granted_by": tok["created_by"],
                    }
                ).execute()
        except Exception as grant_exc:
            # Release the claim so a failed grant does not silently consume the invite.
            supabase.table("invite_tokens").update(
                {"used_at": None, "used_by": None}
            ).eq("id", tok["id"]).execute()
            # 23505 = unique_violation: the row appeared between our read and the insert
            # (a second redeem racing this one). The role is held, so say that, not 503.
            if "23505" in str(getattr(grant_exc, "code", "") or grant_exc):
                raise HTTPException(
                    status_code=409, detail=f"You already hold the '{tok['role']}' role"
                )
            raise

        # sub comes from the request's JWT, so it is escaped before it reaches the log —
        # a newline in a claim could otherwise forge a second entry (CodeQL py/log-injection).
        # role is not: it is the DB column, constrained by invite_tokens_role_check.
        logger.info(
            "Redeemed invite for user=%s role=%s",
            sanitize_for_log(user["sub"]),
            tok["role"],
        )
        return {
            "role_granted": tok["role"],
            "message": f"Role '{tok['role']}' granted successfully",
        }
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
            .select(
                "promotion_status, created_at, decided_at, actor_id, field_name, submission_id"
            )
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
        auto_promoted = sum(
            1 for o in overrides if o["promotion_status"] == "auto_promoted"
        )
        rejected = sum(1 for o in overrides if o["promotion_status"] == "rejected")
        pending = sum(1 for o in overrides if o["promotion_status"] == "pending")
        acceptance_rate = (approved + auto_promoted) / total if total > 0 else 0.0

        # SC-9: post-override correction rate — fraction of overridden fields later corrected
        correction_keys = {(c["submission_id"], c["field_name"]) for c in corrections}
        corrected_overrides = sum(
            1
            for o in overrides
            if (o.get("submission_id"), o.get("field_name")) in correction_keys
        )
        post_override_correction_rate = (
            corrected_overrides / total if total > 0 else 0.0
        )

        # Approval latency p50 — only for manually decided overrides
        latencies = []
        for o in overrides:
            if o.get("created_at") and o.get("decided_at"):
                try:
                    created = datetime.fromisoformat(
                        o["created_at"].replace("Z", "+00:00")
                    )
                    decided = datetime.fromisoformat(
                        o["decided_at"].replace("Z", "+00:00")
                    )
                    latencies.append((decided - created).total_seconds() / 3600.0)
                except Exception:
                    pass
        latencies.sort()
        n = len(latencies)
        avg_approval_latency_hours = (
            (latencies[n // 2 - 1] + latencies[n // 2]) / 2
            if n % 2 == 0 and n > 0
            else latencies[n // 2] if n > 0 else 0.0
        )

        # Active contributors: distinct actors with any override in last 30 days
        thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        contrib_resp = (
            supabase.table("override_events")
            .select("actor_id")
            .gte("created_at", thirty_days_ago)
            .execute()
        )
        active_contributors_count = len(
            {row["actor_id"] for row in (contrib_resp.data or [])}
        )

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
        return {
            "roles": [],
            "promotion_policy": "queue",
            "consecutive_approved_overrides": 0,
        }
    token = authorization.removeprefix("Bearer ")
    secret = get_settings().supabase_jwt_secret
    try:
        payload = pyjwt.decode(
            token, secret, algorithms=["HS256"], options={"verify_aud": False}
        )
    except Exception:
        return {
            "roles": [],
            "promotion_policy": "queue",
            "consecutive_approved_overrides": 0,
        }

    user_id = payload.get("sub")
    supabase = _get_supabase()
    if not supabase or not user_id:
        return {
            "roles": [],
            "promotion_policy": "queue",
            "consecutive_approved_overrides": 0,
        }

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
        return {
            "roles": roles,
            "promotion_policy": promotion_policy,
            "consecutive_approved_overrides": consecutive,
        }
    except Exception as exc:
        logger.error("get_my_roles failed for user %s: %s", user_id, exc)
        return {
            "roles": [],
            "promotion_policy": "queue",
            "consecutive_approved_overrides": 0,
        }


# --- GET /contributors ---
@studio_router.get("/contributors")
def get_contributors(
    user: dict = Depends(require_studio_role("developer", "review_admin")),
):
    """
    GET /api/v1/studio/contributors — list certified_contributors (review_admin only).
    Returns every user_roles row with role=certified_contributor, revoked ones included
    (revoked_at set): ContributorTable offers Enable on exactly those rows, and filtering
    them out made a disabled contributor impossible to restore (F-757).
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
    user: dict = Depends(require_live_studio_role("review_admin")),
):
    """PATCH /api/v1/studio/contributors/{user_id}/revoke — revoke contributor access (review_admin only)."""
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        supabase.table("user_roles").update(
            {"revoked_at": datetime.now(timezone.utc).isoformat()}
        ).eq("user_id", user_id).eq("role", "certified_contributor").execute()
        # Both are request-derived — sub is a JWT claim, user_id is the path param.
        logger.info(
            "review_admin %s revoked contributor %s",
            sanitize_for_log(user["sub"]),
            sanitize_for_log(user_id),
        )
        return {"revoked": True, "user_id": user_id}
    except Exception as exc:
        logger.error(
            "revoke_contributor failed for %s: %s", sanitize_for_log(user_id), exc
        )
        raise HTTPException(status_code=503, detail="Revoke failed")


# --- PATCH /contributors/{user_id}/enable ---
@studio_router.patch("/contributors/{user_id}/enable")
def enable_contributor(
    user_id: str,
    user: dict = Depends(require_live_studio_role("review_admin")),
):
    """PATCH /api/v1/studio/contributors/{user_id}/enable — re-enable a revoked contributor (review_admin only)."""
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        supabase.table("user_roles").update({"revoked_at": None}).eq(
            "user_id", user_id
        ).eq("role", "certified_contributor").execute()
        logger.info(
            "review_admin %s enabled contributor %s",
            sanitize_for_log(user["sub"]),
            sanitize_for_log(user_id),
        )
        return {"enabled": True, "user_id": user_id}
    except Exception as exc:
        logger.error(
            "enable_contributor failed for %s: %s", sanitize_for_log(user_id), exc
        )
        raise HTTPException(status_code=503, detail="Enable failed")


# --- POST /promote ---
# Submission statuses whose matched_master_id names the library row the wine IS:
# approved (studio promotion), merged and accepted (gateway, wine-submissions.service.ts).
_SETTLED_SUBMISSION_STATUSES = frozenset({"approved", "merged", "accepted"})


@studio_router.post("/promote")
def promote_to_library(
    body: PromoteRequest,
    user: dict = Depends(require_live_studio_role("developer", "review_admin")),
):
    """
    POST /api/v1/studio/promote — promote a submission to master_wine_library (D-09, D-06).
    T-15-03: only developer/review_admin can promote.
    T-15-04: data read from server-side submission, client only sends submission_id.
    T-15-05: promoted_by + promoted_at provide audit trail (data_enrichment.studio_promotion;
             the library has no columns of those names).
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Step 1: fetch submission
    try:
        sub_resp = (
            supabase.table("master_wine_library_submissions")
            .select("*")
            .eq("id", body.submission_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logger.error("promote_to_library: fetch submission failed: %s", exc)
        raise HTTPException(status_code=503, detail="Failed to fetch submission")

    if not sub_resp.data:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission = sub_resp.data

    # A submission already settled onto a library row (auto-promotion records the
    # link, F-810) is in the library: a second Promote after more fields were saved
    # would otherwise miss that row in the dedup below and insert the wine twice.
    # Only a settled status counts: the gateway also writes matched_master_id on a
    # near miss left in pending_review, a candidate nobody has confirmed, and a
    # reviewer may still promote that submission as a distinct wine.
    if (
        submission.get("matched_master_id")
        and submission.get("status") in _SETTLED_SUBMISSION_STATUSES
    ):
        raise HTTPException(
            status_code=409,
            detail="Wine already exists in library",
            headers={"X-Existing-Wine-Id": str(submission["matched_master_id"])},
        )

    # Step 2: extract field values — prefer field_confidence values if present
    fc = submission.get("field_confidence") or {}

    def _get_field(field_name: str) -> Optional[str]:
        entry = fc.get(field_name)
        if entry and isinstance(entry, dict) and entry.get("value") is not None:
            return entry["value"]
        # The submission has no per-field columns; its flat values live in payload.
        return (submission.get("payload") or {}).get(field_name)

    promoted_by = user.get("sub")
    insert_payload = build_library_row(
        _get_field,
        source="studio_promotion",
        submission=submission,
        audit={
            "submission_id": body.submission_id,
            "promoted_by": promoted_by,
            "promoted_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    wine_name = insert_payload.get("name")
    vintage = insert_payload.get("vintage")
    producer = insert_payload.get("producer")

    # Validate minimum required data
    if not wine_name:
        raise HTTPException(
            status_code=422, detail="Submission has no wine_name — cannot promote"
        )

    # Step 3: dedup check — name + vintage + producer (case-insensitive). A missing
    # vintage or producer matches only a row that is missing it too (F-810): left out
    # of the filter, it matched any vintage or producer, so "Chianti" with no producer
    # was refused as a duplicate of someone else's Chianti.
    name_lower = str(wine_name).strip().lower()
    producer_lower = str(producer).strip().lower() if producer else ""
    try:
        dedup_query = (
            supabase.table("master_wine_library")
            .select("id, name")
            .ilike("name", name_lower)
        )
        if vintage is not None:
            dedup_query = dedup_query.eq("vintage", vintage)
        else:
            dedup_query = dedup_query.is_("vintage", "null")
        if producer_lower:
            dedup_query = dedup_query.ilike("producer", producer_lower)
        else:
            dedup_query = dedup_query.is_("producer", "null")
        dedup_resp = dedup_query.limit(1).execute()
        if dedup_resp.data:
            existing = dedup_resp.data[0]
            raise HTTPException(
                status_code=409,
                detail="Wine already exists in library",
                headers={"X-Existing-Wine-Id": existing["id"]},
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("promote_to_library: dedup check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Dedup check failed")

    # Step 4: insert into master_wine_library. The row carries only real library
    # columns (build_library_row, F-754); the old payload guessed column names and
    # retried without three of them, so both attempts failed every time.
    try:
        insert_resp = (
            supabase.table("master_wine_library").insert(insert_payload).execute()
        )
        new_id = insert_resp.data[0]["id"] if insert_resp.data else None
    except Exception as exc:
        logger.error("promote_to_library: insert failed: %s", exc)
        raise HTTPException(
            status_code=503, detail="Failed to insert into master_wine_library"
        )

    # Step 5: mark the submission decided and linked to its library row (non-fatal).
    # It used to set `promoted_to_library`, a column that does not exist.
    update: dict = {"status": "approved"}
    if new_id:
        update["matched_master_id"] = new_id
    try:
        supabase.table("master_wine_library_submissions").update(update).eq(
            "id", body.submission_id
        ).execute()
    except Exception as exc:
        logger.warning(
            "promote_to_library: could not mark submission approved (non-fatal): %s",
            exc,
        )

    # new_id is not wrapped: it is the master_wine_library uuid PK, server-generated.
    logger.info(
        "promote_to_library: promoted submission %s → wine %s by %s",
        sanitize_for_log(body.submission_id),
        new_id,
        sanitize_for_log(promoted_by),
    )
    return {"status": "promoted", "wine_id": new_id, "name": wine_name}


# --- PATCH /contributors/{user_id}/disable ---
@studio_router.patch("/contributors/{user_id}/disable")
def disable_contributor(
    user_id: str,
    user: dict = Depends(require_live_studio_role("review_admin")),
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
        logger.info(
            "review_admin %s disabled contributor %s",
            sanitize_for_log(user["sub"]),
            sanitize_for_log(user_id),
        )
        return {"disabled": True, "user_id": user_id}
    except Exception as exc:
        logger.error(
            "disable_contributor failed for %s: %s", sanitize_for_log(user_id), exc
        )
        raise HTTPException(status_code=503, detail="Disable failed")
