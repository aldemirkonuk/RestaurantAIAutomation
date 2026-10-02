# 0259 — A grep guard that cannot search does not pass

- **Status:** Locked
- **Date:** 2026-10-02
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** CI guard, ripgrep, rg, git grep, vacuous pass, exit 2, self-test, type_attributes, guest identity, beer view, cellar
- **Links:**
  - `scripts/check_no_direct_type_attributes_access.sh` (arch §4.3), `scripts/check_no_guest_name_matching.sh`, `scripts/check_no_raw_guest_channels.sh`, and the shared `scripts/lib/app_code_grep.sh`.
  - Same defect class, fixed earlier: `check_no_direct_stock_writes.sh` (`rg --type tsx`), and the reason `check_lot_cost_provenance.py` and `check_no_seeded_defaults.py` exist (their headers, and `ci.yml` around the "Provenance guard proves it can see the tree" step).
  - Found from [[0258-the-dashboard-tour-speaks-one-text-true-for-every-role]]'s guard run (branch `claude/pensive-bardeen-b57esh`).

## Context

All three guards ran `rg -n -P "$PATTERN" --type ts --type py … 2>/dev/null || true`.

- **The CI runner has no ripgrep.** The `ubuntu-24.04` image readme (image `20260920.314.1`, `actions/runner-images`) never names ripgrep. `rg` is "command not found", `2>/dev/null` hides it, `|| true` eats the exit code, and the guard prints PASS having searched nothing.
- **Evidence it was blind, not merely old.** At `e39935fbc`, `apps/web/src/pages/cellar/next/cellar-columns.ts`, a plain `.ts` file that any rg's `ts` type covers, held `type_attributes` on six lines. CI run 36956858853, job 110681637696, printed "PASS — no direct type_attributes access outside migrations." about 12 ms after the step started.
- **Locally**, with ripgrep 14.1.0 installed, the same guard failed on eight lines: `RowExpander.tsx:141-142` and `cellar-columns.ts:95,118,375,378,381,390`.
- **Reproduced** in this branch: main's guard with `rg` made unavailable prints PASS (exit 0). The new guard, on the same tree, exits 1 naming the lines.
- `schema-parity.yml`'s two guest guards had the identical line, and they ran only after a database step, so a failed DB step skipped them too.

## Options considered

1. **Keep rg, and exit 2 when it is missing.** Add `apt-get install ripgrep` to the Lint TypeScript and guest-merge-gate jobs. Costs an install step in each job and an rg on every machine that runs a guard.
2. **Rewrite in Python**, as `check_lot_cost_provenance.py` and `check_no_seeded_defaults.py` were. Standard library only, but three new files, and three `.sh` entry points retired.
3. **`git grep` behind one shared helper, with exit 2 and a self-test.** Every checkout already has git. It searches what rg saw: tracked plus untracked-not-ignored files, with `.gitignore` honoured.
4. **`find` plus `grep -r`**, as `check_no_direct_stock_writes.sh` does now. It does not honour `.gitignore`, so each guard would need an exclude list for build output and virtualenvs.
5. **Do nothing.** Three guards keep reporting health they never measured.

For the eight lines the working guard found:

- **(i)** The beer `source` strings: `RowExpander.tsx:141-142`, shown as a tooltip ("Would be read from … — nothing writes it"), and `cellar-columns.ts:375,390`, shown as a column-header tooltip ("Read from …", `cellar-columns.ts:740`). They could name the view or be allowlisted.
- **(ii)** Code comments: `cellar-columns.ts:95,118`.
- **(iii)** Prose on /cellar's hidden-columns list: `cellar-columns.ts:378,381`. It states a measurement of the JSONB over all 609 beverages rows.

## Decision

The founder's picks, verbatim, 2026-10-02:

| Fork | Ruling |
|---|---|
| Where the fix goes | "Own branch (Recommended)": `fix/guards-search-without-rg`, apart from the tour PR |
| RowExpander's two lines | "Name the view (Recommended)" |
| The two guest guards | "Fix all three (Recommended)" |
| The six `cellar-columns.ts` hits | "View / skip / allowlist (Recommended)" |
| How the guards search | "git grep, built (Recommended)" |

*What follows is how it was built, not the founder's words.*

- **`scripts/lib/app_code_grep.sh`** runs `git grep -n -I -P --untracked` over `apps/`, `services/` and `scripts/` (`.ts`, `.tsx`, `.cts`, `.mts`, `.py`, `.pyi`; spec and test TypeScript left out). It exits 2 when:
  - git is missing;
  - the tree is not a repository;
  - the corpus is under 200 files;
  - the search errors.
  
  Its message goes to stderr, so a call inside `$(…)` still reaches the log.
- **Allowlists** are keyed on the file and the exact trimmed line, not on line numbers. So an exemption cannot drift onto a new line.
- **`--self-test`** on each guard, run against the real tree, proves four things:
  - it reaches `.tsx` and `.py` files;
  - it exits 1 naming a seeded `.tsx` line and a seeded `.py` line;
  - it exits 2 without git;
  - a search that errors exits 2.
  
  Both mutations failed the self-test: swallowing the search error, and dropping `.tsx` from the corpus.
- **The cellar lines:**
  - (i) now read `beer.style` and `beer.ibu`. The view exposes both columns (`20260817080000_beverage_views.sql:52-53`).
  - (ii) The type_attributes guard skips comment lines (`//`, `/*`, `*` in TypeScript; `#` in Python), because a comment is never access. The guest guards do not; nobody ruled on them.
  - (iii) is allowlisted by exact text, with the reason beside it.
- **CI:**
  - `ci.yml` runs the type_attributes self-test before the guard, both `if: ${{ !cancelled() }}`.
  - `schema-parity.yml` runs both guest self-tests before the guards, and the step no longer waits on the database step.

## Consequences

- A missing search tool, an empty tree or a broken pattern now turns CI red instead of green.
- The /cellar tooltips name the contract (`beer.style`) where they named the JSONB path. `CellarNext.test.tsx` follows.
- The guards no longer need rg anywhere. They need git with PCRE, which both the runner (git 2.55) and this container (2.43) have. A git built without PCRE exits 2, never 0.
- **Revisit when:** a guard needs a search `git grep -P` cannot express, or a category gets its own table, so the beer view stops being a view over `type_attributes`.
- **Not verified:** the new CI steps have not run on GitHub yet. This branch's first CI run is the proof that the runner has PCRE-enabled git.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-02 | Self (mutation tests, reproduction with rg removed) | Self-tests red under both mutations; old guard PASS and new guard FAIL on the same tree without rg |
| 2026-10-02 | Aldemir (founder) | Locked: five forks, all recommended options |
