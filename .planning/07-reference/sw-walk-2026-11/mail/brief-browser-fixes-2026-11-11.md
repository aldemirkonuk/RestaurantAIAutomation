# Brief: mail browser-walk fixes (2026-11-11)

You are a Sonnet builder. Two DRAFT PRs, each stacked on an existing mail tip. Every
fork below is already decided ("the session's call under the 2026-11-07 /goal");
write the decision and the rejected alternative into each PR body. If something in
the code contradicts this brief, STOP and report rather than guess.

Standing rules: never edit/stage/commit in /Users/aldemirkonuk/Projects/restaurant-ai-automation
(only `git fetch` / `git worktree add` there). New worktrees under
~/Projects/p4-scratch/sw-walk/wt/. Symlink node_modules exactly like
~/Projects/p4-scratch/local-stack.sh does (from ~/Projects/p4-scratch/sw-walk/wt/new-device-code:
`./node_modules`, `apps/web/node_modules`, `apps/api-gateway/node_modules`,
`packages/ui/node_modules`). Explicit `git add <path>` only. Heavy commands (tsc,
jest, vitest) ONLY through `~/Projects/p4-scratch/sim-run/heavy.sh <cmd...>`
(exit 75 = busy, retry after a wait). DRAFT PRs only; never merge / mark ready /
force-push / close. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
PR body written to a file inside the worktree, ending with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`. ≤15 files and
≤30K diff per PR. Do not touch any other PR branch.

Evidence came from a local-stack browser walk (synthetic house, no production).

---

## PR M-A — base `fix/mail-order-letters-leave-as-the-house` (#1050), head `fix/mail-walk-words-and-arrival`

Worktree: `git -C <main> worktree add -b fix/mail-walk-words-and-arrival ~/Projects/p4-scratch/sw-walk/wt/mail-walk-fix-a origin/fix/mail-order-letters-leave-as-the-house`

### 1. The shared mailbox is named, never blank
`apps/api-gateway/src/communications/letters/house-sender.service.ts` `deploymentMailbox()` (~line 207)
uses `this.config.get("GMAIL_SENDER_EMAIL") ?? "notifications@mudavym.com"`. With the
variable set but empty, it returns `""`, and `conversation()` (~line 620) prints
"replies still arrive through , the mailbox every restaurant on this deployment shares"
(seen on the Mail tab's "How mail reaches the house" sheet and on the mail setup
page). `gmail.service.ts:171-173` — the service that actually sends — uses `||`, so it
sends from notifications@mudavym.com while the page names nobody.
Fix: `(this.config.get<string>("GMAIL_SENDER_EMAIL") ?? "").trim() || "notifications@mudavym.com"`,
with a one-line comment that it must agree with gmail.service.ts.
Rejected: injecting GmailService to read `getSenderEmail()` (bigger change, new DI
edge in a service the specs build by hand).
Spec: add a case to `communications/letters/the-conversation-has-four-states.spec.ts`
(read how it builds config) — GMAIL_SENDER_EMAIL = "" → `conversation.words` contains
`notifications@mudavym.com` and does not contain `through ,`.

### 2. A thread of only automatic mail says so
`apps/web/src/pages/communications/next/mail-format.ts:579-584` `lastWriterWords(direction, name)`
returns "Who wrote last was not recorded" when `direction` is null. The SQL
(`mail_thread_states`) makes `message_count` count every non-automatic row and
`last_direction` come from visible rows only, so:
- `messageCount === 0` ⇒ the thread holds only automatic mail (bounce / auto-reply).
  The row read "0 letters · Who wrote last was not recorded".
- `messageCount > 0 && direction === null` ⇒ only letters the house has not sent
  (drafts, refused sends).
Change the signature to `lastWriterWords(direction, name, messageCount: number)`:
- count 0 → `Only automatic mail — a bounce or an auto-reply, nothing to answer`
- direction null, count > 0 → `Nothing on it has been sent or received yet`
- inbound / outbound unchanged.
In `MailTab.tsx` (~line 197-199) pass `t.messageCount`, and when `t.messageCount === 0`
render only the words (drop the "0 letters ·" prefix). Update every caller/test
(`grep -rn lastWriterWords apps/web/src`). Add tests to `mail-format.test.ts`.

### 3. "How mail reaches the house" reads the intake record when it exists
`IntakeHealthSheet.tsx` (~lines 160-181) hard-codes "Letters held before reaching the
house: — not recorded yet" and, for "Mudavym's mailbox and your Mudavym address",
`unrecordedDoorStatus()` + lastRead "— not recorded yet". PR #1049 (another stack,
not under this base) adds `GET /communications/letters/intake` (owner, manager) returning
```
{ intake: { byStatus: Record<string,number>, waiting: number, oldestWaitingAt: string|null, unknown: boolean } | null,
  sharedMailbox: { lastReadAt: string|null, lastStoredAt: string|null, errored: boolean } | { unknown: true } | null }
```
and `POST /communications/letters/intake/read-again` → `{ queued: number }`.
`waiting` = letters recorded at a door with no home yet (received, failed, gave_up);
`byStatus.gave_up` = stopped after six tries.

Build (web only, this base does not have the endpoint, so it must degrade):
- `useMailData.ts`: `useMailIntake(enabled: boolean)` — react-query GET
  `/communications/letters/intake`, `enabled` only while the sheet is open, `retry: false`.
  Classify the result into `{ kind: 'absent' }` for HTTP 404 or 403 (endpoint not
  deployed yet / staff), `{ kind: 'failed' }` for any other error, `{ kind: 'known', data }`.
  `useIntakeReadAgain()` — mutation POST `.../intake/read-again`, invalidates the intake query.
- `mail-format.ts`: two pure formatters with tests:
  - `heldAtDoorWords(intake, now)`:
    absent/loading → keep today's `— not recorded yet.`;
    failed or `intake.unknown` → `could not be read — that is not the same as none.`;
    `waiting === 0` → `none.`;
    else `${waiting} waiting for a home, the oldest for ${shortSpan(now - oldest)}` and,
    when `byStatus.gave_up > 0`, `; ${n} stopped after six tries and wait for “Read again”.`
    (reuse the existing `shortSpan` helper in mail-format.ts).
  - `sharedMailboxDoor(shared, now): { status: DoorStatus; lastRead: string }`:
    null / absent → today's `unrecordedDoorStatus()` and `— not recorded yet`;
    `{unknown:true}` or request failed → state `cannot_tell`, words
    `Cannot tell: the mailbox's record could not be read.`, lastRead `—`;
    `errored: true` → state `failing`, tone `alarm`, words
    `Mudavym's mailbox: its last read failed. Letters wait at the door and are read again.`;
    else state `reading`, tone `ink`, words `Mudavym's mailbox is read every few minutes.`,
    lastRead `${shortSpan(now - lastReadAt)} ago` (or `—` when lastReadAt null).
    Keep the row name; the Mudavym address has no read of its own (it is pushed to us),
    so say nothing about it beyond the shared mailbox. Match `DoorStatus`'s existing
    `state` union — if `reading`/`needs_attention` are not in it, use the closest
    existing members and say which in the PR body.
- `IntakeHealthSheet.tsx`: take `intake` as a prop (from MailTab.tsx, which already owns
  `open`), render the two formatters, and when `kind === 'known' && waiting > 0` show a
  quiet button `Read again` (disabled while pending) that runs the mutation and then
  says `Offered again: ${queued}.` or the existing write-failure sentence pattern
  (`writeFailureSentence` / `readFailure` used in WhoIsWriting.tsx). Update the file's
  header comment (the "not recorded yet" honesty rules now apply only when the record
  is absent). Leave the WhatsApp row as it is.
- Tests: extend the sheet's existing tests (find them with `grep -rln IntakeHealthSheet apps/web/src`)
  for absent, known-0, known-with-gave-up + Read again, failed.
Rejected: (a) filling `heldAtDoor` in the gateway's `/mail/summary` — MailService is in
this stack and MailIntakeService in #1049's, so it cannot be built on either tip alone;
(b) waiting for #1049 to merge — the sheet keeps saying "not recorded" about letters
that are now recorded.
Merge note for the PR body: until #1049 is merged the endpoint 404s and the sheet reads
exactly as today.

Checks for M-A: web `npx vitest run src/pages/communications/next` and web
`npx tsc --noEmit -p tsconfig.json`; gateway `npx tsc --noEmit -p tsconfig.json` and
`npx jest src/communications/letters`. All through heavy.sh, from the right app dir.
Paste the pass lines into the PR body.

---

## PR M-B — base `fix/mail-intake-never-loses-a-letter` (#1049), head `fix/mail-intake-health-whole-count`

Worktree: `git -C <main> worktree add -b fix/mail-intake-health-whole-count ~/Projects/p4-scratch/sw-walk/wt/mail-walk-fix-b origin/fix/mail-intake-never-loses-a-letter`

### 1. The house's intake counts are whole
`apps/api-gateway/src/common/orchestrator/mail-intake.service.ts` `houseHealth()` (~line 241)
selects rows `.range(0, 4999)`; PostgREST caps every response at `max_rows = 1000`
(`supabase/config.toml:18`), so a house with >1000 intake rows in 7 days gets counts cut
at 1000 — oldest first, so the NEWEST failures are the ones dropped. And `waiting`
only looks back 7 days, so a letter that gave up 8 days ago (payload still kept for
"Read again") disappears from the house's view.
Fix:
- `byStatus`: one `select("id", { count: "exact", head: true })` per status in the
  `mail_intake.status` CHECK list (received, filed, held, prospect, duplicate,
  not_kept, failed, gave_up), `.eq("restaurant_id")`, `.eq("status")`, settled ones
  limited to the last 7 days, waiting ones (received, failed, gave_up) with NO window.
  `Promise.all`; any error → `{ byStatus: {}, waiting: 0, oldestWaitingAt: null, unknown: true }`.
- `waiting` = sum of the three waiting statuses.
- `oldestWaitingAt`: `.select("created_at").eq(restaurant).in("status", [received, failed, gave_up]).order("created_at", {ascending: true}).limit(1)`.
- Update the doc comment on `HouseIntakeHealth` and the `@ApiResponse` description in
  `communications/letters/house-letters.controller.ts` (~line 74): settled counts are the
  last 7 days; `waiting` has no window.
Rejected: an RPC with GROUP BY (needs a migration and a version number in a lane where
another migration is already in flight); raising `.range` (the server cap still wins).
Spec: `mail-intake.service.spec.ts` — read how its fake supabase works; extend it to
answer `count`/`head` and prove (a) counts above 1000 are reported whole (fake 1500
filed rows), (b) a gave_up row 8 days old is counted in `waiting` and sets
`oldestWaitingAt`, (c) an error on any one count → `unknown: true`.

### 2. A held letter is not called a stranger's
`apps/web/src/pages/communications/next/WhoIsWriting.tsx:318-321` — the Strangers lede says
"Mail from senders who are not one of your vendors. Mudavym kept it because it carried
an attachment or read like an offer." The list also holds letters with `held_reason`
(`sender_unreadable`, `sender_unconfirmed`) — including a letter whose From IS a vendor
in the book that could not be confirmed (seen: "Bank details changed" from a vendor's
address under "Strangers"). When any row in `data` has `held_reason`, append:
"It also holds letters whose sender could not be read or confirmed — even from an address
in your vendor book — until a person checks them." Keep the original sentence for the
prospect rows. Test in `WhoIsWriting.test.tsx` (both with and without a held row).

Checks for M-B: gateway `npx tsc --noEmit -p tsconfig.json`, `npx jest src/common/orchestrator src/communications/letters`;
web `npx vitest run src/pages/communications/next/WhoIsWriting.test.tsx` and web tsc.
Run `bash scripts/check_decision_claims.sh` in the M-B worktree; if a claim regresses
because of your change, move it to the new shape in the same commit and say so.

---

## Return
For each PR: number, head, base, files, diff size, the exact test/tsc pass lines,
anything you could not do and why. Do not run the local stack; the parent re-checks
in the browser.
