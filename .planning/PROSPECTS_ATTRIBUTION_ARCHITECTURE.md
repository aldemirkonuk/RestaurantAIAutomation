# Prospects Attribution — SOTA Architecture Decision & Phased Plan

Status: Approved (2026-07-08). Direction: true multi-tenant SaaS, dedicated-domain inbound,
full per-tenant RLS, promote fixes now, all UX gaps addressed. Deliverable: plan + Phase 0 build.

Backing analyses:
- Premortem (failure-mode) — agent e6867ee0-3a15-493d-9b64-8e255dd158d6
- User POV (UX) — agent 91f59890-9a7f-4d90-8741-777f8a954b0e

---

## 1. Core decision: derive attribution from transport, never invent it

Every failure the premortem found traces to one thing: `resolveRestaurantId()` **guesses** the
restaurant because the inbound Gmail mailbox is a single shared account that carries no tenant
signal. The SOTA fix: make **the address the vendor emailed** deterministically identify the
restaurant. Attribution becomes a lookup, not a heuristic — and the Critical cross-tenant leak,
sticky-misrouting, and silent-cutover bugs all dissolve at the root.

Root-cause themes:
1. A single physical mailbox is asked to carry a multi-tenant logical signal it structurally cannot.
2. Tenant isolation is enforced only by app code passing the right `restaurant_id`, not by the DB
   (RLS enabled but policyless + service-role bypass).
3. Matching is global where it should be tenant-scoped (provider lookup `limit(1)`, dedup domain,
   thread lookup) → a single misattribution becomes sticky and self-reinforcing.
4. The design is coupled to "exactly one restaurant" and fails silently on DATA changes (insert of
   restaurant #2), not deploys — invisible to normal QA.

---

## 2. Mailbox architecture (recommended)

**Recommendation: one dedicated inbound domain + inbound-parse provider + a unique address per
restaurant.** NOT per-restaurant Gmail mailboxes.

- Why not N Gmail mailboxes: doesn't scale to SaaS — per-seat cost, per-tenant OAuth + watch renewal
  + history cursor, Gmail quotas, manual provisioning. Current code already strains with a single
  global watch + one Redis cursor (`gmail-watch.service.ts` HISTORY_ID_KEY) and dead `email_watch_state`.
- Why dedicated domain + inbound parse (SOTA): one MX + one webhook serve unlimited tenants. The
  envelope recipient (`Delivered-To`) is set by our MX → trustworthy, unspoofable attribution key.
  Full raw MIME (attachments) delivered to us.

Address scheme (recommended): opaque, unguessable, no-PII token as canonical machine address, e.g.
`r-7f3a9c@in.wineops.ai`, provisioned one-per-restaurant into a new `restaurant_inbound_addresses`
table. Optional friendly alias (`meyhouse@in.wineops.ai`) mapping to the same restaurant. The
restaurant publishes this as its procurement address; WineOps sends vendor email From/Reply-To that
address so replies come back deterministically attributed.

Provider (recommended, ranked):
| Provider | Why | When to pick |
|---|---|---|
| Postmark Inbound (primary) | Best DX + deliverability, clean JSON webhook w/ parsed attachments, custom-domain MX | SOTA fast, reliable attachments, low ops |
| AWS SES inbound → S3 + SNS/Lambda | Cheapest at scale, full MIME to S3 | High volume, accept more infra |
| Cloudflare Email Routing + Email Workers | Free, edge-native | Cost-sensitive, OK parsing raw MIME |
| Resend Inbound | Vercel-ecosystem-native | Stay all-in on Vercel/Resend |

Start on Postmark; keep the current Gmail path as fallback ingest during migration.

---

## 3. Target inbound flow

```
Vendor → r-7f3a9c@in.wineops.ai
      → dedicated-domain MX (Postmark/SES)
      → inbound webhook (api-gateway)  ── looks up Delivered-To in restaurant_inbound_addresses
      → publishes email.inbound.received  { restaurant_id, ... }   ← restaurant now KNOWN
      → rabbitmq-bridge.handleInboundEmail:
            • provider lookup SCOPED to restaurant_id  (kills global limit(1) misrouting)
            • known provider  → conversation on correct tenant
            • unknown sender  → Prospect on correct tenant
            • unmatched address → "Unassigned triage" (operator-only, never a tenant)
```

`resolveRestaurantId()` is deleted. `email_prospects.uq_prospect_domain (restaurant_id, domain)`
becomes correct automatically because `restaurant_id` is now real per tenant.

Integration points confirmed in code:
- Inbound webhook already forwards every header (incl. `to`/`delivered-to`) but stamps NO restaurant:
  `apps/api-gateway/src/communications/communications.controller.ts:956-972`.
- Outbound is a single hardcoded identity `WineOps AI <senderEmail>`:
  `apps/api-gateway/src/communications/gmail.service.ts:519,598`.
- Cold-email capture + guess: `apps/api-gateway/src/common/orchestrator/prospects.service.ts:41-51`.
- Global provider lookup `limit(1)`: `apps/api-gateway/src/common/orchestrator/rabbitmq-bridge.service.ts:552-557`.

---

## 4. Multi-restaurant UX (chip filter)

For owners/operators with access to multiple restaurants (`user_restaurant_access`), the
Comms/Prospects surface gets a restaurant filter as toggleable chips: show/hide each location's
inbox, view several at once, each row labeled with its restaurant. Replies are ALWAYS scoped to the
row's restaurant address — never "reply for all." Default view = current active restaurant; chips are
additive for multi-access users. Pure aggregation/view layer on top of deterministic per-restaurant
addressing.

---

## 5. Phased plan

### Phase 0 — Cheap correctness + safety + UX (no attribution-infra dependency) — BUILD NOW
- Promote fixes: partial `UNIQUE(restaurant_id, contact_email)` on `providers`; dedupe existing
  provider in `promote()`.
- Kill silent behavior: log + metric on `resolveRestaurantId()===null` and `captured:false`; stop
  discarding the `void` result at `rabbitmq-bridge.service.ts:566`.
- Interim SOTA safety: when `restaurants > 1` and no deterministic attribution, route cold email to
  an operator-only "Unassigned triage" bucket (never leak to a tenant, never silently drop). Startup
  health-check fails loudly on invariant violation.
- UX: fix Promotions/Prospects/Promote naming collision + vendor/provider/supplier consistency;
  prospects notification/digest parity with promotions; provenance (why captured/dropped);
  source-email link + real attachment access; empty-state that distinguishes "quiet" from "broken";
  undo/confirm on promote & dismiss.

### Phase 1 — Dedicated-domain inbound foundation (needs provisioning)
- Provision `in.wineops.ai`, MX + SPF/DKIM/DMARC on chosen provider.
- New `restaurant_inbound_addresses` table; provision one opaque address per restaurant.
- New inbound webhook (provider → normalized `email.inbound.received` WITH `restaurant_id` from
  `Delivered-To`); dual-run alongside Gmail ingest with cross-path `message-id` idempotency.

### Phase 2 — Attribution cutover
- `handleInboundEmail` consumes `restaurant_id` from the event; delete `resolveRestaurantId`; scope
  provider lookup by `restaurant_id`; unmatched address → triage.

### Phase 3 — Outbound unification
- Send vendor email From/Reply-To = restaurant's dedicated address (per-restaurant sending identity)
  so replies auto-attribute; migrate procurement outbound off the single Gmail (Reply-To-only interim
  acceptable).

### Phase 4 — Full per-tenant RLS
- RLS policies on `email_prospects`, `providers`, `procurement_conversations`,
  `conversation_attachments`, `sender_reputation` keyed on `user_restaurant_access`; request-scoped
  authenticated client for tenant reads; service-role writes carry explicit `restaurant_id`; nightly
  cross-tenant assertions.

### Phase 5 — Multi-restaurant chip UX + polish
- Restaurant filter chips, per-row labels, aggregated inbox for multi-access users, reply always
  row-scoped.

---

## 6. Premortem of the NEW (SOTA) design
| Risk | Trigger | Mitigation |
|---|---|---|
| Cold vendors don't know per-restaurant address → triage backlog | Vendor scrapes generic/old address | Publish dedicated address as procurement contact; use as outbound From; onboarding step; accept triage long-tail |
| New domain lands in spam | Cold sending domain | Warm-up, SPF/DKIM/DMARC, dedicated IP at volume; keep Gmail fallback initially |
| Header spoofing of recipient | Forged `To` | Trust envelope recipient from parse provider, not user `To`; require SPF/DKIM/DMARC pass before trusting sender |
| Dual-run duplicates | Same email via Gmail + new domain | `message-id`/`gmail_message_id` idempotency across both ingest paths |
| RLS migration breaks service-role reads | Policy rollout | Phased, permissive-first, flag-gated switch to authed client, test harness |
| Address enumeration to inject prospects | Someone emails a valid tenant address | Opaque tokens; inbound stays digest-only + never auto-replied; dedupe |
| Attachment malware / size | Inbound PDFs | Provider AV scan, size caps, store under `restaurant_id/` in Supabase Storage |

---

## 7. Success criteria / observability
- 0 silent drops: 100% of inbound gets a `restaurant_id` or lands in triage (metered).
- 0 wrong-tenant prospects (nightly assertion: prospect `restaurant_id` diversity ≥ restaurant count
  once addresses exist).
- Attribution source logged for every inbound; triage size trend tracked; promote-dedupe rate tracked.

---

## 8. Reversible calls baked in (override any)
- Provider = Postmark (SES if high volume).
- Address = opaque token `r-xxxx@in.wineops.ai` (friendly alias optional).
- Migration = dual-run Gmail + new domain, then cut over (not a hard switch).
- Outbound unification in Phase 3 (Reply-To-only interim acceptable).
