# r75 reports-shift build (2026-11-19)
PR: #1904 (draft, base feat/r74-reports-375-phone-stack = #1901), branch feat/r75-reports-reload-cls, head 00695f7c4.
Cause (from source, no browser): outlines 4 x 322 px stood where ~1,700 px of sheet arrives; headline grew 1 -> 3 lines + 66 px sparkline row.
Fix: outlines on the house 12-col ruling (outlineSlots == RGL verticalCompactor, tested), stack under a 768 px box via container query; head min-heights while reads pending.
Tests: vitest src/pages/reports 21 files 354 passed; tsc clean; mutation (base ReportsNext.tsx: 2 fail; un-compacted outlineSlots: 1 fail). Chunk ReportsNext +0.60 kB js, +0.35 kB css.
Left: CLS < 0.05 NOT measured; saved-sheet-differs, strips/fitted rows, 768-995 px box (6 cols), Fraunces fallback swap, "shell main" 180 ms source.
Browser checks owed: hard-reload CLS observer at 1440, 900, 375 and Slow 4G; empty-house collapse; reduced motion unchanged.
Slip: ran "git stash list" once by mistake (read-only, no stash used).
