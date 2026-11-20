# BUILD B - taste schema, gateway, fusion

PR: https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/1920 (DRAFT, base main), branch feat/taste-profile-schema-gateway, head a7830c721.
Migration: supabase/migrations/20271203100000_every_good_and_dish_has_a_taste_profile.sql (open-PR high-water was 20271202100000).

## Tests
- `npx jest src/taste` (apps/api-gateway): 4 suites, 38 tests pass (axes, fusion, service, controller).
- `npx tsc --noEmit -p tsconfig.json`: clean except the ignored TS2307 for @simplewebauthn/server.
- pgtest.sh lane (main_tpl at c459b0a12 + this migration): [fix] PASS, [ctl] FAIL (relation absent). SQL test: supabase/tests/20271203100000_..._test.sql (T1-T6).
- Guards OK: check_new_tables_are_locked_down, check_migration_versions_unique, check_migration_order, check_migration_probe_safety. check_migration_ledger and check_definer_functions_closed need a DB URL: not run.

## Mutants (all after commit, each failed a test, then restored)
M1 v=11 allowed (2 fail); M2 missing axis -> 0 (2); M3 stated_by from body (1); M4 foreign-subject check removed (1); M5 plain mean (4); M7 stated_by_name from body (1); M8 conflict sd narrowed (1); SQL view keyed on source only (T4 fail); SQL v up to 11 (T2 fail).

## Decisions beyond the brief
Descriptor chips (12) and texture chips (10) are a closed gateway list equal to lane C's current taste-words.ts list (read-only peek); a dish is checked against `dishes` and a missing table answers subject_not_in_house; blank session name stored null; GET on a supply is refused like POST; profile confidence = mean axis confidence (0 with no axes); lo/hi = v +/- 1.28 sd clipped 0..10; ai_draft conf is capped by its sd 2.5 (0.17), not its 0.35 prior.

## Checks owed (walker, local stack, throwaway merge of B and C)
GET returns effective null on a fresh good; POST house as two accounts gives two layers and a footer of 2 sources; supply 400; foreign id 404 with code; 25-key list equal on both sides; chip lists equal on both sides.

## Not done
No browser check (none owed here). No roll-up (lane D). check_migrations_single_home result not read beyond timeout. Migration not applied to any real database.
