## Work owed by the ADR 0115 drinks lock — OPEN — 2026-10-02

Filed from branch `docs/adr-0115-drinks-lock`, which locks
[ADR 0115](../decisions/0115-the-house-item-is-the-ledgers-key.md) as amended by
its §2026-10-02 (the founder's drinks rulings) and §Build order. Each item below
is owed work, not an open fork. Open forks are OD-218 to OD-222 in
`OPEN-DECISIONS.md`. Line numbers are at `a823ef32d`, this branch's base.

**1. Rename `wine_consumption_log` (R20, "Widen now, rename owed (Recommended)").**
- D2 widens the table to point at any kind. Renaming it is owed, in its own PR,
  any time after D2.
- The question put to the founder said "about 98 code references in about 39
  files". Re-measured here as matching lines with
  `git grep -n wine_consumption_log a823ef32d -- . ':!.planning'`, the counts are:
  - 146 lines in 54 files;
  - of those, `apps/api-gateway` holds 93 lines in 34 files;
  - and `supabase/migrations` holds 25 lines in 3 files.
- The two figures count different scopes. The rename PR re-measures before it
  starts.

**2. Research serve defaults for three kinds (R31, "Hold until researched (Recommended)").**
- The three kinds are liqueur/vermouth, sake, and soft drinks by the glass. None
  of them has a default.
- Until the research lands, their serves are held by name, and their sales wait
  until the house states a size.
- The research is owed, but it is not a gate: step S ships without it, and those
  three kinds have no default until it lands.
- It is Mudavym's own cited market-default research, written as rows of
  `serve_size_defaults`. It is not the per-item research queue that R93 makes
  wine-only. See ADR 0115 §2026-10-02, "R31 and R93 name different research".

**3. Make the research queue refuse every non-wine item (R93, "Wine-only for both (team draft)").**
R93 covers only the product's per-house ML extraction and its per-item research
queue. The refusal is not built: `claim_house_item_research` has no kind filter at
`a823ef32d`. D4 builds it, and that work touches:
- `claim_house_item_research`
  (`supabase/migrations/20261116101200_house_item_research_is_worked_by_the_enrich_chain.sql:118`),
  which takes a new migration and does not edit this applied one;
- `apps/api-gateway/src/inventory/house-item-research.ts` and its spec;
- `services/agent-orchestrator/jobs/house_item_research_tasks.py` and
  `services/agent-orchestrator/tests/test_house_item_research_tasks.py`.

**4. Analyse Sophra's recipe pages (A11).**
- The founder asked for an analysis of how
  https://beverage.runsophra.com/dashboard/recipes behaves around recipes,
  batch cocktails, batch lemon juice and batch syrups.
- The page needs a signed-in account. The founder signs in himself; no agent
  enters credentials for him.
- Not started.

**5. Legal disclosure of prices and serves (R84, "Not now (Recommended)").**
- This is out of scope until the first TR house onboards. Revisit it then.

**6. Production counts (build order step 0).** None of these has been run, because
the Supabase connection needs the founder's sign-in:
- the lock review's §7 queries
  (`/Users/aldemirkonuk/Projects/p4-scratch/adr-0115-lock-review-2026-10-01.md:358-366`);
- the count of wines with no size (R7);
- rows that cannot be backfilled (R15);
- the size of the misfiled-row repair (R12, A5);
- the `restaurants.country` values that R30 reads.

**7. The house-item guard.**
- `scripts/check_house_item_invariants.py` invariant 4 crashes on PGlite with
  `"array_agg" is an aggregate function` (lock review C19).
- R24 wires the guard into CI only after that fix. It blocks on a fresh build
  and runs nightly against production as an advisory.

**8. Ask BJCP for permission (R90, "Ship thin, ask BJCP (Recommended)").**
- A person sends BJCP the permission request.
- The beer style table ships with only `other` and free text until BJCP says
  yes.

**9. Change the visible "Spirits" labels (X3, "Rakı chip, "Hard liquor" (Recommended)").**
The labels are at:
- `apps/web/src/pages/cellar/next/cellar-format.ts:247`;
- `apps/web/src/lib/mudavym/pageNames.ts:54`;
- `apps/web/src/lib/mudavym/rooms.ts:112`;
- `apps/web/src/pages/HouseMenu.tsx:37`;
- `apps/web/src/pages/promotions/next/promotions-scope.ts:47`;
- `apps/web/src/pages/cellar/next/registerShapes.ts:97` (the register's one-line
  description).

Renaming the `/spirits` route is a separate question (OD-222).

**10. Stale prose inside applied migrations (lock review C1, C24, LRV:356).**
- `20260905235000_an_index_series_is_not_a_price.sql:400` calls the 0115
  migration "unapplied".
- `20260906010000_a_generic_name_stays_the_venues_own_wine.sql:57` and `:129`
  say `master_wine_id` is NOT NULL.
- The 0115 migration's own header (`:3`, "GATED. DO NOT APPLY", and `:93`) and
  its §2 comment (`:290`) are stale too.

Applied files are not edited. ADR 0115's Status and rollback brackets are the
correction.
