# NNNN — New register entries go in their own files; the two hot registers are frozen in place

- **Status:** Proposed — draft 2026-09-29, not locked. Three founder forks are listed at the end (F1–F3). Supersedes nothing. It retires one convention, "append a row to the tail of `CLAIMS.jsonl` / `v3.0-TECH-DEBT.md`", and no document.
- **Date:** 2026-09-29
- **Decider:** Aldemir (founder). His delegation, verbatim (2026-09-29): *"do the most righteous thing"*. It was given against three options: one file per entry (a fragments directory), git's `union` merge attribute, or keep the files as they are and merge one at a time. The delegation covers choosing among those three options. It does not cover the forks at the end, which change the ADR 0090 gate or the retire-to-write rule. Those stay the founder's call (CLAUDE.md §0.1).
- **Keywords:** merge conflict, CLAIMS.jsonl, v3.0-TECH-DEBT, fragments, claims.d, tech-debt.d, union merge driver, strict branch protection, re-audit, register churn, freeze sentinel
- **Links:** [[0090-pr-audit-gate-autonomous-merge]] (a new head means a new audit; main is "5 contexts, strict", :923), [[0220-…]] (tracked-files-only walkers; weighed in §Decision 2), [[0032-vault-cleanup-cut-line]] (archive means delete + tombstone; nothing here is archived), CLAUDE.md §4 (retire-to-write), §5b (claims must be re-checkable). Research: workflow run with three candidates (fragments, union driver, carry-forward), each attacked adversarially.

## Context

Almost every PR appends one row to the tail of `.planning/decisions/CLAIMS.jsonl` (743 lines on `origin/main` 6cd76b64f: one `_comment` and 742 claims). Many PRs also append a `## …` entry to the tail of `.planning/v3.0-TECH-DEBT.md` (7,031 lines). Two PRs that append at the same tail conflict as soon as one of them merges. Measured over the last 60 first-parent merges: 49 touched CLAIMS and 27 touched TECH-DEBT. At each merge, 14.6 other claim-adding PRs were open on average, and 29 at most.

On 2026-09-29, merging #511 made #508, #512 and #514 CONFLICTING. `git merge-tree --write-tree origin/main <head>` shows that for each of them the only conflicting paths are those two files. On re-measurement, 10 of 19 active branches conflict with main, and all 10 conflict only on those two files.

A conflict fix changes the PR head, and ADR 0090 re-audits every new head (`.claude/skills/pr-audit-gate/SKILL.md:27-30`; `scripts/hooks/require_pr_audit.py:220-245` matches the marker on the current `headRefOid`). The founder's merge path refuses a PR unless it is MERGEABLE and CLEAN. So every conflict costs three things: a session that resolves by hand, a chance to resolve wrongly, and a new audit.

There is a second, separate cost. It exists even without conflicts, and this ADR does not remove it (see §Consequences). Main's protection is `strict: true` (ADR 0090:923; `.github/workflows/ci.yml:374-376`). So every merge makes every other open PR BEHIND, and bringing a PR up to date creates a new head anyway.

Facts that constrain any fix, all checked on `origin/main`:
- **Claim ids are not unique by design.** There are 505 distinct ids across 742 rows, and 57 ids repeat (ADR-0104 appears 33 times, ADR-0103 16 times, ADR-0021 14 times). No script deduplicates rows. `_od_collisions.py` checks only OD ids in `OPEN-DECISIONS.md`.
- **Line citations exist into both files.** There are 127 `v3.0-TECH-DEBT.md:N` citations in 70 files and 16 `CLAIMS.jsonl:N` citations. No guard checks them: `scripts/check_citation_pairing.py:104` reads only `OPEN-DECISIONS.md`. A mid-file insert therefore breaks them silently.
- **Gate-owned files.** `_GATE_OWNED_PATHS` (`scripts/pr_audit_gate.py:491-535`) includes `ci.yml`, `CLAUDE.md` and `.planning/decisions/README.md`. It does **not** include `scripts/check_decision_claims.sh`, `scripts/_claims_parse.py`, `scripts/test_check_decision_claims.sh` or `.gitattributes`.
- **CI runs every claim command.** The decision-claims job (`ci.yml:597-626`) runs `scripts/check_decision_claims.sh` (:605) and the parser and runner self-tests (:623, :625-626). It has no `paths:` filter and uses the default checkout depth of 1.

## Options considered

1. **Keep the files and merge one at a time (do nothing).** This costs nothing to build. Under strict protection, merging is already serial, so "one at a time" is simply today's process. Every merge still turns each PR that appends to the same tail into a hand-resolved conflict followed by a fresh audit. That is O(n) resolutions per merge and O(n²) across a train of n PRs. Each hand resolution is also a chance to insert a row mid-file, which shifts line citations that no guard checks. **Rejected:** this is the churn the founder asked us to stop.

2. **git `merge=union` in `.gitattributes`.** In a scratch clone (git 2.43), setting union in `.git/info/attributes` made #508, #512 and #514 merge with exit 0, and the unioned CLAIMS.jsonl parsed. **Rejected, for three independent reasons:**
   - **(a) It does nothing where the block actually happens.** GitHub computes mergeability and performs the merge server-side, and it does not honour repo `.gitattributes` drivers. The evidence is a GitHub Support quote in community discussion #9288, which is still open (the quote itself was not re-fetched). Separately, git 2.46 reverted reading in-tree attributes in bare repositories (RelNotes 2.46.0.adoc:276-279, verified). #514 would still show DIRTY.
   - **(b) It corrupts in silence.** Suppose two sides edit the same existing row: one flips `status`, the other rewords the claim. Union keeps both versions with exit 0, which leaves an `open` row and a `resolved` row for the same id. Both pass, and nothing flags them, because ids repeat by design. This was reproduced in the scratch clone. It is exactly the failure CLAUDE.md §5b warns about ("git merges duplicate ids in silence"). In TECH-DEBT prose, union can splice two sections together mid-entry.
   - **(c) It removes zero audits.** The merge still creates a new head.

   A per-clone, uncommitted `.git/info/attributes` would save a session a few minutes of mechanical resolution. It is not recommended either: it carries the same silent-duplicate risk, and after this ADR there is nothing left for it to fix.

3. **Carry the audit forward on a register-only resync.** The gate would post `verdict=PASS carried-from=A` for a new head H when H is a mechanical merge of the audited head A with main, the only paths both sides touched are the two registers, and CI is green. This is the only option that removes the *strict* re-audit as well as the conflict. **Not adopted by this ADR; left open as fork F2.**
   - It changes four gate-owned files: `pr_audit_gate.py`, `require_pr_audit.py`, the pr-audit-gate SKILL and ADR 0090.
   - It weakens ADR 0090's rule that every new head gets a fresh audit, on a public repository that uses `pull_request_target`.
   - As proposed, its union step is unsafe for in-place edits. By the carry-forward candidate's own count, 35 of the 49 CLAIMS-touching merges edited mid-file. Its duplicate check was vacuous for CLAIMS, verified: `_od_collisions.py` never reads CLAIMS.
   - Its benefit has not been measured. The re-audit already runs automatically on `synchronize` (`.github/workflows/pr-audit-gate.yml:66-68`), so what it saves is API credit and latency, not a session.

4. **Sort CLAIMS by id so inserts spread out.** **Rejected.**
   - Measured as a gap-collision proxy (not actual git conflicts): in 40 of 671 concurrent PR pairs, both PRs' new ids would still land in the same gap.
   - Sorting once moves all 16 `CLAIMS.jsonl:N` citations.
   - It does nothing for the TECH-DEBT prose.

5. **Drop strict protection on main.** Non-conflicting PRs could then merge without being updated, so no new head and no re-audit. **Rejected.** `ci.yml:374-379` depends on strict: the migration-order check is sound only because a PR "merges only when its head is up to date with main". Without strict, two migrations could land out of order, and only the push-time backstop would notice, after the fact. It would also let PRs merge untested against each other.

6. **GitHub merge queue.** **Rejected.** From prior knowledge (the docs page was blocked by the proxy, so this was not re-fetched): merge queue is available only for organization-owned repositories, and this repository is user-owned. It would also need a `merge_group:` trigger in the gate-owned `ci.yml`.

7. **Fragments, compiled into one file at release time and then deleted** (as towncrier and changesets do). **Rejected.** Compiling brings the shared tail back, and it moves every citation into the compiled file.

8. **Fragments, kept permanently, with both hot files frozen in place (chosen).** Every new entry becomes a new file, so two PRs never write the same path. The existing files never grow, so every existing line citation keeps resolving. This matches reno, which keeps its notes, and GitLab's `changelogs/unreleased/<branch-slug>.yml`, which GitLab adopted because "two merge requests added their own entries at the same spot … created a merge conflict in one as soon as the other was merged".

## Decision

**New claims go in `.planning/decisions/claims.d/<branch-slug>.jsonl`. New debt entries go in `.planning/tech-debt.d/<YYYY-MM-DD>-<branch-slug>.md`. `CLAIMS.jsonl` and `v3.0-TECH-DEBT.md` are frozen at a pinned line count behind a final sentinel line. Legacy entries may still be edited in place, but no line may be added to or removed from either file.** Every part of the mechanism lives in files that are not gate-owned. `ci.yml` does not change.

### 1. The freeze (both files, same rule)

- **CLAIMS.jsonl.** Its last line becomes the sentinel row `{"_comment": "FROZEN 2026-MM-DD (ADR NNNN). Nothing may follow or be added above this line: new claims go in .planning/decisions/claims.d/<branch-slug>.jsonl"}`.
- **v3.0-TECH-DEBT.md.** Its last section becomes `## FROZEN — new entries live in .planning/tech-debt.d/ (ADR NNNN)`, with a one-paragraph pointer below it.
- **The pin.** `scripts/check_decision_claims.sh` holds two constants, `CLAIMS_FROZEN_LINES` and `DEBT_FROZEN_LINES`. These are the exact line counts at the moment the freeze PR merges; today's values would be 744 and about 7,035. The runner passes them explicitly: `_claims_parse.py --frozen-lines N` and `_debt_frozen.py --frozen-lines N`. This makes enforcement explicit rather than conditional on the sentinel being present. Deleting the sentinel therefore fails, and the fixture trees in `test_check_decision_claims.sh` pass their own values.
- **What a pin violation means.** The runner fails with a new named exit 7 in its `case` (`check_decision_claims.sh:107-124`) if either of these holds:
  - the line count differs from the pin, or
  - the last non-blank line is not the sentinel.

  This covers a row appended after the sentinel, a row inserted above it (the classic careless conflict fix), and a multi-line "Fix." paragraph added inside a legacy TECH-DEBT entry, which would shift the 127 citations. The attack pass found that a check on `## ` headings alone would have missed that last case. The exit-7 message names the fragment directory, so a session following old wording is redirected by the failure itself.
- **Closing a legacy entry.** A legacy CLAIMS row may still be flipped in place, for example `open` to `resolved`, as long as it stays one line. A legacy TECH-DEBT heading is struck in place (`~~OPEN~~ CLOSED on …`), which keeps the line count. A longer closing note goes in a `tech-debt.d/` fragment that cites the legacy entry as `v3.0-TECH-DEBT.md:<line>` together with its heading text.
- **Deleting a legacy row.** This now requires editing the pin. That is deliberate friction: a deletion shifts every citation below it, and a pin change is conspicuous in review.
- **Known hole.** A PR could delete one legacy row and add a new one above the sentinel in the same diff. The line count is unchanged, so the pin passes. Only review catches this. The sentinel text names the rule. Accepted.

### 2. Reading the folder

`_claims_parse.py` takes several paths: `CLAIMS.jsonl` first, then `claims.d/*.jsonl` sorted by name. It lists the directory itself in Python rather than using a shell glob, because a bash glob with no match stays literal when `claims.d/` holds only its README. It runs the unchanged per-file `parse()` on each file and aggregates the results as follows:

- **Exit code.** The worst per-file code wins, and 3 > 5 > 6 > 7 > 4.
- **Zero-claims rule.** "Zero claims" applies to the total across all files, not to each file.
- **Error messages.** Every error message is prefixed with `<file>:<line>`, so a fragment error can be traced to its file. Today's messages carry only a line number.

New hard failures, all in the same never-vacuous spirit as the existing rules:
- a fragment containing zero claims (only blank lines or only `_comment` lines);
- any entry in `claims.d/` other than `README.md` whose name does not match `^[a-z0-9][a-z0-9.-]*\.jsonl$`, so a stray `foo.json` or `Foo.JSONL` is an error rather than silently skipped;
- a subdirectory inside `claims.d/`.

Every existing rule (MALFORMED, MUZZLED `2>`, MULTILINE) applies to fragments unchanged. I chose a directory listing over `git ls-files`, and weighed this against ADR 0220. ADR 0220's risk is gitignored venvs inside source trees, which cannot occur in a fixed planning folder. A directory listing also keeps working in the non-git fixture trees that the runner test builds.

### 3. Naming

- **One claims fragment per branch, not per claim.** Ids repeat by design, so `<id>.jsonl` would collide between legitimate rows.
- **Slug rule.** Take the branch name, lowercase it, map every character outside `[a-z0-9.-]` to `-`, and collapse repeats. For example, `fix/devtruth-tab-crash` becomes `fix-devtruth-tab-crash`, and `dependabot/npm_and_yarn/x` becomes `dependabot-npm-and-yarn-x`. Lowercase-only names mean the founder's macOS filesystem never sees a case-only clash.
- **Same slug twice.** If two branches produce the same slug, git reports an add/add conflict. That is loud (confirmed in a scratch repo), which is strictly better than today's silent duplicate row. If a fragment with that slug is already on main from an earlier operation, append `-2`.
- **Debt fragments.** A debt fragment is named `<YYYY-MM-DD>-<slug>.md`, so a plain `ls` lists the register in date order. It uses the register's existing heading format (`## <title> — STATUS — <date>`). It may hold several entries, but only from one branch.
- **Where to look now.** Anyone looking for debt reads `v3.0-TECH-DEBT.md` **and** `tech-debt.d/`: `grep -rn … .planning/v3.0-TECH-DEBT.md .planning/tech-debt.d/`.

### 4. Citations

- **Existing citations.** Nothing above either sentinel moves, and nothing may be added, so all 127 + 16 existing line citations keep resolving. This is enforced by the pin, not just hoped for.
- **New citations.** New entries are cited as `claims.d/<slug>.jsonl:<n>` or `tech-debt.d/<file>.md:<n>`. Each fragment has one author, so these citations do not drift.
- **Existing checks.** `check_citation_pairing.py` needs no change, since it reads only `OPEN-DECISIONS.md`. `check_no_conflict_markers.py` already scans every tracked `.md` and `.jsonl` file. `check_od_ids_exist.py` will walk `tech-debt.d/*.md` like any other planning markdown, so a fragment that cites an OD id must cite a real one. That is a benefit, and it is documented in the README.

## What must change, and what is gate-owned

**PR A: the mechanism. Nothing in it is gate-owned. It goes through the ordinary ADR 0090 audit and can self-merge on PASS.**
- `scripts/_claims_parse.py`:
  - accept multiple paths and `--frozen-lines`;
  - add the directory listing, the filename rule and the empty-fragment rule;
  - add exit 7;
  - prefix every error with its file;
  - add `--self-test` cases for each new rule.
- `scripts/check_decision_claims.sh`:
  - add the two pin constants;
  - build the file list at :88-99;
  - add a `7)` arm to the case at :107-124;
  - call `python3 "$HERE/_debt_frozen.py" --frozen-lines "$DEBT_FROZEN_LINES" .planning/v3.0-TECH-DEBT.md` next to the `_od_collisions.py` call (:138-141).
- `scripts/_debt_frozen.py` (new): the pin check and sentinel check for TECH-DEBT, plus `--self-test`.
- `scripts/test_check_decision_claims.sh`:
  - add `_debt_frozen.py` to `HELPERS`;
  - fixtures create `claims.d/` and a small debt file;
  - new cases: a stray file, an empty fragment, a row after the sentinel, a row inserted above it, a deleted sentinel, an added TECH-DEBT line, and a two-branch fragment merge in a temporary git repo (must merge clean, and the same slug must fail add/add);
  - call `_debt_frozen.py --self-test` from here. CI already runs this script (`ci.yml:625-626`), so no new CI step is needed.
- `scripts/move_tail_to_fragment.py` (new): the transition helper (below), kept for stragglers.
- `scripts/check_new_tables_are_locked_down.py:2002`: its message says "…in .planning/decisions/CLAIMS.jsonl" and must point to `claims.d/`. Any other script message that tells the reader to add to either register gets the same fix; grep `CLAIMS.jsonl|v3.0-TECH-DEBT` under `scripts/` at build time.
- New directories: `.planning/decisions/claims.d/README.md` and `.planning/tech-debt.d/README.md`. Each holds the naming rule and the freeze rule, and says "this README is the index; the directory listing is the entry list" (fork F1).
- Content:
  - the CLAIMS sentinel row and the TECH-DEBT FROZEN section;
  - this ADR;
  - this ADR's own claims in `claims.d/docs-register-entries-are-fragments.jsonl`, so the ADR uses the rule it sets;
  - one line in `.planning/handoff/PROGRESS.md`, if the handoff runbook describes the tail-append step.

**PR B: pointers only. Gate-owned, so the founder merges it. The mechanism does not depend on it, because exit 7 and the sentinels redirect on their own.**
- `CLAUDE.md:124` (spine list), `:130` ("`v3.0-TECH-DEBT.md` is the live defect register"; this becomes "…plus `.planning/tech-debt.d/`"), and `:167-168` ("Add a line to `CLAIMS.jsonl`" becomes "Add a fragment under `claims.d/`"). All three lines must change. An agent following §4 as written today would miss every new debt entry.
- `.planning/decisions/README.md`: this ADR's index row.

**Not touched:**
- `.github/workflows/ci.yml`. Its :272 comment ("written as commands in … CLAIMS.jsonl") becomes slightly incomplete but not wrong.
- `pr-audit-gate.yml`, `pr_audit_gate.py`, `require_pr_audit.py`, `check_citation_pairing.py` and `check_no_conflict_markers.py`.
- `.claude/skills/pr-audit-gate/SKILL.md:193` and `e2e-prod.yml:28` mention the registers only in prose. The e2e-prod citation points into the frozen TECH-DEBT file, so it still resolves.

## Transition plan for open PRs

1. **Hold the train and land PR A first.** The sentinel is itself a tail append, so PR A loses the same race it exists to end if anything merges ahead of it. PR A is not gate-owned, so the gate can merge it on PASS; no other merge happens until then. If one does slip in, sync PR A, recompute the two pin constants against the new main (they are the only numbers that change), and let the gate re-audit. PR B follows in its own time.
2. **Migrate each open branch once.** Today that is the 10 conflicting branches plus any that are BEHIND and append to either tail. `scripts/move_tail_to_fragment.py <branch>` does the following:
   - (a) finds the merge base;
   - (b) splits the branch's diff to each register by line position. Lines added **after** the merge base's last line are tail appends and move to `claims.d/<slug>.jsonl` or `tech-debt.d/<date>-<slug>.md`. Edits to lines inside the base's range are in-place legacy edits and stay where they are. Examples of the latter: ask-round-6z (+3/−2), create-location-timezone (+2/−2), cutover-manifest-trial (+27/−24);
   - (c) merges `origin/main`, taking main's version of each register's tail region verbatim;
   - (d) searches the branch's own diff for `CLAIMS.jsonl:<n>` or `v3.0-TECH-DEBT.md:<n>` citations that point at the rows it moved, and repoints them to the fragment path and line;
   - (e) runs `check_decision_claims.sh` and refuses to push unless it passes;
   - (f) exits non-zero and asks for a hand fix whenever a hunk mixes in-place and tail lines, or an in-place edit changes a register's line count.
3. **Each migrated head gets a fresh ADR 0090 audit.** The 10 conflicting branches already owe one, because any conflict fix is a new head, so the migration adds no extra audit round for them. For a branch that was only BEHIND, the migration does add a sync it would otherwise have got through a clean update.
4. **After the migration, a new branch cannot conflict with another on these two files.** A sync after a merge is then clean. It can be done with GitHub's update-branch, without anyone resolving conflicts by hand. The gate re-audits on `synchronize` automatically (`pr-audit-gate.yml:66-68`). *Unverified:* whether an update-branch call made with the session's `gh` identity fires `pull_request_target: synchronize`. A push made with `GITHUB_TOKEN` fires no workflow. Check this on the first migrated PR before relying on it.

Only #514 was checked by hand: its single added row, extracted from the diff into `claims.d/fix-devtruth-tab-crash.jsonl`, parses with rc 0 (742 + 1 = 743 claims). The helper is not written yet. The in-place versus tail split has not been run against the other branches.

## Consequences

- **Easier.**
  - Filing a claim or a debt entry never conflicts with another PR, and a sync after a merge becomes a clean, server-side update.
  - A wrong conflict resolution cannot shift a citation, and existing citations are now guarded by the pin, where before they were merely hoped to hold.
  - A duplicate filename fails loudly as add/add, where a duplicate row used to merge silently.
- **Harder or given up.**
  - No single file shows the whole register. You read the frozen file plus the folder (`grep -r`, `ls`). A committed compiled view would be a new hotspot, so there is none.
  - A PR that files debt also creates a file.
  - The pin constants are magic numbers. Changing them is deliberate and visible.
- **Not solved (stated plainly).**
  - **Strict re-audits remain.** Every merge still makes every other open PR BEHIND, and each sync still creates a new head that ADR 0090 audits again. The audit is automatic, but it is not free. Only fork F2 removes it.
  - **Other tails still conflict.** Tail conflicts on the gate-owned ADR index in `.planning/decisions/README.md` remain; 4 of the scanned branches touch it.
  - **OPEN-DECISIONS.md row inserts remain.** They still shift about 211 citations, which `check_citation_pairing.py` does police. This is a separate problem and the subject of fork F3.
  - **Same-row edits still conflict.** Two PRs editing the same legacy row still conflict, which is correct: that is a real semantic conflict.
- **Revisit when** any of these happens:
  - a PR is refused with exit 7 twice in a month, which means the rule is being fought rather than followed;
  - `claims.d/` passes about 500 files and listing it becomes the bottleneck (then consider per-month subfolders, never compiling);
  - the founder decides F2.

## Proof: CLAIMS-style checks (these go in `claims.d/docs-register-entries-are-fragments.jsonl`)

```jsonl
{"id": "ADR-NNNN-CLAIMS-FROZEN", "status": "resolved", "claim": "ADR NNNN: CLAIMS.jsonl is frozen — its line count equals the runner's pin and its last line is the FROZEN sentinel", "verify": "n=$(sed -n 's/^CLAIMS_FROZEN_LINES=\\([0-9]*\\).*/\\1/p' scripts/check_decision_claims.sh); [ -n \"$n\" ] && [ \"$(wc -l < .planning/decisions/CLAIMS.jsonl)\" -eq \"$n\" ] && tail -n 1 .planning/decisions/CLAIMS.jsonl | grep -q '\"_comment\": \"FROZEN'", "verified": "2026-MM-DD"}
{"id": "ADR-NNNN-DEBT-FROZEN", "status": "resolved", "claim": "ADR NNNN: v3.0-TECH-DEBT.md is frozen — its line count equals the runner's pin and its last ## heading is the FROZEN section", "verify": "n=$(sed -n 's/^DEBT_FROZEN_LINES=\\([0-9]*\\).*/\\1/p' scripts/check_decision_claims.sh); [ -n \"$n\" ] && [ \"$(wc -l < .planning/v3.0-TECH-DEBT.md)\" -eq \"$n\" ] && grep '^## ' .planning/v3.0-TECH-DEBT.md | tail -n 1 | grep -q '^## FROZEN'", "verified": "2026-MM-DD"}
{"id": "ADR-NNNN-FRAGMENTS-READ", "status": "resolved", "claim": "ADR NNNN: the claims runner reads claims.d/ — a stray, empty, appended-after-sentinel, inserted-above-sentinel or sentinel-deleted case each fails, and two branches adding different fragments merge with no conflict (runner test cases)", "verify": "python3 scripts/_claims_parse.py --self-test && python3 scripts/_debt_frozen.py --self-test && bash scripts/test_check_decision_claims.sh", "verified": "2026-MM-DD"}
{"id": "ADR-NNNN-FRAGMENT-NAMES", "status": "resolved", "claim": "ADR NNNN: every entry in claims.d/ is README.md or a lowercase <slug>.jsonl, and every entry in tech-debt.d/ is README.md or <YYYY-MM-DD>-<slug>.md", "verify": "! ls .planning/decisions/claims.d | grep -vxE 'README\\.md|[a-z0-9][a-z0-9.-]*\\.jsonl' && ! ls .planning/tech-debt.d | grep -vxE 'README\\.md|[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9][a-z0-9.-]*\\.md'", "verified": "2026-MM-DD"}
{"id": "ADR-NNNN-CI-UNTOUCHED", "status": "resolved", "claim": "ADR NNNN needs no ci.yml change: the decision-claims job still calls the runner and its test, which now carry the fragment and freeze rules", "verify": "grep -q 'scripts/check_decision_claims.sh' .github/workflows/ci.yml && grep -q 'scripts/test_check_decision_claims.sh' .github/workflows/ci.yml && grep -q '_debt_frozen.py' scripts/test_check_decision_claims.sh", "verified": "2026-MM-DD"}
{"id": "ADR-NNNN-CLAUDE-MD-POINTS-AT-FRAGMENTS", "status": "open", "claim": "ADR NNNN PR B (gate-owned, founder merge): CLAUDE.md §4 and §5b name claims.d/ and tech-debt.d/", "verify": "grep -q 'claims.d/' CLAUDE.md && grep -q 'tech-debt.d/' CLAUDE.md", "verified": "2026-MM-DD"}
```

The last row is `open` on purpose. It flips to `resolved` in PR B, so if PR B lands and the row is not flipped, the build fails. That keeps the gate-owned remainder visible until the founder merges it. Before the `status` convention is relied on, check that a row whose verify command fails today is how `check_decision_claims.sh` expects an `open` row to behave. The existing semantics: `open` means the claim must **not** hold yet.

## Open forks for the founder

- **F1 — Retire-to-write and the index rule (CLAUDE.md §4).** This ADR treats a fragment as an *entry* of an existing register, not a new document. The item it retires is the tail-append convention. It adds two README files as the index of their directories and does not list each entry, because a per-entry index would recreate the hotspot. Recommendation: accept. Cost if refused: every fragment must name a document to retire, which is impossible at this volume, and the design falls back to option 1.
- **F2 — Carry the audit forward on a clean, register-only resync.** This is the only fix for the strict re-audit, which remains after this ADR. It is gate-owned: `pr_audit_gate.py`, `require_pr_audit.py`, the SKILL and ADR 0090, possibly `pr-audit-gate.yml`. It weakens "every new head is re-audited" into a mechanical proof, run by the gate from main's trusted checkout. The proof would require:
  - every hunk in both deltas is add-only;
  - the PR's diff (merge-base..head) is byte-identical to its diff at A;
  - no path is touched by both sides;
  - CI is green;
  - there is a real gate-posted PASS at A.

  It still would not see semantic interaction between main's new code and the PR. Recommendation: **not now.** After fragments land, first measure how many audits per merge train are pure clean syncs, then decide with that number in hand.
- **F3 — The same treatment for `OPEN-DECISIONS.md` and the gate-owned ADR index.** OPEN-DECISIONS rows are structured differently: OD ids are unique and `check_citation_pairing.py` polices them, so fragments there need their own design. The ADR index in `README.md` is gate-owned, so fragmenting it is a founder merge by definition. Recommendation: a separate ADR, after this one has run for a couple of weeks.

## Research limits (CLAUDE.md §0.5)

- **Not verified against GitHub's servers.** The claim that GitHub ignores repository `.gitattributes` drivers rests on a 2017 GitHub Support quote and third-party reports. The quote was not re-fetched. The git 2.46 revert was verified verbatim.
- **Merge-queue availability** is from prior knowledge; the docs page was blocked.
- **The 40-of-671 sorted-gap figure** is a proxy, not measured conflicts.
- **The full runner was not run** against a fragment tree. Only the parser level was prototyped.
- **`move_tail_to_fragment.py` is unwritten.** Its split was checked on #514 only.
- **Branch-protection strictness** is taken from ADR 0090:923 and `ci.yml:374-376`. It was not queried live, because `gh` is not installed in the research session.
- **PR numbers were not mapped to branch names** beyond #508, #512 and #514.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-29 | Workflow: 3 candidates (fragments, union driver, audit carry-forward), each attacked adversarially; synthesis by Opus | Drafted. Fragments chosen and hardened with the attack's fixes: line-count pin on both files, explicit enforcement, Python directory listing, per-file error attribution, slug normalization, split PR A/B. Union rejected. Carry-forward left open as F2. |
