---
type: software
slug: communications-hub
name: Communications Hub
division: vendor
status: hollow
tier: core
routes: ["/communications"]
pages: [communications]
api_modules: [communications, conversations]
agents: [email_intel_agent, email_parsing_agent, provider_conversation_agent]
owner_unit: messaging-delivery
updated: 2026-09-01
links: ["[[communications]]", "[[vendor-directory]]", "[[promotions]]", "[[documents-reports]]", "[[messaging-delivery-charter]]", "[[SOFTWARE-MAP]]"]
---

# Communications Hub

## §0 What it is

Everything the restaurant says to a supplier, and everything a supplier says back, in one
place. You write and save the emails and texts you send often, you read the vendor threads
the system has already sorted and summarised, you look over the outbound mail that went out
on your behalf, and you set up reports that are supposed to arrive on a schedule.

## §1 Features today

- Filter the view by channel — all, email, or SMS
- Build an email template and save it, server-side and shared across devices
- Build an SMS template the same way
- Browse vendor conversation threads, already classified
- Ask for a thread's AI summary to be regenerated — *dark*: the request publishes an event
  with no subscriber (§7)
- See the audit trail of outbound procurement email, labelled by type
- Create, list and delete recurring report schedules — *broken*: the table they are written
  to does not exist in production, so both the write and the read fail every time (§7)
- Generate a report on demand — **removed** 2026-08-26 (OD-81): the button is disabled and
  carries its reason, because the old one only ever inserted a permanently-`pending` row

## §2 Screens

- [[communications]] — the whole software
  (`apps/web/src/pages/Communications.tsx`, 592 LOC; four tabs at `:258,384`).

`PageGate`-wrapped (`apps/web/src/App.tsx:311`) with a p3 `CommunicationsNext` variant
(`apps/web/src/pages/communications/next/`, 6 files incl. `TemplateSheet.tsx`) behind
`mudavym_design_communications`, **off**. With the flag on, three legacy surfaces are not
carried yet — the saved-template lists, the classified tab's filters, and the scheduler's
create/delete forms ([[communications]] §9), so which surface you are looking at changes
what the software can do.

## §3 Backend

Four modules serve this one page. Two are the software's own:

| Module | `@Controller` | Routes |
|---|---|---|
| `communications/` | `communications.controller.ts:71` | **18** |
| `conversations/` | `conversations.controller.ts:49` | **12** |

Of the 18 communications routes, **10 are test/e2e harness routes**
(`:217,287,330,407,590,705,787,841,898,965`), all now behind `@UseGuards(NonProductionGuard)`.
Two are the Gmail push webhook and its status/force-fetch pair (`:1031,1189,1208`); only
`:1031` stays `@Public()`, authenticated by a Google OIDC token instead. So the module's
*product* surface is five routes: `status`, `email`, `sms`, and two alert triggers.

Two more modules the page depends on but does not own:

- `reports/` — `@Controller("reports")` at `reports.controller.ts:29`; the scheduler tab
  calls `POST /reports/schedule` (`:181`), `GET /reports/schedules` (`:73`) and the delete.
- `restaurant-templates/` — `@Controller("restaurants")` at
  `restaurant-templates.controller.ts:23`, 4 JWT-guarded routes (`:28,44,61,83`). This is
  where saved templates actually live, and it is the reason [[communications]] §9's
  "templates persist client-side" line is stale and wrong.

Also inside the `communications` module, but not on this page: `gmail.service.ts`,
`gmail-watch.service.ts`, `gmail-push-auth.service.ts`, `sms.service.ts`,
`recipient-resolver.service.ts`, `scheduled-tasks.service.ts`, `scheduled-tenants.service.ts`.

## §4 Automation

**Nine `@Cron` jobs** in `communications/scheduled-tasks.service.ts` — `:149` (tenant
isolation check, 03:15), `:183` (daily SMS summary, 09:00), `:218` (weekly email report,
Mon 08:00), `:374`, `:450`, `:524`, `:598`, `:652`, and `:702` (custom reminders, every 15
min — the only one carrying **no** `timeZone`, OD-92). Eight are pinned to
`America/New_York` while `restaurants.timezone` holds three distinct values in production.

Since OD-87 these run through `ScheduledTenantsService.runPerTenant` (e.g. `:224`), serving
`DEFAULT_RESTAURANT_ID` ∪ restaurants flagged `scheduled_communications`. **[[communications]]
§10's claim that the weekly report is "a hardcoded single-restaurant job" is stale** — it is
now per-tenant with `allowDefaultFallback: false`, and OD-91 is the open question of who
gets opted in.

Three agents:

- `email_intel_agent.py` (990 LOC, registry `core/orchestrator.py:210`) — classifies inbound
  on `email.inbound.received`, a key with 9 producing files. Its own docstring records that
  it previously subscribed to `email.inbound.raw`, *which nothing publishes*, so it sat on a
  dead queue and no inbound mail was ever classified (`:123-137`).
- `email_parsing_agent.py` (863 LOC, registry `:211`) — same key; its docstring records two
  defects that hid each other, a signature mismatch and an absence from the registry.
- `provider_conversation_agent.py` (3,227 LOC, registry `:184`) — writes the thread
  summaries and sentiment this page reads. Behind `PROV_AGENT_LEVEL4_ENABLED`, default
  **false** (`config/settings.py:194-197`). See [[vendor-directory]] §4.

## §5 Data

`communications` service reads/writes: `providers`, `procurement_orders`,
`procurement_conversations`, `restaurant_inventory`, `notifications`,
`notification_preferences`, `contacts`, `contact_addresses`, `calendar_events`,
`custom_reminders`, `restaurants`, `users`, `user_restaurant_access`,
`restaurant_feature_flags`, `wine_consumption_log`.

`conversations` service touches exactly one: `procurement_conversations`.

The software **owns** `procurement_conversations` — every thread, draft and approval on this
page is a row in it. Its `outbound_email_type` column is a `varchar` with a `CHECK`
constraint that must stay in sync with the TypeScript labels, or procurement-history
labelling silently breaks (project memory: `procurement-conversations-schema-gotchas`).

`scheduled_reports` is read and written by the scheduler tab and **does not exist in
production** — it lives only in `supabase/migrations_archive/20260208024921_baseline_schema.sql:408`,
never applied ([[communications]] §10).

## §6 Owner

[[messaging-delivery-charter]] — team `messaging-delivery`, department `engineering`,
division Platform (`01-org/platform/engineering/teams/messaging-delivery/`). It claims
`communications` (18), `conversations` (12) and `contacts` (8) in its owned-routes table,
plus the transport spine — `rabbitmq-bridge.service.ts`, `inbound-address.service.ts`,
`email-triage.ts`, `priority.ts`, `sender-reputation.service.ts`.

Its mandate draws the boundary this software sits on: *"The **transport half** of every
conversation … This team owns **whether a message arrives exactly once**. It does not own
what the message says"* (`messaging-delivery-charter.md:20-24`), and its stated failure mode
is *"duplication and silence — a digest sent forty times, or a low-stock alert nobody
received — which no functional test catches"* (`:52-54`).

Two halves of this page therefore have a different owner by charter: **what the drafts say**
belongs to [[ai-orchestration-charter]] (`:63`), and **whether an extraction is good enough
to propose** belongs to [[inbound-understanding-charter]], which owns the guardrail contract
rather than the extractors (`inbound-understanding-charter.md:22-30`). The seam, in the
charter's own words: *"AI Orchestration drafts; messaging-delivery delivers."*

## §7 Maturity & seams

**hollow**, inherited from [[communications]] §10. Three of the four tabs are real; the tab
the sidebar names the page for is a UI over tables nothing consumes.

Evidence, rolled up:

- **A schedule causes no send.** `public.scheduled_reports` does not exist in production, so
  both the insert and the list fail 100% of the time. No cron reads it, no consumer, no
  `next_run_at` writer. The UI now says "Saved schedules (n) · not running" and shows a
  failed read as a failure rather than as "none" (OD-81).
- **"Regenerate summary" is dark.** `POST /conversations/:id/summarize` publishes
  `email.summarize.requested` (`conversations.service.ts:438-446`) and returns
  `{success:true}`. **That routing key has zero subscribers** — `EmailParsingAgent`
  subscribes only to `email.inbound.received` (`email_parsing_agent.py:81-84`), and the
  string appears nowhere else in the repo.
- **What is real:** templates persist server-side (§3), classified threads and procurement
  history read live rows, and the nine `@Public` test routes named in the P3 brief are
  confirmed closed.

Seams:

1. **The business logic for this software does not live in its module.** Inbound triage,
   drafting, commercial-term extraction and reply policy all sit in
   `apps/api-gateway/src/common/orchestrator/` — **7,256 lines** under an infra name inside
   `common/`. `inbound-responder.service.ts` alone is **1,371 LOC**, the drafting and
   auto-send policy engine, larger than any file in `communications/` or `conversations/`.
   Alongside it: `email-triage.ts` (258), `commercial-terms.ts` (201),
   `commitment-patterns.ts`, `priority.ts`, `promo-extract.ts` (334),
   `promotion-extractor.service.ts` (283), `prospects.service.ts` (540),
   `sender-reputation.service.ts` (190). **A folder named after infrastructure holds the
   product's procurement and comms reasoning.**
2. **And it is not only logic — it is routes.** That same folder declares **8 controllers
   across 8 unrelated prefixes**: `prospects` (`:25`), `webhooks` (`inbound-email:42`),
   `health` and `metrics` (`health-proxy:18,85`), `onboarding` (`:34`), `senders`
   (`sender-trust:18`), and `studio` twice (`studio-invite:48`, `studio-proxy:41`). Nothing
   in the module's name predicts any of them, and the two this division depends on —
   `prospects` and `senders` — are the backend of [[promotions]], not of an orchestrator.
3. **Ownership splits mid-page** (§6): transport is `messaging-delivery`, drafting is
   `ai-orchestration`, the gate contract is `inbound-understanding`, and none of the three
   owns `common/orchestrator/inbound-responder.service.ts`, which does all three jobs. Its
   only charter citations are incidental ones from `research-math` (`:199,205`) and
   `ai-orchestration` (`:177`) counting model callsites.
4. **The conversation hooks bypass the shared client.** `useConversationQueries.ts:4-7` uses
   its own axios instance against `VITE_API_GATEWAY_URL` rather than `apiClient` — a second
   auth path on the same page.
5. **Nine crons, one timezone** (§4, OD-92).

## §8 Where it's going

- ADR 0049 §3a: **Vendor** division, phase **E1 — cross-runtime send reliability**
  (`04-specs/ECOSYSTEM-PLAN.md:55` names `communications` and `conversations`; `:25` records
  that the "voice" channel does not exist as a live path and is gated).
- OD-91 (do existing tenants get scheduled communications by default) is the founder's call
  and gates §4's crons; OD-92 (per-tenant timezones) sequences after it.
- OD-77 blocks the Google account this software's mail runs on; OD-78 tracks the residual
  staged-open branch in Gmail push verification.
- `scheduled_reports` needs a migration or a deletion — a scheduler tab over a table that
  does not exist should not survive either way.
