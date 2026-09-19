# 0166 — The defect register retires, and its items live by kind

- **Status:** Locked (the split-by-kind decision below). Execution against the
  231-item checklist is **pending** — it does not run until the founder has
  marked every item (see Consequences); `scripts/retire_tech_debt.py` refuses
  `--apply` while any item is unmarked.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** tech-debt, v3.0-TECH-DEBT, defect-register, retirement, CLAIMS,
  OPEN-DECISIONS, retire-to-write, gate-owned, ADR-0090, ADR-0032
- **Links:** [[0032-vault-cleanup-cut-line]] (archive = delete + tombstone),
  [[0090-pr-audit-gate-autonomous-merge]] (`_GATE_OWNED_PATHS`),
  `scripts/retire_tech_debt.py` (this ADR's executing tool),
  the retirement plan and founder checklist this ADR is built from (paths in Context)

## Context

`.planning/v3.0-TECH-DEBT.md` is a single running defect register that CLAUDE.md
§1 currently names as "the live defect register. Check it before claiming
something is broken or fixed." As of this branch's checkout (`origin/main`
`cb756083e`), it is **4,579 lines, 323,039 bytes (≈315.5 KiB)** — measured
directly (`wc -l`, `ls -la`) rather than carried forward from an earlier count.
A prior pass at this same retirement (measured against a *different* worktree,
`wt-review`) recorded 4,765–4,766 lines; that number is stale for this tree and
is not repeated here, per CLAUDE.md §5b ("numbers get re-measured, never copied
forward").

The founder's own words on this, 2026-09-19 chat: *"in the end delete all that
tech debt.md that messes with our head."* Asked where the checklist's `Work on
it` / `Decide later` items should live once the register they're filed under is
gone, his answer was **"Split by kind (Recommended)."** This ADR records that
decision and specifies exactly what "by kind" means; it does not itself delete
anything (see Consequences — the deletion is a separate, gate-owned, later PR).

**The source material.** A review pass produced:
- a retirement plan (`review-0919/tech-debt-retirement-plan.md`) inventorying
  every file that depends on the register's literal filename or its content, and
- a founder checklist (`review-0919/checklist.json` / `checklist.md`) triaging
  every register item into one of eight review groups.

Re-measured directly from `checklist.json` for this ADR (`generated: "2026-09-18/19"`):
**231 items**, not 230 — and no item named `seasonality-zero-fill` exists in
either file (checked by exact-key lookup and by case-insensitive grep across
both files and the plan; zero hits). Both of those figures, as handed to this
session, do not hold; this ADR uses the re-measured ones throughout. The 231
items break down, by the checklist's own `group` field, into four
recommendations this ADR's Decision routes by:

| Recommendation | Groups | Count |
|---|---|---:|
| REMOVE | `remove_done` (89) + `remove_legacy` (9) | **98** |
| WORK | `security_money` (18) + `fix_broken` (41) + `quality_tests` (9) | **68** |
| DECIDE | `decide` | **43** |
| MOVE | `move_rules` (14) + `move_future` (8) | **22** |

(231 total; the plan's own "100 of 230 items were already done or gone" is
also off against this count — the re-measured REMOVE total is 98.)

**The dependency count.** The plan's §1a claims **161** files cite the literal
filename `v3.0-TECH-DEBT.md`, via `grep -rl "v3\.0-TECH-DEBT\.md" . --exclude-dir=node_modules --exclude-dir=.git`
against `wt-review`. Re-running that *exact* command against this tree
(`cb756083e`, plus this lane's own three staged files) finds **151** — all
tracked by git, zero untracked (`git status --porcelain -uall` shows no `??`
lines; `git grep -l -F "v3.0-TECH-DEBT.md" | wc -l` independently agrees at
151, as does `scripts/retire_tech_debt.py`'s own `scan_citations`). Of the 151,
**148 predate this lane** and **3 are this ADR's own new files** — this
document, `scripts/retire_tech_debt.py`, and `scripts/test_retire_tech_debt.py`
— each of which mentions the filename and is tracked because it was staged
(`git add`) for this branch, not because it predates it. The gap between 161
and 148 is a cross-worktree/commit difference, not an error in either count,
and is noted rather than silently resolved to one number. Classifying the 148
pre-existing tracked citations by path (`scripts/retire_tech_debt.py`'s
`classify_path`, run directly against this tree and mirroring the plan's own
§1 breakdown) gives:

| Class | Count | Matches the plan's §1 breakdown for this class? |
|---|---:|---|
| historical corpus (`01-org`, sketches, archive, foundation, scenarios, testing, datasets) | 43 | same shape, different worktree |
| page/software dossiers (`06-pages` + `08-softwares`, line-range citations) | 36 | **exact match** (29+7=36) |
| real source comments (`apps/api-gateway`, `apps/web`) | 27 | **exact match** |
| ADR files (historical prose) | 20 | plan bundles this with README/OPEN-DECISIONS/CLAIMS as "~24" |
| `.planning/04-specs/` + `.planning/07-reference/` prose mentions (`reference-doc`) | 8 | plan says 5+4=9 for this tree-shape |
| SQL comment headers (`supabase/`) | 5 | **exact match** |
| gate-owned (`CLAUDE.md`, `decisions/README.md`) | 2 | **exact match** |
| `.github/workflows/*.yml` comments | 1 | plan says 2 — one of the two lines the plan cites no longer matches |
| `.planning/00-index/` (machine-generated) | 1 | not separately broken out by the plan |
| `.planning/07-reference/INDEX.md` (`reference-index` — a separate exact-path class from the prose-mentions row above) | 1 | not separately broken out by the plan |
| `.planning/decisions/OPEN-DECISIONS.md` (OD-60's link) | 1 | **exact match** |
| `.planning/decisions/CLAIMS.jsonl` (prose only) | 1 | **exact match** |
| `.planning/PROJECT.md` | 1 | **exact match** |
| script docstrings | 1 | plan says 3 — see below |

(Table sums to 148, matching the prose above. An earlier draft of this table
omitted the `reference-index` row and silently summed to 147 — caught by
running `classify_path` against the live scan rather than trusting the
hand-built table; recorded here per CLAUDE.md §5b, not corrected quietly.)

**The script-docstring class is the sharpest single correction.** The plan
names three scripts as citing the register in a comment: `check_web_reads_gateway_dto_keys.py`,
`check_definer_functions_closed.py`, `check_new_tables_are_locked_down.py`.
Checked directly against this tree: `check_web_reads_gateway_dto_keys.py`
still does (1 hit); **`check_definer_functions_closed.py` does not exist in
this tree at all**; `check_new_tables_are_locked_down.py` exists but currently
has **zero** hits. Only one of the plan's three citations is live here.

None of the corrections above change the shape of the decision below — they
change specific counts this ADR would otherwise have copied forward wrong.

## Options considered

1. **Per-item `CLAIMS.jsonl` rows for every surviving item**, `status: "open"`,
   mirroring the existing `DEBT-44.2d` row (`.planning/decisions/CLAIMS.jsonl`).
   Self-guarding (a claim that starts passing and isn't struck fails CI), but
   only fits items that reduce to a grep/python-checkable code claim — the
   43 `decide` items and several `move` items (methodology notes, renumbering
   advice) have no such command (plan §4.1).
2. **`OPEN-DECISIONS.md` rows for every surviving item.** Exactly that file's
   stated purpose for the 43 genuinely-open forks, but inserting dozens of rows
   at once is the disruptive edit CLAUDE.md's own "Register row shifts
   citations" memory warns about (~173 citations move per insertion point), and
   doesn't fit the 68 WORK items, which are code-shape questions, not founder
   forks (plan §4.2).
3. **GitHub issues, one per item.** Lowest friction to file, and a natural home
   for anything not code-verifiable — but invisible to every static guard in
   this repo (`check_decision_claims.sh`, `check_citation_pairing.py`); an
   issue-tracked claim cannot be re-checked by a command, which is the exact
   failure mode CLAUDE.md §5b exists to close (plan §4.3).
4. **Fold everything into owning ADRs' own "open items."** Works cleanly only
   where a single ADR already owns the item (much of the `44.1x` auth/membership
   family does, via ADR 0162's own CLAIMS rows already narrating the same
   facts) — but for items with no single owning ADR, this just scatters the
   backlog across dozens of files, the opposite of "don't create new top-level
   docs, fold into what exists" (plan §4.4).
5. *(Doing nothing — leaving the register in place — costs what CLAUDE.md §5b's
   own history already measured: a 4,579-line prose file nobody fully re-reads,
   where "fixed but unstruck" and "wrong target" errors compound. The founder
   rejected this directly, 2026-09-19 chat, quoted above.)*

## Decision

**Split by kind — the founder's recommended option, and the only one of 1–4
above that fits all 231 items without leaving a class homeless:**

- **REMOVE (98 items)** — dropped outright. The register itself is recoverable
  from git by tombstone, per [[0032-vault-cleanup-cut-line]]'s "archive means
  delete + tombstone" rule (`0032-vault-cleanup-cut-line.md:56`, mechanism
  named at `:48`); no successor row is written for a REMOVE item.
- **WORK, command-checkable (subset of 68)** — a `CLAIMS.jsonl` row, `status:
  "open"`, mirroring `DEBT-44.2d`. "Command-checkable" is decided by whether a
  human supplies an actual verify command for that item — `scripts/retire_tech_debt.py`
  **never invents one**; an unverifiable WORK item is not a CLAIMS row with a
  guessed check, it is routed to the next bullet.
- **WORK, not command-checkable (the rest of 68)** — folded into the owning
  ADR's own open-items text (e.g. several of the `44.1x` family already have
  one, via ADR 0162's existing CLAIMS rows narrating the same facts). An item
  whose `destination` names no ADR is reported `UNASSIGNED` for a person to
  place, never guessed.
- **DECIDE (43 items)** — `OPEN-DECISIONS.md` rows, appended at the bottom of
  `## Open` (immediately before `## Resolved`), numbered from the register's
  real next-free id (`scripts/retire_tech_debt.py:next_open_decision_number`
  re-measures this from the file at run time — **OD-124** as of this ADR's
  writing, `.planning/decisions/OPEN-DECISIONS.md`'s highest existing id being
  OD-123 — never hardcoded), followed by one run of
  `scripts/check_citation_pairing.py --fix` to repoint whatever anchors the
  insertion shifted.
- **MOVE (22 items)**, by what its `destination` names:
  - **ROADMAP.md / FUTURES** — carried-forward, unbuilt scope (e.g. the
    SimPOS/Operations-Simulator family).
  - **CLAUDE.md, as a standing convention** — e.g. `44.3d`'s "read the live
    schema, not migrations," which is already mechanically enforced
    (`scripts/check_schema_parity.sh`, `.github/workflows/schema-parity.yml`).
  - **The owning ADR**, when the destination names one.
  - Anything matching none of the above is reported for **manual placement**,
    never guessed at.

This is a decision about **shape**, not a completed migration. "Which of the 68
WORK items get a real verify command" and "which ADR truly owns which MOVE
item" are per-item judgement calls this ADR does not make — see Consequences.

## Consequences

- **Easier:** the register's "fixed but unstruck" rot (CLAUDE.md §5b's own
  motivating incidents) becomes structurally harder for the WORK-checkable
  slice, because a `CLAIMS.jsonl` row is CI-enforced the moment its `verify`
  starts passing without `status` being flipped. The corpus loses one
  4,579-line file nobody fully re-reads.
- **Harder / given up:** the backlog is now split across (at least) CLAIMS.jsonl,
  OPEN-DECISIONS.md, N owning ADRs, ROADMAP.md/FUTURES, and CLAUDE.md itself,
  instead of one file — a real cost the plan named and the founder accepted by
  choosing this option over "one register, reorganized."
- **What changes, by class, and who must approve it** (re-measured counts, see
  Context): the 148 tracked citing files above; **`CLAUDE.md` §1/§4 and
  `.planning/decisions/README.md` are in ADR 0090's `_GATE_OWNED_PATHS`**
  (confirmed live at `scripts/pr_audit_gate.py:485` (tuple opens), `:493`
  (`CLAUDE.md`), `:499` (`.planning/decisions/README.md`), `:506`
  (`.github/workflows/ci.yml`, named in the same tuple)). Any PR that deletes
  the register and edits those two files force-escalates to BLOCK under ADR
  0090's `touches_own_gate` regardless of audit verdict — **the executing PR
  needs the founder's direct authorization in chat before merge**, the same
  path every prior CLAUDE.md-touching PR has taken. This ADR does not ask for
  that authorization; it only names where it will be required.
- **The guard (solve it once), specified now, built in the executing PR:**
  `scripts/check_no_defect_register.py`, with a `--self-test` and mutation
  testing (this repo's standard for a guard — see `scripts/check_adr_numbers_unique.py`
  and `scripts/check_citation_pairing.py` for the pattern to follow), failing
  CI on either of two conditions: (a) `.planning/v3.0-TECH-DEBT.md` exists
  again, or (b) a new citation to it exists outside its tombstone entry. It is
  **not built or wired in this branch** — wiring it means editing
  `.github/workflows/ci.yml`, which is itself gate-owned, and a guard whose job
  is "the file is gone" cannot be meaningfully tested against a tree where the
  file still exists by design (this branch does not delete it — see below).
  Building it together with the deletion, in the executing PR, avoids
  shipping a guard that has only ever been run against the wrong starting
  state.
- **What would trigger revisiting this:** if, once real verify commands are
  written, most of the 68 WORK items turn out **not** command-checkable in
  practice (the split would then be mostly-ADR, not mostly-CLAIMS, and the
  "CI-enforced" benefit above would be much smaller than assumed here); or if
  the founder's marks on the checklist reclassify enough items that the
  98/68/43/22 split materially changes.
- **Not done by this ADR or this session, stated plainly (CLAUDE.md §0.5):**
  nothing is deleted; `CLAUDE.md` and `decisions/README.md` are unedited;
  `check_no_defect_register.py` is unbuilt; the founder has not yet marked the
  231 items (this ADR's own routing table above is illustrative of what marks
  *would* produce if every item kept its pre-populated `recommendation` as its
  mark — it is not a claim that he has marked anything); and the founder's
  marking artifact's live database schema (`items`/`marks` collections) was
  never read — `scripts/retire_tech_debt.py` was built against a **guessed**
  export shape, documented as a guess in its own docstring, because the
  artifact could not be opened for this task.
  **[2026-09-19, later the same day: both limits are closed. The founder
  marked every item: the page holds 230, not 231, with remove 100 / work 78 /
  decide 30 / move 22, and 11 moved from decide to work. The page's db was
  exported (`items` keyed by doc id, plus a flat `marks` map of `{v, t}`).
  `load_items` now reads that keyed shape, with 2 tests added (77 pass) and
  mutation-checked. A dry run on the real export read 230 items with 0
  unmarked and routed them as: 100 removed, 81 to owning ADRs, 30 to OD-124
  onward, 9 to ROADMAP/FUTURES, 4 to CLAUDE.md, and 6 needing manual
  placement. Where each item finally lives is set by the placement pass
  that the executing PR carries, not by this dry run's keyword routing.]**

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | — | Created |
