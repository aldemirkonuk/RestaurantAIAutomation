# 0238 — New register entries go in their own files; the two hot registers are frozen in place

- **Status:** Locked 2026-09-29 (founder). F1 answered, F2 deferred with a measurement plan, F3 open (§Forks). Supersedes nothing. It retires one convention — "append a row to the tail of `CLAIMS.jsonl` / `v3.0-TECH-DEBT.md`" — and no document.
- **Date:** 2026-09-29
- **Decider:** Aldemir (founder). His delegation, verbatim: *"do the most righteous thing"*, given against three options (one file per entry, git's `union` merge driver, or keep the files and merge one at a time). His answers on 2026-09-29, verbatim: to *"Do these small files count as entries in the existing lists, not new documents?"* — **"Yes, entries (Recommended)"**; to carrying the audit forward on a merge-only update — **"Not now, measure first (Recommended)"**.
- **Keywords:** merge conflict, CLAIMS.jsonl, v3.0-TECH-DEBT, fragments, claims.d, tech-debt.d, freeze sentinel, pin, union merge driver, strict branch protection, re-audit, register churn
- **Links:** [[0090-pr-audit-gate-autonomous-merge]] (a new head is a new audit; main is "5 contexts, strict", :923), [[0220-…]] (tracked-files-only walkers, weighed in §Decision 2), [[0032-vault-cleanup-cut-line]] (archive = delete + tombstone; nothing here is archived), CLAUDE.md §4 (retire-to-write), §5b (claims must be re-checkable). Research: the draft `.planning/handoff/evidence/REGISTER-CHURN-DRAFT-ADR-2026-09-29.md` on branch `main-1ll9rp` (not on `main`) — a workflow run with three candidates (fragments, union driver, audit carry-forward), each attacked adversarially. This ADR is that draft, locked and built; the draft is superseded by it.

## Context

Almost every PR appended one row to the tail of `.planning/decisions/CLAIMS.jsonl`, and many a `## …` entry to the tail of `.planning/v3.0-TECH-DEBT.md`. Two PRs that append at one tail conflict as soon as either merges. Measured at `origin/main` 6cd76b64f over the last 60 first-parent merges: 49 touched CLAIMS and 27 touched TECH-DEBT; at each merge 14.6 other claim-adding PRs were open on average, 29 at most. On 2026-09-29 merging #511 made #508, #512 and #514 CONFLICTING, and `git merge-tree` showed those two files as the only conflicting paths for each; 10 of 19 active branches conflicted with main, all 10 only on those two files.

A conflict fix is a new head, and ADR 0090 re-audits every new head (`.claude/skills/pr-audit-gate/SKILL.md:27-30`; `scripts/hooks/require_pr_audit.py:220-245`). So every conflict cost a hand resolution, a chance to resolve wrongly, and a fresh audit. A separate cost exists without any conflict and is **not** removed here: main is `strict: true` (ADR 0090:923; `ci.yml:374-376`), so every merge makes every other open PR BEHIND, and bringing it up to date is a new head anyway.

Constraints, checked on `origin/main` 446f49d75 and re-checked at 29daea03a (2026-09-29):
- **Claim ids repeat by design** (505 distinct ids over 742 rows at 6cd76b64f; ADR-0104 alone 33 times). Nothing deduplicates rows.
- **Line citations point into both files and nothing checks them:** 127 `v3.0-TECH-DEBT.md:N` citations in 70 files and 16 `CLAIMS.jsonl:N` (re-measured with `git grep -oE`). `check_citation_pairing.py` reads only `OPEN-DECISIONS.md`. A mid-file insert breaks them in silence.
- **Gate-owned files** (`scripts/pr_audit_gate.py` `_GATE_OWNED_PATHS`) include `ci.yml`, `CLAUDE.md` and `.planning/decisions/README.md`, and do **not** include the claims runner, its parser, its test, or `.gitattributes`.
- **CI already runs** the runner, the parser self-test and the runner test (`ci.yml:605`, `:623`, `:625-626`), with no `paths:` filter.

## Options considered

1. **Keep the files; merge one at a time (do nothing).** Under strict protection merging is already serial, so this is today. Each merge turns every PR appending to the same tail into a hand-resolved conflict plus a fresh audit: O(n) per merge, O(n²) per train, and each hand resolution can insert a row mid-file and silently shift citations. **Rejected** — it is the churn the founder asked to stop.
2. **git `merge=union` in `.gitattributes`.** In a scratch clone it made #508/#512/#514 merge with exit 0. **Rejected, three independent reasons:** (a) GitHub computes mergeability server-side and does not honour repo merge drivers (a GitHub Support quote in community discussion #9288, not re-fetched; separately, git 2.46 reverted reading in-tree attributes in bare repos, RelNotes 2.46.0:276-279, verified) — #514 would still show DIRTY; (b) it corrupts in silence: two sides editing one row (one flips `status`, one rewords) leaves both an `open` and a `resolved` row for the same id, both pass, nothing flags it because ids repeat — reproduced in the scratch clone, and exactly CLAUDE.md §5b's "git merges duplicate ids in silence"; in prose it can splice two sections mid-entry; (c) it removes zero audits. A per-clone `.git/info/attributes` has the same silent-duplicate risk and, after this ADR, nothing left to fix.
3. **Carry the audit forward on a register-only resync.** The only option that also removes the strict re-audit. **Deferred (F2)** — it changes four gate-owned files, weakens ADR 0090's every-new-head rule on a public repo using `pull_request_target`, its union step was unsafe for in-place edits (35 of the 49 CLAIMS-touching merges edited mid-file), and its benefit is unmeasured.
4. **Sort CLAIMS by id so inserts spread out.** **Rejected** — 40 of 671 concurrent PR pairs would still land in the same gap (a proxy, not measured conflicts); sorting once moves all 16 CLAIMS citations; it does nothing for TECH-DEBT prose.
5. **Drop strict protection.** **Rejected** — `ci.yml:374-379`'s migration-order check is sound only because a PR "merges only when its head is up to date with main"; without it two migrations can land out of order, and PRs merge untested against each other.
6. **GitHub merge queue.** **Rejected** — from prior knowledge (the docs page was proxy-blocked): organization-owned repositories only, and this one is user-owned; it would also need a `merge_group:` trigger in gate-owned `ci.yml`.
7. **Fragments compiled into one file at release, then deleted** (towncrier, changesets). **Rejected** — compiling brings the shared tail back and moves every citation into the compiled file.
8. **Fragments kept permanently; both hot files frozen in place (chosen).** Every new entry is a new file, so two PRs never write the same path; the existing files never change length, so every existing citation keeps resolving. This is reno's model (notes are kept) and GitLab's `changelogs/unreleased/<branch-slug>.yml`, adopted because "two merge requests added their own entries at the same spot … created a merge conflict in one as soon as the other was merged".

## Decision

**New claims go in `.planning/decisions/claims.d/<branch-slug>.jsonl`. New debt entries go in `.planning/tech-debt.d/<YYYY-MM-DD>-<branch-slug>.md`. `CLAIMS.jsonl` and `v3.0-TECH-DEBT.md` are frozen at a pinned line count behind a final sentinel; a legacy entry may still be edited in place, but no line may be added to or removed from either file.** Every part of the mechanism lives in files that are not gate-owned; `ci.yml` does not change.

### 1. The freeze (both files, one rule)

- `CLAIMS.jsonl` ends in `{"_comment": "FROZEN 2026-09-29 (ADR 0238). …"}`; `v3.0-TECH-DEBT.md` ends in `## FROZEN — new entries live in .planning/tech-debt.d/ (ADR 0238)` and one pointer paragraph.
- `scripts/check_decision_claims.sh` holds `CLAIMS_FROZEN_LINES=746` and `DEBT_FROZEN_LINES=7063`, the counts at this PR's head (recomputed once already: #512 merged while this was built, appending to both files — the race §Transition 1 describes — and PR A was synced by merge, taking main's copy of each register plus the sentinel), and passes them explicitly (`_claims_parse.py --frozen-lines`, `_debt_frozen.py --frozen-lines`), so enforcement never depends on the sentinel being present. There is no override variable; the runner test rewrites the constants in its own *copy* of the runner.
- **Exit 7** from the runner, with a message naming the fragment folder, when either file's newline count differs from its pin, CLAIMS's last non-blank line is not the sentinel, or TECH-DEBT's last `## ` heading is not `## FROZEN`. That covers a row after the sentinel, a row inserted above it (the classic careless conflict fix), a deleted or overwritten sentinel, and a "**Fix.**" paragraph added inside a legacy TECH-DEBT entry — which a heading-only check would miss.
- **Closing a legacy entry:** flip a CLAIMS row in place (it stays one line); strike a TECH-DEBT heading in place (`~~OPEN~~ CLOSED on …`). A longer note goes in a `tech-debt.d/` fragment citing `v3.0-TECH-DEBT.md:<line>` plus the heading text.
- **Deleting a legacy row** now means editing the pin — deliberate, conspicuous friction, since a deletion shifts every citation below it.
- **Known hole, accepted:** one diff that deletes a legacy row and adds one above the sentinel keeps the count; only review catches it. The sentinel text names the rule.

### 2. Reading the folders

- `_claims_parse.py [--frozen-lines N] [--fragments DIR] PATH…` parses `CLAIMS.jsonl`, then every `claims.d/*.jsonl` in name order. It lists the directory in Python (a bash glob with no match stays literal) — chosen over `git ls-files` after weighing ADR 0220: that ADR's risk is gitignored venvs in source trees, impossible in a fixed planning folder, and a listing works in the runner test's non-git fixture trees.
- Every existing rule — MALFORMED, MUZZLED `2>`, MULTILINE — applies to fragments unchanged, and every message is now `<file>:<line>`.
- New failures, same never-vacuous spirit, parser **exit 8** → runner **exit 2**: a name not matching `^[a-z0-9][a-z0-9.-]*\.jsonl$` (so `foo.json`, `Foo.JSONL`), a subdirectory, a fragment with zero claims. A missing `claims.d/` is exit 2 (cannot read), never "zero fragments". "Zero claims" (exit 4) is the total across files. Precedence: 3 > 5 > 6 > 7 > 8 > 4.
- `scripts/_debt_frozen.py` (new, `--self-test`) does the TECH-DEBT pin and heading check and the `tech-debt.d/` rules: `<YYYY-MM-DD>-<slug>.md` with a real date, no subdirectory, at least one `## ` heading per fragment. The runner calls it; the runner test calls its self-test — which is why CI needs no new step.

### 3. Naming

- One claims fragment **per branch**, not per claim (ids repeat, so `<id>.jsonl` would collide).
- Slug: the branch name lowercased, every character outside `[a-z0-9.-]` → `-`, repeats collapsed, no leading `-`/`.`. `fix/devtruth-tab-crash` → `fix-devtruth-tab-crash`. Lowercase-only means no case-only clash on the founder's macOS filesystem.
- Two open branches with one slug get a git add/add conflict — loud, proven in the runner test, strictly better than today's silent duplicate row. A name already on `main` from an earlier operation takes `-2`, then `-3`.
- The defect register is now `v3.0-TECH-DEBT.md` **plus** `tech-debt.d/`: `grep -rn … .planning/v3.0-TECH-DEBT.md .planning/tech-debt.d/`.

### 4. Citations

Nothing above either sentinel moves, and the pin enforces it, so all 127 + 16 existing citations keep resolving. New entries are cited `claims.d/<slug>.jsonl:<n>` / `tech-debt.d/<file>.md:<n>`; a fragment has one author, so these do not drift. `check_no_conflict_markers.py` already scans every tracked `.md`/`.jsonl`; `check_od_ids_exist.py` walks all of `.planning/` (`os.walk(ROOT)`), so a fragment citing an OD id must cite a real one.

## Forks

- **F1 — Are fragments entries or new documents (CLAUDE.md §4 retire-to-write)? ANSWERED: entries.** Each folder's README is its index ("the directory listing is the entry list"); no per-entry index, which would recreate the hotspot. What this retires is the tail-append convention.
- **F2 — Carry the audit forward on a clean, register-only resync. DEFERRED: "Not now, measure first."** Not built. Measurement plan: for one week from the day this merges, for every ADR 0090 re-audit, record whether the new head is a pure main-sync — `git diff <audited-head>...<new-head>` minus main's own changes is empty, i.e. the PR's merge-base..head diff is byte-identical to the audited one — and count those against all re-audits. The founder decides F2 with that ratio in hand. If built, the proof would need: add-only hunks, byte-identical PR diff, no path touched by both sides, CI green, a real gate-posted PASS at the audited head — and it still could not see semantic interaction between main's new code and the PR. It changes gate-owned files (`pr_audit_gate.py`, `require_pr_audit.py`, the SKILL, ADR 0090), so it is a founder merge by definition.
- **F3 — The same treatment for `OPEN-DECISIONS.md` row shifts and the gate-owned ADR-index tail in `.planning/decisions/README.md`. OPEN.** OD ids are unique and `check_citation_pairing.py` already polices OD citations, so fragments there need their own design; the README index is gate-owned, so any fix is a founder merge. **Recorded here, not in `OPEN-DECISIONS.md`, on purpose:** a new row goes at the end of its "## Open" table (line 92 on 29daea03a), and 62 of the 220 `OPEN-DECISIONS.md:N` citations in the repo point at line 92 or below — filing F3 would itself shift them, the very defect F3 is about. Recommendation: a separate ADR after this one has run for about two weeks.

## What was built (PR A) and what is left (PR B)

**PR A — not gate-owned, the ordinary ADR 0090 audit applies:** the two sentinels; `_claims_parse.py` (multi-file, pin, listing, name and empty rules, exit 7/8, `file:line` messages, 26 new self-test cases); `check_decision_claims.sh` (pins, fragment arguments, `7)`/`8)` arms, the `_debt_frozen.py` call); `_debt_frozen.py`; `test_check_decision_claims.sh` (23 new cases, including three-branch and add/add git merges in a temporary repo, and the debt self-test); `move_tail_to_fragment.py`; both READMEs; this ADR; and its one claim, `claims.d/feat-register-fragments.jsonl`, the first fragment — being counted at all proves fragments are read. Its verify command fails on `origin/main`.

Built differently from the draft, and why: the draft's six claim rows became **one** (the runner's count is main's + 1, and the one row carries every mechanical check); the draft's `open` "CLAUDE.md points at fragments" row is **not** filed, so PR B is tracked by this section rather than by a claim; `scripts/check_new_tables_are_locked_down.py:2002` was **not** changed — on reading, it cites where the existing OD-59/OD-94 rows are, which stays true, and tells no one to add a row (no script under `scripts/` does, by grep); `.planning/handoff/PROGRESS.md` was not touched; the transition helper never pushes (it prints the push command on success).

**PR B — gate-owned, the founder merges it. Nothing depends on it: exit 7 and the sentinels redirect on their own.**
- `CLAUDE.md:124-125` — "the only top-level docs besides `v3.0-TECH-DEBT.md` and `config.json`" → "…besides `v3.0-TECH-DEBT.md` (frozen; new entries in `tech-debt.d/`, ADR 0238) and `config.json`".
- `CLAUDE.md:130-131` — "`v3.0-TECH-DEBT.md` is the live defect register." → "`v3.0-TECH-DEBT.md` plus `.planning/tech-debt.d/` is the live defect register (ADR 0238); search both."
- `CLAUDE.md:167-168` — "Add a line to [`.planning/decisions/CLAIMS.jsonl`](…)" → "Add a line to your branch's fragment, [`.planning/decisions/claims.d/<branch-slug>.jsonl`](.planning/decisions/claims.d/README.md) (`CLAIMS.jsonl` is frozen, ADR 0238)".
- `.planning/decisions/README.md` — this ADR's index row, after the 0237 row (line 172).

**Not touched:** `ci.yml` (its :272 comment becomes slightly incomplete, not wrong); `pr-audit-gate.yml`, `pr_audit_gate.py`, `require_pr_audit.py`, `scripts/hooks/*`, `.claude/*`; `check_citation_pairing.py`, `check_no_conflict_markers.py`; ADR 0050 and 0090. `.claude/skills/pr-audit-gate/SKILL.md:193` and `e2e-prod.yml:28` mention the registers only in prose; the latter's citation points into the frozen file and still resolves.

## Transition plan for open PRs

1. **Hold the train; land PR A first.** The sentinel is itself a tail append, so PR A loses the race it exists to end if anything merges ahead of it. If something does, sync PR A, recompute the two pins against the new main (the only numbers that change), and let the gate re-audit.
2. **Migrate each open branch once:** check it out and run `scripts/move_tail_to_fragment.py`. It (a) finds the merge base; (b) moves every **whole new entry** the branch added — claim rows anywhere (rows are order-independent, so a row an earlier hand fix put mid-file moves too), or whole `## ` sections — to the branch's fragments, and keeps count-preserving in-place edits where they are; (c) repoints citations of moved lines, only on lines the branch added; (d) commits, then merges `origin/main` (no rebase, no force); (e) runs the claims check and fails unless it passes. It refuses (exit 3, nothing written) on a hunk that changes the line count inside the frozen range, or an insertion that is not a whole entry.
3. **Each migrated head gets a fresh ADR 0090 audit.** The conflicting branches already owe one; for a branch that was only BEHIND, the migration adds a sync it would otherwise have got from a clean update.
4. **After migration no two branches conflict on these two files;** a sync after a merge is a clean server-side update, and the gate re-audits on `synchronize` (`pr-audit-gate.yml:66-68`). *Unverified:* whether an update-branch call made with the session's `gh` identity fires `pull_request_target: synchronize` (a `GITHUB_TOKEN` push fires nothing) — check it on the first migrated PR.

**Evidence, from a scratch clone with a local `sim-main` = `origin/main` 446f49d75 + PR A (744 claims before any migration):** before migration, `fix/devtruth-tab-crash` conflicts with `sim-main` on exactly the two registers. The helper moved its 1 claim row and 8 debt lines, merged clean, and the runner counted 745 = 744 + 1. `feat/cutover-manifest-trial` (3 claim rows inserted mid-file above the last 3 lines, a 33-line debt section, 24 in-place CLAIMS line edits in 19 hunks and 1 in-place debt line) moved and merged clean, 747 = 744 + 3, in-place edits kept. `fix/ask-round-6z` was **refused** (a CLAIMS hunk replaces 1 line with 2 — an edit and a new row in one hunk), as designed: that one is a hand fix. Then three fresh fragment branches off `sim-main`: one merged, the other two still merged clean; the migrated devtruth branch merged, and the migrated cutover branch and both remaining fragment branches still merged clean; after all merged, the runner counted 751 = 744 + 1 + 3 + 3, PASS.

## Consequences

- **Easier.** Filing a claim or a debt entry never conflicts with another PR, and a sync after a merge is a clean server-side update. A wrong conflict resolution can no longer shift a citation; existing citations are now guarded by the pin rather than hoped for. A duplicate fragment name fails loudly as add/add, where a duplicate row merged silently.
- **Harder or given up.** No single file shows the whole register — read the frozen file plus the folder (`grep -r`, `ls`); a committed compiled view would be a new hotspot, so there is none. A PR that files debt also creates a file. The pins are magic numbers; changing one is deliberate and visible.
- **Not solved, stated plainly.** Strict re-audits remain: every merge still makes every other PR BEHIND and each sync is a new head ADR 0090 audits again (only F2 removes that). Tail conflicts on the gate-owned ADR index remain (F3). `OPEN-DECISIONS.md` row inserts still shift citations (F3). Two PRs editing the same legacy row still conflict — correctly, that is a real semantic conflict.
- **Revisit when:** a PR is refused with exit 7 twice in a month (the rule is being fought, not followed); `claims.d/` passes about 500 files (then per-month subfolders, never compiling); the F2 measurement is in.

## Research limits (CLAUDE.md §0.5)

- GitHub ignoring repository merge drivers rests on a 2017 Support quote and third-party reports, not re-fetched; the git 2.46 revert was verified verbatim. Merge-queue availability is prior knowledge (docs proxy-blocked). The 40-of-671 sorted-gap figure is a proxy. Branch-protection strictness is taken from ADR 0090:923 and `ci.yml:374-376`, not queried live. The churn counts (49/27 of 60, 14.6 mean, 10 of 19) were measured by the draft at 6cd76b64f and not re-measured at 446f49d75; the citation counts were.
- The helper was run on three real branches, not on all open ones; the in-place/insertion split of the others is unmeasured until each is migrated.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-29 | Workflow: 3 candidates (fragments, union driver, audit carry-forward), each attacked adversarially; synthesis | Draft (`main-1ll9rp`). Fragments chosen and hardened with the attack's fixes: line-count pin on both files, explicit enforcement, Python listing, per-file error attribution, slug normalization, PR A/B split. Union rejected. Carry-forward left open as F2. |
| 2026-09-29 | Founder | Locked. F1: "Yes, entries (Recommended)". F2: "Not now, measure first (Recommended)". |
| 2026-09-29 | Build session (PR A) | Built as above; helper generalized from tail-only to whole-entry insertions after `feat/cutover-manifest-trial` showed rows placed mid-file by an earlier hand fix. |
