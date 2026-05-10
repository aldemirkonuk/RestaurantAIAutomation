# Phase 23: Gmail Integration & Calendar Reminder Emails — Context

**Gathered:** 2026-04-13
**Status:** DEFERRED — revisit later. Plans 01, 02, 04 complete. Blocked at plan 23-03 (user must set Railway OAuth2 env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN). Plans 23-03 + 23-06 remain to resume.

<domain>
## Phase Boundary

Wire Gmail credentials (two paths) so the 9 already-built cron jobs in `ScheduledTasksService` actually deliver email, and extend calendar reminders from T-2 only → T-7 + T-2 + T-1 configurable windows. Enable inbound email processing via Gmail Watch + Google Pub/Sub so vendor replies are captured and linked to their conversation thread history.

The code is largely built. This phase is ~80% credential wiring + ~20% calendar window code additions + inbound Watch setup.

</domain>

<decisions>
## Implementation Decisions

### D-01: Gmail Credential Paths (BOTH — state of the art)
- **api-gateway** (NestJS `GmailService`): OAuth2 via Google APIs — `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_EMAIL=wineops.ai@gmail.com` set on Railway api-gateway service. OAuth2 is the full SOTA path: message threading, delivery receipts, never expires, proper sender identity.
- **agent-orchestrator** (Python `EmailClient`): Gmail App Password SMTP — `GMAIL_USER=wineops.ai@gmail.com`, `GMAIL_PASSWORD=<app-password>`, `EMAIL_BACKEND=gmail` on Railway orchestrator service. Powers `NotificationAgent`, `ReportingAgent`, `spend_tasks.py` agent-triggered alerts.
- Both paths use the same sender account (`wineops.ai@gmail.com`).

### D-02: Sender Account
- **Dedicated program account**: `wineops.ai@gmail.com` — never the personal account, never the restaurant owner's account.
- GMAIL_SENDER_EMAIL (api-gateway) and GMAIL_USER (orchestrator) both set to `wineops.ai@gmail.com`.

### D-03: Recipient Configuration (Multi-recipient, Configurable)
- `MANAGER_EMAIL` env var accepts a **comma-separated list** of email addresses.
- Default: `aldemirkonuk2004@gmail.com` (already hardcoded as fallback in `scheduled-tasks.service.ts`).
- This is already implemented (`emailConfig.split(',').map(e => e.trim())`). Phase 23 must verify this works and document it.
- Every email type that currently hardcodes a single recipient must use the resolver or this comma-split pattern.
- `RecipientResolverService` should also be updated to respect `MANAGER_EMAIL` when resolving `roles: ['manager']`.

### D-04: Calendar Reminder Windows (T-7, T-2, T-1 — configurable)
- Currently only T-2 (2 days before event) fires via `sendEventPrepReminders`.
- **Add**: T-7 (7 days before) and T-1 (1 day before) reminder cron jobs or generalized multi-window query.
- **Configurable via env vars**: `CALENDAR_REMINDER_DAYS=7,2,1` (comma-separated, default 7,2,1). ScheduledTasksService reads this at init; the event-prep cron runs daily and checks each configured window.
- Each window sends the `eventPrepReminder` email template (already built in `GmailService`).

### D-05: Inbound Email — Gmail Watch + Pub/Sub (Phase 23)
- **Enable Gmail Watch** via `GmailWatchService`: set `GMAIL_PUBSUB_TOPIC` env var on Railway api-gateway.
- Requires Google Cloud Pub/Sub topic + subscription pointing at the api-gateway webhook endpoint.
- `GmailWatchService` already subscribes to `INBOX` changes and auto-renews every 6 days.
- Inbound email push notification hits `communications.controller.ts` webhook → fetches new messages via `history.list()` → publishes to RabbitMQ for downstream processing.
- **Thread history**: Each conversation is linked via `gmail_thread_id`. This is already implemented in `EmailParsingAgent` (line 85–86, 171–172) and `ProviderConversationAgent` (line 2261–2262). Phase 23 confirms this works end-to-end.

### D-06: DEFAULT_RESTAURANT_ID
- Must be set on Railway api-gateway: `DEFAULT_RESTAURANT_ID=<uuid from Supabase restaurants table>`.
- Without this, 6 of the 9 cron jobs silently skip. This is the single most important env var for enabling scheduled emails.

### Claude's Discretion
- OAuth2 refresh token generation: Claude will provide the exact step-by-step Google Cloud setup instructions and the token generation script during execution (standard `google-auth-oauthlib` flow).
- Gmail Watch webhook endpoint URL: use the existing `communications.controller.ts` webhook path.
- Pub/Sub topic naming: `wineops-gmail-inbound` (or similar, configurable).
- If `wineops.ai@gmail.com` doesn't exist yet: plan includes setup instructions; user must create the account before credentials can be generated.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### api-gateway Email (OAuth2)
- `apps/api-gateway/src/communications/gmail.service.ts` — Full OAuth2 GmailService with 11 templates. `isConfigured` flag, `ensureGmailReady()` lazy init. Read entirely.
- `apps/api-gateway/src/communications/gmail-watch.service.ts` — Gmail Watch + Pub/Sub subscription, auto-renewal logic. Needs `GMAIL_PUBSUB_TOPIC`.
- `apps/api-gateway/src/communications/scheduled-tasks.service.ts` — 9 cron jobs, all wired to GmailService. `MANAGER_EMAIL` multi-recipient, `DEFAULT_RESTAURANT_ID` gate. Read entirely.
- `apps/api-gateway/src/communications/email-templates.ts` — All 11 template functions and data types.
- `apps/api-gateway/src/communications/recipient-resolver.service.ts` — Role-based recipient resolution. Must respect MANAGER_EMAIL.

### Orchestrator Email (SMTP App Password)
- `services/agent-orchestrator/services/email_client.py` — EmailClient class, gmail + sendgrid backends, `_send_via_gmail()` uses aiosmtplib. Read lines 46–250.
- `services/agent-orchestrator/agents/notification_agent.py` — EmailClient init with config dict. Lines 64–70.
- `services/agent-orchestrator/config/settings.py` — `gmail_user`, `gmail_password`, `email_backend`, `from_email`, `manager_email` settings. Lines 37–39, 150–152.
- `services/agent-orchestrator/jobs/spend_tasks.py` — Direct smtplib usage (sync). Needs GMAIL_USER/PASSWORD.

### Calendar
- `apps/api-gateway/src/communications/scheduled-tasks.service.ts` — `sendEventPrepReminders()` method (lines 440–492). Currently queries T-2 only; extend to configurable windows.

### Inbound / Thread History
- `services/agent-orchestrator/agents/email_parsing_agent.py` — `gmail_message_id`, `gmail_thread_id` parsing (lines 85–86, 171–172).
- `services/agent-orchestrator/agents/provider_conversation_agent.py` — Thread ID saved on send (lines 2261–2262).
- `apps/api-gateway/src/communications/communications.controller.ts` — Gmail Watch push notification webhook handler.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `GmailService` — 11 templates fully built; `sendLowStockAlert`, `sendWeeklyReport`, `sendDailySummary`, `sendOrderApproval`, `sendDeliveryNotification`, `sendRecurringOrderReminder`, `sendDeliveryETANotification`, `sendPaymentDueReminder`, `sendInventoryAuditReminder`, `sendEventPrepReminder`, `sendCustomReminder`
- `ScheduledTasksService` — 9 cron jobs fully implemented; all skip gracefully when env vars missing
- `RecipientResolverService` — role-based resolution; needs to use MANAGER_EMAIL for `roles: ['manager']`
- `EmailClient` (Python) — async SMTP + SendGrid; `mock_mode` flag for testing
- `GmailWatchService` — Watch + auto-renewal fully built; just needs `GMAIL_PUBSUB_TOPIC`

### Established Patterns
- All Railway env vars set via Railway dashboard (never committed to git)
- `MANAGER_EMAIL` already split on comma in ScheduledTasksService init
- Graceful skip pattern: all cron jobs guard on env var presence, log skip reason
- Thread linking: `gmail_thread_id` passed through EmailParsingAgent → ProviderConversationAgent

### Integration Points
- Railway api-gateway env vars → `GmailService.onModuleInit()` → `isConfigured = true`
- Railway orchestrator env vars → `Settings.gmail_user/password` → `EmailClient` → `NotificationAgent`
- Google Cloud: OAuth2 consent → refresh token → Railway `GMAIL_REFRESH_TOKEN`
- Google Cloud: Pub/Sub topic → `GmailWatchService` → webhook → RabbitMQ

</code_context>

<specifics>
## Specific Ideas

- Sender: `wineops.ai@gmail.com` — must be created if not existing
- MANAGER_EMAIL can be comma-separated list, default `aldemirkonuk2004@gmail.com`
- Calendar reminder days configurable: `CALENDAR_REMINDER_DAYS=7,2,1`
- Include setup guide for Google Cloud OAuth2 + Pub/Sub in the plan (user needs to perform one-time steps)
- The OAuth2 path defers googleapis loading to first send (`ensureGmailReady()`) — this is intentional for fast Railway startup

</specifics>

<deferred>
## Deferred Ideas

- LLM-generated weekly report narrative (currently uses template data only) → Phase 24
- Unsubscribe / notification preference management UI → future
- Multiple restaurant support in cron jobs (currently single DEFAULT_RESTAURANT_ID) → Wave 2-6 expansion
- SMS + Push notification testing (Plivo/VAPID) → Phase 25 prod test suite

</deferred>

---

*Phase: 23-gmail-integration-calendar-reminder-emails*
*Context gathered: 2026-04-13*
