# Canonical corpus run — 2026-09-04

**3 documents read; 6 named invariant failure(s); 7 of 16 invariants UNTESTABLE on every document (11 lines extracted in total)**

- Source: `exzueerziesmczwlhomd.supabase.co` (read-only; nothing was written)
- `procurement_documents`: 3 rows
- `procurement_document_lines`: 11 rows
- `vendor-attachments` bucket: 1 objects

## Per-invariant results

| invariant | rule | holds | fails | untestable |
| --- | --- | ---: | ---: | ---: |
| `amount_due` | — | 2 | 0 | 1 |
| `as_printed_not_mutated` | — | 3 | 0 | 0 |
| `credit_memo_references_invoice` | — | 0 | 0 | 3 |
| `currency_present_when_money` | — | 3 | 0 | 0 |
| `deposits_coded_and_excluded` | — | 0 | 3 | 1 |
| `document_lines_total` | — | 2 | 0 | 1 |
| `free_goods_zero_net` | — | 0 | 0 | 3 |
| `line_net_amount` | — | 6 | 1 | 4 |
| `price_base_quantity` | — | 11 | 0 | 0 |
| `received_never_assumed` | — | 11 | 0 | 0 |
| `total_with_vat` | — | 0 | 0 | 3 |
| `total_without_vat` | — | 0 | 0 | 3 |
| `vat_breakdown_present` | — | 0 | 2 | 1 |
| `vat_category_tax_amount` | — | 0 | 0 | 3 |
| `vat_category_taxable_base` | — | 0 | 0 | 3 |
| `vat_total_matches_breakdown` | — | 0 | 0 | 3 |

`untestable` is counted separately on purpose: a document that states
no total did not pass the tie-out, it was never testable.

## Named failures

| document | invariant | expected | found | why |
| --- | --- | --- | --- | --- |
| `d0b96d4a-bb8e-4e81-83f5-7664cd14bf8b` | `line_net_amount` | 360 | 180 | Line 4: 2 × 90 ÷ 1 with charges 180.00 and allowances 0.00 comes to 360.00, but the line states 180.00. |
| `d0b96d4a-bb8e-4e81-83f5-7664cd14bf8b` | `vat_breakdown_present` | at least one VAT breakdown row | 0 | The document states 1834.40 of VAT with no breakdown, so no category's base can be checked. |
| `d0b96d4a-bb8e-4e81-83f5-7664cd14bf8b` | `deposits_coded_and_excluded` | a UNCL7161 reason code | None | A deposit or CRV charge carries no reason code, so nothing downstream can tell refundable money from cost of goods. |
| `d0b96d4a-bb8e-4e81-83f5-7664cd14bf8b` | `deposits_coded_and_excluded` | a document-level charge (BG-21) with a UNCL7161 reason code | an invoice line inside BT-106 | Line 4 reads as a deposit but is billed as a goods line, so it is inside the goods total and will inflate beverage cost every month it recurs. |
| `e34a5b9f-9165-44c1-aca0-3bcb8e6be673` | `vat_breakdown_present` | at least one VAT breakdown row | 0 | The document states 253.58 of VAT with no breakdown, so no category's base can be checked. |
| `e34a5b9f-9165-44c1-aca0-3bcb8e6be673` | `deposits_coded_and_excluded` | a UNCL7161 reason code | None | A deposit or CRV charge carries no reason code, so nothing downstream can tell refundable money from cost of goods. |

## Intake shape (ADR 0104 D6 will set its thresholds on this)

- sha256 present on 3 of 3 documents
- duplicate sha256: 0 group(s), 0 document(s) — the ADR 0104 S2 dedupe cases
- content types: {'application/pdf': 3}
- source channels: {'upload': 3}
- bytes: min 67790, median 71523, max 72397
- page count: not recorded in procurement_documents; needs the stored object

Machine-readable: `datasets/canonical/corpus-run-2026-09-04.json`
