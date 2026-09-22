# 0175 — One tap from the notification is staged: seal sheet first, the shade later, and nothing sends itself

- **Status:** Locked (founder, 2026-09-19). Answered in the one-tap batch and batches 3–10, and by approving mocks 3a–3f. **Two parts are the lane's research recommendations and stay proposed:** decision 2's list of acts kept out of the shade, and decision 9's Phase-0 ordering. Each is labelled where it appears. Nothing is built.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** push, notification, one-tap, seal sheet, notification shade, in-shade approve, ceiling, lock screen, Expo, native, Swift, Kotlin, auto-send, AUTO_SEND_SCHEDULED, processScheduledAutoSends, approve_and_send, approveOrder, authority, mobile seal, hold, challenge, Phase 0
- **Links:** [[0176-amend-0112-swipe-is-the-phone-intent-gesture]] (the ADR 0112 amendment this needs), [[0112-one-modal-policy-three-shapes-one-primitive]], [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]], [[0171-a-conversation-id-opens-only-for-the-house-that-owns-it]], [[0118-the-house-writes-its-own-mail]], [[0173-communications-is-a-catalogue-with-slot-editing]], [[0174-email-is-a-paper-sheet-and-the-house-signs-it]]. **Reverses** OD-37 (`OPEN-DECISIONS.md:98`) and the premise of [[0118-the-house-writes-its-own-mail]] D2's undo-window source (decision 5). **Decides** the seal fork ADR 0171 left open (`0171:53`; decisions 9 and 10). Approved mockup: <https://claude.ai/artifact/F2u35LMP415GAmGcfjgnX6>, Version 5 (section 3). CLAIMS rows `ADR-0175-VENDOR-AUTO-SEND-RETIRED`, `ADR-0175-APPROVE-ORDER-ALWAYS-NEEDS-AUTHORITY`, `ADR-0175-MOBILE-APPROVE-CARRIES-SEAL`, `ADR-0175-VENDOR-SENDS-ARE-SEALED`.

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

1. **Phase 1: the tap opens straight onto the seal sheet.** No native code. The tap is not the intent. Identity comes from the OS unlock and Face ID, and intent from the gesture on the sheet (ADR 0176). Pulled down on an unlocked phone, the notification shows the proposal. (On iOS in Phase 1, for a phone set to "When Unlocked" that has a passcode. Elsewhere, and on Android, the proposal is one tap away until Phase 2; see decision 3, batches 8 and 9.) "Not now" clears the card and keeps the inbox row.
2. **Phase 2: approve inside the notification shade with a hold.** It is dark by default and on only when the house turns it on. It applies only within the house's limits below, which start at 0 (off, so no default spends: ADR 0116), and only on an unlocked phone. It needs native Swift and Kotlin, and it is built only after the device spikes pass. Over either limit, or on a locked phone, the same notification falls back to Phase 1. Its first act is the order approval drawn in mock 3f. *Lane research recommendation, proposed (`onetap/safety.md`, lane scratchpad, not in the repo):* payments, bank details, grants and configuration stay on the seal sheet. It needs the ADR 0112 amendment recorded in ADR 0176.
   **Founder limits (2026-09-19, batch 5).** The ceiling is two limits, and both start at 0: a **per-order ceiling** and a **per-house daily cap** on in-shade approvals. An enrolled phone is **unenrolled automatically** on a password reset or an in-app password change (ADR 0174 D8), when the member is removed from the house, and when the member's role changes.
3. **The lock-screen rule.** Locked, a notification shows the event, the house, the order number and a count. Unlocked, it adds the vendor, the amounts and the draft. Email bodies and bank details never leave the app. **A house cannot override this.**
   **Founder decisions (2026-09-19, batches 7 and 8): the payload is rich on iOS and lock-safe on Android until Phase 2.** On iOS the payload carries the vendor, the amounts, the draft and the vendor-mail gist, so an unlocked pull-down shows the proposal in Phase 1 without native code, and the OS redacts the lock screen. On Android it does not: the #403 adversary read the Android source and found that Android resets a channel's app-set `lockscreenVisibility` (`PreferencesHelper.createNotificationChannel`, "Reset fields that apps aren't allowed to set"), and its default is to show all notification content on a locked phone. So a rich Android push would break the rule above.
   - **Android (batch 8):** the push carries only the locked fields: the event, the house, the order number and a count. The proposal is seen after one tap into the app. A rich Android pull-down waits for Phase 2 native code, which can fetch the details after unlock or build a redacted public version from a data-only message.
   - **iOS (batch 7; superseded by batch 9 below):** the rich payload with a lock-safe placeholder, relying on "Show Previews: When Unlocked". That is the default on Face ID devices; it is not verified for every Touch ID model, where "Always" may be the default.
   - **iOS, per phone (batch 9):** each iPhone reports its preview setting (`getPermissionsAsync().ios.allowsPreviews`) and whether it has a passcode, and the server picks the payload for that phone. A phone that would show previews while locked, because its previews are set to "Always" or it has no passcode, gets only the locked fields: the event, the house, the order number and a count. Phones set to "When Unlocked" keep the rich pull-down. This needs no native code, and the lock-screen rule then holds on every iPhone as of its last report, whatever its default. A setting changed after that report is exposed until the next one; see the build notes. **Founder decision (2026-09-19, batch 10):** a phone that has not reported gets the lock-safe payload (fail closed), and so does a phone whose last report is **more than 7 days old**. Reports refresh every time the app comes to the foreground.
   - **Build notes (from the #406 and #407 gates; they implement batches 9 and 10 and are not new decisions):**
     - Send the rich payload only when `allowsPreviews` is `WHEN_AUTHENTICATED` and `expo-local-authentication` `getEnrolledLevelAsync()` is not `SecurityLevel.NONE`. `isEnrolledAsync()` reports biometrics only, so it is the wrong check. `NEVER`, `ALWAYS` and a missing value all get lock-safe fields.
     - Re-report on every app foreground, and store the report's own `reported_at`. Do not reuse the device's `last_seen_at`: `expo-push.service.ts` `registerDevice` refreshes it on every registration.
     - Choose the payload per token. `sendToTokens` sends one payload to many phones, so split each send by payload class.
     - Accept a report only for tokens owned by the caller.
     - Stale means `reported_at` is more than 7 days old (batch 10). The server stamps `reported_at` when it receives the report and never takes a client clock.
     - `registerDevice` clears the report fields when it creates a row or when a token changes owner, so the new row counts as unreported until the phone reports.
     - A paired Apple Watch mirrors notifications under its own privacy setting, and this rule does not cover it.
   Costs the founder accepted: on iOS, the vendor names, amounts, draft and vendor-mail gist transit Expo and APNs. Email bodies and bank details are never in any payload. Rejected alternatives: (a) lock-safe on both platforms, which costs iOS its Phase 1 pull-down proposal; (b) a data-only Android push in Phase 1, which needs a background handler that some phones kill; (c) accepting the Android lock-screen exposure, which breaks the rule. Notifications carry the real Mudavym logo (`apps/web/public/logo.png`), as in the approved mockup.
4. **Vendor-mail push.** It shows the sender, the subject and a one-line AI gist, on an unlocked phone only. Locked, it shows only that a vendor wrote. (On Android in Phase 1, and on an iPhone that gets the lock-safe payload, the push says only that a vendor wrote, locked or not; see decision 3, batches 8 and 9.)
5. **Every vendor auto-send is retired.** Every send needs a person's tap. The four paths above are removed, not flagged off. **This reverses OD-37** (`OPEN-DECISIONS.md:98`), which was struck on 2026-08-26 with auto-send accepted behind a full-autonomy switch and a 2-minute undo. ADR 0118 D2 takes the house-mailbox undo window from that path's `AUTO_SEND_UNDO_MS` (`inbound-responder.service.ts:41`). The 2-minute house window stands; when the constant goes with the auto-send path, D2's window must be declared where the house letter is queued.
6. **One approval covers the order and its letter (`approve_and_send`).** The push waits until the letter is drafted. The seal approves the order and sends that exact letter: the letter's content and recipients are bound into the seal, so an edit is a new version and needs a new seal.
7. **`approveOrder` always needs owner, manager or a grantee** (ADR 0112 F12's authority rule), even when no ADR 0116 rule fires.
8. **The web's hold and challenge is ported to mobile approve now.** On the phone the gesture is the swipe (ADR 0176).
9. **Every vendor send is sealed, and the seal binds what is sent** (founder, 2026-09-19, batch 5). `approve-draft`, `manual-reply`, `confirm-deal` and `POST /conversations/:id/approve` each take the seal. The seal binds the exact recipients, CC and text, so a sealed send sends only server-held content and any edit is a new version that needs a new seal. "Counts match" gets the seal too. *Lane research recommendation, proposed:* this is Phase 0, every defect in the table is a build prerequisite for Phase 1, and each goes on its own branch.
10. **Every vendor send needs owner, manager or a grantee** (founder, 2026-09-19, batch 5), the same rule as `approveOrder` in decision 7. This covers the four routes in decision 9. `/conversations/:id/approve` today admits owner and manager only (`conversations.controller.ts:428`), so a grantee is added there.

## Consequences

- **The honest pitch is "never more than one prompt", not "never opens the app".** Phase 1 is roughly tap, Face ID, swipe.
- **Phase 2's proof is narrower than it sounds.** It proves that this enrolled phone, unlocked, approved these figures. It does not prove whose face it was at that instant. The two limits bound that residual, and unenrollment on reset, removal or role change bounds how long it lasts.
- **Native code brings a release train.** Extensions, a Kotlin module, EAS signing for three iOS bundle ids, and an app-store build for every new act. Research recommends a server-driven card with categories named by rung rather than by kind, so copy ships without a binary.
- **Prerequisites the research names:** an Expo access token on the sender (`expo-push.service.ts` sends none), the push pipe itself, and preferences that can be saved.
- **Collision flagged, not resolved:** ADR 0160 (on `feat/mudavym-finish`, not main) offers an auto-approve ceremony for hold-to-order. Under decision 5, auto-approve can never send a vendor letter.
- **Revisit when** a spike shows in-shade signing is unreliable on a common device, or a house asks to go above its limits.

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
| 2026-09-19 | Aldemir (founder), batch 5 | Per-order ceiling and per-house daily cap, both 0; unenroll on reset, removal, role change; every vendor send sealed over recipients, CC and text, and gated like `approveOrder` |
| 2026-09-19 | PR #403 audit gate (3 angles, APPROVE WITH NOTES) | Status set to Locked with two labelled recommendations; payload made lock-safe (later overturned, see batch 7); OD-37 reversal stated; seal CLAIMS rows match code shapes, not comments |
| 2026-09-19 | Aldemir (founder), batch 6 | An in-app password change unenrolls phones too (with ADR 0174 D8) |
| 2026-09-19 | PR #403 adversary (OVERTURNED) | The lock-safe-only payload contradicted decisions 1, 3 and 4 in Phase 1, so it was put to the founder |
| 2026-09-19 | Aldemir (founder), batch 7 | Rich payload with OS lock-screen redaction (Android PRIVATE, iOS placeholder); Expo, APNs and FCM transit accepted |
| 2026-09-19 | PR #403 adversary #3 (OVERTURNED) | Android ignores app-set channel lock-screen visibility and shows full content by default, so the batch-7 Android mechanism was void |
| 2026-09-19 | Aldemir (founder), batch 8 | Android Phase 1 pushes are lock-safe until Phase 2 native code; iOS stays rich |
| 2026-09-19 | Aldemir (founder), batch 9 | iOS payload chosen per phone: "Always" or no-passcode phones get lock-safe fields; an unreported phone counts as unsafe (lane recommendation). Source: the #403 gate comment, adversary #4 |
| 2026-09-19 | Aldemir (founder), batch 10 | An unreported iPhone gets lock-safe fields (fail closed); a report older than 7 days falls back to lock-safe (closes the #406 gate follow-ups) |
