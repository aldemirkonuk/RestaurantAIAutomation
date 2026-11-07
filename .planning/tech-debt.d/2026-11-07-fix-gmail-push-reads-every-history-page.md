## A Gmail history backlog past the page bound never moves the cursor — OPEN — 2026-11-07

Filed by `fix/gmail-push-reads-every-history-page`, the carve-out of the mail proposal's L3 test (a) (`p4-scratch/sw-walk/mail/proposal.md:129`, finding F8 / G2) that lives in `gmail-watch.service.ts` alone.

**What is true.** `fetchNewMessages` (`apps/api-gateway/src/communications/gmail-watch.service.ts`) now reads every `history.list` page before it moves the cursor, but it stops after `GmailWatchService.HISTORY_PAGE_LIMIT` (100) pages and then leaves the cursor where it was. The bound exists because the response's `historyId` is the mailbox's current record, not the page's position, so moving the cursor after a partial read would skip the unread pages. A backlog larger than the bound (about 100 pages at Gmail's default page size) is therefore re-read from the same cursor on every push and never gets past it. The mail it does read still reaches the bridge, which dedupes on `gmail_message_id`, so nothing is stored twice, but the letters after page 100 are not read until the backlog shrinks, which it cannot do on its own.

**What closes it.** L3 proper: the cursor moves into `mail_door_cursors` (L2's book) and a bounded resync through `messages.list` replaces both this bound and the expiry path below.

## An expired Gmail history id re-watches and drops the gap — OPEN — 2026-11-07

Filed with the entry above; this branch leaves the path as it was on purpose.

**What is true.** When `history.list` answers 404 (the stored id is older than Gmail keeps), `fetchNewMessages` calls `startWatch()`, which stores the mailbox's current historyId and returns `[]`. Every letter between the expired cursor and now is never read. This is proposal L3 test (c).

**What closes it.** The bounded resync in L3 (c), which needs `last_read_at` from `mail_door_cursors` (L2).

## One Gmail message that keeps failing (not 404) blocks every later push — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** A 404 on `messages.get` (the letter was deleted between the push and the fetch) is now skipped with a warning naming only the Gmail id. Any other failure (429, 500, a network error) still throws, so the whole call returns `[]` and the cursor stays put. That is safe for a passing error, since the next push reads again, but an id that fails every time holds back all mail behind it.

**What closes it.** A per-message held/failed row in `mail_intake` (L2) so a bad id is parked and the cursor can move past it; L3 (b) and (e) build on that.

## L3's tests (b) to (f) are still owed — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** Only L3 (a) shipped here. (b) cursor held when a `mail_intake` write fails, (c) bounded resync on 404, (d) the 10-minute poll cron, (e) force-fetch limited to `super_admin` plus the house "Read again" route, and (f) health read from `mail_door_cursors` all need L2's `mail_intake` table or edit `communications.controller.ts`, which open PRs #541 and #538 touch.

**What closes it.** The L3 branch `fix/gmail-push-cursor-after-store`, after L2 merges.
