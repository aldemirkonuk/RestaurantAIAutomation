# 0265 — A Google place id is text, bounded in bytes below what its index can hold

- **Status:** Proposed 2026-10-02. The type change carries out the sim triage's "widen it to text". The 2048-byte CHECK, and the number, are the coordinator's pick in the build brief, **not a founder answer**; fork F1 waits on him.
- **Date:** 2026-10-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** google_place_id, Place ID, restaurants, varchar(100), text, octet_length, char_length, CHECK, restaurants_google_place_id_length, btree 2704 bytes, 54000, 23514, 23505, idx_restaurants_google_place_id, F-006, /get-started, /register
- **Links:** migration `a_google_place_id_is_as_long_as_google_makes_it` and its `supabase/tests` file of the same slug (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); `claims.d/fix-onboarding-place-id-f006.jsonl:1`; [[0240-register-entries-are-fragments]] (F3: a fork recorded in its ADR rather than as a new register row); the sim share-out `p4-scratch/sim-findings-share-out-2026-10-02.md` (outside the repo), F-006 at :526

## Context

The owner-quarter sim (2026-10-02, F-006, a BLOCKER) could not create a house on /get-started. The owner picked a street address from the Places autocomplete, and the insert failed with "value too long for type character varying(100)". The XHR capture measured that `googlePlaceId` at 128 characters. That is **one** measured id: it shows a street-address Place ID can be longer than 100 characters, not that every one is. Google documents no maximum length.

`restaurants.google_place_id` was created `varchar(100)` by `supabase/migrations/20260807001252_distributor_geo_foundation.sql:52` and never widened. Its only dependent is the partial unique index `idx_restaurants_google_place_id` (same file, :65-66), measured with `pg_depend` on a PGlite build of every migration. A btree entry over 2704 bytes is refused with 54000. As of this record the only writers are the two gateway sign-up inserts (`apps/api-gateway/src/auth/auth.service.ts:1703`, `:1846`), both fed by `coordinateColumns` (`:1517-1543`).

## Options considered

1. **Leave `varchar(100)`.** F-006 stays a BLOCKER for any owner whose pick has a longer id. Rejected.
2. **A wider `varchar` (255, 512).** Still a guess against an id Google gives no maximum, and the next longer id fails the same way, as 22001. Rejected.
3. **`text` with no bound.** The simplest change, and what the triage line literally says. At about 2.7 KB a value fails 54000 inside the index, a raw error that names no constraint. No real Place ID is near that, but a client can send one. Rejected narrowly; this is the main alternative, and F1 puts it to the founder.
4. **`text` with a `char_length` bound.** A character bound does not hold a byte limit: 683 three-byte characters are 2049 bytes, and about 902 of them pass 2704. Rejected.
5. **`text`, with the unique index moved onto a hash** (`md5(google_place_id)`). Removes the size limit from the index altogether. It changes the index that the recorded shared-place ruling keys on (23505 on `idx_restaurants_google_place_id`), and it pulls the open one-house-per-place question into a migration that should not touch it. Rejected for now.
6. **`text` plus `CHECK (google_place_id IS NULL OR octet_length(google_place_id) <= 2048)` (chosen).** 2048 bytes is 16 times the one measured id. It sits below 2704 with room for the index tuple's header, so every value the CHECK admits fits the index. A value past it is refused as 23514 under a constraint name the gateway can put into plain words.

## Decision

`restaurants.google_place_id` becomes `text`, bounded by the named CHECK `restaurants_google_place_id_length` at 2048 bytes (`octet_length`, not `char_length`). What carried it: Google sets no maximum, so a width is a guess. The index sets a hard byte limit, so a bound in bytes keeps the refusal named instead of raw.

## Consequences

- **Easier.** Any id up to 2048 bytes is stored whole. A refusal past it is a named 23514, not a 22001 or a 54000.
- **Given up.** An id over 2048 bytes would be refused, although Google documents no maximum. Until the wording change maps it, the owner would see the raw message. **Revisit when** a 23514 on `restaurants_google_place_id_length` appears in production logs, or Google publishes a length.
- **23505 reaches more owners. Sequence this before merging.** The database refuses duplicates exactly as before. But an id over 100 characters used to die at 22001 before the index saw it, so two houses picking the same such address (a food hall, a hotel with several outlets) could not collide. After this migration the second one gets 23505. As of this record both sign-up paths pass the raw database message to the browser: `auth.service.ts:1758-1762` ("House creation failed: …", read by `GetStarted.tsx:169`) and `:1959` ("Registration failed: …", read through `AuthContext.tsx:767-769` by `Register.tsx:1107`). The second path is the **public** register route. The founder's ruling for a shared place, 2026-10-02, verbatim: *"Open it, keep the pin (Recommended)"*. It is recorded as: open the house with latitude and longitude and no place id, and say nothing about another house. That is the separate wording change. So either land that change in the same merge window, or have the founder accept the window explicitly.
- **Lock.** The ALTER takes ACCESS EXCLUSIVE on `restaurants`, which nearly every request reads. With no `lock_timeout` (no migration after the baseline sets one), a long or idle-in-transaction session holding a lock on `restaurants` queues every later `restaurants` query behind the ALTER for up to the migration's 120 s `statement_timeout`. The migration then fails and has to be re-run. Before merging, check `pg_stat_activity` for such sessions. Adding a first `lock_timeout` is a repo precedent this record does not set.
- **Renumber at merge (ADR 0235).** The version is embedded in three places: the migration file name, the `supabase/tests` file name, and its line in `scripts/sql_outside_migrations.txt`. Rename all three together. Then re-run `check_migrations_single_home.py`, `check_migration_order.py` and `check_migration_versions_unique.py`.
- **Forward-only.** Reverting the PR must never delete the migration file. Production keeps the change, and the ledger guards go red on a missing file. A real rollback is a new migration.

## Forks

- **F1 — Does the founder accept a bound at all, and at 2048 bytes? OPEN.** The alternative is option 3, plain `text` with no CHECK. Recommendation: keep the bound, for the reasons under Decision. It is recorded here and not as a new OPEN-DECISIONS row, following ADR 0240 F3: a new row shifts every citation below it.
- **Not this record: whether one house per place is a rule at all.** On 2026-10-02 it was recorded as open alongside the shared-place ruling, to be written into the F-006 wording change's ADR. This record describes the index as it stands and does not guard it. The claim row deliberately does not read it.

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-02 | — | Created (Proposed), after review of the migration-only commit found the bound had no record |
