# Michigan fixture — where these bytes came from, and what they are not

`michigan-lcc-price-book-2025-08-03.sample.json` — 24 rows lifted verbatim from a real Michigan
Liquor Control Commission spirits price book. **Values untouched.** Recorded 2026-09-05.

## The workbook

| | |
|---|---|
| Issuer | Michigan Liquor Control Commission (LARA) |
| Edition | **3 August 2025** — a date carried in the FILE NAME and nowhere inside the file |
| Origin URL | `https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/Price-Book/8-3-25-PRICE-BOOK-EXCEL.xlsx?rev=6561344f00d44408bc567ca5a7d4295f&hash=710272D34C87EC99F2A955007B8CF54C` |
| Obtained from | `https://web.archive.org/web/20250908021703id_/<origin URL>` — Internet Archive capture **2025-09-08 02:17:03 UTC**, HTTP 200 |
| Bytes | 804,270 |
| sha256 | `ff592f82db6c657caad03fb889dbfe2f0e234c8e5b82354b5687cd19f248c438` |
| Sheet | `CL20065`, 12,795 rows carried in the sheet XML, 12 columns |

## Why it came from an archive and not from the issuer

`www.michigan.gov` returns **HTTP 403** (`server: AkamaiGHost`; the CNAME chain is
`www.michigan.gov` -> `edgekey.michigan.gov` -> `e4514.ksd.akamaiedge.net`, Akamai Kona Site
Defender) to this repository's identifying fetcher — on the price-book page, on a direct PDF, and on
`robots.txt` itself. Re-measured 2026-09-05; the transcript is in the fetch log named by ADR 0117's
Michigan section. No browser User-Agent was ever sent and no block was routed around: the archive is a
different publisher serving the issuer's own bytes, and **nothing in this repository fetches
michigan.gov, or the archive, on a schedule.** The live path is a person's own download, through
`POST /price-index/upload`.

## What this fixture is FOR, and what it may never do

**Founder's call, 2026-09-05 (ADR 0117 Q21): "Acceptable for shape only, labelled; never for a
price line."** So, stated plainly:

- This fixture exists to prove that `parse-michigan.ts` reads a real MLCC workbook correctly.
  It proves a **parse**. That is its whole job.
- **No row derived from it may ever enter `price_index_postings`**, and none can. Two barriers,
  measured, of which only the second is load-bearing: (1) the fixture on disk is JSON, not a
  workbook, so the upload path cannot open it — real, but weak, since anyone can rebuild an
  `.xlsx` from these rows; (2) **the edition date**. The file name states 2025-08-03 against a
  105-day bound: 398 days stale on the day it was recorded, 763 a year later, and monotonically
  worse. There is no clock at which the staleness gate admits it. Asserted in
  `michigan-fixture-not-a-price.spec.ts`, including at 2099.
- There is no third barrier and this file does not pretend there is one. The fixture is not
  blocked because it is *the fixture*; it is blocked because it is *old*.

## What this fixture is NOT

It is **thirteen months old** and it is a *shape* fixture only. The book's measured cadence is
quarterly (91 days), so this edition is four editions stale and the staleness gate refuses it — which
is what `parse-michigan.spec.ts` asserts. **No price in this file may ever be shown to a house.**

## Full-file measurement, 2026-09-05

Command: a stdlib `zipfile` + `ElementTree` reader over all 12,795 rows (`$SP/xlsx.py`), no third-party
library, so the numbers below do not depend on the same code the gateway runs.

- 3 header rows | 1 blank spacer row | 261 category headings (including `(CONTINUED)` repeats) |
  **12,530 product rows**. (A reader that materialises XML-omitted empty rows within the used range,
  such as openpyxl or exceljs with `includeEmpty`, sees about 14,027 rows; the extra 1,232 are empty.)
- **Zero** rows with a missing or non-positive `SIZE IN ML`, `PACK SIZE`, `LICENSEE PRICE` or
  `BRAND NAME`; **zero** rows where `LICENSEE PRICE > BASE PRICE`; **zero** where
  `MINIMUM SHELF PRICE < LICENSEE PRICE`; **zero** duplicate liquor codes (12,530 distinct). This file
  is cleaner than either dataset ADR 0117 already parses.
- `LICENSEE PRICE / BASE PRICE`: median **0.949944**, min **0.9194**, max **0.9773** across all 12,530
  rows. The issuer's stated arithmetic is base less a 17% licensee discount plus 4%+4%+4% specific
  taxes, i.e. x0.95; the Commission rounds each step rather than applying one factor, so a couple of
  thousand rows miss the single-factor result by a cent. The parser therefore checks a **band**, never
  the formula.
- `MINIMUM SHELF PRICE / LICENSEE PRICE`: median **1.1790**, min **1.1628**, max **1.1930**.
- 517 rows carry `MI` in column A (a licensed Michigan distiller).
- `NEW/CHNG` holds `NEW` on 680 rows and, on others, a price change written inconsistently: `-10`,
  `0.97`, `1.00    NEW`, `(6.00)   NEW`. The parenthesised and minus-signed forms are not reconciled by
  the issuer's own documentation, so the parser reads only the `NEW` flag and keeps the raw string.

The workbook's `docProps/core.xml` names an individual LARA employee as its author. That is a third
party's personal data and it is **not** carried into this fixture or into any row.

## The 24 rows

Source row numbers `1, 2, 3, 4, 5, 6, 7, 9, 20, 24, 39, 60, 61, 64, 77, 78, 112, 144, 158, 159, 191,
206, 9685, 11621` — the three-line header, a blank spacer, a category heading, a `(CONTINUED)` heading,
and 18 product rows chosen to span every published size (50/100/200/375/700/750/1000/1750 ml) and pack
(1/3/6/12/24/48/60/72/120/144), both `MI`-distiller rows, a `NEW` row, all three `NEW/CHNG` change
notations, and the two rows at the extremes of the licensee/base ratio (0.9194 and 0.9773).
