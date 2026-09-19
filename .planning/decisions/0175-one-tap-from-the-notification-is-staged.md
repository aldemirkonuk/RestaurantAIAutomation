# 0175 — One tap from the notification is staged: seal sheet first, the shade later, and nothing sends itself

- **Status:** Accepted (founder, 2026-09-19). Answered in the one-tap batch and batches 3–4 (all on the recommended option), and by approving mocks 3a–3f. Nothing is built.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** push, notification, one-tap, seal sheet, notification shade, in-shade approve, ceiling, lock screen, Expo, native, Swift, Kotlin, auto-send, AUTO_SEND_SCHEDULED, processScheduledAutoSends, approve_and_send, approveOrder, authority, mobile seal, hold, challenge, Phase 0
- **Links:** [[0176-amend-0112-swipe-is-the-phone-intent-gesture]] (the ADR 0112 amendment this needs), [[0112-one-modal-policy-three-shapes-one-primitive]], [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]], [[0171-a-conversation-id-opens-only-for-the-house-that-owns-it]], [[0118-the-house-writes-its-own-mail]], [[0173-communications-is-a-catalogue-with-slot-editing]], [[0174-email-is-a-paper-sheet-and-the-house-signs-it]]. Approved mockup: <https://claude.ai/artifact/F2u35LMP415GAmGcfjgnX6> (section 3). CLAIMS rows `ADR-0175-VENDOR-AUTO-SEND-RETIRED`, `ADR-0175-APPROVE-ORDER-ALWAYS-NEEDS-AUTHORITY`, `ADR-0175-MOBILE-APPROVE-CARRIES-SEAL`, `ADR-0175-VENDOR-SENDS-ARE-SEALED`.

## Context

The founder: **one-tap from notifications is the pitch.** In the Robinhood style: pull the notification down without opening the app, see the proposal, order or mail, and act on it there. That collides with ADR 0112, which says approving from a notification lands on the seal and never on the tap.

The one-tap research (lane research, 2026-09-19: iOS, Android, lock screen, UX, safety, and two adversaries, both "wounded") established:

- **Expo alone cannot act in the shade.** iOS never runs JS for a background notification response (`expo-notifications` 0.32.16, `ExpoHandlingDelegate.kt:140-144`, re-read locally). On Android the Expo push relay turns any push with a title and body into an FCM notification message. The system tray draws it with no custom buttons, and the data-only path "can not be triggered by expo push service" (`ExpoHandlingDelegate.kt:122-128`; Expo docs, modified 2026-08-07). Every in-shade act needs native Swift (notification extensions) and Kotlin (our own builder).
- **In-shade approval is real only on an unlocked phone.** A locked iPhone forwards the action to the app. An Android key that needs recent strong authentication fails after a weak face unlock, after Smart Lock, or more than 30 s after unlock.
- **Push reaches no phone today.** Production `mobile_devices` had 0 rows on 2026-09-19 (lane measurement, not re-queried here). The app has never run on a device (OD-109).
- **Live defects on main that any one-tap path would inherit** (re-read at `origin/main` `e066712bc`):

| Defect | Evidence |
|---|---|
| Mobile Approve is refused every time (403) | `apps/mobile/app/(tabs)/supply/[id].tsx:42-50` and `src/components/today/DecisionCard.tsx:177` enqueue `/approve` with no seal. The route reads `x-seal-challenge` (`procurement.controller.ts:453`). An absent seal is refused (`seal-challenge.service.ts:166`) with a `ForbiddenException` (`:162`) |
| Mobile "Counts match" writes to the ledger unsealed | `DecisionCard.tsx:185-192` fires `verify-receipt` with no grace and no seal. The route takes no seal (`procurement.controller.ts:529`), and the service applies ledger corrections (`procurement.service.ts:4611`) |
| Three vendor sends are unsealed, and send what the client says | `approve-draft` (`procurement.controller.ts:564`; `modifiedContent` and `ccEmails` in `dto/approve-draft.dto.ts:17,29`), `manual-reply` (`:633`, `content` and `ccEmails` from the body) and `confirm-deal` (`:736`, `finalPrice` and `quantity` from the body) |
| `approveOrder` skips the role check when no ADR 0116 rule fires | `procurement.service.ts:3760`: `if (!decision.requiredRole) return; // No rule fired` |
| `POST /conversations/:id/approve` was cross-tenant | **Fixed on main after the research** by ADR 0171 (PR #400). It is now house-scoped and needs owner or manager. It still accepts a client-supplied `modified_message` (`conversations.controller.ts:43,451`) |
| Vendor mail can send itself | Four paths. The gateway sweep `processScheduledAutoSends` (`procurement.service.ts:6270-6271`, every 30 s) sends `AUTO_SEND_SCHEDULED` rows, which `inbound-responder.service.ts:527,545` stages when autonomy is full. The orchestrator writes `AUTO_SENT` (`provider_communication_agent.py:669-670`) and sends a scarcity auto-reply outside approval (`provider_conversation_agent.py:412,3116`) |

## Options considered

1. **Approve on the tap, from the lock screen.** **Rejected:** anyone holding the phone could spend. It breaks ADR 0112's line that a notification lands on the seal, and a locked phone cannot do it anyway.
2. **Phase 1 only: one tap to the seal sheet, forever.** It is safe and needs no native code. **Not chosen as the end:** it stops short of the pitch.
3. **Staged: Phase 1 now, Phase 2 in the shade under a ceiling, dark by default.** *Chosen.*
4. **Approve from an email link.** **Rejected:** mail scanners pre-fetch links, and a link is neither a hold nor an identity (ADR 0174, decision 5).
5. **Keep auto-send behind its flags.** **Rejected:** "every send needs a tap". A letter cannot be recalled.
6. **Approve the order now and the letter later.** **Rejected:** two decisions, and the second is easy to skip. The order tap would publish a letter nobody read (`procurement.service.ts:3527` drafts it after approval today).
7. **Hide mobile Approve until a mobile seal exists.** Honest, but **rejected** for porting the web's hold and challenge now, which is the web's own bar.

## Decision

1. **Phase 1: the tap opens straight onto the seal sheet.** No native code. The tap is not the intent. Identity comes from the OS unlock and Face ID, and intent from the gesture on the sheet (ADR 0176). Pulled down on an unlocked phone, the notification shows the proposal. "Not now" clears the card and keeps the inbox row.
2. **Phase 2: approve inside the notification shade with a hold.** It is dark by default and on only when the house turns it on. It applies only below a **per-house ceiling that starts at 0** (off, so no default spends: ADR 0116), and only on an unlocked phone. It needs native Swift and Kotlin, and it is built only after the device spikes pass. Over the ceiling, or on a locked phone, the same notification falls back to Phase 1. Its first act is the order approval drawn in mock 3f. Payments, bank details, grants and configuration stay on the seal sheet. It needs the ADR 0112 amendment recorded in ADR 0176.
3. **The lock-screen rule.** Locked, a notification shows the event, the house, the order number and a count. Unlocked, it adds the vendor, the amounts and the draft. Email bodies and bank details never leave the app. **A house cannot override this.**
4. **Vendor-mail push.** It shows the sender, the subject and a one-line AI gist, on an unlocked phone only. Locked, it shows only that a vendor wrote.
5. **Every vendor auto-send is retired.** Every send needs a person's tap. The four paths above are removed, not flagged off.
6. **One approval covers the order and its letter (`approve_and_send`).** The push waits until the letter is drafted. The seal approves the order and sends that exact letter: the letter's content and recipients are bound into the seal, so an edit is a new version and needs a new seal.
7. **`approveOrder` always needs owner, manager or a grantee** (ADR 0112 F12's authority rule), even when no ADR 0116 rule fires.
8. **The web's hold and challenge is ported to mobile approve now.** On the phone the gesture is the swipe (ADR 0176).
9. **Phase 0 comes first.** Every defect in the table is a build prerequisite for Phase 1, and each goes on its own branch. The three unsealed sends and "Counts match" get the seal, and a sealed send sends only server-held content.

## Consequences

- **The honest pitch is "never more than one prompt", not "never opens the app".** Phase 1 is roughly tap, Face ID, swipe.
- **Phase 2's proof is narrower than it sounds.** It proves that this enrolled phone, unlocked, approved these figures. It does not prove whose face it was at that instant. The ceiling bounds that residual.
- **Native code brings a release train.** Extensions, a Kotlin module, EAS signing for three iOS bundle ids, and an app-store build for every new act. Research recommends a server-driven card with categories named by rung rather than by kind, so copy ships without a binary.
- **Prerequisites the research names:** an Expo access token on the sender (`expo-push.service.ts` sends none), the push pipe itself, and preferences that can be saved.
- **Collision flagged, not resolved:** ADR 0160 (on `feat/mudavym-finish`, not main) offers an auto-approve ceremony for hold-to-order. Under decision 5, auto-approve can never send a vendor letter.
- **Revisit when** a spike shows in-shade signing is unreliable on a common device, or a house asks to go above its ceiling.

## Open

Not decided here, and not added to `OPEN-DECISIONS.md` (see ADR 0173's register note).

- **The badge.** What the app-icon number means.
- **Time-sensitive events.** Which events break through Focus.
- **Android key semantics.** The strong-auth window, and what happens after face unlock or Smart Lock.
- **Native-code ownership.** Who owns the EAS, Apple Developer and Firebase accounts, and who maintains the Swift and Kotlin.
- **The server send-window length.** How long an approved letter is held so Undo can stop it (the mock shows 5 s; the existing window is 2 minutes).
- **Device install-exclusivity.** Does a second person signing in make an install permanently shared, with no in-shade approval?
- **The bundle-id rename** from `ai.wineops.mobile` (`apps/mobile/app.json:18,29`). It must come before any key group exists.
- **Also owed:** a written acceptance of the Phase 2 residual before any house turns it on, and which acts join the order approval in the shade.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Aldemir (founder), one-tap batch and batches 3–4 | Staged rollout; lock-screen rule; auto-send retired; mobile hold+challenge now; approve_and_send; authority always; vendor-mail gist |
| 2026-09-19 | Claude (Opus 5) | Created; Phase-0 table re-read at `e066712bc` (the conversations defect was fixed by ADR 0171 in between) |
