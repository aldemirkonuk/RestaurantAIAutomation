---
phase: 05-cost-quality-guardrails
plan: 03
wave: 2
completed: 2026-04-05
---

# Plan 05-03 Summary — Pre-flight Cap Check + Auto-Blocked Gate

## Accomplishments

- Added `PER_RESTAURANT_CAP_USD = 2.00` and `AUTO_BLOCK_THRESHOLD = 0.3` constants to `onboarding_routes.py`
- Added `_preflight_cap_check(supabase, restaurant_id)` helper — queries `api_spend` for cumulative restaurant spend, fails open (returns 0.0 on error)
- Added `_send_cap_alert_email(restaurant_id, spend)` helper — Gmail SMTP alert email, non-fatal
- Pre-flight check runs before extraction: if prior spend > $2.00, sends email + returns HTTP 402
- Submission insert now includes `auto_blocked = completeness_score < 0.3` field — wines with score < 0.3 are blocked from promotion
- Reused preflight-fetched Supabase client for the persist block (avoid double-init)
- Added `smtplib`, `MIMEText`, `MIMEMultipart`, `timezone` imports

## Key decisions
- Fail open: `_preflight_cap_check` query errors return 0.0 — infrastructure failure never blocks extraction
- `auto_blocked` computed at insert time from `completeness_score` already on the wine dict
- Cap check uses `>` (strictly greater), not `>=` — allows exactly $2.00 spend

## Files Modified
- `services/agent-orchestrator/api/onboarding_routes.py` — imports, constants, helpers, preflight check, auto_blocked gate
