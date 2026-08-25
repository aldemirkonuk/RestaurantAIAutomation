# Menu corpus — extracted and enriched

Build artifacts from the three-stage library backfill. They live in the repo so
stages 2 and 3 can be replayed without re-paying for stage 1, and so a change
in extraction quality is visible in a diff rather than invisible.

Source PDFs are `datasets/annotation_inbox/pdfs` (26 restaurant beverage lists,
305 pages). These are published restaurant menus, not customer data.

## Contents

| path | what | produced by |
|---|---|---|
| `extracted/<menu>.json` | wines read off one PDF, plus page count and timing | `scripts/extract_menu_corpus.py` |
| `extracted/manifest.json` | totals, API calls, token spend | " |
| `enriched/enriched.json` | every distinct wine + its ~35 attributes | `scripts/enrich_wines.py` |
| `enriched/manifest.json` | model, spend, known/inferred/unknown split | " |

## Cost, so a re-run is a deliberate choice

| stage | wines | API calls | cost |
|---|---|---|---|
| extract | 4,822 (4,499 distinct) | 56 | **$2.60** |
| enrich | 2,400 of 4,499 | 120 | **$4.35** |

Enrichment stopped part-way when the API credit balance ran out — 2,099 wines
carry `"enrichment": null`. `enrich_wines.py` resumes: it skips anything already
enriched and only pays for the remainder (~$4).

## Replaying

```bash
python3 scripts/enrich_wines.py --in datasets/menu_corpus/extracted --out datasets/menu_corpus/enriched
python3 scripts/load_enriched_wines.py --in datasets/menu_corpus/enriched --apply
```

Both are safe to re-run. The loader matches every wine against the library
before writing, so a second run updates rather than duplicates.

## What `knowledge` means

Each enriched wine carries `knowledge`: `known` (the model recognises this
specific bottling), `inferred` (typical profile for the grape/region — a
reasoned default, **not** a fact about this wine), or `unknown`. It drives
`library_tier`, `review_status` and `field_confidences`, so nothing downstream
has to guess whether an attribute was recalled or reasoned.
