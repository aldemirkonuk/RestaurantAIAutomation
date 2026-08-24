# Decision Log — Mudavym

> Every decision gets a record. A decision not written here (or in a doc this
> index points to) **has not been made** — that is non-negotiable #1 in
> [`CLAUDE.md`](../../CLAUDE.md).

## How this works

- One decision = one file: `NNNN-short-slug.md`, from [`TEMPLATE.md`](TEMPLATE.md).
- Statuses: **Locked** (binding) → may later become **Superseded** (points to its
  replacement). Nothing here is ever silently deleted.
- Undecided forks live in [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) — the queue of
  questions waiting for the founder. Sessions add to it; only a founder call moves
  an item out of it and into an ADR.
- Decisions locked **before** this log existed remain canonical where they were
  written. This index links to them; we do not copy them (one source of truth per
  decision).

## Locked — recorded in this log

| # | Decision | Date |
|---|---|---|
| [0001](0001-mudavym-single-entity.md) | Mudavym is one entity; modules are internal softwares | 2026-08-24 |
| [0002](0002-documentation-first-operating-mode.md) | Documentation-first operating mode + ADR discipline | 2026-08-24 |
| [0003](0003-session-output-discipline.md) | Low per-session output footprint, branch-per-operation | 2026-08-24 |
| [0004](0004-obsidian-as-backlink-layer.md) | Obsidian adopted as the doc backlink layer | 2026-08-24 |
| [0005](0005-v3-to-v0-version-reset.md) | v3 internal build → deliberate v0 production reset | 2026-08-24 |
| [0006](0006-neural-footprint-architecture.md) | Neural Footprint — split narrow production store from wide append-only research log; NF-C gated | 2026-08-24 |
| [0008](0008-nf-column-contract.md) | NF column contract — full ADR 0006 shape now (Path C); Claude's Path A recommendation overruled | 2026-08-24 |
| [0007](0007-org-structure.md) | Org — 7 divisions, 19 departments, 3 findings-only advisory functions, 7-artifact unit anatomy | 2026-08-24 |
| [0009](0009-loop-vocabulary-contract.md) | Loop vocabulary read from ORG_STRUCTURE §5.1's own table and enforced as a hard CI gate; `active`/`running` must cite evidence — live loops 6 → 5 | 2026-08-24 |
| [0010](0010-gemini-model-retirement.md) | `gemini-3.5-flash-lite` replaces retired `gemini-2.0-flash`/`gemini-pro`; runway beat price. Spend table was wrong (2.5-flash under 8.3x), lite billed as flash, thinking tokens uncounted — all three corrected | 2026-08-24 |

## Locked — recorded elsewhere (pre-log)

| Decision | Where | Date |
|---|---|---|
| Brand: Mudavym (spelling confirmed) | [`PROJECT.md`](../PROJECT.md) Key Decisions | 2026-07-26 |
| Expansion sequence: wine → beverages → bakery → kitchen | [`FUTURES.md`](../FUTURES.md) §2 | 2026-07-26 |
| Wine = extraction quality bar for every category | [`FUTURES.md`](../FUTURES.md) §4 | 2026-07-26 |
| Bakery = first food vertical | [`FUTURES.md`](../FUTURES.md) §5 | 2026-07-26 |
| Live camera stack: RF-DETR → PaddleOCR → Gemini; no full OCR on live frames | [`PROJECT.md`](../PROJECT.md) / `SCANNING_PIPELINE_SETUP.md` | 2026-07-27 |
| Extend BaseAgent, not rebuild; wave sequencing; 7 core principles | [`PROJECT.md`](../PROJECT.md) Key Decisions | v2.0 |
| Blender / landing-page visuals: **hold** until structure + brand exist | Vision capture §13/§14.5 | 2026-08-24 |

## Open

See [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) — that file is canonical and this line
is a pointer, not a count. It has grown well past its original 8 items; four are
marked 🔴 and several were raised by review agents against Claude's own work.
