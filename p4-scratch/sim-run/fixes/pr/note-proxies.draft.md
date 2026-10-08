> **[2026-10-07 13:27Z, fixer, local head fe7a8737b]**
> Prep re-head after the PASS at `22a192cf2` (report `audits/617-22a192cf2/report.md`). LOCAL ONLY: nothing pushed. The PASS does not carry over to this head.

**Commits since `22a192cf2`**
- `f8434f8c5`: merge of `origin/main` `5e6c0684e` (#620 zoneaddr, #651, #622). `merge_main.sh` reported MERGED, so nothing conflicted.
- `6ff5b7b33`: renumbers the migration and its test from `20261223010000` to **`20261223170000`**, and updates the one line in `scripts/sql_outside_migrations.txt`. The SQL is unchanged. #620's `20261223030000` is now on main, so `check_migration_order` failed after the merge. A sweep of every ref, plus every worktree's `supabase/migrations` on disk, found versions claimed up to `20261223060000` (`000000`, `010000`, `020000`, `030000`, `040000`, `060000`). This version goes well past that.
- `fe880022a`: ADR 0298 quotes the founder's check-discount answer verbatim. The question, the pick and both rejected options are in Status and Consequences. "Revisit when" now reads: spread by line value once ADR 0295 settles "net" (a follow-up). The README 0298 row gets one clause. Under Owed, it records two items: the PASS's "could not be read" item, and the goal-book follow-up's state. Status stays **Proposed**, because it is Proposed for the method and not only for these picks.
- `beae90420`: merge of `origin/main` `b270a45b8` (#609 cap, ADR 0292). Main moved during this run. `merge_main.sh` reported MERGED, so nothing conflicted. #609 changed `analytics.service.ts`'s two consumption reads, its import and a comment. It changed no `supabase/` file. `loadInventory` (`:200`, a rejection or a query error becomes `[]`) is unchanged.
- `fe7a8737b`: the ADR 0298 review-trail row and the goal-book note now name both main merges and `b270a45b8`.

**Results at `fe7a8737b`**
- **Conflicts:** none in either merge.
- **Guards (`lanecheck.sh wt-fix-proxies`):**
  - migration order, versions unique, OD ids, conflict markers, citation pairing and ADR numbers unique all return rc=0;
  - 15 files against `origin/main` `b270a45b8` (at the cap);
  - ownership `[]`.
- **Other guards run:** `check_analytics_cost_honesty`, `check_read_errors_not_swallowed`, `check_windowed_figures`, `check_a_count_is_recorded`, `check_no_seeded_defaults` and `check_migrations_single_home` all return rc=0 (python3.11).
- **Claims** (`PATH=/usr/local/bin:$PATH bash scripts/check_decision_claims.sh`): **922 checked, 922 holding** (`audits/617-claims-prep.txt`).
- **Gateway jest:**
  - the 4 touched specs: 4 suites, **134/134**;
  - `src/analytics src/reports/exports`: 61 suites, **995/995**;
  - with `src/common` added: 105 suites, **1744/1744**.
- **Web vitest:** `ReportsNext.test.tsx` **81/81**.
- **Typecheck:** gateway `tsc -p tsconfig.spec.json` shows only the 2 known `@simplewebauthn` errors. Web `tsc` was **not run**. The first merge brought main's web changes (dashboard, receiving and settings pages). Neither merge changed this PR's two web files (`git diff 22a192cf2 HEAD -- apps/web/src/pages/reports/` is empty).
- **Local Postgres (`pgtest.sh lane`).** It was run after each merge, at `6ff5b7b33` and at `beae90420`, and saved to `audits/617-local-pg.txt`. Each run has a header line naming its head.
  - The lane run applied 2 migrations: #620's `20261223030000` and this one.
  - [fix] PASS for `20261223170000_cost_of_goods_reads_what_sold_test.sql` and for #620's test.
  - [ctl] FAIL for both. This PR's test fails because `pos_item_sales` does not exist on [ctl]. That is a weak control: it shows only that the function is new.
  - The template is `42fe1252b`. `origin/main` has moved past it to `b270a45b8`, and I did not rebuild it. Between the two, the only migration change is #620's, which the lane run applied.
- **Overwritten without reading first.** `audits/617-local-pg.txt` was overwritten, as the task names that path. I did not read it before writing. It held the stale `847f2470d` run, which `audits/617-847f2470d/report.md:166` records as "[fix] PASS on all 5 tests" with [ctl] failing on `pos_item_sales does not exist`.
- **Coordinator note (1), the "unread" sentence.** No code changed. The PASS owes it afterwards, and ADR 0298 Consequences, Owed, now records it with the fix: a failed-active-read flag, and a narrower `itemsCostUnread` doc comment.
- **Coordinator note (2), the goal-book follow-up.** `1b5d5b89a` (`fix/goal-book-cogs-reads-the-till`) is **not on main**, and **not pushed** (`git ls-remote` shows no such branch). On `origin/main` `b270a45b8` the old sentence is still at `goal-scenarios.ts:384`. Its parent is still `0c46277cd`.
- **Trial `git merge-tree` of open PR heads against `fe7a8737b`.** I compared each with the same PR head merged with `origin/main` alone.
  - This PR adds conflicts only in `README.md` (#616, #619), `sql_outside_migrations.txt` (#618) and `cost-honesty.spec.ts` (#626).
  - It adds none for #615, #624 or #628.
  - Every other conflicted file in these trials also conflicts against `origin/main` alone.

**Stale lines in the LIVE body, with replacements** (line numbers are from `gh pr view 617 --json body --jq .body`, fetched between 13:20Z and 13:27Z; the live head was still `22a192cf2`)

- **:1-11 (the coordinator's `22a192cf2` block)** → replace it with this note. If kept, replace:
  - **:2** → "The head to audit is `fe7a8737b`. The migration is now **`20261223170000`**, past main's newest, `20261223030000` (#620). The SQL is unchanged."
  - **:3** → "Versions claimed in any ref or worktree at the ~12:58Z sweep on 2026-10-07: `20261223000000`, `010000` (this PR's old slot), `020000` (#618), `030000` (#620, on main), `040000` and `060000`."
  - **:5** → "Guards at `fe7a8737b`: all rc=0, ownership `[]`, 15 files against `origin/main` `b270a45b8`."
  - **:7-10** → "Local Postgres, re-run at `beae90420`. Template `42fe1252b`, 2 lane migrations: [fix] PASS for this test and #620's, and [ctl] FAIL for both. Output: `audits/617-local-pg.txt`."
- **:20 (renumber owed at merge, past `20261222230000`)** → "Renumber at merge if a migration later than `20261223170000` lands on main first."
- **:157 (`migration_order` FAILS)** is dated "at `429c975e3`". Add after it: "At `fe7a8737b`, `migration_order` exits 0."
- **:210** "with the three founder rulings quoted" → "with four founder rulings quoted: cost gaps, AW17, partial no-move, and check discounts (2026-10-07)."
- **:223-235 (Founder answers)**: add "**Check discounts** (AskUserQuestion, answered 2026-10-07 (recorded 04:29:14Z; the answer's own second was not taken)): *"Name it now, spread later (Recommended)"*. As built: sales stay before check discounts, and the basis says so. Spreading each check's discount over its lines by line value is a follow-up once ADR 0295 settles "net". Quoted in ADR 0298, Status and Consequences."
- **:239-245 (Forks deferred, 1: Discount apportioning)** → "1. **Discount apportioning: answered 2026-10-07**, *"Name it now, spread later (Recommended)"* (see Founder answers). No code change in this PR."
- **:250 (renumber past `20261222230000`, booth `20261222210000`, zoneaddr `20261222220000`)** → "The migration is `20261223170000`. #620 merged at `20261223030000`. #618 booth holds `20261223020000`, which is now behind main and renumbers at its own merge."
- **:257-268 (Shared files; trials against `d10e86ed9`)** → "#609 and #620 have merged, and both merged into this branch with no conflict (`beae90420`, `f8434f8c5`). Trial merge-tree at `fe7a8737b`, compared with each PR head against `origin/main` alone: this PR adds conflicts only in `README.md` (#616, #619), `sql_outside_migrations.txt` (#618) and `cost-honesty.spec.ts` (#626), and none for #615, #624 or #628."
- **:275** "(fork 1)" → "(answered 2026-10-07: *"Name it now, spread later (Recommended)"*; the spread follows ADR 0295)."
- **:288 (template `28d32de36`, 7 lane migrations)** → "The pgtest template is `42fe1252b`, not main (`b270a45b8`). Main's #620 migration ran as a lane migration (2 in all). I did not rebuild the template."
- **:293 ("Could not be read" names a cause it has not confirmed)**: add "The PASS at `22a192cf2` owes the fix after this PR: a flag for a failed active-rows read, so the sentence can drop "no longer active", and a narrower `itemsCostUnread` doc comment. ADR 0298 lists it under Owed."
- **:304-311 (Owed outside this PR)**: add "the "could not be read" sentence when both reads fail (see above)."
- **:6 and :252 (goal-book follow-up `1b5d5b89a`, local, not pushed)** are still true at 13:20Z. No change.

**Not done / not verified**
- Nothing pushed. The live body is not edited.
- Web `tsc` was not run.
- No per-check mutation of the CLAIMS row was run. The row is unchanged.
- T10-T12 were not confirmed one by one. The test file passed whole on [fix].
- Open, and not mine to decide: how to measure a partial ledger refusal.
