# Canonical corpus run — 2026-09-03

**0 documents read — the corpus is empty; the invariants are proven on 9 labelled synthetic fixtures only**

- Source: `exzueerziesmczwlhomd.supabase.co` (read-only; nothing was written)
- `procurement_documents`: 0 rows
- `procurement_document_lines`: 0 rows
- `vendor-attachments` bucket: 0 objects

## What this run proves, and what it does not

It proves the runner works and that the database holds no vendor
document. It proves NOTHING about the invariants: they were not
exercised, because there was nothing to exercise them on.

**This is not a pass.** A report saying “0 failures” over an empty
corpus reports absence as health. The invariants' evidence is the
fixture suite — 9 documents labelled SYNTHETIC in
`apps/api-gateway/src/procurement/canonical/__fixtures__/synthetic-documents.ts`,
asserted in `canonical-invariants.spec.ts`. Real evidence begins the day
the first vendor document arrives through the receiving flow; this runner
is the standing instrument that will name its failures.

No corpus was invented and none was seeded.

The runner's own ability to NAME a failure is proven separately, by
`./scripts/canonical_corpus_run.py --self-test`, which pushes two
synthetic documents — one that ties out, one that does not — through the
same TypeScript invariants and asserts that exactly the broken one is
named. Measured 2026-09-03: 2 documents read, 2 named failures, both on
`synthetic-does-not-tie` (`line_net_amount` expected 528 found 428;
`document_lines_total` expected 428 found 660). Without that check, an
empty report would be indistinguishable from a runner that names nothing.

## Intake shape (ADR 0104 D6 will set its thresholds on this)

- sha256 present on 0 of 0 documents
- duplicate sha256: 0 group(s), 0 document(s) — the ADR 0104 S2 dedupe cases
- content types: —
- source channels: —
- bytes: min None, median None, max None
- page count: not recorded in procurement_documents; needs the stored object

Machine-readable: `datasets/canonical/corpus-run-2026-09-03.json`
