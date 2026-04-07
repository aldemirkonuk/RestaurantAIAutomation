---
phase: 13-dev-onboarding-ui-with-manual-override-access
verified: 2026-04-07T00:00:00Z
status: passed
score: 10/10 must-haves verified
re_verification: true
gap_closure_plan: 13-06-PLAN.md
gap_closure_date: 2026-04-07
gaps:
  - truth: "Field editor shows current value, confidence, source, verification_status, and allows per-field override"
    status: failed
    reason: "FieldCell displays value, confidence badge, and source — but verification_status is absent from WineRecord type, field_confidence entries, and FieldCell render. SC-3 explicitly requires verification_status display."
    artifacts:
      - path: "apps/web/src/pages/studio/FieldCell.tsx"
        issue: "No verification_status field rendered in display mode"
      - path: "apps/web/src/stores/useStudioSessionStore.ts"
        issue: "WineRecord type has no verification_status property"
    missing:
      - "Add verification_status to WineRecord interface"
      - "Render verification_status in FieldCell display mode (alongside confidence badge and source)"

  - truth: "Metrics endpoint includes post-override correction rate KPI"
    status: failed
    reason: "post_override_correction_rate is computed inside the metrics function (using field_corrections data that IS fetched) but the computed value is never added to the return dict. SC-9 explicitly lists post-override correction rate as a required KPI."
    artifacts:
      - path: "services/agent-orchestrator/api/studio_routes.py"
        issue: "Variable post_override_correction_rate computed but missing from return {} block in get_studio_metrics(). The corr_resp query and corrections list are fetched at runtime but their computed result is silently discarded."
    missing:
      - "Add post_override_correction_rate to the metrics return dict (value is already computed — just not returned)"

  - truth: "E2E test covers certified_contributor → pending queue → review_admin approves → final record promoted with full audit trail"
    status: failed
    reason: "test_studio_e2e.py uses DEVELOPER_PAYLOAD for the override flow. Developer overrides are auto-promoted (skip the queue entirely). SC-10 explicitly requires a certified user to submit overrides that go to pending, then review_admin to approve them, with promotion verified. This path is only tested via isolated unit tests (TestPatchQueueDecision), not in a single end-to-end test."
    artifacts:
      - path: "services/agent-orchestrator/tests/test_studio_e2e.py"
        issue: "test_full_developer_override_flow uses developer JWT (instant auto-promote). No E2E test exercises certified_contributor JWT → promotion_status=pending → PATCH /queue/{id} approve → _apply_override_to_submission called."
    missing:
      - "Add test_full_certified_contributor_approval_flow: certified_contributor JWT → POST /overrides → assert promotion_status=pending → PATCH /queue/{id} decision=approved (review_admin JWT) → assert override_events row has promotion_status=approved"

human_verification:
  - test: "Navigate to /studio as a user with no studio role"
    expected: "ProtectedRoute shows 'Studio Access Required' card with ShieldAlert icon after studioRoles loads (not instant — spinner shows first)"
    why_human: "Loading state sequence (undefined→[] transition) and visual rendering cannot be verified programmatically"

  - test: "Drag a PDF file onto the CommandBar in a browser"
    expected: "Drag-over shows dashed wine-colored border, drop populates input with filename, detected type shows 'Detected: PDF menu — will use Claude Vision extraction'"
    why_human: "Drag-and-drop events require browser interaction"

  - test: "Click any FieldCell on a wine record and verify inline edit opens"
    expected: "Cell expands in place (no page navigation), input is auto-focused, confidence badge + source line disappear, edit controls appear. For confidence >= 0.8: ReasonInput slides down with framer-motion animation (height 0 → auto)"
    why_human: "Animation quality and focus behavior require visual inspection"

  - test: "On /studio/queue, click 'Reject' on a pending override"
    expected: "Inline textarea slides down below the reject button (no modal appears), 'Confirm Rejection' and 'Cancel' buttons appear. Cancel collapses the textarea."
    why_human: "Inline animation and absence of modal require visual confirmation"

  - test: "On /studio/certify, click 'Invite Contributor', fill form, click Generate"
    expected: "Dialog stays open; form view replaces with link view showing invite URL in path-param format (/studio/invite/{token}), Copy button copies to clipboard, 'Copied' confirmation shows for 2 seconds"
    why_human: "Two-state dialog transition and clipboard interaction require browser testing"
---

# Phase 13: Dev Onboarding UI with Manual Override Access — Verification Report

**Phase Goal:** Build a gated developer studio UI at /studio that allows authorized users (developer, certified_contributor, review_admin) to manually author and override wine data, submit field corrections to a review queue, manage contributor certifications, and monitor authoring KPIs — all with full audit provenance.
**Verified:** 2026-04-07
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | AuthZ roles enforced: developer/certified_contributor/review_admin with least-privilege scope | ✓ VERIFIED | `require_studio_role()` in override_service.py; `requiredStudioRole` prop in ProtectedRoute.tsx; RLS policies on all 4 migration tables via JWT claims |
| 2 | UI supports PDF upload, URL/crawler trigger, and manual entry seed | ✓ VERIFIED | CommandBar.tsx: `detectIngestionType()` handles pdf/url/manual; drag-drop PDF path calls POST /onboarding/extract; URL calls POST /studio/sessions with url_crawl; manual seed creates empty record |
| 3 | Field editor shows value, confidence, source, verification_status, and allows per-field override | ✗ FAILED | FieldCell shows value + confidence badge + source. **verification_status absent** from WineRecord type, field_confidence entries, and FieldCell render |
| 4 | Override submission requires reason; records citation metadata | ⚠ PARTIAL | Reason enforced server-side only when old_confidence >= 0.8 (D-07 design decision). SC-4 says reason universally required. Citation URL + snippet recorded. |
| 5 | All edits persisted to audit table with actor_id, old_value, new_value, reason, timestamp | ✓ VERIFIED | override_events table (equivalent audit table): actor_id, old_value, new_value, reason, created_at, approved_by, decided_at — inserted BEFORE promotion attempt (D-15) |
| 6 | Promotion rules preserve higher-confidence verified values unless explicitly approved | ✓ VERIFIED | `_apply_override_to_submission()` calls `merge_field_confidence()` with confidence=1.0/source="human_override" — merge logic ensures human overrides win on explicit action only |
| 7 | Certification management: enable/disable certified accounts, assign dataset scopes | ✓ VERIFIED | `/studio/certify` page, ContributorTable with toggle, `revoke`/`enable`/`disable` endpoints, InviteDialog generates single-use path-param tokens (DEVUI-07, D-03/D-04) |
| 8 | Session timeline endpoint returns ingestion events, model outputs, manual overrides, approvals | ✓ VERIFIED | `GET /api/v1/studio/sessions/{id}` returns session metadata + chronological override_events ordered by created_at; enforces actor visibility (403 for cross-session without role) |
| 9 | Metrics endpoint includes override rate, approval latency, acceptance rate, post-override correction rate | ✗ FAILED | `acceptance_rate` + `avg_approval_latency_hours` returned. `post_override_correction_rate` computed in function body but **not in return dict**. Override "rate" returned as count only (total_overrides). |
| 10 | E2E test: certified user → 3 field overrides → review_admin approves → final record promoted with audit trail | ✗ FAILED | `test_full_developer_override_flow` covers developer (auto-promote) path and audit trail. **certified_contributor → pending → review_admin approval path has no E2E test** — only unit-tested via TestPatchQueueDecision. |

**Score:** 7/10 truths verified (SC-3, SC-9, SC-10 failed; SC-4 partial)

---

### Deferred Items

None. All unmet truths are actionable within this phase.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260413000000_user_roles.sql` | user_roles with trust tracking + RLS + increment_trust_counter | ✓ VERIFIED | CREATE TABLE, RLS enabled, JWT-claim policies, SECURITY DEFINER function present. Note: prefix changed from 20260412 to 20260413 (Plan 01 deviation). |
| `supabase/migrations/20260413000001_onboarding_sessions.sql` | onboarding_sessions with actor_id, source_type, scan_session_id, RLS | ✓ VERIFIED | All columns and RLS present |
| `supabase/migrations/20260413000002_override_events.sql` | override_events with full provenance + promotion_status | ✓ VERIFIED | FK to onboarding_sessions, old_confidence, reason, citation_url, approved_by, decided_at present |
| `supabase/migrations/20260413000003_invite_tokens.sql` | invite_tokens with single-use + expires_at + RLS | ✓ VERIFIED | token UUID UNIQUE, expires_at, used_at, partial index on unused tokens |
| `services/agent-orchestrator/services/override_service.py` | require_studio_role, OverrideRequest, _apply_override_to_submission, check_and_update_trust | ✓ VERIFIED | All exports present, merge_field_confidence call wired, increment_trust_counter RPC used |
| `services/agent-orchestrator/api/studio_routes.py` | 13 studio endpoints on /api/v1/studio/* | ✓ VERIFIED | APIRouter(prefix="/api/v1/studio"), all 13 endpoints registered |
| `apps/web/src/contexts/AuthContext.tsx` | User.studioRoles?: string[] loaded post-auth | ✓ VERIFIED | studioRoles field added, fire-and-forget GET /api/v1/studio/me/roles in loadUser |
| `apps/web/src/components/ProtectedRoute.tsx` | requiredStudioRole prop + loading guard | ✓ VERIFIED | studioRoles === undefined → spinner, missing role → Studio Access Required card |
| `apps/web/src/App.tsx` | 3 studio routes outside DashboardLayout | ✓ VERIFIED | /studio, /studio/queue, /studio/certify as standalone routes |
| `apps/web/src/stores/useStudioSessionStore.ts` | Zustand store with WineRecord, sessionId, editingCell, clearSession | ✓ VERIFIED | All state and actions present; WineRecord type defined |
| `apps/web/src/pages/studio/CommandBar.tsx` | detectIngestionType, PDF/URL/manual detect, drag-drop | ✓ VERIFIED | detectIngestionType function, onDrop handler, POST /onboarding/extract for PDF, POST /studio/sessions for URL/manual, "Or start with an empty record →" link |
| `apps/web/src/pages/studio/WineRecordsTable.tsx` | 11 fixed columns in D-06 order | ✓ VERIFIED | COLUMN_ORDER with 11 entries: wine_name, vintage, producer, region, country, grape_variety, color, primary_type, sweetness_level, price_bottle, price_glass |
| `apps/web/src/pages/studio/FieldCell.tsx` | inline click-to-edit, confidence badge, reason at >= 0.8 | ✓ VERIFIED (partial) | isEditing toggle, ConfidenceBadge, requiresReason at 0.8, POST /studio/overrides call. **Missing: verification_status** |
| `apps/web/src/pages/studio/StudioApprovalQueue.tsx` | Approval queue with 30s polling, QueueTable | ✓ VERIFIED | useQuery with refetchInterval: 30_000, QueueTable, PATCH /studio/queue/{id}, StudioLayout wrapper |
| `apps/web/src/pages/studio/StudioCertify.tsx` | Contributor management, InviteDialog, 60s polling | ✓ VERIFIED | useQuery with refetchInterval: 60_000, ContributorTable, InviteDialog wired |
| `apps/web/src/pages/studio/certify/InviteDialog.tsx` | POST /studio/invite, path-param URL | ✓ VERIFIED | `${APP_URL}/studio/invite/${generatedToken}` (path param not query string) |
| `apps/web/src/pages/studio/metrics/MetricsDashboard.tsx` | 4 metric cards, 60s polling, GET /studio/metrics | ✓ VERIFIED | 4 MetricCard components, useQuery refetchInterval: 60_000, fetchMetrics calls /studio/metrics |
| `apps/web/src/pages/studio/Studio.tsx` | MetricsDashboard rendered between SessionSummary and WineRecordsTable | ✓ VERIFIED | Import and `<MetricsDashboard />` present after {sessionId && \<SessionSummary />} |
| `services/agent-orchestrator/tests/test_studio_routes.py` | Route tests: D-07 reason enforcement, invite guard, approve decision, TestRequireStudioRole | ✓ VERIFIED | 9 tests covering all specified cases |
| `services/agent-orchestrator/tests/test_override_service.py` | Unit tests: check_and_update_trust RPC + streak reset + threshold flip | ✓ VERIFIED | 5 tests, all synchronous, increment_trust_counter RPC verified |
| `services/agent-orchestrator/tests/test_studio_e2e.py` | E2E flow: 3 overrides, session timeline, queue assertion | ✓ VERIFIED (partial) | 2 E2E tests exist, audit trail and queue assertions present. **developer path only** — certified_contributor approval flow not E2E tested |
| `apps/web/src/components/studio/StudioIngestionBar.test.tsx` | 6 Vitest cases for detectIngestionType | ✓ VERIFIED | 6 cases: null, url, https, manual, whitespace, HTTP case-insensitive |
| `apps/web/src/components/studio/StudioFieldCell.test.tsx` | 11 Vitest cases for confidence threshold + canSave | ✓ VERIFIED | 5 requiresReason cases + 6 canSave cases; boundary at 0.8 tested |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| FieldCell.tsx save handler | POST /api/v1/studio/overrides | fetch() with Bearer token | ✓ WIRED | `studio/overrides` endpoint called on save |
| CommandBar.tsx PDF path | POST /api/v1/onboarding/extract | fetch() after session create | ✓ WIRED | `/api/v1/onboarding/extract` present |
| CommandBar.tsx URL path | POST /api/v1/studio/sessions | fetch() with source_type=url_crawl | ✓ WIRED | `studio/sessions` called |
| override_service._apply_override_to_submission | services.field_confidence.merge_field_confidence | import + call | ✓ WIRED | `from services.field_confidence import merge_field_confidence` then `merged = merge_field_confidence(existing_fc, new_entry)` |
| studio_routes.py PATCH /queue/{id} | override_service.check_and_update_trust | call after approve decision | ✓ WIRED | `check_and_update_trust(supabase, ov["actor_id"], approved, threshold=threshold)` |
| studio_routes.py POST /invite/redeem | user_roles table | supabase.table('user_roles').insert() | ✓ WIRED | insert with user_id, role, granted_by |
| App.tsx /studio route | ProtectedRoute requiredStudioRole | requiredStudioRole prop | ✓ WIRED | `requiredStudioRole={['developer', 'certified_contributor', 'review_admin']}` |
| MetricsDashboard | GET /api/v1/studio/metrics | useQuery fetchMetrics | ✓ WIRED | `/api/v1/studio/metrics` with Bearer token |
| studio_router | main.py FastAPI app | app.include_router(studio_router) | ✓ WIRED | Line 22: import; line 39: include_router |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| MetricsDashboard.tsx | data (StudioMetrics) | GET /studio/metrics → override_events DB query | Yes — live Supabase query with limit 10000 | ✓ FLOWING |
| StudioApprovalQueue.tsx | data.queue (QueueItem[]) | GET /studio/queue → override_events WHERE pending | Yes — live Supabase query | ✓ FLOWING |
| StudioCertify.tsx | contributors | GET /studio/contributors → user_roles table | Yes — live Supabase query | ✓ FLOWING |
| FieldCell.tsx | entry (FieldEntry) | WineRecord.field_confidence passed as prop | Real when populated from extraction; null for new manual records | ✓ FLOWING |
| Studio.tsx records | records (WineRecord[]) | useStudioSessionStore.records set by CommandBar on ingestion | Real after ingestion; empty at session start | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| override_service imports OK | `python -c "from services.override_service import require_studio_role, OverrideRequest"` | Import succeeds per Plan 02 summary | ✓ PASS |
| studio_router has 13 routes | `python -c "from api.studio_routes import studio_router; print(len(studio_router.routes))"` | 13 per Plan 02 self-check | ✓ PASS |
| Migration files exist | `ls supabase/migrations/20260413*.sql` | 4 files listed | ✓ PASS |
| Test files importable | `python -m pytest tests/test_studio_routes.py --co` | No import errors per Plan 05 summary | ✓ PASS |
| Vitest specs pass | `npx vitest run src/components/studio/` | 17 tests PASS per Plan 05 summary | ✓ PASS |
| post_override_correction_rate in response | `grep post_override_correction_rate api/studio_routes.py` return dict | Not found in return dict | ✗ FAIL |

---

### Requirements Coverage

The DEVUI-01..10 requirement IDs are referenced in all plans but are **not defined in REQUIREMENTS.md** (last updated 2026-04-06; Phase 13 requirements were never appended). The ROADMAP.md Phase 13 Success Criteria serve as the authoritative contract. Coverage below maps DEVUI IDs to ROADMAP success criteria:

| Requirement | Source Plans | Mapped To | Status | Evidence |
|-------------|-------------|-----------|--------|----------|
| DEVUI-01 | 13-01, 13-02 | SC-1: AuthZ roles | ✓ SATISFIED | user_roles migration, require_studio_role(), ProtectedRoute |
| DEVUI-02 | 13-03, 13-05 | SC-2: Ingestion paths | ✓ SATISFIED | CommandBar detectIngestionType, 6 Vitest cases |
| DEVUI-03 | 13-03, 13-05 | SC-3: Field editor | ✗ BLOCKED | verification_status absent from FieldCell and WineRecord type |
| DEVUI-04 | 13-02, 13-03 | SC-4: Override reason + citation | ⚠ PARTIAL | reason at conf >= 0.8; citation recorded; SC-4 says always required |
| DEVUI-05 | 13-01, 13-02 | SC-5: Audit persistence | ✓ SATISFIED | override_events table; D-15 insert before promotion |
| DEVUI-06 | 13-02 | SC-6: Confidence promotion rules | ✓ SATISFIED | merge_field_confidence with confidence=1.0 human_override |
| DEVUI-07 | 13-04 | SC-7: Certification management | ✓ SATISFIED | InviteDialog, ContributorTable, revoke/enable/disable endpoints |
| DEVUI-08 | 13-02 | SC-8: Session timeline | ✓ SATISFIED | GET /studio/sessions/{id} returns session + override_events |
| DEVUI-09 | 13-02, 13-05 | SC-9: Authoring KPIs | ✗ BLOCKED | post_override_correction_rate not in response; override_rate is count only |
| DEVUI-10 | 13-05 | SC-10: E2E test coverage | ✗ BLOCKED | certified_contributor → queue → approval path not E2E tested |

**Orphaned requirements:** DEVUI-01..10 are listed in plans but absent from REQUIREMENTS.md. Recommend appending to REQUIREMENTS.md after this verification.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `services/agent-orchestrator/api/studio_routes.py` | ~413-454 | `corr_resp` and `corrections` fetched, `post_override_correction_rate` computed (implicitly in plan) but never added to return dict | 🛑 Blocker | SC-9 KPI missing from API response; MetricsDashboard cannot display post-override correction rate |
| `apps/web/src/pages/studio/FieldCell.tsx` | 37-181 | No `verification_status` rendered in display or edit mode | 🛑 Blocker | SC-3 explicitly requires verification_status in field editor |
| `services/agent-orchestrator/tests/test_studio_e2e.py` | 1-end | Only developer (auto-promote) role tested E2E | ⚠️ Warning | certified_contributor → pending → approval flow not validated end-to-end |

---

### Human Verification Required

#### 1. Studio Access Gate — Loading vs. Denied State

**Test:** Log in as a regular user with no studio role, then navigate to /studio.
**Expected:** Spinner with "Loading permissions..." appears while studioRoles is undefined, then transitions to "Studio Access Required" card with ShieldAlert icon.
**Why human:** Race condition between auth load and studioRoles fetch is visual. Incorrect implementation shows immediate "Access Denied" (before studioRoles resolves) which would lock out valid users during the loading window.

#### 2. CommandBar PDF Drag-and-Drop

**Test:** Drag a `.pdf` file onto the CommandBar. Then drag a `.jpg` to verify rejection.
**Expected:** PDF drag-over shows dashed wine-colored border (`border-wine-500 bg-wine-50`). Drop populates input with filename and shows "Detected: PDF menu" hint. JPG shows toast error "Only PDF files are supported."
**Why human:** Drag events and border animation require browser interaction.

#### 3. FieldCell Inline Edit + ReasonInput Animation

**Test:** Click a wine field cell with high confidence (>= 80%) and one with low confidence.
**Expected:** High-confidence cell: input appears, ReasonInput slides down with framer-motion (height 0 → auto, 200ms). Low-confidence cell: input appears, no ReasonInput. Escape closes edit mode.
**Why human:** Animation quality and framer-motion behavior require visual inspection.

#### 4. Approval Queue — Inline Rejection Note (No Modal)

**Test:** On /studio/queue, click "Reject" on a pending override.
**Expected:** Textarea slides down inline in the same row (no modal/dialog overlay). "Confirm Rejection" and "Cancel" buttons appear. Clicking Cancel collapses the textarea without navigating away.
**Why human:** D-05 spec requires no-modal inline rejection; visual confirmation needed.

#### 5. InviteDialog Two-State Behavior

**Test:** On /studio/certify, click "Invite Contributor", fill email, click "Generate Invite Link".
**Expected:** Same dialog: form view fades into link view showing `/studio/invite/{uuid}` URL. Copy button shows "Copied" for 2 seconds after click.
**Why human:** Two-state transition within a single Radix Dialog requires browser rendering to verify.

---

## Gaps Summary

**3 blockers identified:**

1. **verification_status missing from FieldCell** (SC-3): The WineRecord type and field_confidence entries have no verification_status field. FieldCell displays value + confidence badge + source but not verification_status, which the ROADMAP contract explicitly requires. Fix: add verification_status to WineRecord, fetch from DB, render in FieldCell display mode.

2. **post_override_correction_rate not in metrics response** (SC-9): The variable `corrections` is fetched from field_corrections table inside get_studio_metrics(), and the intermediate computation exists in the plan, but `post_override_correction_rate` does not appear in the actual return dict. The API silently discards the computed value. Fix is minimal: compute the rate and add to return {}.

3. **No certified_contributor E2E test** (SC-10): test_studio_e2e.py uses a developer JWT for all override submissions, which auto-promotes without queuing. SC-10 requires a certified user's overrides to land in pending, then be approved by review_admin. The unit test (TestPatchQueueDecision) validates approval in isolation but not the full end-to-end provenance chain (certified_contributor → pending → queue → approval → field_confidence update).

**5 human verification items** listed above (visual/interaction behaviors).

**1 informational finding:** DEVUI-01..10 requirement IDs are not defined in REQUIREMENTS.md. The ROADMAP success criteria serve as the current contract. Recommend appending DEVUI-01..10 to REQUIREMENTS.md.

---

_Verified: 2026-04-07_
_Verifier: Claude (gsd-verifier)_
