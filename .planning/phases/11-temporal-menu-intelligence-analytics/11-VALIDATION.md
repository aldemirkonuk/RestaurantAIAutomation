---
phase: 11
slug: temporal-menu-intelligence-analytics
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-06
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (confirmed in `services/agent-orchestrator/tests/`) |
| **Config file** | none — test discovery via default |
| **Quick run command** | `pytest services/agent-orchestrator/tests/test_menu_diff_service.py services/agent-orchestrator/tests/test_recrawl_tasks.py -x` |
| **Full suite command** | `pytest services/agent-orchestrator/tests/ -x --timeout=30` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | TEMP-01 | smoke | manual Supabase verify after migration push | ❌ Wave 0 | ⬜ pending |
| 11-02-01 | 02 | 2 | TEMP-02 | unit | `pytest tests/test_recrawl_tasks.py -x` | ❌ Wave 0 | ⬜ pending |
| 11-03-01 | 03 | 2 | TEMP-03, TEMP-04 | unit | `pytest tests/test_menu_diff_service.py -x` | ❌ Wave 0 | ⬜ pending |
| 11-04-01 | 04 | 3 | TEMP-05, TEMP-06 | unit | `pytest tests/test_trend_tasks.py -x` | ❌ Wave 0 | ⬜ pending |
| 11-05-01 | 05 | 3 | TEMP-07, TEMP-08 | unit | `pytest tests/test_temporal_analytics.py -x` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `services/agent-orchestrator/tests/test_menu_diff_service.py` — stubs for TEMP-03, TEMP-04 (diff logic, empty guard, price gate ≥$1 AND ≥3%)
- [ ] `services/agent-orchestrator/tests/test_recrawl_tasks.py` — stubs for TEMP-02 (Redis NX dedup, beat selection, schedule update)
- [ ] `services/agent-orchestrator/tests/test_trend_tasks.py` — stubs for TEMP-05, TEMP-06 (popularity count, velocity score formula, burst detection)
- [ ] `services/agent-orchestrator/tests/test_temporal_analytics.py` — stubs for TEMP-07, TEMP-08 (endpoint 200/404/422 coverage)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `supabase db push` applied migration | TEMP-01 | Requires live Supabase connection | Run `supabase db push`, confirm `crawl_schedule` and `restaurant_wine_roster` and `menu_changes` tables exist |
| Nightly beat fires at correct time slot | TEMP-02 | Celery beat requires running worker | Start worker with beat, observe log at 4:30 AM UTC or manually trigger `scheduled_recrawl_task.apply()` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
