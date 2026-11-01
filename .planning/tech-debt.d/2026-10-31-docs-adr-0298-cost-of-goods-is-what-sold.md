## ADR 0298 describes code that is not on `main` — OPEN — 2026-10-31

Filed by `docs/adr-0298-cost-of-goods-is-what-sold`, from PR #703's audit at `8fa9d0494` (comment 6549556550, compliance note 1).

**What is true.** This branch lands ADR 0298 alone; its Status line says which PR lands each decision. The two `open` rows of `../decisions/claims.d/docs-adr-0298-cost-of-goods-is-what-sold.jsonl` fail the build if its code lands with them still open: row 1 once any non-test, non-generated source under `apps`, `services` or `packages` names `pos_item_sales`, row 2 once a non-test file of `apps/api-gateway/src/analytics/digest/` names the holders' reader or imports its module. Row 2's path exists on `main`; if it moves, its grep prints `No such file or directory`, which `scripts/check_decision_claims.sh:247` counts as could-not-run and fails at `:289` (ADR 0025 §5), so a moved digest is not read as open. They catch a reader landing, not one landing ungated, which each slice's tests must pin. If the code never lands, nothing fails, and the ADR's sentences about routes and letters describe nothing.

**What closes it.** One of two things:
- the migration, PR #617's slices and the digest's PR all merge, and both rows are flipped to `resolved`; or
- one of them is closed unmerged, and a dated bracket in ADR 0298 says which of its decisions did not land.
