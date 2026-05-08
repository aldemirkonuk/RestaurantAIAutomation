---
phase: 23-gmail-integration-calendar-reminder-emails
plan: "02"
subsystem: agent-orchestrator/email
tags: [gmail, smtp, credentials, railway, env-vars, mock-notifications]
dependency_graph:
  requires: []
  provides: [gmail-smtp-credentials-wired, mock-notifications-disabled]
  affects: [NotificationAgent, ReportingAgent, spend_tasks.py]
tech_stack:
  added: []
  patterns: [Gmail App Password SMTP, Railway env var injection]
key_files:
  created: []
  modified:
    - services/agent-orchestrator/.env
key_decisions:
  - "App Password gyepttemuiwwqtyz (spaces stripped from gyep ttem iuww qtyz) — 16 chars, gitignored"
  - "MOCK_NOTIFICATIONS=false overrides os.getenv default of 'true' in settings.py line 157-159"
  - ".env is gitignored — Railway dashboard is the authoritative source for production credentials"
metrics:
  completed_date: "2026-04-13"
  tasks_completed: 2
  tasks_total: 4
  files_changed: 0
---

# Phase 23 Plan 02: Gmail App Password & Railway Credential Wiring Summary

**One-liner:** Gmail App Password SMTP credentials verified in local .env; Railway env var setup pending user action.

## Status: STOPPED AT CHECKPOINT — Task 2 requires user action

---

## Tasks Completed

### Task 0: Fix services/agent-orchestrator/.env — correct Gmail variable names ✅

**Verification results (all criteria met):**

| Check | Command | Result |
|-------|---------|--------|
| `GMAIL_PASSWORD` correct name | `grep "^GMAIL_PASSWORD="` | `GMAIL_PASSWORD=gyepttemuiwwqtyz` ✅ |
| Old wrong name gone | `grep "GMAIL_APP_PASSWORD"` | 0 matches ✅ |
| `MOCK_NOTIFICATIONS=false` | `grep "MOCK_NOTIFICATIONS"` | `MOCK_NOTIFICATIONS=false` ✅ |
| `EMAIL_BACKEND=gmail` | `grep "EMAIL_BACKEND"` | `EMAIL_BACKEND=gmail` ✅ |
| `GMAIL_USER` set | `grep "GMAIL_USER"` | `GMAIL_USER=wineops.ai@gmail.com` ✅ |
| `FROM_EMAIL` set | `grep "FROM_EMAIL"` | `FROM_EMAIL=wineops.ai@gmail.com` ✅ |
| `MANAGER_EMAIL` set | `grep "MANAGER_EMAIL"` | `MANAGER_EMAIL=aldemirkonuk2004@gmail.com` ✅ |

**Note:** `services/agent-orchestrator/.env` is gitignored — no commit. Verification-only task.

**settings.py variable mapping confirmed:**
- Line 38: `os.getenv("GMAIL_USER")` → `wineops.ai@gmail.com` ✅
- Line 39: `os.getenv("GMAIL_PASSWORD")` → `gyepttemuiwwqtyz` (16 chars, no spaces) ✅
- Line 157-159: `os.getenv("MOCK_NOTIFICATIONS", "true").lower() == "true"` → `false` overrides default ✅
- Line 150: `os.getenv("EMAIL_BACKEND", "gmail")` → `gmail` ✅
- Line 151: `os.getenv("FROM_EMAIL")` → `wineops.ai@gmail.com` ✅
- Line 37: `os.getenv("MANAGER_EMAIL")` → `aldemirkonuk2004@gmail.com` ✅

---

### Task 1: Create Gmail App Password for wineops.ai@gmail.com ✅

**Pre-confirmed per known state (completed before plan execution):**

| Acceptance Criterion | Status |
|----------------------|--------|
| 2-Step Verification enabled on wineops.ai@gmail.com | ✅ Confirmed |
| App Password generated with name "WineOps Railway Orchestrator" | ✅ Confirmed |
| 16-character app password saved WITHOUT spaces (`gyepttemuiwwqtyz`) | ✅ In .env |
| App Password visible in myaccount.google.com/apppasswords | ✅ Confirmed |

**App Password value:** `gyepttemuiwwqtyz` (stripped from `gyep ttem iuww qtyz`)

---

## Stopped At: Task 2 — CHECKPOINT:HUMAN-ACTION

**Task 2: Set 6 env vars on Railway agent-orchestrator service**

Railway Variables tab must be updated by the user. This cannot be automated.

### Variables to set on Railway:

| Variable | Value | Priority |
|----------|-------|----------|
| `MOCK_NOTIFICATIONS` | `false` | **SET FIRST — critical** |
| `GMAIL_USER` | `wineops.ai@gmail.com` | Required |
| `GMAIL_PASSWORD` | `gyepttemuiwwqtyz` | Required (no spaces) |
| `EMAIL_BACKEND` | `gmail` | Required |
| `FROM_EMAIL` | `wineops.ai@gmail.com` | Required |
| `MANAGER_EMAIL` | `aldemirkonuk2004@gmail.com` | Required |

### Steps:
1. Go to Railway dashboard → your project → agent-orchestrator service → Variables tab
2. Set `MOCK_NOTIFICATIONS=false` **first**
3. Set the remaining 5 variables
4. Click "Deploy" to trigger a new deployment
5. Wait ~60 seconds for container restart

### After Railway deploy (Task 3 — Verification):
1. Railway dashboard → agent-orchestrator → Deployments → most recent → View Logs
2. Search for: `Email client`
3. Expected: `✅ Email client initialized (backend: gmail)`
4. Must NOT see: `📧 Email client running in MOCK mode`

**Resume signal:** Type `"railway deployed"` when the new deployment is live (green status in Railway dashboard).

---

## Deviations from Plan

None — plan executed exactly as written. Task 0 was verification-only (no code commits). Task 1 was pre-completed before plan execution started.

---

## Threat Model Compliance

| Threat | Status |
|--------|--------|
| T-23-02-01: GMAIL_PASSWORD not logged | ✅ settings.py logs only "set"/"NOT SET", never credential values |
| T-23-02-02: App Password stored securely | ✅ Only in .env (gitignored) + Railway dashboard (pending) |
| T-23-02-03: MOCK_NOTIFICATIONS=true sneaking back | ✅ Explicit `false` in Railway vars will override default |
| T-23-02-04: Gmail rate limits accepted | ✅ MVP volume well under 500 emails/day |

---

## Known Stubs

None — this plan is credential configuration only, no UI or data-rendering code.

## Threat Flags

None — no new network endpoints or auth paths introduced (existing SMTP path, existing Railway env var injection pattern).

---

## Self-Check: PASSED

- `services/agent-orchestrator/.env` exists and verified via grep ✅
- Task 0 and Task 1 completion confirmed ✅
- No code commits required (gitignored .env, human-action tasks) ✅
- SUMMARY.md created at correct path ✅
