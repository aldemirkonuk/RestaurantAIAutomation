# 0273 — An own-paper price is dated by the invoice it was read from

- **Status:** Proposed 2026-10-03. Three things here are the build lane's picks, **not founder answers**: placing the issue date at 12:00 UTC, the one-day tolerance for a future issue date, and giving `price_history.effective_date` the same date. Fork F3 (whether a class-A row's `observed_at` holds the paper's date at all) is recorded as option (a), Proposed, so the founder can overturn it.
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** observed_at, effective_date, doc_date, issueDate, document_corrections, match_verified_at, verifyReceipt, dateReceiptSighting, pickReceiptPaper, receiptPaperFor, dateBasis, dateSentence, invoice_issue_date, invoice_issue_date_corrected, verified_at, price_history, belowTrailingAverage, own paper, class A, AW05, A-038
- **Links:** [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] (the five things a sighting names; :264-265 "when they published it"); [[0104-every-incoming-document-renders-as-one-canonical-mudavym-document]] D5 (corrections are append-only; the latest wins); [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] §112 fork 6(a) (an own-paper row names its paper); [[0240-register-entries-are-fragments]] (F3: forks stay in their ADR, not a new register row); `claims.d/fix-price-sighting-dated-by-issue.jsonl:1`; branch `fix/price-sighting-dated-by-issue`; analytics-walk finding AW05 / A-038 (2026-10-03).

## Context

A verified receipt writes an own-paper (class A) price sighting. At `8c673db4b` it dated that row by the moment a person checked the paper: `observedAt: update.match_verified_at` (`procurement.service.ts:6909` @8c673db4b). The comment above it gave the reason: "`procurement_documents` carries no issued-date column this path can read". That is false. `procurement_documents.doc_date` is a `date` column (`supabase/migrations/20260805000000_baseline_from_production.sql:4433`), and the header issue date can be corrected through `document_corrections` (`field_path = 'issueDate'`, ADR 0104 D5).

The code's own rule for class A says otherwise as well. `observed_at` is "the event's own date, never `now()`" (`own-paper-sighting.ts:40`), and a sighting "must carry the date its own paper carries" (`own-paper-sighting.ts:357-358` @8c673db4b). ADR 0117:264-265 requires the row to name "when they published it".

Every price window reads `observed_at`: `belowTrailingAverage` (`vendor-comparison.service.ts:651`, `.gte("observed_at", from)` at :669), the outlier re-judge (`outlier-rejudge.service.ts:137`), the market-price producer (`market-price.producer.ts:358`) and promotions (`promotions.service.ts:497`). So a July invoice checked in September counted as September's price. A-038 measured the result on the sim house: the below-average box counted the same 25 sightings in its 30, 95 and 365-day windows.

## Options considered

1. **Keep the check time.** No change. Its stated reason is false, and every window keeps counting old paper as new.
2. **The class-C pattern** (ADR 0117:115-130, the vendor-site rule): `observed_at` stays our clock, the issue date goes only to `effective_date`, and the readers switch to `effective_date` for class A. The four readers above would change, and every chart would still plot the check date. The class-C reason was a date claimed on a page nobody here checked. Here a person has checked this paper, and its issue date can be fixed through the correction door. *This is fork F3; it remains open.*
3. **The delivery date.** `procurement_orders.delivered_at` is stamped when the receipt is typed in (AW03), so today it equals the check time. How far a captured time can be trusted is fork C02.
4. **Midnight UTC on the issue day.** In the Americas that instant falls on the previous calendar day (the F-086 class of bug).
5. **Any linked invoice's date, when several agree.** That ties the date to paper the row does not name. ADR 0160 §112 fork 6(a) makes the row name exactly one paper, and `pickReceiptPaper` already names it.
6. **Only reviewed invoices' dates.** Most door checks happen before accounts-payable review, so most rows would fall back.

## Decision

A verified receipt's price is dated by the issue date of the one live invoice that `pickReceiptPaper` names. The issue date is that invoice's `doc_date` with the latest `kind = 'correction'` row on `issueDate` laid over it. The price is dated by the check time only when no usable issue date exists, and the row says why.

- **The issue date and how it is placed.** `observed_at` is the issue date at 12:00 UTC, but never later than the check: `min(issue 12:00Z, verifiedAt)`. `effective_date` is the issue date itself (`dateReceiptSighting`, `own-paper-sighting.ts:693`). Noon keeps the calendar day the same from UTC−12 to UTC+11.
- **When the check time is used.** Each case writes its own sentence:
  - no invoice is named (none attached, or several and none named);
  - the invoice has no date on record, or a person corrected the date to none;
  - the date is not a strict `YYYY-MM-DD` calendar date (a correction typed as `14.08.2026` is refused, not parsed);
  - the date is more than one calendar day after the UTC day of the check (`ISSUE_DATE_FUTURE_TOLERANCE_DAYS = 1`; the day after is tolerated for time-zone skew);
  - the documents or corrections read failed. This sentence says it was a failed read, not an invoice without a date.
- **What the row records.** `raw.dateBasis` (`invoice_issue_date` | `invoice_issue_date_corrected` | `verified_at`), `raw.dateSentence`, `raw.verifiedAt` (our clock, always kept) and `raw.issueDate`.
- **The content hash** is keyed on the dated day, not the day of the check. Re-checking the same paper on another day is not a new sighting.
- **`price_history.effective_date`** takes the same date (`procurement.service.ts:1866`). The two registers then agree on which day a price belongs to.
- **The compare DTO** maps `dateBasis`, `dateSentence`, `issueDate` and `verifiedAt` from `raw` (`observationDating`, `vendor-comparison.service.ts:1134`). It accepts only the three known bases; anything else maps to null. The web sighting sheet says which date was used: "dated 15 Jul 2026, the invoice's issue date (checked 3 Sept 2026)", or "dated when it was checked, …: <reason>" (`whenWords`, `vp-register.ts:276`).

What carried it: the column exists and the code's own class-A rule already demands it. Of the six options it is the only one that fixes the windows without changing four readers.

## Consequences

- **Easier.** Windows, trends, charts and the market producer read the paper's date. An invoice checked late is no longer "news" in a 30-day box. The spec `own-paper-sighting.spec.ts` runs the real `belowTrailingAverage` over the writer's own row: a 2026-07-15 invoice checked on 2026-09-03 drops out of 30 days and is inside 95.
- **The A-038 numbers in the sim house do not move.** Its door checks file no invoice, so every one of its sightings falls back to the check time, and now says so (fork F1).
- **No lower bound.** An issue date misread into a past year dates the row into that past. The remedy is the correction door, not a guess.
- **A second row on re-check.** An old receipt re-verified after this change hashes on its issue day rather than its check day. It therefore writes a second, correctly dated row beside the old one, instead of being deduplicated against it.
- **Not re-dated:** a correction made after the check, and rows written before this change (fork F2). Those carry no `dateBasis`, and the page keeps its plain "seen" wording for them.
- **Unchanged:** the `order_confirmed` sighting is still dated at confirmation, and the AW03 `delivered_at` half is not touched here.
- **Revisit when:** the founder answers F1, F2 or F3; C02 rules on how old a capture time may be trusted; or an issue date older than a year shows up on a fresh check (that is the signal for a lower bound).

## Forks

- **F1 — A door check with no invoice filed: date it by the delivery's capture time instead of the check time? OPEN.** (a) Keep the check time, with `raw.dateSentence` saying why. This is what ships. (b) Use the receipt event's `client_captured_at` within the C02 trust limit. (c) Use `delivered_at` once AW03 stops stamping `now()`. Recommendation: (a) now, and (b) after C02.
- **F2 — Re-date own-paper rows already on the register? OPEN.** (a) Forward only; this is what ships. (b) A migration over rows with `raw.origin = 'own_paper'` and a `document_id` whose date is set. That would be a production data write that runs on merge, so it needs the founder's word. Recommendation: (a). The sim house names no paper, so (b) would change nothing there.
- **F3 — Does a class-A row's `observed_at` hold the paper's date? Proposed (a), OPEN for the founder.**
  - (a) Yes. `observed_at` and `effective_date` both take it, and `raw.verifiedAt` keeps our clock.
  - (b) The class-C pattern (option 2). The strongest evidence for (b) is on record and is not hidden here:
    - the `observed_at` column comment reads "When we saw it vs when the price applies" (`20260805154027_vendor_price_observations.sql:75-77`);
    - ADR 0117's provenance table maps `fetched_at -> observed_at` (:420).
  - If he picks (b), this lane shrinks to writing `effective_date` and the basis, and the A-038 window fix moves to the readers.

These are recorded here, not as new OPEN-DECISIONS rows (ADR 0240 F3).

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created (Proposed) with the build on `fix/price-sighting-dated-by-issue`; numbered 0273 because 0271 (logs lane) and 0272 (sig lane) were taken at build time |
