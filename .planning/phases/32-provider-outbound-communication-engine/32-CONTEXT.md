---
phase: 32-provider-outbound-communication-engine
type: context
status: locked
depends_on:
  - 24-provider-communication-pipeline-email-intelligence
  - 27-vendor-search-and-discovery
created: 2026-05-13
---

# Phase 32 Context — Provider Outbound Communication Engine

## Phase Goal

Build the outbound half of the provider communication loop. When an order is created with a
provider assigned, the system silently pre-generates an AI email draft and notifies the manager.
The manager approves, edits, or discards. After provider replies, the system generates reply
drafts with progressive summarization to stay inside token budgets. Provider intelligence profiles
are built and maintained over time from conversation history.

This is the foundation. Auto-send, SMS, and the paid-tier LLM communicator gate are future phases.

---

## Locked Decisions

### D-32-01 — Order → Email Trigger (Notification-First)

**LOCKED: Notification-only. Never auto-email a provider without manager approval (unless 3-gate auto-send).**

5-step order procedure:
1. Order DRAFT created with provider assigned → AI silently pre-computes email draft → notification to manager: "Draft ready to send to [Provider] for order #1042"
2. Manager opens draft panel → Approve / Edit / Discard
3. Provider replies → EmailIntelAgent classifies OPERATIONAL → ProviderConversationAgent drafts reply → notification: "[Provider] replied — let AI draft a response?"
4. Manager approves reply (or auto-send if 3-gate passes: paid tier + relationship health ≥ threshold + manager pre-approved this provider)
5. Resolution → thread archived → summary to `procurement_conversations.ai_summary` → `negotiation_facts` updated → `provider_intelligence` dynamic fields updated

Adding a provider to an existing DRAFT order fires Step 1 only (notification + silent draft prep, no email).

### D-32-02 — Email Type Taxonomy

Four primary outbound email types. The system selects type from order context:

| Type | Trigger condition | AI behavior |
|------|------------------|-------------|
| `PRICE_INQUIRY` | `target_price_per_bottle IS NULL` | Open ask: "What's your current price for X cases of Y?" |
| `DEMAND_OFFER` | `target_price_per_bottle IS NOT NULL` | Anchored ask: "We're looking for X cases at $Z/bottle — can you confirm?" |
| `PROMO_INQUIRY` | Triggered from `vendor_promotions` promo card | "We saw your offer on [product] — interested in X cases" |
| `WINE_INQUIRY` | Manager searches for specific wine not in inventory | "Do you currently carry [wine]? Interested in pricing for X cases" |

All types are categorized, their conversation summaries are documented in the app per thread.

### D-32-03 — Context Window Architecture (Progressive Summarization)

Sliding window: **flat ~6,000 tokens per LLM call regardless of conversation length**.

```
System prompt + constraints      800 tokens  (pre-computed, cached)
Provider profile snapshot        400 tokens  (foundational + relevant dynamic fields)
Rolling summary                1,000 tokens  (hard cap; summarize every 2 rounds)
Last 3 full emails             2,400 tokens  (3 × ~800 avg)
Incoming / current email         800 tokens
Safety buffer                    600 tokens
────────────────────────────────────────────
Total budget                  ~6,000 tokens  (guaranteed flat)
```

After every 2 rounds: lightweight Haiku pass extracts key facts → writes to `negotiation_facts` → rolling summary updated.

**Cost per complete 12-round negotiation: ~$0.07 (7 cents).**

### D-32-04 — LLM Usage Guards + Rate Limits

Hard caps (Redis-backed, 24h TTL):
```
email_classify:{restaurant_id}:day        → cap 500  (Layer 3+ only)
negotiation_draft:{restaurant_id}:day     → cap 50   (configurable in Settings)
negotiation_draft:{thread_id}:rounds      → cap HARD_ROUND_CAP (default 6, max 12)
```

Per-call token budget: 8,000 input tokens hard cap (enforced before API call).

If cap exceeded → freeze AI for that thread/restaurant, send "action required" notification, log to `api_spend`.

Auto-escalation: after `MAX_NEGOTIATION_ROUNDS_PER_THREAD` rounds without resolution → freeze AI, notify manager ("This negotiation requires your attention — X rounds without resolution").

**Future note — Phrase/entity compression:**
Store canonical wine + provider entities by UUID. Reference by ID in LLM context instead of repeating full text across rounds. Estimated 15–25% token savings on long threads. Build after Phase 32 foundation is stable.

### D-32-05 — Classification Cost Stack (Layered, Cheapest-First)

```
Layer 0: Idempotency check (message_id dedup)     → 0 cost — skip if seen before
Layer 1: Fast regex pre-filter (NOISE_INSTANT)    → 0 cost — ~25% of emails eliminated
         Patterns: unsubscribe, auto-reply, no-reply, mailer-daemon, [spam]
Layer 2: Subject-line-only Gemini pass (~100 tok) → $0.000008 — stop if confidence ≥ 0.88
Layer 3: Subject + body snippet 1,500 chars       → ~$0.0004 — strip HTML/quotes/sig first
Layer 4: Full body 8,192 chars (edge cases only)  → ~$0.003 — <5% of emails
```

Sender domain caching: after classification, cache `{domain → typical_category}` in Redis 48h. Soft-boost confidence by 0.1 on cache hit. Still calls Gemini — just biases the prior.

Batch classification: emails in 2-minute window sent as single Gemini call (5 emails/batch = 80% API overhead reduction).

**Estimated average cost per email: ~320 tokens = $0.0003 (vs $0.003 naive). 10× cheaper.**

### D-32-06 — Manager Approval Flow

Draft shown in UI → manager can:
- **Approve** → sent immediately
- **Edit** → inline edit → send
- **Discard** → no email, order proceeds manually

Pattern reuses existing Orders.tsx modal. Draft stored in `procurement_conversations` (direction=OUTBOUND, status=PENDING_APPROVAL).

### D-32-07 — Auto-Send Gate (3 conditions, all required)

1. Restaurant on paid tier (`restaurant_feature_flags.llm_communicator_enabled = true`)
2. Provider relationship health score ≥ threshold (configurable, default: 0.80)
3. Manager has explicitly pre-approved this provider for auto-send

When auto-send fires: manager notified post-send, not pre-send.

### D-32-08 — WineOps AI Disclaimer

Every AI-drafted outbound email must append (non-removable):
```
—
This message was drafted by WineOps AI on behalf of [Restaurant Name].
```

### D-32-09 — Provider Intelligence Profile Architecture

**Foundational (static / set at onboarding, rarely changes):**
1. Specialty wine categories (Burgundy, Rhône, Italian, Champagne, etc.)
2. Geographic distribution region / coverage area
3. Preferred communication channel (`preferred_channel` — already in DB)
4. Business type (importer, distributor, estate, broker)
5. Primary decision-maker identity (sales rep vs. owner — who actually closes)

**Dynamic (auto-updated from conversation history, LLM-extracted):**
6. Typical response window (auto-extracted: "replies within 4h on weekdays")
7. Preferred contact days/times (e.g., "best Tues-Wed, never Mondays")
8. Delivery schedule patterns (e.g., "ships Thursdays, arrives Fridays")
9. Negotiation style (haggles aggressively / fixed price / flexible on bulk)
10. Preferred order size (minimum cases, bulk preference)
11. Payment terms patterns (always net-30, accepts net-15 for close relationships)
12. Relationship health score (composite: response rate, fulfillment rate, price accuracy)
13. Language / jargon calibration (industry expert wanting terroir detail vs. commercial SKU-focused)
14. Allocation access level (exclusive allocations, limited-run wines available)
15. Seasonal responsiveness (slower Aug–Oct harvest, most responsive Jan–Mar)
16. Invoice / fulfillment dispute history (short-ships, vintage mismatches — from `order_interactions`)
17. Communication sensitivity flag (topics that triggered personal drift → discrete mode activates)

**Creative / behavioral intelligence (Phase 32+ or future):**
18. Wine market intel quality (accuracy of their allocation tips over time)
19. Substitution behavior (proactive alternatives vs. flat no when out of stock)
20. Price drift tracking (stable vs. creeping 3–5% per order — from `negotiation_facts` history)
21. Emergency responsiveness (confirmed same-week delivery capability)
22. Digital communication maturity (well-formatted invoices, consistent email structure)

**Schema:** Two JSONB columns on `providers`:
- `profile_foundational JSONB` — static, manager-set at onboarding
- `profile_dynamic JSONB` — auto-updated by LLM extraction after each conversation round

### D-32-10 — Provider Intelligence Build Process

1. **First run:** Manager fills in foundational profile (form in provider detail modal)
2. **After every conversation:** LLM auto-extracts dynamic fields (response time, payment terms, delivery patterns, keywords, dates, events) and upserts `profile_dynamic`
3. **Unknown sender detection:** If inbound email sender not in `providers.contact_email` → notification: "Unknown vendor email from [domain] — add to providers?"

### D-32-11 — Discrete Mode (already built in Phase 24-05)

`_classify_message_sensitivity()` in `ProviderConversationAgent` already detects personal/sensitive content. When triggered: LLM stops logging that message content, marks `sensitive=true` in session, does not embed, does not summarize. Phase 32 inherits this behavior.

### D-32-12 — Soft Inquiry Email

Available. Triggered from order modal when manager opens an order without a target price and enables "Ask AI for price". Same modal flow as existing "Ask AI price" toggle. No separate flow needed.

### D-32-13 — SMS

Future wave. `providers.preferred_channel` column is already set. When implemented, the same 5-step flow applies — just replaces email send with SMS API call.

### D-32-14 — Constraint System (Finalized — 20 real-world constraints)

#### HARD CONSTRAINTS — block or freeze AI response, manager must act
```
C-01  TOPIC_LOCK              Wine/beverage procurement only. Off-topic → freeze + escalate
C-02  COMMITMENT_GUARD        No explicit purchase commitments. "we're interested at X" not
                              "we agree to buy X". (Extends Phase 24 commitment guardrail)
C-03  QUANTITY_CAP            Context-aware. Two modes:
                              — Pre-approved: manager has set a per-provider approved multiplier
                                (stored in provider_intelligence.profile_dynamic.approved_qty_multiplier).
                                AI may draft up to that multiplier silently.
                              — Not pre-approved: quantity > order.quantity × 1.5 → ask manager
                                before generating draft.
C-04  PRICE_CEILING           Never agree to price > target_price × 1.15 without escalation
C-05  ROUND_LIMIT             After MAX_ROUNDS (default 6, hard cap 12) without resolution →
                              freeze AI + notify manager
C-06  LENGTH_CAP              Max 180 words per outbound email
C-07  DISCLAIMER              WineOps AI disclaimer appended to every draft. Non-removable.
C-08  SENSITIVE_SKIP          PII/sensitivity detected → discrete mode, no embedding,
                              no summary. Notify dev/admin channel only (see C-21). 
                              (Extends Phase 24-05)
C-10  DUPLICATE_ORDER_BLOCK   Active unfulfilled order exists for same wine → flag before draft
C-12  VINTAGE_DEVIATION_FLAG  Provider confirmed different vintage than ordered → freeze draft
C-13  AUTO_REPLY_LOOP_BLOCK   OOO / auto-reply detected → no draft, no notification spam.
                              If same from_email sends 3+ emails within 10 min → suppress as loop.
C-16  BULK_TRAP_DETECT        Two modes:
                              — Pre-approved bulk scenario for this provider → allow, log only.
                                (manager enables per provider in profile settings)
                              — Not pre-approved: provider min > order.quantity × 2 → block
                                draft, ask manager: "Bulk commitment required — approve?"
C-19  THREE_TIER_COMPLIANCE   No language implying: direct-from-winery, off-invoice, bypass
                              distributor, kickback. Hard block + escalate.
C-20  EMOTIONAL_ESCALATION    Anger / ultimatum / threats detected → no AI draft,
                              manager-only response required
C-21  PII_PAYMENT_GUARD       Routing numbers, SSN patterns, medical/personal content →
                              discrete mode: no body logging, no embedding, no summary.
                              Notification routed to DEV/ADMIN channel only — not manager
                              general inbox. Manager sees a sanitized line in weekly report:
                              "1 email from [Provider] contained sensitive content — not stored."
C-22  PRICE_BAIT_SWITCH       Invoice price deviates from negotiation_facts agreed price →
                              flag + freeze any payment acknowledgment draft
```

#### ANNOTATING CONSTRAINTS — draft proceeds with inline warning visible in approval panel
```
C-09  STALE_PRICE_GUARD       Price data >30 days old → append note inside draft:
                              "Last recorded price: $X on [date] — confirm current pricing."
C-11  UNIT_AMBIGUITY_GUARD    Bare number without unit (cases/bottles/magnums) → draft must
                              explicitly ask for unit before round progresses
C-14  OUTSTANDING_INVOICE     Active unpaid invoice with this provider → annotation banner in
                              draft panel: "Outstanding invoice #X with this provider."
                              NOT a block. Manager decides whether to proceed.
                              Money matters — the manager speaks last, not the system.
C-15  RELATIONSHIP_DRIFT      close_relationship=true but last_contact >90d OR recent dispute →
                              override to standard tone + flag: "Relationship profile may be
                              outdated — using standard tone."
C-17  OFF_HOURS_HOLD          Draft held until provider's business hours (8am–6pm their timezone).
                              urgency=urgent overrides. Manager notified of hold time.
C-18  SOFT_COMMITMENT_TRAP    "we always order from you / count on us every quarter" etc. →
                              replaced with neutral language, logged as soft_commitment_detected,
                              annotation shown: "Softened implicit ongoing commitment in [paragraph]"
C-23  GHOST_THREAD_ESCALATE   No reply in >5 business days → manager notification only
                              ("No response in 5 days — follow up, call, or try another provider?")
C-25  THREAD_ORPHAN + OFF-APP See Section D-32-15 below for full architecture.
```

#### SOFT CONSTRAINTS — style defaults, manager-overridable per provider
```
S-01  NO_COMPETITOR_MENTION   Don't reference other vendors' prices (unless manager enables)
S-02  PROFESSIONAL_CLOSE      Always end with specific next action + timeline
S-03  WARM_ACKNOWLEDGE        Acknowledge provider's most recent action in opening line
S-04  PRICE_ANCHOR_FIRST      Ask for their price before revealing our target (negotiation default)
```

**Violation handling:**
- Hard constraint triggered → `session_status = 'pending_manual_review'` + "action required" notification
- Annotating constraint triggered → draft proceeds with warning badge/banner in approval panel
- Soft constraint overridden → logged to `negotiation_facts` for audit trail

**Removed constraints:** C-24 (competitive price leak), C-26 (scarcity pressure), C-27 (storage capacity), C-28 (tone drift) — removed per user decision 2026-05-14.

---

### D-32-15 — Thread Orphan + Off-App Order + Invoice Matching

**C-25 expanded architecture.**

#### What's already built
`VisualVerificationAgent` handles image-based invoice OCR (`_scan_invoice` via EasyOCR), compares price/quantity/vintage against a known `order_id`. Works for photos of invoices. **Requires** `order_id` to compare against.

**What's missing:**
- Email-embedded invoice text / PDF — agent expects an image, not email body text
- Off-app order matching — no `order_id` in DB to compare against

#### Three scenarios C-25 must handle

**Scenario A — Orphaned thread (provider emails out of nowhere)**
Inbound email from known `providers.contact_email` but no matching `gmail_thread_id` or active order found.
Action: Notify manager — "Unmatched email from [Provider] — does this relate to an existing order, or should we start a new one?" Manager creates order manually or links to existing.

**Scenario B — Off-app order, invoice arrives by email**
Manager placed an order by phone/WhatsApp/in person. Provider emails an invoice. No order in DB.

Matching algorithm (in EmailIntelAgent, triggered when incoming email is classified OPERATIONAL + contains invoice signals):
1. Extract from email body/attachment: `provider_name`, `wine_name`, `quantity`, `unit_price`, `total`, `invoice_date`
2. Fuzzy-match against `procurement_orders`:
   - `provider_id` matches provider (by email domain or name)
   - `wine_name` similarity > 70% (fuzzy string match)
   - `created_at` within 45 days of invoice date
   - `quantity` within 30% of order quantity
3. Score:
   - > 0.80 → Auto-suggest: "This invoice looks like order #1041 — confirm?"
   - 0.50–0.80 → Possible match: "Could this be for order #1041 (Pommard × 4 from [Provider])? Yes / No / Different order"
   - < 0.50 → No match: "This looks like a delivery not recorded in the app — create a retroactive order?"

**Scenario C — Off-app order confirmed, create retroactive record**
Manager confirms "yes this is outside the app." System creates:
```
procurement_orders (status='delivered', source='retroactive')
  + actual_delivery = invoice_date
  + final_confirmed_cost = invoice_total
  + wine_name from invoice extraction
  + provider_id matched
procurement_conversations (direction='INBOUND', content=email body, ai_summary=extracted facts)
order_interactions (interaction_type='invoice_received', content=raw invoice text)
```
Then triggers `VisualVerificationAgent` comparison logic with the now-matched order_id.

**Invoice text extraction (new, Phase 32):**
For email-body invoices (no image), extract structured data using Haiku:
```
Prompt: "Extract invoice fields from this email. Return JSON:
{vendor_name, invoice_number, invoice_date, line_items: [{wine_name, vintage, quantity, unit_price}], total}"
```
Cost: ~$0.001 per invoice email. Fallback: regex patterns from `_parse_invoice_text` (already in VisualVerificationAgent).

---

### D-32-16 — Invoice Scanning Full Status

| Capability | Status | Notes |
|------------|--------|-------|
| Photo/image invoice OCR | ✅ Built | `VisualVerificationAgent._scan_invoice()` via EasyOCR |
| Price mismatch detection | ✅ Built | `_compare_invoice_to_order()` |
| Quantity mismatch | ✅ Built | Same |
| Vintage mismatch + barcode cross-ref | ✅ Built | `_process_barcode_scan()` |
| Email-text invoice extraction | ❌ Missing | Add in Phase 32: Haiku + regex fallback |
| Off-app order matching | ❌ Missing | Add in Phase 32: fuzzy match algorithm |
| Retroactive order creation | ❌ Missing | Add in Phase 32: new API endpoint |
| Invoice data saved to DB | ✅ Partial | `_store_verification_result()` exists but only when order_id known |

---

## Phase 32 Scope (Foundation Only)

**In scope:**
- `provider_intelligence` table (foundational + dynamic JSONB)
- Outbound email type taxonomy + selection logic
- Order creation hook → silent draft pre-computation → manager notification
- `ProviderCommunicationService`: draft generation using profile + constraint system
- Progressive summarization pipeline (sliding window, `negotiation_facts` auto-extraction)
- Rate limits + round caps (Redis-backed)
- Manager draft approval panel (reuses Orders.tsx modal pattern)
- Unknown email detection → "add provider?" prompt
- Provider intelligence badge pills on provider card (top 3 most actionable)
- Full profile panel in provider detail modal

**Out of scope (future phases):**
- SMS/text sending
- Auto-send for all providers (just the gate for pre-approved)
- Full analytics dashboard for negotiation performance
- Phrase/entity compression
- Paid-tier LLM communicator gate (noted in Phase 31 ROADMAP note)

---

## Open Questions for Planning

None. All decisions locked. Ready for `/gsd-discuss-phase 32` when user approves.
