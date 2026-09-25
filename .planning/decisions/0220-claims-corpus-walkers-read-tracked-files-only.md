# 0220 — CLAIMS corpus walkers read tracked files only

- **Status:** Locked 2026-09-25
- **Date:** 2026-09-25
- **Decider:** lane L14b, dispatched from the 2026-09-25 web-rebuild census
  (`SYNTHESIS.md` lane L14(b); `CRITIC.md` §G13.2 supplied the root cause and the
  "guard hardening still stands" recommendation; `pipeline.md`'s own scan reproduced
  it independently). Mechanical guard-implementation fix, not a product or policy
  fork — no founder ruling is needed to pick "read the corpus git actually tracks"
  over "keep walking whatever sits on a contributor's disk." Recorded per CLAUDE.md
  §0.2 because it changes what three CLAIMS verify commands consider their corpus.
- **Keywords:** CLAIMS, check_decision_claims.sh, corpus walk, git ls-files, venv,
  gitignored, false positive, os.walk, shared checkout
- **Links:** [[0025-claims-must-be-checkable]] (the strict-mode contract this
  amends nothing about — only what counts as "the tree"); `scripts/check_decision_claims.sh`;
  `scripts/check_fk_repoint_by_referenced_column.py`; `scripts/check_task_types_are_graded.py`;
  `scripts/check_a_count_is_recorded.py`; `scripts/check_no_conflict_markers.py`
  (`list_tracked`, `:225-243` — the precedent this follows); memory
  `claims-verify-must-be-static.md`, `checks-cannot-see-their-own-removal.md`

## Context

`scripts/check_decision_claims.sh` FAILed in this session's shared checkout
(`/Users/aldemirkonuk/Projects/restaurant-ai-automation`) with `484 checked, 479
holding, 5 REGRESSED`: `ADR-0076` ×2, `OD-119`, `ADR-0029`, `ADR-0078`. The census's
`CRITIC.md` §G13.2 had already diagnosed this as a false trip (`pipeline.md:65-88`)
and confirmed `484/484 PASS` on a shared clone at the same commit with no local
`venv` (`pipeline.md:65,86-88`, `scratchpad/clean-claims.out`). This session
re-confirmed the root cause directly against the three implicated scripts:

- `ADR-0076` (×2) and `OD-119` all share `verify: "./scripts/check_fk_repoint_by_referenced_column.py"`
  (`.planning/decisions/CLAIMS.jsonl:101,102,104`). Its `sql_files()` (previously
  `os.walk` over `SCAN_DIRS = ("supabase", "services", "apps", "packages", "scripts")`,
  `SKIP_DIRS` naming only `node_modules`, `.git`, `dist`, `build`, `__pycache__`,
  `.next`, `coverage`) walked into `services/agent-orchestrator/venv` and flagged
  real `unnest(conkey)`-without-`confkey` text inside vendored SQLAlchemy source
  (`.../venv/lib/python3.11/site-packages/sqlalchemy/dialects/postgresql/base.py`)
  as if it were this repo's own migration code.
- `ADR-0029`'s `verify` is `./scripts/check_task_types_are_graded.py`
  (`CLAIMS.jsonl:121`). Its Python-side walk excluded `.venv` but not the bare
  `venv` directory name this repo's own `services/agent-orchestrator/.gitignore:7`
  actually uses, so `ast.parse` hit a vendored `torch` stub
  (`.../venv/.../torch/testing/_internal/py312_intrinsics.py`) that does not parse
  under this repo's Python version and exited 2 ("CANNOT CHECK").
- `ADR-0078`'s guard-backed row is `python3 scripts/check_a_count_is_recorded.py
  > /dev/null && grep -q 'record_stock_count' ...` (`CLAIMS.jsonl:141`). Its
  `collect()` used `Path.rglob("*")` with no venv exclusion at all and its `read()`
  opens with `errors="strict"`, so a vendored `joblib` fixture with a non-UTF-8
  byte (`.../venv/.../joblib/test/test_func_inspect_special_encoding.py`) raised
  and the guard exited 2.

`services/agent-orchestrator/venv` is gitignored (`git check-ignore -v` matches
`services/agent-orchestrator/.gitignore:7`) and holds zero tracked files (`git
ls-files services/agent-orchestrator/venv` returns nothing) — confirmed again in
this lane's own worktree. None of the three scripts read `.planning/`; they read
source trees to prove a shape survives in the committed code, and their own
self-tests (`check_fk_repoint_by_referenced_column.py --self-test`,
`check_a_count_is_recorded.py --self-test`) already describe their target as "the
tree as committed." A filesystem walk over `SCAN_DIRS`/`PYTHON_ROOT` was never
actually reading that; it was reading whatever happened to sit on disk, committed
or not, which is exactly the shape this repo's memory `shared-checkout-concurrent-sessions.md`
warns about — several sessions share one checkout, and a `pip install -r
requirements.txt` run by any of them silently becomes part of every guard's
"code."

## Options considered

1. **Add `venv` (and cousins) to each script's exclusion list.** Cheapest patch —
   one string added to `SKIP_DIRS` / the `("__pycache__", "/tests", ".venv")`
   tuples. Rejected: this repo has already burned itself on shrink-only exclusion
   lists that still have to be *complete* to be safe
   (`check_task_types_are_graded.py`'s own `EXEMPT` docstring: "EXEMPTIONS SHRINK,
   THEY DO NOT GROW" is about a different list, but the failure mode is the same
   shape). `venv`, `.venv`, `env`, a `conda` prefix, a stray `dist/` from a manual
   `npm run build`, an editor's `.history/` — every one of these needs its own
   entry, forever, and a missed one is silent until the next contributor happens
   to create it locally. `.venv` was already in two of these three scripts'
   exclusion lists and still missed the actual directory name this repo uses.
2. **Read `git ls-files` scoped to the same directories, and stop walking the
   filesystem at all.** This is not a new pattern in this repo:
   `check_no_conflict_markers.py`'s `list_tracked()` (`:225-243`) made exactly
   this move on 2026-09-05, for exactly this reason — "the thing that must not
   [carry the defect] is the thing that gets committed, and a walk would also
   read untracked scratch files and miss nothing useful in exchange." Untracked
   material can never again be mistaken for this repo's shape, regardless of its
   name — no enumeration to keep current.
3. **Instruct contributors never to leave a local `venv` under `services/agent-orchestrator/`.**
   Rejected outright: the checkout is explicitly shared across concurrent
   sessions (memory `shared-checkout-concurrent-sessions.md`), a local `venv` is
   the ordinary, correct way to work in that service, and a guard that only
   passes when nobody has installed anything is a guard nobody can run.

## Decision

**Option 2.** `check_fk_repoint_by_referenced_column.py:143-178` (`_git_tracked_files`
+ rewritten `sql_files()`), `check_task_types_are_graded.py:92-115` (`_git_tracked_files`,
reused by `scan_gateway`, `scan_python`, and `main()`'s `all_types` sweep), and
`check_a_count_is_recorded.py:136-172` (`collect()`, rewritten in place) now
enumerate their corpus with `git ls-files -z -- <dirs>` instead of `os.walk` /
`Path.rglob`. A `git ls-files` failure (not a git checkout, `git` unavailable, a
scan root outside the repository) is treated the same way an unreadable file
already was: `CannotCheck` / a printed `CANNOT CHECK` and exit 2, never a silent
empty corpus reported as PASS. This is the same contract `check_no_conflict_markers.py`
already established; these three scripts now follow it instead of diverging from
it.

This does change what these three claims consider "the code": before, an
*uncommitted* edit to a tracked file's directory tree could incidentally trip or
silence a check before its author ever ran `git add`; now it cannot. That is a
tightening toward what the scripts already claimed to test (self-test language:
"the tree as committed"), not a loosening — see the mutation tests below, which
prove a real, committed regression is still caught exactly as before.

## Consequences

- **Easier.** A local Python virtualenv, or any other untracked, gitignored
  build/tooling artifact anywhere under `supabase/`, `services/`, `apps/`,
  `packages/`, `scripts/`, `apps/api-gateway/src`, or `services/agent-orchestrator`
  can no longer flip a CLAIMS row to REGRESSED or CANNOT CHECK. A contributor no
  longer needs a scratch clone to trust a local `check_decision_claims.sh` run.
- **Harder / given up.** These three guards no longer see uncommitted changes at
  all, including a genuine, not-yet-committed fix or regression in a tracked
  file's own working-tree content — they answer for `HEAD`'s tree via the index,
  not the working copy. Every other claim in `CLAIMS.jsonl` already worked this
  way implicitly (a `grep` on a specific path reads the working copy, but nothing
  in this repo's guards intentionally depended on scanning uncommitted content),
  so this brings these three in line rather than introducing a new asymmetry.
- **A sharp edge worth recording.** `git check-ignore` matches a gitignored
  *directory* pattern (`venv/`) against a real directory, but not against a
  *symlink* of the same name pointing at one — `git status` reports a symlinked
  `venv` as untracked (`??`), not ignored. This lane's own worktree-setup step
  (symlinking `node_modules`, and, for testing, `venv`) hit exactly this. It does
  not affect this fix (`git ls-files` still never lists a symlink's *contents*
  either way, tracked or not), but a future guard that walks `git status
  --ignored` instead of `git ls-files` would need to know this.
- **Revisit if** a fourth false trip surfaces from something `git ls-files`
  itself would return — i.e. a tracked file, not an untracked one. That would be
  a different bug (a real corpus problem, not a walker problem) and this ADR
  would not cover it.

## Verification

- `bash scripts/check_decision_claims.sh` — **484 checked, 484 holding, PASS** in
  this lane's worktree (`/Users/aldemirkonuk/Projects/wt-w0-claims`), both with no
  `venv` present and with a real (non-symlinked, gitignored) `venv` planted at
  `services/agent-orchestrator/venv` carrying three synthetic offenders, one per
  affected guard: an unpaired `conkey` file, a file that fails to parse, and a
  non-UTF-8 file.
- **Mutation test 1 (absence must not falsely fail).** With those three planted,
  untracked files in place: the pre-fix script content (`git show HEAD:...`,
  swapped in place so `__file__`/`ROOT` resolve correctly, then restored) trips on
  all three — `check_fk_repoint_by_referenced_column.py` reports a violation at
  `services/agent-orchestrator/venv/.../plantedpkg/fake_sql.py:4`;
  `check_task_types_are_graded.py` exits 2, "does not parse"; `check_a_count_is_recorded.py`
  exits 2, "unreadable file in corpus." The fixed scripts, run against the exact
  same tree, all PASS and report the same file counts as with no plant at all (19
  SQL-touching files, 43 emitted task types, 1694-file corpus) — the planted files
  are invisible to the fixed guards, not merely tolerated.
- **Mutation test 2 (presence must still fail).** `apps/api-gateway/src/inventory-ledger/inventory-ledger.service.ts:633`'s
  `rpc("record_stock_count", {...})` was temporarily reverted to the pre-ADR-0078
  shape — `rpc("apply_stock_movement", {..., p_transaction_type: "reconciliation"})`,
  a real, committed-style edit to a tracked file. `check_a_count_is_recorded.py`
  correctly FAILs (arm A) on it, and the full checker reports it (plus two
  `ADR-0141` rows that share the same call site) as REGRESSED —
  `484 checked, 481 holding`. The file was restored immediately afterward and the
  checker re-confirmed at `484 checked, 484 holding`.
- `./scripts/check_fk_repoint_by_referenced_column.py --self-test` and
  `python3 scripts/check_a_count_is_recorded.py --self-test` both still PASS
  unmodified (all five self-test arms of the latter, including the
  outside-the-repository empty-corpus case, which now fails one step earlier — at
  `git ls-files` — but is still correctly `CannotCheck`, never a pass).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | L14b (Sonnet 5, this lane) | Created; both mutation directions verified in `/Users/aldemirkonuk/Projects/wt-w0-claims` |
