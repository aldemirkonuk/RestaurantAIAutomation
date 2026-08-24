---
type: scenario
id: S13
slug: new-vendor-discovery-and-onboarding
class: happy-path
actors: [owner-buyer, vendor-finder, vendor-catalogue, providers-service, prospects-lane, onboarding-progress]
modules: ["[[supply-discovery-charter|supply-discovery]]", "[[procurement-vendor-network-charter|procurement-vendor-network]]", "[[inbound-understanding-charter|inbound-understanding]]"]
signals: [catalogue-search, provider-create, catalogue-dedup, prospect-capture, onboarding-flag]
insights_class: [vendor-coverage, price-freshness, category-gap, prospect-funnel]
tier: undecided
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[supply-discovery-charter]]", "[[procurement-vendor-network-charter]]", "[[inbound-understanding-charter]]"]
---

# S13 — New vendor discovery & onboarding

The one module that goes **outbound**. Inbound understanding processes what arrives;
Vendor Finder crawls, extracts, and *constructs* the supply graph the rest of procurement
depends on (`supply-discovery-charter.md`, "Why this is not inbound-understanding"). This
scenario is a restaurant gaining a supplier it did not have — the happy path — with one
naming trap called out loudly so nobody builds the wrong product.

## 1. Trigger
A restaurant needs a vendor it lacks — for a specific SKU or a whole category — and adds
one. Bounded: from "I need a supplier for X" to a `providers` row procurement can order
against. Two real entry paths ship today: **search the vendor catalogue** (the Vendor
Finder, `VendorSearchModal.tsx` → `searchVendorCatalogue`), and **promote an inbound cold-
email prospect** (`prospects.service.ts`). `createProvider` handles both the catalogue path
and a custom fallback (`providers.service.ts:86-208`).

## 2. Actors
Owner/buyer (decides who to onboard) · Vendor Finder / catalogue search
(`vendor-catalogue.service.ts`) · the shared vendor catalogue (`vendor_catalogue` — name,
type, location, contact, specialties: `vendor-catalogue.service.ts:6-21`) · the providers
service (writes the tenant's own vendor row) · the **Prospects lane** (inbound cold-email
vendor outreach — see the trap in §8) · onboarding progress, which flips a `vendor_added`
checkmark (`providers.service.ts:202-208`).

## 3. Signals
- **Catalogue search** — a query against `vendor_catalogue` returning ranked rows with a
  name/address similarity score for fuzzy matches (`vendor-catalogue.service.ts:31-34`).
- **Provider create (Mode A / Mode B)** — one-tap add from a catalogue row auto-fills
  details (`providers.service.ts:93-148`); a custom add requires only a name (`:154-183`).
- **Catalogue dedup** — same catalogue vendor + same restaurant twice is an unambiguous
  duplicate, blocked at write with a 409 rather than a silent second row
  (`providers.service.ts:109-121`); the modal labels already-added rows so the button is
  never offered then rejected (`VendorSearchModal.tsx:20-27`).
- **Prospect capture** — a genuine unknown-sender vendor email (intro, catalogue, wine
  offer) captured as a low-priority, digest-only prospect, **deduped by domain, never auto-
  replied**, with a one-tap "Add as vendor" (`prospects.service.ts:34-52`).
- **Onboarding flag** — `user_onboarding_progress.vendor_added` set fire-and-forget on
  first provider.
- **Honest gap — discovery is catalogue-first, not a live crawl.** External hosts feed the
  catalogue upstream (`api.yelp.com`, `api.apify.com`, `maps.googleapis.com` —
  `EXTERNAL_CONNECTIONS.md:11, 16`), but there is no shipped in-app "find a supplier near me"
  live search at onboarding. And the comparison surfaces `/distributors` and `/vendor-prices`
  are **currently unreachable in-app** — a route verdict pending, not a built feature
  (`supply-discovery-charter.md`, non-goals table).

## 4. Queries the product must answer
- "Who carries what I need?" — the supply graph; coverage is partial and the module owns the
  definition of when it's good enough to trust (`supply-discovery-charter.md`, mandate).
- "Is this vendor already one of mine?" — the dedup check before a second row is written.
- "Is this cold-email sender worth adding?" — a manager glance at the digest, not an auto-add.
- "What does this vendor carry, at what price, as of when?" — hands off to S08's price ladder
  once the vendor is on the books.

## 5. Outputs (in the moment)
- A search modal with result cards and a one-tap **Add**; already-added vendors shown as such
  up front, and a custom-add fallback when the catalogue has no match
  (`VendorSearchModal.tsx`).
- The Prospects digest with one-tap "Add as vendor" — and, by design, **nothing is ever
  sent**: the lane never auto-replies to a cold email (`prospects.service.ts:39-42`).
- The onboarding checkmark flips, so the "add your first vendor" step visibly completes.

## 6. Insights the owner sees (the payoff)
- **Vendor coverage** — dual-price SKU coverage against the needed set
  (`supply.sku_dual_price_coverage_pct`, a supply-discovery metric).
- **Price freshness** — how stale the graph's prices are (`supply.price_freshness_p50_days`);
  a price is a perishable fact.
- **Category gaps** — "no fish supplier," "one wine distributor and no backup."
- **Prospect funnel** — cold emails captured vs promoted to real vendors.
- All procurement-graph signals, inside the **25.1% no-POS satisfiable band**
  (SCENARIO-CONTRACT §5). Honest boundary: the coverage *denominator* — the "needed SKU"
  set (`supply.needed_sku_denominator_size`) — is only as complete as what the restaurant has
  told us; without POS, "needed" is partial, so coverage can look better than it is.

## 7. Decisions
Human decides: which vendor to onboard, whether to promote a prospect, whether to add a
custom vendor the catalogue doesn't know. The system **proposes only** (ask→propose→confirm
→execute): matching catalogue candidates with similarity scores, a dedup warning, and the
"add as vendor" tap. It never signs terms, never logs into a vendor portal, and never emails
a vendor — vendor *relationships* belong to Partnerships, not to the software that *finds*
them (`supply-discovery-charter.md`, non-goals: "we ship the software that finds vendors;
they sign and maintain them").

## 8. Failure modes
- **THE NAMING TRAP — "Prospects" is not a sales pipeline.** Every SaaS instinct reads
  "prospects" as *leads the restaurant is selling to*. Here it is the exact opposite:
  **vendors cold-emailing the restaurant**, captured so a real supply relationship can start
  with one tap (`prospects.service.ts:34-42`; the manager surface is literally "add a
  prospect as a real vendor," `prospects.controller.ts:17-24`). Misreading the direction
  builds a CRM nobody asked for and misses the actual feature.
- **Duplicate provider from a fuzzy name** — hard-guarded on the catalogue path by
  `catalogue_vendor_id` (`providers.service.ts:109-121`); weaker on custom adds, where two
  spellings of one distributor can both land.
- **Coverage looks complete because the denominator is small** — see §6; a thin "needed" set
  flatters the coverage metric.
- **Stale catalogue price shown as current** — freshness policy owns the shelf life of a
  price; a graph that never refetches lies quietly (`supply-discovery-charter.md`, boundaries).
- **Prospects becoming a spam magnet** — guarded upstream: pure marketing-list blasts are
  gated out by bulk/list transport before they reach the lane (`prospects.service.ts:39-42`).

## 9. Simulation & deploy gate
The synthetic engine seeds a vendor catalogue, a set of restaurant needs, and a stream of
inbound cold emails, then asserts: catalogue search returns the right candidates in rank
order · a re-add of the same catalogue vendor is blocked (one provider, not two) · promoting
a prospect creates exactly one provider and dedupes by domain · a bulk marketing blast is
gated out and never appears in the lane. Gate: an onboarding or discovery change ships only
when the synthetic run yields **one provider per intent, zero duplicates, and zero
auto-sent replies.**

## 10. Tier cut (proposed — OD-48; frontmatter stays `undecided`)
- **Core (operate):** catalogue search + one-tap add + prospect promotion. Table-stakes
  onboarding — a restaurant must be able to add a vendor to do anything at all.
- **Plus (understand):** the coverage scorecard and price-freshness readout.
- **Pro (optimize):** the supply-graph gap intelligence — *proposed* vendors for uncovered
  needs, ranked, with the S08 price comparison attached.

## 11. Evolution feedback
Which catalogue results get added versus scrolled past trains the match ranking. Which
prospects get promoted versus dismissed trains the cold-email gate — and tells us whether
the "digest-only, never auto-reply" posture is too quiet or about right. Where custom-add is
used instead of a catalogue row is a direct map of the catalogue's coverage holes: every
custom vendor is a SKU the supply graph didn't know a source for.

**Flex points:** search scope (local vs national) · match-confidence bar before a candidate
is shown · prospect digest cadence · whether custom (off-catalogue) vendors are allowed at
all · the category taxonomy that defines a "gap" · how aggressively cold emails are gated
before they reach the lane.
