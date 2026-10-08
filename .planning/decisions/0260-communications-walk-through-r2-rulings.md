# 0260 — Communications: the walk-through rulings of 2026-10-01 and 2026-10-02 (R2)

- **Status:** Locked
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** communications, walk-through, waiting on you, drafted letters, house mailbox, mailbox chooser, sign-in marks, held words, address state, dark theme, headings
- **Links:** [`06-pages/communications.md` §14](../06-pages/communications.md) (every item, its evidence, its test and its mutations), [[0112-one-modal-policy-three-shapes-one-primitive]] (sheets), [[0118-the-house-writes-its-own-mail]] (the paid-plan line W13b supersedes), [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] (state in the URL), [[0169-the-ground-is-white-by-default-and-each-person-chooses]] (paper default, W36), [[0174-email-is-a-paper-sheet-and-the-house-signs-it]] and [[0180-house-mail-is-a-composition-grammar]] (what W12's own branch supersedes), [[0207-a-vendor-is-scored-on-what-it-did-from-the-houses-own-records]] (Jev reads masked vendor mail) (W10f), [[0230-asking-a-vendor-for-a-credit-drafts-the-letter-and-sends-nothing]], `p4-scratch/review-shared-queue.md` (R2 rows), research in `p4-scratch/review-snap-2/research/`

## Context

The founder walked `/communications` (CommunicationsNext, flag `mudavym_design_communications`) on 2026-10-01 in session R2, on branch `fix/review-communications`. Another account's session started it; this session took it over at the WIP checkpoint `0bfd0dca8`. From W9 on, the local site read and wrote production as the founder's own account (W9). Reads were stubbed with practice letters in the pane tab only (W9b), and every click that writes was asked first. Ten passes were run (P1 purpose … P10 live); W38 was ruled on 2026-10-02, when main was brought into the branch. Each finding went to him as `COMMS-W<n>` with a sketch and got Approve, Deny or Rework; the large forks got research fan-outs first (W10, W11b, W18). This ADR records the rulings. Their evidence lives in §14 of the page doc and is not repeated here.

## Options considered

The items that were reworked, re-asked or chose a non-default path:

1. **The book's layout (W7 → W10).** Three layouts were shown live behind `?book=compare`. The founder asked for a classified, filterable book instead. A research fan-out followed (W10). Its forks were ruled in W10a–W10i. Phase 1 is one server-filtered book grouped by conversation, built on its own PRs. This branch keeps the book flat, and the `?book=compare` preview is not committed.
2. **The waiting letter's card (W11 → W11c).** "More dynamic … industry products but in our wrapper" (W11) led to A and B cards, then A with the letter formatted (W11b). Two readings of "with b" were shown, and he chose "A alone". Rich letters (graphs, banners, logos, previews) became W12, on their own branch.
3. **Drafts without a house mailbox (W13 → W13b).** Proposed: the same rule as letters (shown, locked). He ruled stronger: no drafted reply is created at all without a house mailbox, and every house gets one, connected or created. W13b split the work: the page here, the gateway on its own branch.
4. **The mailbox chooser (W15 → W16 → W16b → W16c → W16e).** His own ask (W15) became a popover. It went smaller (W16b), then to real app icons (W16c). Brand research then found that the Gmail and Outlook app icons need Google's permission and Microsoft's licence. He ruled: keep the icons as built, behind a grant each, and show the sign-in marks until each yes (W16e).
5. **Apple Mail (W16 → W18).** iCal cannot send mail. iCloud Mail can be used only through an app-specific password; a Shortcut needs the owner present. He chose the house address first and iCloud as optional. The legal question on iCloud's terms is the OD-TBD below.
6. **The sending line (W20 → W20b/W20c).** He reworked "via Mudavym" into two paths: the house's own mail with a "Sent via Mudavym" line (W20c, small, on the last line, own branch) or a `…@mudavym.com` address (W20b, shown as "Not yet").
7. **A read that fails after answering (W33).** The options were to keep the rows and say when they are from (A), or clear them (B). He chose A.
8. **Words left in a sheet (W34).** Escape or a stray click used to throw away an edited letter. He approved holding the words on the row as the Stub. Then, on the built page, he chose to quote the changed paragraph, not the opening. The Stub's focus gap went to the shared queue.
9. **Back on a phone (W35).** The options were the page part (scope, letter and reply in the address) plus queueing back-closes-the-sheet for the shared Sheet (A), the page only (B), or the shared part only (C). He chose A.
10. **Dark theme on paper (W36 · 1).** The options were the page and the shared queue, the shared queue only, the page only, or deny. He chose the page plus the shared queue. **The book's heading (W36 · 2):** a visible label, a screen-reader-only heading, or sub-headings only. He chose the visible label.
11. **The tour (W6 → W38).** Bringing main in, #571 (merged) and W6 had each rewritten the page's tour. The options were #571's job order with step 2 widened to the always-drawn "Waiting on you", #571 exactly as merged, or W6 as approved. He chose #571's order with step 2 widened.

No item was denied outright. W15's terms sheet got no ruling; it was answered by a new ask (W16).

## Decision

The founder's words, verbatim, per item (one-word "Approve" items grouped):

| Item | Ruling |
|---|---|
| W0 | "Hold to accept in Sim Meyhouse" |
| W1, W2, W3, W4, W5, W6, W8, W14, W19, W21, W27, W28, W30, W31, W32 | "Approve" |
| W1b | "[No preference]" (the recommended option was taken) |
| W7 | "show me visual change diffs"; then "do it per the new rule decided by the orchestrator"; then, on the sketch, a classified book: "What I need to see is a dynamic environment because communications are dynamic … properly categorized, classified … per communication channel, per person, per vendor, per price, per item … via Jev as well or other classifiers … I would definitely filter them … external communication, internal communication … divide that as well. Maybe sales, personal, kitchen environments or vendors or other things. Let's brainstorm … research … use cases … test cases to stress them out and see which one comes on top." |
| W9 | "Real house, your account (Recommended)" |
| W9b | "Practice letters here" |
| W10 | "use many agents as you need, deep dive, fan out but extract valuable data"; "Yes, keep walking" |
| W10a | F1 "read-through phase 3, my intuition behind internal external was to divide and ease the job for the users, that s it, we don't want to overcrowd their eyes right away., new idea to the imneral chat this could be the wp group, telegram group, or any other communication channel, maybe a communication servie that interacts with the team, designed only for restyaurants? like notifies when order is ready to the waiter, or notifies when ...." · F2 "using JEv classify those, like vendors but are they verified vendor of ours or not? is  it about reservations? and so on" · F3 "Receiving view only (Recommended)" · F4 "Opt-in co-signer, later (Recommended)" |
| W10b | "can you find a JEV doppelganger open source from github to do this job" · "Research it now, apart (Recommended)" · F5 "Both, two filters (Recommended)" · F6 "Pitches now, ours later (Recommended)" |
| W10d | F7 "90% measured first (Recommended)" · F8 "Every figure, with its kind (Recommended)" · F10 "using the AI assistant and only if the vendor comms is pre approved to be autonomous" · F12 "Fixed + house tags (Recommended)" |
| W10f | "Extend Jev to outside mail" · "Per vendor, new switch (Recommended)" · "this is going to be addition when the floor coverage software is integrated too, that feature come wit that note it" |
| W10i | "Web push, then the app (Recommended)" · "Only cover offers + schedule (Recommended)" · "Acknowledgement only (Recommended)" · "Out of scope; no escalation yet (Recommended)" |
| W11 | "make it more dynamic and in a way that resembles industry products but in our wrapper" |
| W11b | "Do A with bformatting the email body as well, into not one line but in a more formatted enironment + earlier communicatons page had the ability to add graphs, functions, banners ,logos, and other features you might come up with (research baout if not already) find any kind iof usable email feature, also showcase it in for templates as in phone, computer ipad review. ) if needed use financial market datas, other industries to see what can be useful" |
| W11c | "A alone (Recommended)" |
| W12a | F0 "A, letter formatted (Recommended)" · F1 "Full rich now" · F2 "Both, and keep line breaks (Recommended)" · F3 "all in parallel" |
| W12b | "No tracking by design (Recommended)" · F4 "Owner uploads, never ours (Recommended)" · F5 "Image banner, house colours (Recommended)" · F6 "Owner/manager letters only (Recommended)" |
| W12c | F7 "The price already told (Recommended)" · F8 "No market data" · F9 "The writer + the house (Recommended)" · F10 "Allow-list per purpose (Recommended)" |
| W12d | F11 "Own previews + test-send (Recommended)" · F12 "it needs to render perfectly to email environment option 1" · F13 "Reply buttons, later slice (Recommended)" |
| W13 | "So we're going to have connectors. We're going to have MCPs. We're going to have any other technology that there is to connect our house mailbox to this. If not, no, if no, not one happens, no, not one of them happens. We're going to create one for them. And for your question, the draft cannot be created because there is no house mailbox, basically." |
| W13b | "Page here, gateway apart (Recommended)" · "Same rule, all four (Recommended)" · "Every house, included" |
| W14b | "No change (Recommended)" |
| W15 | "also when tryimng to connect gmail button replace with a popover that shows couple gmail options in simple bar like Gmail , apple, outlook, and at last a \"show more\" where it will take it to connect its desired mail. BTw, if gmail is conencted to the house the gmail must be already configured every time it log ins, right?"; then "thats mine so accept it already" |
| W16 | "more small, 4 small bars, and maybe we could just connect ical? or mail app from apple?" |
| W16b | "smaller, use real app icons not placeholders" |
| W16c | "B: sign-in marks (Recommended)", then "change this to as built now, where we need google s permission and microsoft license only if its to get otherwse sign in marks?" |
| W16e | "Sign-in marks until yes (Recommended)" · "Our envelope (Recommended)" · "Not now" |
| W17 | "Fix, own branch (Recommended)" |
| W18 | "can we make a shortcut for it, and show the customer effortless feel?"; then "House address, iCloud optional (Recommended)" |
| W18b | "Build it, own branch (Recommended)" |
| W20 | "either the own houses mail will send with the extension of our 'Sent via Mudavym ' or we will give ...@mudavym.com account" |
| W20b | "Both, Mudavym \"Not yet\" (Recommended)"; then "Approve" |
| W20c | "Last line, small (Recommended)" |
| W22 | "Approve"; C-01 words: "\"does not seem to be about the order\" (Recommended)" |
| W23 | "Build it here (Recommended)"; then "Approve" |
| W24 | "Page now + server later (Recommended)"; then "Approve" |
| W25 | "Own branch, after this PR (Recommended)" |
| W26 | "Queue it as shared (Recommended)" |
| W29 | "Keep going, fewest reloads (Recommended)" |
| W33 | "A: keep, say when (Recommended)"; then "Approve" |
| W34 | "Approve (Recommended)"; then "Approve", "Quote the change (Recommended)", "Queue it (Recommended)" |
| W35 | "A: page + queue back (Recommended)" |
| W36 | "Page + queue shared (Recommended)" · "Visible label (Recommended)" |
| W38 | "#571's order, step 2 widened (Recommended)" |

**Built on this branch** (each row in §14 names its files, tests and mutations):

- One place for what waits on a person (W2): the three waiting lists in one figure ("Waiting on you · N"), and the glance strip counts only what the page shows (W3).
- The waiting letter as card A, its letter formatted (W11c); the drafted letters locked with their reason in a house with no mailbox (W13b's page part).
- The mailbox chooser (W16c as ruled in W16e): sign-in marks until each grant, iCloud's envelope, "Show more" to `/connections#sender`.
- The counter's `?reply=<orderId>` link opens that order's drafted reply (W19).
- The house's words: W14, W20b, W21, W22 (with C-01), W27, W28, W32. Who is writing folds to one line (W32).
- The pull-back on queued house letters (W23); W24's page half (one row per order, with the "stands in front of" line).
- Long data wraps (W30); staff are not shown managers' letters as failures (W31); a read that fails after answering keeps its rows and says when (W33).
- Words left in a sheet stay on the page as a Stub, quoting the change (W34).
- The open scope, letter and reply live in the address (W35).
- The page's lines name their own ink under the old dark theme (`html.dark`, which a browser that saved Dark keeps; #576 took its control off /profile), and the heading outline reads as one tree with the book labelled (W36).
- The tour keeps #571's job order; its second step points at the whole "Waiting on you" region, so it never drops out (W38, superseding W6's region tour).

**Own branches, not built here:** W10's phases (the classified book, phase 1 first), W10f (Jev on outside mail; per-vendor autonomy switch), W10i (the Crew Line, its own product ADR), W12a–W12d (rich letters, superseding ADR 0174 D1/D2/D4 and 0180 D5/D6 as ruled), W13b's gateway part, W17 (a refused Gmail renewal is recorded and said), W18b (Outlook sending), W20c (the "Sent via Mudavym" line), W24's server half, W25 (the template words /inventory raised).

**Follow-up rulings, 2026-10-02, after the PR opened** (founder's AskUserQuestion answers, for the own branches above):
- Order: W25 first (with the sim's F-106 fix), then W17, then W13b's gateway part ("a, b, c").
- F-106: approving can leave two pending drafts for one order, and `approveDraft`'s `.single()` (`procurement.service.ts:7770` at 3973374cd) then fails although the rail shows one (`getPendingDraft`, `:9999-10000`). The W25 branch stops the second write. Where two already exist, the newest (the one the rail shows and the owner held) survives and the older is discarded with a recorded reason ("Newest, as shown"). [corrected 2026-10-02, ADR 0266: "the one the rail shows" and "the one the owner held" are different rows. A draft seal is issued only while exactly one draft waits (`procurement.service.ts:7423-7429`), so the held row is always the older one. Re-asked as F0, the founder chose "First-written (Recommended)": the create-time letter survives. For new orders PR-1 never writes the second one.]
- W17: the /connections reconnect banner (today only for mail reading, `ConnectionsNext.tsx:341`) also comes up when Gmail sending lost its grant, one banner naming what is down ("Widen to sending").
- W13b's gateway part ships off behind its flag. The flag goes on only after F-049 (the /connections "Connect yours" button has no action) and F-050 (Google refuses the per-house redirect; a Railway variable plus the client's URI) are fixed and one house has connected its own Gmail end to end ("After F-049, F-050"). The flip stays the founder's keystroke. F-ids are the owner-quarter sim's ledger.

**Follow-up ruling, 2026-10-03** (founder's AskUserQuestion answer, "No clock time (Recommended)"; branch `fix/f126-cap-notice-once-a-day`):
- F-126, the bell's "Draft limit reached" flood. Past the house's AI pre-draft cap, every order posted its own HIGH notice saying "Drafts frozen until tomorrow". That was false twice: the pause ends 24 hours after the increment that reached the cap (each increment renews the counter's expiry, and none follows the cap), and an approved order still gets its vendor letter from the approval-time writer. Now one notice per pause per house, still HIGH, worded: title "AI pre-drafts paused"; body "This house reached its limit of 50 AI pre-drafts. They resume 24 hours after the 50th. Orders you approve still get a vendor letter to review." [2026-10-08, ADR 0266: since #591 this is broader than the door. An order that already has a live outbound letter gets no new letter at approval. The founder ruled "Leave until F1" on 2026-10-05.] Both numbers follow `NEGOTIATION_DRAFT_DAILY_CAP`. A notice that does not land (no one in the house to tell, or the write fails) lifts its once-per-pause fence, so the next order over the cap tries again. If lifting the fence fails too, that is logged and the pause goes unannounced. A Redis failure while setting the fence sends nothing, because a missed notice beats a flood (found by the #595 audit, 2026-10-04). No clock time is shown, because the house timezone was never read and defaults to America/Los_Angeles. Rejected: a clock time in the house's timezone; keeping the old words and only firing them once. The cap (50) is untouched until the houses' F-084/F-089 change lands (sim share-out O1). Its future (keep, raise or remove) is a later question that the coordinator relays.

**Shared queue** (`review-shared-queue.md`, R2 rows): W26; the Stub's focus on Discard (W34); back closes the topmost sheet (W35); `globals.css` `.dark` outranking the house reset (W36).

## Consequences

- Easier: a manager sees one count of what waits on them and opens each from its row; a letter the house cannot send yet says which step is missing and links to it; words a person typed survive Escape, a stray click and a refresh of the address; a phone keeps the open letter and scope in the address.
- Superseded by ruling (proposed wording, the rulings above are the authority): ADR 0118's paid-plan line for the created house mailbox (W13b (3): every house is included). ADR 0174 D1/D2/D4 and ADR 0180 D5/D6 are superseded only when W12's own ADR lands, not by this one.
- Given up: the `?book=compare` preview (never committed); W6's region-ordered tour and its four `data-tour` anchors (W38); the old rail's SMS sentence and the glance strip's Threads figure.
- Left open, recorded elsewhere:
  - OD-TBD (filed from this branch): may the house use an owner's iCloud Mail for house letters under iCloud's personal-use terms (counsel)?
  - The follow-ups listed under "Own branches" and "Shared queue" above, and the tech-debt fragment `2026-10-01-fix-review-communications.md`.
- Revisit when: W10's phase 1 lands (the book's layout), W12's ADR lands (rich letters), or Google or Microsoft answers (W16e flips a grant).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created, session R2, branch fix/review-communications |
| 2026-10-02 | — | W38 added (the tour, ruled when main was merged in); numbered 0260 at push |
| 2026-10-02 | — | Follow-up rulings added (order a-b-c, F-106 survivor, W17 banner, W13b flag timing), asked while #587's CI ran |
| 2026-10-02 | — | F-106 survivor corrected in place (bracket): the held row is the older; re-ruled first-written, recorded in ADR 0266 |
| 2026-10-03 | — | Follow-up ruling added: F-126 cap notice once per pause, its words (branch fix/f126-cap-notice-once-a-day) |
| 2026-10-04 | — | F-126: a notice that does not land lifts the fence, unless the lift also fails (audit finding on #595; no new ruling) |
| 2026-10-08 | — | F-126 line bracketed: the notice's letter promise is broader than ADR 0266's door; kept by the founder's "Leave until F1" (2026-10-05), recorded in ADR 0266 |
