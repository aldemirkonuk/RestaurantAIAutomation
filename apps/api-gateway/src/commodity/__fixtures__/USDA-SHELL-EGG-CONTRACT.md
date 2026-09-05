# The USDA shell-egg fixture contract — what the human download must be

**No bytes of this report exist in this repository, and no code here will ever
fetch them.** `https://www.ams.usda.gov/robots.txt` returned HTTP **403** on
2026-09-04 and again on 2026-09-05, and this repository's rule is that a host
whose crawl rules cannot be read may not be fetched
(`price-sources.md`, K&L Wine Merchants / Majestic / Tesco).

The founder's answer to phase 0's Q1, 2026-09-05: **a one-off human read,
logged** — a person downloads the file once, by hand, in a browser, and it
becomes a recorded fixture carrying who, when and the hash. This file is the
contract that download has to satisfy. `parse-usda-shell-egg.ts` is written
against it **and against the format the plan recorded from three one-off
research reads**, so that the day the file lands nothing else has to change.

---

## What to download

| | |
|---|---|
| Report | USDA AMS **Daily National Shell Egg Index Report (5-day rolling average)**, report id **2843** |
| URL | `https://www.ams.usda.gov/mnreports/ams_2843.pdf` (the same report is `viewReport/2843` on My Market News) |
| How | **By hand, in a browser.** Not `curl`, not a script, not a scheduled job |
| Where to put it | `p4-scratch/p4bb-fixtures/` |

## What must be recorded beside it

Four facts, in a file named `USDA-SHELL-EGG-PROVENANCE.md` next to the download,
following the shape `COMMODITY-PROVENANCE.md` already uses for FAO and ONS:

1. **Who** downloaded it — a person's name, not "a builder".
2. **When** — the instant, with a timezone.
3. **The sha256 of the whole file**, before any reduction.
4. **The byte count**, and the reduction if the fixture committed here is
   reduced (state exactly which rows were kept, verbatim).

A fixture that arrives without all four is not a recording and this register
will not treat it as one.

## What the parser needs to see in it

The parser refuses the whole payload — it does not admit a partial one — unless
**all three** of these are present. Each refusal is named.

| Must contain | Why the parser refuses without it |
|---|---|
| `Report for: MM/DD/YYYY` | This series is **daily**, with a five-day rolling average behind it. An undated read is the entire signal missing, and it is worse here than anywhere else in the register. Refusal: `no_report_date` |
| `Cents Per Dozen` on the face of the table | ADR 0117: a sighting names its unit. A cents figure read as dollars is off by a hundred. Refusal: `unit_not_stated` |
| `FOB` on the face of the table | Which trade level a price is at is what stops a wholesale number being compared with a retail one. On eggs, measured 2026-09-05, those two differed by **6.3x** on the same day. Refusal: `trade_level_not_stated` |

And exactly one row that reads as **graded loose, white, Large** — the three
words on one line, excluding "extra large" and "x-large". Two matching rows are
refused as `ambiguous_row` rather than resolved by taking the first: picking
between two rows that both claim to be the series is how a register starts
holding the wrong number. No matching row is `row_not_found`, which is a report
whose layout the parser does not recognise and never "a day the market was
quiet".

## Which number on that row

**The weighted average**, which the plan records as the column after the price
range: *class, colour, size, volume, price range, **weighted average**, change,
last reported, year ago*.

The parser strips ranges (`34.50-36.00`) first and takes the first remaining
decimal. It deliberately does **not** take the largest number on the line: on
the 2026-09-04 report the year-ago column reads **215.53** against a weighted
average of **35.28** — a six-fold error that would look entirely plausible on a
screen.

## The check that proves the fixture is the right one

On the report the plan read (**Fri Sep 4, 2026**, *Report for: 09/04/2026*), the
graded loose / white / Large weighted average is **35.28** cents per dozen, with
a change of **-0.86** and a year-ago figure of **215.53**. A download of that
same day's report that parses to anything else means the parser and the report
disagree, and the parser is what changes.

## What flips when it lands

1. Drop the recorded fixture into `__fixtures__/` beside FAO's and ONS's, with
   its provenance file.
2. Set `awaitingHumanDownload: false` on the series in `commodity.registry.ts`.
3. Nothing else. `parserFor()` already routes this series to
   `parse-usda-shell-egg.ts`, the admission gate already skips the base check
   for a price series, and the staleness bound is already the 5 days a daily
   report is allowed.

**It still may not be armed for alerting after that.** Every threshold
measurement behind this design was made on **monthly** series, and a daily
series' move distribution is not a monthly one's. Arming it on a
monthly-derived number would be a threshold that means something other than
what it says — so it is admitted to the register, shown as a context line, and
left unarmed until its own daily history is long enough to read a threshold off.
