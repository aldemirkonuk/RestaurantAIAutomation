## The Mail tab on /communications is built narrow: six parts of the proposal are still owed — OPEN — 2026-11-07

Filed by `feat/comms-mail-tab` (proposal Phase C, L9 narrowed; founder /goal 2026-11-07). The tab lands as a stack of six draft PRs on `feat/mail-people-and-threads-read` (`1f86fdbc6`, the `/mail/*` reads): `feat/comms-mail-format` → `feat/comms-mail-thread-and-sheet` → `feat/comms-mail-tab-list` → `feat/comms-mail-tab-thread-specs` → `feat/comms-mail-tab` → `feat/comms-mail-book-retired`. The whole diff is 152K characters and the CI audit reaches a verdict only at about 30K.

**What is built.** A Mail and Letters tab strip on `/communications` (`apps/web/src/pages/communications/next/CommunicationsNext.tsx`), the tab is in the address (`?tab=mail`, `?with=`, `?thread=` open Mail, `?draft=` and `?reply=` still open on Letters). The Mail tab (`MailTab.tsx`) has a header sentence, a today line, the All and Waiting on you chips, one row per person with paging and no cap, a person's threads, a thread oldest to newest with 50 letters a page (`MailThread.tsx`), the drafted reply for owners and managers, and the intake sheet (`IntakeHealthSheet.tsx`). The conversation book's ledger left Letters for one line pointing to Mail (`feat/comms-mail-book-retired`). Proofs: `MailTab.test.tsx`, `MailTab.thread.test.tsx`, `mail-format.test.ts`, `CommunicationsNext.test.tsx` (describe "Mail and Letters"). Claims: `../decisions/claims.d/feat-comms-mail-thread-and-sheet.jsonl`, `feat-comms-mail-tab-thread-specs.jsonl`, `feat-comms-mail-tab.jsonl`, `feat-comms-mail-book-retired.jsonl`.

**What is owed.**

1. **L6, the kinds.** Only vendor mail is stored (`storedKinds: ['vendor']`), so there are no Team, Guests or Strangers chips. One quiet line says so. Chips come when another kind is stored.
2. **Guessed placement.** No warning yet for a letter placed on a thread by a guess, and no act to move it to another thread.
3. **L2 and L3, Read again and held counts.** The sheet has no "Read again" act, and "Held at a door" prints an em dash with "not recorded yet" (`heldAtDoor` is null from the gateway). Only the house mailbox keeps a record of its reads, so every other door says "cannot tell" until a durable intake cursor exists.
4. **L10, entry points.** No notice, TwinSheet or command-palette entry opens a person or a thread yet. Today only the tab and a pasted `?with=` or `?thread=` link do.
5. **L11, dead hooks.** The hooks the old book used (`useConversationQueries.ts`, `useDraftEmailQueries.ts`) were left as they were; that lane is not this one. The page still reads the history for its two 30-day figures and for the held and refused reasons (next entry).
6. **Mounting under ADR 0357's Inbox tab.** ADR 0357 is not on this base. When it lands, the Mail tab moves under its Inbox tab rather than sitting beside Letters.

**Calls made, each the session's call under the 2026-11-07 /goal:**
- The page opens on Letters. Mail opens on a click or on `?tab=mail`, `?with=` or `?thread=`; `?tab=letters` wins over the other two.
- Switching tabs pushes history. Opening a person or thread replaces the address, as an opened draft does (COMMS-W35).
- The Waiting on you chip is local state, not the address.
- The 30-day glance strip, the failure banner and the Waiting section show on Letters only.
- Step 1 of the tour now points at the tab strip.
- The banner's name for the history read is now "the letter counts".
- The drafted reply opens over Mail where the page already mounts it, and `?thread=` stays in the address.
- The queued pull-back (COMMS-W23) moved into the thread view.
- Mudavym's mailbox and the house's Mudavym address are one door row, because a stored row cannot tell them apart.
- "Switched off" is a door state of its own, shown in the warn colour.
- APPROVED keeps "Approved · not sent".
- A person's threads page too ("Show older threads").
- The ledger row's settle motion (`cm-row-settle`) is retired (`MOTIONS.md`).
- `COMMS-2026-10-01-W36-TITLE-AND-BOOK-HEADING` now checks the title ink only, because the book heading left with the book.
- The tab lands as six stacked drafts, not one PR over the CI audit's size wall. The book's row specs leave one PR before the book does, so `feat/comms-mail-tab` renders a book its own spec no longer covers. The Mail thread's specs cover those rules instead.

**What closes it.** Each item above, as its own slice. Strike this entry when the last one lands.

## A Mail thread says why a letter was held or refused only while the book holds it — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** `GET /mail/thread` returns `MailMessage` without `relayRefusalReason` and without `constraintFlags` (`apps/api-gateway/src/conversations/mail.types.ts`). ADR 0099 says the manager sees the gateway's refusal sentence on a refused draft, and COMMS-W22 says a held draft says why it was held, in words. Both used to show on the book's ledger row. The page now hands the thread what the book already read, keyed by the same `procurement_conversations` id (`bookFacts`, `MailThread.tsx`). A letter outside the book's window says "the reason could not be read with this thread". It never says no reason exists.

**What closes it.** The gateway adds both fields to `MailMessage`, and the thread reads them directly instead of from `bookFacts`.
