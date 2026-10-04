# 0303 — A table is what the till names; the owner renames or hides it

- **Status:** Proposed. The ruling it implements is the founder's (AskUserQuestion, 2026-10-04 ~00:30Z), verbatim pick *"Learn from the POS (Recommended)"*. The option text read: *"Every POS table ref becomes a table the owner can rename or hide. Past checks re-link from the stored ref when a table is added or renamed. No drawing."* The method below (where the learning runs, the re-link rules, the hide rule's reach, the Settings list) is lane tables' proposal, built for his review. A lock is his.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** restaurant_tables, pos_checks, table_ref, table_id, learned_at, hidden_at, pos_refs, resolveTable, the room, table-performance, hot tables, report export, Settings Point of sale, rename, hide, AW25, AW30, A-051, A-055, Tuzlu Rüzgar
- **Links:** migration `tables_learned_from_the_pos` and its `supabase/tests` file of the same slug (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); `claims.d/feat-tables-learned-from-the-pos.jsonl`; [[0015-pos-referential-integrity]]; [[0020-no-fabricated-answers]]; [[0051-rebuilt-pages-show-live-data-only]]; [[0067-a-failed-read-is-never-an-empty-one]]; [[0105-a-pos-connection-is-a-row-not-an-env-var]]; [[0164-sessions-follow-membership-and-several-houses-choose]]; [[0272-a-ranking-or-a-pairing-is-printed-only-when-the-data-can-tell-it-apart]] (merges first); ADR 0295 `owner-sales-read-net` and ADR 0302 `booth-and-event-checks-keep-their-own-row` (both on their own branches); the lane brief `p4-scratch/sim-run/fixes/briefs/tables.md` and plan `p4-scratch/sim-run/fixes/cont/tables-plan.json` (outside the repo)

## Context

The owner-quarter sim's analytics walk on Tuzlu Rüzgar (2026-10-03, read-only) found every POS check without a table, and the /reports room register telling the owner to draw a room no screen can draw. Cites are at `1aa4dcb8c` unless marked.

- **AW25 / A-051.** A check reached a table only at ingest: `table_id: this.resolveTable(check.tableRef, providerKey, tables)` (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:510`). `resolveTable` (`:1247`) matches the till's word against active `restaurant_tables` rows only (`loadTables`, `:1227`). The word itself survived only inside `raw` (`:526`); `pos_checks` had no column for it. Nothing in `apps/` writes `restaurant_tables.pos_refs`, and the only writer of a table row is `upsertTable` (`apps/api-gateway/src/analytics/table-analytics.service.ts:45`), which links no past check. So a house whose till names T1-T24 has no table rows, and every check stays unlinked. `getTablePerformance` then drops each such check without counting it (`if (!c.table_id) continue;`, `table-analytics.service.ts:226`). Tuzlu's feed carries T1-T24 plus BOOTH and EVENT in `raw.tableRef` across about 3,593 checks (the sim generator; not measured on production).
- **AW30 / A-055.** The register's empty state says *"No table is mapped for this restaurant yet, so no check can be attributed to a seat. The room has to be drawn before it can be read."* (`apps/web/src/pages/reports/next/rp-registers-house.tsx:360`). The export says the same words (`apps/api-gateway/src/reports/exports/report-export-cuttings.ts:587`). No web or mobile code calls `POST /analytics/tables/:restaurantId` (`analytics.controller.ts:563`) or `PUT /analytics/venue/:restaurantId` (`:591`).
- **Answers nobody gave.** `restaurant_tables.seats` is `integer DEFAULT 2 NOT NULL` and `is_outdoor` is `boolean DEFAULT false NOT NULL` (`supabase/migrations/20260805000000_baseline_from_production.sql:5169`); `upsertTable` writes `Number(table.seats) || 2` (`table-analytics.service.ts:50`). A table learned from a till word must not carry a seat count or an outdoor flag that nobody stated (ADR 0020, ADR 0051).

## Options considered

1. **Learn every till word as a table, in the database, and re-link from the stored word (chosen, the founder's pick).** Every writer of `pos_checks` gets it, history is re-linked by the same rule as new checks, and the owner's only job is naming. The cost is a production write on merge (see Consequences) and five new database objects.
2. **Draw the room** (wire the existing `POST /analytics/tables` and `PUT /analytics/venue` to a screen). Rejected by the ruling: *"No drawing."*
3. **Learn in the gateway only** (pos-hub creates the row on ingest). SimPOS and any other writer would bypass it, and a re-link on rename would need a gateway-side scan of every unlinked check.
4. **Resolve at read time and keep `table_id` empty.** The insight generator, the waiter adjustment and scenario-verify all read `table_id`, so each would need its own copy of the resolver, and a rename would silently rewrite history.
5. **Re-point existing links on rename.** A link is the till's record of the time; a re-link only fills NULLs.
6. **Give learned rows `seats` 2 by default.** *"A column default is an answer nobody gave"* (ADR 0020 / 0051): seats and is_outdoor become nullable and a learned row writes NULL to both; per-seat figures are then withheld.
7. **Delete a table instead of hiding it.** The next check with that word would learn it again.
8. **Re-link immediately from a learned insert.** It fires inside the `pos_checks` statement, and one `INSERT … ON CONFLICT DO UPDATE` batch then fails with *"ON CONFLICT DO UPDATE command cannot affect row a second time"* — the whole import aborts. The SQL test's T11 pins it. A learned insert re-links at commit instead (a deferred constraint trigger).
9. *(Doing nothing: the room stays empty for every house whose till names tables, and its instruction points at a tool that does not exist.)*

## Decision

A table is whatever the till names. The method, proposed for review:

- **The till's word is kept.** `pos_checks.table_ref` holds it as sent (trimmed; a number as its text; blank is NULL). pos-hub writes it through `tableRefOf` (`pos-hub.service.ts:155`, row literal `:529`). The migration's `pos_table_ref_from_raw` reads it back out of `raw` for history, as the adapters read it (Square `ticket_name`; Toast `table.guid`, then `table.name`; otherwise `tableRef`, `table_ref`, `table`).
- **Clover gives no table word.** Its `tableRef` is the order type, and the founder's AW24 pick *"Own row, POS field (Recommended)"* made the order type a channel, not a table (ADR 0302). Until a Clover/Toast/Square house connects, order types are not mapped (booth fork, verbatim *"Wait, then owner maps (Recommended)"*). On a csv feed with no order type, BOOTH and EVENT are learned as tables of their own; the owner can hide them.
- **A BEFORE trigger on `pos_checks`** resolves a word with `resolveTable`'s precedence (the source's `pos_refs` entry, then the label, then `table <label>`), case- and space-insensitive, over active tables with hidden ones included. When nothing answers and no retired table answers either, it learns the table: `seats` NULL, `is_outdoor` NULL, `pos_refs {source: word}`, `learned_at now()`. Learning runs in its own exception block; a failure is a WARNING and the check is stored without a table. A sale is never refused for this. A re-sent check whose word has not changed keeps its link when nothing answers now.
- **A rename keeps the till's words.** The most recent word per source already linked to the row is merged into its `pos_refs` (existing keys win), so "Window 7" keeps catching T7.
- **Re-link fills NULLs only.** Adding a table by hand, or changing a table's label, `pos_refs` or `is_active`, fills `table_id` on the house's unlinked checks whose word now resolves to it. A learned insert does the same at commit. No link is ever moved.
- **Backfill** sets `table_ref` on every stored check whose `raw` carries a word; that runs the trigger row by row, so history learns and links in one statement.
- **Rename and hide** through `PATCH /analytics/tables/:restaurantId/:tableId` (`analytics.controller.ts:620`), `@Roles('owner','manager')` per fork F1, verbatim *"Owner or manager (Recommended)"*. RolesGuard is exact (ADR 0164), and the class JwtAuthGuard pins the house. The body is validated before the id (label 1-60 characters, hidden boolean, an empty body is 400). A non-uuid or foreign id is 404, and so is a retired table. A name another table of the house already has (case-insensitive, retired ones included) is 409. Settings → Point of sale lists the tables behind a closed disclosure, reads them only when opened, and keeps loading, failed (ADR 0067) and empty apart. Only an owner or manager sees Rename and Hide.
- **Hidden means out of every table figure** (fork F2, verbatim *"Out of every figure (Recommended)"*; option text *"Hidden means out of every table figure and ranking, insights included."*). A hidden table still catches its checks; they stay in takings. The room (`getTablePerformance`), its export and the hot list leave hidden tables out and say how many checks they left out: `checksWithoutTable`, `checksAtHiddenTables`, `hiddenTables`, `openChecksAtHiddenTables`. Checks at a retired table count with the hidden ones. The insight generator's part is **owed** to the follow-up branch `fix/hidden-tables-leave-insights` (2 files plus its spec, after #602).
- **Nothing is drawn.** The register and the export say *"The till has not named a table yet, so no check can be attributed to a seat. Tables appear here as checks arrive with one on them; rename or hide them under Settings → Point of sale."* A window whose checks had no table says how many. When checks sat only at hidden tables, the "absent attribution" clause is dropped, because the attribution is not absent.
- **Correlations and drivers read only what was recorded.** A NULL seat count or outdoor flag is not a 0 (`recorded()`). A driver feature is kept only with at least five recorded values that vary; with none, drivers are null. `geometryRecorded` counts shown tables with any recorded distance.

## Relations

Merge order (the plan's): sig (#602, ADR 0272) → cap → postime → netsales (ADR 0295) → booth (ADR 0302) → tables. Sig must go first: learning about 26 uniform-random tables before its `MIN_RANK_N` gate would light an ungated "Table #1" insight. Netsales rewrites the aggregation loop next to this lane's counts, and booth adds `pos_checks.channel` and sets Clover's `tableRef` to null in the adapter. If booth lands first, the Clover clause in `tableRefOf` is redundant but harmless. Conflicts are textual; resolve by later-truth. Every lane adds one line to `scripts/sql_outside_migrations.txt` and one README row; keep both sides.

## Consequences

- **A production write on merge** (migrations auto-apply). For every house whose stored `raw` carries a table word, the backfill writes `table_ref` on those checks, learns their tables and links them. For Tuzlu that is expected to be about 26 tables over about 3,593 checks. **Not measured on production**: this lane reads no production data. Locally, 20,000 synthetic checks over 4 houses backfilled in 941 ms, linking 18,462 and learning 28 tables. The coordinator's read-only dry run (it inlines the reader, because the function does not exist before merge):

  ```sql
  WITH w AS (
    SELECT c.restaurant_id, c.table_id,
           CASE
             WHEN c.raw IS NULL OR jsonb_typeof(c.raw) <> 'object' OR c.source = 'clover' THEN NULL
             WHEN c.source = 'square' THEN NULLIF(c.raw -> 'ticket_name', 'null'::jsonb)
             WHEN c.source = 'toast' THEN coalesce(NULLIF(c.raw -> 'table' -> 'guid', 'null'::jsonb),
                                                   NULLIF(c.raw -> 'table' -> 'name', 'null'::jsonb))
             ELSE coalesce(NULLIF(c.raw -> 'tableRef', 'null'::jsonb),
                           NULLIF(c.raw -> 'table_ref', 'null'::jsonb),
                           NULLIF(c.raw -> 'table', 'null'::jsonb))
           END AS v
      FROM public.pos_checks c
  ), r AS (
    SELECT restaurant_id, table_id,
           CASE WHEN jsonb_typeof(v) = 'string' THEN NULLIF(btrim(v #>> '{}'), '')
                WHEN jsonb_typeof(v) = 'number' THEN v #>> '{}' END AS ref
      FROM w
  )
  SELECT restaurant_id,
         count(*)                                                   AS checks_given_a_word,
         count(*) FILTER (WHERE table_id IS NULL)                   AS unlinked_checks_with_a_word,
         count(DISTINCT lower(ref)) FILTER (WHERE table_id IS NULL) AS distinct_unlinked_words
    FROM r WHERE ref IS NOT NULL
   GROUP BY restaurant_id ORDER BY 2 DESC;
  ```

  Checked locally: on 10 raw shapes (each source, JSON null, blank, number, object, array) it agrees with `pos_table_ref_from_raw` on every row. `distinct_unlinked_words` is an upper bound on tables learned, since a word an existing table answers to learns nothing.
- **Security.** Every new function is SECURITY INVOKER. The only `pos_checks` writer today is the gateway's service role, which bypasses RLS. A writer under RLS with no `restaurant_tables` INSERT policy would store its checks unlinked (the WARNING path), never refused.
- **A retired table blocks learning by design.** Its word stays unlinked until the table is re-activated, which re-links.
- **Residuals, not built here (stated, not hidden):**
  1. The insight generator still ranks hidden tables (`fix/hidden-tables-leave-insights`, owed).
  2. Toast tables are learned under their GUID as the label until renamed. SimPOS sends its table UUID as `tableRef` (`simpos.service.ts:676`), so a SimPOS house learns UUID-labelled tables.
  3. A rename or hide writes no audit row.
  4. `POST /analytics/tables` still writes `seats` 2 when none is given.
  5. Two till words cannot be merged into one table.
  6. A rename keeps only the most recent word per source.
  7. The waiter adjustment's table control still uses hidden tables. A control is not a table figure, but it is named here for the founder.
  8. The gateway's in-memory `resolveTable` neither trims nor orders ties as the trigger does. The trigger decides whenever pos-hub leaves `table_id` NULL; when pos-hub resolves first, its answer stands.
  9. A Toast number and its text form ("14" vs "14.0") are different words.
  10. The `.planning/06-pages` docs for /reports and /settings are not updated, and this ADR has no row yet in `decisions/README.md` (both for the 15-file cap; the row's text is ready for the merge).
  11. The web change was tested in vitest, not in the Browser pane.
- **Revisit when** a Clover, Toast or Square house connects (the order-type mapping), or when an owner asks to merge two till words into one table.

## Evidence

- SQL: `supabase/tests/<ver>_tables_learned_from_the_pos_test.sql`, T1-T16, through `pgtest.sh lane` (output in `p4-scratch/sim-run/fixes/audits/tables-local-pg.txt`). On a scratch build, five mutations each failed it: no learning INSERT (T2), no `learned_at` condition on the immediate re-link (T11, the ON CONFLICT error), no deferred trigger (T16), no `pos_refs` merge on rename (T8), no keep-the-old-link on re-send (T15).
- Gateway: `apps/api-gateway/src/analytics/tables-learned-from-the-pos.spec.ts`, 26 cases; 25 fail against the `1aa4dcb8c` sources (the one that passes pins the kept per-seat null).
- Web: `apps/web/src/pages/settings/next/tables-learned-from-the-pos.test.tsx`, 12 cases; all 12 fail against the `1aa4dcb8c` sources.
- Claims: five rows in `claims.d/feat-tables-learned-from-the-pos.jsonl`; each holds on the lane, fails on `1aa4dcb8c`, and fails under its own mutation.
- `CLAIMS.jsonl` row `ADR-0164-ROLES-EXACT-MANAGERS-KEPT` is amended in place: it pins the route-access fixture's size, which this PATCH takes from 199 to 200 rows (a key-by-key diff against `1aa4dcb8c`: one added, none removed, none changed).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | Aldemir | Ruled AW25+AW30: *"Learn from the POS (Recommended)"*; F1 *"Owner or manager (Recommended)"*; F2 *"Out of every figure (Recommended)"* |
| 2026-10-04 | Claude (lane tables) | Built the method above on `feat/tables-learned-from-the-pos`. Deviations from the plan, each recorded above: `is_outdoor` nullable too; learned inserts re-link at commit (the plan left earlier checks unlinked); a re-send keeps its link; re-link requires `is_active`; the Settings list reads only when opened; the 409 clash includes retired tables |
