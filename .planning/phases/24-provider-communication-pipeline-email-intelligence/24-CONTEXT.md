# Phase 24: Provider Communication Pipeline + Email Intelligence — Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Full manager↔provider communication loop with intelligent inbox triage. EmailIntelAgent classifies all inbound Gmail as OPERATIONAL / PROMO / NOISE. OPERATIONAL emails route to the existing EmailParsingAgent pipeline. PROMO emails extract deal details, compute a menu-fit + urgency score, and surface in a daily LLM-generated digest (configurable per restaurant). ProviderConversationAgent is hardened to Level 4 (idempotency, DLQ, decision logging, sensitivity detection, manager learning loop). Frontend gains Provider Comms card + expandable Deals card on the dashboard and a full relationship view on the Providers page. New plans added: premortem risk documentation (Plan 06) + creative-thinker value features (Plan 07) + UI sketches (Plan 08).

**In scope:**
- EmailIntelAgent — classification, PROMO extraction, in-app notifications, Redis digest accumulation
- DigestCronJob — Python-side 8am cron, Haiku-generated natural language summary, configurable sections
- ProviderConversationAgent Level 4 — idempotency, DLQ, decision logging, sensitivity detection, close-relationship mode, manager learning loop
- Gmail Watch expansion — INBOX + SENT label watch for full thread tracking via gmail_thread_id
- Frontend: dashboard Provider Comms card + Deals card (expandable inline), Providers page full view, Deal Brief documents
- Creative features: Deal Urgency Score, PROMO↔Calendar auto-link, Cross-vendor price intelligence, Composer context injection
- Premortem: risk analysis + mitigations documented before execution
- UI sketches: 3 variants for Provider Comms + Deals card interaction

**Out of scope:**
- Negotiation momentum bar → Phase 31
- Sentiment sparkline per provider → Phase 31
- Smart reply templates (learned pattern shortcuts) → Phase 31
- Mobile push notifications for approval → future
- Health score with analytics formula → future analytics phase
- Manager review UI for learned instructions → Phase 31

</domain>

<decisions>
## Implementation Decisions

### Inbound Email Source
- **D-01 (LOCKED)** All inbound Gmail goes through EmailIntelAgent — no pre-filtering by sender. NOISE category acts as the spam/irrelevant filter. The queue is `email.events` exchange → `email.inbound.received` routing key.
- **D-02 (LOCKED)** `GMAIL_WATCH_LABEL_IDS` expands from `INBOX` to `INBOX,SENT`. EmailIntelAgent detects direction via `labelIds` (INBOX = inbound, SENT = outbound). Both link to conversations via `gmail_thread_id`.
- **D-03 (LOCKED)** After classification, EmailIntelAgent creates an in-app notification via `NotificationsService`:
  - OPERATIONAL → "📧 New message from [Provider]"
  - PROMO → "🏷️ Deal: [Product] at [Discount]% off from [Vendor]"
  - NOISE → silent (no notification)

### Daily Digest
- **D-04 (LOCKED)** Digest sender: Python-side `DigestCronJob` in the agent-orchestrator. Reads Redis `digest:{restaurant_id}:{date}` key, calls Haiku to generate a natural-language paragraph summary (not a template), sends via `EmailClient` SMTP at 8am in the restaurant's local timezone. Skip entirely if digest is empty.
- **D-05 (LOCKED)** Digest content — all three sections, each individually toggleable per restaurant via `notification_preferences` Supabase table:
  - **Promo deals**: vendor, product, discount %, expiry, menu fit score, urgency score (sorted by urgency descending)
  - **Stalled threads**: conversations >24h awaiting reply (list of provider + last message snippet)
  - **Procurement gaps**: calendar events in the next 7 days where needed wines are below current stock
- **D-06 (LOCKED)** Digest header includes Gmail Watch status: "📡 Email watch: active ✅" or "⚠️ last renewed N days ago" to detect silent renewal failures.

### Manager Approval Flow
- **D-07 (LOCKED)** Per-provider auto-reply toggle: `providers.auto_reply_enabled BOOLEAN DEFAULT false`. Trusted providers → auto-send via GmailService; all others → draft in `pending_approval` state requiring one-tap approval.
- **D-08 (LOCKED)** Approval UX: one-tap in the notification center using existing `approval_channel: 'onetap_center'`. The draft card shows inline Approve / Edit / Reject buttons.
- **D-09 (LOCKED)** When manager selects "Edit": opens conversation composer pre-filled with draft (full edit, no navigation). Collapsible "Why this reply?" section (collapsed by default) shows the `decision_log` reasoning from Plan 24-05's `log_decision()` call.
- **D-10 (LOCKED)** Email recipient rules:
  - `To:` field locked to the provider's primary email (read-only) — prevents misdirect
  - Manager can freely add CC / BCC; tracked in conversation history as "CC'd: [emails]"
  - If sent email recipient doesn't match provider email → flagged in conversation log as anomaly, linked via `gmail_thread_id`; does NOT auto-create a new conversation
- **D-11 (LOCKED)** Abandoned draft handling: stays `pending_approval`; reminder notification after 2h ("Draft reply still waiting"); auto-discards after 48h with "draft expired" entry in conversation log.
- **D-12 (LOCKED)** Manager learning loop (active in Phase 24): log original draft vs. edited diff in `decision_log` as a 'correction' event. Haiku extracts a preference string ("tone: more formal with this vendor") → stored in `conversation_context.manager_instructions[]`. Manager review / delete UI for learned instructions → Phase 31.

### Frontend Cards
- **D-13 (LOCKED)** Three surfaces for Provider Comms + Deals data:
  1. **Dashboard** — compact cards: "N unanswered threads" (red badge when >0), last-contact timeline row (green <24h, yellow 1–3d, red >3d), deal count with expiry warning badge
  2. **Providers page** — full relationship view per provider: conversation history, all promo history, last contact, response rate, open threads
  3. **Documents** — when PROMO classified, a "Deal Brief" document auto-created under that provider's document section (product, discount, fit score, urgency score, recommended action); mirrors MeetingMemoPrompt pattern from Phase 30
- **D-14 (LOCKED)** Dashboard deal interaction: **expandable inline card** (not a modal). Card expands accordion-style showing: deal summary, Haiku's analysis paragraph, urgency score, quick-action pills (📧 Reply to Vendor → slide-in conversation composer, ✓ Note it, ⏰ Snooze 3d, ✗ Dismiss). Health score deferred.
- **D-15 (LOCKED)** 3 sketch variants to be created (Plan 24-08) before frontend implementation. User selects preferred variant before coding begins.

### Creative Value Features (Phase 24 scope)
- **D-16 (LOCKED)** **Deal Urgency Score** (1–10 composite): `menu_fit_score × (1 - stock_level/target_stock) × calendar_proximity_factor`. Stored in `vendor_promotions.urgency_score`. Sorts deals in digest and deal cards.
- **D-17 (LOCKED)** **PROMO ↔ Calendar auto-link**: when EmailIntelAgent extracts a PROMO, query `calendar_events` for events in the next 30 days needing that wine variety. Store link in `vendor_promotions.linked_event_ids[]`. Surface in both the Deal Brief document and the EventModal (show "📬 Deal available" chip for linked events).
- **D-18 (LOCKED)** **Cross-vendor price intelligence**: when PROMO arrives for a wine type, query `order_items` for last purchase price of the same wine type. Show "vs. last purchase: $18 → $14.40" in the deal card and Deal Brief.
- **D-19 (LOCKED)** **Composer context injection**: before ProviderConversationAgent renders a draft, automatically inject into the Haiku prompt: last 3 interactions (from `procurement_conversations`), current open orders for that provider, provider credit terms, and any active promos. Makes drafts immediately contextual without manager effort.

### Claude's Discretion
- RabbitMQ exchange topology (topic vs. direct) — use topic exchange `email.events` (Plan 24-04 assumption, SOTA)
- Redis digest key TTL: 36 hours (ensures digest key survives overnight for 8am cron)
- Haiku concurrency semaphore: max 5 concurrent LLM calls in EmailIntelAgent
- `dedup_hash` scope: `vendor_email + product_name + date` (not just vendor + date, prevents collision on multi-product promos)
- Deal Brief document structure and formatting
- Digest email HTML template wrapper (Haiku writes the prose, template provides header/footer)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Phase 24 Plans (3 executed)
- `apps/api-gateway/src/communications/gmail.service.ts` — GmailService with OAuth2 + SMTP fallback; all 11 templates; `sendEmail()` entry point
- `apps/api-gateway/src/communications/gmail-watch.service.ts` — Gmail Watch + Pub/Sub; auto-renewal; must expand `GMAIL_WATCH_LABEL_IDS` to include SENT
- `apps/api-gateway/src/communications/scheduled-tasks.service.ts` — 9 existing cron jobs; calendar reminder pattern; `MANAGER_EMAIL` multi-recipient
- `services/agent-orchestrator/agents/email_parsing_agent.py` — existing inbound email parser; `gmail_thread_id` handling
- `services/agent-orchestrator/agents/provider_conversation_agent.py` — 2519-line agent; `process_message` entry; `close_relationship`, `manager_instructions` handling
- `services/agent-orchestrator/services/model_clients.py` — GeminiFlashClient (Tier 1), HaikuClient (Tier 2/3); singleton factories (from Plan 24-03)
- `services/agent-orchestrator/config/settings.py` — `gemini_model`, `haiku_model`, `gmail_user/password`, `manager_email`

### Database Migrations (applied in Plan 24-01)
- `supabase/migrations/20260415000002_phase24_comms_tables.sql` — `conversation_embeddings`, `vendor_promotions`, `provider_conversation_sessions` tables
- `supabase/migrations/20260415000003_phase24_column_additions.sql` — `providers.close_relationship`, `procurement_conversations.gmail_thread_id`, `negotiation_facts.commitment_type`

### API Gateway — Conversations Module
- `apps/api-gateway/src/conversations/conversations.controller.ts` — `ApproveConversationDto`, `/approve` endpoint; existing approval channel enum (`onetap_center`)
- `apps/api-gateway/src/conversations/conversations.service.ts` — conversation state management

### Notifications (Phase 23 pattern)
- `apps/api-gateway/src/notifications/notifications.service.ts` — `createNotification()` for Supabase insert + WebSocket push; pattern to reuse for email classification notifications

### Frontend
- `apps/web/src/pages/Providers.tsx` — existing Providers page; new relationship view goes here
- `apps/web/src/pages/Dashboard.tsx` — existing dashboard; new compact cards added here
- `apps/web/src/pages/calendar/MeetingMemoPrompt.tsx` — Deal Brief document follows same pattern
- `apps/web/src/pages/calendar/EventModal.tsx` — PROMO↔Calendar link surfaces "📬 Deal available" chip here

### Phase 23 Context (Gmail decisions)
- `.planning/phases/23-gmail-integration-calendar-reminder-emails/23-CONTEXT.md` — OAuth2 path, SMTP fallback, GMAIL_WATCH_LABEL_IDS, MANAGER_EMAIL decisions; all carry forward

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `NotificationsService.createNotification()` — real-time in-app notification with Supabase + WebSocket; EmailIntelAgent calls this after each classification (OPERATIONAL/PROMO only)
- `GmailService.sendEmail()` — OAuth2 + SMTP fallback chain; DigestCronJob uses `EmailClient` SMTP (Python side); GmailService (NestJS) used for approved outbound replies
- `GmailWatchService` — already manages watch + renewal; only change needed is `GMAIL_WATCH_LABEL_IDS` env var update
- `MeetingMemoPrompt.tsx` — post-event document creation pattern; Deal Brief follows same component pattern
- `ConversationsController.approve()` — one-tap approval endpoint already wired; Plan 24-05 plugs into this
- `model_clients.py` — `get_gemini_client()` / `get_haiku_client()` singleton factories ready for EmailIntelAgent

### Established Patterns
- RabbitMQ topic exchange + routing key subscription (BaseAgent pattern) — EmailIntelAgent subscribes to `email.events / email.inbound.received`
- `_check_idempotency()` / `_send_to_dlq()` / `log_decision()` from BaseAgent (Phase 18 infrastructure) — Plan 24-05 wires these into ProviderConversationAgent
- `restaurant_id` scoping on all DB inserts — mandatory on `vendor_promotions`, `notification_preferences`, `conversation_embeddings`
- Redis `digest:{restaurant_id}:{date}` key with 36h TTL — new pattern introduced in Plan 24-04

### Integration Points
- EmailIntelAgent → `email.events exchange` → EmailParsingAgent (OPERATIONAL path)
- EmailIntelAgent → `vendor_promotions` table + `NotificationsService` (PROMO path)
- EmailIntelAgent → Redis digest key (accumulation)
- DigestCronJob → Redis digest key → Haiku → `EmailClient.send()` (8am send)
- ProviderConversationAgent → `decision_log` table → `ConversationsController.approve()` → "Why this reply?" UI
- `vendor_promotions.linked_event_ids[]` → `EventModal.tsx` "📬 Deal available" chip
- `cross_vendor_price`: `vendor_promotions` ← `order_items` join on wine_type

</code_context>

<specifics>
## Specific Ideas

- Digest prose style: "Yesterday, 3 deals arrived. Most relevant: 20% off Burgundy from Plumpjack aligns with your June 3rd tasting. You're 4 bottles short — this deal closes the gap at $14.40 vs. usual $18." — conversational, specific, actionable
- Deal urgency score in digest: sorted descending; top deal highlighted with a subtle accent border in HTML email
- Notification for classified emails: appears in the notification bell with the same wine-red accent as the rest of the notification system (Phase 30 palette)
- Expandable deal card quick actions: pill buttons, same styling as EventModal status chips
- "Why this reply?" section: subtle gray box below the draft text, collapsed by default with a ▼ chevron
- GMAIL_WATCH_LABEL_IDS migration: update env var on Railway api-gateway (add `,SENT`); GmailWatchService re-registers watch on next startup
- `auto_reply_enabled` toggle: appears in the Providers page per-provider settings, alongside `close_relationship` toggle (same settings row, different concern)

</specifics>

<deferred>
## Deferred Ideas

- **Negotiation momentum bar** (progress from INDICATIVE → AGREEMENT) → Phase 31
- **Sentiment sparkline** (30-day trend per provider, "relationship at risk" flag) → Phase 31
- **Smart reply templates** (learned pattern shortcuts after N approvals) → Phase 31
- **Manager review UI for learned instructions** (view + delete `manager_instructions[]`) → Phase 31
- **Mobile push notifications** for draft approval → future push notification phase
- **Provider health score** with proper analytics formula → future analytics phase
- **Inbound email triage from native Gmail apps** (detect when manager replies natively; already partially handled via SENT label watch, but deeper integration needs push notification) → future

</deferred>

---

*Phase: 24-provider-communication-pipeline-email-intelligence*
*Context gathered: 2026-05-13*
