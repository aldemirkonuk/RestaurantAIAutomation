# Canonical corpus run — 2026-09-04

**3 documents read; 0 named invariant failure(s); 11 of 14 invariants UNTESTABLE on every document (0 lines extracted in total)**

- Source: `exzueerziesmczwlhomd.supabase.co` (read-only; nothing was written)
- `procurement_documents`: 3 rows
- `procurement_document_lines`: 0 rows
- `vendor-attachments` bucket: 1 objects

> **Schema lag, named.** This database has not applied migration
> `20260904120000`, so `price_base_qty`, `price_base_uom` and the
> `printed` literals could not be read. Every BT-149/BT-150 and every
> `as printed` below is absent BECAUSE IT COULD NOT BE STORED — not
> because the document printed none. The two are different findings and
> this run is the first kind.

## Per-invariant results

| invariant | rule | holds | fails | untestable |
| --- | --- | ---: | ---: | ---: |
| `amount_due` | — | 0 | 0 | 3 |
| `as_printed_not_mutated` | — | 3 | 0 | 0 |
| `credit_memo_references_invoice` | — | 0 | 0 | 3 |
| `currency_present_when_money` | — | 3 | 0 | 0 |
| `deposits_coded_and_excluded` | — | 0 | 0 | 3 |
| `document_lines_total` | — | 3 | 0 | 0 |
| `free_goods_zero_net` | — | 0 | 0 | 3 |
| `received_never_assumed` | — | 0 | 0 | 3 |
| `total_with_vat` | — | 0 | 0 | 3 |
| `total_without_vat` | — | 0 | 0 | 3 |
| `vat_breakdown_present` | — | 0 | 0 | 3 |
| `vat_category_tax_amount` | — | 0 | 0 | 3 |
| `vat_category_taxable_base` | — | 0 | 0 | 3 |
| `vat_total_matches_breakdown` | — | 0 | 0 | 3 |

`untestable` is counted separately on purpose: a document that states
no total did not pass the tie-out, it was never testable.

## Named failures

None. Every checkable rule held on every document read.

## Intake shape (ADR 0104 D6 will set its thresholds on this)

- sha256 present on 3 of 3 documents
- duplicate sha256: 0 group(s), 0 document(s) — the ADR 0104 S2 dedupe cases
- content types: {'application/pdf': 3}
- source channels: {'upload': 3}
- bytes: min 67790, median 71523, max 72397
- page count: not recorded in procurement_documents; needs the stored object

Machine-readable: `datasets/canonical/corpus-run-2026-09-04.json`
