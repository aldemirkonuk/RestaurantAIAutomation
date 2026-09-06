---
type: page
route: /providers
slug: providers
softwares: [vendor-directory, global-vendor-search]
component: apps/web/src/pages/Providers.tsx
audience: owner
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[distributors]]", "[[promotions]]", "[[vendor-prices]]", "[[orders]]"]
---

# /providers — vendor roster + distributor discovery

> **Part of** [[08-softwares/vendor-directory|Vendor Directory & Intel]] · [[08-softwares/global-vendor-search|Global Vendor Search]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Add provider** → (modal) → API `POST /api/v1/providers`, then
  `PUT /api/v1/vendor-terms/:providerId` for the delivery days (ADR 0116).
  Same on **Edit provider**. The two calls are deliberately decoupled: the
  provider is already saved by the time the terms are written, and a terms
  failure is reported as itself rather than as "failed to add provider"
- **Record what they said** (Terms section of the redesign's TwinSheet) → API
  `PUT /api/v1/vendor-terms/:providerId` (founder's decision 2026-09-04: the terms
  register is reachable on the vendor's own row, not only in [[settings]]). Anyone
  signed in may write; the author is filed by the gateway from the JWT
  (`vendor-terms.controller.ts:29-35,91-98`) — recorded, not restricted
- **Every vendor's terms** (same section) → [[settings]] `/settings?tab=vendor-terms`
- **View orders** (row menu) → [[orders]] `/orders?provider=<id>`
- **Discover tab** → renders the [[distributors]] map inline (no route change)
- **Email vendor** → (QuickGmailModal on this page)
- **Call** → external `tel:<phone>`
- **Open website** → external vendor site
- **Address** → external Google Maps search

## 1. Purpose
Owner/manager vendor hub with two tabs (`Providers.tsx:146`): **mine** — the
restaurant's vendor roster with contacts, locations, orders, intelligence panels and
export; **discover** — the U.S. distributor catalogue on a map, one-tap add (S13).

## 1a. Features
- **Mine** tab: your vendor roster — add, edit, delete vendors; manage each vendor's contacts and locations
- Vendor intelligence panels: knowledge, promotions, conversation memory, sentiment
- Email a vendor from the page (Quick Gmail modal)
- See each vendor's orders
- Search the vendor catalogue and add a vendor with one tap (duplicates detected)
- **Discover** tab: the U.S. distributor catalogue on a map with facet filters and one-tap add
- Export; contextual insights rail
- 🚧 No link to `/vendor-prices` price comparison — that page is unreachable from here (§9)
- **Vendor terms on the vendor's row** (redesign only, TwinSheet §Terms): the five terms
  — closes / delivers / will not go below / lead time / payment — each showing its source
  (stated by the house · on the vendor record · inferred with the receipt count and
  confidence · unknown with the reason), editable in place. A value the gateway cannot tell
  apart from its column default is rendered as UNKNOWN with that reason, never as a term
- **A new vendor is a SHEET on the rebuilt page, and its duplicate check a PANEL**
  (built 2026-09-06, packet 2 of the overlay layer; census 102 · ADR 0112).
  `pages/providers/next/NewVendorSheet.tsx` and `VendorTwinPanel.tsx`, opened by
  *Add a vendor* in the masthead. Until they landed the rebuilt page could read the
  book and open one vendor's twin, and could not add one — the legacy page split the
  act across THREE modals (`VendorSearchModal.tsx:161` search the catalogue,
  `AddProviderModal.tsx:361` a vendor of your own, `:629` invent a business type).
  The vendor being added is one object however it was found, so it is one sheet.
  - **Two doors, one object.** From the catalogue: `searchVendorCatalogue` →
    `addProviderFromCatalogue` (`POST /providers { catalogue_vendor_id }`), one press
    and nothing typed twice. Or a vendor of your own: `POST /providers` with the
    legacy field set entire — name, both contact names, phone, email, website,
    address, account number, type, specialties, payment terms, minimum order, notes.
  - **The delivery days and the address are separate acts, and are reported
    separately.** `PUT /vendor-terms/:providerId` is the only place in the schema
    that can hold delivery days with a person's name attached, and coordinates live
    in `provider_locations`, not on the provider row — a vendor added without one is
    permanently unpinnable. Both are decoupled from the create exactly as
    `pages/Providers.tsx:518-573` decoupled them: the vendor is already saved, and a
    terms failure must never present as *failed to add vendor*. That silence is how
    the original delivery-days defect stayed invisible for a year.
  - **Payment terms are not defaulted.** Empty means unstated. Seeding *Net 30* would
    refill the column default migration `20260903170000_a_default_is_not_an_answer.sql`
    dropped, from the browser.
  - **Four states on the catalogue search**, and the fourth is the one that matters: a
    catalogue that could not be READ says so. An empty list drawn for a thrown request
    tells a person the vendor is not in the catalogue when nobody looked.
  - **The duplicate question refuses the save while it is unanswered** and never merges
    anything — orders, invoices and letters all point at one `provider_id`. It reads
    the same `useDuplicateVendorCheck` both legacy forms used, so the two can never
    disagree about what a duplicate is. Its confidence figure NAMES WHAT IT MEASURED
    (the hook takes `max(name, address)`, which are different claims); the legacy card
    printed a bare percentage.
  - **The rating stays with the person.** It goes to `providerRatings` in user
    preferences, where the legacy page kept it (`pages/Providers.tsx:289-292`) — it is
    an opinion, not a fact about the vendor, and it never belonged on the row.
  - Proved by `NewVendor.test.tsx` (17 assertions). The pre-packet `ProvidersNext.tsx`
    contains zero references to the act.
- **Mudavym redesign behind `mudavym_design_providers` (OFF)**: a quiet grid of small, closed vendor buckets (≤3 real facts each: open orders · lead time · last contact) with the digital twin held back in a right-hand TwinSheet, fetched on open

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_providers`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/providers/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `pv-sheet-settle` | The sheet settles in | TwinSheet opening from a bucket card — now the house `Sheet`'s `tuck` (spring 380/32, 300ms, 28px travel); the hand-rolled `settle`/24px variant is retired (ADR 0112) |
| `pv-card-ink` | Ink micro-state | bucket-card hover/focus — border to seal ring, one paper step; nothing moves |
| `pv-newvendor-tuck` | The vendor composer opens | *Add a vendor* opens the house `Sheet` on `tuck`; the duplicate question opens over it on `settle` at z-index 140. Neither adds a motion of its own, and `prefers-reduced-motion` renders none |

Deliberate non-motions: no card stagger (a roster is a reference, not an
arrival), no count tallies, instant sheet close. **The Terms section adds no
motion**: a register that animates while you read a cutoff off it is a register
that is harder to trust, and its open/close is the sheet's own `tuck`.

### Design used, and why (ADR 0045 §5 wave · MAKEOVER-VERDICTS: MERGE)

The founder liked **today's page** for its small-buckets calm ("less crowded")
and the **redesign** for its digital twin — and flagged the crowding as the
failure mode. The build enforces the reconciliation structurally: the card
*promises less* (name, type, three facts all real — open orders counted from
the orders book, `leadTimeDays`, `lastContactDate`), and everything learned
lives in the sheet via `ProviderIntelligencePanel`, lazy-fetched on open so
the grid never pays for the twin. Honesty rules carried from OrdersNext: an
unreachable orders book renders open-order counts as em dashes with a line
saying so — never zeros; a never-contacted vendor says "never contacted".
Legacy page untouched; flag defaults OFF; per-browser override
`mudavym.design.providers`. One ask deliberately substituted, disclosed: the
verdict's example behavioural fact ("confirms in 6 hours", "ships Tuesdays")
has no backing field on `interface Provider`, so the card carries
`lastContactDate` instead — a real fact, not an invented behaviour; the
learned behaviours stay in the sheet's intelligence panel. A second known
coherence gap: that panel renders in the legacy grey/blue skin inside the
İznik sheet — filed in §9 and v3.0-TECH-DEBT rather than hacked over with
CSS overrides.

### Modal shape, 2026-09-03 (ADR 0112)

**TwinSheet is a `Sheet`** — the house's right slide-in, for one object's record.
Its own overlay is deleted: the inline scrim, the `pv-sheet-in` keyframes and its
private Esc handler are gone, replaced by `components/mudavym/Sheet.tsx`, which
adds the three things it never had — a focus trap, focus returned to the card you
opened it from, and a body-scroll lock. The component is 186 → 110 lines and what
is *inside* the sheet is unchanged, line for line.

Still legacy on this page, and honestly so: **Add provider** at §Surface line 24
is `components/providers/AddProviderModal.tsx` → `VendorSearchModal.tsx`, both
still the legacy white-and-wine dialogs. They are reachable from the LEGACY page
only (`pages/Providers.tsx`), so nothing a Mudavym reader sees is mixed — but if
the rebuilt page ever grows an Add control, it needs a `Panel` first. And
`ProviderIntelligencePanel` inside the sheet is still the grey/blue skin, as §9
already records.

### Terms on the vendor row, 2026-09-04 (founder's decision)

**What was asked.** Vendor terms (cutoffs, delivery days, minimums, payment
terms) must be reachable from `/providers` on the vendor's own row, not only in
`/settings`.

**What was built.** `pages/providers/next/TermsSection.tsx`, rendered inside
`TwinSheet.tsx:90-93` between the vendor's own record and the learned twin, fed
by `pages/providers/next/useProviderTerms.ts`. It is **one register with two
doors**, not a second store: the same rows, the same routes, and the settings
section's own formatters imported from `pages/settings/next/st-format.ts`
(`fmtCutoff`, `fmtWeekdays`, `fmtMoney`, `fmtWhen`, `SOURCE_LABEL`,
`WEEKDAY_INITIALS`) rather than forked, so a cutoff cannot read one way here and
another way there. A link at the foot goes to `/settings?tab=vendor-terms` for
the whole house.

**Honesty, as measured by the tests.** Every cell branches on `source`, so no
path prints a value without provenance under it; a value indistinguishable from
its column default arrives `source: 'unknown'` and renders as an em dash with the
gateway's reason on the row itself (not only in a `title=`, which a
non-hovering reader never sees); an unreadable register is words naming what
could not be read, and a partially-read one names the specific book
(`sources.statedTerms` / `sources.orders`); a 403 is said as permission, not as
absence; a write whose audit row failed says so rather than letting the trail be
assumed. Only touched fields are sent, because the gateway reads an explicit
`null` as *withdraw* and a missing key as *leave alone*
(`vendor-terms.dto.ts:15-26`).

**Who may write.** Anyone signed in — the founder's call, and the controller's
(`vendor-terms.controller.ts:29-35`). The author is taken from the JWT by the
gateway and never sent by this form.

**What is NOT built, and why.** The section reads the WHOLE house register and
picks one row, because `GET /vendor-terms` is the only read route that exists —
see §9 for the additive one-provider patch, which was written up rather than
applied (`apps/api-gateway/src/vendor-terms/**` belonged to another builder this
pass). Notes are not editable here (the field exists on the DTO; the row already
has more controls than a sheet should carry — it stays in the settings
register). The link is a plain `<a>`, so it costs a full page load; a
`react-router` `Link` would need the sheet's tests to mount a router.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/providers`** — The twin sheet is built and carries the vendor's terms. Adding a vendor is owed: the catalogue search, the custom vendor and the duplicate check are one sheet and one question.

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/providers` | The vendor's twin | sheet | Built | One vendor, opened from the list you can still see. | `pages/providers/next/TwinSheet.tsx:68` |
| `/providers` | A new vendor | sheet | Built | The vendor being added is one object; the old page split it across three modals. BUILT 2026-09-06 (packet 2): both doors in one sheet, the legacy field set entire, and the delivery days and the address written as SEPARATE acts that are reported separately — a terms failure never presents as a failed create. | `BUILT 2026-09-06 as pages/providers/next/NewVendorSheet.tsx (was AddProviderModal.tsx:361 + :629 and VendorSearchModal.tsx:161)` |
| `/providers` | A vendor you already have? | panel | Built | A question with two answers before a write. BUILT 2026-09-06: it refuses the save while unanswered, never merges two records, and its confidence figure names WHICH similarity it measured rather than printing a bare percentage. | `BUILT 2026-09-06 as pages/providers/next/VendorTwinPanel.tsx (was components/providers/VendorMatchModal.tsx:108)` |
| `/providers` | Edit provider | — | Retires | The twin sheet's edit half; terms on the row. | `components/providers/EditProviderModal.tsx:678` |
| `/providers` | Send message | — | Retires | The composer (letters); the text sender is ADR 0121. | `components/providers/SendMessageSlideOver.tsx:319` |
| `/providers` | Provider card | — | Retires | The twin sheet. | `pages/Providers.tsx:1355` |
| `/providers` | Add provider type | — | Retires | A field inside the new-vendor sheet. | `components/providers/AddProviderModal.tsx:629` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

## 2. Entry
Sidebar item (`components/layout/Sidebar.tsx:87`). `/distributors` redirects here with
`?tab=discover` (`App.tsx:271-274`). PAGE_MAP records an outbound edge providers→orders
(`PAGE_MAP.md:85`).

## 3. Files
- Route: `apps/web/src/App.tsx:264` → `pages/Providers.tsx` (1,484 lines)
- Discover tab lazy-loads `pages/distributors/command/DistributorMapPage.tsx`
  (`Providers.tsx:150-151`, rendered `:661`) + `pages/distributors/useDistributorsPage.ts`
- Modals/panels: `components/providers/AddProviderModal.tsx`, `EditProviderModal.tsx`,
  `VendorSearchModal.tsx`, `ProviderIntelligencePanel.tsx` (→ Knowledge/Promotions/
  ConversationMemory/Sentiment panels), `components/emails/QuickGmailModal.tsx`,
  `components/insights/ContextualInsights.tsx` (imports `Providers.tsx:43-52`)

## 4. Endpoints
- `GET/POST/PUT/DELETE /providers[/:id]` — `services/api/providers.ts:201-236` via hooks
  (`Providers.tsx:28`); ENDPOINTS.md providers module
- Contacts CRUD `/providers/:id/contacts[/:contactId]` (`providers.ts:243-283`)
- Locations CRUD `/providers/:id/locations[/:locationId]` (`providers.ts:456-498`)
- `GET /orders` via `useOrders` (`Providers.tsx:28`)
- Catalogue: `GET /vendor-catalogue/search` (`services/api/vendors.ts:74`) and add-from-
  catalogue `POST /providers` (`vendors.ts:121,131`) via `VendorSearchModal` and, since
  2026-09-06, `pages/providers/next/NewVendorSheet.tsx` — the rebuilt page's own composer,
  which also calls `POST /providers`, `PUT /vendor-terms/:providerId` and
  `POST /providers/:id/locations` as three separately-reported acts
- Duplicate check: `GET /vendor-catalogue/match` and `POST /providers/match`
  (`hooks/useDuplicateVendorCheck.ts`) — read by the composer, answered by
  `pages/providers/next/VendorTwinPanel.tsx`
- Discover: `GET /distributors/search`, `/distributors/facets`, `/distributors/:id`
  (`services/api/distributors.ts:158-173`; ENDPOINTS.md:210-216)
- Terms (redesign only): `GET /vendor-terms` and `PUT /vendor-terms/:providerId`
  (`apps/api-gateway/src/vendor-terms/vendor-terms.controller.ts:44,71`) via
  `pages/providers/next/useProviderTerms.ts`. The GET is house-wide — there is no
  per-provider read route (§9)
- Intelligence panel: `GET /providers/:id/promotions`, `/providers/promotions/active`,
  `/expiring`, `/savings` + knowledge/conversation-memory
  (`services/api/provider-intelligence.ts`; ENDPOINTS.md:450-459)

## 5. Signals
none. (Realtime dispatch consumed via `useRealtimeDispatch`, `Providers.tsx:52` —
inbound updates, not emitted telemetry.)

## 6. Tier cut
Core — S13 (new vendor discovery & onboarding: catalogue search, one-tap add, 409
dedupe are the ✅ Core row). Also touches S02 (vendor scorecard adjacency) and S08
(price-drift entry via intelligence panel). See TIER-MAP S13.

## 7. Rebrand surface
none — no user-visible `WineOps` strings (grep of `Providers.tsx`: zero hits).

## 8. State & config
- `?tab=discover|mine` URL param drives the tab (`Providers.tsx:229-237`)
- `useUserPreferences` for per-user view prefs; auth store for restaurantId
- No feature flags

## 9. Gaps

**Open 2026-09-04 — there is no one-provider read of the terms register.**
`GET /vendor-terms` (`vendor-terms.controller.ts:44`) answers with every vendor's
terms for the tenant, and `VendorTermsService.read` (`vendor-terms.service.ts:257`)
computes inferences for all of them. The provider row therefore fetches the whole
house register and filters client-side, which is correct but wasteful on a house
with many vendors, and it means one slow vendor's inference delays the sheet.
**The patch was NOT applied** — `apps/api-gateway/src/vendor-terms/**` belonged to
another builder this pass — so it is written here instead:

```ts
// vendor-terms.controller.ts — additive, alongside the existing @Get()
@Get(":providerId")
@ApiOperation({ summary: "One vendor's terms, with where each field came from" })
async readOne(
  @CurrentUser("restaurantId") restaurantId: string,
  @Param("providerId") providerId: string,
): Promise<VendorTermsRow> {
  if (!restaurantId) throw new HttpException(
    "This session is not attached to a restaurant, so there are no vendor terms to read.",
    HttpStatus.BAD_REQUEST);
  // requireProvider is already the tenant-scoped row filter the write uses
  // (vendor-terms.service.ts:784) — a provider of another house is 404, not empty.
  const readout = await this.terms.read(restaurantId);
  const row = readout.vendors.find((v) => v.providerId === providerId);
  if (!row) throw new NotFoundException(
    "That vendor does not belong to this restaurant.");
  return row;
}
```

That shape is honest but not yet cheaper — it still computes the whole readout.
The cheaper version needs `VendorTermsService.read` to take an optional
`providerIds` filter threaded into `readProviders`/`readStated`/`readOrders`, plus
a jest spec asserting a provider of another tenant 404s and that the filtered read
returns the same row as the unfiltered one. Route order matters: `@Get(":providerId")`
must not shadow anything, and the register's own client
(`pages/settings/next/useSettingsNextData.ts:470`) must keep using the list route.

**Closed 2026-09-04 — ADR 0116. The delivery-days picker wrote into the
geography column, and had since it was built.** `AddProviderModal.tsx:820`
collected weekdays; `pages/Providers.tsx` sent them as `statesOrRegionsServed`;
`services/api/providers.ts` mapped that to `regionsCovered`; the gateway wrote
`providers.regions_covered` (`providers.service.ts:199`) — the column the
provider map and the territory filters read. The sibling `deliverySchedule`
field was declared on the web DTO (`services/api/providers.ts:88`) and never
reached `mapProviderToApiPayload`'s output, so it was dropped on the floor.
**And `EditProviderModal.tsx:324` read `regionsCovered` back INTO the picker**,
so opening the dialog and saving wrote the weekdays again — the defect
round-tripped through its own UI.

Now: the picker writes `PUT /vendor-terms/:providerId` and nothing else, the
edit dialog seeds from `GET /vendor-terms`, and when that register cannot be
read the picker is **disabled with the reason in words** and the page skips the
write — an empty selection is itself a statement ("no fixed days") this page
would otherwise save. Mapping and payload pinned in
`services/api/vendorTerms.test.ts` (9 cases).

**Not cleaned up, on purpose.** Whatever weekday names are already in
`regions_covered` are still there. `regions_covered` is free text and a "Sunday"
in it cannot be proven a picker artefact rather than a place somebody meant —
Sunday is a town in Louisiana — so removing one would destroy a row of somebody's
data on an inference. `scripts/list_weekdays_in_regions_covered.py` lists every
affected row with the value it would leave behind, and has **no `--apply`**. The
rows are the founder's call.

**Also closed here: the form no longer seeds `paymentTerms: 'Net 30'`.** Both
dialogs defaulted the field to Net 30 in the browser, so every provider saved
through them asserted terms nobody chose — the same fabricated answer
`providers.payment_terms DEFAULT 'Net 30'` used to write, moved client-side. It
would have refilled the column on every save after migration `20260903170000`
dropped the default. Both now default to `''` with an explicit "Not stated"
option.

- TwinSheet's intelligence panel renders in the legacy grey/blue skin inside
  the İznik sheet (`ProviderIntelligencePanel` is a shared legacy component) —
  the founder's "set does not cohere" complaint, reproduced in miniature;
  re-skin filed in v3.0-TECH-DEBT rather than patched with CSS overrides.
- TIER-MAP S13 Pro: "discovery is catalogue-first, **comparison routes unreachable**" —
  this page never links to `/vendor-prices` (see [[vendor-prices]] §2).
- `v3.0-TECH-DEBT.md:391-393` (44.15) claims no bulk select / column sorting on
  providers — flagged there as a stale catalog needing reconciliation before action.
- S13 Plus coverage metrics "denominator flatters without POS" (TIER-MAP S13) — the
  discover tab shows catalogue reach, not supply-graph truth.

## 10. Maturity

**partial.** The roster half is complete and correct. The intelligence half renders
panels over five tables whose only writer is a single Python agent, and the page never
links to the comparison surface built for it.

| Evidence | `path:line` |
|---|---|
| **Roster CRUD is complete** — providers, contacts and locations all have real create/read/update/delete routes under a class-level `JwtAuthGuard`. | `providers.controller.ts:37-38,188-303,361-436,573-656` |
| **Catalogue add is real**, including the 409 dedupe that S13 Core claims. | `vendor-catalogue.controller.ts`; client `services/api/vendors.ts:121,131` |
| **Discover tab is real** — `GET /distributors/search` runs the `search_distributors` RPC over `vendor_catalogue` joined to `vendor_locations`, `vendor_service_territories` and `vendor_portfolio_facets`. | `distributor-discovery.controller.ts:34-89`; `distributor-discovery.service.ts:84,177-204` |
| **The intelligence panels depend on one Python agent.** `provider_knowledge`, `provider_sentiment_history`, `conversation_embeddings` and `provider_conversation_sessions` are each written by exactly one file — `provider_conversation_agent.py` — reachable only via the orchestrator's registry and a Level-4 feature flag. If that agent is not running for a restaurant, all four panels render empty and the page gives no indication why. | writers `agents/provider_conversation_agent.py:1453,2216,1160,754`; registry `core/orchestrator.py:181,297`; flag `config/settings.py:193`; readers `provider-intelligence.service.ts:18,251,304,355` |
| **The Promotions panel now has a live producer** — the D3 lane extracts deterministically from provider-matched inbound mail into `provider_promotions`, on every message, plus a 09:00 digest cron. (Supersedes the "dormant" note carried in memory and in [[promotions]] §9.) | `common/orchestrator/promotion-extractor.service.ts:37-60,179`; wiring `rabbitmq-bridge.service.ts:789-799` |
| **Never links to [[vendor-prices]]** — the price-comparison page built for exactly this job is unreachable from the vendor hub, which TIER-MAP S13 Pro names as a defect. | §9 of this note; [[vendor-prices]] §2 |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET/POST/PATCH/DELETE `/providers[/:id]` | JWT (class) | `providers.controller.ts:215,231,188,251,277` | roster CRUD |
| `/providers/:id/contacts[/:cid]` (4 verbs) | JWT | `:361-436` | contact CRUD |
| `/providers/:id/locations[/:lid]` (4 verbs) | JWT | `:573-656` | location CRUD |
| GET `/providers/:id/orders`, `/performance`, `/recommendations` | JWT | `:303,317,464` | order history, scorecard, ranked providers |
| GET `/providers/:id/knowledge`, `/knowledge/contradictions` | JWT (class) | `provider-intelligence.controller.ts:32,49` | `provider_knowledge` facts + conflicts |
| GET `/providers/:id/promotions`, `/promotions/active`, `/expiring`, `/compare`, `/savings` | JWT | `:87-146` | `provider_promotions` |
| GET/POST `/providers/:id/conversation-memory[/search]` | JWT | `:163,185` | `conversation_embeddings` |
| GET `/providers/:id/sessions[/:sid/summary]`, `/sentiment` | JWT | `:212,232,249` | session + sentiment history |
| GET `/vendor-catalogue/search`; POST `/providers` | JWT | `vendor-catalogue.controller.ts` | catalogue search, add-with-dedupe |
| GET `/distributors/search`, `/facets`, `/:id` | JWT (class) | `distributor-discovery.controller.ts:39,64,89` | map results, facet counts, detail |
| GET `/analytics/insights/:rid` via `ContextualInsights` | **JWT required, none sent** → 401 | `analytics.controller.ts:243` | nothing — same defect as [[orders]] and [[inventory]] |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Vendor roster | manual entry + one-tap add from the catalogue + prospect promotion on [[promotions]] | `providers.controller.ts:188`; `common/orchestrator/prospects.controller.ts` |
| `vendor_catalogue` (discover tab) | seeded corpus | `supabase/migrations/seed/27_vendor_catalogue_seed.sql`; geo migrations `20260807001252/001352/001452` |
| `provider_promotions` | **D3 inbound-email lane**, live on every provider-matched message | `promotion-extractor.service.ts:37`; `rabbitmq-bridge.service.ts:789` |
| `provider_knowledge`, `provider_sentiment_history`, `conversation_embeddings`, `provider_conversation_sessions` | `ProviderConversationAgent` only, behind a Level-4 flag | `agents/provider_conversation_agent.py`; `config/settings.py:193` |
| Order history / performance | POs from [[orders]] | `procurement_orders` |

**Finding:** four of the six intelligence panels have a **single-agent, flag-gated
producer**. That is not "no producer", but it is a producer that can be off without any
signal on the page — the panels degrade to empty, which reads as "this vendor is quiet".

### Writes

| Write | Lands in | Downstream |
|---|---|---|
| Add / edit / delete provider | `providers` | [[orders]] vendor picker, [[promotions]] prospect promotion target, invoice matching |
| Add from catalogue | `providers` (409 on duplicate) | as above |
| Contacts / locations CRUD | `provider_contacts`, `provider_locations` | outbound mail routing, territory checks |
| Rate a provider (`POST /providers/:id/rate`) | provider score | scorecard |
| Quick Gmail send | `communications` | vendor thread on [[orders]] |

## 12. Design intent

**Should be:** the supply graph — who we buy from, what we know about them, what they
have offered lately, and who else could sell us the same bottle for less.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | react-query flags |
| empty | ⚠️ — roster empty state is fine; the four intelligence panels render empty with no explanation of *why* (agent off vs genuinely nothing) | `provider-intelligence.service.ts:18-355` returns `[]` for both |
| error | ⚠️ partial | CRUD mutations toast; the insights rail swallows its 401 |
| permission-denied | ❌ | one owner-shaped view; the intelligence endpoints are guarded server-side but nothing adapts client-side |

**Where the UI misleads:** an intelligence panel that is empty because
`ProviderConversationAgent` never ran is indistinguishable from one that is empty because
the vendor has been silent. That is the mildest form of the §44.2 shape, but it is the
same shape.

## 13. Roadmap

0. **Narrow the terms read to one provider** — the additive gateway patch in §9, plus
   the `providerIds` filter that would make it actually cheaper. *Blocker: none once
   `apps/api-gateway/src/vendor-terms/**` is free.*
0a. **Terms notes on the provider row.** `notes` is on the DTO
   (`vendor-terms.dto.ts:86-90`) and read back in the readout, but the sheet does not
   edit it — deliberately, to keep the row from becoming a form. Revisit if the founder
   asks for it.
0b. **Make the whole-house link a router navigation** rather than an `<a>` full load.
1. **Link to [[vendor-prices]] from the provider row and from a wine's provider list.**
   The comparison page exists, is guarded, and is unreachable — this is the single
   highest-value edge missing in the vendor cluster, and TIER-MAP S13 Pro already names
   it. *Blocker: none.*
2. **Give the four agent-fed panels a distinct empty state** — "no conversation history
   yet" vs "vendor intelligence is not enabled for this restaurant". *Blocker: needs the
   flag state exposed to the client; `config/settings.py:193` is server-side only.*
3. Move `ContextualInsights` to `apiClient` (shared fix with [[orders]] §13.3 and
   [[inventory]] §13.1).
4. Reconcile the stale 44.15 bulk-select/column-sort claim against the real page rather
   than acting on the catalog (`v3.0-TECH-DEBT.md:391-393`).
5. Emit signals: this page has zero markers and is the entry point for S13, whose Plus
   tier is scored on coverage the page cannot currently measure.
6. Fold `pages/distributors/useDistributorsPage.ts` into the discover tab or keep it
   deliberately — today it is a standalone page hook with one consumer (§9 of
   [[distributors]]).

7. **The Terms panel no longer assumes dollars** (done 2026-09-05, ADR 0117 Q25).
   `TermsSection.tsx` read `reg?.currency.code ?? 'USD'`, which was the only
   honest reading while `restaurants.currency` carried `DEFAULT 'USD'` — and
   which told a London house its vendor's minimum was in dollars. The default is
   dropped (`20260905120000_a_house_names_its_money.sql`), so `code` can now be
   `null`: the minimum-order field is labelled "(currency not recorded)" and
   `fmtMoney` prints the number unsymboled. Nothing here can SET the currency;
   today the only place it is asked is the sign-up form ([[register]] §1a).
