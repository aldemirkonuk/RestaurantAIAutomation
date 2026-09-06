# I — the lead's check of H-assistant-security-deep.md (2026-09-05, night)

Spot checks by the session lead, fetched directly:

- **Supabase Auth MFA docs** (`supabase.com/docs/guides/auth/auth-mfa`) — holds. Two factor types
  documented: "App Authenticator, which makes use of a Time based-one Time Password, and phone
  messaging". **WebAuthn and passkeys are not mentioned anywhere.** AAL1/AAL2 defined as H says;
  the JWT carries an `amr` array "that indicate what authentication methods the user has used so
  far". So: step-up on TOTP is documented; a passkey seal must be the house's own ceremony.
- **MDN, Using Secure Payment Confirmation** — holds on substance: the browser shows "the name
  of the merchant, payment instrument, and amount and currency" and "passes the displayed data
  directly to the authenticator, which signs it". The page carries no compatibility table (only a
  Chrome M118 dialog); H's "Chromium-only" rests on Chrome's own docs, not re-fetched here.
- Not re-fetched: the W3C WebAuthn §13.4.3 wording (H says its fetches truncated too); the Swift
  SDK's experimental WebAuthn factor; Expo's `expo-local-authentication` being device-local — H's
  reading of Expo's docs is plausible and matches the library's stated purpose, but the lead did
  not open it.

Verdicts on H's recommendations:

| Recommendation | Verdict | Note |
|---|---|---|
| Persist the newest step-up-qualifying `amr` timestamp server-side, keyed by `session_id`; never trust the client's clock | KEEP | Supabase has no `auth_time`; the audit row is the source. |
| Ship the two-hour step-up on TOTP now; the passkey seal is a parallel, house-owned WebAuthn ceremony | KEEP (founder to confirm the factor) | Matches the docs read above. |
| One WebAuthn seal ceremony: challenge = hash(nonce ‖ amount ‖ payee ‖ order ‖ exp), `userVerification: required`, server verifies and consumes | KEEP | The house's challenge-and-redeem with identity added; SPC later as a Chromium enhancement. |
| Never build the mobile seal on `expo-local-authentication` alone | KEEP | Device-local prompts prove nothing to the server. |
| Break-glass on the healthcare model (reason, real-time notice, audited review), not the cloud "primary auth is down" model | KEEP | Exactly the founder's ruling; the review SLA is his to set. |
| `authorized personnel` as a first-class grant row with scope, limit, expiry, `granted by`; grantor ≠ approver enforced in the database | KEEP | More explicit than Ramp/Brex/Mercury/Rippling document; right for a house where the owner must be able to read who acts as owner. |
| Any owner may revoke any grant | FOUNDER | A policy call, asked. |
| Compose hold + OS prompt Apple-Pay-style; never a third confirmation | KEEP | The founder's "seconds on the floor". |

Nothing in H reopens a ruling; two of its six questions collapse into one (the launch factor and
the mobile timing are one decision about the same ceremony).
