# claims.d/ — new executable claims, one file per branch

[ADR 0240](../0240-register-entries-are-fragments.md), locked 2026-09-29.

**This README is the index; the directory listing is the entry list.** A file
here is an *entry* of the claims register, not a new document (the founder's
answer, 2026-09-29), so it names nothing to retire and gets no index row.

## The rule

- `../CLAIMS.jsonl` is **frozen**. Its last line is the `FROZEN` sentinel and
  `scripts/check_decision_claims.sh` pins its line count (`CLAIMS_FROZEN_LINES`).
  Adding a line after the sentinel, inserting one above it, or deleting a row
  fails the build with **exit 7**. A legacy row may still be edited in place
  (for example `open` → `resolved`) as long as it stays one line.
- A **new** claim goes here, in `<branch-slug>.jsonl`, in exactly the format
  and under exactly the rules of `CLAIMS.jsonl` (one JSON object per line;
  `id`, `status`, `claim`, `verify`, `verified`; no `2>` in `verify`; no raw
  newline or tab in a field). The runner reads `CLAIMS.jsonl` first, then every
  fragment here in name order, and runs every claim.

## Naming

- **One file per branch**, holding every claim that branch adds. Not one per
  claim: ids repeat by design, so `<id>.jsonl` would collide.
- `<branch-slug>` = the branch name, lowercased, with every character outside
  `[a-z0-9.-]` (so every `/` and `_`) turned into `-`, repeats collapsed, and no
  leading `-` or `.`. `fix/devtruth-tab-crash` → `fix-devtruth-tab-crash.jsonl`;
  `dependabot/npm_and_yarn/x` → `dependabot-npm-and-yarn-x.jsonl`.
- If that name is already on `main` from an earlier operation on the same
  branch name, add `-2` (then `-3`): `fix-devtruth-tab-crash-2.jsonl`.
- Two open branches that pick the same name get an add/add conflict from git.
  That is loud, which is the point: before this folder, the same collision was
  a silent duplicate row.

## What fails the build (exit 2, "holds something this guard will not read")

- any file other than this README whose name does not match
  `^[a-z0-9][a-z0-9.-]*\.jsonl$` (a stray `notes.json`, a `Foo.JSONL`);
- a subdirectory;
- a fragment with **zero claims** (empty, blank, or only `_comment` lines);
- any MALFORMED / MUZZLED / MULTILINE row, reported as `<file>:<line>`.

## Citing a claim

Cite a new claim as `claims.d/<slug>.jsonl:<n>`. A fragment has one author, so
the line does not drift. Citations into `CLAIMS.jsonl` keep resolving because
nothing above its sentinel may move.

## An open branch that appended to the old tail

Run `scripts/move_tail_to_fragment.py` on it (see its `--help`). It moves the
rows the branch appended after its merge base into `<slug>.jsonl`, leaves
in-place edits where they are, merges `origin/main`, repoints the branch's own
citations of the moved rows, and runs the claims check. It never pushes.
