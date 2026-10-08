---
type: page
route: /vendors
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

# /vendors (was /providers) — vendor roster + vendor discovery

> [2026-09-25, lane W3-vendors, ADR 0221: the page's address is `/vendors` and its
> name everywhere the house reads it (rail, header, sidebar, command palette,
> shortcuts sheet, tours, help guide, the page's own heading) is **Vendors**.
> `/providers` and `/distributors` redirect to it for good, carrying the rest of
> the path, the query (`?vendor=<id>`) and the hash (`apps/web/src/lib/renamedRoute.tsx`);
> `/distributors` adds `tab=discover` when the link did not name a tab. What did
> NOT move: the page slug and flag (`providers`, `mudavym_design_providers`), the
> code paths under `pages/providers/`, the gateway's `/providers` API and every
> table and column. The rest of this note predates the rename and says
> `/providers` where it means this page.]

> [2026-09-26, lane W4-vendors-filters, ADR 0221 — two founder answers (founder,
> 2026-09-26, round 6), built on #481. The bracket for ADR 0221 itself is owed by the
> records lane (#466 holds that file; see the PR body for the text).
> **Shortcut** — asked "Command palette: the 'go to vendors' shortcut is still 'g p'
> (providers). Change it?"; chosen **"'g v', keep 'g p' working (Recommended)"** ("New
> letter matches the word; the old one still works so nobody's habit breaks."). Rejected:
> "Keep 'g p' only" ("No change."). Built: `GOTO_MAP` has `v` and `p`, both `/vendors`;
> the palette entry shows `g v`; the shortcuts sheet says "g then w / r / v … (g then p
> still works)" (`components/command/commands.ts`, `ShortcutsSheet.tsx`); pinned through
> the real key handler by `CommandProvider.goto.test.tsx`.
> **The word "distributor"** — asked "'distributor' is also the legal term for the licensed
> wholesaler in the three-tier system (e.g. /connections: 'Licensed distributors'). Rename
> those to 'vendor' too?"; chosen **"Keep the legal term (Recommended)"** ("Everywhere we
> mean 'who I buy from' says vendor; 'distributor' stays only where it names the licensed
> tier, since that's a real legal distinction."). Rejected: "Vendor everywhere" ("One word
> across the whole product."). Verified on the rendered (Mudavym) pages: the one remaining
> "who I buy from" use, /receiving's "provable from the distributor's own packing slip"
> (`receiving/next/RcOwnerLedger.tsx`), now says vendor's. Kept as the licensed tier:
> /connections "Licensed distributors" (`DistributorFeedPanel.tsx`), and the business-type
> value "Distributor" beside Importer / Wholesaler (`VendorCatalogueCard.tsx`, the add/edit
> vendor forms). Legacy-only copy (`Providers.tsx` "Find Distributors", `Settings.tsx`,
> the legacy /communications filter "All distributors") is left for ADR 0149's cutover
> delete, as #481 already left it.]

> [2026-09-26, lane W4-vendors-filters, ADR 0221 — house-first scopes (founder,
> 2026-09-26, filters round, memory item 36), stacked on #481 as `feat/vendors-scopes`.
> Asked "/vendors: open on 'Supplies my menu' (built from what you've actually bought:
> price history, orders, inventory), then 'All my vendors'. Should there be an outer rung
> 'Find new vendors' that searches the curated vendor catalogue we already have?";
> chosen **"Yes, add 'Find new vendors' (Recommended)"** ("Uses the existing curated
> catalogue search. This is not the shared-vendor layer ADR 0221 deferred."). Rejected:
> "No, my vendors only" ("Discovery stays on its own page for now."). Same round, for both
> pages: **"Widen + banner; show partial (Recommended)"** for a house with no menu.
> Built: a scope bar **Supplies my menu · N → All my vendors · N → Find new vendors · N**
> with live counts (an em dash, never a zero, when a count is unknown), state in `?scope=`,
> and `?tab=discover` (the `/distributors` redirect) landing on Find new vendors.
> *Supplies my menu* = `GET /providers/menu-supply` (`vendor-menu-supply.ts`): the house's
> vendors with purchase evidence — `price_history (provider_id, master_wine_id)` with
> `effective_date` in the last 180 days, lines of orders that reached the vendor
> (`ORDER_ARRIVED_STATUSES` ∪ `ORDER_OPEN_WITH_VENDOR_STATUSES`, house read off the order),
> and live `restaurant_inventory.provider_id` — intersected with the `wine_library_id`s of
> the non-discarded lines of every ACTIVE menu (more than one is unioned). Every read is
> `.eq` the caller's house and keyset-paged (no 1000-row cap). The card is tagged ("3 wines
> on your menu · priced, ordered"); the rung hides cards, never re-orders them. No active
> menu, a menu whose lines link no wine, or a failed read → the page opens on *All my
> vendors* with a banner that says which; choosing the menu rung then says why it cannot
> answer instead of drawing an empty list. *Find new vendors* = the curated
> `vendor_catalogue` search (`GET /vendor-catalogue/search`, curated tier only) with its
> total, a country field (opens on US, as the old add-vendor modal did — not derived from
> the house **[CORRECTED 2026-09-26, lane W5-vendors: superseded by founder item 48 — it
> now opens on the house's own country; see the next bracket]**), "In your vendors" for catalogue rows already linked, and "Add to my vendors"
> through the existing `POST /providers {catalogue_vendor_id}`. Not built: the shared-vendor
> layer and world map (ADR 0221 "later"); the licensed-territory discovery
> (`/distributors/search`) — it remains the legacy page's map.
> Guard change: `check_price_history_reads_group_by_unit.py` gains a narrow PRESENCE-read
> arm (a literal projection naming no price, quantity, `*`, embed or runtime list), with
> self-test cases both ways, because this read uses price_history as purchase evidence and
> reads no price.]

> [2026-09-26, lane W5-vendors, ADR 0221 amendment — founder, round 7, item 48, as
> recorded in project memory: "'Supplies my menu' = exact vintage; a NAME-ONLY search
> (menu filter not applied) matches any vintage — implement now. Find new vendors
> defaults to the house's country (US fallback)." (The round's literal option texts were
> not preserved; ADR 0221's amendment says so and reconstructs the rejected options.)
> Built on #484: *All my vendors* gets one search box — a vendor's own name, or a wine
> they sold you — backed by `GET /providers/wine-sellers?q=` (`vendor-wine-search.ts`,
> `readOwnWineSellers`): the house's purchase evidence of ALL time (price history,
> orders that reached the vendor, live stock lines), matched by "producer name",
> accent/case-blind, every word, any vintage; each matching card is tagged "Sold you
> Opus One 2019, 2018 · priced, ordered". *Find new vendors* keeps the curated name /
> specialty search and adds, above it, curated vendors SEEN PRICING any vintage of the
> typed wine (`GET /providers/catalogue-wine-listers`, price sightings through
> `scopePriceRegisterRead` / `houseAndOpenMarket` — this house's own and openly posted,
> never another house's), each labelled Invoiced / Quoted / Listed, because a sighting is
> not a sale. A four-digit year in the query narrows to that exact vintage (a reading,
> recorded in the ADR). *Supplies my menu* is untouched (exact vintage) and has no search
> box. The country field now opens on the house's country: `restaurants.country` via
> `GET /settings/currency`, resolved to ISO-2 by `lib/countries.ts`
> (`defaultCatalogueCountry`); US when missing, unknown or unreadable, with a hint saying
> which; still editable; the catalogue is not searched until the house has answered.
> Item 49 (substitution suggestions) is a FUTURE idea — no UI.]
> [2026-09-28, #484 audit R2: a wine search needs one word of two letters or more ("a b"
> is refused), and the *Find new vendors* sightings read stops at 5000 rows with a 422
> asking for more of the name, never a partial list — ADR 0221.]

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
- **A vendor can now be BORN FROM A DOCUMENT** (ADR 0104 D15, 2026-09-11). When an incoming
  document prints a seller tax identity (VKN / TCKN / EIN / EU VAT) that no provider of this
  restaurant carries, intake creates the vendor from the printed identity — legal name, tax id,
  tax office, address, country — and flags it `provisional_until_first_order` with
  `created_from_document_id` pointing at the paper it came from. Nobody is asked. It is not a
  guess: the identity is copied from a legal document, and a partial unique index on
  `(restaurant_id, tax_id_normalized)` is what guarantees a second document from the same
  vendor finds the same row instead of making another. A document that prints no identity, a
  malformed one, or an identity with no seller name creates **nothing** — name similarity is
  not a rule here and does not become one.
- **Discover** tab: the U.S. distributor catalogue on a map with facet filters and one-tap add
- **The operational vendor scorecard** (redesign only, ADR 0207, sketch 117 A + B + C as
  the founder picked it 2026-09-21): *What they did* in the TwinSheet — on time, lines as
  ordered, price as agreed, reply time, credits recovered, each a percent with its count
  (founder, 2026-09-21) beside the prior window's own and a link to its rows; one fact on
  each card (*Did · 90 d — 86% on time · 12 of 14*); a *Book · Scorecard* switch
  (`?view=scorecard`) whose Scorecard is the Roll Call; and the Docket, a stacked sheet of
  the dated rows behind every figure. Five records everywhere before a percent (credits
  too — under five the claims are listed); on time is the house's local midnight, and an
  order past it not landed counts late; English words in the house's own formats.
  Too few, not collected and could-not-read are sentences with their counts, never a zero.
  Tone is a minor line in no figure. **No alert is built** — a labelled set and a shadow
  run come first. Files: `pages/providers/next/scorecard/*`,
  `apps/api-gateway/src/providers/scorecard/*`
- Export; contextual insights rail
- 🚧 No link to `/vendor-prices` price comparison — that page is unreachable from here (§9)
- **Vendor terms on the vendor's row** (redesign only, TwinSheet §Terms): the five terms
  — closes / delivers / will not go below / lead time / payment — each showing its source
  (stated by the house · on the vendor record · inferred with the receipt count and
  confidence · unknown with the reason), editable in place. A value the gateway cannot tell
  apart from its column default is rendered as UNKNOWN with that reason, never as a term
- **"This vendor usually invoices in"** (redesign only, TwinSheet, 2026-09-06). The
  founder, batch 65, verbatim:

  > "maybe Every vendor and their profile will show their default currency, but we won't
  > use that as the invoice... definitely invoice receipt. However, we will use the
  > currency from where we order it. We will show the user the currency the vendor always
  > uses, and they have the ability to change it or not in the orders page. And after
  > that, we will have time To make sure that the invoice is good with the order we had.
  > and we... or the user or the manager are able to change the invoice if needed. Makes
  > sense?"

  The section shows `providers.usual_currency` — an ISO 4217 code TYPED BY A PERSON —
  with who stated it and when, printed beside it. **It never files an invoice**, and the
  section says so every time it is shown: an invoice takes the currency printed on it,
  then the currency of the ORDER it is matched to, then the house's. Its one consumer is
  the order sheet, where it is the starting value.
  - **Nothing is offered as a starting value.** The field is empty for a vendor nobody has
    asked, and the sentence says the vendor has not stated one rather than leaving a
    silent box. A pre-filled value saved without reading is indistinguishable afterwards
    from one somebody thought about, which is what `usual_currency_set_by` exists to tell
    apart — so the select does not even pre-select the STORED code.
  - **Manager or owner only.** `PATCH /providers/:id/usual-currency`; staff see the
    control disabled with the sentence naming what they are and who can. A blank is
    REFUSED rather than treated as "clear it" — clearing a stated currency is a different
    act with a different consequence and it is not built.
  - **A failed read is a failure in words**, never "this vendor has stated none": the
    gateway answers 503 with the reason and the section renders it.
  - Value, author and moment are ONE fact enforced by
    `providers_usual_currency_names_its_author`; the code is shape-checked to ISO 4217
    alpha-3 so `TL`, `usd` and `$` cannot become three currencies. Migration
    `20260906170000_a_vendor_states_its_usual_currency_and_an_order_carries_one.sql`;
    no DEFAULT, nullable, nothing backfilled (the migration MEASURES that it wrote none).
  - Files: `apps/web/src/pages/providers/next/UsualCurrencySection.tsx`,
    `apps/api-gateway/src/providers/vendor-currency.ts`,
    `providers.controller.ts` (`GET`/`PATCH :id/usual-currency`, declared before
    `@Get(":id")` or Nest would never reach them), `providers.service.ts`
    (`getUsualCurrency` / `setUsualCurrency`).
- **"Usual currencies stated" — the prompt panel** (redesign only, above the grid,
  2026-09-06 batch 66). [changed 2026-10-01, VEN-W4: heading "Usual currency", two short
  sentences, and the panel now sits BELOW the vendor cards; the invoice-filing clause
  stays in each vendor's own currency section.] The founder, verbatim:

  > **"Add the prompt panel"** — "One panel on the providers page (and the orders sheet's
  > empty field) saying how many vendors have stated a usual currency and linking to the
  > ones that have not. No provenance lie."

  One panel printing *"3 of your 14 vendors have stated a usual currency"*, with each
  unstated vendor a link that opens that vendor's TwinSheet, **scrolls the
  usual-currency section into view and puts the caret in its control** (a staff member,
  whose control is disabled, is still brought to the section and its sentence). The focus
  is taken once per opening, so a refetch cannot yank the caret back; a sheet opened by
  clicking a card behaves as it always did. It answers the cost batch 65 disclosed: with nothing pre-filled and no vendor
  profile filled in, every order records no currency, `procurement_orders.currency` stays
  NULL, the order rung of `filingCurrency` never fires and the chain falls back to the
  house exactly as before. **The rejected repair was restoring a house-derived pre-fill**,
  which `procurement_orders.currency_source` would record as `typed` — a person's choice
  nobody made. This panel pre-fills nothing and writes nothing; it counts and links.
  - **Never an empty panel.** Zero stated is the sentence *"None of your 14 vendors has
    stated a usual currency"*; a house with no vendors gets its own sentence. A panel that
    draws nothing when the answer is "none of them" cannot be told apart from one that
    failed to load.
  - **A failed read prints the failure** and says it is not a coverage of zero.
  - **Live vendors only** — `is_active` is not false and `deleted_at` is null — because a
    retired vendor takes no order. The filter is applied in code, not in the query:
    `is_active` is nullable with `DEFAULT true` and a PostgREST `neq.false` would DROP the
    NULL rows, silently removing vendors the house orders from every week.
  - **A stored value that is not ISO 4217 does not count as stated** (`ZZZ` was writable
    here until 2026-09-06) and is listed with the code it holds, so the panel says
    "recorded as ZZZ" rather than "has stated none".
  - **Readable by managers and staff alike** — it is information, not an act; only STATING
    a currency is manager-gated.
  - `?vendor=<id>` on this page opens that vendor's sheet, read once at mount, so the
    orders sheet's link can land on the control.
  - Files: `apps/web/src/pages/providers/next/UsualCurrencyCoveragePanel.tsx`,
    `ProvidersNext.tsx` (`vendorFromUrl`, the deep-link latch),
    `apps/api-gateway/src/providers/providers.controller.ts`
    (`GET /providers/usual-currency/coverage`), `providers.service.ts`
    (`usualCurrencyCoverage`), `vendor-currency.ts` (`usualCurrencyCoverageSentence`).
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
  - Proved by `NewVendor.test.tsx` (19 assertions, re-measured 2026-09-19 — lane E
    audit D10's error-honesty and stay-open fixes added two). The pre-packet
    `ProvidersNext.tsx` contains zero references to the act.
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
- Scopes (redesign, 2026-09-26): `GET /providers/menu-supply` ("Supplies my menu",
  `apps/api-gateway/src/providers/vendor-menu-supply.ts`) and `GET /vendor-catalogue/search`
  with its total ("Find new vendors", `services/api/vendors.ts` `searchVendorCataloguePage`),
  both via `pages/providers/next/useVendorScopes.ts`
- Branches (redesign, 2026-09-26, founder round 8 item 51 · ADR 0221): the locations CRUD
  above is also called from the vendor sheet — `pages/providers/next/useVendorBranches.ts`
  → `BranchesSection.tsx`, mounted in `TwinSheet.tsx`. Legacy `Providers.tsx` /
  `EditProviderModal.tsx` are no longer its only callers. No map (item 52).
  [2026-09-28, #484 audit R4: the primary mark and the delete go through the SQL
  functions `provider_location_make_primary` / `provider_location_remove`
  (migration `a_vendor_has_one_primary_branch`), one transaction each, and a
  partial unique index allows one primary per vendor per house — ADR 0221.]
- Scorecard (redesign only, ADR 0207): `GET /vendor-scorecard?window=30|90|365` (the
  Roll Call and each card's fact), `GET /vendor-scorecard/:id` (the ledger card),
  `GET /vendor-scorecard/:id/docket?measure=` (the rows) — house from the token, a
  foreign vendor is 404 (`apps/api-gateway/src/providers/scorecard/vendor-scorecard.controller.ts`)
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
rows are the founder's call. [changed 2026-10-01, VEN-W8: founder chose "Hide weekdays on screen" —
the sheet drops bare weekday names from Regions (`visibleRegions`, `pv-format.ts`); no
row is cleaned.]

**Also closed here: the form no longer seeds `paymentTerms: 'Net 30'`.** Both
dialogs defaulted the field to Net 30 in the browser, so every provider saved
through them asserted terms nobody chose — the same fabricated answer
`providers.payment_terms DEFAULT 'Net 30'` used to write, moved client-side. It
would have refilled the column on every save after migration `20260903170000`
dropped the default. Both now default to `''` with an explicit "Not stated"
option.

**[2026-09-21, founder answer 12; ADR 0083 second addendum.]** The rebuilt sheet
has an edit path: `VendorRecordEdit.tsx` at the top of `TwinSheet`, the business
type first (the three offered, "Not stated", and a type outside the three shown as
itself), then the name; only what changed is sent. The cards and the sheet's
eyebrow say "Not stated" when no type was stated.

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
| **The Promotions panel now has a live producer** — the D3 lane extracts deterministically from provider-matched inbound mail into `provider_promotions`, on every message, plus a 09:00 digest cron. (Supersedes the "dormant" note carried in memory and in [[06-pages/promotions|promotions]] §9.) | `common/orchestrator/promotion-extractor.service.ts:37-60,179`; wiring `rabbitmq-bridge.service.ts:789-799` |
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

**2026-09-06 — the vendor states its usual currency (batch 65).** The founder's words are
quoted in full in §1a. Built as B1 of the invoice-currency pass; ADR 0104 carries the
dated amendment.

**2026-09-06, batch 66 — DECIDED, in the founder's own words.** Four questions were put
and four were answered:

> **"Keep: house currency for an unmatched invoice"**
> **"Add the prompt panel"**
> **"Keep it open on every invoice"**
> **"Two screens, for now"**

The first two are this page's. The precedence an invoice is filed under is: the file's own
currency, then the currency of the ORDER it is matched to, then the HOUSE's currency — and
the house's rung is reached when the invoice has no matched order **or** when the order it
is matched to names no currency (the sentence says which of the two held). **The vendor's
usual currency never files anything by itself.** That reading followed the founder's *"we
won't use that as the invoice"* plus *"we will use the currency from where we order it"*,
and until batch 66 the last rung was our inference and was marked as one. It is now the
founder's own call: an unmatched invoice takes the house's currency rather than being
refused.

**"Add the prompt panel"** answers the cost p4br disclosed: with no vendor profiles filled
in, every new order records no currency, which makes the order rung inert and the whole
chain fall back to the house exactly as before. The panel — *"N of your M vendors have
stated a usual currency"* — is being built by **p4bu**, not by the invoice-currency pass,
and is not in the tree as of this line.

**2026-09-06, batch 66 — the prompt panel is BUILT** (p4bu; this line supersedes the "not
in the tree" sentence above, which was true when it was written). `GET
/providers/usual-currency/coverage` returns `{ stated, total, unstated[], sentence }` for
the caller's house; `UsualCurrencyCoveragePanel` prints it above the grid with a link per
unanswered vendor; the order sheet's empty currency field carries the same link. It counts
and links — no pre-fill was restored anywhere, so no provenance lie was added. §1a holds
the founder's option text and what the panel does in each of its three states.

**A second, narrower thing was decided in code and is flagged as a fork.** ADR 0117 Q31
(2026-09-05) set the agreement line's currency to default from *"the vendor's terms or the
house"*, and `agreementCurrencyDefault` still does exactly that. Batch 65 named ONE source
for the ORDER — the currency the vendor always uses — so `orderCurrencyOffer` pre-fills
only that, and shows the house's currency and the vendor's last invoice as EVIDENCE beside
the field rather than putting either in it. The reason is `procurement_orders.currency_source`,
which admits `vendor_usual` and `typed` and nothing else: a field pre-filled from the house
and submitted untouched would be recorded as `typed`, which says a person chose it when
nobody did.

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


## Execution reconciliation — 2026-09-13, reconciled 2026-09-17

Phone reachability is stated beside provider contacts (`ContactsSection`, on the
`TwinSheet`). A WhatsApp reply rechecks the current phone book and binds its 24-hour
window to the current business sender; replacing/removing numbers cannot inherit stale
conversation permission. Two vendors in one house holding the identical number is now
refused rather than silently threaded onto whichever row a query returned first
(fixed 2026-09-17). `ContactsSection` draws with the real Mudavym charcoal-ground tokens
(`--ink-*`, `--seal*`, `--paper-*`), guarded by a test that reads the shipped token file
so a future edit cannot reintroduce an undeclared custom property.

**Founder question, not decided by this pass:** "Main line" is offered as a choice in
the type-of-line picker, but the server always reads `main_line` as `stated: false`
because it is indistinguishable from the column's own default — so a manager who picks
it watches the select snap back to "Nobody has said." Should "Main line" ever be
recordable as a stated answer? See ADR 0121's 2026-09-17 review-trail row.

See ADR 0121 for local safety and migration evidence.

## 14. Founder walk-through — 2026-10-01 (branch fix/review-vendors)

Session R7, house YAREN (3 live vendors + 5 retired; Sim Bistro holds 0 vendors,
measured read-only 2026-10-01). Gateway `review-gw.sh … me` on :4107, web :5307.

| Id | What | Evidence | Ask | Founder | Status |
|---|---|---|---|---|---|
| VEN-W1 | Header count: "N vendors — the learned detail lives inside each card" → "N vendors" / "1 vendor" (also fixes "1 vendors") | `ProvidersNext.tsx:342`; sketch VEN-W1 | approve | "Approve" | proposed → approved → built (pane reload 16:52, no new console error) |
| VEN-W2 | Card eyebrow "NOT STATED" → "TYPE NOT STATED" (founder answer 12 kept: never blank, never guessed; the bare words did not say what was missing) | `ProvidersNext.tsx:138`; sketch VEN-W1 | approve | "Approve" | proposed → approved → built (pane reload 16:52, no new console error) |
| VEN-W3 | Card row "Contact" → "Last contact", the sheet's own label | `ProvidersNext.tsx:188`, `TwinSheet.tsx:118`; sketch VEN-W1 | approve | "Approve" | proposed → approved → built (pane reload 16:52, no new console error) |
| VEN-W4 | "Usual currency" panel: A today (top, 4-line engineer paragraph) / B two short sentences, heading "Usual currency" / C B's words below the cards | `vendor-currency.ts:162` (gateway sentence), `UsualCurrencyCoveragePanel.tsx:66`, `ProvidersNext.tsx:405`; sketch VEN-W4 | approve: C | "C: short + below (Recommended)" | proposed → approved → built (pane reload 17:02; jest usual-currency-coverage 19/19, vitest providers/next 170/170). Also fixed the singular ("All 1 of your vendor" → "Your one vendor …") inside the same sentence |
| VEN-W5 | Sheet eyebrow "NOT STATED" → "TYPE NOT STATED" (as VEN-W2) | `TwinSheet.tsx:102`; sketch VEN-W5 | approve | "Approve" | proposed → approved → built (pane 17:12, vitest providers/next 173/173) |
| VEN-W6 | Sheet "Contact" (holds the email) → "Email"; email → `mailto:`, phone → `tel:` links (the house's own mail app / phone; nothing sent by Mudavym) | `TwinSheet.tsx:108-109`; sketch VEN-W5 | approve | "Approve" | proposed → approved → built (pane 17:12, vitest providers/next 173/173) |
| VEN-W7 | Sheet "Minimum order $1000" invents a dollar sign (Terms in the same sheet says "currency not recorded") → "1,000 (currency not recorded)" | `TwinSheet.tsx:112-115`, `TermsSection.tsx:358`; sketch VEN-W5 | approve | "Approve" | proposed → approved → built (pane 17:12, vitest providers/next 173/173) |
| VEN-W8 | Fork: the sheet's "Regions" shows "Monday, Tuesday, Wednesday, Friday, Saturday" — weekday names left in `regions_covered` by the old picker; the doc parks the cleanup as the founder's call | live sheet; `providers.md` §9 (weekday note), `scripts/list_weekdays_in_regions_covered.py` | hide on screen | "Hide weekdays on screen (Recommended)" | proposed → approved → built: `visibleRegions` in `pv-format.ts` (+3 vitest cases); no row written; ALDEMIR DISTRIBUTION now shows "—" |
| VEN-W9 | Sheet currency sentence (no currency stated) → "has no usual currency on file, so an order to them starts with no currency. Choose the one they invoice in and orders to them will start in it." | `vendor-currency.ts:119` (gateway); sketch VEN-W9 | approve, with W13 | "look at files and only if the conf is 100 percent write as that currency otherwise approved this option 1" | proposed → approved (sentence) → built (pane 17:15; jest usual-currency 19/19); the files part → VEN-W13 |
| VEN-W10 | Terms: Payment "no table records when a vendor invoice was raised or settled…" → "Mudavym does not keep the date an invoice was paid, so payment terms cannot be worked out — write them down"; footer "Inference looks back…" → "Unknown terms are worked out from this house's own orders of the last 365 days, and are never saved to the vendor." | `term-inference.ts:583` (gateway), `TermsSection.tsx:548`; sketch VEN-W9 | approve | "Approve" | proposed → approved → built (pane 17:15; jest term-inference). Corrected after approval, before commit: "Mudavym does not keep the date an invoice was paid" was not true — `procurement_documents.paid_at` exists (0 rows set, no gateway code writes it, measured read-only) — now "no invoice here records when it was paid, so payment terms cannot be worked out — write them down". Also shown on /settings vendor terms |
| VEN-W11 | Scorecard footnote "No alert is sent… A labelled set and a shadow run come first, and neither is built yet." (roadmap talk) → "These figures send no alerts." | `vendor-scorecard.copy.ts:170`, `sc-copy.ts:75`; sketch VEN-W9 | approve | "Approve" | proposed → approved → built (pane 17:15; jest vendor-scorecard, vitest LedgerCard/RollCall) |
| VEN-W12 | Fork (OD-177): the sheet ends in the legacy "Provider Intelligence" panel (old skin, says "Provider", "Digital Twin", "Actions") | `TwinSheet.tsx:42-46`; live sheet; OD-177 | rebuild now | "Rebuild now" | proposed → approved: rebuild in this walk-through; sketch first → VEN-W14 |
| VEN-W13 | A vendor's usual currency read from its invoices. Founder: at 100% (every invoice from this vendor in this house printed the same code, at least 3, none changed by a manager) WRITE it automatically, recorded as read from N invoices; when other currencies are discovered, show the counts and offer one tap. A person's stated value is never overwritten (the sheet shows the clash with a one-tap switch); an auto value later contradicted stays and the sheet switches to the offer | data: YAREN 0 documents; 4 vendor-linked invoices in the whole database (read-only 2026-10-01); `invoice-currency.ts` (currency seen + where); constraint `providers_usual_currency_names_its_author` | W13: "write auto and when other currencies are discovere then use option 1"; W13a "3 invoices (Recommended)"; W13b "Person's value stays, sheet shows the clash (Recommended)"; W13c "Keep it, switch to the one-tap offer (Recommended)" | ruled | approved → design sketched (VEN-W13.html: 5 states A–E, source + count columns, author rule "a person, or ≥3 invoices", only invoices whose own page printed the code, restated left out) → design approved "Approve" → build owed. Read-only 2026-10-01: all 33 production documents carry no `extracted->currencySeen`, so nothing qualifies at merge and no back-fill |
| VEN-W14 | Rebuild of VEN-W12: the legacy panel becomes one Mudavym section (what their mail has told us / offers they have sent / messages with them), no tabs, no chips, "was X, now Y", visible load error, "Find in messages", promo currency not "$" | sketch VEN-W14.html; `components/providers/Provider*Panel.tsx` (4 files, ~735 lines, Tailwind); routes `provider-intelligence.controller.ts` (all `houseOf`); read-only 2026-10-01: 0 knowledge / 0 promotions / 0 embeddings rows in every house | approve | "Approve" | approved → built (uncommitted): `LearnedSection.tsx` "Learned from their mail" replaces the 4 legacy panels (deleted; no other importers); vitest providers 186/186, tsc web+gw 0, eslint 0 → pane check owed. Proposed (mine): the "from their message of" date is the fact's last-updated date — no source-message date is stored |
| VEN-W14a | The 4 "Actions" items (check-in, promos, pricing, onboarding) only insert a `provider_conversation_sessions` row that nothing reads (`provider-intelligence.controller.ts:321-387`; no reader of `initiated_by='manual_outreach'` in `services/`) | sketch VEN-W14.html | drop | "Wire to the agent" | ruled: wire them to a real drafted message for approval — agent-side work, its own lane (queued); what the sheet shows until then is an open sub-fork → sub-fork: menu stays **hidden** until the lane lands (founder 2026-10-01) |
| VEN-W14b | "Confirm" on a learned fact writes the person's name; today any signed-in role can (no role check, screen or gateway) | `provider-intelligence.controller.ts:101`; `provider-intelligence.service.ts:112-115` | owner + manager | "Owner and manager (Recommended)" | approved → built (uncommitted): verify route 403 for non owner/manager, spec covers owner/manager/staff/viewer/no-role; Confirm records `verified_at` + shows the confirmer's name |
| VEN-W17 | Founder, mid-walk: "rebuild vendors globe for global ditrbutors make it more technologic and interactive" — item 52's globe tab (FUTURES.md:311-333, no spec until now). Sketch: own "Globe" tab, d3 orthographic dotted-land globe, drag/zoom/fly-to, layers mine/catalogue, click → sheet or catalogue Add, honest "not on the map" list, optional lines to the house | sketch VEN-W17.html (real data). Read-only 2026-10-01: `vendor_catalogue` 25 rows, 19 placed (census 15, osm 4, none 6); `provider_locations` 2 rows, 1 placed (google_places, branch form `providers.service.ts:1344-1352`); `restaurants` 14, 0 placed; `distributor_directory` 0 | — | "rebuild vendors globe for global ditrbutors make it more technologic and interactive"; v1 questions dismissed; then "default first nrrowed serch to given address make it more innovative using the globe more colorful, and I want to see their details as well make this globe appealing to the older generations and outide of tech users" | proposed → sketch v1 (dark, VEN-W17-v1.html) → v2 (VEN-W17.html): opens on the house address, 300 mi ring widening by buttons, coloured by kind with a worded legend, full detail card, big text/buttons, + / − / back to my restaurant, no spin, line to the picked vendor; YAREN's point hand-placed for the sketch (house has none stored) → v2 dismissed: "not like this either needs rework, now rthis is too beginner, with locations are off, basic coloring, needs something that renders well" → v3 (VEN-W17.html; v2 kept as VEN-W17-v2.html): real map engines, two to choose — A MapLibre GL 5 globe projection on OpenFreeMap vector tiles (OSM data, no key; streets/lakes/place names, curves to a lit globe zoomed out), B globe.gl satellite globe (NASA Blue Marble, atmosphere, animated arcs); dark-glass side panel, nearest-first list, great-circle lines, same detail card; both pane-verified, Safari beacon n=1 w=800 → **A approved** ("map globe. great job exactly of how I wanted"), marker look reopened as VEN-W17c ("find alternative and I choose"); VEN-W17a: "each geocode is written when they sign up, also owner can move pin"; VEN-W17b: OpenFreeMap now; VEN-W17c sketch (pins/badges/name tags) → "maybe an emoji or basic drawing? otherwise glow dots" → VEN-W17c.html now offers glow dots / emoji / simple line drawings → **glow dots** (v3 as sketched). VEN-W17 design closed: build = own lane (MapLibre 5 globe + OpenFreeMap, house geocoded at sign-up + owner drags pin), queued |
| VEN-N1 | Founder news relayed by a peer session 2026-10-01: Mudavym handles all beverages, then foods, not only wine; wine items alone go to ML, all drinks are extracted. Wine-only spots on /vendors to bring to the founder in a later pass: the menu-match line and the search (`VendorScopes.tsx:149,191,201,243,262,271`), the catalogue's `wine_specialties` and `winery_direct` kind (also in the W17 globe legend and the 'Sells' line), and `NewVendorSheet.tsx:339` winePortfolio | grep 2026-10-01 | — | relayed, not asked yet | noted → raise as forks in the copy/states passes |
| VEN-W18 | P3 controls. Reads pressed live 2026-10-01 on YAREN, every one 200 and house-scoped: 3 tabs (no request: preloaded), own search `GET /providers/wine-sellers` (`houseOf(user)`, `providers.controller.ts:141`), catalogue country + search (`/vendor-catalogue/search`, `/providers/catalogue-wine-listers`), Book/Scorecard (`/vendor-scorecard?window=90`), sheet 30/90/365, scorecard docket (Esc closes the top layer only). Doubled GETs on sheet open are React StrictMode (dev only, `main.tsx:36`), not a defect | pane, read-only | — | writes approved in one batched ask: edits undone by editing, currency, branch add+remove, new vendor + catalogue add | done; writes left in production: ALDEMIR usual currency USD (stated), an all-null `restaurant_vendor_terms` row (Record created it; Net 30 then withdrawn), vendor "R7 review test vendor (2026-10-01)" (example.com email, 555 phone), A. Bommarito Wines added from the catalogue; the test branch was hard-deleted (`provider_locations` row gone); founder: leave them |
| VEN-W19 | Clearing a vendor's type to "Not stated" saved (DB `primary_business_type` null) but the sheet kept showing the old type: the PATCH reply drops a null type (`providers.service.ts:1664` `?? undefined`) and `VendorRecordEdit` spread it over the old row | live fix `VendorRecordEdit.tsx` + test (mutation-checked) | — | — | fixed live, pane-verified → **approved** |
| VEN-W20 | A contact with no phone (ALDEMIR's only contact, `phone: ''`) showed a NOT STATED chip and the sentence "Nobody has said what kind of number this is" about a number that does not exist, with no control | live fix `ContactsSection.tsx`: no chip or sentence, says "No phone number on file for this contact." + test (mutation-checked). The vendor's own phone (provider record) has no line-type control at all — noted, not changed | — | — | fixed live, pane-verified → **approved** |
| VEN-W21 | "State it" 503'd before the W13 migration: an UPDATE naming a missing column is PostgREST PGRST204, not 42703, so the fallback never ran | `providers.service.ts` setUsualCurrency accepts both codes + spec (mutation-checked); live save then 200 | — | — | fixed, pane-verified → **approved** |
| VEN-W22 | The page's usual-currency panel stayed stale: after a currency was stated ("None of your 3") and after vendors were added ("of your 3" with 5 in the book) | `UsualCurrencySection.tsx` invalidates the coverage query; `UsualCurrencyCoveragePanel.tsx` keys it on the book size; 2 tests (mutation-checked) | — | — | fixed live, pane-verified ("1 of your 5") → **approved** |
| VEN-W23 | "stated by Aldemir Konuk on 2026-10-02" at 21:20 Chicago on 10-01: both the chip (`UsualCurrencySection.tsx:310`) and the server sentence (`vendor-currency.ts:151`) slice the UTC timestamp; format also differs from the scorecard's 07/03 | — | — | — | fork → **A: the house's own day, written out ("Oct 1, 2026")** for vendor-sheet dates → **built 2026-10-01**: chip + gateway sentence + scorecard window/rows/docket read the house zone (`house-day.ts` web+gateway; no zone → UTC, labelled); pane shows "Oct 1, 2026". Left: LearnedSection/VendorScopes (reader clock), Terms "stated" (`lib/mudavym/format` fmtWhen, shared) → queue |
| VEN-W24 | Two answers for one fact on one sheet: top facts read the vendor record (`TwinSheet.tsx:110-114`) while Terms reads `restaurant_vendor_terms`; after "Net 30" was recorded the top said Payment terms — and Terms said Net 30. Minimum order shows 1,000 at the top, blank in the Terms form | — | — | — | fork → **A: one source** — top facts show what the house recorded, else the record's value marked "from the vendor's record" → **built 2026-10-01** (`TopTermsFacts.ts`): one /vendor-terms read shared with Terms; inferred values say so; a failed read says "Could not be read — see Terms below", never the record value; pane shows "1,000 (currency not recorded) · from the vendor's record" |
| VEN-W15 | Numbers on file, a `main_line` number → "This number is recorded as a main line, which is also what the book writes when nobody has said. Nothing is texted to it until somebody confirms the type…" → "Nobody has said what kind of number this is, so it shows as a main line. Nothing is texted to it until someone confirms it is a mobile or WhatsApp number on the vendor's contact sheet." | `phone-reachability.ts:148` (texting needs mobile/whatsapp, :133-135); spec :57 | approve | — | proposed → live-edited (jest 94/94 incl. scorecard; vitest ContactsSection 43/43 with scorecard) → ask owed → **approved** (pane-verified 2026-10-01) |
| VEN-W16 | What they did: "not collected" (reads like money not collected) → "not recorded", in the figure and the prior line; the "no rows" label under an empty line is dropped (nothing to open, nothing shown) | `sc-copy.ts:29`, `vendor-scorecard.copy.ts:274`, `LedgerCard.tsx:~205` | approve | — | proposed → live-edited → ask owed → **approved** (pane-verified 2026-10-01) |
| VEN-W25 | P4 error: with the vendor list read failing, the page said "0 vendors" and "No vendors yet — the book is open and empty". Cause is the shared `useProviders` hook: in DEV it returns `[]` on any error, and in production it returns the last IndexedDB copy as if fresh, so the page's own failed-read notice never shows. Proposed: the hook always throws (keepPreviousData already holds the last answer and the page says so). 8 pages use the hook → SHARED | `hooks/queries/useProviderQueries.ts:49-62`; stub `GET /providers?restaurantId` 500 in headless Chromium (no pane this session); sketch VEN-W25-26.html | approve | "Approve (Recommended)" | proposed → approved → SHARED (queued 2026-10-08; live preview kept until commit, undone before it) |
| VEN-W26 | P4 words: loading header "Reaching the gateway…" (also stayed up after a failure) → "Reading your vendors…" / failed "Vendors not known"; notices drop the raw error code: "Your vendors could not be read just now, so nothing below is claimed about them." / "…could not be refreshed just now. The cards show the last answer, not the present." | `ProvidersNext.tsx:341-343,376-378`; sketch VEN-W25-26.html | approve | "Approve (Recommended)" | proposed → approved → built (headless reload, error + loading shots) |
| VEN-W27 | P4 words: every failure notice on the page printed the gateway's raw text before its own sentence — "Internal server error That is a failed read…", "(Internal server error)", "(Request failed with status code 500)", "(unknown error)". Five copies of a `serverMessage` helper → one `houseMessage` in `pv-format.ts`: a 4xx refusal written for a person is passed on, anything else gives the page's own sentence; the catalogue add error also says "Nothing was added; try again." | `UsualCurrencyCoveragePanel.tsx:39`, `UsualCurrencySection.tsx:107`, `LearnedSection.tsx:194`, `useVendorScopes.ts:48`, `scorecard/useVendorScorecard.ts:33`, `VendorScopes.tsx:151,250,346,408,557`; stub of the real Nest 500 body; sketch VEN-W27.html | approve | "Approve (Recommended)" | proposed → approved → built (headless reload, Nest 500 stub; vitest providers 216/216, 5 tests re-pinned with real statuses, mutation `< 600` fails 5). Note: the gateway's own 503 sentences (`providers.service.ts:1740,1978`, `vendor-scorecard.service.ts:195-240`, which embed the raw DB error) are no longer shown; the page sentence stands in |
| VEN-W28 | P4 sheet, every read failing: Terms, Numbers on file and Branches still printed "Internal server error" (the shared `getErrorMessage`). Same rule as W27 through `houseMessage` (now joins a class-validator array); the alerts key on `!== null` so an empty reason still shows the notice; save errors read "That was not saved, so the book still holds what it held." plus a 4xx reason only | `useProviderTerms.ts:97-101,135`, `useProviderContacts.ts:94,127`, `useVendorBranches.ts:70-73`, `TermsSection.tsx:485-487`, `ContactsSection.tsx:193-196,314-316`, `BranchesSection.tsx:409-412,525-527`; sketch VEN-W28-29.html | approve | "Approve (Recommended)" | proposed → approved → built (headless sheet with every read failing; vitest providers 216/216; mutations of each `!== null` fail 1 test each). Caught while building: `TopTermsFacts.ts:83` keyed on a truthy error, so the top facts read "Reading…" forever once the reason was empty → `!== null`, re-shot "Could not be read — see Terms below" |
| VEN-W29 | P4: the two usual-currency failures (sheet "This vendor usually invoices in" and the page panel) had no way to retry, unlike every other notice → "Try again" (refetch; the panel recovered on click in the stub run) | `UsualCurrencySection.tsx:248-256`, `UsualCurrencyCoveragePanel.tsx:106-113`; sketch VEN-W28-29.html | approve | "Approve (Recommended)" | proposed → approved → built (stub run: panel recovered on click; vitest retry assertions in both specs, mutation of each onClick fails 1) |
| VEN-W30 | P4 roles: staff reached every vendor write (gateway house-scoped only; page offered Add a vendor, Edit the record, terms, branches, line type, catalogue Add). Fork asked; founder: "Staff read only (Recommended)" → 16 write routes refuse anyone below manager with a 403 in words before touching anything (`providers/vendor-write-gate.ts`, one helper, same `resolveRestaurantRole`+`roleSatisfies` pair as usual-currency); page hides every write control from staff and says "A manager or an owner changes this book." `retroactive-order` left out on purpose (an order act with its own gates). Supersedes the "record it, do not restrict it" header in `vendor-terms.controller.ts`. P5 follow-ups seen as staff: the gateway coverage sentence "When you add one, you can note the currency…" (`vendor-currency.ts:312`) and the shared guidance tip "or add a new supplier" are role-blind | `providers.controller.ts` (14 handlers), `provider-intelligence.controller.ts` (outreach, onboard), `vendor-terms.controller.ts` + module; web `useCanChangeVendors.ts` + 6 components; sketch VEN-W30.html | approve | "Staff read only (Recommended)"; then "Approve (Recommended)" | fork → ruled → built (live as Sim Staff: PATCH unknown provider → 403 not 404; book + Find new vendors show no write controls; jest 52 new gate cases, mutating the helper fails 34, one route fails 2 each; vitest 10 staff cases, mutating the hook fails 8) |
| VEN-W31 | P5 words: since W27/W28 the page prints the server's 4xx sentence verbatim, and eight still carried ids, "provider", "restaurant" or field names ("Provider <uuid> not found", "No location with id … belongs to this vendor.", "name is required when catalogue_vendor_id is not provided", "country must be a two-letter ISO 3166-1 code."); a sentence with no full stop ran into the page's next words → house words without ids ("That vendor is not in this house's book; it may have been removed." etc.) and `houseMessage` ends an unended sentence | `providers.service.ts` (13 sites), `provider-intelligence.service.ts:174,515`, `providers.controller.ts:175`, `vendor-catalogue.service.ts:176`, `pv-format.ts:21-38`; sketch VEN-W31.html | approve | "I approve to this decision and I want you to chnage the Email part to be more striking looking, right now looks like an error to the user" (the Email half → W32) | proposed → approved → built (headless: removed vendor under an open sheet reads the new sentence with its full stop; gateway jest 536/536, vitest houseMessage cases; no spec pinned the old wording) |
| VEN-W32 | Founder, during W31: the sheet's Email "looks like an error to the user" (an underlined teal line wrapping down the right edge) → Email and Phone are sealed buttons with their icon ("Write to <address>", "Call <number>"), mailto:/tel:; nothing on file stays an em dash; FactRow loses its unused link path | `TwinSheet.tsx` ReachRow; sketch VEN-W32.html | approve | "I want you to chnage the Email part to be more striking looking, right now looks like an error to the user"; then "Approve, phone too" | proposed → approved → built (headless 390: both buttons with a normal and a 77-character address, wraps inside the button; vitest 3 cases, mutating the background and the empty check fails 3) |
| VEN-W33 | P5 words (VEN-N1): every "What they sell" chip was a wine and one was required, so a beer, spirits or produce vendor could not be added at all (scope rule 2026-10-01: all beverages, then foods); "Supplies my menu" matches wines only underneath (`vendor-menu-supply.ts` keys on `master_wine_id`), so a beer vendor missing from it read as supplying nothing → chips in three groups (Wine, the same 14; Other drinks, 7; Food, 5), still at least one, stored in the same text field; both menu-match banners end "Only wines are matched so far — beer, spirits, other drinks and food on the menu are not counted yet."; extending the match to every drink filed as OD-TBD (gateway + schema lane, not this PR) | `NewVendorSheet.tsx` OTHER_DRINKS/FOOD + grouped fieldset, `VendorScopes.tsx` WINES_ONLY; sketch VEN-W33.html | approve | "Approve (Recommended)"; menu match: "Also file all-drinks lane" | proposed → approved → built (headless 1440/390: three groups, 390 scrollWidth 390, unlinked banner reads the line; vitest 1 new case + 2 assertions, mutating the line to '' and dropping the two groups fails 3) |
| VEN-W34 | P5 words after W30: the page tip ("or add a new supplier to unlock ordering") and five usual-currency sentences ("until you add one", "Add one and orders…", "When you add one, you can note…", "you can change it") told every reader, staff included, to do a manager's act; the currency line shouted "IT NEVER FILES AN INVOICE"; "(not in the list below)" was a position claim → neutral wording, same meaning ("until one is noted", "It never sets an invoice's currency", "— not among the vendors shown here, so it cannot be opened from this note", tip "Search your vendors and open one for its terms, contacts and orders.") | `vendor-currency.ts:167,311-332`, `UsualCurrencyCoveragePanel.tsx:181`, `guidance/content/providers.ts:6`; 3 specs re-pinned; sketch VEN-W34.html | approve | "Approve (Recommended)" | proposed → approved → built (headless: tip and coverage read the new words from the live gateway; gateway jest 500/500 src/providers, vitest 235/235 providers+guidance, tsc clean both) |
| VEN-W35 | P6 overlays: Esc or a click beside a half-written "Add a vendor" sheet closed it and threw every typed field away with no word (headless: name + Beer, Esc, reopen → empty); ADR 0112's tear-and-stub (sketch 103 · 1b) existed in `Sheet`/`Stub` but no page used it → the add sheet is `dirty` while anything is typed or picked and tears; the page holds the draft on a Stub under the header ("A new vendor: <name> — not in the book yet", Go on writing it / Throw it away with 10 s to put it back, "Nothing was written. It is held on this screen only — leaving the page lets it go."), held per house, managers/owners only; an empty sheet still closes clean | `NewVendorSheet.tsx` initialDraft/onTear/isDraftDirty (mount no longer clears a resumed draft), `ProvidersNext.tsx` held stub; sketch VEN-W35.html | approve | "Approve (Recommended)" | proposed → approved → built (headless 1440/390: Esc and click-outside both hold, resume restores name + Beer with focus in the sheet, discard → put back, clean Esc leaves none, 390 scrollWidth 390; vitest 2 page cases, mutating `dirty` to false or dropping `initialDraft` fails 1 each; the per-house filter is checked by reading only, no house switch was walked) |
| VEN-W36 | P7 mobile/URL: the address held only `?scope=` and `?view=`; at 390 a reload (or a phone tab discard) emptied the search and closed the open vendor sheet (headless: typed "Terlato", reload → ""; opened Terlato, reload → no dialog) → `?q=` (All my vendors) and `?find=` (Find new vendors) are read at mount and written with replaceState; an open sheet writes `?vendor=<id>` and closing removes it; `history.state.vendorAt` keeps a reload of a card-opened sheet at the top while the order sheet's `?vendor=` link still lands on the currency field (ADR 0160 §6) | `useVendorScopes.ts` textFromUrl/writeText, `ProvidersNext.tsx` writeVendorToUrl/openedAtFromHistory; sketch VEN-W36.html | approve | "Approve (Recommended)" | proposed → approved → built (headless 390: q survives reload with 1 card, sheet reopens, Esc removes `vendor`, reload after close has no dialog; vitest 3 cases, mutating the write, the history marker, the `q` read or the `q` write fails 1 each; one existing scorecard test reset its URL between renders) |

**Passes** (P2 lower sheet done 2026-10-01: numbers on file → W15, branches true, what they did → W16, how their mail reads true; legacy panel → W14)
- P1 Purpose — done. Who: owner/manager. Job: "who do I buy from, how do I reach them, what is open with them, can I trust them." Verdict **partial**: the facts are honest and the absence-is-not-health rule holds everywhere, but the reach/order actions are missing from the card and the sheet top, and much copy is written in the engineer's voice, not the house's. No `mudavym.design.providers` override set.
- P4 States — done 2026-10-08. Empty (Sim Bistro, 0 vendors) reads as empty, not as health; loading and every read's failure are stubbed in headless (real Nest 500 body) → W25–W29; roles walked as `manager` and `staff` (Sim Bistro, 0 vendors, so the sheet was checked by vitest, the book and Find new live) → W30; long data by stubbing the YAREN list read in the browser only (53 cards, a 115-character name, a 130-character address, a 77-character email): wraps at 1440 and 390, no horizontal scroll (scrollWidth = innerWidth both). Seen and left for P5/P8: the currency read's 404 prints a raw provider id ("Provider <uuid> not found") and runs into the next sentence with no full stop; the failure line is drawn in red.
- P5 Words — done 2026-10-08. Ids, routes and field names in reachable 4xx sentences → W31; role-blind "add" sentences and capitals → W34; not-wine-only: the add-vendor chips were a wine-only gate → W33, and the menu match plus the name/wine search read `master_wine_id` only — the search already says "a wine they sold you" (true), the menu banners now say only wines are matched; extending both to every drink is OD-TBD (W33). "Vendors" throughout (ADR 0221); no consent ask or send on this page (outreach is not wired here, `LearnedSection.tsx:27`); dates read "Sep 6, 2026", currencies by ISO code.
- P6 Overlays — done 2026-10-08. Vendor sheet and Add-a-vendor sheet (headless, reduced motion): `data-shape="sheet"`, aria-modal, labelled, focus moves in, 40 Tabs and 40 Shift-Tabs stay inside, Esc closes and focus returns to the opener (card / Add a vendor), body scroll locked, transitions 0s under reduced motion, close controls are words ("Close", "Put it down"); dirty Esc → W35. The duplicate-vendor Panel was checked by vitest only (needs a live name collision, which would mean a write).
- P7 Mobile — done 2026-10-08. 390×844 headless: book, all, search, vendor sheet, Find new vendors and Scorecard all scrollWidth 390 (no horizontal scroll); add sheet 390 in W33/W35; long data at 390 in P4. URL state → W36. The Browser pane's `resize_window` was not used — headless Playwright at 390 instead.
