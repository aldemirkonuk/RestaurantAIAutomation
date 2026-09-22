# /ask layout: the judge's verdict

Read-only. I read both inputs in full (`ask-layout-sota.md`, `ask-layout-cases.md`) and then
checked their load-bearing claims against the sketch, the code on `origin/main` (`34c33a76a`)
and the locked founder picks. Nothing here is decided. The founder picks.

## 0. Facts that change the inputs (verified this pass)

| # | Fact | Source |
|---|---|---|
| F1 | The drawn act sheet **covers the counter**. The scrim is `inset:0` and the sheet is `right:0; width:440px` against the 1440 frame, rendered after the `<aside class="counter">`. The frame 02 render shows no counter under the seal sheet. The cases doc treated this as an open assumption (its case 5, open question 1). | `wt-shell/.planning/sketches/119-app-shell-sota/direction-d.html:165-166`, `:366-414`; `shots/direction-d-1440.png` frame 02 |
| F2 | The founder's width pick (fork 10): the counter is **tucked below ~1280 px and on `/reports` and `/inventory`**, to a ~52 px strip that still shows each verb with its count. The 36 px figure in the sketch is superseded. | `.planning/decisions/0160-…md:684` (wt-shell / feat/shell-counter) |
| F3 | The founder's phone pick (fork 9): four doors, **Counter · Rooms · Search · Ask**. Counter and Ask are separate doors. | same row, `0160:684` |
| F4 | D's rail already opens with *Ask Mudavym. ⌘⇧K* at its head. So every layout has a door that does not depend on the counter. | `README:86-87`; frame 02 render |
| F5 | The `Sheet` primitive is modal. Focus moves in, the body locks and the page behind cannot be clicked, even when there is no scrim. OD-123, still open, asks whether that can change. | `apps/web/src/components/mudavym/Sheet.tsx:261-263`; `OPEN-DECISIONS.md:75` |
| F6 | ADR 0112 F8, decided by the founder, names the **non-modal class**: no scrim, no focus trap, dismissed by moving or Esc, never a form and **never the seal**. The counter is already in that class ("does not trap focus, does not scrim, and is never a form"). | `0112-…md:239-243`; `README:166-167` |
| F7 | Today's ⌘⇧K Ask bar **is a modal**: `fixed inset-0`, `aria-modal`, a dim layer, and a body scroll lock. When the founder says "not like a modal", he is asking for a change to what exists. | `AskAiBar.tsx:290-310`; `AskAiSurface.tsx` scroll-lock effect |
| F8 | Quick-ask page context is read **from the route only**. An order open in an act sheet over `/wines` is invisible to it. | `apps/web/src/components/askai/page-context.ts:47` (`derivePageContext(pathname, search)`) |
| F9 | Founder pick (fork 4): anything the assistant proposes goes to *Mudavym proposes* and is **applied only by the seal**. | `0160:684` |

## 1. The adversarial pass on the leading layout

The leading layout is the cases doc's **L4**: tab-first, with the popover and a full-page escape. It scored 53/56. The SOTA doc's leader is **L1**, the same family (Ask lives inside the counter). I tried to kill both.

**K1. The width it steals.** The cases doc wins case 6 for L1/L4 because the Ask tab "reuses budget already spent". F2 makes that false. On `/reports`, on `/inventory` and on any screen under ~1280 px, the budget is not spent, because the counter is tucked by the founder's own pick. On exactly those screens the Ask tab is hidden. Opening it spends the 268 px (320 − 52) that the tuck was chosen to give back. Those are the analytics pages, where "an analytic seen differently" questions start.

**K2. The case it loses worst.** Two cases:
- **Mid-seal (case 5).** This is now drawn, not assumed (F1). The seal sheet sits over the counter, so the Ask tab cannot be reached at the moment the founder named.
- **Anything wider than a sentence (case 10).** A bound reading carries figure cells, drawer rows and a requirement table (`0145:67-69, 83`). At 320 px that sits below the ~400 px practical floor the SOTA scan found (§5). Every AI pane it surveyed can be resized. L4's answer to this is to navigate to `/ask`. That leaves the page the question was about, and "the question is mainly about the page you are on" is the founder's main framing.

**K3. Acting and asking get mixed up.**
- One column head would carry both the conversation and the counter's own traffic. Toasts land at the counter's head, in flow (`README:120-121`). If the Ask tab is showing, an 8 s toast either pushes the answer down mid-read or goes unseen.
- While a person asks, the waiting list is hidden behind the tab.
- The assistant would be split across two tabs of one column: the conversation on *Ask*, the proposal it produced on *Waiting* (*Mudavym proposes*).

**K4. It contradicts the phone pick.** On the phone, Counter and Ask are separate doors (F3). L1/L4 would make Ask a sub-tab of Counter on desktop. That teaches two opposite mental models for one product.

**K5. The scoring was self-graded.** The cases doc invented L4 and then scored it. Two of its scores are wrong on the facts:
- Case 13 gives L1 a 1, but the rail already has a door that does not depend on the counter (F4).
- Case 4 marks the phone as "undrawn", but the founder has decided it (F3).
Correcting these, and case 6 (K1), removes most of L4's margin.

**What survives:**
- one right-hand slot, not two (SOTA §1: Intercom, Zendesk, VS Code);
- no standing width cost;
- the counter's region lifecycle (the offline strip, the house-switch reset);
- the escalation ladder: popover, then the side slot, then `/ask`.

All four survive into the recommendation. The *tab inside a 320 px counter* does not.

### The other layouts, attacked

- **L2 (a separate standing panel) is killed.** A third column costs about 380 px on every page, every session. With the rail open and the counter open, the page is left 508 px at 1440. With the counter tucked, it is left 616 px at 1280. The SOTA scan found no product that runs two independent right-hand rails (§1). Its one real win, mid-seal, is carried by the quick popover for anything that fits in a line.
- **L3 (an Ask sheet over the counter) survives as an option but loses the founder's own framing.**
  - The sheet primitive is modal (F5). While you ask about `/wines`, the `/wines` table cannot be scrolled or clicked. That is "like a modal", which he rejected. Only OD-123 (open) could change it.
  - It is the same shape, at the same edge, as the Seal sheet, so asking and acting look identical.
  - An answer that proposes a seal needs a sheet on top of a sheet, which is not drawn.
  - It does win the 1280 `/reports` case: it covers the report instead of reflowing it.

## 2. The recommended shape (L4 rebuilt): one slot, two faces

The right-hand slot shows **either** the counter **or** Ask, never both wide.

**Opening Ask.** Summoning Ask swaps the counter out: ⌘⇧K, the header, the rail's *Ask Mudavym.*, or *keep asking* on the quick popover. The counter folds to the ~52 px counted strip the founder already picked, so seal counts stay visible, and toasts dock under the header as already drawn for a tucked counter (`README:122-123`). Clicking a verb on the strip brings the counter back.

**How the Ask face behaves.**
- It is a shell region in the F8 class: no scrim, no focus trap, and Esc returns focus to whatever summoned it. The page stays live beside it.
- It never seals. A proposed change becomes a *Mudavym proposes* row and is sealed in that row's act sheet (F6, F9). That gives each mode its own shape: acting happens in sheets, asking happens in the slot.
- It opens at the counter's 320 px and can be dragged wider.
- Wide tables and yesterday's folios open in `/ask`.

**Width while Ask is open** (rail open at 232 px; Ask at 320 px plus the 52 px strip):
- 1440 px: the page keeps 836 px. A tab would keep 888.
- 1280 px: the page keeps 676 px. A tab would keep 728.
- Every extra px of drag comes off the page.

**The costs, stated plainly:**
- It costs 52 px more than a tab while open.
- Mid-seal questions still get only the popover.
- On `/reports` at 1280 it reflows the report, which is where L3 does better.

## 3. The options for the founder (mutually exclusive, recommended first)

| Option | What it is and what it costs | Cases won (from `ask-layout-cases.md`, re-scored with §0) |
|---|---|---|
| **A. One slot: counter or Ask** | Ask swaps into the counter's column beside a live page, and the counter folds to its counted 52 px strip. Wide answers and old folios go to `/ask`. It costs about 52 px more page width than a tab while open (more if dragged wider), and a question asked mid-seal only gets the popover. | Wins outright: 1 and 4. Ties for the win: 2, 3, 7, 8, 9, 10, 11, 12, 13, 14. Loses: 5 (every option loses it) and 6 (to B). |
| **B. Ask sheet over the page** | Ask opens as a 440 to 640 px sheet over the counter and the page's right edge, and the counter stays the resting state. It freezes the page being asked about (a modal sheet, F5), and it has the same shape as the Seal sheet, so asking looks like acting. | Wins outright: 6. Ties: 4, 7, 8, 10, 11, 12, 13, 14. Loses: 1, 2, 3, 5, 9. |
| **C. Ask tab in the counter** | Ask is a second tab beside Waiting in the 320 px counter, and anything wide escapes to `/ask`. It is hidden wherever the founder tucked the counter (below ~1280 px, `/reports`, `/inventory`), it hides the waiting acts while asking, and it contradicts the phone's separate Counter and Ask doors. | Ties: 2, 3, 9, 11, 12, 14. Loses: 1, 4, 5, 6, 7, 8, 10, 13. |

L2 is not offered: it is killed in §1.

**Example of A in a restaurant moment.**
- At 17:40 a manager has `/wines` filtered to one producer and presses ⌘⇧K. The counter folds to its strip (*Seal 3 · Reply 1*) and Ask opens beside the table, which stays scrollable.
- She asks which of these sold slowest this month. The answer names them with the reading and its read time, and each figure opens its rows.
- She asks for sell-through by week. The answer says `/wines` cannot show that and offers *Draft the change*, with the page, the filter and the question attached.
- She clicks *Seal 3* on the strip and the counter comes back.

## 4. Needed in every option (these do not decide between them)

1. **The quick ask must become a non-modal popover (F8).** Today it is a modal Panel (F7). "Not like a modal" is a change to what is built.
2. **Page context must include the open act sheet's record, not only the route (F8).** Otherwise a question asked mid-seal is asked about the page underneath.
3. **"It performs it" is limited by a locked pick.** Reads answer at once. Writes become *Mudavym proposes* rows, applied only by the seal (F9). If the founder meant quick commands to write directly, that contradicts fork 4, so ask him rather than build it.

## 5. Open forks (the founder's call, not defaulted)

1. **A, B or C.**
2. **Where a *Draft the change* request lands** ("maybe we could endpoint that"):
   - (a) a *Decide* row on the owner's counter;
   - (b) an internal builder queue (internal tools never appear in the rooms, `0160:684` standing);
   - (c) a flagged folio on `/ask`.
   The closest published precedent is Intercom Fin's ranked content-gap drafts (SOTA §6).
3. **For A only, below ~1280 px: push or overlay?** Should the Ask face push the page, or lie over it the way B does?
4. **Does "it performs it" mean write without the seal?** The locked answer is no. Confirm what his words meant.

## 6. Shortcuts and what I did not verify

- **SOTA citations.** I did not re-fetch any of them. The SOTA findings are taken as written.
- **Scores.** The case scores are judgment, not measurement.
- **Widths.** All width figures ignore browser chrome. They assume an Ask face of 320 px (A) and a third column of 380 px (L2).
- **Unopened designs.** I did not open the "Reading Room" or "The Book" sketches, or the `/ask` page design.
- **Partial reads.** I read ADR 0160 only at row 684, and ADR 0112 only at lines 60-68 and 233-244.
- **Where the sketch and ADR 0160 live.** Both are on `feat/shell-counter`, in `/Users/[founder]/Projects/wt-shell`, which is uncommitted per that row. They are not on `main`.
