---
phase: 13-dev-onboarding-ui-with-manual-override-access
plan: "02"
subsystem: backend/api
tags: [fastapi, jwt, studio, overrides, trust-management, phase13, role-enforcement, field-confidence]
dependency_graph:
  requires:
    - 13-01 (user_roles, override_events, onboarding_sessions, invite_tokens tables)
    - services/field_confidence.py (merge_field_confidence function)
  provides:
    - require_studio_role() FastAPI dependency (JWT role enforcement)
    - services/agent-orchestrator/services/override_service.py
    - services/agent-orchestrator/api/studio_routes.py (13 endpoints on /api/v1/studio/*)
    - studio_router registered in main.py
    - settings.supabase_jwt_secret + settings.trust_level_threshold
  affects:
    - Phase 13 Plans 03–05 (frontend depends on these endpoints)
    - Any future phase that needs studio role checking
tech_stack:
  added:
    - PyJWT>=2.8.0 (already present at 2.10.1 — no new install needed)
  patterns:
    - FastAPI dependency factory (require_studio_role returns callable, not Depends())
    - JWT app_metadata.roles claim for stateless role check (no DB round-trip)
    - D-12/D-13 dual-path promotion: developer/review_admin auto_promoted, certified_contributor queued/auto_promoted by policy
    - D-15 provenance: override_events insert before any promotion attempt
    - merge_field_confidence with confidence=1.0/source=human_override for human overrides
    - increment_trust_counter SECURITY DEFINER RPC for atomic streak management
key_files:
  created:
    - services/agent-orchestrator/services/override_service.py
    - services/agent-orchestrator/api/studio_routes.py
  modified:
    - services/agent-orchestrator/config/settings.py (supabase_jwt_secret + trust_level_threshold)
    - services/agent-orchestrator/main.py (studio_router import + include_router)
decisions:
  - "require_studio_role() returns _check callable (not Depends(_check)) — FastAPI Depends() must wrap a callable; returning Depends() from factory causes double-wrapping TypeError"
  - "GET /me/roles has no role restriction — any authenticated user must call it for AuthContext to populate studioRoles; gracefully returns empty on any error"
  - "D-07 reason enforcement is server-side: endpoint fetches old_confidence from DB and rejects if >= 0.8 with reason < 5 chars; client-supplied confidence is ignored (T-13-11)"
  - "POST /overrides logs to override_events before calling _apply_override_to_submission — D-15 provenance is non-negotiable even if promotion fails"
metrics:
  duration: "~12 minutes"
  completed_date: "2026-04-07"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 13 Plan 02: Studio Backend API Layer — Summary

**One-liner:** JWT-authenticated FastAPI backend with 13 studio endpoints, PyJWT role enforcement, D-12/D-13 dual-path promotion policy, and atomic trust counter management via Postgres RPC.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create override_service.py + patch settings.py | `eff4745` | `services/override_service.py`, `config/settings.py` |
| 2 | Create studio_routes.py (13 endpoints) + wire into main.py | `53e5653` | `api/studio_routes.py`, `main.py` |

---

## What Was Built

### `services/override_service.py`

- **`require_studio_role(*required_roles)`** — FastAPI dependency factory. Returns `_check` callable (not `Depends(_check)`). Decodes Supabase Bearer JWT using `SUPABASE_JWT_SECRET`, verifies `app_metadata.roles` claim, raises 401/403 on failure. Stateless — no DB round-trip per request (T-13-07).
- **`OverrideRequest`** — POST body with `submission_id`, `field_name`, `new_value`, `reason?`, `citation_url?`, `citation_snippet?`. NOTE: reason enforcement is at the endpoint level (server fetches DB confidence), not in this model.
- **`ApprovalDecision`** — PATCH body with `decision: "approved"|"rejected"` and optional `note`.
- **`InviteRequest`** / **`RedeemRequest`** — invite token creation and redemption models.
- **`_apply_override_to_submission()`** — fetches `field_confidence` JSONB from `master_wine_library_submissions`, calls `merge_field_confidence(existing, {field: {value, confidence: 1.0, source: "human_override"}})`, writes merged result back. Human overrides always win (confidence=1.0) (DEVUI-06).
- **`check_and_update_trust()`** — calls `increment_trust_counter(p_user_id)` RPC for atomic increment. Post-increment checks count; if >= threshold flips `promotion_policy` to `auto_promote`. Rejections reset `consecutive_approved_overrides` to 0 (D-12).
- **`_get_primary_studio_role()`** — priority: `review_admin > developer > certified_contributor`.
- **`_get_user_studio_roles()`** — queries `user_roles` for active (non-revoked) rows.

### `api/studio_routes.py` — 13 Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/sessions` | developer/cc/review_admin | Start new onboarding session |
| GET | `/sessions/{id}` | developer/cc/review_admin | Session timeline with override_events (DEVUI-08, T-13-12) |
| POST | `/overrides` | developer/cc/review_admin | Submit field override (D-07, D-12/D-13, D-15) |
| GET | `/queue` | review_admin | Pending approval queue (D-14) |
| PATCH | `/queue/{id}` | review_admin | Approve or reject pending override |
| POST | `/invite` | review_admin | Generate single-use invite token (DEVUI-07, D-03) |
| POST | `/invite/redeem` | developer/cc/review_admin | Consume token, grant role (D-04) |
| GET | `/metrics` | developer/review_admin | KPI dashboard (DEVUI-09) |
| GET | `/me/roles` | any authenticated | Active roles for AuthContext (open-auth) |
| GET | `/contributors` | review_admin | List certified_contributors |
| PATCH | `/contributors/{id}/revoke` | review_admin | Revoke access (sets revoked_at) |
| PATCH | `/contributors/{id}/enable` | review_admin | Re-enable (clears revoked_at) |
| PATCH | `/contributors/{id}/disable` | review_admin | Disable (alias for revoke) |

### `config/settings.py` Additions
- `supabase_jwt_secret: str` — from `SUPABASE_JWT_SECRET` env var (Supabase Dashboard → Settings → API → JWT Secret)
- `trust_level_threshold: int` — from `TRUST_LEVEL_THRESHOLD` env var (default: 5)

### `main.py` Addition
- `from api.studio_routes import studio_router` + `app.include_router(studio_router)`

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] require_studio_role() must return callable, not Depends(callable)**
- **Found during:** Task 2 verification — `TypeError: Depends(_check) is not a callable object`
- **Issue:** Plan code shows `return Depends(_check)` inside `require_studio_role()`, then endpoints use `Depends(require_studio_role(...))`. This produces `Depends(Depends(_check))` — a double-wrapping that FastAPI rejects on router instantiation.
- **Fix:** Changed `require_studio_role()` to `return _check` (the bare callable). Endpoint `Depends(require_studio_role("developer"))` correctly resolves to `Depends(_check)`.
- **Files modified:** `services/override_service.py`
- **Commit:** `53e5653`

---

## Known Stubs

None. All endpoints connect directly to Supabase tables created in Plan 01. No hardcoded mock values.

---

## Threat Flags

All threats from the plan's `<threat_model>` are addressed in implementation:

| Threat | Implementation | Status |
|--------|---------------|--------|
| T-13-07: Forged JWT | PyJWT verifies with SUPABASE_JWT_SECRET; ExpiredSignatureError → 401; PyJWTError → 401 | ✅ |
| T-13-08: Reason bypass | Endpoint fetches DB `old_confidence`; ignores client value; requires reason ≥5 chars when ≥0.8 | ✅ |
| T-13-09: Self-grant invite | `granted_by = tok["created_by"]` — token creator, not redeemer | ✅ |
| T-13-10: Token brute-force | Token is `gen_random_uuid()` — 128-bit UUID4 | ✅ |
| T-13-11: Trust counter race | `increment_trust_counter` Postgres RPC is atomic SECURITY DEFINER | ✅ |
| T-13-12: Session leakage | `actor_id == user["sub"]` OR role in `(review_admin, developer)` — 403 on mismatch | ✅ |

---

## Self-Check

```
FOUND: services/agent-orchestrator/services/override_service.py
FOUND: services/agent-orchestrator/api/studio_routes.py
FOUND: studio_router has 13 routes (python3 -c "from api.studio_routes import studio_router; print(len(studio_router.routes))")
FOUND: main imported OK (python3 -c "import main; print('main imported OK')")
FOUND: commit eff4745 (Task 1)
FOUND: commit 53e5653 (Task 2)
```

## Self-Check: PASSED

---

## Plan Status: COMPLETE

All 2 tasks executed. `override_service.py` provides role enforcement, promotion logic, and trust management. `studio_routes.py` provides all 13 `/api/v1/studio/*` endpoints. `main.py` registers `studio_router`. Phase 13 Plans 03–05 (frontend) can now be built against these endpoints.
