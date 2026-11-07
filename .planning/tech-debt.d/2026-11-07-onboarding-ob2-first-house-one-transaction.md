## The first house opened in seven calls and cleaned up blind (audit G16) — ~~OPEN~~ CLOSED 2026-11-07 (fix/first-house-opens-in-one-transaction) — 2026-11-07

Onboarding proposal §3 Phase 1 lane OB-2 and §4 F14 ("one RPC that takes values TS computed"), closing audit gap G16 (`p4-scratch/sw-walk/onboarding/audit.md:258`). Every fork below was the session's call under the founder's /goal of 2026-11-07 ("Do not ask me any questions I approve you decide them all").

**What.** `AuthService.createFirstHouse` wrote organizations, restaurants and user_onboarding_progress, then organization_members, user_restaurant_access and the users row in parallel. On a failure its catch deleted restaurants and organizations without reading either delete's error. A failed access row plus a failed (or never-reached) delete left an organization nobody could reach. If the parallel users update had landed, the retry answered 409 "This account already has a house".

**Fix.** Migration `the_first_house_opens_in_one_transaction` adds `public.open_first_house(...)`. It does the same six writes in the same order, inside the one transaction a function call is. It is SECURITY INVOKER with `search_path` pinned. It is revoked from public, anon and authenticated, and granted to service_role. The gateway still computes and checks every value: the slug, the place id and its look-up, the coordinates, the zone, the currency, and the 409 rule. It makes one `.rpc("open_first_house")` call through `insertHouseRow`, so the F-006 shared-place retry still reads the database's own 23505. There is no compensating delete left. The `refuseHouseOpening`/`houseWriteError` wording is unchanged.

**Evidence.**
- `house-opening.spec.ts` t1 and t2 (`-t G16`) are red on origin/main. t1 leaves an orphan organization; t2 gets a 409. Both are green on the branch.
- `supabase/tests/<version>_the_first_house_opens_in_one_transaction_test.sql` T1-T6 pass in a PGlite full-corpus build. T1 fails without the migration.
- SQL mutations were each caught: swallowing the error, granting to anon, and making it a definer.
- CLAIMS row `OB2-FIRST-HOUSE-ONE-TRANSACTION`. `F006-SHARED-PLACE-OPENS-THE-HOUSE` and `F006-FIRST-HOUSE-CLAIMS-ONBOARDING-FIRST` are amended to read the RPC and the migration.

**Still open, stated.**
- **Sign-in tokens after the house commits.** If `generateTokens` fails after `open_first_house` has committed, the house stays open and the request answers 500. On main this path tried to delete it. A `/get-started` retry then answers 409 "This account already has a house". Signing in again lands in the house, because the membership and the access row exist. The fix is an idempotent re-mint for an account whose only house is this one, or a client that signs in again on that 409. The log line says `createFirstHouse (house <id> is open)`.
- **The SQL test's filename carries the migration version.** Migrations are numbered at merge, so it must be renamed together with the migration, along with its `scripts/sql_outside_migrations.txt` line.
- **SQL tests do not run in CI.** `supabase/tests/` is proved by hand in PGlite: it runs as superuser with the Supabase platform stubbed. The grants are checked by `has_function_privilege`, not by a PostgREST call as anon.
- **The jest stateful fake** (`makeHouseDb`) models the RPC's atomicity rather than proving it. The SQL test is the proof against a real planner.
- **The PGlite definer end-state check** reports one open definer from the stubbed `supabase_functions.http_request()`. It does so with and without this migration, so it is harness fidelity and not this change.
- This fragment is named after the lane (`onboarding-ob2-…`), as the lane brief set it. The README's convention is the branch slug (`fix-first-house-opens-in-one-transaction`). The guard checks only the `<date>-<slug>.md` shape.
