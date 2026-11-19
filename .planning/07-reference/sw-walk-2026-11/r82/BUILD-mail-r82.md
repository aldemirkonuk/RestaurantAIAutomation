# BUILD mail-fix r82 (2026-11-19) — r81 w1 findings 1, 2, 3, 5

Stack: resolve/r79-mail-meet -> #1943 -> #1944 -> #1945 (fix/r81-mail-thread-sends-with 7449a119c) -> **#1948** (gateway, DRAFT, 23.6K, 29b19d30e) -> **#1949** (header, DRAFT, 19.9K, 6f2c9d2e8). #1945 itself would have gone to 53K with these, so two stacked DRAFTs. Nothing pushed to #1943-#1945.

## Finding 1 — ?thread= alone for team/guest: FIXED on #1948 (001dab972)
mail.service.getThread: vendor read first (unchanged); if empty, no `with`, and the caller may read non-vendor mail, take the house's first team/guest letter under the key (tenant-scoped table read) and re-read via mail_thread_letters_other. Staff/role-less never reach the lookup. No migration.
Tests: mail.every-kind.spec.ts (4 new: owner opens guest thread and names person; staff = one RPC and no lookup; vendor thread = no lookup; none/503). mail.controller.spec + a-letter-can-need-no-reply fakes widened (the "one read" test now expects rpc + lookup). Mutants killed: lookup disabled (2 fail), withhold guard dropped (1 fail).
Decision: person = first letter's person (same as the vendor read's "first letter" rule). Rejected: new SQL fn (migration for no gain); adding `with` at every web entry (does not fix deep links/notifications/search hits).

## Finding 2 — revoke: FIXED on #1948 (433237713, aefac7343, 3f769f6e1)
sweepForRevokedGrant takes `integrationId`; only `gmail_read_all` + an active `gmail_read` in the same house keeps vendor rows (no tombstone, no delete); every team/guest row is still deleted whole. `says` reports "N vendor replies were kept". Revoking `gmail_read` itself is unchanged. If the vendor-only standing cannot be read, vendor rows are swept as before (a revocation errs toward deleting). Consent `keptFor` for gmail_read_all rewritten to say exactly this; a test pins the words.
Tests: non-vendor-mail-is-deleted-whole.spec.ts (+3 sweep cases, +1 words), revoking-deletes... and tenant-faults specs updated for the new arg. Mutant killed: keepVendorRows forced false (1 fail).
Decision: "vendor-only reading consented" = any live gmail_read grant in the house. Rejected: also deferring when another person's gmail_read_all is live (rows are per-person grant, promise is per-person).

## Finding 3 — CLS: FIXED (code) on #1949 (cc73f1f74); browser re-measure OWED
MAIL_HEADER_RESERVE 'min-h-[152px] md:min-h-[100px]' on the header block (always, from first frame); READ_SCOPE_HOLD one 38/20, two 124/44 (two-block when the inbox door is already switched_off). Test file MailTab.reserved-heights.test.tsx pins the constants and where they land. Mutants killed: reserve removed (2), two-block ternary removed (1), value changed (1).
Limits stated: 152 is the walk's measurement; md 100 and the two-block 124/44 are ESTIMATES (no browser was allowed). Per-state skeletons are not possible (the final state is unknown at first paint), so one worst-case reserve is used; a healthy loaded block can be up to ~32 px shorter than reserved at 375 (blank space, not a shift). The two-block hold also over-reserves for a vendors-only house with the switch off.

## Finding 5 — header counts: PARTLY FIXED on #1949
FIXED: in/out today now count every kind the caller may read (migration 20271205100000, mail_other_rows; staff vendors only). NOT CHANGED, on purpose: "Mail · N" = people waiting; no team/guest person is ever waiting (list_mail_people rule), so including them would make the label disagree with the waiting-only filter. Also unchanged: in_30d (Letters strip, replies to orders), door times. If the founder wants N to mean "people", that is a new decision.
SQL tests: supabase/tests/20271205100000_..._test.sql, run in PGlite (full corpus, 307 migrations): 9 PASS; same file without the migration fails at owner-in-today. Older 20270421 summary test: 121 PASS on the new corpus. Version 20271205100000 is past main and all open PRs (check_migration_versions_unique OK). PGlite is not Supabase.

## Suites
gateway: jest conversations+communications+integrations 76 suites 1512 pass; tsc clean (TS2307 @simplewebauthn only). web: vitest communications 33 files 588 pass; tsc clean.

## Browser checks owed
375 and desktop CLS on /communications?tab=mail (owner, grant live + switch off; vendor-only; staff); open ?thread=<guest key> alone; revoke gmail_read_all with and without gmail_read live.
