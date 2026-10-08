## The decision index says ADR 0281's repair ran and the bell amendment landed

One line in `.planning/decisions/README.md`, the ADR 0281 row. Nothing else changes.

**Why.** The row still said "F2 repair of written rows waits on the founder". That stopped being true twice on 2026-10-05:
- **#647** (`8e16fbcef`) built the F2 repair, migration `old_pos_rows_carry_their_check_date`, with an undo. It ran on production at 22:30:11Z: 10,684 rows, each moved earlier, none undone (ADR 0281, line 3).
- **#644** (`1c0e8a696`) amended ADR 0281 on the founder's answers. An import that refuses checks files one bell note per till per hour for the house's owners and managers, and both import routes say only whether it was filed.

**The founder's word.** Asked whether to update the index line, he picked "Yes, update it (Recommended)", whose option text was: "One-line docs change saying the repair ran with an undo (merged #647), in a small docs PR". The row's text was first drafted inside #644 at `6a572b195`. The #644 gate held it there because the decision index is gate-owned, so it comes here on its own, after #644 merged, and names both PRs.

**Gate-owned.** `.planning/decisions/README.md` is owned by the audit gate, so the founder merges this PR, not the coordinator.

**Checks run on this branch:** `check_adr_numbers_unique` 0, `check_od_ids_exist` 0, `check_no_conflict_markers` 0, `check_citation_pairing` 0, and `check_decision_claims.sh` PASS ("every executable claim still describes reality"), all at this branch's head.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
