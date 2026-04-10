---
phase: "13"
phase-slug: dev-onboarding-ui-with-manual-override-access
date: 2026-04-07
---

# Phase 13: Validation Strategy

## Test Framework

| Property | Value |
|----------|-------|
| Backend framework | pytest 7.x |
| Frontend framework | Vitest |
| Backend config | `services/agent-orchestrator/pytest.ini` |
| Frontend config | `apps/web/vitest.config.ts` |
| Backend quick run | `cd services/agent-orchestrator && pytest tests/test_studio_routes.py tests/test_override_service.py -x` |
| Frontend test run | `cd apps/web && npx vitest run src/components/studio/` |

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| DEVUI-01 | Role enforcement: 403 when non-studio user hits /studio/* | unit | `pytest tests/test_studio_routes.py::test_unauthorized_access -x` |
| DEVUI-02 | Auto-detect URL vs PDF vs manual in StudioIngestionBar | unit | `npx vitest run src/components/studio/StudioIngestionBar.test.tsx` |
| DEVUI-03 | Inline edit cell renders display/editing modes | unit | `npx vitest run src/components/studio/StudioFieldCell.test.tsx` |
| DEVUI-04 | reason required when confidence ≥ 0.8, not required when NULL | unit | `pytest tests/test_studio_routes.py::test_reason_enforcement -x` |
| DEVUI-05 | override_events row inserted on every override | unit | `pytest tests/test_override_service.py::test_override_audit_log -x` |
| DEVUI-06 | merge_field_confidence called on auto-promote | unit | `pytest tests/test_override_service.py::test_merge_on_auto_promote -x` |
| DEVUI-07 | Invite token: single-use, expires, grant correct role | unit | `pytest tests/test_studio_routes.py::test_invite_lifecycle -x` |
| DEVUI-08 | GET /sessions/{id} returns chronological event log | unit | `pytest tests/test_studio_routes.py::test_session_timeline -x` |
| DEVUI-09 | GET /studio/metrics returns override_rate, approval_latency | unit | `pytest tests/test_studio_routes.py::test_studio_metrics -x` |
| DEVUI-10 | E2E: PDF → extract → override 3 fields → approve → promoted | e2e | `pytest tests/test_studio_e2e.py -m e2e -x` |

## Sampling Rate

- **Per task commit:** `cd services/agent-orchestrator && pytest tests/test_studio_routes.py -x`
- **Per wave merge:** `cd services/agent-orchestrator && pytest tests/ -v`
- **Phase gate:** Full suite green before /gsd-verify-work

## Wave 0 Gaps (files to create)

- [ ] `services/agent-orchestrator/tests/test_studio_routes.py` — DEVUI-01, DEVUI-04, DEVUI-07, DEVUI-08, DEVUI-09
- [ ] `services/agent-orchestrator/tests/test_override_service.py` — DEVUI-05, DEVUI-06
- [ ] `services/agent-orchestrator/tests/test_studio_e2e.py` — DEVUI-10
- [ ] `apps/web/src/components/studio/StudioIngestionBar.test.tsx` — DEVUI-02
- [ ] `apps/web/src/components/studio/StudioFieldCell.test.tsx` — DEVUI-03
