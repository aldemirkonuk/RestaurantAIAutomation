# PR #414 — CI fixes pushed (pending green + re-audit)

Date: 2026-09-22. Worktree: `feat/skyleaf-next-act` → `feat/finish-arrival`.

Prior markers for `2466fc7` / `6bf1c39` / `d58a26830` / `5dd74090a` are **stale**.

## Defects addressed

1. Migrations `20260922190000`–`20260922190300`; uniqueness clear vs #415.
2. `mudavym_design_arrival` in `ACTIVE_FEATURE_FLAGS` (not `LIVE_PAGES`).
3. Five ACTIVE Mudavym `readBy` anchors `:165` → `:171` (`b53c84d23`).
4. OD-140 appended after Resolved (citation line-stable) (`72a3f4ca4`).
5. Nightly `manifest.json` enrols `arrival` (MUDAVYM_PAGES parity).

## Before merge

- CI green on this head
- Fresh `/pr-audit-gate 414` PASS on that exact SHA (parent next; existing audits are for older SHAs)
- Do not flip `mudavym_design_arrival`
- Do not merge without audit
