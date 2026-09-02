# 0063 — A certification screen shows the thing being certified

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Claude (Opus 5) on the `/receipts` audit; founder to confirm
- **Keywords:** receipts, invoice, signed url, adjudication, tenant keying, cache leak, extraction confidence, auto-applied match, unlink, windowed count, floor, em dash, honesty
- **Links:** [[0051-rebuilt-pages-show-live-data-only]], [[0060-a-window-is-a-floor-and-an-unknown-is-not-a-zero]], [[0020-no-fabricated-answers]], [[0045-rivet-m-and-full-go]], `.planning/06-pages/receipts.md`

> **Number: 0063.** The register moved *during* this session. A first sweep across
> every `origin` ref showed 0055 unclaimed and 0061 claimed twice
> (`0061-a-quantity-declares-its-unit` and
> `0061-recurring-reminder-reads-the-recurrence-table`, on two branches), so this
> took 0062. Before commit, `scripts/check_adr_numbers_unique.py` reported 0062
> now taken as well — a peer had renumbered onto it — so this is 0063. The lesson
> is the guard, not the number: sweep with the command, then re-run the guard at
> commit time, because a `git ls-remote` snapshot is stale the moment it prints.

## Context

`/receipts` is an adjudication surface. Its whole ceremony — the swipe-up confirm
— asks a human to assert one narrow thing: *this transcription matches the paper*.
The page could not show them the paper.

Measured on `origin/main`:

- **The scan was never rendered.** `ReceiptsNext.tsx:273` gated the "Open the
  paper ↗" link on `doc.imageUrl`, where `doc` is a **list row**. The gateway
  signs `imageUrl` only inside the *detail* handler and returns it as
  `document: {...doc, imageUrl}` (`documents.controller.ts:189-203`). The page
  did fetch the detail (`:153-157`) and read **only** `.lines` (`:288`, `:305`),
  discarding `.document`. So the gate never fired, and the screen asked a person
  to certify a transcription against a page it never showed them. The **legacy**
  page it replaces rendered it inline (`ReceiptsPage.tsx:337-340`) — a rebuild
  regressing on the single thing the page exists to do.
- **Missed by the tenant-keying sweep.** All three list keys were bare:
  `['receipts-next','queue' | 'verified' | 'unverified-deliveries']`
  (`useReceiptsNextData.ts:23,28,33`), plus two more inside the detail view.
  Tenant scope reaches the server only through the `X-Restaurant-Id` header the
  client stamps from localStorage (`services/api/client.ts:67-69`) — the cache
  key never sees it — so after a restaurant switch these buckets serve the
  **previous tenant's** rows. PR #212 fixed exactly this on `/receiving`.
- **Three [0051](0051-rebuilt-pages-show-live-data-only.md) breaches.** `limit: 100`
  rendered as `${data.queue.length} awaiting review` with no floor marker
  (`:478`), while the neighbouring verified count already did it correctly via
  `verifiedCapped`. `detailQ.data === undefined` was the only branch (`:286-291`),
  so a **failed** detail fetch rendered "No lines were extracted" — a dead
  endpoint as an empty invoice. `isError` was `queueQ.isError` alone (`:47`), so
  a failed uncounted-deliveries query and a caught-up door were the same screen.
- **Confidence hidden.** `extraction_confidence` exists on the type
  (`services/api/documents.ts:34`) and had **zero render sites** repo-wide; the
  per-suggestion `confidence` came back from the matcher and only `reason` was
  printed (`:390`). The screen asked for trust in a reading whose quality it hid.
- **A false docblock over a write path.** The file header claimed pairings are
  "never auto-written". `POST :id/match` **writes** every unambiguous vendor-SKU
  pairing before it answers (`line-matcher.ts:282-296`,
  `documents.controller.ts:209-224`) and returns them as `applied`; the page
  reported them as "N paired with certainty" with no way to inspect or undo,
  though `linkLine` has always accepted `null` to unlink
  (`documents.ts:150`, `documents.controller.ts:225-231`). The `Paired` column
  printed `paired` / `—` with no referent, and reused `—` for both "not paired"
  and "pairing unknown".
- **Failures spoke in the page's voice, not the server's.** Edit and verify
  errors showed a hardcoded sentence and discarded `response.data.message`; the
  verify one read "The confirmation did not reach the gateway" for a 403 as
  readily as for a dropped socket. And an edit had no undo: the pre-edit figure
  vanished the moment the mutation succeeded (`:179-185`), so the person about
  to swear the transcription was faithful could not see what they had changed.

These are not six unrelated bugs. Five of them are one shape — **the page states
something it has not established** — which is the shape
[0051](0051-rebuilt-pages-show-live-data-only.md) exists to forbid and
[0060](0060-a-window-is-a-floor-and-an-unknown-is-not-a-zero.md) already found on
the neighbouring rebuild. The first is worse than that class: it is a page whose
purpose is unreachable.

## Options considered

**On the paper (R1).**

1. **Fix the link only.** Read `imageUrl` off the detail response and let the
   gate fire. Two lines. Leaves the reviewer clicking out to a new tab, holding
   an invoice in one window and a table in another, and returning to a form whose
   state they must re-find — which is the workflow the legacy page had already
   beaten.
2. **Render it inline, beside the lines.** What the legacy page did, what every
   comparable AP desk does, and what the adjudication actually needs: the eye
   moves between two things on one screen. Costs a viewer component and forces
   the expiry, PDF and failure states to be handled honestly rather than left to
   a broken `<img>`.
3. **A modal or lightbox.** Preserves the single-column table but puts the paper
   and the lines in different moments, which is precisely the comparison the
   ceremony is asking for. Rejected as a worse version of 2 at the same cost.

**On the empty tenant (R2).** Either fold an unresolved restaurant into one `''`
cache bucket (what the neighbouring page does) or refuse to fetch. `''` is a
shared bucket for two *different* unknowns — the same leak through a smaller
door — so this refuses.

**On the auto-applied pairings (R5).** Either stop the gateway writing them, or
surface and undo them here. Stopping the write is a gateway change owned by
another branch and a genuinely open product question (an exact vendor-SKU match
is good evidence). Surfacing is entirely within this page's reach and does not
foreclose the other.

**On concurrency (R6).** `procurement_document_lines` carries `created_at` and
**no `updated_at`** (`baseline_from_production.sql:4377-4400`) — no version, no
etag, nothing to precondition an `If-Match` on. Options: invent a column
(a migration this branch does not own), do nothing, or make the collision
*audible*. The third is available now.

## Decision

**Option 2 on the paper: the scan is rendered inline beside the lines.** A
screen that asks a human to certify a transcription shows them what was
transcribed, on the same screen, at the same time. The link is kept as well,
for the reader who wants the full-size file.

Concretely, and each one measurable:

- **The paper comes from the DETAIL response.** `imageUrl` is read from
  `detail.document`, never from a list row. Images render as `<img>`, PDFs as an
  `<object>`, and both sit in a pane beside the line table.
- **A not-shown scan says WHICH not-shown it is.** "No file was stored — it
  arrived by `<channel>`, which keeps content in the payload", "a file is stored
  but a viewing link could not be created", "the link has aged out", and "the
  file did not load" are four different facts and get four sentences. Only the
  first means stop looking for a scan. The 3600s signed link is treated as spent
  five minutes early (`isSignedUrlExpired`) and offers a refetch, rather than
  decaying into a broken image — which on this page reads as "there is no paper".
- **Every query key carries the active restaurant id**, in the hook and in the
  detail view. An unresolved restaurant does **not** get a shared `''` bucket:
  the queries do not run, and the page says the paper trail was never requested
  — explicitly *not* an empty queue.
- **A windowed count renders as a floor.** `queueCapped` follows the existing
  `verifiedCapped` pattern against a declared `RECEIPTS_SERVER_WINDOWS` register
  that cites the query imposing each cap.
- **All three list failures are surfaced**, named individually. An unanswered
  uncounted-deliveries query is `null`, not `[]`, and says so — `[]` renders
  identically to a caught-up door.
- **A failed detail fetch is said in words**, with the server's own sentence, and
  never as "No lines were extracted".
- **Confidence is shown where trust is asked.** Document-level
  `extraction_confidence` in the header and per-suggestion `confidence` beside
  its reason, both `—` when unrecorded. An unrecorded confidence is not a low
  one and not a high one; it is never rounded to `0%`.
- **An auto-applied pairing is inspectable and undoable.** The match summary says
  "N written to the record by this check" and states plainly that they were saved
  without asking; each paired row carries **Unlink**. The `Paired with` column
  names its target — the ordered wine, the ordered quantity, the order-line
  reference, the match method and the confidence — and says **"not paired"** in
  words, so `—` no longer does double duty.
- **The docblock is corrected.** The "never auto-written" claim is replaced by
  what the code does, in `ReceiptsNext.tsx`, `useReceiptsNextData.ts` and
  `documents.ts`. A comment that misdescribes the code is worse than no comment.
- **Failures speak in the server's words.** `serverMessage()` reads
  `response.data.message` and falls back only when there is genuinely no server
  sentence — a transport failure says so rather than borrowing one.
- **A correction keeps its original in view.** The extracted figure stays beside
  a corrected cell until verify, with an **undo** that re-PATCHes it.
- **The collision is audible, not preconditioned.** One field goes out per PATCH;
  every field the server echoes that this tab did not send is compared against
  its cached copy, and a value that moved underneath is announced. This is
  **not** a precondition and is not claimed to be one — a real one needs an
  `updated_at` migration, recorded below as an open gap.

**Preserved deliberately, prose included:** the tri-state tie-out and its
"no stated total to test against"; `fmtMoney`/`fmtDate`/`parseDay`; an emptied
non-nullable qty being *invalid* rather than a silent unknown; the two-sentence
error banner distinguishing "the last answer, not the present" from "nothing
below is claimed"; `orderQ.isError`'s "the pairing is unverified, not wrong"; and
the entire `SwipeToConfirm` discipline. **Its assertion is not widened** — verify
still asserts only that the transcription matches the paper.

## Consequences

- **Easier:** the ceremony is now answerable. A reviewer can see the invoice, the
  transcription, how sure the model was, and what the matcher wrote on its own,
  without leaving the page.
- **Easier:** `check_windowed_figures.py` was **extended** rather than duplicated
  (CLAUDE.md §4). It now holds two pages through a `PAGES` table and gained a
  sixth rule, **W6 — a page hook's query key carries the tenant**, enforced on
  `/receipts`. Extending it exposed a vacuity bug in the existing guard: its
  `useQuery(` matcher did not see `useQuery<T>({`, so W5 and W6 would both have
  passed on a hook whose every query is generic-annotated. Fixed, with a
  self-test case named for it.
- **Harder / stated plainly:** W6 is **not enforced on `/receiving`**, whose hook
  still has three bare keys (`receiving-next-queue`, `-recovery`,
  `-credit-drafts`). That file is owned by an unmerged branch. The guard prints
  the exclusion and its reason on every clean run, so "not checked" can never be
  read as "checked and fine".
- **Given up (named, not hidden):**
  - **No concurrency precondition.** Last-write-wins survives; only the *notice*
    is new. Needs `updated_at` on `procurement_document_lines`.
  - **The pairing target is named only as far as the API allows.** An order here
    is one wine (`services/api/types.ts:251-268`) and no endpoint exposes
    `procurement_order_lines`, so the badge names the ordered wine, quantity and
    the order-line id — not that line's own description. Invented text would have
    been worse.
  - The matcher still writes its confident half. This page surfaces and undoes
    it; whether it should write at all stays open.
