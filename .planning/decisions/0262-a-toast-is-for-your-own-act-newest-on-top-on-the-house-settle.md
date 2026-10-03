# 0262 — A toast is for your own act, newest on top, on the house settle

- **Status:** Locked
- **Date:** 2026-10-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** toast, toaster, AppToaster, house-toast.css, sonner, stack, deck, newest on top, settle, motion, scope, own acts, bell, counter, order:created, owner-quarter sim
- **Links:** [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] (row 918: sketch 119 direction D, the counter; row 919: keep sonner), [[0131-the-new-house-goes-live-dark-then-one-house-at-a-time]] (:35-40, the seven house motion tokens and the 136-demo curation), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (:93, row 5: toasts are house chrome), [[0112-one-modal-policy-three-shapes-one-primitive]] (F8 non-modal, F10), sketch `119-app-shell-sota` (README:120-131, :272), sketch `087-mudavym-motion-canvas` (st-09; `founder-curation.dc.html:487-492`), the owner-quarter sim register (`03-scenarios/OWNER-QUARTER-2026Q3.md`, F-116 and F-119..F-125)

## Context

During the owner-quarter sim (session 05c659bb, house Tuzlu Rüzgar on production) the
founder reported that "Order Created" toasts land in a bad spot. They spread downward
instead of stacking on top, and they look and move badly (sim F-116). The toast audit
(45 agents, 37 claims survived, 3 refuted; F-119..F-125) traced it to these causes:

- `AppToaster.tsx:32` sets `unstyled: true` with nothing put back.
- No `offset` is set (`:26-45`).
- Hovering pauses every timer, so a burst piles up (`:44`; `websocket.tsx:642-644`).
- The motion is stock sonner, not house tokens (`house-toast.css:80-85` against `lib/mudavym/motion.ts:96-106`).
- Every `order:created` goes to the whole room and becomes its own toast (`websocket.tsx:638-645`; `websocket.gateway.ts:622-631`).

ADR 0160:918 picks sketch 119 D, and 119 D draws a placement (README:126-131, :271-272).
But that adoption is by reference only, and the live toaster ignores it: it is pinned
top-right over the header, with desktop placement kept in the 601-767px phone band
(F-120). Three more things were not decided by any ADR or OD:

- **Stacking order.** Sketch 119 never draws two toasts at once. Its "at most three" is prose only (README:272). The only drawn stack is 087 st-09, a bottom-anchored column with the newest at the bottom (`parts/st.html:189-190`, `:704-721`).
- **The motion curve.** st-09 exits in 180ms on `cubic-bezier(.3,0,1,1)`, which is not one of the seven tokens (`st.html:703-705`). The 136-demo curation that ADR 0131 names has toasts move on `settle` (`founder-curation.dc.html:487-492`).
- **Scope.** 119 D gives toasts only to the person's own acts (README:120-131). 087 shows a vendor reply as a toast (`founder-curation.dc.html:487`). OD-180 and ADR 0124:375-392 decide only *who* gets a notice.

The founder answered all four by `AskUserQuestion` on 2026-10-02: stacking, motion and
scope in the sim session, and placement in the coordinator's session.

## Options considered

**Placement (F-120)**

1. **At D's anchor** — the deck sits at the head of the counter. When the counter is tucked away, it sits under the header at the right. On phones it sits above the tab bar, and the 601-767px band uses the phone placement. It never covers the header. **Chosen** (the founder's pick, verbatim: "At D's anchor (Recommended)").
2. *Keep today's sonner default* — top 32px, right 32px, z-index above everything. That covers the bottom of the sticky header and the head of the open counter (`AppToaster.tsx:26-45`; `house-header.css:28-30`). Rejected implicitly by the pick.

**Stacking**

1. **Newest on top, as a collapsed deck** — the newest card is in front at the anchor. At most three older cards tuck behind it, peeking a few px. **Chosen.**
2. **087 st-09's column** — a bottom-anchored column, newest at the bottom, where a new toast pushes the old one up. Rejected: it is the "spreading" the founder reported.
3. **A one-slot queue** — one toast at a time, the rest waiting. Rejected: a burst of acts reads as lag.

**Motion**

1. **The house `settle` token** — 320ms on `cubic-bezier(0.16,1,0.3,1)`, entering from the toaster's edge, per the 136-demo curation. **Chosen.**
2. **st-09's exit** — 180ms on `cubic-bezier(.3,0,1,1)`. Rejected: it is not a token, and ADR 0131 treats the seven tokens as the whole vocabulary.

**Scope**

1. **Toasts only for the person's own acts** — other people's and vendors' events go to the bell, the house's record, and to the counter when they need action (sketch 119 D). **Chosen.**
2. **An urgent-events whitelist** — some room events still toast. Rejected: every whitelist grows, and "urgent" is undefined.
3. **Keep room-wide toasts and coalesce them** — rejected: it treats the symptom (bursts) and keeps the cause (toasting other people's acts across the room).
4. *Doing nothing* — a 70-line order week fires 70 room-wide toasts at every signed-in person, staff included (F-124).

## Decision

**A toast confirms the viewer's own act, at sketch 119 D's anchor. It is a collapsed
deck with the newest on top, and it moves on `settle`.** Everything else goes to the
bell, and to the counter when it asks for action.

- **The anchor.** The deck sits at the head of the counter. When the counter is tucked away, it sits under the header at the right. On phones it sits above the tab bar, and the 601-767px band takes the phone placement, not the desktop one. It never covers the header.
- **The deck.** The newest card sits in front. At most three older cards tuck behind it, peeking a few px. The deck fans out on hover or keyboard focus. Hover or focus may pause the timers, but never indefinitely: when the pointer leaves or focus moves, the timers resume. A paused deck must not grow without limit.
- **The motion.** A toast enters from its edge and leaves on `settle` (320ms, `cubic-bezier(0.16,1,0.3,1)`), imported from `lib/mudavym/motion.ts`, never re-typed. Reduced motion shortens or drops the movement. It never removes the toast.
- **The scope.** A toast is raised by the client that did the act, never by a room broadcast. Room events (`order:created`, `order:updated`, vendor replies, other people's acts) write to the bell. They may also update the counter, and they never toast.

What carried it: the founder reported toasts landing in a bad spot and asked for them to stack on top (paraphrased, not his verbatim words). Sketch 119 D, the shell
he picked, already draws own-acts-only toasts and calls the bell the record. `settle`
is the curve his own 136-demo curation gave toasts.

## Consequences

- **Easier.** One toaster PR can close F-119..F-124 against a written rule. The room fan-out stops being a toast concern, and F-124's dedup and units move to the bell.
- **Harder.**
  - Every place that toasts from a websocket handler (`websocket.tsx:638-662`) must move to the bell. The bell then needs the burst handling (grouping, a count) the toasts lacked.
  - An act done in one tab is not toasted in another tab of the same person. Only the bell records it there.
- **Not decided here.**
  - Duration: 4s today, against sketch 119's 8s.
  - Toast anatomy: eyebrow, drain and kinds (119 build.py:324-336).
  - Whether `console.log` of room payloads may ship (F-125). That is a defect, not a fork.
- **Revisit when** a person misses something because it went to the bell instead of a toast, for example a vendor refusal noticed late. That signal argues for a whitelist (option 2 of scope), and needs its own ruling.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-02 | Aldemir (founder, `AskUserQuestion`, owner-quarter sim session 05c659bb) | Answered: stacking option 1, motion option 1, scope option 1 |
| 2026-10-02 | Aldemir (founder, `AskUserQuestion` in the coordinator's session, relayed to the sim session with his verbatim pick; also in memory `founder-answers-2026-10-02-toasts`) | Answered: placement, "At D's anchor (Recommended)" |
| 2026-10-02 | Claude (Opus 5.5, same session; cites re-read at `a823ef32d`, unchanged since `a62dbd105` in every file named) | Created from the rulings recorded in memory `founder-answers-2026-10-02-toasts` |
