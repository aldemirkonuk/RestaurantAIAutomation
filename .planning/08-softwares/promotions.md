---
type: software
slug: promotions
name: Promotions
division: vendor
status: partial
tier: core
routes: ["/promotions", "/promotions?tab=senders", "/promotions?tab=prospects"]
pages: [promotions]
api_modules: [providers, common/orchestrator]
agents: []
owner_unit: ""
gap_reason: "Has no gateway module of its own — served by `providers` plus `common/orchestrator`, a 7,256-LOC module no charter owns"
updated: 2026-09-01
links: ["[[06-pages/promotions|/promotions (page)]]", "[[vendor-directory]]", "[[communications-hub]]", "[[global-vendor-search]]", "[[SOFTWARE-MAP]]"]
---

# Promotions

## §0 What it is

The place where the useful things buried in vendor email surface on their own. Deals a
supplier mentioned in passing get pulled out and listed. Senders you trust get marked as
trusted so their mail stops being held back. And suppliers you have never dealt with, who
emailed you cold, get parked in a list you can accept or ignore — rather than being lost in
an inbox or turned into a vendor without you saying so.

Despite the name, none of it is advertising to guests. These are **supply-side** offers.

## §1 Features today

- Switch tabs with the 1 / 2 / 3 keys; deep-link a tab with `?tab=senders|prospects`
- **Offers**: read the promotions extracted from vendor email, with confidence and expiry
- Copy a promo code; apply an offer to a new order (hands off to `/orders?new=1&promo=<id>`)
- Dismiss an offer with an 8-second undo — *per-device only*: there is no dismiss endpoint,
  so a cleared offer is cleared only in that browser
- **Trusted senders**: see a sender domain's reputation — injection signals, spam signals,
  completed orders, score — and toggle trust to skip the spoof quarantine
- **Prospects**: read cold outreach from vendors you have not added; open attachments,
  promote one into a real vendor, dismiss, or restore a dismissal
- Fetch prospects across every branch you belong to, labelled by location
- Export any tab

## §2 Screens

- [[06-pages/promotions|/promotions]] — the whole software, three tabs in one file
  (`apps/web/src/pages/Promotions.tsx`, 795 LOC; tab type at `:20`).

> **Naming collision, flagged not fixed.** This software's slug and its page's slug are both
> `promotions`, so a bare `[[promotions]]` is ambiguous in the vault — including in
> `06-pages/promotions.md:20`, which already links to itself. Links from here are
> path-qualified. Renaming one of the two is a [[SOFTWARE-CONTRACT]] question, not a
> session's call.

Route at `apps/web/src/App.tsx:304`, **not** `PageGate`-wrapped — no `next` variant exists,
so there is one surface. Entry is the sidebar (`components/layout/Sidebar.tsx:93`).

## §3 Backend

**There is no `promotions` module in the gateway.** `ls apps/api-gateway/src` returns 47
entries and none of them is `promotions`. The page is served by two modules, neither of
which is named for it. Every call goes through `apiClient`, so all nine carry the bearer
token (`hooks/queries/usePromotionsQueries.ts:2`).

| Tab | Endpoint | Controller |
|---|---|---|
| Offers | `GET /providers/promotions/active` | `providers/provider-intelligence.controller.ts:104` |
| Senders | `GET /senders/reputation` | `common/orchestrator/sender-trust.controller.ts:57` |
| Senders | `POST /senders/trust` | `sender-trust.controller.ts:23` |
| Prospects | `GET /prospects` | `common/orchestrator/prospects.controller.ts:33` |
| Prospects | `GET /prospects/:id/attachments` | `prospects.controller.ts:73` |
| Prospects | `POST /prospects/:id/promote` | `:88` |
| Prospects | `POST /prospects/:id/dismiss` | `:103` |
| Prospects | `POST /prospects/:id/restore` | `:118` |

`@Controller("prospects")` at `prospects.controller.ts:25`, class-guarded `JwtAuthGuard` at
`:26`; `@Controller("senders")` at `sender-trust.controller.ts:18`. The sixth prospects
route, `GET /prospects/triage` (`:58`), is operator-only and gated by a
`PLATFORM_ADMIN_USER_IDS` allowlist rather than a tenant role (`:22-24,135`) — the correct
choice, and worth copying.

`provider-intelligence.controller.ts` carries four more promotion routes this page does not
call: `GET /providers/:id/promotions` (`:87`), `promotions/expiring` (`:117`),
`promotions/compare` (`:133`), `promotions/savings` (`:146`). They are consumed by
[[vendor-directory]]'s intelligence panel, not here.

## §4 Automation

No agent. Three deterministic TypeScript producers, all in `common/orchestrator/`:

- **D3 — the promotions lane.** `PromotionExtractorService.extractAndStore` runs on **every
  provider-matched inbound email**: a cheap pre-filter, then `extractPromotion` (**no LLM**),
  dedup on `conditions.signature`, insert, notify
  (`promotion-extractor.service.ts:37-60,124`). Wired unconditionally in the inbound bridge
  (`rabbitmq-bridge.service.ts:789-799`).
- **A 09:00 daily digest** groups the last 24h of digest-bucket promos per restaurant and
  notifies once (`promotion-extractor.service.ts:179-215`,
  `@Cron(CronExpression.EVERY_DAY_AT_9AM)`).
- **D1 — prospect capture.** Unattributed cold outreach is inserted as an `email_prospects`
  row (`prospects.service.ts:220`); **D5 — sender reputation** is upserted by the triage
  path (`sender-reputation.service.ts:65,143`).

**This corrects a claim carried in project memory and in [[06-pages/promotions|the page note]] §9:
`provider_promotions` is no longer dormant.** The extractor's own header says so —
*"written to the (previously dormant) `provider_promotions` table"*
(`promotion-extractor.service.ts:24`). Anything citing the dormant table, including
`guest-value-monetization-charter.md:119-123`, is stale on that point.

## §5 Data

Verified in the production baseline (`supabase/migrations/20260805000000_baseline_from_production.sql`):

- `provider_promotions` (`:4808`) — six distinct reads in
  `providers/provider-intelligence.service.ts` (`:135,159,179,197,222,430`), three
  operations in `promotion-extractor.service.ts` (`:54,124,184`). RLS enabled (`:14811`),
  FK to `providers` with `ON DELETE CASCADE` (`:13253`), and a
  `promo_type` CHECK enum of ten values (`:4826`) that
  `common/orchestrator/promo-extract.ts:11` must mirror exactly — with a spec asserting it
  (`promo-extract.spec.ts:91`).
- `email_prospects` (`:2705`) — 10 operations in `prospects.service.ts`.
- `sender_reputation` (`:5321`) — 5 operations in `sender-reputation.service.ts`.

The software **owns none of the three writers' modules**, which is §6.

## §6 Owner

**`unowned — gap`.** No charter names `/promotions` or this software. Its three tabs land on
three different teams, and the org chart has no row that covers all of them.

| Tab | Nearest charter claim |
|---|---|
| Offers | [[procurement-vendor-network-charter]] owns `providers/provider-intelligence` (17 routes, `:37`). [[guest-value-monetization-charter]] explicitly pushes `provider_promotions` and `/promotions` away — *"Supply-side deals. Not guest-facing advertising. The name is the whole trap"* (`:82`) — pointing at "Procurement / Providers" without naming a team. |
| Senders | [[messaging-delivery-charter]] lists `sender-reputation.service.ts` and `email-triage.ts` in its transport spine. It does **not** list `sender-trust.controller.ts`. |
| Prospects | [[supply-discovery-charter]] lists `prospects.service.ts` / `prospects.controller.ts` in its evidence table (`:91`) — under a mandate about *outbound* vendor finding, while the module captures *inbound* cold mail. |

Two charters go out of their way to disclaim it rather than claim it:
[[sales-charter]] opens with *"⚠️ Read this before citing any evidence — the `prospects`
naming trap"* (`:20-37`), and [[outbound-engine-charter]] repeats it and reassigns the module
to [[inbound-understanding-charter]] (`outbound-engine-charter.md:81`) — which itself owns
only the guardrail contract, explicitly not the extractors
(`inbound-understanding-charter.md:52`). Nobody ends up holding the code.

No charter mentions `promotion-extractor.service.ts` at all.

## §7 Maturity & seams

**partial**, inherited from [[06-pages/promotions|the page note]] §10. All three tabs read live,
producer-backed data through the authenticated client. It is the best-supplied software in
this division, and the surprise is that it is the one with no module and no owner.

Rolled up:

- Every one of the three tabs has a **real, running producer** (§4) — rare in this corpus.
- Prospect promote / dismiss / restore are **real server writes**, not local state.
- The operator-only `/triage` route is gated by allowlist, not by tenant role.
- **Offer dismissal never leaves the browser** — `wineops.promos.dismissed` in
  localStorage with an 8s undo, deliberate and commented (`Promotions.tsx:101,113-117`), but
  a manager who clears an offer has not cleared it for a colleague or for themselves on
  another device. This is the only gap between the software and its page.

Seams:

1. **A software with no module.** Two of its three backends live under
   `apps/api-gateway/src/common/orchestrator/` — an infrastructure name inside `common/` —
   and the third is a second controller bolted onto the `providers` prefix. Nothing in the
   tree says "promotions". See [[communications-hub]] §7 for the full shape of that folder.
2. **Three tabs, three owners, no owner** (§6).
3. **A cross-module enum contract held together by a spec.** `promo_type` must match the
   DB CHECK constraint exactly; the guard is one assertion in
   `promo-extract.spec.ts:91`, and the same class of drift already bit
   `outbound_email_type` (project memory).
4. **`/promotions` reads promotions; [[vendor-directory]] also reads promotions** — four more
   routes on the same table, rendered in a different panel with a different design, from a
   different page (§3).
5. **Stale claims about this software outlived it.** Two charters, one page note and one
   memory file still describe `provider_promotions` as dormant (§4). The producer shipped;
   the corpus did not follow.

## §8 Where it's going

- ADR 0049 §3a: **Vendor** division, phase **E1**; the `promotions` page is named
  (`04-specs/ECOSYSTEM-PLAN.md:55`).
- The owner gap is the actionable item, not a feature: §6 has no candidate that covers all
  three tabs, and [[SOFTWARE-MAP]]'s gap table should carry it.
- A dismiss endpoint would close the one honest gap in §7 and cost less than the localStorage
  workaround already does.
- The stale-dormant claims in `guest-value-monetization-charter.md:119-123`,
  `supplier-distributor-network-charter.md:130-133` and the
  `inbound-email-intelligence-plan` memory need the correction in §4 applied.
