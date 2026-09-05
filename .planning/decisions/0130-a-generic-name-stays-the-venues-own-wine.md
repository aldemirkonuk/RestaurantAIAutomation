# 0130 — A generic name stays the venue's own wine

- **Status:** Locked (founder, 2026-09-05, in session) — built in this PR
- **Date:** 2026-09-05
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** master_wine_library, signature_hash, match_library_wine, auto-link, cross-tenant, provisional, house wine, identity, ADR 0130
- **Links:** [[0070-ledger-quantity]] (identity axis parked), `0817030000` under-identified quarantine (0c), `.planning/07-reference/BEVERAGE_CATALOGUE_ARCHITECTURE.md` §3.5, Antalya lens PR #314, Meyhouse night PR #292, `supabase/migrations/20260906010000_a_generic_name_stays_the_venues_own_wine.sql`

## Context

On Antalya night (2026-09-04, PR #314, main `528f13d1`) a real venue — Vanilla,
Kaleiçi — was put through the product's own doors. Its bulk-add draft
**"House White Wine"** carried no producer, no vintage and no region. It came
back bound to `ac6a550f-…` — **`HOUSE WHITE`, library tier 4, created by the Sim
Meyhouse load: United States, California, 2023** — and from that moment the
venue's Turkish house white was a 2023 California wine on every screen, under a
name it had never written.

Reproduced here, on a Postgres 17 built from all 100 migrations
(`memory/local-postgres-from-migrations`), with the Meyhouse row inserted as
that load writes it:

```
match_library_wine('House White Wine', NULL, NULL, NULL, NULL, NULL)
  -> HOUSE WHITE   confidence 90   name_sim 1   producer_sim 1
```

`AUTO_LINK_CONFIDENCE` is 85 (`apps/api-gateway/src/wines/wine-submissions.service.ts:375` on main `528f13d1`),
so 90 links without review. The two components:

- `name_sim` is 1 because `"house white"` is a word-subset of
  `"house white wine"`.
- `producer_sim` is 1 because of one branch in the scorer:
  `WHEN q.np = '' AND m.normalized_producer = '' THEN 1.0`. **Two rows that
  state no producer score a perfect producer match.** Absence is read as
  agreement — the cross-cutting fault in `memory/absence-reported-as-health`,
  here in SQL.

The only thing separating two unrelated venues was the 10-point penalty for a
vintage one side did not state.

Three things that look like they should have caught it, and did not:

1. **The 0c quarantine** (`20260817030000_under_identified_quarantine.sql`)
   excludes rows whose `normalized_producer` equals their `normalized_name`
   from the fuzzy paths. The Meyhouse row's producer is the empty string, so
   `identity_status` is `'normal'` and it is a perfectly good fuzzy target.
2. **The signature hash.** `wine_signature_hash(producer,name,vintage,country,
   region,grape)` is the exact-match key, and it did not fire here — the
   Meyhouse row carries a country and a vintage the draft did not. But it is
   the *reason a generic name is dangerous at all*: two venues that both print
   "House White Wine" produce **the same shared hash**, so under the partial
   UNIQUE index `idx_master_wine_library_signature_hash` they cannot both have
   one. One of them must lose.
3. **The fabricated provenance** — `producer: item.producer || item.name` and
   `country: item.country || "Unknown"` at `wine-submissions.service.ts:452,454`
   and again at `:623,625`, which wrote `producer = the wine's own name` and
   `country = "Unknown"` on 26 of 26 Antalya rows. Both feed the hash. That
   fabrication is the ops track's to remove (`fix/pos-lens-defects-*`); it is
   named here because the mechanism below had to be built so that it works
   **whether or not** those writes change.

A second, separate write finished the job. `receiveBulkLine` filled
`restaurant_inventory.wine_name` — the column `/inventory` actually renders —
by reading the name off the library row it had just resolved to
(`inventory.service.ts:1137` on main). So the rename was not a display
fallback that a later fix would undo; it was persisted, once, at insert time.

## Options considered

1. **A specificity gate in the resolver.** Define "specific" once; a generic
   identity never consults the shared library and never joins it, and becomes
   the venue's own provisional wine. Appeals because the rule is about the
   *question being asked*, not about the rows that happen to exist — it holds
   for a library of 4,000 rows and for one of 4,000,000. Costs: every caller of
   the resolver must say whose menu it is reading.
2. **A per-tenant alias over a shared link.** Keep the link to `HOUSE WHITE`,
   let each venue store its own display name. Rejected: it fixes the *name* and
   keeps the *lie*. The Antalya venue's stock, cost, velocity, reorder point,
   sommelier notes and analytics would still be attached to a California
   Chardonnay. Renaming the symptom is what makes a wrong link survive.
3. **Ask the owner at the door.** Show the candidate and let a human confirm.
   Rejected as the primary mechanism: it is the right *product* answer for a
   near-miss (that is what the 85 threshold and the review queue already exist
   for), but a generic name has nothing to confirm — there is no sense in which
   "House White Wine" *is* or *is not* the Meyhouse row, so the question has no
   correct answer to put to a manager. Kept as a follow-on for the 60–84 band,
   which is a genuine ambiguity.
4. **Tenant id inside the hash for generic names.** The founder's rule, made
   structural: a generic identity is keyed per venue, so two venues cannot
   collide. Not an alternative to (1) — it is what (1) needs in order to have
   somewhere to put the row, and it is adopted alongside it.
5. **Do nothing.** Costs: every venue that writes "House White", "Red — by the
   glass", "Ev Şarabı" or "Sangria" is bound to whichever venue wrote it first,
   with that venue's country, vintage and price. This is not a tail case; it is
   how house wine is printed.

## Decision

**A generic, producer-less wine name never auto-links to an existing
shared-library row. It becomes the tenant's own provisional wine. Only a
specific identity — producer + name, or name + vintage + region — joins the
shared library. Nothing is renamed under a venue.** (Option 1, with option 4 as
its storage mechanism.)

### "Specific", stated once

```
specific ⟺ name present AND ( producer present OR (vintage present AND region present) )
```

Emptiness is judged after `wine_normalize_text`, so `"  "` and `"-"` count as
absent; the vintage is judged as *Postgres* will see it, because the resolver
reaches the SQL through `parseInt(...) || null` and a predicate that accepted
`"MMXV"` would be answering a different question from the database.

Three implementations, pinned against each other by
`datasets/sim/fixtures/wine-identity-vectors.json` (10 new vectors, both
verdicts present, generated from the built schema):

| | |
|---|---|
| SQL | `public.wine_identity_is_specific(producer, name, vintage, region)` |
| TypeScript | `isSpecificWineIdentity()` — `apps/api-gateway/src/wines/wine-signature.ts:290` |
| Python | `wine_identity_is_specific()` — `scripts/synth/identity.py` |

This is deliberately **not** the floor `wineSignatureHashOrNull` applies. That
one answers "is this comparable at all", is the key the submissions pipeline has
always stored, and moving it would silently re-key existing rows. This answers a
different question — *may this join other people's data* — and only the
resolver asks it.

### The mechanism, after the adversarial pass

The gate alone is not enough, and the reason is the interesting part. Today a
generic query cannot reach the fuzzy path against a *fabricated* row, because
that row's `normalized_producer` is its own name and `psim` collapses to 0. The
Antalya link came through a row with an **empty** producer. **So the moment the
ops track stops fabricating — the fix everyone wants — every generic query and
every generic row will have an empty producer, `psim` becomes 1.0 by that same
branch, and the number of venues one house wine can capture goes up, not
down.** A fix that only removed the fabrication would have made this worse. The
gate has to sit on the question.

So the rule is enforced in **SQL first**:

- `match_library_wine()` returns **no rows** for a query that is not specific.
  Not fewer candidates — none. Every caller inherits it, including
  `match_library_wines_batch` (which delegates) and `find_library_duplicates`.
- Rows owned by one venue are excluded from every candidate branch, so a
  venue's own wine is never offered to anybody, and never appears on either side
  of a merge proposal.

and again in the **resolver**, which does not call the matcher at all for a
generic line. Two walls, because the SQL one is the one a future caller
inherits and the TypeScript one is the one that survives a matcher that forgets.

### Where a provisional row lives — and why not the obvious answers

`restaurant_inventory.master_wine_id` is **NOT NULL**, so "does not join the
shared library" cannot mean "no library row". Measured against the schema:

| Candidate | Verdict |
|---|---|
| `restaurant_inventory.master_wine_id` nullable | **Rejected.** `NOT NULL` today; dropping it changes the meaning of every join, every FK-backed read and every analytics query in the app, to solve a naming problem. |
| A separate provisional tier (`library_tier`) | **Rejected.** Tier 3 already means provisional and does nothing about collision: two venues' rows still share one `signature_hash` and the UNIQUE index still admits only one of them. A label is not a key. |
| `signature_hash = NULL` for generic rows | **Rejected**, though it *is* admissible — the UNIQUE index is partial (`WHERE signature_hash IS NOT NULL`). It leaves a venue unable to find its **own** row on the next scan, so every re-import spawns another "House White Wine" in that venue's cellar. It also disarms the drift view for those rows. |
| **A venue-scoped identity component** | **Adopted.** |

`master_wine_library.provisional_for_restaurant_id` (uuid, FK to
`restaurants(id)`, NULL for every row that exists today) names the one venue a
row belongs to, and `trg_sync_signature_hash` keys such a row on
`wine_provisional_signature_hash(owner, …)` — the same six fields behind a
`venue:<id>|` segment — instead of the shared hash.

That prefix is disjoint from any shared key **by construction, not by luck**: a
shared key's first segment is `wine_normalize_text(producer)`, whose output
alphabet is `[a-z0-9 ]` and can never contain a colon.

The consequences of that one choice, all measured on the built schema:

- two venues' "House White Wine" occupy two rows under the *existing* UNIQUE
  index (`distinct_hashes = 2`);
- the same venue rescanning its own menu lands on its own row — a second insert
  raises `duplicate key value violates unique constraint
  "idx_master_wine_library_signature_hash"`, which is exactly what the
  `onConflict: signature_hash, ignoreDuplicates` upsert is built on;
- **no existing hash moves** (`shared_rows 2 / still_the_old_hash 2`, and
  `v_signature_drift` reports 0);
- promotion is one `UPDATE`: clear the owner, the trigger recomputes the shared
  key (`shared_key_now = t`).

### One thing the venue-owned row does differently from the shared path

It writes `producer: item.producer ?? ""` and `country: item.country ?? ""`
rather than the wine's own name and `"Unknown"`. This is *not* the ops track's
change arriving early; it is forced. The trigger rehashes from the **stored**
fields, so a row written with `country = "Unknown"` and looked up by a hash
computed from an absent country cannot find itself. `wine_normalize_text` maps
`NULL` and `''` to the same empty segment, so `''` hashes identically to the
absence it records — and will keep hashing identically once those columns are
made nullable.

Measuring that turned up a **pre-existing defect on the shared path**, filed
rather than fixed here: because the app computes the key from the draft and the
trigger stores the key of the fabricated row, a second import of the same
countryless wine raises *"insert was skipped but no row carries signature"*.
Filed in `v3.0-TECH-DEBT.md`; it belongs with the fabrication removal.

## Consequences

**Easier.** A venue's own words stay its own. "House White", "Ev Şarabı",
"Red — by the glass" and "Sangria" stop being a cross-tenant join key. The
receiving screen can now say *why* a line did not match — `venueProvisional`
is reported separately from `libraryMatched`, so a generic label no longer
reaches governance review dressed as a discovery.

**Harder / given up.**

- Every resolver caller must say whose menu it is reading. A generic line with
  no venue is a hard failure, not a fallback to the shared library — falling
  back is precisely the collision this exists to stop.
- A venue's provisional wine gets **no shared enrichment**: no producer story,
  no ratings, no market price. That is the honest state (nothing is known about
  it), but it means the enrichment pipeline will show these as permanently
  unenriched until they are promoted.
- Two venues that genuinely pour the same house wine now hold two rows. Correct
  by this decision; it costs a merge when they are later identified.
- `name + vintage` **without** a region stays provisional. This is stricter than
  the weaker floor "refuse when producer and vintage are both absent", and it
  is the founder's wording. Named explicitly because it is the one place the two
  readings diverge: a menu line "Cankaya 2023" with no producer and no region
  stays the venue's own until someone says where it is from.

**Promotion, when a real identity is known.** Set
`provisional_for_restaurant_id = NULL` on the row; the trigger recomputes the
shared key. If that key already exists, the collision is a genuine merge
decision and goes through `merge_library_wines`, which repoints
`restaurant_inventory`, lots and mappings. **Not built in this PR** — no UI, no
endpoint. The path exists and is proven (T8); the door is not cut.

**The rows already written are not repaired here.** The 26 Antalya rows and the
earlier Meyhouse rows keep their wrong links until a separate stop. That stop
must follow `memory/deleting-fabricated-production-rows`: fingerprint the whole
seeded tuple rather than the name (several are legitimately named "HOUSE
WHITE"), read every FK's delete behaviour before touching a library row
(`restaurant_inventory`, `inventory_lots`, `menu_items.wine_library_id`,
`sku_mappings`, `master_wine_library_submissions.matched_master_id`), and prove
the writer is gone from `main` first — which is what this PR makes true.
Repairing before that would refill.

**No CHECK constraint yet.** `CHECK (provisional_for_restaurant_id IS NOT NULL
OR wine_identity_is_specific(producer, name, vintage, region))` is the shape
that would make an unowned generic row impossible. It cannot be added today:
the app still writes `producer = the wine's own name`, so every generic row
*looks* specific to SQL and the constraint would be a green light that checks
nothing — `memory/absence-reported-as-health`. It becomes enforceable the moment
the fabrication is removed, and is filed against that stop.

**What would trigger revisiting.** A venue that legitimately needs its house
wine in the shared library (a group with ten sites pouring one bulk cuvée) —
that is the promotion path, and if it is asked for more than twice it should be
a button rather than an `UPDATE`. Or: a measured case where a *specific*
identity still crosses tenants, which would mean the specificity line is in the
wrong place rather than that the mechanism is wrong.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-04 | Antalya lens (PR #314) | Finding 4 filed 🔴 — the auto-link measured at confidence ≥ 85 |
| 2026-09-05 | Aldemir (founder) | Locked in session: generic names never auto-link; producer + name, or name + vintage + region |
| 2026-09-05 | Adversarial pass | Killed the "remove the fabrication and it is fixed" reading: an empty producer on both sides scores `psim = 1.0`, so that fix alone *widens* the hole. Gate moved onto the query, in SQL, ahead of the resolver. |
| 2026-09-05 | Schema measurement | Four storage mechanisms tried against the built schema; three rejected with reasons above; the adopted one proved on T1–T9 (pre-fix control: confidence 90; post-fix: 0 candidates) |
