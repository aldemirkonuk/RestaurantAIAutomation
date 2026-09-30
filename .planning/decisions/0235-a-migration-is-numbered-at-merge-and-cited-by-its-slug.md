# 0235 — A migration is numbered at merge, and cited by its slug

- **Status:** Locked — the founder's standing rule of 2026-09-27, *"apply this in the future"*
  (item 79 of the founder-answers log that began 2026-09-25; *"Standing rule (2026-09-27):
  number migrations at merge"*), and the founder's confirmation of this record on 2026-09-28,
  item 94, verbatim: *"Locked, as you decided"*. The rule reached the lane that drafted this
  through the orchestrating session's memory note `migrations-numbered-at-merge.md`; the rest of
  the wording is how that note and this record put it into practice. Recorded 2026-09-28.
- **Date:** 2026-09-27 (ruled), 2026-09-28 (recorded)
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** migration, version, renumber, rename, slug, merge step, merge train, strict main,
  stale PR body, re-audit, check_migration_order, check_migration_versions_unique, CLAIMS
- **Links:** [[0212-a-new-migration-sorts-after-every-version-its-base-holds]] (the
  ordering guard, unchanged), [[0085-a-fixture-tests-the-guard-not-the-checkout]] (the ADR-number uniqueness guard, which
  `check_migration_versions_unique.py` copies in shape; it is precedent, not the migration guard's origin, which was PR-driven on 2026-09-05 and has no ADR of its own), ADR 0090 (the serial,
  audited merge; its marker contract is unchanged), CLAUDE.md §5b ("Never reuse a migration
  version"), PRs #429, #436, #440, #473

## The rule

A migration's version, the `YYYYMMDDHHMMSS_` prefix of its filename, is **final only when it
merges**. The version is given in the serial merge step, not when the file is written and not
when the PR opens. Until then a branch carries a provisional version.

Everything written about a migration names it by its **slug**: the filename without the version
prefix. That covers PR bodies, ADRs, CLAIMS rows (the claim's prose and its `verify` command),
`v3.0-TECH-DEBT.md` and OPEN-DECISIONS entries. So a renumber leaves no stale sentence behind.
Old dated sentences are not rewritten in place.

## Context

**The status quo.** A migration took its version from the author's clock. Two guards police
versions. `scripts/check_migration_versions_unique.py` fails when a version is also
claimed on any other branch. `scripts/check_migration_order.py` (ADR 0212) fails when a PR adds
a migration that does not sort strictly after the newest version on its base's tip. Both run in
`ci.yml`'s `migration-versions-unique` job, which `CI Complete` needs. `main` is strict, so every
PR is brought up to date before it merges.

**Why that loops.** Each merge that carries a migration raises the ceiling. After it, every
queued PR whose migration was dated earlier now sorts behind `main`. It has to be renamed. The
rename moves the head, so the audit marker for the old head no longer counts (ADR 0090: the
marker must name the *current* head SHA). The rename also leaves every sentence that cited the
old version pointing at a file that no longer exists.

**Measured 2026-09-28, from the audit comments on the four PRs the rule names:**

- **#436** (merged): an audit listed the PR body's migration table, which cited the
  pre-renumber versions while the files carried later ones, as a prose defect. It is the same
  prose-broader-than-code class that overturned #417.
- **#440** (merged): the planner's final say found stale citations, at the audited head, to
  migration files that no longer existed after the renumber. It noted that a reviewer who
  searched only for the *older* version strings had reported none, a false negative. The PR
  body also still cited the pre-renumber versions.
- **#429** (merged): the body said the migrations had been renumbered to one pair of versions,
  while the files carried a different pair above `main`'s ceiling.
- **#473** (merged): one migration was renamed six times. Its commit headline reads *"rename PR
  #473's migration a sixth time to clear PR #483's collision"*. The PR drew seven audit
  markers, five BLOCK and two PASS. The fourth round's reviewers spent a question just checking
  that the fourth rename was cited consistently.

The note behind this record says most re-audits in merge trains 5–8 came from these renumbers.
**Not re-measured here**: this lane did not count the train re-audits one by one. The four PRs
above were read directly.

## Options considered

1. **Timestamp at author time, rename whenever `main` passes you.** This is the status quo.
   Nothing needs to be built. The cost is the loop above: every merge ahead of you can force a
   rename, every rename forces a re-audit, and every version written into prose goes stale.
   *Rejected.*
2. **Reserve a version block per lane.** Each lane takes a disjoint band up front and numbers
   inside it. That stops collisions between lanes, but not ordering. ADR 0212's guard compares
   against the base tip at merge time, and a band reserved below another lane's band is behind
   it the moment that lane merges first. On 2026-09-21 two sessions reserved disjoint bands. The
   version actually taken fell outside both, and the `vprices` lane lost the ordering race twice
   that day while the uniqueness guard stayed green (memory
   `migration-uniqueness-is-not-ordering.md`). Bands also need a registry that every session
   keeps, and they do nothing for prose that cites a version. *Rejected*: it is discipline
   standing in for a mechanism, and that discipline had already failed.
3. **Renumber at PR open.** Give the final version when the PR opens, past `main`'s ceiling.
   But the ceiling moves between open and merge, so every PR that merges first can invalidate
   the number. That is the same loop starting earlier. #473 was renamed six times *after* it
   opened. *Rejected.*
4. **Number at merge, cite by slug.** *Chosen* (the founder's rule). At merge time the ceiling
   is known and nobody can overtake it, because merging is serial (ADR 0090). With slug
   citations, a rename touches only filenames.

Dropping version prefixes altogether was not considered. The Supabase CLI and
`schema_migrations` key on the version, so the prefix stays.

## Decision

**Numbered at merge.** In the serial merge step, after the PR is brought up to date with
`origin/main` and before its final CI run, the merger:

1. Takes the ceiling as the newest version on `origin/main` **and** on the heads of every open
   PR still queued. Going past queued PRs keeps the uniqueness guard green: it reads every branch,
   and a queued PR's provisional version is a claim on that version until it merges.
2. Renames this PR's migrations past that ceiling, keeping their relative order. Each change is
   a `git mv` under `supabase/migrations/`, plus a swap of any leftover version string that
   still names the file.
3. Runs `scripts/check_migration_order.py` and `scripts/check_migration_versions_unique.py`
   locally, then pushes and lets CI run on that head.

The queued PRs that were skipped over are renumbered the same way when their own turn comes.
Merge order already sets production's apply order, so a migration that depends on another open
PR's migration has to merge after it either way.

**Cited by slug.** A CLAIMS `verify` that needs the file globs it as
`supabase/migrations/*_<slug>.sql` and asserts exactly one match, as ADR 0221's CLAIMS row `ADR-0221-VENDOR-ONE-PRIMARY-BRANCH` does. It
never hard-codes a version path.

**A pure renumber is not a new change.** A commit made only of 100% renames under
`supabase/migrations/`, plus version-string swaps, passes the merge step's Opus delta check
without a fresh ADR 0090 audit. The marker contract does not change: `require_pr_audit.py` still
wants a marker naming the current head, and the delta check is what issues it. This exemption
lives in the orchestrator's merge-train script, which is outside this repository. **This record
cannot re-check it**, and nothing in the tree enforces it.

**The guards are unchanged.** No script and no workflow is edited. While a PR waits, `main` may
move past its provisional version. The ordering check then goes red on that PR's next CI run,
and the merge-step renumber clears it. A uniqueness failure (two branches claiming one version)
is still fixed when it appears. `CI Complete` needs that job, and the fix is a rename that
changes no prose.

## Consequences

- **Easier.** PR bodies and records no longer go stale when a number moves. A renumber is
  mechanical and can be recognised as such. Nobody keeps a band registry.
- **Harder, or given up.** A lane cannot know its migration's final version until it merges, so
  anything that must name the real version looks it up on `main` after the merge: production
  ledger lookups, `schema_migrations` queries, the deploy floor check. A waiting PR may show the
  ordering check red, and that is expected. The merge step gains one mechanical step.
- **Checked:** CLAIMS row `ADR-0235-MIGRATION-GUARDS-STAND` (mutation-checked 2026-09-28). It
  asserts that the rule's premise still holds: `ci.yml` runs both `check_migration_versions_unique.py`
  and `check_migration_order.py` (each with its `--self-test`) in the `migration-versions-unique`
  job, and `CI Complete` still `needs` that job. Remove either guard and the row goes red.
- **Not checked** (said plainly, per §0.5):
  - That migrations are *cited by slug*, and that none is renumbered at any moment but merge.
    An earlier draft had a static row for this (no 14-digit version newer than `main`'s ceiling
    in the decisions corpus). It is not carried: lanes legitimately reserve and cite a version
    ahead of the ceiling while they work, so the row would fail them. The slug rule is a
    convention, enforced by the merge step and by audit.
  - PR bodies are not in the tree.
  - A new sentence citing an *older* migration by version passes. Those files are already on
    `main` and never renumber, so the citation cannot go stale. It still breaks the letter of
    the rule.
  - Code comments and tests that name a version are not covered.
  - `.planning/06-pages/` dossiers and other long-form docs outside the decisions corpus are
    not covered.
  - The rename-only delta exemption, as said above.
- **Revisit when** a merge-step renumber changes what production applies (a migration found
  to depend on its old position), when the rename-only exemption lets a non-rename change
  through, or when the Supabase CLI changes how it keys or orders versions.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-27 | Founder | Ruled: *"apply this in the future"* (item 79), relayed through the orchestrating session |
| 2026-09-28 | Claude | Drafted on `docs/adr-migrations-numbered-at-merge` as 0231 (snapshot 446b05aa2). Renumbered 0235 on the record-triage pass: 0231 was taken by #490 |
| 2026-09-28 | Founder | Item 94: *"Locked, as you decided"* |
| 2026-09-28 | Claude | Three citation errors from the triage fixed: ADR 0212's slug, ADR 0085's role (ADR-number precedent), the slug-glob example (ADR 0221's row, not 0229's). Static version-scan row dropped for the reason under Not checked; replaced by a guards-still-run row |
