# Round 16 - adversarial test of the Mail tab UI PRs #880-#883

Stack head tested: origin/feat/comms-mail-tab-thread-specs c1ac1a774 (includes backend #876-#879), detached worktree, since removed.
Probes: `round16-probes-mailui/` (r16-mailui.probe.test.tsx = 26 RTL probes, results.txt, mutations.py). Existing suite on head: 56/56 pass (29 + 9 + 18).
Not done: real browser / 375px layout (jsdom has no layout; mobile checked only from inline styles), live data.

## Verdicts

| PR | Verdict | Why |
|---|---|---|
| #880 words (mail-format.ts) | WORKS | Failed read = em dash + "does not mean no one is" (mail-format.ts:~120); unknown door never "reading"; draft/approved/queued never look sent (letterLook:~250). Mutations M1, M2, M12 each fail 1-2 tests. Defects below are wording only. |
| #881 reads, thread, sheet | PARTIAL | Order, paging, XSS-safety, reader honesty good. Defects: raw error strings leak (mail-format.ts:~170,184), "inbound" leaks (IntakeHealthSheet.tsx:198), "Not connected" shows "cannot tell yet" on the intake line (mail-format.ts intakeLine), sender reader never re-polled (useMailData.ts:124-131), no attachments (types have no field). |
| #882 MailTab | PARTIAL | List/people/threads/error states correct and tested. Defects: browser Back leaves /communications (MailTab.tsx:325-333 `replace: true`) while the header comment claims Back keeps state; focus dropped to BODY on navigation; no `dir="auto"`. Not mounted anywhere in this stack (wired only by #884). |
| #883 tests | PARTIAL | Good tests, but 3 of 13 mutations survive (below). |

## Test-fails-without-code (13 mutations on the stack head, suite = 56 tests)
Killed (10): M1 failed header as "No one waiting" (2 fail), M2 draft looks sent (2), M3 pages not reversed (1), M5 failed people read shown as empty (1), M6 Mudavym door "reading" (2), M7 staff gets reply act (2), M8 people cursor dropped (1), M9 held-at-door shows 0 (1), M10 waiting filter not sent (1), M12 unknown stored shows "None stored" (1).
SURVIVED (3, no test guards the code):
- M4 MailThread.tsx:172 `thread-unread` branch removed: failed thread read becomes endless "Reading the thread…" and nothing fails. The list has this test (people-unread), the thread does not.
- M11 IntakeHealthSheet.tsx:131 copy failure reported as "Copied." (I4 probe passes only in my probe; #883 `copy` spec covers success only).
- M13 IntakeHealthSheet.tsx:182 fallback sentence "could not be read" replaced with an invented "Letters leave from your mailbox." - the which-address honesty line is unguarded.

## Findings (owner view)
1. MISSING attachments: `MailMessage` has no attachment field (mail.types.ts:92-105; UI has no render path). A vendor's xlsx/PDF price list is invisible in a thread. Names with `../` or 4 GB sizes cannot be tested because nothing is shown. (X4)
2. HTML mail is shown as literal markup, inert but ugly: `<html><body><p>Dear <b>Chef</b>...` appears as text (X2). XSS/tracking pixel/javascript: link: SAFE, 0 injected elements, 0 anchors, `__pwn` undefined; URLs are plain unclickable text (X1, X3).
3. Jargon leaks (I2): "inbound mail domain is not set up" (IntakeHealthSheet.tsx:198); "doors" everywhere ("doors and addresses", "Held at a door", "this door keeps no record of its reads"); raw server errors verbatim: "Cannot tell: invalid_grant: Token has been expired or revoked." and "...HTTP 401 from gmail.googleapis.com/users/me/history" (mail-format.ts houseMailboxStatus). "Behind by 180 min." not hours.
4. intakeLine for `Not connected` (reader.granted=false) prints "Mail arrival: cannot tell yet" (I2-v4) while the sheet says "Not connected." The one line the owner reads contradicts the sheet and softens a known-bad state. Same for a failed last read (v5).
5. Which address: sheet states "Letters leave from <redacted-email>" plus the server's sentence "Vendors reply to your own mailbox", then also a copyable Mudavym address with "A vendor who writes to this address reaches this house." (I1). Two addresses with no sentence saying which one the vendor should use; no act to change/choose and no link to where it is set (0 controls). If `conversation` is absent (older gateway) there is no reply-to explanation at all. Reader missing from the sender reply shows "still reading the mailbox reader" forever (S5b).
6. Stale data (I3): sender/reader query has no poll (useMailData.ts:124-131, staleTime 60 s); summary polls every 30 s but the page `now` only advances on re-render. After 40 min on screen the line moved to "behind by 41 min" off a frozen reader snapshot (could be a false alarm or hide recovery). Refetch happens only on window focus/remount.
7. Navigation: in-app Back works and deep link `?thread=` works (N1). Browser Back from list > person > thread jumped to the previous app page (/orders), because every step uses `replace` (N2, FAIL). Keyboard: focus lands on BODY after opening a person (N4), no heading focus or live region; sheet is `role=dialog aria-modal`, Escape closes and focus returns (I5, good).
8. Scale: 500 people one page renders in ~1.2 s in jsdom, 200 letters over 4 pages are contiguous oldest-first, but everything stays in DOM; a 30 KB quoted-reply body x50 puts 1.4 M chars in DOM, no collapse of quoted history (P500, T200, T200-big).
9. RTL/Turkish: wraps (`overflowWrap:anywhere`, list line ellipsis), but no `dir="auto"` so Arabic/Hebrew letters align and punctuate as LTR (L1, L2).
10. Words: "sent by the house" for SENT/DELIVERED/AUTO_SENT (never claims delivered; fine). BOUNCED/FAILED/SEND_FAILED fall to "whether it was sent was not recorded", so a failed letter reads neutral, not "did not leave" (N5). Unconfirmed and refused are said correctly.
11. States (S1-S6): loading, failed people ("does not mean there are none"), failed summary (em dash, "Today: -"), failed sender, partial: all honest, none shows "no mail". Empty list names which doors are open.

## Founder ask coverage (stack head, before #884)
- All conversations: PRESENT as vendor people, their threads, the thread (vendor mail only; team, guests, strangers say "not read yet"); no attachments; not reachable until #884 mounts it.
- Which address is chosen: PARTIAL - shown read-only (sender address + server sentence + Mudavym address); no choose/change, unclear which to give vendors.
- How mail arrives: PARTIAL - sheet lists doors with status; only the house mailbox has a recorded read, other doors say "cannot tell"; jargon and raw errors leak.
- The portal leading there: MISSING - zero references to the vendor portal in #880-#883 (and none in #884's diff).

Counts: 13 findings-lines above grouped as 11; verdicts WORKS 1, PARTIAL 3, BROKEN 0; 26 probes (1 FAIL: browser Back), 13 mutations (3 survive).
