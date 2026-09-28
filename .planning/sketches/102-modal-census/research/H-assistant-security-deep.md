# H — Assistant security ceremonies: deep research

Scope: the three ceremonies the founder adopted for the assistant's config-apply and
tool-write flow — (1) step-up re-auth past a 2-hour session, (2) owner-only break-glass,
(3) passkey-backed seal for owners/managers, manager-passcode fallback on shared tablets —
researched against Mudavym's actual stack (Vite SPA, NestJS gateway, Supabase Auth/Postgres,
React Native/Expo mobile) and against named industry precedent. Every claim below is sourced;
unverifiable or ambiguous points are called out inline and rolled up in "Could not verify."
Research date: 2026-09-05.

---

## A. Step-up re-authentication in this stack

### A1. Supabase Auth: AAL levels and the claims that carry them

| Claim | Evidence |
|---|---|
| AAL1 = conventional sign-in (password, magic link, OTP, phone, social); AAL2 = identity additionally verified with a second factor (TOTP/OTP) | [supabase.com/docs/guides/auth/auth-mfa](https://supabase.com/docs/guides/auth/auth-mfa) |
| The assurance level is carried in the JWT's `aal` claim; a token missing `aal` defaults to `aal1` | [supabase.com/docs/guides/auth/auth-mfa](https://supabase.com/docs/guides/auth/auth-mfa) |
| Client reads current/next level via `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`; if `currentLevel: aal1` and `nextLevel: aal2`, the client should offer MFA | [supabase.com/docs/guides/auth/auth-mfa](https://supabase.com/docs/guides/auth/auth-mfa) |
| Server-side enforcement pattern: RLS policy `(select auth.jwt()->>'aal') = 'aal2'`, marked `as restrictive`; can be scoped by account-creation date or by checking `auth.mfa_factors` for opt-in cohorts | [supabase.com/docs/guides/auth/auth-mfa](https://supabase.com/docs/guides/auth/auth-mfa) |
| `amr` (Authentication Methods Reference) is a JSON array of `{method, timestamp}` entries — one per authentication event — covering `oauth, password, otp, totp, recovery, invite, sso/saml, magiclink, email/signup, email_change, token_refresh, anonymous`; docs state this "is also useful if you wish to implement step-up login scenarios" | [supabase.com/docs/guides/auth/jwt-fields](https://supabase.com/docs/guides/auth/jwt-fields) |
| The MFA enroll → challenge → verify API sequence upgrades a live session's `aal` to `aal2` without a full re-login | [supabase.com/docs/guides/auth/auth-mfa](https://supabase.com/docs/guides/auth/auth-mfa) |
| Access-token (JWT) default lifetime is 1 hour; refresh tokens are single-use with a 10s reuse grace window; `session_id` in the JWT maps to a row in `auth.sessions` — deleting that row invalidates the session on next refresh | [supabase.com/docs/guides/auth/sessions](https://supabase.com/docs/guides/auth/sessions) |
| Supabase's own step-up primitive, `auth.reauthenticate()`, sends a one-time nonce (email or SMS) that must accompany `updateUser()` for a password change; it only fires if "Secure password change" is enabled **and** the user is not "recently signed in," which Supabase defines as **session created within the last 24 hours** | [supabase.com/docs/reference/javascript/auth-reauthentication](https://supabase.com/docs/reference/javascript/auth-reauthentication), [supabase.com/docs/guides/auth/password-security](https://supabase.com/docs/guides/auth/password-security) |
| Pro-plan projects can set a maximum session lifetime and an inactivity timeout; free-tier projects cannot | [supabase.com/docs/guides/auth/sessions](https://supabase.com/docs/guides/auth/sessions) |

**Important gap, verified by omission across three official pages** (`jwts`, `jwt-fields`, `sessions`):
Supabase's JWT has **no OIDC-style `auth_time` claim** that means "when did this session last complete a full authentication." The `iat` claim advances on every token refresh (hourly), so it cannot answer "how long ago did the human actually prove presence." The only accurate signal is the **timestamp on the most recent step-up-qualifying `amr` entry** (e.g. the `totp` entry written when MFA challenge/verify last succeeded) — which persists across refreshes because `amr` entries are appended, not replaced. This is the field the docs point at for step-up ("useful if you wish to implement step-up login scenarios") and it is the one Mudavym's NestJS gateway should read.

### A2. WebAuthn/passkey MFA in Supabase today — status is genuinely mixed, verify before building on it

| Claim | Status | Evidence |
|---|---|---|
| Passkeys as a **primary** sign-in method (`registerPasskey()` / `signInWithPasskey()`) | **Beta**, available to all projects as of the June 2026 developer update. Requires `@supabase/supabase-js` ≥ v2.105.0 (or Flutter ≥2.15.0 / Swift ≥2.48.0). Runs the full WebAuthn ceremony: server challenge → platform passkey UI → server verify. Discoverable-credential sign-in (no email/phone needed upfront). | [supabase.com/docs/guides/auth/passkeys](https://supabase.com/docs/guides/auth/passkeys), [supabase.com/changelog/46689-developer-update-june-2026](https://supabase.com/changelog/46689-developer-update-june-2026) |
| Passkey/WebAuthn as a **second factor for MFA/step-up** (as opposed to primary sign-in) | **Not documented in the official JS reference.** `supabase.auth.mfa.enroll()`'s documented `factorType` values are `totp` and `phone` only — no `webauthn` value appears on that reference page as of this research. | [supabase.com/docs/reference/javascript/auth-mfa-enroll](https://supabase.com/docs/reference/javascript/auth-mfa-enroll) |
| The Swift SDK exposes an **experimental**, opt-in (`@_spi(Experimental)`) `mfa.enrollWebAuthnFactor()` on iOS 16+/macOS 13+ | Experimental, iOS/Swift only | Surfaced via search of Supabase Swift reference; **could not independently confirm on the primary docs page** — treat as low-confidence until read directly off supabase.com/docs/reference/swift |
| The underlying `supabase/auth` Go service appears to implement WebAuthn factor registration/challenge/verify (options generation, `ConsumeWebAuthnChallengeByID` anti-replay, COSE-encoded public key storage, sign-counter cloning checks) | Backend groundwork exists; **not exposed as a stable, documented, cross-platform API today** | DeepWiki (AI-generated summary of the `supabase/auth` source, **not an official Supabase source — treat as directional, not authoritative**): [deepwiki.com/supabase/auth/5.3-webauthn-factors](https://deepwiki.com/supabase/auth/5.3-webauthn-factors) |

**Bottom line for the house:** as of September 2026, **TOTP is the only fully documented, GA-adjacent step-up factor in Supabase Auth's public JS/Dart SDKs**; phone/SMS MFA is documented but weaker (SIM-swap risk); passkey-as-step-up exists in the backend and on one platform's experimental SPI but is not a supported, cross-platform contract yet. Building the seal's "WHO" proof on WebAuthn (§B) as a Mudavym-owned ceremony — separate from Supabase's MFA factor system — sidesteps this gap entirely, since the seal only needs to bind a signed WebAuthn assertion to a server-minted challenge, which Mudavym's own NestJS gateway can verify without going through GoTrue's MFA factor table at all.

### A3. GitHub sudo mode — the two-hour window, verified

| Claim | Evidence |
|---|---|
| Two-hour session timeout before re-prompting; **any sensitive action performed resets the timer** (i.e., it's a rolling window, not a fixed clock from first login) | [docs.github.com/.../sudo-mode](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/sudo-mode) |
| Example sensitive actions: changing an associated email, authorizing a third-party OAuth app, adding an SSH key, creating a PAT/app | same |
| Accepted re-auth methods: password, passkey, security key, GitHub Mobile push, TOTP code (SMS explicitly **not** accepted for sudo prompts), social-login email code | same |

### A4. Google Cloud reauthentication for sensitive actions — a second, independent model

| Claim | Evidence |
|---|---|
| Sensitive actions (billing assignment changes, org/folder/project-level IAM policy changes) require reauth if the user hasn't reauthenticated in the console in the **last 15 minutes** | [docs.cloud.google.com/docs/authentication/reauthentication](https://docs.cloud.google.com/docs/authentication/reauthentication) |
| Reauth = password or MFA re-entry; applies only to Google-managed accounts, only in the console (not gcloud CLI/API), and is distinct from overall session length | same |
| Default overall session length is 16 hours; admins can set 1–24h | [cloud.google.com/blog/.../time-bound-session-length](https://cloud.google.com/blog/products/identity-security/improve-security-posture-with-time-bound-session-length) |
| Google explicitly frames this as protection against **cookie-theft / session-hijack impersonation** of a privileged user, not against "the same person, too much time later" | [docs.cloud.google.com/docs/authentication/reauthentication](https://docs.cloud.google.com/docs/authentication/reauthentication) |

Note the two precedents disagree on window length by 8x (GitHub 2h vs Google 15m) because they gate different risk classes: GitHub's list is account-hygiene actions on a developer's own account; Google's is blast-radius actions (money, IAM) on shared infrastructure. Mudavym's "config apply or money moves" sits closer to Google's class, which argues for the founder's instinct that 2 hours is already the generous end, not the strict end, of what precedent uses for this risk tier.

### A5. Recommended design for the house

- **Track the signal Supabase actually gives you**: on each config-apply/money-move request, the NestJS guard reads the JWT's `amr` array, finds the newest entry whose `method` is step-up-qualifying (`totp`, or a Mudavym-owned WebAuthn seal event once B ships), and computes `now - that_timestamp`. Do **not** use `iat` or `exp` — both track token refresh, not human presence.
- **The panel says, in one line, only when the gate trips**: "Your last verification was over 2 hours ago — confirm it's you" with the seal/PIN prompt inline; no separate screen, no re-login. This mirrors GitHub's "any sensitive action resets the timer" model — a successful seal both authorizes *and* re-arms the 2-hour window.
- **The server records**: `{session_id, actor_id, amr_method, verified_at, action_id, aal_at_request}` on every apply — this is the row break-glass and delegated-authority audits (§C, §D) both read from, so build one ledger, not three.
- **Because Supabase has no `auth_time` claim**, this timestamp must live in Mudavym's own audit table keyed by `session_id` (which the JWT does carry and which maps to a real `auth.sessions` row) — not invented client-side, since a compromised client could just lie about "2 hours ago."
- Given passkey-as-MFA-factor is not yet a stable Supabase contract, ship the 2-hour gate on TOTP/step-up now and treat the passkey seal in §B as a **parallel, Mudavym-owned ceremony** rather than something bolted onto Supabase's `aal2` — the two can converge later once Supabase's WebAuthn-factor API stabilizes.

---

## B. The passkey-backed seal on the web (and mobile)

### B1. WebAuthn basics that apply directly

| Claim | Evidence |
|---|---|
| `navigator.credentials.get()` with `userVerification: "required"` forces the authenticator to perform a local user-verification gesture (biometric/PIN), not merely presence (a tap) | W3C WebAuthn Level 3, `PublicKeyCredentialCreationOptions.challenge` reference: [developer.mozilla.org/.../challenge](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions/challenge) (interface-level; full UV semantics are in the W3C spec body, not fully retrievable via this fetch — see "Could not verify") |
| The server generates the challenge; the authenticator signs over `clientDataJSON` (which embeds the challenge) plus `authenticatorData`; the server recomputes/compares and verifies the signature against the stored public key | General WebAuthn ceremony description, corroborated across MDN and Yubico developer docs: [developers.yubico.com/WebAuthn/WebAuthn_Developer_Guide/WebAuthn_Client_Authentication.html](https://developers.yubico.com/WebAuthn/WebAuthn_Developer_Guide/WebAuthn_Client_Authentication.html) |

### B2. Secure Payment Confirmation (SPC) — Chromium-only, and that's stable, not a snapshot

| Claim | Evidence |
|---|---|
| SPC is a W3C proposal that layers structured "payment information" (amount, payee/merchant, instrument) on top of a WebAuthn ceremony so the authenticator's UI itself displays what's being confirmed | [developer.chrome.com/docs/payments/secure-payment-confirmation](https://developer.chrome.com/docs/payments/secure-payment-confirmation) |
| Supported on Chrome/Chromium (macOS, Windows, Android); explicitly **not** on iOS or ChromeOS as of the fetched doc (dated ~March 2025) | same |
| Safari and Firefox show no committed roadmap for SPC — Apple's own view is that Apple Pay already covers this use case; Firefox has never taken a position | Search-aggregated from Corbado's SPC explainer and Chrome-team public statements; **treat as directional, not a single authoritative citation** — see "Could not verify" |

**Implication:** SPC cannot be the seal's transaction-binding mechanism for Mudavym today, because it's a one-browser-family feature and the floor runs whatever device is on the counter (often Safari/iPad or Android Chrome). It's fine as a *future* enhancement path on Chromium/Android but not the baseline.

### B3. The fallback — encoding transaction data into a plain WebAuthn challenge — is spec-sound if done correctly, with one caveat

- The WebAuthn spec treats the `challenge` as an opaque byte buffer supplied by the relying party; there is no normative requirement that it be *pure randomness with no structure* — only that it be RP-generated, transmitted to the authenticator, echoed back inside the signed `clientDataJSON`, and checked by the RP for correctness before accepting the assertion. This is the same anti-replay mechanism whether the bytes are a random nonce or `hash(nonce ‖ amount ‖ payee ‖ order_id)`. (Full normative text on entropy floors sits in W3C WebAuthn §13, "Security Considerations," which repeated fetch attempts truncated — see "Could not verify" below; the mechanism itself is corroborated by the SPC design, which *is* a W3C-blessed instance of exactly this "hash structured data into what gets signed" pattern, and by third-party technical write-ups of passkey step-up for payments.) — [w3c/secure-payment-confirmation developer guide](https://github.com/w3c/secure-payment-confirmation/blob/main/developer-guide.md), [MojoAuth: Binding a Passkey Challenge to a Transaction](https://mojoauth.com/blog/passkey-step-up-authentication-payments)
- **The caveat that matters:** the challenge must still carry enough independent, unpredictable entropy (a fresh random nonce concatenated before hashing) so that an attacker who knows the transaction details in advance (amount, payee — often guessable or fixed) cannot pre-compute a valid challenge and get a victim to sign it out of context. Mudavym's server-minted challenge should therefore always be `hash(server_random_nonce ‖ amount ‖ payee ‖ order_id ‖ expiry)`, single-use, and short-lived (the challenge is deleted/marked-consumed server-side the moment the hold begins, exactly as GoTrue's own WebAuthn implementation does with `ConsumeWebAuthnChallengeByID` per the source-derived DeepWiki summary above) — this is sound engineering, not a novel or risky pattern.
- **PRF extension**: lets the authenticator return a deterministic, secret-derived 32-byte output for an RP-supplied salt — used for *deriving encryption keys from a passkey* (e.g., Bitwarden vault unlock), not for authorization/transaction-binding. Safari 18+/iCloud Keychain supports it. **Not relevant to the seal's core "prove WHO" job** — flag as a maybe-later building block if Mudavym ever wants to encrypt something client-side with a passkey-derived key, not a step in this ceremony. — [bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys), [Corbado PRF explainer](https://www.corbado.com/blog/passkeys-prf-webauthn)

### B4. Platform-authenticator behavior on the actual devices Mudavym runs on

| Surface | What happens | Evidence |
|---|---|---|
| Web (desktop/tablet browser, not installed) | Full WebAuthn via `navigator.credentials.get`; works today in Chrome/Edge/Safari/Firefox on desktop and Android | General WebAuthn browser support; corroborated by Supabase's own passkey feature shipping cross-browser |
| iOS Safari, **installed as a home-screen PWA (standalone)** | Safari's WebAuthn implementation (Face ID/Touch ID) is available to PWAs; iCloud Keychain passkeys registered in a native app are usable from the same-service website via the shared system credential store | [hanko.io/blog/passkeys-part-1](https://www.hanko.io/blog/passkeys-part-1); standalone-mode behavior per [magicbell.com PWA iOS guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) — **note:** Apple's EU/DMA-driven changes to standalone PWA behavior have moved more than once; verify current EU-region behavior before relying on it for an EU tenant |
| React Native / Expo app | `expo-local-authentication` (Face ID/Touch ID/Android BiometricPrompt) is a **device-local gate only** — it proves "someone with the device's biometrics is present" but performs **no WebAuthn ceremony and produces nothing a server can verify**. Real server-verifiable passkeys on RN require a separate library — `react-native-passkeys` (Expo module, cross-platform `get`/`create` API close to `navigator.credentials`) or `react-native-credentials-manager` (Android Credential Manager + iOS AuthenticationServices) | [docs.expo.dev/versions/latest/sdk/local-authentication](https://docs.expo.dev/versions/latest/sdk/local-authentication/); library comparison via [corbado.com/passkeys/react-native](https://www.corbado.com/passkeys/react-native) |
| Shared/kiosk tablet (no personal device) | Founder's own call: manager passcode instead of a personal passkey — correctly sidesteps the fact that a shared device's biometric enrollment cannot prove *which* manager is present | — |

**This is a load-bearing finding, not a footnote**: if Mudavym ships the seal on mobile using only `expo-local-authentication`, it is **not** proving WHO to the server — it's proving "device unlocked," which the seal is explicitly supposed to improve on. The mobile seal needs `react-native-passkeys` (or equivalent) wired to the same server-side challenge/verify endpoint the web seal uses, or the mobile ceremony silently degrades to the old "intent, not identity" model the founder is trying to leave behind.

### B5. What the person sees, and how the hold + OS prompt compose without a double ceremony

- Apple's own Apple Pay design is the closest shipped precedent for exactly this composition problem, and it resolves it explicitly: **the physical gesture (double-click) proves INTENT** ("a physical gesture directly linked to the Secure Enclave, resistant to forgery by a malicious process") and **Face ID/Touch ID separately proves IDENTITY** — the two are sequential, not nested, and Apple's HIG explicitly tells developers not to add a further app-level confirmation on top of a successful biometric result ("If biometric authentication is enabled at the system level, just assume the user wants to use it"). — [support.apple.com/guide/security/uses-for-face-id-and-touch-id](https://support.apple.com/guide/security/uses-for-face-id-and-touch-id-secc5227ff3c/1/web), [developer.apple.com/documentation/localauthentication/logging-a-user-into-your-app-with-face-id-or-touch-id](https://developer.apple.com/documentation/localauthentication/logging-a-user-into-your-app-with-face-id-or-touch-id)
- Mapped onto Mudavym's hold-to-seal gesture: **the hold is the intent-gesture** (equivalent to Apple's double-click — deliberate, hard to trigger by accident, starts the server challenge mint); **the OS biometric/PIN prompt that ends the hold is the identity-gesture** (equivalent to Face ID at the payment sheet). The app must not add a third "are you sure" screen after the OS prompt succeeds — that would be the exact redundant-confirmation Apple's guidelines warn against, and it's also where most of the "ceremony as chain" complaint would come from on a busy floor.
- Timing budget (assembled from §E below): the hold itself is operator-paced (as long as the person chooses to hold, typically well under a second once decided), the OS biometric challenge/response resolves in low hundreds of milliseconds at the cryptographic layer, and full passkey ceremonies including UI average **8.5s** across FIDO Alliance's real-world corpus — i.e., the OS prompt is not the bottleneck; server round-trip and any post-prompt screens are.

### B6. Recommendation for the house

- Build the seal as **one Mudavym-owned WebAuthn ceremony** (hold begins → server mints single-use challenge encoding `hash(nonce‖amount‖payee‖order_id‖exp)` → hold-release triggers `navigator.credentials.get({userVerification:"required"})` on web / `react-native-passkeys` `get()` on mobile → server verifies signature + consumes challenge) rather than trying to wedge it into Supabase's still-experimental WebAuthn-MFA path.
- Do not build the mobile seal on `expo-local-authentication` alone — it does not produce a server-verifiable assertion and does not actually prove WHO; require a real WebAuthn RN library on any device the seal is used from.
- Treat SPC as a nice-to-have Chromium/Android enhancement later, not the baseline, given Safari/Firefox have no committed support.
- Compose the hold and the OS prompt Apple-Pay-style: hold = intent, OS prompt = identity, and never stack a third confirmation on top of a successful platform prompt.
- Shared tablets keep the manager-passcode fallback exactly as decided — this section's findings reinforce, not challenge, that call, since a shared device's biometric cannot attribute WHO on its own.

---

## C. Break-glass in practice

### C1. Cloud infra precedent (AWS, Microsoft) — built for "primary auth is broken," not quite the founder's use case

| Claim | Evidence |
|---|---|
| AWS Well-Architected frames break-glass as access for when the **IdP itself has failed**, a security incident is underway, or key personnel are unavailable — bypassing established controls in an emergency, not a routine elevated action | [AG.SAD.5, AWS DevOps Guidance](https://docs.aws.amazon.com/wellarchitected/latest/devops-guidance/ag.sad.5-implement-break-glass-procedures.md) |
| AWS requires hardware-MFA on break-glass identities, alerts/alarms tied to any use, and integration with incident response; a common pattern splits the credential and the hardware MFA key across two different trusted people's physical safes, so no one person can break glass alone | same; two-person-safe pattern per [Softcat](https://www.softcat.com/blog/break-glass-accounts-aws-your-emergency-action-plan) |
| Microsoft Entra emergency-access accounts: must not be tied to a named individual, at least 2 accounts, phishing-resistant FIDO2 passkey or PKI cert auth, excluded from device-compliance/CA policies that could lock them out but still required to use phishing-resistant MFA, **any sign-in triggers an immediate top-priority alert** to a monitored shared mailbox plus SMS/app notification to specific personnel, tested end-to-end on a recommended 180-day cycle | [chanceofsecurity.com Entra break-glass hardening](https://www.chanceofsecurity.com/post/break-glass-accounts-done-right-securing-emergency-access-in-microsoft-entra) |

Note the mismatch with Mudavym's use case: AWS/Entra break-glass is "the normal login path is broken, so bypass it via a *different, pre-provisioned* identity." Mudavym's owner-only override is "the normal approval path works fine, but an owner needs to push past a hold/limit *as themselves*, right now, with a stated reason." That is structurally the **healthcare model** (below), not the infra model — worth naming explicitly since it changes what "the audit trail marks it" should mean (a flagged action by a real, identified owner, not a login by an anonymous emergency identity).

### C2. Healthcare "break the glass" — the actual precedent for Mudavym's design

| Claim | Evidence |
|---|---|
| Epic's BTG requires the user to enter a **specific reason from a controlled list** (reason codes) before opening a record flagged as sensitive; the interaction is a security interstitial, not a silent bypass | [LinkedIn: Epic's "Break the Glass" with Clinical Context](https://www.linkedin.com/pulse/risk-reducing-pair-epics-break-glass-clinical-context-jared-barrett); [CMU HIPAA guidance on Epic BTG](https://www.cmich.edu/docs/default-source/presidents-division/general-counsel/hipaa/hipaa-guidance-btg.pdf?sfvrsn=f1820735_4) |
| An audit-trail entry is written and an **In Basket message is sent to the compliance office at the moment of the access**, so review happens close to real time, not on a lagging batch report | CMU HIPAA guidance on Epic BTG (same) |
| Minimum audit fields: who initiated the override, timestamp, what was accessed, what was done, and the stated reason; an optional free-text explanation field | same |
| Regulatory framing: HIPAA §164.312(a)(2)(ii) requires an emergency-access procedure; NIST SP 800-53 reinforces that emergency access must be **governed, not improvised** — logged, reviewed, and time-bounded, scoped to minimum-necessary access, with incident reports typically expected **within 24–48 hours** of the access | [Censinet: Break-Glass Access Pros and Cons](https://censinet.com/perspectives/break-glass-access-pros-and-cons-for-healthcare); [Yale HIPAA break-glass procedure](https://hipaa.yale.edu/security/break-glass-procedure-granting-emergency-access-critical-ephi-systems) |
| Misuse deterrence is entirely audit-and-consequence based, not technical prevention — the system *lets* the override happen (that's the point of BTG: never block genuine emergencies) and relies on the compliance review catching unjustified use after the fact | Synthesized across the Epic/HIPAA sources above; this is the field's consensus design philosophy, not a single citation |

### C3. Recommendation for the house

- **Owner-only, reason required, no technical prevention of the override itself** — exactly Epic's model: the point of break-glass is that it always works for a genuine owner in a genuine emergency; the control is 100% in the audit and notification, never in blocking the action.
- **Notify all owners at the moment of use**, not on a digest — Epic's "In Basket message at time of access" and Entra's "any sign-in triggers an immediate alert" both converge on real-time notification as the actual deterrent and the actual safety net (an owner who didn't initiate it can react in minutes, not after a monthly report).
- **Mark it red/flagged in the audit trail** distinctly from a normal single-approval action, with fields: who, when, what was overridden, the stated reason (free text is fine at Mudavym's scale — a reason-code taxonomy is an Epic-scale-compliance artifact Mudavym doesn't need yet).
- **Review within a stated N days** (healthcare precedent clusters around 24–48 hours for the incident-report step, with periodic broader audit-log review on top) — pick a number and put it in the ADR; don't leave "reviewed" undefined.
- Do not model this on AWS/Entra's "separate emergency identity, safe-split credential" pattern — that solves a different problem (primary auth is down) and would be over-engineering for "an owner needs to push past a limit right now."

---

## D. Delegated authority

### D1. What Ramp, Brex, Mercury, Rippling actually document

| Platform | Scope/limit mechanism | Self-approval prevention | Revocation / expiry | Evidence |
|---|---|---|---|---|
| Ramp | Amount- and role-based approval routing; **approval groups/owners** can be assigned to policies instead of individuals, so coverage survives absence | "Separation of Duties" feature explicitly blocks admins from self-approving their own spend | Not documented as time-boxed in what was retrievable — routing is role/group-based, so removing a person from a role/group is the revocation path | [support.ramp.com: spend request approvals](https://support.ramp.com/hc/en-us/articles/20843280013459-Setting-up-spend-request-approvals) |
| Brex | Approval chains configured per policy rule ("require review from X$ and above"); separate **approval-chain-for-limit-increase-requests** lets an admin designate who approves a spend-limit bump | Guardrail blocks a requester from approving their own expense request, active whenever 2+ admins exist on the account | Not documented as time-boxed; access model is role-based (User-management admin vs full admin), so revocation = role change | [brex.com/support/approval-chains](https://www.brex.com/support/approval-chains) |
| Mercury | Payment-approval **rules keyed on amount thresholds**, e.g. "wires over $5,000 need two admins"; distinguishes drafting (can prepare) from executing (can send) authority | Implied by "two separate admins" dual-approval requirement for higher amounts; not explicitly framed as anti-self-approval | Not documented as time-boxed in retrievable sources | [support.mercury.com: Navigating approvals](https://support.mercury.com/hc/en-us/articles/28776049990548-Navigating-approvals) |
| Rippling | **Ad hoc approver selection** lets someone add a specific person as an extra approval step on one transaction; standing **approval chains** route by employee attributes (tenure, department, manager) and re-route automatically if the primary approver is unavailable | Not explicitly documented in retrievable sources | Attribute-driven (leaves when the person's role/attribute changes) rather than an explicit grant-with-expiry | [rippling.com/permissions](https://www.rippling.com/permissions) |

**Pattern across all four**: none of them ship a first-class "grant this specific person approval authority up to $X, expiring on date Y" object. What they ship instead is **role/group-based routing** (assign a person to an approval group or a spend-limit tier) plus, separately, **self-approval blocking** as an account-wide toggle. The founder's "a person the owner authorized" idea — a scoped, expiring, individually-granted authority with a visible "granted by" — is **more explicit and more auditable than any of these four platforms' documented primitives**; it isn't a lesser version of an industry-standard feature, it's closer to the "maker-checker" / four-eyes principle used in banking generally, formalized as a first-class object rather than left implicit in role assignment.

### D2. The general banking control this maps to

| Claim | Evidence |
|---|---|
| "Maker-checker" (a.k.a. dual control / four-eyes): one person prepares/initiates (maker), a **different** person reviews and approves (checker); the core purpose is to make sure no single individual can execute a sensitive operation unilaterally | [Wikipedia: Maker-checker](https://en.wikipedia.org/wiki/Maker-checker); [ProcessMaker: dual approval in banking](https://www.processmaker.com/blog/what-is-dual-approval-in-banking/) |
| Dual control specifically requires **two different users** to initiate and approve outgoing payments or authorization changes — the "different user" requirement is what prevents self-approval structurally, not just by policy toggle | [City National Bank: Why Dual Approval Matters](https://www.cnb.com/business-banking/insights/what-is-dual-approval.html) |

### D3. Recommendation for the house

- Model `authorized personnel` as a first-class **grant** row: `{grantor_owner_id, grantee_id, scope (which action types), limit (amount/frequency if applicable), expiry, created_at, revoked_at|null}` — more explicit than any of Ramp/Brex/Mercury/Rippling's documented models, which is appropriate given Mudavym is a single-tenant-per-restaurant tool where "who can act like an owner" needs to be legible to the owner, not buried in a role taxonomy built for 50-person finance teams.
- **Structural self-approval prevention, not a policy toggle**: the grantor and the approver on any given action must be different `actor_id`s at the database level (mirroring dual-control's "two different users" requirement) — this also means an owner cannot use a self-issued grant to approve their own action twice, closing the loophole a toggle-based system (Ramp's "Separation of Duties" is opt-in) leaves open by default.
- **Expiry is enforced server-side at check time**, not just displayed in the UI — a grant past its expiry must fail the authority check the same way a missing grant does.
- **"Granted by" is visible everywhere the grant's authority is exercised** — on the apply screen, in the audit row, and in the owner's list of active grants — since none of the four SaaS platforms researched surface this as prominently as a restaurant owner delegating to, say, a GM would need.
- Revocation should be a single action available to any owner (not just the original grantor) — an owner-only system where only the original grantor can revoke would create the exact single-point-of-failure the founder's "every owner notified" principle elsewhere in this design is trying to avoid.

---

## E. Speed on the floor

### E1. What's actually measured vs. what's just "should be fast"

| Claim | Measured? | Evidence |
|---|---|---|
| FIDO Alliance's Passkey Index (real production data from Amazon, Google, Microsoft, PayPal, Target, TikTok, etc., over 1–3 years of deployment): passkey sign-in averages **8.5s** vs **31.2s** for other methods (email/SMS/social); 93% success rate vs 63% | Yes — real-world aggregate, not a lab study | [fidoalliance.org: Passkey Index launch](https://fidoalliance.org/fido-alliance-launches-passkey-index-revealing-significant-passkey-uptake-and-business-benefits/), underlying PDF: [FIDO Passkey Index October 2025](https://fidoalliance.org/wp-content/uploads/2025/10/FIDO-Passkey-Index-October-2025.pdf) |
| A separately-reported figure from the same body of FIDO World Passkey Day research: 13.6s vs 27.5s — **the exact number varies by which study/cohort is cited; treat "8.5s" and "13.6s" as the same order-of-magnitude finding (passkeys roughly 2–3x faster), not a single precise constant** | Yes, but inconsistent across secondary write-ups | Cross-referenced search aggregation; only the FIDO Alliance PDF above is the primary source — secondary blog posts ("shattered.io," "tech-insider.org") repackage it with varying numbers and were **not treated as independent evidence** |
| Cryptographic-layer WebAuthn operations (`GetAssertion`) on hardware/platform authenticators resolve in roughly 5–25ms; a full registration ceremony including business logic and network round-trip is realistically 500–1000ms | Partially — hardware-level numbers are well-established; the "500-1000ms full ceremony" figure comes from an aggregated engineering blog, not a formal benchmark paper | Search-aggregated (Corbado passkey performance testing and related sources); **lower-confidence than the FIDO Alliance figures above** |
| Toast POS requires a manager's PIN/permission to void or comp once the "same-day-only" void permission is stripped from a server role — confirmed mechanism, **no published timing figure for how long that takes on the floor** | Mechanism yes, timing no | [support.toasttab.com: Voiding Items, Payments, and Checks](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks) |
| Apple Pay in-store: a **double-click of the side button** captures intent as a Secure-Enclave-linked physical gesture ("resistant to forgery by a malicious process"), separate from and prior to the Face ID/Touch ID identity check | Mechanism yes, no published millisecond figure — Apple describes it as designed to keep payment "accessible in seconds," not with an exact number | [support.apple.com/guide/security/uses-for-face-id-and-touch-id](https://support.apple.com/guide/security/uses-for-face-id-and-touch-id-secc5227ff3c/1/web) |

### E2. Design rules that keep ceremonies fast (evidence-derived, not invented)

1. **One prompt, not a chain.** Apple's own HIG explicitly discourages an app-level confirmation after a successful biometric result — "just assume the user wants to use it." Every extra screen between hold-release and completion is a rule violation of the platform's own design guidance, not just a UX nicety.
2. **The reason field belongs only on the rare, deliberately-friction-full path.** Epic's BTG puts the reason-entry step *only* on the override path (accessing a flagged record), never on routine chart access — the friction is reserved for the ceremony that's supposed to be rare (break-glass), never layered onto the ceremony that's supposed to be routine (the seal). This directly supports the founder's rule that the reason field is break-glass-only.
3. **A single valid authority should clear in one step.** Both GitHub's sudo mode and the passkey data above show that when the *right* credential is presented, the ceremony resolves in one round-trip (one biometric prompt, one PIN entry) — multi-step chains appear in these precedents only when the *first* method fails or isn't available (e.g., "if you don't have a passkey, use a security key; if not that, a TOTP code"), i.e., chains are a fallback ladder, not the happy path. This matches the founder's "one approval suffices when authority is valid" rule almost exactly, just at the authentication layer instead of the approval layer.
4. **Physical gesture for intent, biometric for identity, never both doing the same job.** The Apple Pay double-click / Face ID split (§B5) is the cleanest shipped precedent for exactly the hold-then-biometric composition Mudavym is building — copy the division of labor, not just the visual.
5. **Real-world passkey data (8.5–13.6s) already beats restaurant-floor tolerance for "a few seconds," but the number that matters is the ceremony's own step count, not raw milliseconds** — the FIDO data's 2–3x speed advantage over passwords/SMS comes specifically from eliminating steps (no typing, no waiting for a code to arrive), which is the same lever the founder is pulling by going biometric-first on the seal.

---

## Decisions this raises for the founder

1. **Where does "time of last step-up" live?** Supabase's JWT has no `auth_time` equivalent — Mudavym must persist the newest step-up-qualifying `amr` timestamp itself, keyed to `session_id`. Should this live in a new `security_events` table the break-glass and delegated-authority audits also write to (one ledger), or should each ceremony keep its own table?
2. **Is TOTP the launch step-up factor, with passkey-as-MFA added later?** Supabase's WebAuthn-as-second-factor path is unstable/undocumented across SDKs today (§A2); TOTP is the only fully documented option. Does the founder want to ship the 2-hour gate on TOTP now, or hold the whole step-up ceremony until passkey-MFA is a supported Supabase contract?
3. **What's the review SLA for a break-glass use?** Healthcare precedent clusters around a 24–48 hour incident-report window plus periodic audit-log review (§C2–C3). Does the founder want a specific N-day number written into the ADR, and who is the reviewer if all owners were merely *notified*, not asked to sign off?
4. **Can a grant's original grantor revoke it exclusively, or can any owner revoke any grant?** §D3 recommends any-owner revocation to avoid a single point of failure, but that's a policy call the founder hasn't made — does authorized-personnel revocation require the original grantor, or does owner-parity apply here too?
5. **Does the mobile app ship a real WebAuthn library (react-native-passkeys or equivalent) at seal launch, or does mobile launch later than web?** `expo-local-authentication` alone cannot produce a server-verifiable assertion (§B4) — using it for the seal would silently fail to prove WHO. Is a slower, staged mobile rollout acceptable, or does the seal need to be simultaneous across web and mobile from day one?
6. **Does the break-glass audit distinguish "reviewed, justified" from "reviewed, cause for concern" in a way visible to all owners**, or does "every security change is told to the owners" stop at the initial notification? Epic's compliance-office review is a closed loop the requester doesn't see the outcome of; the founder's "told to the owners" principle suggests Mudavym might want the *outcome* of the review told too, not just the event.

---

## Could not verify

- **W3C WebAuthn §13 (Security Considerations) full normative text on challenge entropy/randomness floors.** Repeated fetches of `w3c.github.io/webauthn` and `w3c.org/TR/webauthn-3` truncated before reaching §13.4; the "hash structured transaction data into the challenge" pattern is corroborated by SPC's design and third-party engineering write-ups (§B3) but I did not get the primary spec's own entropy-requirement wording in hand. Recommend a direct read of §13.4.3 "Cryptographic Challenges" before finalizing the seal's challenge-construction code.
- **Exact GA/beta status of WebAuthn-as-MFA-second-factor in Supabase's Swift SDK** (`mfa.enrollWebAuthnFactor`, gated behind `@_spi(Experimental)`) — found via search snippet only, not confirmed by directly reading `supabase.com/docs/reference/swift/auth-mfa-api`.
- **Whether `supabase/auth`'s backend WebAuthn-factor code (per the DeepWiki summary) is reachable via any documented REST/Admin API today**, or is purely internal scaffolding for the eventual JS/Dart/Swift SDK surface. DeepWiki is an AI-generated wiki of the source, not an official Supabase source, and this claim rests on it alone.
- **Precise seconds for a Toast POS manager-PIN void/comp override on the floor.** Toast's own docs confirm the permission mechanism but publish no timing figure; no independent timing study was found.
- **Precise milliseconds for the Apple Pay double-click-to-Face-ID-confirm sequence.** Apple's documentation confirms the design and intent but does not publish a duration; "accessible in seconds" is the only official phrasing found.
- **Current (September 2026) status of standalone-PWA behavior in the EU under the Digital Markets Act.** Apple's EU PWA policy changed at least once in 2024 under regulatory pressure; I could not confirm the live 2026 state for an EU-region Mudavym tenant, and this matters for whether an EU restaurant's installed web-app seal behaves like the US/global case described in §B4.
- **A single authoritative number for FIDO Alliance passkey sign-in speed.** Primary source (FIDO Passkey Index PDF, Oct 2025) supports the 8.5s/31.2s figures; other secondary sites cite 13.6s/27.5s or 3s-vs-69s from what appears to be the same underlying research program — the order of magnitude (2–3x faster) is solid, the exact constant is not.
- **Whether Ramp, Brex, Mercury, or Rippling support a genuinely time-boxed (auto-expiring) individual approval grant** anywhere in their product, as opposed to the role/group-based routing documented in the pages retrieved. Their public help-center content did not surface such a feature; it may exist deeper in enterprise-tier documentation not reached by this research pass.
