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

## The source with no fixture, and why

**USDA AMS Daily National Shell Egg Index** is registered (`admission = 'upload_only'`,
`armed = false`) and **has no fixture and no parser here.**
`https://www.ams.usda.gov/robots.txt` returned HTTP **403** on 2026-09-04 and again on
2026-09-05, and this repo's own rule — recorded in `price-sources.md` for K&L Wine
Merchants, Majestic and Tesco — is that a host whose crawl rules cannot be read may not
be fetched. **This task did not contact that host at all.** Building a parser would have
required bytes it may not go and get, so the series carries the 403 as its
`withheld_reason` and waits for a person to bring the file, exactly as the Michigan
price book does.
