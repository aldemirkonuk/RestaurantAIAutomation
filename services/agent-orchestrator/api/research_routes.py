"""
Research Agent API Routes
=========================
Phase 12: Extensive Gap-Filling Research Agent — operational endpoints.

GET  /api/v1/research/metrics    — All 5 metric categories (gap, quality, evidence, throughput, safety)
GET  /api/v1/research/runs       — Paginated run history with per-run summary stats
GET  /api/v1/research/conflicts  — Wines with unresolved conflict_candidates entries
POST /api/v1/research/trigger    — Dispatch research_agent_task for eligible records

Threat mitigations:
  T-12-10 (Elevation): batch_size capped at 100 via Pydantic Field(le=100)
  T-12-11 (DoS): POST /trigger returns 429 if a research_run row with status='running' exists
  T-12-12 (Info Disclosure): accepted — conflicts endpoint is admin-facing, snippets are wine data
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

research_router = APIRouter(prefix="/api/v1/research", tags=["research"])


# =============================================================================
# AUTH
# =============================================================================


def verify_admin_token(x_admin_key: str | None = Header(None)) -> str:
    """Require X-Admin-Key header matching ADMIN_API_KEY env var (D-06 Bug #7)."""
    expected = os.getenv("ADMIN_API_KEY", "")
    if not x_admin_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    if not expected or x_admin_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    return x_admin_key


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================


class ResearchMetricsResponse(BaseModel):
    gap_closure: Dict[str, Any]
    quality: Dict[str, Any]
    evidence_hygiene: Dict[str, Any]
    throughput_cost: Dict[str, Any]
    safety: Dict[str, Any]
    computed_at: str


class TriggerRequest(BaseModel):
    submission_id: Optional[str] = None
    batch_size: int = Field(default=10, ge=1, le=100)  # T-12-10: cap at 100


# =============================================================================
# HELPERS
# =============================================================================


def _get_supabase():
    """Return Supabase client. Returns None if not configured."""
    try:
        from config.settings import get_settings

        settings = get_settings()
        return settings.supabase_client
    except Exception:
        return None


def _safe_div(numerator: float, denominator: float, default: float = 0.0) -> float:
    """Safe division; returns default on zero denominator."""
    if denominator == 0:
        return default
    return numerator / denominator


def _percentile_50(values: List[float]) -> float:
    """Compute median (p50) from a list of floats."""
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    mid = n // 2
    if n % 2 == 0:
        return (sorted_vals[mid - 1] + sorted_vals[mid]) / 2.0
    return float(sorted_vals[mid])


# =============================================================================
# ENDPOINTS
# =============================================================================


@research_router.get("/metrics", response_model=ResearchMetricsResponse)
def get_research_metrics(_token: str = Depends(verify_admin_token)):
    """
    GET /api/v1/research/metrics

    Returns all 5 metric categories computed from research_runs, research_run_stats,
    evidence_citations, and field_corrections tables.

    Handles empty tables gracefully — returns all zeros with computed_at timestamp
    when no runs have been executed yet.

    Categories:
      gap_closure      — null_rate_before/after, fields_filled_p50, time_to_fill_p50_hours
      quality          — promotion_rate, human_override_rate, conflict_rate, source_tier_mix
      evidence_hygiene — citation_completeness, independent_corroboration_rate, fetch_verify_pass_rate
      throughput_cost  — records_processed_per_day, cost_per_filled_field, attempts_per_filled_field
      safety           — pii_policy_flags, regression_rate (always 0.0)
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    computed_at = datetime.now(timezone.utc).isoformat()

    # --- 1. Query research_run_stats ---
    try:
        stats_resp = (
            supabase.table("research_run_stats")
            .select(
                "fields_targeted, fields_filled, fields_conflicted, "
                "null_rate_before, null_rate_after, time_to_fill_hours, attempts, cost_usd, "
                "regression_blocked_count"
            )
            .order("created_at", desc=True)
            .limit(10000)
            .execute()
        )
        stats_rows = stats_resp.data or []
    except Exception as exc:
        logger.error("get_research_metrics: research_run_stats query failed: %s", exc)
        stats_rows = []

    # --- 2. Query evidence_citations (narrow select — only columns needed for aggregates) ---
    try:
        cit_resp = (
            supabase.table("evidence_citations")
            .select("source_tier, fetch_verified, corroboration_count")
            .limit(10000)
            .execute()
        )
        cit_rows = cit_resp.data or []
    except Exception as exc:
        logger.error("get_research_metrics: evidence_citations query failed: %s", exc)
        cit_rows = []

    # --- 3. Query research_runs ---
    try:
        runs_resp = (
            supabase.table("research_runs")
            .select("records_processed, cost_usd, pii_policy_flags, started_at")
            .limit(10000)
            .execute()
        )
        runs_rows = runs_resp.data or []
    except Exception as exc:
        logger.error("get_research_metrics: research_runs query failed: %s", exc)
        runs_rows = []

    # --- 4. Query field_corrections for human_override_rate ---
    try:
        corr_resp = (
            supabase.table("field_corrections")
            .select("submission_id, field_name")
            .not_.is_("corrected_by", "null")
            .limit(10000)
            .execute()
        )
        corr_rows = corr_resp.data or []
    except Exception as exc:
        logger.error("get_research_metrics: field_corrections query failed: %s", exc)
        corr_rows = []

    # --- Compute: Gap Closure ---
    n_stats = len(stats_rows)
    total_null_before = sum(float(r.get("null_rate_before") or 0) for r in stats_rows)
    total_null_after = sum(float(r.get("null_rate_after") or 0) for r in stats_rows)

    null_rate_before = _safe_div(total_null_before, n_stats)
    null_rate_after = _safe_div(total_null_after, n_stats)

    fields_filled_p50 = _percentile_50(
        [float(r.get("fields_filled") or 0) for r in stats_rows]
    )
    time_to_fill_values = [
        float(r["time_to_fill_hours"])
        for r in stats_rows
        if r.get("time_to_fill_hours") is not None
    ]
    time_to_fill_p50_hours = _percentile_50(time_to_fill_values)

    gap_closure = {
        "null_rate_before": round(null_rate_before, 4),
        "null_rate_after": round(null_rate_after, 4),
        "fields_filled_p50": round(fields_filled_p50, 2),
        "time_to_fill_p50_hours": round(time_to_fill_p50_hours, 4),
    }

    # --- Compute: Quality ---
    total_fields_targeted = sum(int(r.get("fields_targeted") or 0) for r in stats_rows)
    total_fields_filled = sum(int(r.get("fields_filled") or 0) for r in stats_rows)
    total_fields_conflicted = sum(
        int(r.get("fields_conflicted") or 0) for r in stats_rows
    )

    promotion_rate = _safe_div(total_fields_filled, total_fields_targeted)
    conflict_rate = _safe_div(total_fields_conflicted, total_fields_targeted)

    # human_override_rate: human corrections of research-agent fills / total fields filled by agent
    human_override_count = len(corr_rows)
    human_override_rate = _safe_div(human_override_count, total_fields_filled)

    # source_tier_mix: percentage breakdown A/B/C across all evidence_citations
    tier_counts: Dict[str, int] = {"A": 0, "B": 0, "C": 0}
    for c in cit_rows:
        tier = c.get("source_tier", "C")
        if tier in tier_counts:
            tier_counts[tier] += 1
        else:
            tier_counts["C"] += 1
    total_cit = len(cit_rows)
    source_tier_mix = {
        "A": round(_safe_div(tier_counts["A"], total_cit) * 100, 1),
        "B": round(_safe_div(tier_counts["B"], total_cit) * 100, 1),
        "C": round(_safe_div(tier_counts["C"], total_cit) * 100, 1),
    }

    quality = {
        "promotion_rate": round(promotion_rate, 4),
        "human_override_rate": round(human_override_rate, 4),
        "conflict_rate": round(conflict_rate, 4),
        "source_tier_mix": source_tier_mix,
    }

    # --- Compute: Evidence Hygiene ---
    total_c = len(cit_rows)
    if total_c == 0:
        citation_completeness = 0.0
        independent_corroboration_rate = 0.0
        fetch_verify_pass_rate = 0.0
        fetch_verify_pass_rate_by_tier: Dict[str, float] = {
            "A": 0.0,
            "B": 0.0,
            "C": 0.0,
        }
    else:
        # citation_completeness: fraction with corroboration_count >= 1 (proxy for complete citations)
        complete_count = sum(
            1 for c in cit_rows if int(c.get("corroboration_count") or 0) >= 1
        )
        citation_completeness = _safe_div(complete_count, total_c)

        corroborated_count = sum(
            1
            for c in cit_rows
            if int(c.get("corroboration_count") or 0) >= 2
            or c.get("source_tier") == "A"
        )
        independent_corroboration_rate = _safe_div(corroborated_count, total_c)

        verified_count = sum(1 for c in cit_rows if c.get("fetch_verified") is True)
        fetch_verify_pass_rate = _safe_div(verified_count, total_c)

        # Per-tier fetch_verify_pass_rate (D-07)
        tier_verified: Dict[str, int] = {"A": 0, "B": 0, "C": 0}
        tier_total: Dict[str, int] = {"A": 0, "B": 0, "C": 0}
        for c in cit_rows:
            tier = c.get("source_tier", "C")
            if tier not in tier_total:
                tier = "C"
            tier_total[tier] += 1
            if c.get("fetch_verified") is True:
                tier_verified[tier] += 1
        fetch_verify_pass_rate_by_tier = {
            t: round(_safe_div(tier_verified[t], tier_total[t]), 4)
            for t in ("A", "B", "C")
        }

    evidence_hygiene = {
        "citation_completeness": round(citation_completeness, 4),
        "independent_corroboration_rate": round(independent_corroboration_rate, 4),
        "fetch_verify_pass_rate": round(fetch_verify_pass_rate, 4),
        "fetch_verify_pass_rate_by_tier": fetch_verify_pass_rate_by_tier,
    }

    # --- Compute: Throughput + Cost ---
    total_records_processed = sum(
        int(r.get("records_processed") or 0) for r in runs_rows
    )
    total_run_cost = sum(float(r.get("cost_usd") or 0) for r in runs_rows)
    total_attempts = sum(int(r.get("attempts") or 0) for r in stats_rows)

    unique_days: set = set()
    for r in runs_rows:
        started_at = r.get("started_at")
        if started_at:
            try:
                unique_days.add(str(started_at)[:10])
            except Exception:
                pass
    n_days = len(unique_days) or 1
    records_processed_per_day = _safe_div(total_records_processed, n_days)
    cost_per_filled_field = _safe_div(total_run_cost, total_fields_filled)
    attempts_per_filled_field = _safe_div(total_attempts, total_fields_filled)

    throughput_cost = {
        "records_processed_per_day": round(records_processed_per_day, 2),
        "cost_per_filled_field": round(cost_per_filled_field, 6),
        "attempts_per_filled_field": round(attempts_per_filled_field, 4),
    }

    # --- Compute: Safety ---
    total_pii_flags = sum(int(r.get("pii_policy_flags") or 0) for r in runs_rows)
    # regression_rate: actual regressions tracked from research_run_stats (D-06 Bug #6)
    total_regressions = sum(
        int(r.get("regression_blocked_count") or 0) for r in stats_rows
    )
    total_fields_attempted = sum(int(r.get("fields_targeted") or 0) for r in stats_rows)
    regression_rate = _safe_div(total_regressions, total_fields_attempted)
    safety = {
        "pii_policy_flags": total_pii_flags,
        "regression_rate": round(regression_rate, 4),
    }

    return ResearchMetricsResponse(
        gap_closure=gap_closure,
        quality=quality,
        evidence_hygiene=evidence_hygiene,
        throughput_cost=throughput_cost,
        safety=safety,
        computed_at=computed_at,
    )


@research_router.get("/runs")
def get_research_runs(
    limit: int = 20,
    offset: int = 0,
    _token: str = Depends(verify_admin_token),
):
    """
    GET /api/v1/research/runs

    Returns paginated run history ordered by started_at descending.

    Query params:
        limit:  max runs to return (default 20, max 100)
        offset: pagination offset (default 0)

    Response: { runs: [...], total: int, limit: int, offset: int }
    """
    limit = min(limit, 100)

    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        count_resp = (
            supabase.table("research_runs").select("id", count="exact").execute()
        )
        total = count_resp.count or 0

        rows_resp = (
            supabase.table("research_runs")
            .select(
                "id, started_at, completed_at, records_eligible, records_processed, "
                "fields_filled, cost_usd, pii_policy_flags, status"
            )
            .order("started_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        runs = rows_resp.data or []
    except Exception as exc:
        logger.error("get_research_runs DB error: %s", exc)
        raise HTTPException(status_code=503, detail="Database query failed")

    return {
        "runs": runs,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@research_router.get("/conflicts")
def get_research_conflicts(
    limit: int = 20,
    offset: int = 0,
    _token: str = Depends(verify_admin_token),
):
    """
    GET /api/v1/research/conflicts

    Returns wines with unresolved conflict_candidates entries.
    Ordered by last_research_run_at DESC.

    Query params:
        limit:  max conflicts to return (default 20)
        offset: pagination offset (default 0)

    Response: { conflicts: [...], total: int }
    Each conflict: {
      submission_id, wine_name, vintage, conflicted_fields (dict), detected_at
    }
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        count_resp = (
            supabase.table("master_wine_library_submissions")
            .select("id", count="exact")
            .not_.is_("conflict_candidates", "null")
            .neq("conflict_candidates", "{}")
            .execute()
        )
        total = count_resp.count or 0

        rows_resp = (
            supabase.table("master_wine_library_submissions")
            .select("id, conflict_candidates, field_confidence, last_research_run_at")
            .not_.is_("conflict_candidates", "null")
            .neq("conflict_candidates", "{}")
            .order("last_research_run_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        rows = rows_resp.data or []
    except Exception as exc:
        logger.error("get_research_conflicts DB error: %s", exc)
        raise HTTPException(status_code=503, detail="Database query failed")

    conflicts = []
    for row in rows:
        fc = row.get("field_confidence") or {}

        # Extract wine_name and vintage from field_confidence for display context
        wine_name = None
        vintage = None
        if isinstance(fc, dict):
            wn_entry = fc.get("wine_name")
            vt_entry = fc.get("vintage")
            wine_name = (
                wn_entry.get("value") if isinstance(wn_entry, dict) else wn_entry
            )
            vintage = vt_entry.get("value") if isinstance(vt_entry, dict) else vt_entry

        conflicts.append(
            {
                "submission_id": row["id"],
                "wine_name": wine_name,
                "vintage": vintage,
                "conflicted_fields": row.get("conflict_candidates") or {},
                "detected_at": row.get("last_research_run_at"),
            }
        )

    return {
        "conflicts": conflicts,
        "total": total,
    }


@research_router.get("/challenges")
def get_research_challenges(
    status: str = "open",
    limit: int = 20,
    offset: int = 0,
    _token: str = Depends(verify_admin_token),
):
    """
    GET /api/v1/research/challenges

    Returns resolution_challenges — tier-A evidence that contradicts human_resolved fields.
    Filterable by status: open | accepted | dismissed.

    Response: { challenges: [...], total: int }
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    limit = min(limit, 100)

    try:
        count_resp = (
            supabase.table("resolution_challenges")
            .select("id", count="exact")
            .eq("status", status)
            .execute()
        )
        total = count_resp.count or 0

        rows_resp = (
            supabase.table("resolution_challenges")
            .select(
                "id, submission_id, field_name, existing_value, challenging_value, "
                "challenging_source_url, challenging_source_tier, snippet, "
                "challenged_at, status, resolved_by, resolved_at"
            )
            .eq("status", status)
            .order("challenged_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        challenges = rows_resp.data or []
    except Exception as exc:
        logger.error("get_research_challenges DB error: %s", exc)
        raise HTTPException(status_code=503, detail="Database query failed")

    return {"challenges": challenges, "total": total}


@research_router.post("/trigger")
def trigger_research(body: TriggerRequest, _token: str = Depends(verify_admin_token)):
    """
    POST /api/v1/research/trigger

    Manually dispatch research_agent_task for one or more eligible records.

    Request body:
      submission_id: str | None  — if provided, targets a single record
      batch_size:    int = 10    — max eligible records to queue (capped at 100 per T-12-10)

    Response: { queued: int, run_message: str }

    Returns 429 if a research_run with status='running' already exists (T-12-11).
    Returns 503 if Celery broker is unavailable.
    """
    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # T-12-11: Enforce one active run at a time
    try:
        running_resp = (
            supabase.table("research_runs")
            .select("id", count="exact")
            .eq("status", "running")
            .execute()
        )
        running_count = running_resp.count or 0
        if running_count > 0:
            raise HTTPException(
                status_code=429,
                detail="A research run is already in progress. Wait for it to complete before triggering another.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "trigger_research: could not check running status (non-fatal): %s", exc
        )

    # Import Celery task
    try:
        from jobs.research_tasks import research_agent_task
    except ImportError as exc:
        logger.error("trigger_research: could not import research_agent_task: %s", exc)
        raise HTTPException(status_code=503, detail="Research task module unavailable")

    queued = 0
    submission_ids: List[str] = []

    if body.submission_id:
        # Single-record mode
        submission_ids = [body.submission_id]
    else:
        # Batch mode: query eligible records
        # Eligible = last_research_run_at IS NULL OR last_research_run_at < NOW() - INTERVAL '7 days'
        # Priority: any field_confidence entry below 0.8 for priority fields
        try:
            from datetime import timedelta

            cooldown_cutoff = (
                datetime.now(timezone.utc) - timedelta(days=7)
            ).isoformat()

            # Records never researched
            never_resp = (
                supabase.table("master_wine_library_submissions")
                .select("id")
                .is_("last_research_run_at", "null")
                .limit(body.batch_size)
                .execute()
            )
            never_ids = [r["id"] for r in (never_resp.data or [])]

            # Records past cooldown (if we haven't filled batch yet)
            remaining = body.batch_size - len(never_ids)
            stale_ids: List[str] = []
            if remaining > 0:
                stale_resp = (
                    supabase.table("master_wine_library_submissions")
                    .select("id")
                    .not_.is_("last_research_run_at", "null")
                    .lt("last_research_run_at", cooldown_cutoff)
                    .limit(remaining)
                    .execute()
                )
                stale_ids = [r["id"] for r in (stale_resp.data or [])]

            submission_ids = never_ids + stale_ids
        except Exception as exc:
            logger.error("trigger_research: eligible records query failed: %s", exc)
            raise HTTPException(
                status_code=503, detail=f"Failed to query eligible records: {exc}"
            )

    if not submission_ids:
        return {"queued": 0, "run_message": "No eligible records found for research"}

    # Dispatch Celery tasks
    dispatch_errors = []
    for sid in submission_ids:
        try:
            research_agent_task.delay(sid)
            queued += 1
        except Exception as exc:
            dispatch_errors.append(str(exc))
            logger.error("trigger_research: dispatch failed for %s: %s", sid, exc)

    if queued == 0 and dispatch_errors:
        raise HTTPException(
            status_code=503,
            detail=f"Celery broker unavailable — could not dispatch tasks: {dispatch_errors[0]}",
        )

    run_message = f"Queued {queued} research task(s)"
    if dispatch_errors:
        run_message += f" ({len(dispatch_errors)} dispatch error(s) — check broker)"

    return {"queued": queued, "run_message": run_message}
