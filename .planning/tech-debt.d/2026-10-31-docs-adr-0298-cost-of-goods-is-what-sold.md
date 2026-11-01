## ADR 0298 describes code that is not on `main` — OPEN — 2026-10-31

Filed by `docs/adr-0298-cost-of-goods-is-what-sold`, from PR #703's audit at `8fa9d0494` (comment 6549556550, compliance note 1).

**What is true.** This branch lands ADR 0298 alone. Decision 8, `public.pos_item_sales`, lands with its migration's PR; decisions 1 to 7 and 9 with PR #617's slices (the gateway readers, /reports, the export, the MCP reader, the goal producers); the digest's two compositions with the last PR. Its Status line says so. The two `open` rows of `../decisions/claims.d/docs-adr-0298-cost-of-goods-is-what-sold.jsonl` fail the build once that code lands without the rows being flipped. Nothing fails if the code never lands: `main` would then hold an ADR whose sentences about routes and letters describe nothing.

**What closes it.** One of two things:
- the migration, PR #617's slices and the digest's PR all merge, and both rows are flipped to `resolved`; or
- one of them is closed unmerged, and a dated bracket in ADR 0298 says which of its decisions did not land.
