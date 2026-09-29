# 0080 — The app does not invent cellar zones, and a default is not a measurement

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** storage_locations, cellar map, seeded data, fixtures, placeholderData, ADR 0051, fabrication, inventory, auto-locate
- **Links:** [[0051-rebuilt-pages-show-live-data-only]] (the clause this violated), [[0020-no-fabricated-answers]], [[0053-analytics-cost-unknown-not-invented]], [[0059-receiving-preserves-the-pair]]

## Context

`apps/web/src/hooks/useStorageLocations.ts` declared `DEFAULT_LOCATIONS`: four
invented cellar zones with fabricated capacities and temperatures — *Main Cellar
500 slots 55°F 70%, Bar Stock 100 slots 58°F, Overflow Storage 200 slots, VIP
Reserve 50 slots 53°F*.

They were used three ways, and the third is the one that matters:

1. as `placeholderData` on the query;
2. as the **queryFn's return value when the server sent an empty array**;
3. as the `??` fallback when the fetch failed.

Because (2) made the query *succeed* with the four defaults, a `useEffect`
guarded on `allAreDefaults` then **POSTed all four into the tenant's
`storage_locations` table**. A restaurant with no cellar zones was given four,
and those four were thereafter indistinguishable from zones a human had entered.

### What it actually did, measured

Production (`exzueerziesmczwlhomd`), 2026-09-02:

| measure | value |
|---|---|
| `storage_locations` rows | **87** |
| rows carrying one of the four invented names | **84** |
| tenants affected | **6** |
| rows per invented name | **21** |
| first written / most recent | 2026-05-20 / 2026-07-30 |

Twenty-one rows per name across six tenants means the effect re-fired
repeatedly rather than once — `didSeedRef` resets in the `.catch`, so any
failure re-armed it.

Those fabricated numbers were not inert. `capacity` drove the cellar map's fill
bars (with `?? 100` supplying a denominator when even the fixture had none),
the zone names populated the toolbar's location filter chips, and both fed
Auto-Locate's placement scoring.

### Why this is the sharpest instance of a familiar defect

ADR 0051 forbids a component shipping "a literal standing in for a
computation", and this week found many: a hardcoded lead time, a `cost × 3`
menu price, a `'30+'` days-since-sale. Every one of those renders a fiction.

This one **writes** it. The fixture left the browser, entered the tenant's
database, and came back through the API wearing the same shape as measured
data — at which point no consumer, and no later reviewer, can tell the
difference. That is the difference between a page that lies and a page that
teaches the database to lie.

## Decision

**The app never invents a cellar zone, and never writes one it was not asked to
write.**

1. The seeding effect is deleted. A tenant with no zones has no zones.
2. `DEFAULT_LOCATIONS` is no longer a data source: not the empty-response
   return, not the error fallback. **Three states that were collapsed into one
   are now distinct** — an empty server response means *no zones*, a failed
   fetch means *unknown and says so*, and a successful response means *these
   zones*.
3. A capacity nobody entered is unknown, not `100`. The fill bar renders the
   unknown rather than a computed percentage of an invented denominator.

### The data operation, executed 2026-09-02

Carried out separately from the code change, exactly as this ADR required: the
classification query ran and its counts were reported before anything was removed.

**Deleting on a name match alone was rejected** — a human could legitimately name a
zone "Main Cellar". The fingerprint used instead is the full seeded tuple: one of the
four names **AND** that name's exact fixture capacity (500/100/200/50) **AND**
`temperature_zone`, `temperature_min` and `temperature_max` all NULL **AND**
`humidity_controlled = false`. It matched **84 rows — the same 84 the name-only count
found**, which is itself the evidence that no human had ever created a zone wearing one
of those names.

The three human-entered rows are unmistakable beside them: *Reserve Room - Rare
Collection*, *Wine Cellar - Main Cellar*, *Bar Area - Bar Fridge* — each with a real
temperature band (11.1-12.8, 12.8-14.4, 7.2-10.0 °C), a humidity flag, and
`restaurant_inventory` rows pointing at it.

Three foreign keys reference `storage_locations`, and their delete behaviours are not
alike — `wine_location_mappings.location_id` is **ON DELETE CASCADE**,
`inventory_lots.location_id` is **SET NULL**, `restaurant_inventory.storage_location_id`
is **NO ACTION**. So the delete was written to exclude any row referenced by any of the
three, rather than trusting the constraints to be harmless.

| | |
|---|---|
| matched the seeded fingerprint | **84** |
| referenced by nothing → **deleted** | **83** |
| referenced → **kept and flagged** | **1** (`fb38dbab`, an *Overflow Storage* carrying one `inventory_lots` row) |
| `storage_locations` after | **4** (3 human-entered + the flagged one) |

The kept row carries a `notes` line naming it machine-seeded, saying its 200-bottle
capacity was never measured, and stating what has to happen before it can go: reassign
the lot, then delete.

**Verified after, not assumed:** the flagged row's lot is still attached (1);
`wine_location_mappings` is 0 and was 0 before, so nothing cascaded; the 50
`restaurant_inventory` rows that carried a location still carry one. The single
`inventory_lots` row with a NULL `location_id` pre-dates this and was not created by it.

**And verified that the rows cannot come back**, which is the only thing that makes the
delete durable: `useStorageLocations.ts` on `main` has no `DEFAULT_LOCATIONS`, no seeding
effect and — deliberately — no `placeholderData`; its one remaining POST is a
user-driven mapping write.


**The existing 84 rows are not deleted by this change.** The founder's decision
is to delete those that nothing references and flag the rest, and that is a
data operation carried out separately, against a reference-classification query,
with the count reported before anything is removed. Shipping code that deletes
production rows as a side effect of a page load is the same class of mistake as
the one being fixed.

## Alternatives rejected

**Keep the defaults as `placeholderData` only.** Tempting, and it removes the
write. Rejected because placeholder data that is indistinguishable from real
data is the same defect in a shorter-lived form — a reader who glances during
the placeholder window sees four confident zones and has no way to know.

**Keep the seeding but mark the rows `is_seeded`.** Rejected: it preserves the
premise that the product knows what a restaurant's cellar looks like. It does
not. A flag would make the fiction auditable without making it stop.

**Delete the rows in the same change.** Rejected on sequencing, not principle.
The rows are 96.6% of the table and predate the tenant-scoped cohort; some may
carry wine assignments. Code that ships a destructive data migration for
fabricated-looking rows would be irreversible on a judgement made from a name
match.

## Consequences

- The cellar map's empty state becomes reachable for the first time. It already
  existed and had never rendered.
- Auto-Locate has nothing to score against for a tenant with no zones, and must
  say so rather than placing bottles into invented rooms.
- A failed locations fetch is now visible. It previously rendered as four
  healthy zones, so the failure had no symptom at all.
- Guarded by `scripts/check_no_seeded_defaults.py`, blocking in CI: a
  `DEFAULT_*` constant may not be a queryFn return, a `placeholderData`, or an
  error fallback for tenant data. Exit 1 on violation, 0 clean, **2 when it
  cannot check**, with a `--self-test`.
- **Not fixed here:** the same shape may exist in other hooks. The guard is
  scoped to what it can actually parse and says so in its header; it is a
  ratchet against new instances, not a proof that none remain.

**[2026-09-29, feat/storage-zone-parent (stacks on PR #510): zones nest.** The founder answered the fork #510 filed, verbatim pick "Add parent column (Recommended)", option text "Add a parent_id column (one migration) so zones can nest, e.g. Cellar → Rack A → Shelf 2." Migration `20261202110000_a_zone_can_sit_inside_another_zone.sql` adds `storage_locations.parent_id` (nullable, references `storage_locations(id) ON DELETE SET NULL`), CHECK `storage_locations_parent_is_not_self`, and trigger `storage_locations_parent_guard`, which refuses (23514) a parent in another restaurant, a soft-deleted parent, and a cycle (the new parent's ancestor chain containing the zone), and a restaurant move that would split a tree; trigger `storage_locations_orphans_go_top_level` clears the children's `parent_id` on the gateway's soft delete, so a deleted parent's zones become top-level on both delete paths. RLS is unchanged: the table has RLS on and no policies, so the column is service-role only like the rest of the row. `StorageLocationsService` stores `parent_id` on create and update (the #510 422 is gone), returns it on reads, refuses the same three cases with a 422 before writing, and answers the trigger's 23514 / the foreign key's 23503 as a 422. The zone editor draws the list as a tree, its picker never offers the zone or a zone inside it, and the delete confirm says the zones inside move to the top level. This extends this ADR's rule rather than bending it: an existing zone arrives with `parent_id` NULL, which is what the table always meant; nothing is inferred. Depth is not capped (see the PR's forks). Evidence: `storage-locations-hierarchy.spec.ts`, `zoneNesting.test.ts`, `useStorageLocations.nesting.test.tsx`, `supabase/tests/20261202110000_a_zone_can_sit_inside_another_zone_test.sql`; CLAIMS `ZONE-PARENT-2026-09-29-ZONES-NEST`.]**

**[2026-09-29, feat/storage-zone-parent (PR #515): nested-zone totals.** The founder answered the totals fork #515 filed, verbatim pick "Show both (Recommended)", option text "Parent shows its own bottles plus a rolled-up total for everything inside, clearly labelled. Nothing hidden, no double counting in reports." Built on the web from the tree and the counts each surface already shows: `zoneNesting.rolledUpTotals` gives every zone with zones inside it a total of itself plus every descendant at any depth (bottles, the sum of recorded capacities, how many zones in that subtree have no capacity recorded, and how many zones are inside), and `rollupLabel` always names what it adds up ("With the 2 zones inside: 21/150"). The zone manager's rows and the cellar map's cards keep their own count exactly as before and add the labelled line on parents only; a zone with nothing inside gets no line. Each bottle is counted once wherever the house is totalled: the manager's footer and `getLocationStats` still sum own counts, and no report or export reads `parent_id` (the gateway's `cellar/zones.service.ts` and `ask-readings/reading-sources.ts` read `storage_locations` without it), so nothing can add a roll-up to a sum. This ADR's rule holds in the roll-up too: a capacity nobody recorded is counted, never summed as 0 or 100 (the same rule as `getLocationStats`). Also on this branch: a zone write that lost a lock race (40P01 / 40001; the verifier's case is a parent's soft delete against a concurrent move under it) is a 409 "try again" instead of a 500. The deadlock itself is not removed: the delete's UPDATE locks the parent row before any row trigger runs, so taking the advisory lock first in the orphan trigger would not change the lock order. Evidence: `zoneNesting.test.ts`, `StorageLocationManager.rollup.test.tsx`, `CellarMapView.rollup.test.tsx`, `storage-locations-hierarchy.spec.ts`; CLAIMS `ZONE-PARENT-2026-09-29-NESTED-TOTALS-SHOW-BOTH`.]**
