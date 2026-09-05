# Canonical corpus run — 2026-09-05

**5 documents read; 5 named invariant failure(s); 4 of 16 invariants UNTESTABLE on every document (18 lines extracted in total)**

- Source: `exzueerziesmczwlhomd.supabase.co` (read-only; nothing was written)
- `procurement_documents`: 5 rows
- `procurement_document_lines`: 18 rows
- `vendor-attachments` bucket: 5 objects

## Per-invariant results

| invariant | rule | holds | fails | untestable |
| --- | --- | ---: | ---: | ---: |
| `amount_due` | — | 4 | 0 | 1 |
| `as_printed_not_mutated` | — | 5 | 0 | 0 |
| `credit_memo_references_invoice` | — | 0 | 0 | 5 |
| `currency_present_when_money` | — | 5 | 0 | 0 |
| `deposits_coded_and_excluded` | — | 6 | 1 | 1 |
| `document_lines_total` | — | 4 | 0 | 1 |
| `free_goods_zero_net` | — | 0 | 0 | 5 |
| `line_net_amount` | — | 13 | 1 | 4 |
| `price_base_quantity` | — | 18 | 0 | 0 |
| `received_never_assumed` | — | 18 | 0 | 0 |
| `total_with_vat` | — | 3 | 1 | 1 |
| `total_without_vat` | — | 0 | 0 | 5 |
| `vat_breakdown_present` | — | 2 | 2 | 1 |
| `vat_category_tax_amount` | — | 2 | 0 | 3 |
| `vat_category_taxable_base` | — | 0 | 0 | 5 |
| `vat_total_matches_breakdown` | — | 2 | 0 | 3 |

`untestable` is counted separately on purpose: a document that states
no total did not pass the tie-out, it was never testable.

## Named failures

| document | invariant | expected | found | why |
| --- | --- | --- | --- | --- |
| `d0b96d4a-bb8e-4e81-83f5-7664cd14bf8b` | `line_net_amount` | 360 | 180 | Line 4: 2 × 90 ÷ 1 with charges 180.00 and allowances 0.00 comes to 360.00, but the line states 180.00. |
| `d0b96d4a-bb8e-4e81-83f5-7664cd14bf8b` | `total_with_vat` | 11366.4 | 11186.4 | 9532.00 plus VAT 1834.40 gives 11366.40, but the document states 11186.40. |
| `d0b96d4a-bb8e-4e81-83f5-7664cd14bf8b` | `vat_breakdown_present` | at least one VAT breakdown row | 0 | The document states 1834.40 of VAT with no breakdown, so no category's base can be checked. |
| `d0b96d4a-bb8e-4e81-83f5-7664cd14bf8b` | `deposits_coded_and_excluded` | a document-level charge (BG-21) with a UNCL7161 reason code | an invoice line inside BT-106 | Line 4 reads as a deposit but is billed as a goods line, so it is inside the goods total and will inflate beverage cost every month it recurs. |
| `e34a5b9f-9165-44c1-aca0-3bcb8e6be673` | `vat_breakdown_present` | at least one VAT breakdown row | 0 | The document states 253.58 of VAT with no breakdown, so no category's base can be checked. |

## Intake shape (ADR 0104 D6 will set its thresholds on this)

- sha256 present on 5 of 5 documents
- duplicate sha256: 0 group(s), 0 document(s) — the ADR 0104 S2 dedupe cases
- content types: {'application/pdf': 5}
- source channels: {'upload': 5}
- bytes: min 67790, median 72397, max 74103
- page count: not recorded in procurement_documents; needs the stored object

Machine-readable: `datasets/canonical/corpus-run-2026-09-05.json`
