## The house's tax basis is recorded and not built — OPEN — 2026-11-07

Filed by `docs/adr-house-tax-basis` (cost-math lane 3.4), which writes [ADR 0359](../decisions/0359-a-house-states-its-tax-basis-and-cost-carries-it.md) and changes no code.

**What is true.** On `main` (`c93d6115c`) nothing names a tax basis, a lot's cost says nothing about KDV, and margin divides by the menu price as stored (`apps/api-gateway/src/pricing/margin-to-target.ts:12`). A house whose menu prices include KDV sees its margin inflated by the rate. The founder's picks of 2026-10-12 (F1 to F3) and the session's calls C1 to C7 are recorded in ADR 0359; none is built.

**What is owed, each with its owner.**
- **Lane 3.5a** (`feat/house-tax-basis-and-cost-stamp`): `restaurants.tax_basis`, `restaurants.reclaims_input_tax`, the switch date, and `inventory_lots.cost_tax_basis` stamped at VERIFIED (ADR 0359 C2, C3). It flips `claims.d/docs-adr-house-tax-basis.jsonl` rows 3 and 4.
- **Lane 3.5b** (`feat/margin-reads-price-before-kdv`): the dated rate table with a primary source per row, and margin on the price without tax for `prices_include_tax` houses (C4, C5). It flips rows 5 and 6. No rate was fetched from a primary source for ADR 0359.
- **ADR 0287 Decision 7, "Adapter subtotal"**: one bracket naming ADR 0359, and nothing else. Not added here, to keep this PR to its one operation.
- **ADR 0295** (draft on open PR #615): where net sales are made pre-tax (C7). It waits for #615.
- **The cost-math plan's §2f and lane U3** (outside the repo) say an unset Turkish house shows no margin. ADR 0359 C6 replaces that: an unset house of any country keeps its margin, with one sentence linking to the setting.
- **The local stack** `feat/house-tax-basis-schema` to `docs/adr-tax-inclusive-net` (`fc7097b1d`, unpushed, held draft ADR 0341): reuse it where it agrees with ADR 0359, or retire it. Its value spellings are the ones C2 keeps; its per-house rate table is what C5 rejects.
- **ADR 0359's README row**, in its own PR (a pure append).

**What closes it.** Lanes 3.5a and 3.5b merged with their claims rows flipped to `resolved`, and the ADR 0287 bracket on `main`.
