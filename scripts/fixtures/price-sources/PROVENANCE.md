# Fixture provenance — price sources

Every byte in this directory was fetched from the URL named below on the date named
below and pasted verbatim. Nothing here is synthesised, hand-edited or rounded. The
rows were **chosen** to exercise the parser's refusals (see the "why this row" column);
the values inside them were not.

If you regenerate a fixture, replace this table row too. A fixture whose provenance line
is older than the file it describes is worse than no fixture: it makes a stale parse look
like a fresh one, which is the exact fault `scripts/fetch_price_sightings.py` exists to
refuse.

| File | Source | URL fetched | Fetched (UTC) | Rows | Format |
|---|---|---|---|---|---|
| `iowa-liquor-products-2026-09-01.sample.ndjson` | Iowa Alcoholic Beverages Division / Alcohol Operations Bureau, "Iowa Liquor Products" (dataset 1029) | `https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json` (303 → signed `storage.googleapis.com/iowa-datahub-prod/…`) | 2026-09-04 | 24 of 13,762 | NDJSON (one object per line) |
| `oregon-olcc-pricing-2026-09-01.sample.json` | Oregon Liquor & Cannabis Commission, "OLCC Monthly Pricing" (Socrata `vmf2-f83h`) | `https://data.oregon.gov/resource/vmf2-f83h.json?$limit=3` and `…?$where=asofdate='2026-09-01'&$limit=9&$offset=40` | 2026-09-04 | 12 of 3,856 for `asofdate = 2026-09-01` | JSON array |

## Licence and attribution

- **Iowa** — the federal catalogue records the dataset's licence as **Creative Commons
  Attribution 4.0** (`https://catalog.data.gov/dataset/iowa-liquor-products`, fetched
  2026-09-04). Attribution is therefore **required** on anything derived from it, and the
  parser carries `attribution` on every sighting for that reason. `data.iowa.gov` itself
  returned **403** to this environment's fetcher on 2026-09-04, so the licence is cited
  from the catalogue mirror rather than from the portal's own terms page. That is a
  weaker citation and is recorded as such.
- **Oregon** — the dataset's Socrata metadata
  (`https://data.oregon.gov/api/views/vmf2-f83h.json`, fetched 2026-09-04) declares
  `attribution: "Oregon Liquor & Cannabis Commission"` and **no licence at all**. Reuse
  terms are therefore *unstated*, not *permissive*, and the registry says so.

## Why each Iowa row is here

| `item_no` / category | Why this row |
|---|---|
| `100015` Whiskey Liqueur | 3,500 ml bag-in-box, `pack` 3 — a container the 750 ml reference unit flattens into a meaningless per-bottle figure |
| `100026` × 2 (Temporary & Specialty Packages, Imported Vodkas) | The same `item_no` published under two categories. 2,292 of the file's item numbers repeat this way; the parser keys on `item_no`, not on the category, so the second copy dedups away rather than doubling the sighting count |
| `920301` Single Barrel Bourbon | **The file's own error.** `state_bottle_cost` 1250 against `state_case_cost` 240 on a `pack` of 6. A parser that trusted the bottle figure writes $1,250 for a $60 bottle. This is the row the consistency check exists for |
| `986503` Straight Bourbon | Highest retail/cost ratio in the file (3.13× against a median of exactly 1.50) |
| `810000` Blended Whiskies | `bottle_volume_ml` is **0**. Eleven rows in the file are like this. Zero is not a volume, and writing it as one produces a division the register cannot defend |
| `980018` Flavored Rum | `pack` 120 of 50 ml minis — the largest pack in the file |
| the remaining 17 | Unremarkable 375/750/1000/1750 ml rows at pack 6 or 12, taken verbatim in file order, so the happy path is measured against real data and not against the edge cases alone |
