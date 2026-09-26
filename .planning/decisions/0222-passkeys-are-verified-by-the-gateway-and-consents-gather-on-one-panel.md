# 0222 — Passkeys are verified by the gateway, and consents gather on one panel

- **Status:** Proposed — the founder answered WHAT on 2026-09-21 (round 6r, below) and again on 2026-09-25 (item 29, below: forks 1-4 answered, the consent panel accepted as built); this record is the HOW. The sign-in half is [[0229-a-passkey-or-an-emailed-code-signs-you-in-and-a-recent-sign-in-guards-enrolment]]
- **Date:** 2026-09-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** passkey, WebAuthn, FIDO2, simplewebauthn, rp id, mudavym.com, attestation, user verification, challenge, re-authentication, recovery, consent panel, ask-training, Jev, fork 14, SC 3.3.8, /profile, /settings
- **Links:** [[0229-a-passkey-or-an-emailed-code-signs-you-in-and-a-recent-sign-in-guards-enrolment]] (sign-in, emailed codes, the ten-minute rule), ADR 0134 (`0134-one-motion-per-act-across-every-page.md`) §7 and fork 14 (on PR #433's branch `feat/motion-rules-locked`, not main), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] row 14 (superseded in part), [[0145-mudavym-answers-out-of-a-reading]] (the ask-training opt-out), ADR 0207 (Jev acceptance, PR #435), ADR 0112 F11 (the manager passcode, unbuilt), PR for branch `feat/profile-passkeys-consent`

## Context

Two build items the founder answered on 2026-09-21 (round 6r) had no lane
(census CRITIC §G6). His picks, verbatim:

> Passkey + paste (Recommended)

> Bring back, real switches (Recommended)

ADR 0134 (`feat/motion-rules-locked`, "Round 6 answers", items 2 and 3)
records what each meant. **Passkey:** WebAuthn; per user (never per house,
never per device); owner and manager only; a peer path beside the manager
passcode, neither replacing the other; enrolment and revocation on `/profile`;
audited — who enrolled or revoked which credential and when, and each use at a
point of action. **Consent panel:** opened from the rebuilt `/settings`; holds
only switches the product reads (the per-house ask-training opt-out, Jev
scoring, any legacy consent once something reads it); owner only; every flip
audited. That supersedes ADR 0149 row 14 ("delete the consent panel") for
switches the product reads.

Measured before building (2026-09-25, `origin/main` `4e7c5b5a6`):

- `/profile` drew passkeys as `Not built` (`SecurityRegister.tsx:233-237`);
  zero `webauthn`/`passkey` code in `apps/` or `supabase/`.
- **This product does not sign in through Supabase Auth.** The gateway checks
  bcrypt hashes on `public.users` and signs its own JWT
  (`auth.service.ts` `validateUser`, `generateTokens`: 15-minute access token,
  7-day refresh). `auth.users` and `public.users` are disjoint.
- The ask-training opt-out is on main (PR #430 merged 2026-09-23):
  `ask_training_opt_outs`, `PUT /settings/ask-training`, owner only, audited
  `ask_training_opt_out_changed`, drawn by `AskTrainingSection.tsx`.
- The Jev switch is **not** on main: the owner's acceptance that turns it on
  is ADR 0207's, on PR #435 (open). Nothing on main reads a Jev switch.
- The manager passcode a passkey is the peer of (ADR 0112 F11) is unbuilt:
  `git grep -i passcode` under `apps/` and `supabase/` finds no such field.

**[2026-09-25, the founder, round 5 item 29 (confirmed reading; memory
`founder-answers-2026-09-25-web-rebuild.md`):** "passkey (Face ID/Touch ID)
IS a sign-in method; logged-out with no passkey → emailed one-time code;
enrolling while signed in: signed in within last 10 min = direct, else email
code first. Consent panel accepted as built (own store per switch, managers
see disabled, in-app notice only)." This supersedes the "type your current
password" proof below and ADR 0134 §7's action-only reading of a passkey.
The HOW of the new half — the discoverable sign-in ceremony, the emailed
code's rules, the `auth_time` claim — is ADR 0229; this record keeps
enrolment, storage and the consent panel.]**

## Options considered — passkeys

Research branches (each checked, not assumed):

1. **Supabase Auth's own passkeys / WebAuthn MFA factor.** Supabase now ships
   passkeys (experimental, supabase-js ≥ 2.105) and WebAuthn as an MFA factor
   ([docs](https://supabase.com/docs/guides/auth/passkeys),
   [MFA](https://supabase.com/docs/guides/platform/multi-factor-authentication)).
   **Rejected:** both hang off `auth.users` and a Supabase session. Nobody
   signs in with one here; a factor enrolled there would protect an identity
   the product never checks, and wiring it in means migrating sign-in —
   a different, much larger decision.
2. **Verify in the gateway with `@simplewebauthn/server`** (chosen). The
   de-facto WebAuthn library for Node (CJS build, Node ≥ 20 — the gateway's
   Dockerfile and CI use Node 20). v14.0.3 is past the only published advisory
   (GHSA-6hxq-p678-4hr2, low, ≤ 13.3.1, attestation trust-anchor chaining —
   and this build asks for no attestation at all). `@simplewebauthn/browser`
   14.0.0 is its matched client.
3. **Hand-written verification** (CBOR, COSE, signature checks). Rejected:
   rolling authentication crypto by hand is the classic way to ship a bypass;
   nothing here justifies it.
4. **A hosted passkey service** (Hanko, Corbado, Auth0, etc.). Rejected: a new
   subprocessor for a credential store, an outside dependency on the approval
   path, and a second identity system beside the gateway's.
5. **Do nothing** — keep `Not built`. Costs the founder's answer.

### The HOW, as built on the chosen option

| Choice | As built | Why | Rejected alternative |
|---|---|---|---|
| RP ID | `mudavym.com` for `https://mudavym.com` and every `https://*.mudavym.com`; `localhost` outside production; anything else refused (`relying-party.ts`) | One RP ID for apex and subdomains, so a passkey made on `www.` works on the apex. A passkey made on a `*.vercel.app` preview is bound to that throwaway host and useless tomorrow, so the ceremony is refused with that sentence | Per-host RP IDs (credentials would split across hosts); allowing previews (dead credentials) |
| Override | `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGINS`, both required | A deployment on another domain is possible without a code change | A single env var (an RP ID with no origin list would accept any origin) |
| Attestation | `none` | Nothing here restricts authenticator models; asking for attestation collects device data for no use | `direct` (privacy cost, and the one advisory lives there) |
| User verification | `required` on enrol and on use | A passkey is the peer of a passcode (something you know); UV makes it possession plus biometric/PIN on its own | `preferred` (a tap on a stolen key would pass) |
| Resident key | `preferred` | Passkeys are discoverable; some security keys have few slots | `required` (refuses older keys) |
| Algorithms | ES256, RS256 | Covers platform authenticators and Windows Hello | Library default list (includes EdDSA etc.; harmless, but nothing needs it) |
| Challenge | Row in `webauthn_challenges`, deleted as it is read (single use), five-minute expiry, bound to the exact origin and RP ID it began on, one per person per kind | The gateway can run as several instances; a signed stateless token could be replayed within its lifetime | In-memory map (breaks across instances); signed JWT challenge (replayable) |
| Counter | Stored; a counter that goes backwards is refused (the library's check) | Detects a cloned authenticator where counters are used | Ignoring counters |
| Store | `user_passkeys`, per `public.users.user_id`, public key + counter + transports + device type + backup flag + aaguid + rp id + nickname; revoked rows kept with `revoked_at` | Per user, as ruled; a revoked credential stays on the record and its id can never be re-enrolled | Hard delete (the record would forget it existed) |
| Who may enrol / check | Owner or manager **in the token's house** (`resolveRestaurantRole`) | As ruled | The token's role snapshot |
| Proof before enrolment | **[2026-09-25, item 29:** a sign-in in the last ten minutes (the token's `auth_time`, ADR 0229), else a six-digit code emailed to the account's own address, checked at `registration/options` before any challenge exists; stale → 403 `STEP_UP_REQUIRED`. Works for a Google-only account.**]** | His rule | The typed password (built first; superseded — it refused Google-only accounts); a per-user "last signed in" column (a stolen token would borrow another device's fresh sign-in) |
| Who may list / revoke | The person, always | Someone demoted must still see and remove what they enrolled | Gating revoke by role (strands credentials) |
| Audit | `system_audit_log`: `passkey_enrolled`, `passkey_revoked`, `passkey_checked`, `actor_id` = `public.users.user_id`, `restaurant_id` = the token's house; receipt returned (`audited`, `auditReason`) | As ruled; a failed audit row is visible, never assumed | Throwing on a failed audit (would undo a change the person saw take effect) |
| Notice | In-app notification on enrol and on removal | The standard tripwire for a credential added behind your back | Email (not built for this; see forks) |
| Refused proof | 403, never 401 | The web client refreshes and retries on 401, which would turn a missing or wrong proof into a silent second try | 401 |
| "Check a passkey" | `POST /passkeys/check/*` verifies an assertion, advances the counter, stamps `last_used_at`, audits `passkey_checked` — and **grants nothing** | The point of action (F11) is unbuilt; this is the same verification it will call, proven now | Leaving verification unbuilt until F11 (untested code on the approval path) |

Recovery: a passkey is a **peer** path, never the only one — password and Google
sign-in stay, **[2026-09-25: and the emailed one-time code, ADR 0229]**. Losing a
device means signing in another way and removing the passkey on `/profile`. No
recovery codes are needed while that holds.

## Options considered — the consent panel

1. **A sheet opened from `/settings` that gathers the real switches** (chosen).
   Each switch keeps the store its reader already reads; the panel renders the
   switch's own component (`AskTrainingSection`, not a copy) and that switch's
   trail from `GET /settings-audit?register=<its register>`. On main it holds
   one switch; Jev joins as one entry in `CONSENT_SWITCHES` when ADR 0207's
   store lands.
2. **One `house_consents` table for every switch.** Not built: it would be a
   second store beside `ask_training_opt_outs` (which the training export
   already reads) — see fork 3.
3. **Move the ask-training switch off the page into the panel only.** Not
   done: its section, heading and anchor are the switch's existing home; the
   panel mounts the same component, so the two cannot disagree.
4. **Keep row 14's deletion.** Contradicts the founder's 2026-09-21 pick.

Opened from the "Questions and training" section, not from Services &
permissions: with `/connections` live for every house (ADR 0149 row 36),
`/settings` no longer renders the Services section at all.

## Decision

Passkeys are enrolled, listed, removed and checked through a gateway module
(`apps/api-gateway/src/passkeys/`) verified by `@simplewebauthn/server` 14,
stored per user in `user_passkeys` with single-use challenges in
`webauthn_challenges` (migration `20260926210000`), drawn on `/profile` by
`PasskeyRows.tsx`. The consent panel is `ConsentPanel.tsx`, a sheet opened from
`/settings` that holds only switches the product reads — on main, the training
opt-out — each with its own audited trail.

## Open forks (the founder's; reported, not locked)

1. **[ANSWERED 2026-09-25, item 29: "signed in within last 10 min = direct,
   else email code first" — built, ADR 0229; the password proof is gone.]**
   **What proves it is you before a passkey is added.** As built: the account
   password, typed now; an account without a password is refused and told to
   set one. That stops a borrowed 15-minute token from planting a lasting
   credential, but a Google-only owner must set a password first. Paths:
   (a) as built; (b) the signed-in session alone plus the in-app notice —
   simplest, weakest; (c) a fresh sign-in within N minutes, which needs an
   `auth_time` claim kept across refresh (touches `generateTokens`, shared with
   the sessions lane). **Recommendation: (a) now, (c) when F11 lands.**
2. **[ANSWERED 2026-09-25, item 29: yes — "passkey (Face ID/Touch ID) IS a
   sign-in method"; built on `/login`, ADR 0229.]** **Should a passkey ever be
   a sign-in method?** ADR 0134 recorded it as a
   point-of-action peer of the passcode only. Not built; the old row's subtitle
   ("Sign in with the device you are already holding") was dropped for that
   reason.
3. **[ANSWERED 2026-09-25, item 29: "own store per switch" — as built.]**
   **Where consent switches persist.** Never asked (round 6y, `founder-answers`
   memory: "Fork-14 store question NOT asked"). As built: each switch keeps its
   own store and the panel gathers them. Alternative: one `house_consents`
   table, versioned, with a migration of `ask_training_opt_outs` into it.
   **Recommendation: keep per-switch stores** — each has one reader and one
   owner already.
4. **[ANSWERED 2026-09-25, item 29: "managers see disabled" — as built.]**
   **"Owner only" reach.** As built, managers can open the panel and see every
   switch disabled with the sentence "Only the house's owner can change this."
   The other reading — the panel hidden from managers — is one line to change.
5. **[2026-09-25: "in-app notice only" was accepted for the consent panel.
   For passkeys it is still open, and sharper now that a passkey signs in —
   ADR 0229 fork 1 (a passkey outlives a password reset).]** **Email on
   enrolment.** Only an in-app notice is sent. An email copy is the
   usual tripwire when the account itself is taken over; not built.

## Consequences

- `/profile` stops saying passkeys are `Not built`; two-factor codes, API tokens
  and other-device sessions still are.
- **[2026-09-25]** A passkey signs you in (ADR 0229); `/profile` says so, and
  that it still approves nothing.
- F11 (the manager passcode) inherits a tested `finishCheck` to call as its
  passkey path; until then a passkey approves nothing, and the page says so.
- The gateway gains one dependency tree (`@simplewebauthn/server` →
  `@peculiar/*`, `@hexagon/base64`, `@levischuck/tiny-cbor`); the web gains
  `@simplewebauthn/browser` (no dependencies).
- Passkeys cannot be enrolled on Vercel previews — by design.
- Revisit when: F11 lands (fork 1, and the point-of-action audit line); PR #435
  merges (add the Jev entry to `CONSENT_SWITCHES`); a second domain serves the
  web (set the override); a published advisory touches the pinned range.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | lane W2-profile (agent) | Created, Proposed. Gateway spec 30/30 against a software authenticator (real ES256 signatures, CBOR `none` attestation); five mutations of the service's checks each went red |
| 2026-09-25 | lane W3-passkeys (agent) | Founder's item 29 recorded; forks 1-4 bracketed answered; the password proof replaced by ADR 0229's ten-minute rule. `passkeys.service.spec.ts` now 28/28 (the two password cases removed; the proof's cases moved to `passkeys.sign-in.spec.ts`). Status stays Proposed: the HOW is still an agent's |
