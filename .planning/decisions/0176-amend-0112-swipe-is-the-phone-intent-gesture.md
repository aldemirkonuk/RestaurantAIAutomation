# 0176 — Amend ADR 0112: on the phone the swipe is the intent, and the shade may hold the seal

- **Status:** Locked (founder, 2026-09-19). The founder answered it in session and in batch 5, and approved mocks 3e and 3f. It amends the Locked [[0112-one-modal-policy-three-shapes-one-primitive]] in the open (CLAUDE.md §5); 0112's own text is not rewritten. Nothing is built.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** ADR 0112, seal, intent gesture, hold, HoldToApprove, swipe up, Robinhood, seal sheet, phone, notification shade, F10, F12, haptic, screen reader, reduced motion, processing state, tick, in-shade approve, ceiling
- **Links:** **Amends** [[0112-one-modal-policy-three-shapes-one-primitive]] (the notification rule at `:257-258`, F10 at `:271-273`, the F12 speed rule at `:355-357`). [[0175-one-tap-from-the-notification-is-staged]] (the phases this serves). [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]]. Approved mockup: <https://claude.ai/artifact/F2u35LMP415GAmGcfjgnX6>, Version 5 (mocks 3e, 3f).

## Context

ADR 0112 makes the seal the ceremony for money, sends and ledger rows. It records the rule as "one prompt (hold = intent, the OS prompt = identity, never a third)" (`0112:355-357`), and "approving from a notification lands in the panel with the seal, never on the tap" (`:257-258`). F10 keeps the seal before money, sends and ledger rows, on a closed list (`:271-273`).

On 2026-09-19 the founder made two changes that the text above does not allow:

- **On the phone's seal sheet, a Robinhood-style swipe up replaces the hold.** He rejected a handle-and-track swipe: he wants the full experience, where the whole review screen is the drag surface. After the commit, a Mudavym-logo processing state morphs into the tick.
- **The notification shade may approve (ADR 0175 Phase 2).** It uses a hold, below a per-house ceiling, on an unlocked phone.

Two facts frame both changes. The seal that runs today on the web is a hold plus a single-use challenge redeemed on the session (`common/seal/seal-challenge.service.ts`). The passkey seal that F12 plans does not exist yet: "No WebAuthn registration or assertion route exists" (`apps/web/src/pages/profile/next/SecurityRegister.tsx:236`).

## Options considered

1. **Keep the hold on the phone.** It gives one gesture everywhere. **Rejected by the founder:** on a phone the swipe is the gesture people know from finance apps, and it lets the whole review ride under the finger.
2. **A swipe on a handle and track** (slide to confirm). **Rejected by the founder:** it is a control on the page, not the page.
3. **Swipe everywhere, the shade included.** **Rejected:** in the shade a swipe belongs to the OS (dismiss, clear). A swipe there would approve by accident.
4. **Swipe on the web.** **Rejected:** a mouse drag is awkward and the web's hold already works. The web keeps the hold.
5. **Leave 0112 as written and build it anyway.** **Rejected:** that is quietly working around a Locked decision.

## Decision

**A1. The intent gesture is chosen per surface.** It is still one intent plus one identity, redeemed against a server challenge, and never a third confirmation.

| Surface | Intent | Identity |
|---|---|---|
| Phone seal sheet | **Full-page swipe up** | OS unlock / Face ID |
| Web | Hold (`HoldToApprove`, unchanged) | the session |
| Notification shade (Phase 2) | Hold | the unlocked phone |

**A2. The phone swipe, as specified in mock 3e:**
- **The review screen is one screen that does not scroll.** Founder, 2026-09-19 (batch 5): "robinhood style". *Interpretation recorded here:* like Robinhood's order review, the seal sheet is a one-screen summary, so scroll and swipe never compete on it. A long line list opens in a separate sheet that scrolls and is not a swipe surface. The swipe keeps the thresholds below.
- The whole screen is the drag surface. The review rides up with the finger and a teal fill rises beneath it. The drag never scrolls the page, and the links on the sheet still tap. A 6 px slop comes before a drag begins.
- It **commits at 35% of the screen height**, or on an upward flick of **at least 0.6 px/ms** once the drag has moved. Past the mark the label reads "Release to approve · <amount>".
- An **early release snaps back** with a quiet "Nothing sent".
- A **haptic** plays on commit. A processing state follows ("Sealing · sending to <vendor>"): the Mudavym logo sits in an ink disc and **morphs into a tick, its check cut out in the ground colour, only when the server confirms the write.** A refused or failed write says what happened. It never shows a tick, and it never says "Nothing sent" unless that is known (0112's async-receipt rule). Then come "Order approved", the figures, where and when the letter left, and Done.
- **Screen readers** get a labelled "Approve <amount>" action. With a keyboard, the arrow key steps the fill in tenths, Enter commits past the mark, and Escape lets go. With **reduced motion** there is no spring, no breathing and no drawn check: the tick simply replaces the mark.
- A line with no price on record withholds the seal, and the action reads "Set the price".

**A3. The notification rule (`0112:257-258`) now reads:**
- *Phase 1:* a notification's button may open the app directly on the seal sheet. The tap is not the intent.
- *Phase 2:* below the house's ceiling (which starts at 0), on an unlocked phone, with the house's switch on, a hold inside the notification shade is the seal. Otherwise the notification lands on the seal sheet, never on the tap alone. When Phase 2 is built, the refusal "a card is the wrong place to arm one" (`apps/api-gateway/src/one-tap-actions/one-tap-workflow.ts:99,104`) is retired for `approve_and_send` only. It stands for every other card.

**A4. Unchanged.** The three shapes. F10's closed list, and "money, sends and ledger rows keep the seal before". The authority rule (F11 as amended by F12's ruling 2). F12's passkey seal, which stays the target on both platforms. The swipe proves intent to the server through the redeemed challenge, not through a device-local biometric boolean, so F12's "nothing ships on a device-local prompt" still holds.

## Consequences

- **Easier.** The phone's seal becomes the gesture people already trust for money. Mobile approve stops being a dead control once it carries the challenge (ADR 0175, decision 8).
- **Harder.** There are two gestures for one ceremony, so every seal component must take its gesture from the surface and never hard-code one. The drag surface must not trap VoiceOver, TalkBack or keyboard users. The labelled action is required, not optional.
- **Harder.** The in-shade hold (A3, Phase 2) proves "this unlocked, enrolled phone approved these figures", which is weaker than the planned passkey seal and stronger than today's session seal. ADR 0175 records that residual.
- **Revisit when** the passkey seal ships (does the swipe become its trigger?), or telemetry shows accidental commits from the flick.

## Open

Not decided here, and not added to `OPEN-DECISIONS.md` (see ADR 0173's register note).

- **Screen-reader parity with the web.** Whether the labelled action arms first and commits on a second activation, as the web's `HoldToApprove` does for keyboard and reduced motion (Enter arms, Enter again within 3 s approves: `apps/web/src/components/mudavym/HoldToApprove.tsx:16-19`), or commits in one step. Not decided.
- **Additions to the F10 list.** Research proposes snooze, done, "not now", acknowledge, claim a shift and others as undo-after acts from the shade. The list stays closed until the founder names them.
- **Also relevant, owned by ADR 0175:** the server send-window length, Android key semantics, and device install-exclusivity. Each shapes what the Phase 2 hold can prove.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Aldemir (founder), in session and at mocks 3e/3f | Phone swipe replaces hold on the seal sheet (full page, not a handle); web and shade keep hold; logo-to-tick after commit; in-shade approve as Phase 2 |
| 2026-09-19 | Claude (Opus 5) | Created; swipe constants read from the mock source (`THRESH 0.35`, `SLOP 6`, `FLICK 0.6`) |
| 2026-09-19 | Aldemir (founder), batch 5 | "robinhood style": a one-screen, non-scrolling review; long lists in a separate sheet; thresholds kept |
| 2026-09-19 | PR #403 audit gate (3 angles, APPROVE WITH NOTES) | Status set to Locked; the approved logo-to-tick motion stated; screen-reader arm-then-confirm left open |
