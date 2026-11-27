## The Mail read model's calls under the 2026-11-07 /goal — DECIDED — 2026-11-07

Filed by `feat/mail-people-and-threads-read`, the top of a four-PR stack: `feat/mail-read-sql` (migration `the_mail_list_is_read_by_person`), `feat/mail-read-rules`, `feat/mail-read-service`, then this branch (`GET /mail/people`, `/mail/threads`, `/mail/thread`, `/mail/summary`). The founder's /goal of 2026-11-07 says not to ask, so each fork below is **the session's call under the 2026-11-07 /goal**, not a founder answer. Any of them can be overturned by an ADR.

- **No `@Roles` on `/mail/*`.** Every signed-in member of the house reads its vendor mail (draft ADR 0357 answer 3, PR #747, staff read-only). The role is enforced in `withholdsHouseLetters` (`apps/api-gateway/src/conversations/mail.read-rules.ts`): owner and manager see HOUSE_DRAFT / HOUSE_CANCELLED letters, and every other role, including a token with none, does not. Keeping the role out of a decorator also keeps these routes out of `route-access.expected.json`, which open PRs own. Claim `MAIL-ROUTES-SIGNED-IN-ROLE-IN-SERVICE`.
- **SEND_UNCONFIRMED counts as sent.** The letter may well have left the house, so it is shown and it ends the house's wait. Hiding it would leave the person waiting on a reply the house probably sent.
- **An inbound row with status DELIVERED owes no reply.** That status marks a stored invoice or delivery record, not a question, so it never makes a person "waiting".
- **A letter's time** is `received_at` for inbound mail and `sent_at` for outbound, falling back to `created_at`. A thread page is ordered and keyset-paged by `(at, id)` — the letter's own time — in `mail_thread_letters` (amended on fix/mail-thread-with-person, QA round 18 on #895: the stored order put a mailbox backfill's old letter on top). The cursor stays stable because `id` breaks every tie.
- **A thread is the pair (person, key), and `GET /mail/thread` takes `with=vendor:<uuid>`.** The migration groups threads by `(provider_id, thread_key)`, and a `gm:` key (one Gmail thread from the house mailbox to several vendors, or with vendors on CC) or a `mid:` key (a group mail's References root) names no vendor, so one key can be two thread rows. With `with`, every read of the thread page (letters, head, order) is also scoped to that vendor, so the page holds only that row's letters and names that row's vendor. `with` is optional, so the contract only grows; a `with` that names no stored person is an empty page, the same as `/mail/threads` (F11). Found by the PR #879 audit.
- **No index was added.** EXPLAIN on the 2,000-row proof house found that one vendor's rows read through the existing `idx_procurement_conversations_provider_created` in 0.10–0.12 ms. A trial `(restaurant_id, provider_id)` index was slower, at 0.26 ms. `list_mail_people` takes 14.5 ms and `list_mail_threads` 2.5 ms on that house.

## GET /mail/thread without `with` still merges every vendor under one key — RESOLVED — 2026-11-07

**What is true.** Called with `key` alone, `MailService.getThread` (`apps/api-gateway/src/conversations/mail.service.ts`) reads every vendor's letters under that key and names the vendor of the oldest letter. For a `gm:` or `mid:` key shared by two vendors, that is both vendors' letters under one vendor's name, and a `messageCount` that disagrees with the `/mail/threads` row. Kept on purpose so the parameter stays additive. **What closes it.** The web lane `feat/comms-mail-tab` passes the person key it already holds as `with` on every thread open; then `with` can be made required.

**Resolved by fix/mail-thread-with-person (#895).** A thread is now `(provider_id, thread_key)` everywhere: `mail_thread_letters` reads one vendor only, and with the key alone it gives the page to the vendor of the thread's first letter (by letter time, after withholding), so an old link opens one person's letters and never two. `with` stays optional (a 400 for a missing `with` was rejected: it breaks links already shared). Proven by `supabase/tests/20270421143700_the_mail_list_is_read_by_person_test.sql` T1, T3, T4, T8 and the `getThread` specs.

## Only vendor mail is stored, so the Mail list can show only vendors — OPEN — 2026-11-07

**What is true.** `procurement_conversations` holds letters to and from providers only. Team, guest and stranger mail has no store, so `GET /mail/people` answers `storedKinds: ["vendor"]`. The UI must not imply that an empty list covers those other kinds of person. **What closes it.** A store for those letters (sw-walk mail proposal, intake L2 and later), after which the person kinds widen.

## The Mudavym shared mailbox and the house's Mudavym address are one door — OPEN — 2026-11-07

**What is true.** `mailDoorOf` (`mail.read-rules.ts`) can tell three things from the stored columns: a letter sent by the house, one mirrored from a person's own mailbox (`mirrored_by_grant_id`), and one that came by WhatsApp. Every other inbound letter is reported as `mudavym_mail`, because no stored column says whether it reached the shared mailbox or the house's own Mudavym address. **What closes it.** An intake record that names the address a letter arrived at (proposal L2). The door split then follows it.

## "Held at the door" cannot be told yet — OPEN — 2026-11-07

**What is true.** `GET /mail/summary` always answers `heldAtDoor: null`, never 0. Nothing records a letter that was received but not yet stored, so the count is unknown rather than zero (ADR 0020). **What closes it.** The durable intake store (proposal L2).

## The SQL proof of the Mail read functions is not committed — RESOLVED — 2026-11-07

**What is true.** The proof ran in a scratch transaction against a Postgres built from every migration. It covered paging with ties, waiting, withholding, house scope, the house-local day, counts on 2,000 rows, doors, a missing house and grants, and its output is in PR body #1 of the stack. It is not committed under `supabase/tests`, because a new file there needs a line in `scripts/sql_outside_migrations.txt`, which open PRs #674 and #687 own. **What closes it.** Once either merges, commit the proof as a `supabase/tests` file and strike claim `MAIL-SQL-PROOF-NOT-YET-COMMITTED` (open), which fails the build as soon as that file lands.

**Resolved by fix/mail-thread-with-person (#895).** The thread proof is committed as `supabase/tests/20270421143700_the_mail_list_is_read_by_person_test.sql` and listed in `scripts/sql_outside_migrations.txt` (appended at the end; #674 and #687 append too, so whichever merges second resolves a one-line conflict). The claim is struck (resolved). The 2,000-row counts and house-day checks of the first scratch proof are still only in PR body #1.

## GET /conversations/stats/overview counts in JS over a read PostgREST caps — OPEN — 2026-11-07

**What is true.** `ConversationsService.getStats` (`apps/api-gateway/src/conversations/conversations.service.ts`) selects every one of a house's rows and counts them in a loop. A read capped by PostgREST's max-rows stops the counts there without saying so, and the read does not withhold HOUSE_DRAFT letters from staff. This lane was told to keep `GET /conversations/*` unchanged, so the Mail tab's figures come from `mail_inbox_summary`, which counts in SQL, and `getStats` is left as it is. **What closes it.** `getStats` counts in SQL, or its last caller moves to `/mail/summary` and it is removed.
