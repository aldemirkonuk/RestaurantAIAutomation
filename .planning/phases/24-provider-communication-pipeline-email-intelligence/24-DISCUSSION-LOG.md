# Phase 24: Provider Communication Pipeline + Email Intelligence — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 24-provider-communication-pipeline-email-intelligence
**Areas discussed:** Plan state, Inbound Email Source, Daily Digest, Frontend Cards, Manager Approval, Premortem, Creative Thinker

---

## Plan State (existing plans check)

| Option | Description | Selected |
|--------|-------------|----------|
| Continue + replan | Discuss and replan — scope needs updating after Phases 25–30 | |
| View plans first | Show what Plans 04 and 05 plan to build first | ✓ |
| Execute as-is | Run existing plans without discussion | |
| Narrow scope | Just EmailIntelAgent first | |

**User's choice:** View plans first, then "keep plans, brainstorm more, add premortem plan + creative-thinker plan"
**Notes:** Existing Plans 01–05 kept. Two new plans added: Plan 06 (premortem + UI sketches) and Plan 07 (creative value features). Plans 01–03 already executed, Plans 04–05 proceed as-is.

---

## Inbound Email Source

| Option | Description | Selected |
|--------|-------------|----------|
| email.events exchange | email.inbound.received routing key (Plan 24-04 assumption) | ✓ |
| Direct queue | Named queue like 'inbound_emails' | |
| All inbound | No pre-filter, EmailIntelAgent classifies everything | ✓ |
| Provider-only | Pre-filter by sender email matching providers table | |
| Thread tracking: yes | Expand GMAIL_WATCH_LABEL_IDS to INBOX,SENT | ✓ |

**User's choice:** "you decide state of the art way and every time the inbound email comes show it in the notifications as well" + confirmed all-inbound filter + yes to full thread tracking via SENT label watch
**Notes:** GMAIL_PUBSUB_TOPIC confirmed already configured. Classification notifications added as D-03 (OPERATIONAL → in-app bell, PROMO → in-app bell, NOISE → silent).

---

## Daily Digest

| Option | Description | Selected |
|--------|-------------|----------|
| NestJS ScheduledTasksService | New cron in api-gateway reads Redis, calls GmailService | |
| Python DigestCronJob | Agent-orchestrator, Haiku-generated prose, EmailClient SMTP | ✓ |
| Promos only | Focused on deal data | |
| Promos + stalled threads | Also flag no-reply conversations | |
| Full intelligence + toggles | Promos + stalled threads + procurement gaps, user-configurable | ✓ |
| Restaurant timezone | Skip if empty | ✓ |
| UTC | Always UTC | |

**User's choice:** "do what you prefer, goal is most robust work" → Python DigestCronJob with Haiku-generated prose. "option C with toggle on and off for certain emails, so based on user decision". "based on users location or option A" for timezone.
**Notes:** `notification_preferences` Supabase table introduced to store per-section toggles. Watch status check added to digest header.

---

## Frontend Cards

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard widgets only | Compact cards in /dashboard | ✓ |
| Providers page sidebar | Contextual info on providers page | ✓ |
| Both | Compact on dashboard, full on providers | ✓ |
| Documents | Deal Brief auto-created per PROMO | ✓ |
| Health score first | 0–100 relationship score | deferred |
| Action needed count | Threads awaiting reply | ✓ |
| Last contact timeline | Color-coded by recency | ✓ |
| Inline expandable card | Accordion deal interaction, no modal | ✓ |
| Modal (Option C) | Deal Brief in a modal | |

**User's choice:** "option A is good, also in documents. and what do you think?" → three surfaces (dashboard, providers page, documents). "option A with 3 sketches and full functionality thoughtful process with effortless looking" for deal interaction.
**Notes:** 3 sketch variants added as Plan 24-08. Health score deferred to future analytics phase.

---

## Manager Approval

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-send | Reply goes immediately, manager notified after | |
| Draft + approve | All replies wait in pending state | |
| Per-provider | Auto-send for trusted, draft for new/unknown | ✓ |
| Normal notification | Standard bell notification | |
| One-tap | Inline Approve/Edit/Reject in notification center | ✓ |
| Full edit in composer | Opens composer pre-filled (Option A) | ✓ |
| Collapsible reasoning | "Why this reply?" collapsed by default | ✓ |
| Primary recipient locked | To: field read-only | ✓ |
| CC/BCC editable | Manager can add recipients | ✓ |
| Abandoned draft 2h reminder | Notification, 48h auto-discard | ✓ |
| Learning loop Option C | Log diff + extract preference + store in manager_instructions | ✓ |

**User's choice:** per-provider toggle. One-tap. "option A, and slight edge case -> what if manager wanted to edit but didn't?" — edge cases led to D-10, D-11 decisions. "option C but afraid if it's too early?" — confirmed Phase 24 scope, UI review deferred to Phase 31.
**Notes:** `providers.auto_reply_enabled BOOLEAN DEFAULT false` new column. "app notifications in future" for mobile push.

---

## Premortem (risk analysis)

All 8 risks reviewed and mitigations locked into CONTEXT.md Claude's Discretion section:
1. Pub/Sub duplicate delivery → dedup_hash on `vendor_email + product_name + date`
2. Simultaneous promo flood → semaphore max 5 LLM calls
3. Stale RabbitMQ backlog → skip digest contribution for emails >18h old
4. Redis key expiry before 8am → 36h TTL
5. Gmail Watch renewal failure → watch status in digest header
6. ProviderConversationAgent regression → test stubs from Plan 24-02 run before deploy
7. Sensitive content in digest → sensitivity check on PROMO body (Plan 24-05 detector reused)
8. `auto_reply_enabled` accidental default → hard-coded default `false`

---

## Creative Thinker

| Feature | Selected | Phase |
|---------|----------|-------|
| Deal Urgency Score (composite formula) | ✓ | 24 (Claude add) |
| PROMO ↔ Calendar auto-link | ✓ | 24 |
| Cross-vendor price intelligence | ✓ | 24 |
| Composer context injection | ✓ | 24 (Claude add) |
| Negotiation momentum bar | deferred | 31 |
| Sentiment sparkline per provider | deferred | 31 |
| Smart reply templates | deferred | 31 |

**User's choice:** "do what you prefer, goal is most robust work and not all work at once" → selected PROMO↔Calendar and cross-vendor price; Claude added urgency score and context injection as high-value / low-scope additions.

---

## Claude's Discretion

- RabbitMQ exchange topology: topic exchange `email.events` (SOTA, Plan 24-04 assumption)
- Redis TTL: 36 hours
- Haiku concurrency: max 5 concurrent LLM calls (semaphore in EmailIntelAgent)
- dedup_hash scope: `vendor_email + product_name + date`
- Inbound email direction detection: via `labelIds` field (INBOX vs. SENT)
- Deal urgency score formula: `menu_fit × (1 - stock/target) × calendar_proximity_factor`
- Composer context injection: last 3 interactions + open orders + credit terms injected into Haiku prompt

## Deferred Ideas

- Momentum bar, sentiment sparkline, smart reply templates → Phase 31
- Mobile push notifications for approval → future
- Health score analytics formula → future analytics phase
- Manager review UI for learned instructions → Phase 31
