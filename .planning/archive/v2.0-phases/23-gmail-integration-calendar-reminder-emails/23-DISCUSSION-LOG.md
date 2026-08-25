# Phase 23: Gmail Integration & Calendar Reminder Emails — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 23-gmail-integration-calendar-reminder-emails
**Areas discussed:** Gmail credential path, Sending account, Calendar windows, Inbound email

---

## Gmail Credential Path

| Option | Description | Selected |
|--------|-------------|----------|
| OAuth2 API only | GMAIL_CLIENT_ID + SECRET + REFRESH_TOKEN on api-gateway | |
| App Password only | GMAIL_USER + GMAIL_PASSWORD on orchestrator | |
| Both (full setup) | OAuth2 for api-gateway + App Password for orchestrator | ✓ |

**User's choice:** "Do the state of the art approach"
**Notes:** Both paths activated. OAuth2 is SOTA for scheduled/threaded email; App Password covers orchestrator agent-triggered SMTP alerts. Same sender account used on both paths.

---

## Sending Account

| Option | Description | Selected |
|--------|-------------|----------|
| Personal Gmail | aldemirkonuk2004@gmail.com | |
| Restaurant owner's Gmail | Owner's personal account | |
| Dedicated program account | wineops.ai@gmail.com | ✓ |

**User's choice:** `wineops.ai@gmail.com` as the program account (sender).
**Notes:** Receiver (MANAGER_EMAIL) goes to `aldemirkonuk2004@gmail.com` by default but must be configurable (comma-separated, multi-recipient). User confirmed the system should support selecting who receives emails — this is already comma-split in the code.

---

## Calendar Reminder Windows

| Option | Description | Selected |
|--------|-------------|----------|
| T-7 + T-2 + T-1 | Full sequence, configurable | ✓ |
| T-2 + T-1 only | Keep it simple | |
| T-7 + T-1 only | Week-out + day-before | |

**User's choice:** T-7 + T-2 + T-1 with configurable detail.
**Notes:** Windows should be configurable via `CALENDAR_REMINDER_DAYS` env var (default: `7,2,1`). Currently only T-2 is built in `sendEventPrepReminders`; T-7 and T-1 windows need to be added.

---

## Inbound Email (Gmail Watch)

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 23 | Gmail Watch + Pub/Sub now | ✓ |
| Phase 24 | Defer to comms pipeline phase | |

**User's choice:** Phase 23 — enable inbound now.
**Notes:** User confirmed each conversation should have its own history. This is already implemented via `gmail_thread_id` in `EmailParsingAgent` and `ProviderConversationAgent`. Phase 23 confirms end-to-end thread linking works.

---

## Claude's Discretion

- OAuth2 setup steps (Google Cloud Console setup guide)
- Pub/Sub topic naming convention
- Webhook endpoint path for Gmail Watch push notifications
