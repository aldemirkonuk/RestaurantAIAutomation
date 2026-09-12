# Master wine library — sim-tenant repair, stop 1: measurement

- **Date:** 2026-09-05 · read-only, nothing written
- **Authorised:** founder, 2026-09-05 in session ("repair now, measured first")
- **Scope, as authorised:** rows written by **Sim Meyhouse `a229f22b-2aac-4e54-a8b2-033a8f93ac5e`**
  and **Sim Vanilla Kaleiçi `684920db-e416-4099-9969-66873afa6c57`**. Nothing else.
- **Database:** `exzueerziesmczwlhomd` (production), read through the Supabase MCP.
- **Method:** `memory/deleting-fabricated-production-rows` — fingerprint the whole
  tuple, read every FK's delete behaviour, prove the writer is gone from `main`
  first, classify and count before writing anything.
- **Related:** ADR 0130, PR #318 (`f4f9e4a6`), PR #319 (`fc6b9a77`), Antalya lens
  PR #314 findings N3/N4.

---

## 0. The writer is gone from `main` — checked on `origin/main`, not on memory

`git show origin/main:apps/api-gateway/src/wines/wine-submissions.service.ts` at
`f59addc3`:

```
:474  producer: item.producer ?? null,
:476  country:  item.country  ?? null,
:498  producer: item.producer ?? null,     (batch resolver)
:500  country:  item.country  ?? null,
:605  producer: item.producer ?? null,     (submission promotion)
:607  country:  item.country  ?? null,
```

and the second writer, the one that renamed the venue's stock,
`inventory.service.ts:1162`:

```
insertData.wine_name = line.wineDraft?.name ?? libraryName;
```

Both fabrications are gone. A repair now is durable; a repair before #318 would
have been refilled on the next import.

Both migrations are **already applied to production** (measured, not assumed):
`provisional_for_restaurant_id` exists, `producer` and `country` are nullable,
`wine_identity_is_specific` and `wine_provisional_signature_hash` are present.

---

## 1. What the two sim tenants actually reference

| | |
|---|---|
| `restaurant_inventory` rows, Sim Meyhouse `a229f22b` | 53 |
| `restaurant_inventory` rows, Sim Vanilla Kaleiçi `684920db` | 27 |
| distinct `master_wine_library` rows they reference | **80** |
| of those, `source = 'menu_import'` (written by the two sim nights) | **77** |
| of those, referenced by **any tenant outside the scope** | **0** |
| `menu_import` rows not referenced by any inventory row | 0 |
| already carrying `provisional_for_restaurant_id` | 0 |
| soft-deleted | 0 |

The other **3** rows the two tenants reference are **not** ours to touch:

| id | name | source | who references it |
|---|---|---|---|
| `40b0630b…` | Akakies (Kir-Yianni, 2024, Greece/Macedonia) | `menu_corpus` | Sim Meyhouse only — a real, specific, correct match |
| `0f19b77d…` | Côtes de Provence Commandeurs (Peyrassol, 2024) | `menu_corpus` | Sim Meyhouse only — a real, specific, correct match |
| `ac6a550f-cbff-5ea6-9672-8504127a2c89` | **HOUSE WHITE** (USA / California / 2023 / Pinot Gris, tier 4) | `sim` | **Sim Bistro AND Sim Vanilla Kaleiçi** — the cross-tenant link (§4) |

### A correction to the record

ADR 0130 and Antalya AUDIT §4 N4 both say `ac6a550f-…` was "created by the Sim
Meyhouse load". Measured: its `created_at` is `2026-09-03 02:52:41.893072+00`,
**byte-identical to `restaurants.created_at` for Sim Bistro
`12823c23-277c-5ae9-b49b-e17d33704e04`**, its `source` is `sim`, and the only
`master_wine_library_submissions` row pointing at it
(`5a8a3bde-3e10-5cac-889c-063e8ffe1c87`, payload
`{"source":"sim","producer":"","wine_name":"HOUSE WHITE","by_glass_price":12.0}`)
carries `restaurant_id = 12823c23…`. **It was written by the Sim Bistro load.**
That matters operationally: Sim Bistro is *outside* the authorised scope, so the
row and everything hanging off it stays untouched, which is what the brief asks
for anyway ("leaving the other tenant's California row untouched").

---

## 2. The fingerprint — three independent readings that agree at 77

Per `memory/deleting-fabricated-production-rows` rule 1, the name alone proves
nothing (several rows are legitimately called "HOUSE WHITE"). Four narrowings:

| Fingerprint | Count |
|---|---|
| loose: `source = 'menu_import'` | 77 |
| \+ `country = 'Unknown'` | 77 |
| \+ `created_at ∈ [2026-09-03, 2026-09-06)` | 77 |
| \+ `library_tier=3 ∧ review_status='pending' ∧ classification_status='unclassified' ∧ beverage_kind='unknown' ∧ primary_type='unknown' ∧ bottle_size_ml=750 ∧ wine_id LIKE 'WINE_%' ∧ deleted_at IS NULL ∧ superseded_by IS NULL` | 77 |
| referenced **only** by the two in-scope tenants | 77 |

The tight tuple and the loose one return the **same** count. That agreement is
the evidence that no human ever created one of these — it is not an assumption.
(The single tuple column that varies inside the set is `grape_variety`,
non-NULL on 18 of the 77; it is not part of the fabrication.)

`source = 'menu_import'` exists **only** in this window: 77 rows, first
2026-09-03, last 2026-09-05, and every one of them belongs to one of the two
tenants. No other source value appears in the window.

### The two classes inside the 77

Three independent tests partition the set **identically**:

| test | Class A | Class B |
|---|---|---|
| `wine_normalize_text(producer) = wine_normalize_text(name)` | 48 | 29 |
| `identity_status` (0c quarantine trigger) | 48 `under_identified` | 29 `normal` |
| `wine_identity_is_specific(NULL, name, vintage, region)` | 48 **false** | 18 true / 11 false* |

\* the 11 Class B rows that are not specific *without* a producer have a **real**
producer, so they are specific *with* it. What separates the classes is whether
the **fabricated** field was load-bearing.

- **Class A — 48 rows.** `producer` is the wine's own name. The fabrication was
  the only thing making the identity "specific"; strip it and the row names a
  menu section, not a bottle. 26 Antalya + 22 Meyhouse.
- **Class B — 29 rows.** `producer` is real (given by the venue). Only
  `country = 'Unknown'` is fabricated. 0 Antalya + 29 Meyhouse (18 with a
  vintage *and* a region, 11 with neither).

---

## 3. Every FK that references `master_wine_library`, with its delete behaviour

21 constraints. Read before writing, per rule 2 — even though **this repair
deletes nothing**, so no cascade can fire.

| referencing table.column | ON DELETE | col NOT NULL | rows pointing at a sim wine |
|---|---|---|---|
| `restaurant_inventory.master_wine_id` | **CASCADE** | yes | 80 (53 + 27) |
| `enrichment_queue.wine_id` | **CASCADE** | yes | 0 |
| `trending_wines.wine_id` | **CASCADE** | yes | 0 |
| `wine_aliases.canonical_id` | **CASCADE** | yes | 0 |
| `wine_menu_prices.wine_id` | **CASCADE** | yes | 0 |
| `wine_merge_log.keeper_id` | **CASCADE** | yes | 0 |
| `wine_popularity.wine_id` | **CASCADE** | yes | 0 |
| `wine_repair_log.wine_id` | **CASCADE** | yes | 0 |
| `inventory_events.master_wine_id` | SET NULL | no | 0 |
| `master_wine_library_submissions.matched_master_id` | SET NULL | no | 1 (Sim Bistro's, on `ac6a550f`) |
| `menu_items.wine_library_id` | SET NULL | no | **4 — all Sim Bistro, all on `ac6a550f`** |
| `one_tap_actions.related_wine_id` | SET NULL | no | 0 |
| `pos_catalog_match_proposals.candidate_master_wine_id` | SET NULL | no | 107 (all Sim Meyhouse) |
| `pos_item_mappings.master_wine_id` | SET NULL | no | 107 (all Sim Meyhouse) |
| `procurement_order_items.master_wine_id` | SET NULL | no | 0 |
| `cocktail_ingredients.wine_id` | NO ACTION | no | 0 |
| `master_wine_library.superseded_by` | NO ACTION | no | 0 |
| `price_history.master_wine_id` | NO ACTION | no | 0 |
| `sku_mappings.master_wine_id` | NO ACTION | no | 0 |
| `toast_item_mappings.master_wine_id` | NO ACTION | no | 0 |
| `vintage_substitution_rules.master_wine_id` | NO ACTION | yes | 0 |

**Two `master_wine_id` columns carry no FK at all** and are therefore invisible
to the list above — they were found by column search, not by `pg_constraint`:

| table.column | rows on a sim wine |
|---|---|
| `inventory_lots.master_wine_id` | 82 — Sim Meyhouse 54, Antalya 27, **Sim Bistro 1 (on `ac6a550f`)** |
| `pour_events.master_wine_id` | 47 — Sim Meyhouse 40, Antalya 6, **Sim Bistro 1 (on `ac6a550f`)** |

`wine_consumption_log` reaches a wine only through `inventory_id`, so it follows
the inventory row and needs no repoint (Antalya 12, Meyhouse 55).

### Triggers that will fire on the UPDATE — read, not assumed

| trigger | effect on this repair |
|---|---|
| `trg_sync_signature_hash` | recomputes `signature_hash`; picks the venue-scoped key when the owner is set. **This is the mechanism the repair relies on.** |
| `trg_wine_identity_status` | recomputes `identity_status`; Class A rows move `under_identified → normal` once the producer is NULL (they are excluded from matching by ownership instead). |
| `trg_wine_beverage_kind`, `set_wine_enrichment_observed_at`, `set_master_wine_library_search_vector`, `update_master_wine_library_updated_at`, `trg_library_tier_updated` | derived-state refreshes; harmless. |
| `trg_require_evidence_for_approval` | fires **only** on a transition into `review_status = 'approved'`. All 77 rows are `pending` and the repair does not touch `review_status`, so it cannot block. |

---

## 4. The cross-tenant link, and what it costs to unpick

`ac6a550f-cbff-5ea6-9672-8504127a2c89` — `HOUSE WHITE`, producer `''`
(empty string, *not* the name — which is exactly why the 0c quarantine never
caught it), vintage 2023, USA / California / Pinot Gris, `library_tier` 4,
`source` `sim`.

| tenant | what points at it |
|---|---|
| **Sim Bistro** `12823c23…` (out of scope) | `restaurant_inventory` 1 (`78412415-e9d9-5498-a47e-6ecbe051f5c1`), `inventory_lots` 1, `pour_events` 1, `menu_items` 4, `master_wine_library_submissions` 1 |
| **Sim Vanilla Kaleiçi** `684920db…` (in scope) | `restaurant_inventory` 1 (`3b9abad9-4c5d-46cc-8aab-89bc62f0f9c2`), `inventory_lots` 1, `pour_events` 2, `wine_consumption_log` 2 (via `inventory_id`) |
| Antalya `pos_item_mappings` | 36 rows, **`master_wine_id` NULL on all 36** — nothing to repoint |

The venue's own words, recovered from the harness that drove the night
(`lens-antalya/wines.py:44`, `api/05-bulk-load.json` index 0):

```
{"index":0,"status":"created","inventoryId":"3b9abad9-…",
 "masterWineId":"ac6a550f-…","wineName":"House White Wine",
 "libraryMatched":true,"libraryTier":4}
```

The venue wrote **"House White Wine"** — no producer, no vintage, no region.
`restaurant_inventory.wine_name` was then overwritten with `HOUSE WHITE`, the
other venue's spelling.

`wine_identity_is_specific(NULL,'House White Wine',NULL,NULL)` → **false**, so
under ADR 0130 this line is the venue's own provisional wine. Its key would be
`wine_provisional_signature_hash('684920db…', NULL,'House White Wine',NULL,NULL,NULL,NULL)`
= `5b9de120…` — **0 collisions** against the 4252 rows now in the table.

---

## 5. The plan (nothing written yet)

1. **Class A, 48 rows** — `provisional_for_restaurant_id := <the one tenant that
   references it>`, `producer := NULL`, `country := NULL`. The trigger rekeys
   them under `venue:<id>|`, so they can never again be another venue's match
   target, and the same venue rescanning its own menu still lands on its own row.
2. **Class B, 29 rows** — `country := NULL` only. Producer is real; the row stays
   in the shared library. This is precisely the backfill #318 deferred because it
   "cannot tell which rows it is repairing" — inside this scope it can: these 29
   rows were written by one code path, in one 3-day window, for two tenants, and
   `'Unknown'` there is a literal the code wrote, not a vendor string.
3. **The cross-link** — insert Antalya's own provisional row
   (`name 'House White Wine'`, producer/vintage/country/region/grape NULL,
   `provisional_for_restaurant_id = 684920db…`, `source 'menu_import'`,
   `library_tier 3`), repoint the venue's `restaurant_inventory` (1),
   `inventory_lots` (1) and `pour_events` (2) at it, and restore
   `restaurant_inventory.wine_name = 'House White Wine'`. `ac6a550f` and every
   Sim Bistro reference to it are left byte-identical.
4. **Nothing is deleted.** No cascade fires, no other tenant's row is altered.

### Collision check, run against production before writing

Predicted post-repair keys for all 77 rows, computed with the database's own
functions:

```
rows_repaired 77 | class_a 48 | class_b 29 | multi_tenant_rows 0
distinct_new_hashes 77 | collides_with_any_existing_row 0
```

`v_signature_drift` is **0 rows** now and must still be 0 after.

---

## 6. Listed, fingerprinted, and NOT touched

These are outside the authorised scope. Counts re-derived over the whole table
today, because the figures in #318's header were taken over a different
population (`memory/auth-users-and-public-users-are-disjoint`, "a true number
quoted outside its scope").

| set | fingerprint | count | why untouched |
|---|---|---|---|
| Older `country = 'Unknown'` | `source='menu_corpus'`, created 2026-08-14…16 | **251** | not written by the sim nights; #318 records that some may be genuine vendor/human strings |
| Older `producer = name` | `source='menu_corpus'` | **329** | same |
| …of which both faults | `source='menu_corpus' ∧ country='Unknown' ∧ producer=name` | 80 | same |
| `region = 'Unknown'` | `source='menu_corpus'` | 335 (of 340 table-wide) | same; **0** among the 77 in-scope rows |
| Sim Bistro's library rows | `source='sim'` | **81** | a third sim tenant, outside the authorised scope; 0 of them carry either fabrication |
| `ac6a550f-…` HOUSE WHITE | that id | 1 | shared with Sim Bistro — a shared row is never altered |
| Seed library | `source='wineops_basic_v1'` | 200 | untouched, 0 fabrications |

**A number in the brief that does not survive re-derivation.** The brief says the
"328 older `country='Unknown'` rows and the 48/77 producer-equals-name rows" are
to be listed and never touched. Measured today, `328` is the **table-wide** count
and it *contains* the 77 in-scope rows (328 = 251 menu_corpus + 77 menu_import);
`48/77` is the `menu_import` slice, i.e. **exactly the rows this repair is
authorised to fix**. Read literally, that clause would forbid the repair it
commissions. Resolved the only way both halves can be true: **repair = the 77
`menu_import` rows of the two named tenants; untouched = the 251 + 329
`menu_corpus` rows and everything else.** Flagged rather than quietly reconciled.

---

## 7. Table-wide before-counts, to compare against afterwards

```
master_wine_library                    4252   (664 soft-deleted)
  country = 'Unknown'                   328   -> expect 251
  region  = 'Unknown'                   340   -> expect 340 (unchanged)
  producer = name                       377   -> expect 329
  producer IS NULL                        0   -> expect 48
  country  IS NULL                        0   -> expect 77
  provisional_for_restaurant_id NOT NULL   0   -> expect 49 (48 + the new House White)
  source = 'menu_import'                 77   -> expect 78
  v_signature_drift                        0   -> expect 0
```

---

## Appendix A — Class A, the 48 rows whose producer is the wine's own name

Every one: `country = 'Unknown'`, `library_tier` 3, `identity_status`
`under_identified`, `review_status` `pending`, `source` `menu_import`,
`grape_variety` NULL, `bottle_size_ml` 750, `deleted_at` NULL.
`hash` is the first 8 hex of the current `signature_hash`.

| id | name | producer (fabricated) | vintage | country | region | grape | tenant | hash |
|---|---|---|---|---|---|---|---|---|
| 7418cfa2 | Antre | Antre | — | Unknown | ‘‘ Sauvignon Blanc’’ Izmir | — | Antalya | 985891f4 |
| f194617d | Chateau Kalpak | Chateau Kalpak | — | Unknown | ‘‘Cabernet Sauvignon, Merlot, Cabernet Franc, Petite Verdot’’thrace-Trakya | — | Antalya | d0c71b51 |
| 52780b70 | Dlc | Dlc | — | Unknown | “Cabernet Sauvignon,Merlot” Thrace-Trakya | — | Antalya | 6133737f |
| 391a9f87 | Doluca Bianca | Doluca Bianca | — | Unknown | — | — | Antalya | 3af89cf4 |
| ab3a8bce | House Red Wine | House Red Wine | — | Unknown | — | — | Antalya | 49a5a073 |
| 4203ad5e | House Rose | House Rose | — | Unknown | — | — | Antalya | 4a36e03a |
| f864d45b | Isabey | Isabey | — | Unknown | “Sauvignon Blanc” İzmir | — | Antalya | a4ef0218 |
| 41d85329 | Malbec | Malbec | — | Unknown | — | — | Antalya | 8bfa6866 |
| 556d299b | Moet & Chandon Brut Imperial Champagne | Moet & Chandon Brut Imperial Champagne | — | Unknown | — | — | Antalya | 2fe99efc |
| a47feb3a | Mon Réve Montepulciano | Mon Réve Montepulciano | — | Unknown | İzmir | — | Antalya | e4cd0272 |
| 37910e6c | Mon Réve Tempranillo | Mon Réve Tempranillo | — | Unknown | İzmir | — | Antalya | 4178023c |
| 3ac0495f | Pinot Grigio | Pinot Grigio | — | Unknown | — | — | Antalya | 99245db7 |
| 69ea7134 | Pinot Grigio Blush | Pinot Grigio Blush | — | Unknown | — | — | Antalya | e609d4b1 |
| c1284f64 | Pinot Noir | Pinot Noir | — | Unknown | — | — | Antalya | 335f63b9 |
| 83ba7a96 | Prosecco | Prosecco | — | Unknown | — | — | Antalya | a370f137 |
| 370bafc3 | Sarafin Cabernet | Sarafin Cabernet | — | Unknown | — | — | Antalya | 91927b2c |
| 41981c5c | Sarafin Chardonnay | Sarafin Chardonnay | — | Unknown | “Chardonnay” Tekirdağ | — | Antalya | 6d863f54 |
| 3b9a56d7 | Sarafin Shiraz | Sarafin Shiraz | — | Unknown | Tekirdağ | — | Antalya | e1b9def9 |
| 76fe3478 | Selection | Selection | — | Unknown | ‘‘Öküzgözü-Boğazkere’’ Eastern Anatolia | — | Antalya | 642064ce |
| 2a5c9998 | Signium | Signium | — | Unknown | ‘‘Chardonay, Viognier, Narince’’ Thrace-Trakya | — | Antalya | 6106264a |
| 4dca8d7b | Smyrna Blush | Smyrna Blush | — | Unknown | “Grenache-Shiraz” Izmir | — | Antalya | 632d709d |
| 40070b73 | Smyrna Merlot | Smyrna Merlot | — | Unknown | — | — | Antalya | f2d8e5fe |
| 7d874c96 | Smyrna Sauvignon Blanc | Smyrna Sauvignon Blanc | — | Unknown | — | — | Antalya | c479625f |
| 8f4649b9 | Smyrna Shiraz-Petit Verdot | Smyrna Shiraz-Petit Verdot | — | Unknown | — | — | Antalya | b4195f8a |
| d15e2fcb | Sultaniye | Sultaniye | — | Unknown | Demi Sec | — | Antalya | 7794a94b |
| 13e9fd51 | Vinkara | Vinkara | — | Unknown | “Hasandede” Ankara | — | Antalya | 3c2b8e6c |
| ec1ac07c | 2015 Centum, Syrah, Denizli | 2015 Centum, Syrah, Denizli | 2015 | Unknown | — | — | Meyhouse | ba693675 |
| d3c99869 | 2016 Tsantali, Rapsani Reserve, Red Blend, Rapsani | (same) | 2016 | Unknown | — | — | Meyhouse | 941f56b0 |
| 8aabf5a4 | 2017 Bodegas y Vinedos, Heras Cordon, Rioja | (same) | — | Unknown | — | — | Meyhouse | f24e12ae |
| 8af2dce1 | 2017 Chateau Rahoul, Graves | (same) | 2017 | Unknown | — | — | Meyhouse | 591335d6 |
| ae543217 | 2017 Prodom, Syrah-Petit Verdot-Cab.Franc, Aegean Coast | (same) | 2017 | Unknown | — | — | Meyhouse | a04c0ced |
| 7a2da6c4 | 2018 Sevilen 900, Fume Blanc, Denizli, Türkiye | (same) | 2018 | Unknown | — | — | Meyhouse | 54524789 |
| b29a7a84 | 2020 Costa Lazaridi, Cabernet Franc, Amethystos Cava, Drama | (same) | 2020 | Unknown | — | — | Meyhouse | de7b3aaa |
| 8c71ee03 | 2020 Marchesi Di Gresy, Barbaresco Martinenga | (same) | 2020 | Unknown | — | — | Meyhouse | 2b0c0af6 |
| e1bc5389 | 2020 Nev’i Şahsına Münasır Sui, Cabernet Blend, Kırklareli | (same) | 2020 | Unknown | — | — | Meyhouse | c0bebd1d |
| 2390a065 | 2020 Sottimano, Barbaresco Basarin | (same) | 2020 | Unknown | — | — | Meyhouse | 8d1cc7bb |
| dd57ef4c | 2021 Çamlija, Cabernet Sauvignon, Trakya | (same) | 2021 | Unknown | — | — | Meyhouse | 61867117 |
| 69d3ad13 | 2021 Chateau Peymouton, Saint-Emillion Grand Cru | (same) | 2021 | Unknown | — | — | Meyhouse | 125a322a |
| f98bf9ff | 2021 Hanzell Sebella, Moon Mountain | (same) | 2021 | Unknown | — | — | Meyhouse | c6983ed6 |
| c2080e7e | 2021 Kavaklıdere, Prestige Series, Kalecik Karası, Ankara | (same) | 2021 | Unknown | — | — | Meyhouse | 3667d8ba |
| 27f06b49 | 2021 Metier, Columbia Valley, Washington | (same) | 2021 | Unknown | — | — | Meyhouse | ce974bda |
| 5b7435ff | 2022 Gürbüz Winery, Blend #1 (Shiraz-Cabernet), Trakya | (same) | 2022 | Unknown | — | — | Meyhouse | 8ee65de9 |
| 3ccd190a | 2022 Gürbüz Winery, Kalecik Karası, Kalecik | (same) | 2022 | Unknown | — | — | Meyhouse | f370172c |
| 6344a92f | 2022 Isabey, Sauvignon Blanc, Aegean Coast | (same) | 2022 | Unknown | — | — | Meyhouse | e525f56b |
| 48d6739a | 2022 Lola, Cabernet Sauvignon, Napa Valley | (same) | 2022 | Unknown | — | — | Meyhouse | e32a9a70 |
| 20673646 | 2022 Scribe "Estate", Sonoma Valley | (same) | 2022 | Unknown | — | — | Meyhouse | ad16c3f1 |
| 8cf91189 | 2023 Çamlija, Kalecik Karası, Lüleburgaz | (same) | 2023 | Unknown | — | — | Meyhouse | acacb9fa |
| e1c49a54 | 2023 Gürbüz, Sauvignon Blanc-Muscat (Orange Wine), Tekirdağ | (same) | 2023 | Unknown | — | — | Meyhouse | c451accd |

26 Antalya + 22 Meyhouse = 48. `(same)` means `producer` is character-identical
to `name`; only the 21 rows whose `producer` differs by normalisation would show
a variant, and there are none.

## Appendix B — Class B, the 29 rows with a real producer and a fabricated country

`country = 'Unknown'` on all 29; `identity_status` `normal`; all Sim Meyhouse.
Only `country` is repaired; `producer`, `name`, `vintage`, `region`, `grape`
stay exactly as the venue gave them.

| id | name | producer (real) | vintage | region | grape | hash |
|---|---|---|---|---|---|---|
| 0bca90c3 | 2002 Estate Argyros, Vin Santo, Santorini, Greece | Estate Argyros | 2002 | Santorini, Greece | Assyrtiko | a761b9ac |
| 062708ae | 2017 Dolce “by Far Niente” Napa Valley | Far Niente | 2017 | Napa Valley | — | 0c26484d |
| d38f947e | 2019 Ink Grade “Andosol” Zinfandel Blend, Napa Valley | Ink Grade | 2019 | Napa Valley | Zinfandel Blend | c09d7d98 |
| d12b6086 | 2019 La Scolca, Gavi dei Gavi | La Scolca | 2019 | Gavi, Italy | Cortese | 01167dce |
| 0cfb56a0 | 2020 Chateau d’Yquem Premier Cru, Sauternes, France | Chateau d’Yquem | 2020 | Sauternes, France | — | 92e824a9 |
| c771ac32 | 2020 Nev’i Şahsına Münasır, Bordeaux Blend, Kırklareli, Türkiye | Nev’i Şahsına Münasır | 2020 | Kırklareli, Türkiye | Bordeaux Blend | b7c42cea |
| 40deb05b | 2020 Patz & Hall “Dutton Ranch”, Chardonnay, Russian River | Patz & Hall | 2020 | Russian River | Chardonnay | 7f4d6985 |
| 4c00062b | 2021 Gürbüz Winery, Kalecik Karası, Kalecik, Türkiye | Gürbüz Winery | 2021 | Kalecik, Türkiye | Kalecik Karası | 10652054 |
| 1d1d0597 | 2021 Serial “Defiance Vineyard” Cabernet Sauvignon, Paso Robles | Serial | 2021 | Paso Robles | Cabernet Sauvignon | ae8c38d1 |
| 21d0df48 | 2022 Aia Vecchie, Vermentino, Tuscany | Aia Vecchie | 2022 | Tuscany | Vermentino | 20296b51 |
| 8173b2cb | 2022 Goldeneye, Pinot Noir, Anderson Valley | Goldeneye | 2022 | Anderson Valley | Pinot Noir | 57d64fdf |
| dd9145f2 | 2022 Kvaszinger “Hatalos, Furmint, Tokaji, Hungary | Kvaszinger | 2022 | Tokaji, Hungary | Furmint | b5fd6d62 |
| 9e204cd9 | 2022, Schramsberg, Blanc de Blanc, North Coast | Schramsberg | 2022 | North Coast | — | 963d3e29 |
| 060cfb0d | 2023 Alexandrea, Areni, Armenia | Alexandrea | 2023 | Armenia | Areni | 8840b281 |
| 9badf757 | 2023 Duckhorn, Chardonnay, Napa Valley | Duckhorn | 2023 | Napa Valley | Chardonnay | 17e51da5 |
| b8348801 | 2023 Far Niente, Chardonnay, Napa Valley | Far Niente | 2023 | Napa Valley | Chardonnay | 18ae2f05 |
| 92fe87a0 | 2024 Fam. Torres, Pazo das Bruxas Albarino, Rias Baixas, Spain | Familia Torres | 2024 | Rias Baixas, Spain | Albariño | 786d39b3 |
| 22496a2b | 2024 Isabey, Sauvignon Blanc, Aegean Coast, Türkiye | Isabey | 2024 | Aegean Coast, Türkiye | Sauvignon Blanc | 065b8b30 |
| 866cc5c1 | Alvear Solera 1927, Pedro-Ximenez, Montilla-Mobriles, Spain | Alvear | — | Montilla-Moriles, Spain | Pedro Ximénez | 36f31f6e |
| 9b8f1b97 | Beylerbeyi Göbek | Beylerbeyi | — | — | — | c21e5c91 |
| e003abb6 | Efe Black | Efe | — | — | — | d4dd5ba2 |
| 807742e0 | Efe Green | Efe | — | — | — | c0355792 |
| 4a468a85 | Graham’s Tawny Porto | Graham’s | — | Douro, Portugal | — | 10349c47 |
| 892cf6a9 | Kvaszinger Tokaji Aszu, 6 Puttonyos, Hungary | Kvaszinger | — | Tokaji, Hungary | Furmint | 687b5e35 |
| fb00c95e | La Spinetta, Bricco Quaglia, Moscato D’Asti, Italy | La Spinetta | — | Asti, Italy | Moscato | 8151d5d7 |
| ad221b88 | NV, Billecart Salmon Brut La Rose, Champagne | Billecart-Salmon | — | Champagne | — | da4ab0f3 |
| 29eb6aef | NV, Billecart Salmon Brut, La Reserve, Champagne | Billecart-Salmon | — | Champagne | — | 3c7e137a |
| 1ff78077 | Sari Zeybek | Sari | — | — | — | f96d173a |
| 53c0acd6 | Yeni Rakı Ala | Yeni | — | — | — | 4bd45de1 |

**Noted, not repaired here.** Five of these (`Beylerbeyi Göbek`, `Efe Black`,
`Efe Green`, `Sari Zeybek`, `Yeni Rakı Ala`) are rakı, and their "producer" is
the first token of the name, split by the venue's own submission, not by
`producer || name`. They are outside the fabrication fingerprint — the value was
*supplied*, however poorly. Left alone and filed, per rule 3: a row carrying real
data is flagged, never quietly deleted and never quietly rewritten.
