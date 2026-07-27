# Manual checklists — naming contract

**Phase 36 stub only.** Do **not** create per-group checklist files here yet. Filled checklists land in Phases 39–40 / 43.

## Filename contract

```text
g{N}-{slug}-manual.md
```

Examples:

- `g1-identity-manual.md`
- `g3-inventory-manual.md`

Use locked group numbers and slugs from [`FUNCTIONALITY-REGISTRY.md`](../FUNCTIONALITY-REGISTRY.md) Table A (`1-identity`, `2-catalog`, …).

## Ownership by phase

| Phase | Owns |
|-------|------|
| 39 | g1–g4 (`identity`, `catalog`, `inventory`, `pos`) |
| 40 | g5–g7 + g9 (`procurement`, `comms`, `calendar`, `notifications`) |
| 43 | Scanner / admin / journey overlays (cross-group) |

One checklist per registry group (overlays are additive, not replacements).

## Checklist header (when filled later)

Each file should link:

1. Registry group section in `FUNCTIONALITY-REGISTRY.md`
2. Matching row in `TESTING-SCORECARD.md`
3. 3–7 canonical routes (prefer UX catalog ✅/⚠️ status before writing steps — see [`.planning/UX_PATHS_CATALOG.md`](../../UX_PATHS_CATALOG.md))
