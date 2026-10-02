# 0251 — Tips are a margin note, tours ring the real thing, and the rail says what each room is for

- **Status:** Locked 2026-10-01 — design and behaviour are the founder's picks, verbatim below. Its three forks were answered the same day (end of Decision).
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder). Voice note, 2026-10-01: *"Make sure they disappear every time. If I don't say, show tutorial or later show again and later show again is okay but if i say don't ever show again then i won't want i don't want to see it again until i press or check for it and improve those steps as well they are old garbage um, tutorial designs."* Design pick, `AskUserQuestion` 2026-10-01: *"margin role lock it"* (Tips A, the margin note). Same answer: *"the appearing texts that gives little description to each side tab pages are gone add them, like when cursor comes on /dashboard -> it appears and says overall look in one glance as decsription"*.
- **Keywords:** guidance, page tips, tours, driver.js, Don't show tips again, Not now, hide_all_tips, margin note, rail, room hint, hover description, tooltip, rooms.ts
- **Links:** sketch [125](../sketches/125-all-houses-people-and-tips/README.md) (`tips-a-margin-note.html`); [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] (the shell, sketch 119 D; its counter rule amended the same day); built on branch `fix/closed-stays-closed`, shipped as PRs #568 (counter), #569 (rail hints), #570 (tip note and tour card), #571 and #572 (tours on live anchors).

## Context

Measured on `fix/closed-stays-closed` (base `059169a59`), 2026-10-01:

- **"Don't show again" turned off one page's tip only.** `GuidanceProvider.tsx` `dismissTip` wrote `tip: 'dismissed'` for that page alone, so the next page offered its own tip. And a choice saved to the server did not leave the screen until the server copy came back.
- **The tip was the legacy strip.** `GuidanceStrip.tsx` drew a rounded white card in the old wine palette with "Take tour / Later / Don't show again". It is not in the house's tokens.
- **The tours point at a page that no longer exists.** The ten tours in `guidance/content/*.ts` name 40 `[data-tour="…"]` anchors. A grep of `apps/web/src` finds only four of them, all `inventory-*`, in `InventoryCommandPage.tsx`. Every other page was rebuilt as a `*Next` component without the anchors, so "Take tour" there found nothing and said "Tour unavailable". The steps were also named after parts of the screen ("Pipeline at a glance", "Work the order table"), not the job.
- **The tour drew a dark veil** (`overlayColor: rgba(15, 23, 42, 0.55)`) over the whole page.
- **The rail lost its descriptions.** The legacy `Sidebar.tsx` carried a `description` per item and a `NavTooltip`. The rebuilt rail (`HouseRail.tsx`, reading `lib/mudavym/rooms.ts`) has names only.

## Options considered

### The tip's design (sketch 125)

1. **A · Margin note.** One quiet line at the page's margin, like a note in a ledger. "Show me" rings the real button and opens a small card beside it. No veil. **Taken — the founder's pick.**
2. **B · In the counter.** Tips live as a card in the counter, never over the page. If the counter is tucked, a tip is only a count on its button. Rejected by the pick. It also hides tips entirely from someone who keeps the counter closed, which became more likely once the counter stays closed.
3. **C · Guide card.** A corner checklist that ticks as you work. Rejected by the pick. Its "tick when done" needs a done-signal per step that no page emits today.
4. **Keep the legacy strip.** Rejected: the founder called it "old garbage".

### The rail's description

1. **A hint portalled to `<body>` with fixed position, beside the rail.** **Taken.** `.mdv-rail__scroll` scrolls, which clips anything positioned outside it. The legacy `NavTooltip` was portalled for the same reason.
2. **An absolutely positioned hint inside the rail.** Rejected: the scroll box clips it.
3. **The native `title` attribute.** Rejected. Its delay is the browser's, it cannot be styled, it never shows on keyboard focus, and on a touch screen it is unreachable.

## Decision

**D1 — The tip is a margin note.** `PageTipStrip.tsx` draws one line with a seal rule on its left, in the serif italic, and three verbs: **Show me — N steps**, **Not now** and **Don't show tips again**. The region keeps the name "Page tip". It is drawn at the top of the page column (the shell mounts it, `HouseShell.tsx`). The sketch drew it under the page title. Moving it there would need every page to mount it, and is not done.

**D2 — What each verb does.**
- **Not now** hides the tip at once. It may come back on a later visit. The existing rule is a four-hour snooze, and each tip is offered once per browser session. [Corrected 2026-10-02: a tip is not limited to once per session. `offeredPageIds` only keeps the `tip_shown` event and the announcement from repeating (`GuidanceProvider.tsx:322-335` on PR #570). A tip nobody answered shows on every visit, and a snoozed one comes back after four hours even in the same session (`:311-315`). What stops tips within a session is two tips turned away in it (`:304`). Found by #570's audit fix round; the code was not changed to match the old sentence.]
- **Don't show tips again** turns **every** page's tip off (`global.hide_all_tips`), at once and on this device too, until the person turns tips back on in Help → Ways back in → Page tips.
- A tour the person starts on purpose (Show me, or Help) always plays. [Corrected 2026-10-02: Help has no live tour starter. No page or component outside `guidance/` calls a tour start (PR #570 at `2f068d31a`), so a tour starts only from the tip's Show me.]

**D3 — The tour rings the real thing.**
- No veil: `overlayOpacity: 0`. A click elsewhere still ends the tour.
- A seal ring on the element the step is about, which stays clickable.
- A small paper card beside it, with "Step N of M" above the title and **Try it · Back · Next · Stop** in words. **Try it** ends the tour and puts focus on the real control.
- A step whose element is not on the page is left out.
- Steps follow the job, not the screen. Each step must ring an element that exists on the live page.
- **Built:** the eight reachable tours were rewritten on the live `*Next` pages (`guidance/content/*.ts`). Orders, for example, is now *Write an order → Approve it → Follow it → Check what arrived*. Five anchors were added where a page had none: `dashboard-kpis` (`KpiRow.tsx`), `orders-stage-*` (`StageSpine.tsx`), `calendar-connect` (`CalendarNext.tsx`), `comms-write` (`CommunicationsNext.tsx`) and `reports-ask` / `reports-arrange` (a `tour` prop on ReportsNext's `Action`). The other steps use selectors the pages already carry. [Corrected 2026-10-01: PR #572 (open at this edit) adds a sixth, `inventory-below-par`, a `tour` prop on the Inventory `Kpi`, so the step rings the Below par figure itself.]
- **Settings → Services is Connections now.** Its tour maps to `/connections` and rings its three registers. `/sommelier` only redirects to `/ask` (ADR 0145), so that tour is no longer offered. `orders-create` has nothing that starts it. Both content files remain as debt.

**D4 — The rail says what each room is for.** Every room in `rooms.ts` carries a required one-line `description`. A test holds each line to 64 characters or less, ending in a full stop, with no two alike. The Dashboard's is the founder's own: *"The overall look, in one glance."*
- **When it shows:** after the pointer rests on a room for 320 ms, or at once when the keyboard lands on it.
- **When it doesn't:** never on a touch screen (`hover: none`), where a tap also fires mouseenter.
- **How it goes away:** when the pointer leaves, on Escape, or on any scroll. [Amended 2026-10-02, answer 4 below: the scroll that a keyboard landing itself causes does not dismiss the hint.]
- **For screen readers:** the same line is each link's accessible description, and the drawn hint is `aria-hidden`.

**Answered 2026-10-01** (sketch 125 forks 18–20, `AskUserQuestion`):
1. **"Don't show tips again" means all tips:** *"All tips (Recommended)"*. This is how it is built.
2. **A tip per page:** *"One per page (Recommended)"*. There is no getting-started path across pages.
3. **When a step ticks:** moot. Nothing ticks without a path, and a tour step is read, not done.

**Answered 2026-10-02** (PR #569's review, `AskUserQuestion`):
4. **Keyboard landing against "any scroll":** *"Keyboard landing wins (Recommended)"*. Tabbing to a room below the fold scrolls the rail, and that scroll dismissed the hint at once, so keyboard users never saw it there (confirmed in Chromium at `168ad3217`, `HouseRail.tsx:144-158`). The scroll the focus itself causes is ignored; any other scroll still dismisses. Built in a follow-up to #569, with a real-browser test.
5. **Whose part of the room a line describes:** *"True for everyone (Recommended)"*. A line holds for every role that sees the room, with no role logic. Receipts & Credits ("credits to chase": the credit lane is owners and managers only) and Receiving ("decide on the short ones": staff record at the door) are reworded in the same follow-up.
6. **Merging #569:** *"Right after #566 (Recommended)"*. The gate owns #569 (a `CLAIMS.jsonl` row it edits names the gate), so it merges on this word, after this ADR is on main.

## Consequences

- A person who says "Don't show tips again" is never offered another tip until they turn tips back on in Help.
- A new room cannot ship without a line saying what it is for: the field is required.
- A tour is only as good as its anchors. A rebuilt page that drops an anchor makes its step disappear without an error. `guidance/tours/anchors.test.ts` now fails when a live tour's selector no longer appears in any page source. It was mutation-tested: removing two anchors failed 4 steps. It is static, so it cannot see whether a section draws at the moment the tour runs. [Corrected 2026-10-01: that describes the guard in #571. PR #572 (open at this edit) replaces it. The new guard reads each step's own `<Route>` page with the TypeScript compiler, and one element must meet the whole selector: tag, id, classes, every attribute, and the ancestor of a descendant selector. A value it cannot resolve fails the step, unless the step is listed with a reason. Each of the six mutations from #571's gate fails exactly its own step. It is still static.]
- Revisit if a tip per page proves too many for a new house. That would reopen sketch 125's one getting-started path, which the founder declined on 2026-10-01.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | Aldemir (founder, voice note + `AskUserQuestion`) + Claude (Opus 5.5; branch `fix/closed-stays-closed`, uncommitted at this row) | Created — D1–D4 built; tests `GuidanceProvider.test.tsx` 6/6, `TourEngine.test.tsx` 4/4, `HouseRail.test.tsx` 5/5, `rooms.test.ts` (descriptions); the touch-screen guard mutation-tested (removing it fails 1 test) |
| 2026-10-01 | Claude (Opus 5.5; same branch, uncommitted) | Tours rewritten as job steps on live anchors; `/connections` mapped; `anchors.test.ts` added. Guidance 46/46; the touched pages' suites 636/636; tsc and eslint clean on the touched files. Not yet seen in a browser: the preview was signed out |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`) | Forks answered: all tips off, a tip per page; the tick fork is moot |
| 2026-10-01 | Claude (Opus 5.5; browser check on Sim Meyhouse, preview :5320) | Seen in the browser: the margin note, the tour card (no veil, ring on the real control, Step N of M, Try it / Back / Next / Stop), "Don't show tips again" turning every page's tip off, and Help's "Turn tips back on". Found: "Try it" put focus on the page when a step rang a group, and the inventory step "Tap Below par" rang the whole figures strip. Fixed: the step rings the Below par figure, and a ringed group takes focus; new spec, red on revert. Only the inventory tour was walked |
| 2026-10-01 | Claude (Opus 5.5; the coordinating session) | D3 corrected in place, in brackets: the sixth anchor `inventory-below-par`, and the anchor guard as PR #572 rebuilds it. PR #572's gate (comment 5945141030) found both lines stale. No decision changed. |
| 2026-10-02 | Aldemir (founder, `AskUserQuestion`) + Claude (Opus 5.5; the coordinating session) | Answers 4–6 recorded from PR #569's review. D2 corrected in brackets: the once-per-session sentence and the Help tour starter, both found by #570's audit fix round. D4's scroll rule amended by answer 4. |
