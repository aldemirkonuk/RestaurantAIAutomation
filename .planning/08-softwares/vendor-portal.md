---
type: software
slug: vendor-portal
name: Vendor Portal
division: vendor
status: hollow
tier: public
routes: ["/v/:slug"]
pages: [vendor-public-page]
api_modules: [vendor-portal]
agents: []
owner_unit: ""
gap_reason: "Ownership **contested**: `procurement-vendor-network` vs `supplier-distributor-network`, on an unratified proposed line; PROD-F2 still open"
updated: 2026-09-01
links: ["[[vendor-public-page]]", "[[vendor-price-compare]]", "[[global-vendor-search]]", "[[vendor-directory]]", "[[supplier-distributor-network-charter]]", "[[procurement-vendor-network-charter]]", "[[SOFTWARE-MAP]]"]
---

# Vendor Portal

## §0 What it is

The page a supplier gets to show their own customers: their wine list, searchable and
sortable, with their contact details on it. Anyone can open it — no account, no login. It
is the only part of the product a stranger can see, and it does double duty: our own price
comparison reads it back as a trustworthy price source instead of guessing from a scrape.

## §1 Features today

- Open a vendor's catalogue by its address — no account needed
- Search the listing
- Sort by name, price-per-750ml, or vintage — with unpriced listings sorted last, because
  "absent is not cheapest"
- Prices normalised to a per-750ml basis so they compare
- The vendor's contact email, phone and website
- Search-engine structured data — *partial*: injected client-side, so a crawler that does
  not run JavaScript sees an empty shell
- Anything that creates or edits a vendor page — **absent**: no route, no screen, no script
  writes either of this software's tables (§5)

## §2 Screens

- [[vendor-public-page]] — the whole software, one route, one self-contained component
  (`apps/web/src/pages/VendorPortal.tsx`, 374 LOC — no shared layout, no auth context).

Registered in App.tsx's **public** block, above the authenticated tree
(`apps/web/src/App.tsx:171`), under a comment that states the intent: *"No auth: this is
what a vendor chose to publish, and our own ingester reads it back as structured data"*
(`:169-170`). Not `PageGate`-wrapped. No inbound in-app link and no outbound one — entry is
entirely external, by a URL the vendor shares.

## §3 Backend

`apps/api-gateway/src/vendor-portal/` — a three-file module (controller, service, module),
the smallest in the gateway.

| Endpoint | Controller | Consumer |
|---|---|---|
| `GET /vendor-portal/:slug` | `vendor-portal.controller.ts:20` | the page, by direct axios (`VendorPortal.tsx:93-94`) |
| `GET /vendor-portal/:slug/jsonld` | `:39` | **nothing** — built for the ingester and for server-rendered HTML; neither wires it |

`@Controller("vendor-portal")` at `:16`. Both routes carry an explicit `@Public()`
(`:20-21,39-40`) with a written rationale — these are 2 of the 17 deliberate `@Public()`
routes in the gateway, and OD-19's re-measured census classes them as public by intent
rather than as a guard gap.

The exposure is narrowed on purpose, and the service says why: a `select("*")` here
*"would ship `edit_token` — the entire authentication mechanism for vendor editing — to
anyone who loads the page"* (`vendor-portal.service.ts:36-44`). Columns are enumerated at
`:56-58` and `:71-73`; unpublished and nonexistent pages both 404 (`:63-67`) so that draft
pages cannot be enumerated.

## §4 Automation

`none` — every response is a request from a browser or a crawler. Nothing refreshes,
publishes, expires, or sweeps a portal page on a schedule.

## §5 Data

`vendor_portal_pages` and `vendor_portal_listings`, created by
`supabase/migrations/20260805155901_vendor_portal.sql`. Both have RLS enabled with **zero
policies** (`:131-137`) — the migration's own comment: *"Exposing this table directly to
anon would publish every vendor's edit token."* So the gateway route is the only read path,
and it is the narrowed one.

**Nothing writes either table.** A repo-wide grep for `vendor_portal_pages` /
`vendor_portal_listings` across `apps/`, `services/`, `scripts/`, `datasets/` and
`supabase/` returns exactly three hits: the two `.from(...)` **reads** in
`vendor-portal.service.ts:55,70`, and the migration that creates them. There is no admin
route, no vendor-facing editor, no importer, and no seed.

`edit_token` (`20260805155901_vendor_portal.sql:50-51`, with an expiry column) is likewise
referenced by **no code at all** — only by the migration that defines it and by the service
comment explaining why it must not leak. The authentication mechanism the service protects
does not yet exist.

## §6 Owner

**`unowned — gap`.** Two charters claim this module outright and neither defers.

- [[procurement-vendor-network-charter]] lists `vendor-portal | 2` in its owned-routes
  table (`:39`) and calls itself *"the only Engineering team whose defects move money to
  third parties … It also owns the **only outward-facing portal**, which means it has a
  second class of user the rest of Engineering does not have"* (`:47-52`).
- [[supplier-distributor-network-charter]] claims *"**The vendor portal** as a relationship
  surface: `apps/api-gateway/src/vendor-portal/`, surfaced at `/v/:slug`"*
  (`:79-80`) — but under a line it explicitly labels *"Proposed line — for the founder to
  ratify or overrule, not for us to assume"* (`:59`), while flagging itself as
  *"openly flagged as the highest duplication risk in the Product division … open as
  **PROD-F2**"* (`:38-39`).

The department charter above it repeats the claim
(`partnerships-integrations-charter.md:45`). The same charter also states the honest
version of the seam for the neighbouring modules: `vendor-catalogue` and
`distributor-discovery` are *"**shared** … cited by both, owned cleanly by neither. That is
itself a finding"* (`supplier-distributor-network-charter.md:88-90`). It does not extend
that sentence to `vendor-portal`; on the evidence, it should. Gap row belongs in
[[SOFTWARE-MAP]].

## §7 Maturity & seams

[[vendor-public-page]] §10 grades the **screen** `partial`, and that grade is right for what
it covers: the read path is careful, correctly scoped, and better reasoned than most of the
repo. Rolled up to the **software**, the verdict is **hollow** — because a publishing
product with no way to publish is not a partial product.

What is genuinely good, and worth copying elsewhere:

- explicit column lists rather than `select("*")`, with the reason written down
  (`vendor-portal.service.ts:36-44`)
- unpublished and missing both 404, to prevent draft-page enumeration (`:63-67`)
- listings scoped by a `page_id` resolved from the slug — no caller-controlled id, no
  cross-vendor join (`:59-60,74`)
- the negotiated-price boundary holds: restaurant-scoped rates live in
  `vendor_price_observations` and never appear here (`vendor-portal.controller.ts:11-13`)

Seams:

1. **No writer, for either table or for `edit_token`** (§5). Every capability below is
   therefore unexercised, and every screenshot of this page is of a page that cannot exist.
2. **Two implementations of one JSON-LD contract, already diverged.** The server emits
   `countryOfOrigin`, `size` as a `QuantitativeValue`, and `eligibleQuantity`
   (`vendor-portal.service.ts:140-166`); the client-injected copy omits all three
   (`VendorPortal.tsx:131-150`). The server one has no consumer.
3. **The SEO payload requires JavaScript** — JSON-LD and `document.title` are set after
   fetch (`VendorPortal.tsx:115-158`), so a non-rendering crawler sees the SPA shell.
   `GET /vendor-portal/:slug/jsonld` exists and is `@Public()` and nothing wires it into
   served HTML.
4. **Zero telemetry.** The one page whose entire purpose is external reach cannot report a
   single visit ([[vendor-public-page]] §5).
5. **No platform attribution and no sign-up path** — the growth loop this page exists to
   create has no hook on it.
6. **No pagination** — the whole catalogue arrives in one payload
   (`vendor-portal.service.ts:69-77` has no limit).
7. **Contested ownership** (§6).

## §8 Where it's going

- ADR 0049 §3a: **Vendor** division, phase **E1**; `vendor-portal` and the
  `vendor-public-page` page are both named (`04-specs/ECOSYSTEM-PLAN.md:55`).
- The blocking question is not SEO or telemetry — it is **who creates a portal page, and
  how they authenticate**. `edit_token` is a column with no code; that is the fork.
- [[supplier-distributor-network-charter]] narrows the security assignment correctly: the
  residual risks SEC-2 named are **slug enumeration and unpublished-page leakage**, not
  signature verification, and publish-state is a relationship property.
- PROD-F2 (§6) has to resolve before this software has an owner to assign that work to.
