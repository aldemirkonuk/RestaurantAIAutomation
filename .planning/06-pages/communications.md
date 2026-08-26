---
type: page
route: /communications
slug: communications
component: apps/web/src/pages/Communications.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-79)
signals_today: none
rebrand_strings: 3
maturity: hollow
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[documents-reports]]"]
---

# /communications — Communications

## Surface — buttons → where they go

- **Templates / Send History / Scheduled Reports / Procurement Emails tabs** → (on this page)
- **New Email / SMS template** → (builder on this page)
- **Generate report now** → API `POST /reports/generate`; success toast's **Open** → [[documents-reports]] `/documents-reports`
- **Delete schedule** → API (report-schedule delete)

## 1. Purpose

"Vendor email threads, classified and ready to reply" (`Sidebar.tsx:122`). Four tabs
(`Communications.tsx:258,384`): **Templates** (Gmail + SMS builders with saved
templates), **Send History** (classified vendor conversation threads), **Scheduled
Reports** (recurring report delivery), and **Procurement History** (Phase 34
outbound-email audit trail, labelled by `outbound_email_type`).

## 1a. Features
- **Templates** tab: build Gmail and SMS templates; save and reuse them (🚧 saved client-side, not cross-device)
- **Send History** tab: browse classified vendor conversation threads; regenerate a thread's AI summary
- **Scheduled Reports** tab: create, list and delete recurring report schedules (🚧 the send itself is feature-flagged off server-side — no mailer)
- **Procurement History** tab: audit trail of outbound procurement emails, labelled by type
- Filter by channel: all / email / SMS

## 2. Entry

- Sidebar (`components/layout/Sidebar.tsx:120`); command palette
  (`components/command/commands.ts:81`).
- [PAGE_MAP](../foundation/PAGE_MAP.md):113 lists it as no-inbound — the scan missed
  layout components; the sidebar is the real entry.

## 3. Files

- Route binding: `apps/web/src/App.tsx:279` (lazy import :95).
- `apps/web/src/pages/Communications.tsx` (562 lines).
- Rendered: `components/documents/{GmailTemplateBuilder, SMSTemplateBuilder, SavedTemplates, SavedSMSTemplates}.tsx`, `components/communications/{ReportScheduler, ClassifiedConversationList}.tsx` (Communications.tsx:13-31; mounts :506,513,544,553).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):495 (`reports`), :180
(`conversations`), :389 (`procurement`).

| Method | Path | Call site |
|---|---|---|
| POST | `/reports/generate` | `Communications.tsx:305` → `services/api/reports.ts:69` |
| POST | `/reports/schedule` | `Communications.tsx:277` → `reports.ts:74` |
| GET | `/reports/schedules` | `Communications.tsx:265` → `reports.ts:79` |
| DELETE | `/reports/schedules/:id` | `Communications.tsx:325` → `reports.ts:84` |
| GET | `/conversations/threads`, `/conversations/thread/:id`, `/conversations/stats/overview` | `ClassifiedConversationList` → `hooks/queries/useConversationQueries.ts:194,209,225` |
| POST | `/conversations/:id/summarize` | `useRegenerateSummary` → `useConversationQueries.ts:240` |
| GET | `/procurement/conversations/history` | `useProcurementConversationHistory` (Communications.tsx:28) → `useConversationQueries.ts:284` |

Note: the conversation hooks use their **own axios instance** against
`VITE_API_GATEWAY_URL` (`useConversationQueries.ts:4-7`), not the shared `apiClient`.

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** with Plus content: templates and scheduled sends are operate; the
classified-thread view and drafted credit emails are the S02/S03 **Plus**
"understand" rows ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39). Inbound
classification behind it shipped as Phase 0 (memory: inbound-email-intelligence-plan).

## 7. Rebrand surface

**3 user-visible strings** — the email template preview header/footer renders
"WineOps AI": `components/documents/GmailTemplateBuilder.tsx:1349,1417,1464`
(mounted from this page, `Communications.tsx:544`). Page file itself: 0. Layout
chrome per dashboard.md §7.

## 8. State & config

- Channel filter (all/email/SMS) is page state (`Communications.tsx:237`).
- Procurement-history labels depend on `outbound_email_type` staying in sync with the
  DB CHECK constraint (memory: procurement-conversations-schema-gotchas).

## 9. Gaps

- **Scheduled report *sending* is feature-flagged off server-side** — "no mailer —
  scheduled send is feature-flagged" ([TIER-MAP](../03-scenarios/TIER-MAP.md):51, S15
  Plus). The scheduler UI here creates schedules a mailer never executes.
- Saved templates persist client-side through the builder components rather than a
  server store — check before promising cross-device templates (no debt-register
  entry; observed from the component tree).

## 10. Maturity

**hollow.**

Three of the four tabs are real. The **Scheduled Reports** tab — the tab this page
is named for in the sidebar subtitle — is a UI over two tables nothing consumes.

| Claim | Evidence |
|---|---|
| ~~"Generate report now" produces a report~~ **FIXED 2026-08-26 (OD-81)** | Was: `POST /reports/generate` inserts one row with `status: "pending"` and NULL file urls (`reports.service.ts:42-71`) — **the only writer of `generated_reports` in the repo**, and there is no `UPDATE` on that table anywhere, so `pending` was permanent. The toast claimed "Report generated · Filed in Documents & Reports". Now: `handleGenerateReportNow` is **deleted**, the button is disabled and carries the reason, and no toast claims a generation. Production check: `generated_reports` holds **0 rows** |
| ~~A schedule causes a send~~ **CORRECTED + FIXED 2026-08-26 (OD-81)** | The dossier said the table "appears in three places, all in this one service". Two corrections. (a) It has a **web reader** too — `GET /reports/schedules` → `services/api/reports.ts:116` → this page → `ReportScheduler` (NEW-359). (b) **`public.scheduled_reports` does not exist in production** — verified against the live DB; it lives only in `supabase/migrations_archive/20260208024921_baseline_schema.sql:408`, never applied. So both the insert and the list fail 100% of the time, and the list failure used to render as an empty list. Still true: no cron, no consumer, no `next_run_at` writer. The UI now says "Saved schedules (n) · not running", and a failed read is shown as a failure rather than as "none" |
| The only weekly report that *does* send is unrelated | `@Cron("0 8 * * 1")` `sendWeeklyEmailReport` (`apps/api-gateway/src/communications/scheduled-tasks.service.ts:162-215`) is a **hardcoded single-restaurant** job gated on `DEFAULT_RESTAURANT_ID` + `MANAGER_EMAIL` env vars (`:70-79`, `:167-172`). It never reads `scheduled_reports` |
| "Regenerate" summary | `POST /conversations/:id/summarize` publishes `email.summarize.requested` (`apps/api-gateway/src/conversations/conversations.service.ts:438-446`) and returns `{success:true, message:"Summary regeneration requested"}` (:451-455). **That routing key has zero subscribers** — `EmailParsingAgent.get_subscribed_routing_keys()` returns only `email.inbound.received` (`services/agent-orchestrator/agents/email_parsing_agent.py:81-84`), and the string appears nowhere else in the repo |

What **is** real: templates persist server-side (`useTemplates` → `GET/POST/PATCH/DELETE /restaurants/:rid/templates`, `apps/web/src/hooks/useTemplates.ts:15-50`; controller `apps/api-gateway/src/restaurant-templates/restaurant-templates.controller.ts:23-83`, JWT-guarded) — **§9's "saved templates persist client-side" is stale and wrong**. Classified threads and procurement history read live rows.

The nine `@Public` communications test routes named in the P3 brief are confirmed closed: `communications.controller.ts:216,286,329,406,589,704,786,840,897,964` now carry `@UseGuards(NonProductionGuard)`; only `POST /webhooks/gmail` stays `@Public()` (:1030), authenticated by a Google OIDC token instead.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| POST | `/reports/generate` | JWT (class) | `reports.controller.ts:31-46` | A `pending` row with null file urls |
| POST | `/reports/schedule` | JWT | `reports.controller.ts:132-147` | A `scheduled_reports` row nothing reads |
| GET | `/reports/schedules` | JWT | `reports.controller.ts:70-84` — declared **above** `@Get(":id")` on purpose (OD-45) | The list of unread schedules |
| DELETE | `/reports/schedules/:id` | JWT | `reports.controller.ts:149-166` | 204; scoped by `restaurant_id` |
| GET | `/conversations/threads` | JWT (class, `conversations.controller.ts:48`) | `:145-211` | Threads with `detected_sentiment`, `conversation_summary` |
| GET | `/conversations/thread/:id`, `/stats/overview` | JWT | `:216-237`, `:308-325` | Thread messages; sentiment counts |
| POST | `/conversations/:id/summarize` | JWT | `:291-304` | `{success:true}` — see §10 |
| GET | `/procurement/conversations/history` | JWT | `procurement.controller.ts` (svc `procurement.service.ts:2928-2997`) | Phase-34 outbound audit rows |
| GET/POST/PATCH/DELETE | `/restaurants/:rid/templates` | JWT (class) | `restaurant-templates.controller.ts:23-90` | Saved email templates |

### Fed by

| Surface | Producer | Live? |
|---|---|---|
| Classified threads | Gmail Pub/Sub push → `communications.controller.ts:1030-1180` publishes `email.inbound.received` → `RabbitMqBridgeService.handleInboundEmail` (`rabbitmq-bridge.service.ts:224-228,528`) inserts `procurement_conversations`; `InboundResponderService` writes `detected_sentiment`/`detected_intent` (`inbound-responder.service.ts:300,520`) | **Yes** — a live Gmail watch carries production traffic (OD-78) |
| Same, provider-agnostic path | `POST /webhooks/inbound-email` — `@Controller("webhooks")` + `@Post("inbound-email")` in `common/orchestrator/inbound-email.controller.ts:42,53` | **Dormant** — gated on two env vars in **two different files**: `INBOUND_WEBHOOK_SECRET` in the controller (`inbound-email.controller.ts:61-68`, returns `{status:"disabled"}` when unset) and `INBOUND_EMAIL_DOMAIN` in the address resolver (`inbound-address.service.ts:29`), not in the controller at all. Both unset |
| Procurement history | `provider_communication_agent` outbound drafts, `AgentTier.CORE` since the Phase-32 fix (`services/agent-orchestrator/core/agent_registry.py:132-146`) | Yes |
| Report archive | **none** — see §10 | No |
| Templates | Manual authoring on this page | Yes |

### Writes

| Write | Downstream reaction |
|---|---|
| `generated_reports` row (`pending`) | Realtime `report:generated` → toast on `/documents-reports` (`DocumentsPage.tsx:331-347`). Nothing else |
| `scheduled_reports` row | **none** |
| `restaurant_templates` row | Read back by this page and the SMS/Gmail builders. Not consumed by any sender |
| `email.summarize.requested` | **none** — unbound routing key on a topic exchange, so the message is dropped |

## 12. Design intent

**Should be:** the one place a manager sees every vendor conversation the system had on their behalf, and sets what goes out on a schedule.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Partial | Procurement-history table has a spinner (`Communications.tsx:142-144`); schedules list has none |
| Empty | Yes | `Communications.tsx:145` |
| Error | **No** | Schedule/generate failures toast (`:301,:323,:333`), but read failures are silent — `useTemplates` swallows a fetch error into `[]` (`hooks/useTemplates.ts:70-75`), so a broken template API renders "no templates" |
| Permission-denied | **No** | No 403 branch anywhere on this page |

**Where the UI misleads**

1. "Report generated · Filed in Documents & Reports" with an **Open** deep link (`:315-318`) — the row exists, the report does not.
2. The Scheduled Reports tab renders a `nextRunAt` for a job that will never run.
3. **Regenerate** spins, succeeds, invalidates the query, and the summary is byte-identical (`useConversationQueries.ts:235-247`).
4. `GmailTemplateBuilder.tsx:1349,1417,1464` previews mail branded "WineOps AI" (§7).

## 13. Roadmap

1. **Decide what a generated report is** — a renderer that fills `pdf_url`, or delete the generate button. Blocker: founder decision; nothing in `.planning/decisions/` defines a report artifact. Everything below depends on this.
2. **Make Regenerate honest** — either subscribe an agent to `email.summarize.requested` (`email_parsing_agent.py:81-84`) or remove the button. One line of Python or one of TSX; today it lies for free.
3. **Run the schedules** — a cron reading `scheduled_reports` per restaurant. The weekly job it would replace is **no longer single-tenant**: as of 2026-08-26 (OD-87 / [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md)) `sendWeeklyEmailReport` iterates opted-in tenants via `ScheduledTenantsService`, so this item is now "read the schedule table" rather than "add multi-tenancy". Still blocked by (1).
4. Surface read errors instead of empty states (`useTemplates.ts:70-75`).
5. Rebrand the three template-preview strings (§7).
6. Resolve the duplication with `/documents-reports` — `ClassifiedConversationList` is mounted on both (retire-to-write, CLAUDE.md §4). No ADR either way.
