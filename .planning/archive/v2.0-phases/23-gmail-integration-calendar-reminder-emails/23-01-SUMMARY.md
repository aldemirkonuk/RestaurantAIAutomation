---
phase: 23-gmail-integration-calendar-reminder-emails
plan: "01"
subsystem: gmail-oauth2-setup
tags: [gmail, oauth2, credentials, setup-guide, security]
dependency_graph:
  requires: []
  provides:
    - scripts/gmail-setup/generate_refresh_token.py
    - scripts/gmail-setup/GOOGLE_CLOUD_SETUP.md
  affects:
    - GmailService (apps/api-gateway/src/communications/gmail.service.ts) — unblocked once credentials set on Railway
tech_stack:
  added:
    - google-auth-oauthlib (Python, dev-time only — not added to production requirements)
  patterns:
    - OAuth2 InstalledAppFlow for refresh token generation
    - client_secrets.json gitignored (T-23-01-01 mitigation)
key_files:
  created:
    - scripts/gmail-setup/generate_refresh_token.py
    - scripts/gmail-setup/GOOGLE_CLOUD_SETUP.md
  modified:
    - .gitignore (added client_secrets.json)
decisions:
  - "Web application OAuth2 client type (not Desktop) — required for server-side refresh token flow with oauthplayground redirect URI"
  - "Minimum viable scopes: gmail.send + gmail.readonly — covers all GmailService + GmailWatchService operations"
  - "Both token generation methods provided: Python script (Method A) and OAuth Playground (Method B) — reduces friction if Python unavailable"
  - "client_secrets.json added to root .gitignore — addresses T-23-01-01 Information Disclosure threat"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-04-14"
  tasks_completed: 1
  tasks_total: 2
  files_created: 2
  files_modified: 1
---

# Phase 23 Plan 01: Gmail OAuth2 Credential Toolkit Summary

**One-liner:** Python OAuth2 InstalledAppFlow script + 5-step Google Cloud guide to generate GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN for Railway wiring.

---

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create refresh token generator script and setup guide | b932470 | scripts/gmail-setup/generate_refresh_token.py, scripts/gmail-setup/GOOGLE_CLOUD_SETUP.md, .gitignore |

---

## Paused At

**Task 2: Execute Google Cloud setup and generate OAuth2 credentials** — `checkpoint:human-action`

This task requires the user to perform Google Cloud console steps that cannot be automated:
1. Create Google Cloud Project
2. Enable Gmail API
3. Configure OAuth Consent Screen (External, add `wineops.ai@gmail.com` as test user)
4. Create OAuth 2.0 Client ID (Web application type, add oauthplayground redirect URI)
5. Generate refresh token via `generate_refresh_token.py` or OAuth Playground

Resume signal: type **"oauth2 done"** and paste the first 8 characters of GMAIL_CLIENT_ID.

---

## Deviations from Plan

None — plan executed exactly as written. The `client_secrets.json` gitignore entry was added as part of Task 1 (T-23-01-01 threat mitigation, explicitly called out in acceptance criteria).

---

## Threat Mitigations Applied

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-23-01-01 | `client_secrets.json` added to root `.gitignore`; GOOGLE_CLOUD_SETUP.md Step 4 and Security Notes explicitly warn never to commit |
| T-23-01-02 | `generate_refresh_token.py` prints token to stdout only (no file write); setup guide instructs to copy to password manager |
| T-23-01-03 | Scopes restricted to `gmail.send` + `gmail.readonly` (minimum viable) |
| T-23-01-04 | Setup guide Step 3 adds `wineops.ai@gmail.com` as test user; app stays in Testing mode |

---

## Known Stubs

None — this plan produces setup tooling, not runtime code. No data flows to UI.

---

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced.

---

## Self-Check

Checking created files exist:

- `scripts/gmail-setup/generate_refresh_token.py` → FOUND
- `scripts/gmail-setup/GOOGLE_CLOUD_SETUP.md` → FOUND
- Commit `b932470` → FOUND (`feat(23-01): add Gmail OAuth2 credential toolkit`)

## Self-Check: PASSED
