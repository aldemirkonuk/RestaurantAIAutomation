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
