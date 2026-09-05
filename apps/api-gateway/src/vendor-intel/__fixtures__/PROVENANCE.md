# Bottle-size fixtures — six real merchant pages, 2026-09-04

These back `bottle-size-fixtures.spec.ts`. Every byte in them came off a live
page on 2026-09-04; nothing was written by hand and no number, unit, name,
option, tag or price was altered.

## How they were fetched

`robots.txt` first, for every host, with the sweep's own identifying
user-agent `WineOpsBot/1.0 (+https://wineops.ai/bot; vendor price
intelligence)`; the group for that agent (else `*`) honoured for `Disallow`;
a floor of **10 seconds between requests to one host**, raised to the host's
own `Crawl-delay` where it published one. Three requests per host at most.
All six hosts publish Shopify's default robots.txt or none, and none of them
disallows `/products/`.

Two earlier waves are recorded here because their silence is evidence too:
`majestic.co.uk`, `thewhiskyexchange.com`, `thewinesociety.com`, `hawesko.de`,
`vinos.de`, `vinatis.com`, `drinksupermarket.com`, `astorwines.com`,
`totalwine.com`, `woodwinters.com` and `leaandsandeman.co.uk` all answered
**403** to this environment, and `masterofmalt.com` answered **429**. Those are
facts about our fetcher, not about their prices, and they are why the sample is
six and not sixteen.

## How each fixture was reduced, and why it was reduced at all

The original pages are 400–800 kB each and most of that is marketing prose,
which is the merchant's copyright and none of the reader's business. Each
fixture is therefore a mechanically produced subset — the rule below was
applied by a script, not by choosing, so a trap cannot have been trimmed away
to make the reader look good:

1. a provenance header (below);
2. `<title>` and every `<meta>` whose property or name begins `og:` or `product:`;
3. **every** `<script type="application/ld+json">` block, verbatim, except that
   the value of a known prose key (`description`, `body_html`, `content`, …)
   longer than 240 characters is replaced by a marker. Numbers, units, names,
   SKUs, options, tags and prices are never touched;
4. **every** other `<script>` whose body contains `"variants"`, on the same terms;
5. for **every** match of the signal pattern outside `<script>`/`<style>` — a
   number with a volume unit, the words "unit price", "per bottle/litre/75cl",
   or a currency amount — the smallest enclosing element of at least 220
   characters, capped at 4000. De-duplicated, and the count of matches skipped
   inside script/style is written into the header.

Each fixture's header carries the source URL, the fetch time in UTC, the HTTP
status, the **full page's byte count and sha256**, so any of them can be
re-fetched and compared against what was reduced.

| fixture | vendor | source URL | fetched (UTC) | HTTP | full bytes | sha256 | fixture bytes | windows |
|---|---|---|---|---|---|---|---|---|
| `bbr-cremant-de-limoux-2026-09-04.fixture.html` | Berry Bros. & Rudd (GB) | https://www.bbr.com/products-10008006303-berry-bros-and-rudd-cremant-de-limoux-by-antech-brut-languedoc | 2026-09-05T02:08:18Z | 200 | 800455 | `8ed0a15d25b5d865…` | 12086 | 8 |
| `bbr-dom-perignon-2026-09-04.fixture.html` | Berry Bros. & Rudd (GB) | https://www.bbr.com/products-20188000200-2018-champagne-dom-perignon-brut | 2026-09-05T02:08:33Z | 200 | 792405 | `f42b001320754266…` | 11389 | 9 |
| `slurp-pellehaut-rose-2026-09-04.fixture.html` | Slurp (GB, Shopify) | https://www.slurp.co.uk/products/2025-domaine-de-pellehaut-harmonie-de-gascogne-rose-10618604 | 2026-09-05T02:14:54Z | 200 | 417938 | `df4ea3d702bcabc7…` | 47235 | 38 |
| `tanners-andre-clouet-2026-09-04.fixture.html` | Tanners (GB, Shopify) | https://www.tanners-wines.co.uk/products/andre-clouet-silver-brut-nature-champagne-grand-cru-a-bouzy | 2026-09-05T02:15:16Z | 200 | 414215 | `e6726d66a5d23f03…` | 97149 | 59 |
| `hedonism-ruinart-2026-09-04.fixture.html` | Hedonism (GB, Shopify) | https://hedonism.co.uk/products/ruinart-blanc-de-blancs-nv | 2026-09-05T02:15:37Z | 200 | 617944 | `710c3d533997a794…` | 44916 | 29 |
| `winechateau-caymus-1l-2026-09-04.fixture.html` | Wine Chateau (US, Shopify) | https://www.winechateau.com/products/caymus-vineyards-cabernet-sauvignon-napa-valley-2023 | 2026-09-05T02:15:58Z | 200 | 522317 | `4dca8768b0835055…` | 68373 | 39 |

## What each one is here to prove

| fixture | what it carries |
|---|---|
| `bbr-cremant…` | a size in schema.org: `additionalProperty` → `{"Bottle Volume": "75 cl"}` and `{"Dutiable Volume (ml)": "750.0000"}`, inside the same `Product` node as a £15.50 `Offer`. The page's TEXT states no size at all, so this is the case HEAD cannot read by construction. |
| `bbr-dom-perignon…` | `og:title` "2018 Champagne Dom Pérignon, Brut", "Dom P" 29 times in the body — and one JSON-LD block describing **Caol Ila 25-Year-Old whisky** at £225, SKU `1000-01-00700-00-8086983`. Structured data that is confidently about another product. |
| `slurp-pellehaut…` | the size only in the variant option `1x75cl` (pack and volume in one statement), a `prodinfo-iconitem--slurp_volume` chip, and a product tag; **not** in the Shopify-default JSON-LD. `weight: 2000` on a 75cl rosé. |
| `tanners-andre-clouet…` | the size in a `title="Bottle size cl: 75"` attribute (label carries the unit, value is bare); a NEIGHBOURING product's `70cl` on a `class="… non-standard-size …"` badge; shipping copy reading "first case (up to 12 x 75cl)"; `weight: 75000`. |
| `hedonism-ruinart…` | the size in `class="text-block product__unit-size"`, and a duty table repeating "£2.87 per 75cl bottle", "£3.10 per 75cl bottle", "£11.47 per 70cl bottle" — four false unit-price labels. `weight: 1500`. |
| `winechateau-caymus-1l…` | a bottle that is **1000 ml**, stated in an option literally named `Size` and again in the product's own name ("1 Liter Bottle"); two different `og:title` values on one page; `weight: 2722`. |

## The reduction was checked against the originals

The obvious objection to a reduced fixture is that the reduction chose the
answer. It was measured instead: `readBottleSize` was run over each fixture and
over the whole recorded page it came from, and the two agree on all six —

```
  bbr-cremant-de-limoux-2026-09-04.fixture.html  fixture: 750ml via structured_offer     full page: 750ml via structured_offer     AGREE
  bbr-dom-perignon-2026-09-04.fixture.html       fixture: REFUSED no_bottle_volume       full page: REFUSED no_bottle_volume       AGREE
  slurp-pellehaut-rose-2026-09-04.fixture.html   fixture: 750ml via variant_option       full page: 750ml via variant_option       AGREE
  tanners-andre-clouet-2026-09-04.fixture.html   fixture: 750ml via spec_field           full page: 750ml via spec_field           AGREE
  hedonism-ruinart-2026-09-04.fixture.html       fixture: 750ml via spec_field           full page: 750ml via spec_field           AGREE
  winechateau-caymus-1l-2026-09-04.fixture.html  fixture: 1000ml via variant_option      full page: 1000ml via variant_option      AGREE
  agree 6/6
```

The whole pages are the recorded fetches, held outside the repository; the
sha256 in the table above is what ties a fixture to the page it came from.
Reading the largest of them end to end takes 13 ms.

## Reproducing the before/after measurement

The BEFORE half of the measurement in ADR 0117 was produced by loading
**verbatim `git show HEAD:` copies** of `common/html/html-to-text.ts` and
`vendor-intel/vendor-site-sighting.ts` from a scratch directory (only their
import paths rewritten) and running them over these same files. No file in the
worktree was reverted, stashed or checked out to produce it.
