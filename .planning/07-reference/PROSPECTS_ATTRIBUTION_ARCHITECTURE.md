# Prospects Attribution — SOTA Architecture Decision & Phased Plan

Status: ✅ BUILT AND WIRED, DORMANT BY CONFIG (verified 2026-08-04 by the v3.0 triage).
This is the one plan of the five whose header was not misleading — but "Approved"
undersold it. `ProspectsController` and `InboundEmailController` are both registered in
`orchestrator.module.ts:25-26`, so the routes are live now.

Nothing is left to build. The feature is gated on `INBOUND_EMAIL_DOMAIN`: unset, every
method of `InboundAddressService` returns null and the legacy single-mailbox path is
untouched. Activating it is an **ops task, not a build task** — register a domain, point
MX at the provider, set `INBOUND_EMAIL_DOMAIN` / `INBOUND_EMAIL_PROVIDER` /
`INBOUND_WEBHOOK_SECRET`.

The webhook itself is fail-closed: with no `INBOUND_WEBHOOK_SECRET` configured it refuses
every request rather than accepting them. One hardening left: it also accepts the secret
as `?secret=`, which puts it in access logs, proxy logs and browser history — prefer the
`x-inbound-secret` header and consider dropping the query fallback once no provider needs it.

Original direction: true multi-tenant SaaS, dedicated-domain inbound,
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

---

## 9. Build log

### Phase 0 — SHIPPED & LIVE (commit `a21a6c5`, 2026-07-08)
- Migration `20260708150000_p0_prospects_hardening.sql` applied to `exzueerziesmczwlhomd`: nullable `restaurant_id`, `capture_reason`/`attachments`/`gmail_message_id`/`gmail_thread_id`/`body_preview`, triage dedup index, gmail-id idempotency index, `UNIQUE(restaurant_id, lower(contact_email))` on providers.
- Backend: `resolveAttribution()` (triage instead of guess), gmail-id idempotency, promote dedup, `listUnattributed`/`attachmentsFor`/`restore`; operator-only `/prospects/triage`.
- Frontend: provenance chips, view-message + attachments (signed URLs), undo-on-dismiss, confirm-on-add, distinct error-vs-empty states, `?tab=prospects` deep link, naming cleanup.

### Phases 1–3 — BUILT, CODE-COMPLETE, DORMANT pending infra (2026-07-08)
All config-gated; no-op until `INBOUND_EMAIL_DOMAIN` + `INBOUND_WEBHOOK_SECRET` are set. Legacy Gmail path unchanged (dual-run).
- **Phase 1**: migration `20260708160000_p1_restaurant_inbound_addresses.sql` (applied); `InboundAddressService` (`inbound-address.service.ts`) — provision/resolve opaque `r-<token>@INBOUND_EMAIL_DOMAIN`; `InboundEmailController` (`inbound-email.controller.ts`) — `POST /api/v1/webhooks/inbound-email`, secret-gated, parses Postmark + generic payloads, resolves recipient → restaurant_id, publishes `email.inbound.received`.
- **Phase 2**: `rabbitmq-bridge.service.ts` `handleInboundEmail` consumes `restaurant_id` from the event; provider lookup scoped by tenant (kills global `limit(1)` misrouting); `prospects.captureFromColdEmail` accepts explicit `restaurantId` for deterministic attribution; unresolved recipient → triage.
- **Phase 3**: `procurement.service.ts` `sendProviderEmail` sets `Reply-To` = restaurant's dedicated inbound address (via `InboundAddressService`) on all 4 vendor-send paths (interim; From stays shared Gmail until the sending domain is verified).

### Activation checklist (your infra actions)
1. Register inbound domain (e.g. `in.wineops.ai`); set MX at the chosen provider (Postmark recommended) + SPF/DKIM/DMARC.
2. Point the provider's inbound webhook at `POST /api/v1/webhooks/inbound-email` with the shared secret.
3. Set env on api-gateway: `INBOUND_EMAIL_DOMAIN`, `INBOUND_WEBHOOK_SECRET`, `INBOUND_EMAIL_PROVIDER` (optional label). Addresses auto-provision per restaurant on first outbound/lookup.

### Phase 4 — SHIPPED (2026-07-08)
Migration `20260708170000_p4_tenant_rls_policies.sql` (applied to `exzueerziesmczwlhomd`).
- **Per-tenant RLS policies** on `providers`, `procurement_conversations`, `email_prospects`,
  `sender_reputation`, `conversation_attachments`, `restaurant_inbound_addresses` — keyed on
  `user_restaurant_access` via `auth.uid()`, matching the existing `provider_locations` pattern.
  Non-breaking: those tables were RLS-enabled with 0 policies (deny-by-default; service-role
  bypasses), and no frontend reads them via the anon key. Closes the premortem "RLS enabled but
  policyless" finding; triage rows (`restaurant_id IS NULL`) stay operator-only.
- **Nightly isolation assertion**: `tenant_isolation_report()` SQL function + `ScheduledTasksService.checkTenantIsolation` cron (03:15) logs `TENANT_ISOLATION_VIOLATION` when any orphaned count > 0. Baseline verified 0 violations across 9 live restaurants.
- **Deferred within Phase 4**: flipping tenant reads to a per-request authenticated client is intentionally NOT done — the app uses its own JWT (not Supabase Auth), so `auth.uid()` isn't populated for app queries. RLS here is defense-in-depth, ready for any future authed-client access; a full switch would mean adopting Supabase Auth (separate migration).

### Phase 5 — SHIPPED (2026-07-08)
- **Backend**: `GET /prospects?scope=all` returns open prospects across every restaurant the caller belongs to (`ProspectsService.accessibleRestaurantIds` + `listAcross`), each row carrying `restaurant_id`. Never spans beyond the caller's `user_restaurant_access` memberships.
- **Frontend** (`Promotions.tsx`): when a user has >1 location, the Prospects tab shows **location filter chips** (per-location counts, toggle to show/hide) and a **per-row location label**; single-location users are unchanged. Promote/dismiss stay strictly row-scoped (never "all").

### Deferred
- **CI**: pre-existing ruff/black/eslint-config debt + Security-Scan `security-events` permission bug — deferred per owner.
