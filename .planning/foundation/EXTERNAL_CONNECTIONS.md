# External Connections — Mudavym

> Every place the platform talks to something outside its own process: what comes **in**,
> what goes **out**, what fires **on a clock**, and what moves over the **bus**.
> One table per layer, one line per connection. Secret *names* only — never values.

**Verification:** 2026-08-25 · verified against code at `docs/p2-spine-and-pages` HEAD by
grepping `@Controller`/`@Cron`/`@Interval` in `apps/api-gateway/src`, Celery `beat_schedule`
and `declare_exchange` in `services/agent-orchestrator`, and every `https://` literal in both
runtimes. **5 inbound webhooks · 13 outbound services · 34 scheduled jobs · 12 declared exchanges.**
The 2026-08-24 host census below was re-checked and corrected where it had rotted.

---

## 1. Inbound webhooks — things the outside world POSTs to us

| Route | Who calls it | How it is verified | What it triggers | Config gate |
|---|---|---|---|---|
| `POST /toast/webhook` | Toast POS | HMAC-SHA256 `Toast-Signature` (`v1=…`) over `timestamp.body`, constant-time compare — `apps/api-gateway/src/toast/toast.service.ts:106` | Order/stock/menu events → stock depletion | `TOAST_WEBHOOK_SECRET`; ⚠️ `TOAST_MOCK_MODE` defaults **true** (`toast.service.ts:71`) |
| `POST /pos-hub/webhook/:provider/:restaurantId` | Any POS (incl. `generic_webhook`) | HMAC-SHA256 hex `X-Pos-Hub-Signature` over raw body, **fails closed** when unset — `apps/api-gateway/src/pos-hub/pos-hub.service.ts:208` | Normalizes → `pos_checks` upsert → `apply_stock_movement` / `record_glass_pour` | `POS_HUB_WEBHOOK_SECRET` |
| `POST /webhooks/inbound-email` | Inbound-parse provider (Postmark/SES/Mailgun/CF) | Shared secret in `x-inbound-secret` header or `?secret=`; **refuses when unset** — `apps/api-gateway/src/common/orchestrator/inbound-email.controller.ts:60` | Resolves recipient → `restaurant_id`, publishes `email.events` / `email.inbound.received` | `INBOUND_WEBHOOK_SECRET`, `INBOUND_EMAIL_DOMAIN` |
| `POST /communications/webhooks/gmail` | Google Pub/Sub push | ⚠️ **none** — no OIDC/token check; only gated on `gmailWatchService.isReady()` (`communications.controller.ts:990`) | Decodes `historyId`, fetches new Gmail messages, publishes them to the bus | `GMAIL_PUBSUB_TOPIC`, `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`/`GMAIL_REFRESH_TOKEN` |
| `POST /api/v1/pos/webhook/{provider}` | Toast (orchestrator-side twin of row 1) | HMAC-SHA256 hex `Toast-Signature`, **fails closed** — `services/agent-orchestrator/adapters/toast_adapter.py:24` | `POSEvent` → `agent.process_pos_event` | `TOAST_WEBHOOK_SECRET` |

Sibling routes on the same surface: `POST /communications/webhooks/gmail/force-fetch` (`@Public`,
unauthenticated manual trigger) and `GET /communications/webhooks/gmail/status` (JWT-guarded).
Global guards are `RateLimitGuard` + `TenantGuard` only (`app.module.ts:125-132`) — JWT is per-controller,
so `ToastController` carries no JWT guard by design; its HMAC is the whole authentication story.

---

## 2. Outbound integrations — things we call

| Service | Called from | Auth env var (name only) | What for |
|---|---|---|---|
| **Anthropic** | `apps/api-gateway/src/common/model-client/model-client.service.ts:7` (sole gateway choke point, `https://api.anthropic.com/v1/messages`); `services/agent-orchestrator/services/model_clients.py:100` (`anthropic.AsyncAnthropic`) | `ANTHROPIC_API_KEY`, `CLAUDE_API_KEY` | Extraction, enrichment, drafting, consultants |
| **Google Gemini** | `services/agent-orchestrator/services/model_clients.py:68` (`google.genai` client) | `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Email intelligence, VLM extraction, research cascade |
| **Serper** | `services/agent-orchestrator/services/serper_client.py:74` (`https://google.serper.dev/search`) | `SERPER_API_KEY` | Web verification, critic-score and price lookups |
| **OpenAI** | `services/agent-orchestrator/services/auction_wine_service.py:69` | `OPENAI_API_KEY` | ⚠️ Dormant — key is unset in practice (`spend_logger.py:138`) |
| **Toast API** | `apps/api-gateway/src/toast/toast-auth.service.ts:15-16`; `services/agent-orchestrator/services/toast_api_client.py` | `TOAST_CLIENT_ID`, `TOAST_CLIENT_SECRET`, `TOAST_RESTAURANT_GUID` | Menus, orders, sales pulls (`ws-api.toasttab.com` / `-sandbox`) |
| **Gmail API + SMTP** | `apps/api-gateway/src/communications/gmail.service.ts:73-77` (nodemailer + googleapis); `services/agent-orchestrator/services/email_client.py:231` (`smtp.gmail.com`, aiosmtplib) | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_EMAIL` | Vendor email send + inbox watch |
| **Google OAuth / Calendar** | `apps/api-gateway/src/auth` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Login, calendar sync |
| **Microsoft OAuth** | `apps/api-gateway/src/auth` | `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_CALLBACK_URL` | Outlook/365 login |
| **Google Places** | `services/agent-orchestrator/services/google_maps_discovery.py:25` | `GOOGLE_API_KEY` | Restaurant discovery |
| **Plivo** | `apps/api-gateway/src/communications/sms.service.ts:30-33`; `services/agent-orchestrator/services/plivo_client.py` | `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER` | SMS + voice (mock-capable) |
| **Firebase FCM** | `services/agent-orchestrator/services/push_notification_service.py:295` | FCM server key (unset → mock) | Mobile push |
| **Supabase** | `apps/api-gateway/src/database/database.service.ts:13-15`; orchestrator `core/database.py` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Postgres, auth, storage — the system of record |
| **Sentry** | `apps/api-gateway/src/common/error-tracking/sentry.service.ts:29`; `apps/web/src/lib/error-tracking.ts:154` | `SENTRY_DSN`, `VITE_SENTRY_DSN` | Error tracking |

**Arbitrary user-supplied URLs** (vendor-intel page extraction) go through the SSRF guard —
`safeFetch` re-validates every redirect hop: `apps/api-gateway/src/common/net/ssrf-guard.ts:150`,
used at `apps/api-gateway/src/vendor-intel/vendor-page-extractor.service.ts:92,168`. Scrapers that
still fetch fixed public hosts directly (OpenTable, Vivino, wine-searcher) do not use it.

### Model-call choke points (ADR 0008 / ADR 0010)

Every model call in both runtimes funnels through one emitter and dual-writes the spend ledger
plus `neural_footprint_event`:

- **Gateway** — `apps/api-gateway/src/common/model-client/model-client.service.ts` (NF insert at `:413`),
  with task-level verdicts written to the `nf_verdict` sidecar by `nf-verdict.service.ts:77`
  (table: `supabase/migrations/20260825180000_nf_verdict.sql`).
- **Python** — `services/agent-orchestrator/services/spend_logger.py` → `services/neural_footprint.py:125`
  (`insert_event` returns the NF row id since OD-74, so verdicts can attach on this side too).
- CI enforces it: `scripts/check_model_calls_logged.sh` (`.github/workflows/ci.yml`), which exits 2
  rather than green when it cannot verify a call site.

**Live model ids:** `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-4-8`,
`gemini-3.5-flash-lite` (email intel default, `config/settings.py:181`), `gemini-2.5-flash`
(research cascade, `config/settings.py:107`). **Retired and no longer called:** `gemini-2.0-flash`,
`gemini-pro` (ADR 0010), `claude-sonnet-4-20250514` — remaining mentions are comments and historical
pricing rows only.

---

## 3. Crons and schedulers

**Gateway — `@nestjs/schedule`, 17 `@Cron` + 3 `@Interval`** (`ScheduleModule.forRoot()`, `app.module.ts:68`):

| Schedule | Job | File |
|---|---|---|
| `*/2 * * * *` | `low-stock-edge-sweep` | `notifications/low-stock-alerts.service.ts:85` |
| `*/5 * * * *` | `procurement-document-intake-sweep` (email→document ingest) | `procurement/documents/document-intake.service.ts:581` |
| `*/15 * * * *` | `custom-reminders-check` | `communications/scheduled-tasks.service.ts:727` |
| `0 * * * *` | `low-stock-digest` | `notifications/low-stock-alerts.service.ts:110` |
| hourly | insight sweep | `analytics/insights/insight-scheduler.service.ts:42` |
| `15 3 * * *` | `tenant-isolation-check` | `communications/scheduled-tasks.service.ts:93` |
| `17 4 * * *` | `ux-optimizer-evaluate` | `ux-optimizer/ux-optimizer.service.ts:719` |
| `0 6 * * *` | recurring-order reminders | `procurement/recurring-orders.service.ts:271` |
| `0 7 * * 1` | `inventory-audit-reminder` | `communications/scheduled-tasks.service.ts:606` |
| `0 8 * * *` | execute due recurring orders | `procurement/recurring-orders.service.ts:225` |
| `0 8 * * *` | `recurring-order-reminder`, `event-prep-check` | `communications/scheduled-tasks.service.ts:336,666` |
| `0 8 * * 1` | `weekly-email-report` | `communications/scheduled-tasks.service.ts:162` |
| `0 9 * * *` | `daily-sms-summary`, promotion digests | `communications/scheduled-tasks.service.ts:127`; `common/orchestrator/promotion-extractor.service.ts:179` — `payment-due-reminder` was deleted 2026-09-02, having never sent one email ([ADR 0077](../decisions/0077-there-is-no-payment-due-reminder.md)) |
| `0 17 * * *` | `delivery-eta-notification` | `communications/scheduled-tasks.service.ts:431` |
| every 30 s | scheduled auto-sends | `procurement/procurement.service.ts:1902` |
| every 60 s / 5 min | websocket heartbeat / cleanup | `websocket/websocket.gateway.ts:606,631` |

**Orchestrator — Celery beat, 14 entries** (`services/agent-orchestrator/jobs/celery_app.py:77`),
UTC, broker = RabbitMQ, backend = Redis:

| Schedule | Task |
|---|---|
| every 60 s / 5 min | `dlq.process_pending` · `dlq.get_stats` |
| hourly `:00` | `reports.refresh_views` · `spend.monthly_cap_check` · `research.daily_budget_check` |
| hourly `:15` / `:30` | `drift.scan_sim_catalogs` · `research.dispatch_batch` (no-op unless `RESEARCH_DISPATCH_ENABLED`) |
| 02:00 Sun | `research.staleness_reverify` |
| 03:00 | `dlq.cleanup_old` · `score.rescore_stale_wines` |
| 04:00 / 04:30 / 05:00 / 06:00 | `calibration.calibrate_field_thresholds` · `recrawl.scheduled` · `trend.compute_metrics` · `inventory.reconciliation` |

A Celery `task_prerun` hook stamps agent identity + correlation id on every task
(`jobs/celery_app.py:30`), so scheduled work joins the NF ledger the same way agent work does.

---

## 4. Message-queue topology

**Broker:** RabbitMQ (CloudAMQP in prod) — `RABBITMQ_URL`, or composed from `RABBITMQ_HOST`,
`RABBITMQ_PORT`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `RABBITMQ_VHOST`
(`services/agent-orchestrator/config/settings.py:142`; gateway `orchestrator.service.ts:121`).
**Cache/Celery backend:** Redis (Upstash; `redis://…upstash.io` is auto-upgraded to `rediss://`
at `core/database.py:1680`) — `REDIS_URL`.

| Piece | Shape | Where |
|---|---|---|
| `pos.events`, `stock.events`, `procurement.events`, `notification.events`, `report.events`, `menu.events`, `provider.events`, `conversation.events`, `calendar.events`, `voice.events` | topic, durable | `core/message_bus.py:479` |
| `system.control` | topic, durable (high priority) | `core/message_bus.py:490` |
| `broadcast` | **fanout**, durable | `core/message_bus.py:492` |
| `dlx.main` + `retry.delayed` | topic, durable — DLX and delayed redelivery | `core/message_bus.py:508,516` |
| `queue.dead_letters` | durable, 7-day TTL, max 10 000, bound `#` on `dlx.main` | `core/message_bus.py:524` |
| Gateway → WebSocket bridge | 23 bindings; one durable queue per route, named `bridge.nestjs.<exchange>.<routing_key>`, 5-min TTL, max 1 000 | `common/orchestrator/rabbitmq-bridge.service.ts:275-292` |
| Gateway publishes | `assertExchange(topic, durable)` then persistent JSON publish | `common/orchestrator/orchestrator.service.ts:59` |

⚠️ Exchanges the gateway uses but `message_bus.py` does **not** pre-declare — `email.events`,
`recurring.events`, `inventory.events`, `rfq.events`, `delivery.events`, `sommelier.events`,
`verification.events`, `invoice.events`, `vendor.events`, `reporting.events`. They work because
both publisher and bridge `assertExchange` on the fly, but the declared list is not the full
topology, so reading `message_bus.py` alone under-counts the bus.

---

## Appendix — host census (2026-08-24, re-checked 2026-08-25)

Hosts referenced in `apps/**` and `services/**` source (virtualenvs, `node_modules`, and
documentation URLs excluded). **50 distinct runtime hosts · 80 environment variables.** Still-live
flags worth carrying forward:

| Flag | Hosts | Note |
|---|---|---|
| ⚠️ Legacy brand | `api.wineops.ai`, `app.wineops.ai`, `wineops.ai` | Pre-Mudavym; still the hardcoded Gmail sender fallback (`communications.controller.ts:1048`) |
| ⚠️ Dev tunnel | `abc123.ngrok.io` | Must not appear in prod paths |
| ⚠️ Placeholder | `a.com`, `b.com`, `via.placeholder.com`, `your-domain.com` | Fixtures — `your-domain.com` is the unset Plivo callback base (`plivo_voice_client.py:55`) |
| Wine data | `vivino.com`, `wine-searcher.com`, `www.opentable.com` | Scraped without the SSRF guard (fixed hosts) |
| Not a network call | `schema.org` | Structured-data vocabulary only |

**Corrected 2026-08-25:** the earlier note claiming "Anthropic and Gemini appear as hosts but not as
SDK imports — called over raw HTTP/axios, worth confirming retry/timeout/cost accounting" is no
longer accurate. Python uses the official `anthropic` and `google-genai` SDKs
(`services/model_clients.py:44,68`); the gateway's raw `fetch` is deliberate and confined to the
single `ModelClientService` choke point, which owns retry, spend accounting and the NF emit. The
open question that note raised is closed by ADR 0008.
