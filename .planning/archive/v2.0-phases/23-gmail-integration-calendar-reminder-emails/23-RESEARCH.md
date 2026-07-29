# Phase 23: Gmail Integration & Calendar Reminder Emails — Research

**Researched:** 2026-04-13
**Domain:** Gmail OAuth2 API, Gmail SMTP (App Password), Google Cloud Pub/Sub, NestJS cron jobs
**Confidence:** HIGH — all findings verified against actual codebase files

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01**: BOTH Gmail paths activated — OAuth2 for api-gateway GmailService + App Password SMTP for orchestrator EmailClient
- **D-02**: Sender account: `wineops.ai@gmail.com` (dedicated program account, never personal)
- **D-03**: `MANAGER_EMAIL` env var, comma-separated multi-recipient. Default: `aldemirkonuk2004@gmail.com`
- **D-04**: Calendar windows T-7, T-2, T-1 configurable via `CALENDAR_REMINDER_DAYS=7,2,1`
- **D-05**: Inbound Gmail Watch + Pub/Sub enabled in Phase 23
- **D-06**: `DEFAULT_RESTAURANT_ID` must be set on Railway api-gateway

### Claude's Discretion
- OAuth2 refresh token generation: step-by-step Google Cloud setup + token script
- Gmail Watch webhook endpoint URL: use existing `communications.controller.ts` webhook path
- Pub/Sub topic naming: `wineops-gmail-inbound` (configurable)
- If `wineops.ai@gmail.com` doesn't exist yet: plan includes setup instructions

### Deferred Ideas (OUT OF SCOPE)
- LLM-generated weekly report narrative → Phase 24
- Unsubscribe / notification preference management UI → future
- Multiple restaurant support in cron jobs → Wave 2-6 expansion
- SMS + Push notification testing → Phase 25 prod test suite
</user_constraints>

---

## Overview

Phase 23 is approximately **80% credential wiring + 20% code changes**. The email infrastructure (GmailService, GmailWatchService, ScheduledTasksService, EmailClient) is already built and correct. Three concrete code changes are needed:

1. **`sendEventPrepReminders()`** — extend from hardcoded T-2 to configurable multi-window (T-7, T-2, T-1)
2. **`MOCK_NOTIFICATIONS`** — must be set to `false` on Railway orchestrator (defaults to `true` in Settings)
3. **`RecipientResolverService`** — already handles MANAGER_EMAIL via fallback; verify and document (likely no code change needed)

The Pub/Sub domain verification requirement is the most technically demanding new piece — Railway's `up.railway.app` subdomain needs to be registered in Google Cloud's allowed domains list before push subscriptions work.

**Primary recommendation:** Set all Railway env vars first (Wave 0), send a test email to confirm OAuth2 works, then extend calendar windows, then wire Pub/Sub.

---

## 1. Google Cloud OAuth2 Setup

### How GmailService Currently Works

**[VERIFIED: gmail.service.ts lines 63–105]**

`onModuleInit()` reads `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` from config. If all three are present, it stores them in `this.gmailCredentials` and returns immediately (**deferred init** — the `googleapis` package is not loaded at startup to avoid 60–90s event loop blocking on Railway). On the first `sendEmail()` call, `ensureGmailReady()` runs: it creates an OAuth2 client, sets the refresh token, calls `getAccessToken()` with an 8-second timeout, then instantiates `gmail.users`. After success, `this.isConfigured = true`.

**Critical implication**: `isReady()` returns `false` until the first email actually succeeds. Do not check `isReady()` in startup health probes — check for the presence of env vars instead, or trigger a test send on startup.

**[VERIFIED: gmail.service.ts line 525]** If credentials are missing, `mockSendEmail()` is called, which logs a detailed mock email and returns `{ success: true }`. This means **no error is surfaced when credentials are absent** — the cron jobs complete successfully but no email is delivered.

### Required Scopes

For the two Gmail operations in use:

| Operation | Scope Required |
|-----------|---------------|
| `gmail.users.messages.send` | `https://www.googleapis.com/auth/gmail.send` |
| `gmail.users.watch` (Pub/Sub) | `https://www.googleapis.com/auth/gmail.readonly` |
| `gmail.users.history.list` | `https://www.googleapis.com/auth/gmail.readonly` |
| `gmail.users.messages.get` | `https://www.googleapis.com/auth/gmail.readonly` |
| `gmail.users.stop` | `https://www.googleapis.com/auth/gmail.readonly` |

**Minimum viable scope**: `gmail.send gmail.readonly`

**[ASSUMED]** Google recommends using `gmail.modify` instead of `gmail.readonly` for Watch subscriptions because it grants broader access for history fetches. However, `gmail.readonly` is sufficient for `history.list` and `messages.get`. Use `gmail.send` + `gmail.readonly` for least-privilege.

### Google Cloud OAuth2 Setup — Step by Step

**[CITED: console.cloud.google.com — standard OAuth2 Installed App flow]**

1. Create (or reuse) a Google Cloud Project
2. Enable **Gmail API** (APIs & Services → Library → Gmail API → Enable)
3. Configure **OAuth Consent Screen** (APIs & Services → OAuth consent screen):
   - App type: Internal (for single-account use) OR External with `wineops.ai@gmail.com` as test user
   - Add scopes: `gmail.send`, `gmail.readonly`
4. Create **OAuth 2.0 Credentials** (APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID):
   - Application type: **Web application** (not Desktop — web application works for server refresh token flow)
   - Add Authorized redirect URIs: `https://developers.google.com/oauthplayground`
5. Note `CLIENT_ID` and `CLIENT_SECRET`

### Refresh Token Generation

**[CITED: OAuth 2.0 Playground — oauth2.googleapis.com]**

Use the OAuth 2.0 Playground at `https://developers.google.com/oauthplayground/`:

1. Click the gear icon → check "Use your own OAuth credentials"
2. Enter `CLIENT_ID` and `CLIENT_SECRET`
3. In Step 1, enter scopes: `https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly`
4. Click "Authorize APIs" → sign in as `wineops.ai@gmail.com` → Allow
5. In Step 2, click "Exchange authorization code for tokens"
6. Copy the `refresh_token` value — this is `GMAIL_REFRESH_TOKEN`

**[ASSUMED]** Alternatively, use a script with `google-auth-oauthlib` (`InstalledAppFlow`) but the OAuth Playground is simpler for one-time token generation. Risk if wrong: token generation might fail if the app is not configured correctly for the Playground redirect URI.

### googleapis npm Package Version

**[ASSUMED]** The `googleapis` package is already installed (imported in `gmail.service.ts` line 3). No version change needed. The lazy-init pattern in `ensureGmailReady()` avoids the 60–90s cold-start penalty that caused production issues in Phase 22. Do not change this pattern.

---

## 2. Gmail App Password (SMTP)

### How EmailClient Currently Works

**[VERIFIED: email_client.py lines 231–244]**

`EmailClient._send_via_gmail()` uses `aiosmtplib.send()` with:
- `hostname="smtp.gmail.com"`
- `port=587`
- `start_tls=True`

This is the **correct modern approach** for Gmail SMTP. Port 587 + STARTTLS is Google's recommended method.

### spend_tasks.py Uses Different SMTP Settings

**[VERIFIED: spend_tasks.py lines 120–122]**

`spend_tasks.py` uses `smtplib.SMTP_SSL("smtp.gmail.com", 465)`. This is the **older SSL-on-connect approach**. Both port 587 (STARTTLS) and port 465 (SSL) are valid for Gmail App Password. No change is needed to either file — both work.

### Enabling App Password

**[CITED: myaccount.google.com/apppasswords]**

Steps for `wineops.ai@gmail.com`:

1. Enable 2-Step Verification: myaccount.google.com → Security → 2-Step Verification
2. Generate App Password: myaccount.google.com/apppasswords
   - Select "Other (Custom name)" → name it "WineOps Railway"
   - Copy the 16-character App Password (format: `xxxx xxxx xxxx xxxx`)
   - This becomes `GMAIL_PASSWORD` (set without spaces: `xxxxxxxxxxxxxxxx`)

### Critical: MOCK_NOTIFICATIONS Default is True

**[VERIFIED: settings.py line 157–159]**

```python
self.mock_notifications: bool = (
    os.getenv("MOCK_NOTIFICATIONS", "true").lower() == "true"
)
```

`MOCK_NOTIFICATIONS` defaults to `true`. `NotificationAgent` passes `mock_mode=self.mock_mode` to `EmailClient`. **If `MOCK_NOTIFICATIONS` is not explicitly set to `false` on Railway, the orchestrator will never actually send emails.**

**Action required**: Set `MOCK_NOTIFICATIONS=false` on Railway agent-orchestrator service.

### Orchestrator Settings Attributes for Email

**[VERIFIED: settings.py lines 37–39, 150–152]**

```python
self.manager_email = os.getenv("MANAGER_EMAIL")
self.gmail_user = os.getenv("GMAIL_USER")
self.gmail_password = os.getenv("GMAIL_PASSWORD")
self.email_backend: str = os.getenv("EMAIL_BACKEND", "gmail")
self.from_email = os.getenv("FROM_EMAIL")
```

All 5 must be set on Railway. `email_backend` defaults to `"gmail"` — correct. `from_email` can be the same as `gmail_user`.

---

## 3. Gmail Watch + Google Cloud Pub/Sub

### How GmailWatchService Works

**[VERIFIED: gmail-watch.service.ts lines 32–82]**

`onModuleInit()` initializes the OAuth2 client (eagerly, not deferred like GmailService), calls `startWatch()`, and schedules renewal every 6 days via `setInterval`. This means:
- OAuth token validation happens synchronously at startup (blocks module init for up to ~2s for token fetch)
- If the token fails, `isConfigured = false` and the service is silently disabled

**[VERIFIED: gmail-watch.service.ts lines 94–131]**

`startWatch()` calls `gmail.users.watch()` with `topicName` (from `GMAIL_PUBSUB_TOPIC`) and `labelIds` (from `GMAIL_WATCH_LABEL_IDS`, defaults to `['INBOX']`). On success, `historyId` and `expiration` are stored in Redis with 7-day TTL.

### Railway Restart and Watch Renewal

**[VERIFIED: gmail-watch.service.ts lines 66–76]**

The `setInterval` renewal timer resets on every Railway container restart. However, this is **not a problem** because `onModuleInit()` calls `startWatch()` on every startup — effectively renewing the watch on every restart. The 7-day watch window is renewed on every deployment. The `historyId` survives restarts because it is stored in Upstash Redis (not in-process memory).

**Edge case**: If the Railway container runs continuously for exactly 7 days without restart AND the 6-day `setInterval` fires exactly once and then fails silently → watch expires. The code handles this: `fetchNewMessages()` returns `[]` on 404 and calls `startWatch()` again. So the worst case is one missed push notification cycle.

### Google Cloud Pub/Sub Setup — Step by Step

**[CITED: cloud.google.com/pubsub/docs/push]**

1. **Create Pub/Sub Topic** in Google Cloud Console (Pub/Sub → Topics → Create Topic):
   - Topic ID: `wineops-gmail-inbound`
   - Full topic name: `projects/YOUR_PROJECT_ID/topics/wineops-gmail-inbound`
   - This is the value for `GMAIL_PUBSUB_TOPIC`

2. **Grant Gmail publish permission** to the topic:
   - Go to the topic → Permissions → Add principal
   - Principal: `gmail-api-push@system.gserviceaccount.com`
   - Role: `Pub/Sub Publisher`
   - Without this, Gmail's `watch()` call returns 403

3. **Create Push Subscription** (Pub/Sub → Subscriptions → Create Subscription):
   - Subscription ID: `wineops-gmail-inbound-push`
   - Topic: `projects/YOUR_PROJECT_ID/topics/wineops-gmail-inbound`
   - Delivery type: **Push**
   - Endpoint URL: `https://your-api-gateway.up.railway.app/api/v1/communications/webhooks/gmail`
   - Enable authentication: leave unchecked for simplicity (the endpoint is `@Public()`)

### Domain Verification Requirement

**[CITED: cloud.google.com/pubsub/docs/push#receive_push]**

Google Pub/Sub push endpoints **must be HTTPS and on a registered domain**. Railway's auto-generated subdomains (`*.up.railway.app`) are **already valid** for Pub/Sub push because they are on the `railway.app` domain which Google accepts. **No domain verification in Google Search Console is needed for Railway subdomains.**

However, if a custom domain is used, it must be verified at `console.cloud.google.com/apis/credentials/domainverification`.

### Webhook Endpoint Analysis

**[VERIFIED: communications.controller.ts lines 837–963]**

The webhook at `POST /communications/webhooks/gmail` is:
- Decorated `@Public()` — no JWT auth required (correct for Google push)
- Decodes base64 `body.message.data` to get `{ emailAddress, historyId }`
- Fetches new messages via `fetchNewMessages(lastHistoryId)`
- Filters out emails from `GMAIL_SENDER_EMAIL` (our own outbound)
- Publishes each inbound email to RabbitMQ: exchange `email.events`, routing key `email.inbound.received`

**Gap**: The webhook does not validate that the request came from Google. Any HTTP client can POST to this endpoint and trigger message fetches. For Phase 23 this is acceptable (MVP). Phase 24 should add Pub/Sub message token verification.

### historyId Pattern

**[VERIFIED: gmail-watch.service.ts lines 24–25, 116–118]**

```typescript
private readonly HISTORY_ID_KEY = 'gmail:watch:historyId';
private readonly WATCH_EXPIRY_KEY = 'gmail:watch:expiration';
```

Redis key `gmail:watch:historyId` stores the last processed history ID (7-day TTL). On each webhook, `getLastHistoryId()` fetches from Redis, `fetchNewMessages(lastHistoryId)` calls `history.list()`, and `updateHistoryId()` writes the new ID. **If Redis is empty on first webhook**, the code logs a warning, stores the new historyId, and returns `{ status: 'initialized' }` — no messages processed. This is correct behavior for the first notification.

---

## 4. Calendar Reminder Windows

### Current Implementation (T-2 Only)

**[VERIFIED: scheduled-tasks.service.ts lines 440–492]**

```typescript
@Cron('0 8 * * *', { name: 'event-prep-check', timeZone: 'America/New_York' })
async sendEventPrepReminders() {
  if (!this.defaultRestaurantId) return;
  
  const twoDaysFromNow = new Date();
  twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
  const targetDate = twoDaysFromNow.toISOString().split('T')[0];
  
  // Queries calendar_events WHERE event_date = targetDate (T-2 only)
  const { data: events } = await client
    .from('calendar_events')
    .select('*')
    .eq('restaurant_id', this.defaultRestaurantId)
    .gte('event_date', targetDate + 'T00:00:00')
    .lte('event_date', targetDate + 'T23:59:59');
```

The date is hardcoded. `targetDate` is always `now + 2 days`. To extend to T-7, T-2, T-1, the method must read `CALENDAR_REMINDER_DAYS` and loop over each window.

### calendar_events Table Columns Used

**[VERIFIED: scheduled-tasks.service.ts lines 475–486]**

```typescript
await this.gmailService.sendEventPrepReminder({
  to: recipients.emails,
  restaurantName: 'WineOps Restaurant',
  eventName: event.title || event.name || 'Upcoming Event',
  eventDate: event.event_date || targetDate,
  eventTime: event.event_time,
  guestCount: event.guest_count,
  eventType: event.event_type || 'special_event',
  organizer: event.organizer,
  specialRequests: event.special_requests || event.notes,
});
```

Columns accessed: `title`, `name`, `event_date`, `event_time`, `guest_count`, `event_type`, `organizer`, `special_requests`, `notes`. The `restaurant_id` column is used for filtering.

### Required Code Change

The `sendEventPrepReminders()` method needs two changes:

1. **Read `CALENDAR_REMINDER_DAYS` in `onModuleInit()`**:
```typescript
const reminderDaysConfig = this.configService.get<string>('CALENDAR_REMINDER_DAYS') || '7,2,1';
this.calendarReminderDays = reminderDaysConfig.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d));
```

2. **Loop over windows in `sendEventPrepReminders()`**:
```typescript
for (const daysAhead of this.calendarReminderDays) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysAhead);
  const targetDateStr = targetDate.toISOString().split('T')[0];
  // ...query and send for this window
}
```

**Single cron job handles all windows** — no separate crons needed. The daily 8 AM cron iterates over each configured window value and sends reminders for events matching each window.

### Whether Separate Crons Are Needed

**[VERIFIED: scheduled-tasks.service.ts line 440]**

Single daily cron at 8 AM is sufficient. All three reminder windows (T-7, T-2, T-1) fire on the same cron tick but for different event dates. A single database query per window (3 queries total per day) is correct and efficient.

---

## 5. RecipientResolverService and MANAGER_EMAIL

### Current Implementation Analysis

**[VERIFIED: recipient-resolver.service.ts lines 36–38]**

Constructor reads `MANAGER_EMAIL` from config:
```typescript
this.defaultEmail = this.configService.get<string>('MANAGER_EMAIL') || 'aldemirkonuk2004@gmail.com';
```

**[VERIFIED: recipient-resolver.service.ts lines 314–316]**

`getDefaultRecipients()` already splits on comma:
```typescript
const defaults = this.defaultEmail.split(',').map(e => e.trim()).filter(e => e);
```

**[VERIFIED: recipient-resolver.service.ts lines 58–63]**

When DB lookup returns no users for the restaurant, it immediately falls back to defaults:
```typescript
if (userIds.length === 0) {
  this.logger.debug(`No users found for restaurant ${query.restaurantId} with roles ${query.roles.join(', ')}. Using defaults.`);
  return this.getDefaultRecipients(channels);
}
```

**[VERIFIED: recipient-resolver.service.ts lines 115–120]**

Even if users are found but have no emails, it falls back:
```typescript
if (result.emails.length === 0 && channels.includes('email')) {
  this.logger.debug('No email recipients resolved, falling back to defaults');
  const defaults = this.getDefaultRecipients(['email']);
  result.emails = defaults.emails;
}
```

### Conclusion: No Code Change Required for RecipientResolverService

The service already handles `MANAGER_EMAIL` correctly via the double-fallback pattern. Since the production DB likely has no `user_restaurant_access` entries for the manager role yet, ALL calls to `resolveRecipients({ roles: ['manager'] })` will fall back to `MANAGER_EMAIL` automatically.

**Phase 23 action**: Verify this works by checking Railway logs. If `"No users found for restaurant..."` appears in the logs before emails are sent, the fallback is working correctly.

---

## 6. Testing Strategy

### Built-In Mock Mode

**[VERIFIED: gmail.service.ts lines 525–550]**

When credentials are absent, `mockSendEmail()` logs detailed mock output to Railway logs:
```
MOCK EMAIL SENT
To: recipient@email.com
Subject: ...
HTML Content Length: N chars
Mock Message ID: mock_1234567890_abc123
```

This is the safe fallback. Once credentials are set, real sends occur. No separate mock/dry-run mode exists when credentials ARE present.

### Existing Test Endpoints

**[VERIFIED: communications.controller.ts lines 157–318]**

Three test endpoints are already deployed to production:

| Endpoint | What It Tests |
|----------|--------------|
| `POST /api/v1/communications/test/email` | Simple test email to all MANAGER_EMAIL recipients |
| `POST /api/v1/communications/test/low-stock-alert` | Full low-stock alert template to MANAGER_EMAIL |
| `POST /api/v1/communications/test/send-template` | Template test (`test` or `low-stock`) to specified addresses |

Note: `test/email` and `test/low-stock-alert` require JWT auth. `test/send-template` is `@Public()`.

### Manual Cron Triggers

**[VERIFIED: scheduled-tasks.service.ts lines 575–593]**

All cron jobs have manual trigger methods:
```typescript
triggerWeeklyReport()
triggerEventPrepReminders()
triggerRecurringOrderReminders()
triggerDeliveryETANotifications()
triggerPaymentDueReminders()
triggerInventoryAuditReminder()
```

To test without waiting for cron time: expose a temporary admin endpoint or call these directly via the Railway Railway console (exec into container and call the NestJS service via a test script).

### Verifying GmailWatchService is Active

After setting `GMAIL_PUBSUB_TOPIC`, check Railway api-gateway logs on startup for:
```
Gmail Watch started — historyId: XXXX, expires: YYYY-MM-DDTHH:mm:ssZ
Gmail Watch renewal scheduled (every 6 days)
```

To verify historyId is stored in Redis, use Upstash Redis console and check key `gmail:watch:historyId`.

### Verifying Orchestrator EmailClient

Check Railway orchestrator logs for:
```
✅ Email client initialized (backend: gmail)
```
vs.
```
📧 Email client running in MOCK mode
```

If MOCK mode appears, `MOCK_NOTIFICATIONS=true` is still set (default). Set to `false` and redeploy.

### Testing Thread History End-to-End

The thread history flow works as follows:
1. Outbound email sent via `GmailService.sendEmail()` → returns `{ threadId }`
2. `ProviderConversationAgent` stores `gmail_thread_id` in `procurement_conversations`
3. Vendor replies → Gmail push notification → webhook → `email.inbound.received` event
4. `EmailParsingAgent` receives event with `gmail_thread_id` → links to stored conversation

**[VERIFIED: communications.controller.ts lines 939–941]**
The webhook publishes `gmail_thread_id: msg.threadId` — Gmail guarantees replies have the same threadId.

---

## 7. Railway Environment Variables Checklist

### api-gateway (NestJS) — Complete List for Phase 23

| Variable | Value | Required For |
|----------|-------|-------------|
| `GMAIL_CLIENT_ID` | Google Cloud OAuth2 Client ID | GmailService initialization |
| `GMAIL_CLIENT_SECRET` | Google Cloud OAuth2 Client Secret | GmailService initialization |
| `GMAIL_REFRESH_TOKEN` | Generated via OAuth2 Playground | GmailService token refresh |
| `GMAIL_SENDER_EMAIL` | `wineops.ai@gmail.com` | Email From header, inbound filter |
| `GMAIL_PUBSUB_TOPIC` | `projects/YOUR_PROJECT/topics/wineops-gmail-inbound` | GmailWatchService |
| `GMAIL_WATCH_LABEL_IDS` | `INBOX` (optional, this is the default) | GmailWatchService label filter |
| `MANAGER_EMAIL` | `aldemirkonuk2004@gmail.com` (or comma-separated) | All cron jobs, recipient resolver |
| `DEFAULT_RESTAURANT_ID` | UUID from Supabase `restaurants` table | 6 of 9 cron jobs |
| `CALENDAR_REMINDER_DAYS` | `7,2,1` | Extended event prep reminders |

**Env vars already set from Phase 22** (do NOT re-set, they are fine):
- `REDIS_URL` — Upstash (needed for historyId storage in GmailWatchService)
- `RABBITMQ_URL` — CloudAMQP (needed for webhook → EmailParsingAgent routing)
- `JWT_SECRET`, `ADMIN_API_KEY`, `AGENT_ORCHESTRATOR_URL`, etc.

### agent-orchestrator (Python FastAPI) — Complete List for Phase 23

| Variable | Value | Required For |
|----------|-------|-------------|
| `GMAIL_USER` | `wineops.ai@gmail.com` | EmailClient SMTP auth |
| `GMAIL_PASSWORD` | 16-char App Password (no spaces) | EmailClient SMTP auth |
| `EMAIL_BACKEND` | `gmail` | EmailClient backend selection |
| `FROM_EMAIL` | `wineops.ai@gmail.com` | Email From header |
| `MANAGER_EMAIL` | `aldemirkonuk2004@gmail.com` | spend_tasks.py alert recipient |
| `MOCK_NOTIFICATIONS` | `false` | **CRITICAL** — defaults to `true` |

**[VERIFIED: settings.py line 37]** `MANAGER_EMAIL` is read by Settings but used in `spend_tasks.py` directly via settings. `NotificationAgent` reads it from its config dict passed at init time.

### Potential Conflicts

**[VERIFIED: STATE.md Session 13 notes]**

From Phase 22, these were set on api-gateway:
- `REDIS_URL` (Upstash TLS) ✅ already correct
- `RABBITMQ_URL` (CloudAMQP AMQPS) ✅ already correct
- `NODE_ENV=production` ✅ fine

No conflicts expected. The new Gmail vars are additive.

---

## 8. Implementation Gaps Found

### Gap 1: sendEventPrepReminders() Hardcoded to T-2

**[VERIFIED: scheduled-tasks.service.ts lines 451–453]**

```typescript
const twoDaysFromNow = new Date();
twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
const targetDate = twoDaysFromNow.toISOString().split('T')[0];
```

**Fix required**: Read `CALENDAR_REMINDER_DAYS` in `onModuleInit()`, store as `this.calendarReminderDays: number[]`, iterate in `sendEventPrepReminders()`.

### Gap 2: MOCK_NOTIFICATIONS Defaults to true

**[VERIFIED: settings.py line 157–159]**

No code fix needed — just Railway env var: `MOCK_NOTIFICATIONS=false`.

### Gap 3: GmailService.isReady() Returns false Until First Send

**[VERIFIED: gmail.service.ts lines 555–557]**

The `isReady()` method checks `this.isConfigured` which only becomes `true` after a successful `ensureGmailReady()` call. Startup health checks cannot use this to confirm credentials are valid. The `GmailWatchService` on the other hand initializes eagerly and its `isReady()` correctly reflects credential validity.

**No code fix needed** — the lazy init is intentional. Credential validity is confirmed by the first successful test email send.

### Gap 4: spend_tasks.py Does Not Use EmailClient

**[VERIFIED: spend_tasks.py lines 93–126]**

`spend_tasks.py` builds its own `smtplib.SMTP_SSL` connection directly, independently of the `EmailClient` class. This is fine — it is a Celery task (sync) while `EmailClient` is async. Both use the same `GMAIL_USER`/`GMAIL_PASSWORD` credentials.

**No fix needed** — two separate code paths using the same credentials is correct.

### Gap 5: RecipientResolverService Constructor vs. Late Config Load

**[VERIFIED: recipient-resolver.service.ts lines 36–39]**

`RecipientResolverService` reads `MANAGER_EMAIL` in the constructor (not `onModuleInit`). NestJS providers are instantiated with config available, so this is fine — the env var is read correctly. However, if `MANAGER_EMAIL` is a comma-separated list, the constructor stores the entire string in `this.defaultEmail` and `getDefaultRecipients()` correctly splits it.

**No code change needed**.

### Gap 6: Pub/Sub Webhook Has No Token Validation

**[VERIFIED: communications.controller.ts line 837–843]**

The webhook is `@Public()` with no Pub/Sub token verification. For Phase 23 this is acceptable — the endpoint only triggers a Gmail API call to fetch real messages (no data injection risk). Add token validation in Phase 24.

---

## 9. Recommended Plan Structure

Based on the code analysis, the optimal wave structure for Phase 23:

### Wave 0 (Prerequisite — user-executed steps)
- Create `wineops.ai@gmail.com` Google account (if not exists)
- Enable Gmail API in Google Cloud Console
- Generate OAuth2 credentials (Client ID + Secret)
- Generate refresh token via OAuth2 Playground
- Enable 2FA on `wineops.ai@gmail.com`
- Generate App Password
- Create Pub/Sub topic + grant Gmail publish permissions
- Create push subscription pointing to api-gateway webhook URL

### Plan 23-01: Set Railway Env Vars + Verify Both Email Paths
- Set all 9 api-gateway env vars (GMAIL_CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, SENDER_EMAIL, PUBSUB_TOPIC, MANAGER_EMAIL, DEFAULT_RESTAURANT_ID, CALENDAR_REMINDER_DAYS, GMAIL_WATCH_LABEL_IDS)
- Set all 6 orchestrator env vars (GMAIL_USER, GMAIL_PASSWORD, EMAIL_BACKEND, FROM_EMAIL, MANAGER_EMAIL, MOCK_NOTIFICATIONS=false)
- Trigger test email via `POST /api/v1/communications/test/email` — verify delivery
- Check Railway logs for `Gmail API lazy-initialized successfully`
- Check Railway orchestrator logs for `Email client initialized (backend: gmail)` (not MOCK mode)

### Plan 23-02: Extend Calendar Reminder Windows
- Add `calendarReminderDays: number[]` property to `ScheduledTasksService`
- Read `CALENDAR_REMINDER_DAYS` in `onModuleInit()` (default: `[7,2,1]`)
- Refactor `sendEventPrepReminders()` to loop over `this.calendarReminderDays`
- Each window: query `calendar_events` WHERE `event_date = now + N days`, send reminder for each matching event
- Manual test: insert a test event into `calendar_events` 7 days from now, call `triggerEventPrepReminders()`, verify email received

### Plan 23-03: Verify RecipientResolverService + Test All Cron Jobs
- Confirm RecipientResolverService falls back to MANAGER_EMAIL (check logs for `No users found...`)
- Manually trigger each of the 9 cron jobs and verify log output
- Confirm weekly report, daily summary, midday low-stock, recurring order, delivery ETA, payment due, inventory audit all send (or gracefully skip for missing DB data)

### Plan 23-04: Gmail Watch + Pub/Sub Verification
- Create Pub/Sub push subscription (Wave 0 prerequisite)
- Confirm `GMAIL_PUBSUB_TOPIC` set → api-gateway startup logs `Gmail Watch started — historyId: XXX`
- Verify Redis key `gmail:watch:historyId` exists (check Upstash console)
- Test inbound: send an email to `wineops.ai@gmail.com` from another account → verify webhook hit in Railway logs
- Verify RabbitMQ receives `email.inbound.received` event

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual + Railway log verification (no automated test files for this phase — credential wiring) |
| Quick verification | `POST /api/v1/communications/test/email` + Railway log check |
| Full verification | All 9 cron job manual triggers + Gmail inbox delivery confirmation |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | How to Verify |
|--------|----------|-----------|---------------|
| GMAIL-01 | GmailService.isConfigured=true on startup | Manual | Check Railway logs: `Gmail API deferred — will initialize on first send` + first send success |
| GMAIL-02 | Weekly report email delivered Monday 9am | Manual | Trigger `triggerWeeklyReport()` → check inbox |
| GMAIL-03 | Daily summary email delivered | Manual | Trigger daily summary → check inbox |
| GMAIL-04 | Calendar reminders T-7, T-2, T-1 | Manual | Insert test event, trigger `triggerEventPrepReminders()` → check inbox |
| GMAIL-05 | Low stock midday report working | Manual | Trigger `sendMiddayLowStockReport()` → check inbox |
| GMAIL-06 | Orchestrator EmailClient sends via SMTP | Manual | Check Railway orchestrator logs for `Email sent to ...` (not MOCK) |
| CAL-EMAIL-01 | T-7 reminder fires | Manual | Insert event 7 days out, trigger cron, verify email |
| CAL-EMAIL-02 | T-2 reminder fires | Manual | Insert event 2 days out, trigger cron, verify email |
| CAL-EMAIL-03 | T-1 reminder fires | Manual | Insert event 1 day out, trigger cron, verify email |

### Wave 0 Gaps (Prerequisite Files to Create)
- No new test files needed — this phase is credential wiring + one code change
- One code change: `scheduled-tasks.service.ts` (sendEventPrepReminders multi-window)
- Validation is manual delivery confirmation via email inbox

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Railway api-gateway | Gmail credential injection | ✓ | Live (Phase 22) | — |
| Railway orchestrator | SMTP credential injection | ✓ | Live (Phase 22) | — |
| Upstash Redis | historyId storage for Watch | ✓ | Live (Phase 22) | — |
| CloudAMQP RabbitMQ | Webhook → EmailParsingAgent routing | ✓ | Live (Phase 22) | — |
| Google Cloud Project | OAuth2 credentials + Pub/Sub | ✗ (must create) | — | None — blocking |
| `wineops.ai@gmail.com` account | Both email paths | ✗ (must create if not exists) | — | None — blocking |

**Missing dependencies with no fallback:**
- Google Cloud Project with Gmail API enabled — user must create before execution
- `wineops.ai@gmail.com` account — must exist before OAuth2 consent flow

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (OAuth2 tokens) | refresh_token stored only in Railway env vars, never in code |
| V3 Session Management | no | — |
| V4 Access Control | partial | Pub/Sub webhook is @Public() — acceptable for Phase 23 |
| V5 Input Validation | yes | Webhook body decoded from base64, no user-controlled SQL |
| V6 Cryptography | yes | SMTP uses STARTTLS (port 587) or SSL (port 465) — both encrypted |

### Known Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Refresh token leakage | Information Disclosure | Store only in Railway env vars dashboard (never git) |
| App Password exposure | Information Disclosure | Store only in Railway env vars (never logs, never code) |
| Pub/Sub webhook spoofing | Tampering | Phase 23: accepted (triggers Gmail API fetch only, no data injection). Phase 24: add token verification |
| SMTP credentials in logs | Information Disclosure | `settings.py` never logs credential values — only their presence (from Phase 22 pattern) |

---

## Common Pitfalls

### Pitfall 1: App Password with Spaces
**What goes wrong:** Copy-paste from Google generates `xxxx xxxx xxxx xxxx` (with spaces). Setting `GMAIL_PASSWORD` with spaces causes SMTP auth to fail with `535 Authentication failed`.
**How to avoid:** Strip all spaces when setting the Railway env var.

### Pitfall 2: OAuth2 Client Type Mismatch
**What goes wrong:** Creating credentials as "Desktop app" type in Google Cloud when "Web application" is needed for server-side refresh token flow.
**How to avoid:** Select "Web application" and add `https://developers.google.com/oauthplayground` as an authorized redirect URI.

### Pitfall 3: Gmail API Not Enabled
**What goes wrong:** `gmail.users.messages.send()` returns 403 even with valid credentials.
**How to avoid:** Explicitly enable Gmail API in Google Cloud APIs & Services → Library before generating OAuth2 credentials.

### Pitfall 4: Pub/Sub Missing Gmail Publisher Permission
**What goes wrong:** `gmail.users.watch()` returns 403 with message about Pub/Sub topic not found or permission denied.
**How to avoid:** Add `gmail-api-push@system.gserviceaccount.com` as Pub/Sub Publisher on the topic before calling watch.

### Pitfall 5: MOCK_NOTIFICATIONS=true (Default)
**What goes wrong:** Orchestrator emails appear to send (EmailClient init logs success), but no emails are delivered. Railway logs show `📧 [MOCK EMAIL] To: ...` instead of `✅ Email sent to ...`.
**How to avoid:** Explicitly set `MOCK_NOTIFICATIONS=false` on Railway orchestrator. The default is `true`.

### Pitfall 6: DEFAULT_RESTAURANT_ID Not Set
**What goes wrong:** 6 of 9 cron jobs silently skip with log: `Weekly email report skipped: MANAGER_EMAIL or DEFAULT_RESTAURANT_ID not configured`.
**How to avoid:** Get the UUID from Supabase `restaurants` table → set as `DEFAULT_RESTAURANT_ID` on Railway api-gateway.

### Pitfall 7: GmailWatchService Initializes Eagerly (Different from GmailService)
**What goes wrong:** Invalid OAuth2 credentials cause `GmailWatchService` to fail at startup (not lazily on first use), logging an error but not throwing. The api-gateway still starts, but Watch is permanently disabled for that deployment.
**How to avoid:** Check Railway startup logs for `Failed to initialize Gmail Watch` — if this appears, credentials are invalid. Fix and redeploy.

### Pitfall 8: historyId Too Old (404 from history.list)
**What goes wrong:** If the Redis `gmail:watch:historyId` is older than ~7 days (or Gmail's history is pruned), `history.list()` returns 404. The code handles this by calling `startWatch()` again.
**How to avoid:** The code handles this automatically. No action needed. The webhook returns empty results for one cycle, then resumes on the next notification.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OAuth2 Playground redirect URI `developers.google.com/oauthplayground` works for Web Application credential type | Section 1 | Token generation fails — use Desktop app type instead |
| A2 | `gmail.readonly` scope is sufficient for Watch + history.list + messages.get | Section 1 | May need `gmail.modify` — update scope and regenerate token |
| A3 | Railway `*.up.railway.app` subdomains are accepted by Google Pub/Sub without domain verification | Section 3 | Would require custom domain + Google Search Console verification |
| A4 | `wineops.ai@gmail.com` account does not yet exist | All sections | If it exists, skip account creation step |

---

## Sources

### Primary (HIGH confidence — verified against actual code)
- `apps/api-gateway/src/communications/gmail.service.ts` — Full OAuth2 GmailService implementation
- `apps/api-gateway/src/communications/gmail-watch.service.ts` — Watch + Pub/Sub + historyId storage
- `apps/api-gateway/src/communications/scheduled-tasks.service.ts` — 9 cron jobs, CALENDAR_REMINDER_DAYS gap
- `apps/api-gateway/src/communications/recipient-resolver.service.ts` — MANAGER_EMAIL fallback chain
- `apps/api-gateway/src/communications/communications.controller.ts` — Pub/Sub webhook handler
- `services/agent-orchestrator/services/email_client.py` — aiosmtplib port 587 STARTTLS
- `services/agent-orchestrator/config/settings.py` — MOCK_NOTIFICATIONS default true
- `services/agent-orchestrator/jobs/spend_tasks.py` — smtplib.SMTP_SSL port 465

### Secondary (MEDIUM confidence — official documentation)
- [CITED: cloud.google.com/pubsub/docs/push] — Push subscription domain requirements
- [CITED: myaccount.google.com/apppasswords] — App Password generation process
- [CITED: developers.google.com/oauthplayground] — Refresh token generation
- [CITED: console.cloud.google.com] — Gmail API enablement, OAuth2 credentials setup

---

## Metadata

**Confidence breakdown:**
- Credential wiring steps: HIGH — code verified, official docs cited
- Calendar window extension: HIGH — exact code change identified
- RecipientResolverService: HIGH — double-fallback pattern verified in code
- Pub/Sub domain validation: MEDIUM — Railway domain acceptance is assumed (A3)
- MOCK_NOTIFICATIONS bug: HIGH — verified in settings.py source

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (30 days — Gmail API and Pub/Sub APIs are stable)
