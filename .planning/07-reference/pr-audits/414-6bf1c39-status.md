# PR #414 — stale readBy anchors fixed at `6862ae53a` (pending CI + re-audit)

Date: 2026-09-22. Worktree: `feat/skyleaf-next-act` pushed to `feat/finish-arrival` (`6862ae53a`; fix commit `b53c84d23`).

Prior gate markers for `2466fc7` / `6bf1c39` / `d58a26830` are **stale** (head moved).

## Defects addressed

1. Migrations renamed past main ceiling `20260921114400` → `20260922190000`–`20260922190300`. `check_migration_order.py` OK. Uniqueness clear vs open PRs after #415 moved to `210100`/`210200`.
2. `mudavym_design_arrival` co-ships with `20260922190300` in `ACTIVE_FEATURE_FLAGS` (not `LIVE_PAGES`); Settings select cannot 42703 from a never-applied column.
3. **2026-09-22 (this push):** five ACTIVE Mudavym `readBy` anchors retargeted `useMudavymDesign.ts:165` → `:171` (`checkFeatureFlag`). Local `check_flag_readby_anchors.py` PASS; ADR-0149-LIVE-PAGES-16 claim holds again.

## Consolidated

Sketch 121 next-act (upload-first flyleaf, three counts, strong-default skip) from `0a5c7b6` onto #414.

## Before merge

- CI green on `6862ae53a`
- Fresh `/pr-audit-gate 414` PASS on that exact SHA — parent should run next once CI is green (existing reports: `414-2466fc7.md`, this status note; no in-flight PASS for `6862ae53a` yet)
- Gate-owned files in `origin/main...HEAD`: none (re-check before merge)
- Do not flip `mudavym_design_arrival` in this PR
- Do not merge without audit (and founder auth only if gate-owned appears later)
