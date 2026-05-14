---
phase: 24-provider-communication-pipeline-email-intelligence
type: uat
status: ready
requires_live_data: true
estimated_time: 60-90 minutes
prerequisites:
  - Railway api-gateway: GMAIL_WATCH_LABEL_IDS=INBOX,SENT
  - Railway agent-orchestrator: GEMINI_API_KEY, ANTHROPIC_API_KEY, RABBITMQ_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  - A Gmail account subscribed via Gmail Watch (same account as GMAIL_USER)
  - A second email address to send test emails from (can be any personal/test account)
  - App is live (Vercel frontend + Railway backend both running)
---

# Phase 24 — Live Data UAT

## Pre-Flight Checks

Before starting any test, verify the pipeline is alive:

```
GET https://your-api-gateway.railway.app/api/v1/health/agents
→ EmailIntelAgent: "healthy"
→ ProviderConversationAgent: "healthy"
```

Check RabbitMQ dashboard (CloudAMQP) — `email.events` exchange should exist with bindings for `email.inbound.raw`.

---

## Suite 1 — Email Classification (NOISE path)

**What it tests:** Gemini Flash correctly discards irrelevant email — zero DB writes, zero notifications.

**Steps:**
1. From your personal/test email, send a message **to your GMAIL_USER address** with:
   - Subject: `Monthly newsletter — The Wine Society`
   - Body: `Hello, just wanted to share our monthly newsletter. Click here to view the latest wine trends...`
2. Wait 30–60 seconds for Gmail Watch to fire.
3. Check `vendor_promotions` table: no new row.
4. Check `notifications` table: no new row.
5. Check CloudAMQP: no message on `email.inbound.received` queue.

**Pass criteria:**
- [ ] No `vendor_promotions` row inserted
- [ ] No notification created
- [ ] (Optional) agent-orchestrator Railway logs show `[EmailIntelAgent] NOISE — discarded`

---

## Suite 2 — Email Classification (OPERATIONAL path)

**What it tests:** A vendor reply is correctly classified as OPERATIONAL and re-routed to `email.inbound.received` for ProviderConversationAgent to pick up.

**Steps:**
1. First, ensure at least one `providers` row exists in your Supabase DB (any provider name + email).
2. From your personal email, send to GMAIL_USER:
   - Subject: `Re: Burgundy order #1042 — confirmation`
   - Body: `Hi, confirming your order of 6 cases of Pommard 2019 will ship Thursday. Invoice attached.`
3. Wait 30–60 seconds.
4. Check `procurement_conversations` table: new row with `gmail_thread_id` populated.
5. Check agent-orchestrator logs: `[ProviderConversationAgent] draft generated` or `[ProviderConversationAgent] draft awaiting approval`.

**Pass criteria:**
- [ ] `procurement_conversations` row created (or updated) with this email's thread ID
- [ ] No `vendor_promotions` row inserted (this is NOT a promo)
- [ ] `provider_conversation_sessions` row exists with `session_status = 'active'` or `'pending_approval'`
- [ ] Logs show the email was classified OPERATIONAL (not PROMO or NOISE)

---

## Suite 3 — Email Classification (PROMO path) + Vendor Promotions

**What it tests:** A promotional email from a vendor gets classified as PROMO, Haiku extracts deal details, and a row lands in `vendor_promotions` with an urgency score.

**Steps:**
1. From your personal email, send to GMAIL_USER:
   - Subject: `Special offer: Côtes du Rhône 2022 — 25% off this week only`
   - Body:
     ```
     Dear Manager,

     We have a limited-time promotion on our Côtes du Rhône 2022 (Grenache/Syrah blend).
     Regular price: $18/bottle. This week only: $13.50/bottle — 25% discount.
     Minimum 3 cases (36 bottles). Offer expires Friday May 17, 2026.

     Best,
     Jean-Pierre
     Rhône Valley Imports
     ```
2. Wait 60–90 seconds (Haiku extraction adds latency).
3. Check `vendor_promotions` table:

```sql
SELECT product_name, discount_pct, valid_until, urgency_score, status
FROM vendor_promotions
ORDER BY created_at DESC
LIMIT 1;
```

4. Check `notifications` table for a new PROMO notification.
5. Check Redis (via Railway logs or Upstash dashboard): key `digest:{restaurant_id}:{today}` should have an item.

**Pass criteria:**
- [ ] `vendor_promotions` row inserted with:
  - `product_name` contains "Côtes du Rhône" (or similar)
  - `discount_pct` = 25.00 (or close)
  - `valid_until` = 2026-05-17 (or nearby)
  - `urgency_score` is NOT NULL (any decimal value)
  - `status = 'active'`
  - `dedup_hash` is NOT NULL
- [ ] `notifications` table has a new row referencing the promo
- [ ] Redis key `digest:{restaurant_id}:{today}` exists with at least 1 item

---

## Suite 4 — Promo Deduplication

**What it tests:** Sending the exact same promotional email twice doesn't create a duplicate `vendor_promotions` row.

**Steps:**
1. Immediately after Suite 3 completes (use the same email wording), send it again from your personal email to GMAIL_USER.
2. Wait 90 seconds.
3. Count `vendor_promotions` rows matching that product:

```sql
SELECT COUNT(*), dedup_hash
FROM vendor_promotions
WHERE product_name ILIKE '%Côtes du Rhône%'
GROUP BY dedup_hash;
```

**Pass criteria:**
- [ ] Still only 1 row — dedup_hash matched, duplicate suppressed
- [ ] Logs show `[EmailIntelAgent] PROMO duplicate — suppressed (dedup_hash matched)`

---

## Suite 5 — Commitment Language Guardrail

**What it tests:** The ProviderConversationAgent's auto-reply draft sanitiser strips hard commitment language before surfacing a draft.

**Steps:**
1. Check `provider_conversation_sessions` for any active session from Suite 2.
2. In agent-orchestrator Railway logs, search for `commitment_guard_triggered` — if present, the guardrail fired.
3. If `auto_reply_enabled = false` on the provider (the default), verify the draft is in `pending_approval` state, not auto-sent.

**Alternative (if you want to force-test the guardrail):**
1. Directly insert a test message into the RabbitMQ `email.events` exchange with routing key `email.inbound.raw` containing body text: `"We commit to buying 10 cases at that price, guaranteed."`
2. The agent log should show `commitment_guard_triggered` and the draft should NOT contain "we commit" or "guaranteed".

**Pass criteria:**
- [ ] `provider_conversation_sessions.session_status = 'pending_approval'` (draft awaiting manager)
- [ ] If guardrail fired: logs show `commitment_guard_triggered`
- [ ] Draft content (in `draft_content` column) does NOT contain: "we commit", "guaranteed", "locked in", "I promise"

---

## Suite 6 — Daily Digest Accumulation

**What it tests:** Redis accumulates promo items during the day for the 8am digest email.

**Steps:**
1. After running Suite 3 (which pushes to Redis), check Upstash Redis dashboard for key `digest:{restaurant_id}:{today}`.
2. Run Suite 3 again with a different wine (e.g., "Barolo 2018 — 15% off") to push a second item.
3. Check the Redis list has 2+ items.
4. (Manual) Trigger the digest cron early by calling the scheduled task endpoint or checking logs at 8am tomorrow.

**Pass criteria:**
- [ ] Redis key `digest:{restaurant_id}:{today}` is a LIST with ≥ 1 item after Suite 3
- [ ] Each item is valid JSON with `product_name`, `discount_pct`, `valid_until`, `urgency_score`
- [ ] Key TTL is approximately 36h (use Upstash dashboard to verify)

---

## Suite 7 — In-App Notification Visibility

**What it tests:** Promos detected by EmailIntelAgent surface in the frontend notifications panel.

**Steps:**
1. Log into the app at your Vercel URL.
2. Open the Notifications panel (bell icon).
3. After Suite 3 completes, refresh the page.
4. A notification should appear: something like "New wine deal: Côtes du Rhône 2022 — 25% off (expires May 17)"

**Pass criteria:**
- [ ] Notification visible in UI within 2 minutes of sending the promo email
- [ ] Notification links to or mentions the product and discount
- [ ] Notification is dismissable

---

## Suite 8 — ProviderConversationAgent Context Enrichment (D-19)

**What it tests:** The agent's Haiku draft is enriched with last 3 conversations, open orders, and payment terms.

**Steps:**
1. Ensure you have at least 1 provider with prior `procurement_conversations` rows in Supabase.
2. Send a follow-up email to GMAIL_USER from your personal email:
   - Subject: `Quick question about your Burgundy order`
   - Body: `Hi, just checking if the Burgundy order from last week is on track for delivery?`
3. Wait 60 seconds.
4. Check `provider_conversation_sessions.draft_content` for the new session — the draft should reference context (e.g., mention the prior order or provider name).
5. Check agent-orchestrator logs for `_get_db_context_for_prompt` execution.

**Pass criteria:**
- [ ] `draft_content` is NOT NULL (Haiku generated a draft)
- [ ] Draft reads naturally — no JSON fragments, no placeholder text like `{last_3_db_interactions}`
- [ ] Logs show `[ProviderConversationAgent] context enrichment: close_relationship=False, interactions=N`
- [ ] `session_status = 'pending_approval'` (auto_reply_enabled is false by default)

---

## Suite 9 — Sent Email Direction Detection

**What it tests:** When a SENT email (from your Gmail account) is captured, it's labelled `outbound` and does NOT get re-processed as an inbound vendor message.

**Steps:**
1. Send any email FROM your GMAIL_USER account to any address (can be yourself).
2. Wait 30 seconds.
3. Check RabbitMQ — the message should arrive on `email.inbound.raw` with `direction = 'outbound'`.
4. EmailIntelAgent should classify outbound emails as NOISE or skip them.

**Pass criteria:**
- [ ] No `vendor_promotions` row created from the outbound email
- [ ] No `procurement_conversations` session created
- [ ] Logs show direction detected as `outbound`

---

## Pass Summary

| Suite | Feature | Pass | Notes |
|-------|---------|------|-------|
| 1 | NOISE classification | ☐ | |
| 2 | OPERATIONAL routing | ☐ | |
| 3 | PROMO extraction + vendor_promotions | ☐ | |
| 4 | Deduplication | ☐ | |
| 5 | Commitment language guardrail | ☐ | |
| 6 | Redis digest accumulation | ☐ | |
| 7 | In-app notification | ☐ | |
| 8 | D-19 context enrichment | ☐ | |
| 9 | Sent email direction | ☐ | |

**Threshold:** 7/9 pass = Phase 24 UAT passed. Suites 5 and 9 are optional if Railway logs aren't accessible.

---

## Known Prerequisites Not Yet Live

- [ ] `GMAIL_WATCH_LABEL_IDS=INBOX,SENT` must be set on Railway api-gateway before Suite 9 is testable (Suite 2, 3 work with INBOX only)
- [ ] Phase 23 Gmail Watch must be active (Gmail Watch subscription via Pub/Sub running)
