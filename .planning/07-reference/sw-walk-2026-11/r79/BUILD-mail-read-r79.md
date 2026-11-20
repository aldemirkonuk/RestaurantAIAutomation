# BUILD mail-read r79 (2026-11-19)

Decision (taken, recorded): build on a MEET branch, not a PR. `resolve/r79-mail-meet` = origin/fix/r78-mail-web-scope-layout (#1929 tip 95bff1d28) + plain merge of origin/feat/mail-reads-every-conversation-gw (#1917 head 0de8fce42). It carries no new code and gets NO PR (precedent: resolve/r37-*, r37/merge-readiness/MERGE-ORDER.md).
Meet head 3687451ab (merge dc2b29534 + sorted-list fixup).

Real conflicts in the merge: ONE, scripts/sql_outside_migrations.txt (both sides appended test paths; kept both). My first resolution left it unsorted, which fails scripts/check_migrations_single_home.py; fixed on the meet by regenerating (--update). Every other file auto-merged (rabbitmq-bridge.service.ts, gmail-mime.ts, house-inbox.service.ts, retention, conversations.service.ts, integrations constants; #1917's migration 20271202100000 sits after the chain's last).

Brief assumed ONE PR <= 30K. Code says the read side cannot fit: migration 11.6K + service 8.7K + SQL test 7K + jest 9K + the rest is ~58K at full coverage; compacted it is ~52K. SPLIT into two stacked DRAFT PRs (each under 30K), deviation from "ONE PR":
- #1943 fix/r79-mail-read-every-kind, base resolve/r79-mail-meet, SQL (head e530156fe), 22.3K.
- #1944 fix/r79-mail-read-gateway, base fix/r79-mail-read-every-kind, gateway+web (head 6fbf3cfb3), 29.7K.
Merge order: #1917 slices, then the #1916 chain (#1929 included) to main; then #1943 retargeted to main; then #1944 retargeted.

What was built (finding w3-1):
- list_mail_people (same signature) now lists team/guest people (key team:/guest:+address, no provider, name = address, never waiting); old body kept as list_mail_vendors. mail_other_rows is the one read of non-vendor rows (withheld = nothing). list_mail_threads_other, mail_thread_letters_other. mail_letter_rows kept to vendor rows (old body mail_letter_rows_of_every_kind) so a NULL-provider row is never a NULL "person" or counted as owed. Migration 20271204100000 (max on main 20270302100000; max over open PRs 20271203100000).
- Gateway: kind per person, providerId null for non-vendor, storedKinds from the table (2 limit-1 reads, owner/manager only), team:/guest: keys on /mail/threads and /mail/thread, letters carry kind/fromAddress/toAddresses (one by-id read, failure = 503). Staff or role-less: vendors only, non-vendor key = nobody, no read.
- Web: client already read kind/from/to (MailTab.all-conversations.test.tsx). Fixed the thread header that said "vendor" for everyone; person with no provider gets no vendor reply (test).

Proof: SQL test TEST PASSED in PGlite build of 306 migrations (harness r79/pg/run.sh, mutate.py); old vendor test passes; 12 SQL mutants killed. Gateway tsc clean (TS2307 simplewebauthn filtered), jest 666 suites / 12248 passed / 14 skipped; web communications vitest 31 files / 580 passed; 18 service mutants killed (one survivor found and fixed by a test).

Not done / limits:
- Header counts (/mail/summary in/out today, door last-stored) stay vendor letters; team/guest mail is not in them. Door status for a read-all mailbox therefore ignores non-vendor letters.
- A team/guest letter is never "automatic" (a bounce filed as a guest shows as a letter) and is not de-duplicated by Message-ID in the read (the bridge dedupes on write).
- /mail/thread with a team/guest thread key and NO `with` is an empty page (vendor-only resolution); the web always sends `with`.
- No reply/no-reply-mark for team/guest letters (the mark function is vendor model).
- Web types: MailPersonRow.providerId/MailPersonRef.providerId now string|null; other web code unchanged.
- decision claims: scripts/check_decision_claims.sh has 10 failing claims (COMMS-MAIL-*, MAIL-HOUSE-FROM-TOKEN-ONLY, MAIL-READ-FUNCTIONS-SERVICE-ROLE-ONLY, MAIL-THREAD-PAGE-50-NO-HEADERS, ADR-0149/0083/0171/0167 ...) identical at the meet before my PRs; not checked at #1929 alone, so some may come from the merge.
- Not run: real Supabase, production, browser (brief forbids local stack).
- #1944 diff is 29,673 chars: 327 under the cap.
