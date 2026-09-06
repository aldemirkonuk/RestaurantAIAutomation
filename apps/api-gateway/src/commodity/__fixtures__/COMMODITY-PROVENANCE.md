# Where these fixtures came from

Both files are **reductions of bytes actually fetched on 2026-09-05**, not
hand-written samples. The reduction is stated for each so anyone can re-fetch the
source and reproduce it. The full fetch log — with the `robots.txt` read before each
host's data, statuses and byte counts — is `p4-scratch/p4bb-fetch-log.md`.

The shape follows ADR 0126's EDI 832 precedent: a fixture names its source URL, the
instant it was fetched, the hash of the **whole** payload, and exactly what was cut.

---

## `fao-food-price-index-2026-09-05.sample.csv`

| | |
|---|---|
| Source URL | `https://www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_indices_data.csv` |
| Fetched | 2026-09-05, `curl`, HTTP **200** |
| Full payload | **48,006 bytes**, sha256 `746104cf59d2de5582d147a54b0f0c5ba798a371e9be7f8a1e1b38d1aaacc62f` |
| Full payload shape | 444 lines: 3 header lines, 1 blank, **440 monthly rows** `1990-01` … `2026-08` |
| `robots.txt` | `https://www.fao.org/robots.txt` **200**, 1,056 bytes, sha256 `4813213a20ec84cce0d745b196d12cfc0f68988d591b5dd4ead1c61f16cec8a9`. One `User-agent: *` group disallowing `/index.php`, `/t3lib/`, `/typo3/`, `/*?id=*`, `/*&type=98` and two `/fileadmin/user_upload/` paths. **No `Crawl-delay`. The `/media/docs/` path above is not disallowed.** |
| Licence | **Unstated.** The page's footer is "© FAO 2026" with a general terms link and declares no licence for the CSV. Recorded as `unstated`, never as permissive |
| Reduction | The **3 header lines and the blank line verbatim**, then the **last 40 monthly rows** (`2023-05` … `2026-08`). 400 older rows removed. Nothing else altered — no reformatting, no column trimming, the trailing commas kept |
| This file | 4,613 bytes, sha256 `9389af9fad5e9e2dfe9951241d3ecd5053030ad8e645fd41b476586717ef9f3a` |

**Why 40 rows.** The alert arithmetic's baseline is `K = 12` observations and its
history floor is `K + 2`; 40 exercises the baseline, the floor, and a window that is
comfortably longer than either, without carrying 36 years of a public index into the
repository.

**What this file proves that a hand-written sample could not.** The FAO CSV
**states no publication date of any kind** — line 1 is the title, line 2 is the base
period `2014-2016=100`, line 3 is the column header, line 4 is blank. That is the
measured reason this series is `issued_at_basis = 'fetch_date'` and the screen says
"read on" rather than "issued".

**The trap this file is the control for.** FAO serves a **second** live CSV path,
`/fileadmin/templates/worldfood/Reports_and_docs/Food_price_indices_data.csv`, which
also returns HTTP 200, is also well-formed, is 14,225 bytes, is on base
**2002-2004=100**, and whose last row is **`Mar-18`**. Neither path is disallowed by
robots. **Those bytes were not fetched by this task** and no fixture of them exists
here; the base-change refusal is exercised in `parse-fao.spec.ts` by altering this
recorded file's own base line, and the test says so rather than claiming a recording
it does not have.

---

## `ons-d7bu-2026-09-05.sample.json`

| | |
|---|---|
| Source URL | `https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bu/mm23/data` |
| Fetched | 2026-09-05, `curl`, HTTP **200** |
| Full payload | **125,504 bytes**, sha256 `e8fba154dae1c7ea5b86e5b40f0642d69a2aeb0c8c5992e1e7a4457711f29f1b` |
| Full payload shape | `description` + **463 monthly observations** `1988 JAN` … `2026 JUL`, plus `years`, `quarters`, `sourceDatasets`, `relatedDatasets`, `relatedDocuments`, `relatedData`, `versions` |
| `robots.txt` | `https://www.ons.gov.uk/robots.txt` returns **HTTP 404** (the body is the ONS "Page not found" page, 101,929 bytes). Under RFC 9309 §2.3.1.3 a 4xx means no restrictions — the same reading this repo already applies to `ilcc.illinois.gov`. Recorded as *unrestricted because absent*, never as *permissive because stated* |
| Licence | **Open Government Licence v3.0.** The attribution string travels on the series row |
| Reduction | `description`, `type` and `uri` **verbatim**; `months` cut to the **last 40** (`2023 APR` … `2026 JUL`); `years` and `quarters` emptied; the four `related*` arrays, `sourceDatasets` and `versions` dropped entirely — the parser reads none of them |
| This file | 10,316 bytes, sha256 `be0afb8f85568a3c7e4d642155698ec4890cae56118da57978664b1bcda42992` |

**What this file proves.** ONS states **two** dates the FAO CSV does not have: a
series-level `description.releaseDate` (`2026-08-18T23:00:00.000Z`) and an
`updateDate` on **every observation**. So this series is `issued_at_basis =
'issuer_stated'` and earns the word "issued". Its declared `unit` is
`"Index, base year = 100"` — **26 characters**, which is on its own why it could
never have entered `price_index_postings`, whose `price_unit` is `VARCHAR(24)`.

---

## `usda-ams-2843-2026-09-04.report-detail-weighted.tsv`

**The file landed on 2026-09-05, brought by a person, and it is not the PDF.**

| | |
|---|---|
| **Who** | Claude Fable 5.1, the parent session, through the app's Browser pane — on the founder's batch-57 rule, *a one-off human read, logged*. **No fetcher, script or job touched the host.** |
| **When** | 2026-09-05T22:40:20Z |
| **sha256** (whole file) | `0371c7c7e617683adb37d6ab22e0c6245e6784055c0657181d83d43df423d49c` |
| **Bytes** | **9,115** — header plus **23 data rows**, every row verbatim as the page rendered it |
| Source URL | `https://mymarketnews.ams.usda.gov/public_data?slug_id=2843` |
| Reduction | Page chrome (filters, pagination, footer links) dropped; the table header and all 23 rows kept verbatim, tab-separated as the page text renders them |

**IT IS THE HTML DATA VIEW, NOT THE PDF.**
`https://www.ams.usda.gov/mnreports/ams_2843.pdf` answers a browser with a file-download
dialog the pane cannot complete, so the same report was read through My Market News
instead: report **Daily National Shell Egg Index Report (5-day rolling average)** (slug
2843, `AMS_2843`), section **Report Detail Weighted**, Report Begin Date = Report End Date
= **2026-09-04**, published 09/04/2026 08:03:53, **Final**. The page stated *Total Rows
returned in this view: 23 - Total Rows available: 23*, and all 23 are in the file.

### Two things the contract did not foresee, and the second was a live bug

**1. The facts arrive as COLUMNS, not as the PDF's face text.** `Report Date` is a column
on every row; `Price Unit` reads `Cents Per Dozen` on every row; `Freight` reads `FOB` or
`Delivered` **per row**. The contract asked the parser to find all three in prose above the
table, and against this file that parser would have refused three times over.

**2. THREE rows are graded loose, white and Large** — so the contract's own `ambiguous_row`
refusal would have fired on the real file, exactly as it was written to:

| Environment | Origin | Freight | Wtd Avg Price |
|---|---|---|---|
| Cage-Free | California | Delivered | **50.46** |
| Cage-Free | National | FOB | **28.67** |
| **Caged** | **National** | **FOB** | **35.28** — the series the plan recorded |

Selecting on "white Large" alone would take whichever came first, and a cage-free
California *delivered* price is a different market: **50.46 against 35.28, a 43 percent
error that looks entirely ordinary on a screen.** So the selection is a **six-part tuple** —
egg type, environment, colour, class, origin, freight — declared on the series and matched
exactly, with more-than-one refused as `ambiguous_row` and none as `row_not_found`.

The chosen row's neighbours confirm the plan's own note: `Wtd Avg Price Previous` **36.14**
(35.28 minus 36.14 = **-0.86**), `Wtd Avg Price Last Year` **215.53**, `Volume` 33,234.
Those two are read and **deliberately not written as observations**: they are the issuer
restating other dates, and writing them would post one number twice under two periods.

**Eight of the 23 rows carry an EMPTY `Wtd Avg Price`.** `Number("")` is 0, so an empty cell
read as a value would post a price of zero cents a dozen. It is refused as `no_value` with
the words *"that market did not report on this date - it is not a price of zero"*.

The count was written here as **six** until 2026-09-06 and was wrong. Measured:
`awk -F'\t' 'NR>1 && $28==""' usda-ams-2843-2026-09-04.report-detail-weighted.tsv | wc -l`
→ **8** (column 28 is `Wtd Avg Price`), at data rows **1, 2, 3, 11, 18, 19, 20, 23**. Nothing
broke, because no code path depended on the number — which is exactly why it survived: it was
prose in four places and an assertion in none. `parse-usda-shell-egg.spec.ts` now asserts the
parser refuses **exactly eight** rows with `no_value`, so the number is pinned by a run.

### What the landing did NOT change

`admission` stays **`upload_only`** and `www.ams.usda.gov/robots.txt` still returns **403**.
A one-off human read is not a cadence: the series publishes **daily** and this register
holds one day of it. `awaitingHumanDownload` flipped to `false` — which says *the parser has
seen real bytes*, never *this source is now on a schedule*.

---

## `tuik-tt01-cpi-food-2026-09-05.sample.csv`

| | |
|---|---|
| Source URL | `https://nsiws.tuik.gov.tr/rest/data/TR,DF_TUFE_SDMX_TT01,1.0/TR.M.2.1._Z.2025.2026_01._Z.01.F_TFE?format=SDMX-CSV&startPeriod=2026-01` |
| Fetched | 2026-09-05T22:20:00Z, **by the parent, once, with the founder's own API key**, HTTP **200** |
| Bytes | **891**, sha256 `5760a5fa969a27ea8d88000f593abf3d75d70491bad7308e6692dd139072a2d9` |
| Shape | 1 header line + **8 monthly rows**, `2026-01` … `2026-08`, `OBS_VALUE` 117.26 … **134.31** |
| Reduction | **NONE. This is the whole response, verbatim.** `startPeriod=2026-01` is what made it small; the unbounded call for the same key is 455,666 bytes |
| `robots.txt` | `https://nsiws.tuik.gov.tr/robots.txt` returns **HTTP 401**, 48 bytes, `{"status":401,"message":"Unauthorized"}` — **the host will not tell an unauthenticated client its crawl rules at all.** That is a fourth distinct answer, beside FAO's 200, ONS's 404 and USDA AMS's 403, and it is recorded as itself |
| Licence | TÜİK states none on the service or in the manual. The only statement is the site-wide legal notice at `https://www.tuik.gov.tr/Kurumsal/Yasal_Uyari` (200, 127,628 B): re-use is possible **provided the source is cited**, and all rights remain TÜİK's. Recorded as `attribution_required`, and the attribution string is OURS because TÜİK prescribes none |
| Credential | Required. A Keycloak token from `https://giris.tuik.gov.tr/realms/web/protocol/openid-connect/token`, client `nsi-ws-consumer`, `grant_type=password` + `api_key`. **The key is never in this repository**: it lives in `TUIK_SDMX_API_KEY` and the register stores only that name |

**The ten dimensions, in the order the payload uses them** — read off these real
bytes, not off the service's `/structure` call, which advertises **six**:

```
REF_AREA . FREQ . SINIFLAMA_DUZEYI . DEGISIM . OZEL_KAPSAM_TUFE
         . BASE_PER . YAYIM_DONEMI . COICOP_1999 . COICOP_2018 . INDICATOR
```

Building a key from `/structure` produces a wrong key that still looks right.
`parse-tuik-sdmx.spec.ts` pins this order against this file.

**Two things this file proves that no amount of documentation would.**

1. **`UNIT_MEASURE` is EMPTY on every row.** The payload does not say that
   `DEGISIM=1` is an index level and `DEGISIM=2` a monthly percentage change. A
   parser that trusted the file would put a 0.22 beside a 134.31 and both would
   look like data. So `DEGISIM` is hard-coded in the registry and anything else
   is refused by name.
2. **`BASE_PER` reads `2025`**, and TÜİK moved this series off `2003=100` within
   the last year with **both bases still published**. The base is read back out
   of the file and compared against the register's — the same gate that catches
   FAO's second, older, still-live CSV path.

## `tuik-tt09-beverage-subclasses-2026-09-05.sample.csv`

Reduced from the researcher's `p4bg-fixtures/tt09-expenditure-groups.csv`
(HTTP 200, **7,532,768 bytes**, 84,500 rows, sha256 `d3882cb3…50875f8b`, fetched
2026-09-05 through TÜİK's keyless Data Explorer). The header verbatim plus the
rows for the three beverage subclasses at `2026-08`.

**Their labels are NOT in this file and were never read.** The Data Explorer's
view for TT09 went blank on five attempts and the codelist endpoint answers 401.
So the register holds `02110`, `02121` and `02130` as **codes**, with a sentence
saying the labels are unread, and nothing anywhere names them. Guessing that
`02130` is wine would be inventing a fact about a tax-adjacent series.
