# Direction D — The invitation

**Idea.** The house is resolved before the account exists: whoever was invited arrives already inside it, with everything the house has said about itself in view; whoever was not invited is founding a house and presses the seal once.

## What the flow asks, in order

1. **The door** (`/register`): one question, "Who is expecting you?" — an 8-character code, or "No invitation, I am founding a house". Resolves 400 ms after the eighth character (`Register.tsx:191-213`); `?invite=CODE` pre-fills (`:177-188`); `/invite/:code` lands resolved (`InviteLanding.tsx:31-48`). Empty reads "not yet resolved" in ink-3.
2. **The invitation resolved** (`/invite/:code`): "Hasan is expecting you at Lokanta Meyhane — as a manager", then name, email, password, one press. Signed-in visitors get a centred panel (620): "Add Lokanta Meyhane to your houses?" (ADR 0112).
3. **The joiner's arrival** (`/`): the house comes up as if signed in — answered registers as record with provenance, unanswered ones as "not yet answered", the list already in the books; staff get the read-only welcome (`StaffWelcome.tsx:36-79`).
4. **The founding record** (`/register?type=new`): one page, not a rail — who (name, email, password), the house (name, address with its point, cuisine, phone, currency defaulted in words, timezone shown), a read-back sentence, and the seal held once. "What it pours" is deliberately not asked here: a register is read off the house's books (ADR 0108) and the books do not exist yet.
5. **The letter** (`/verify-email`): founders only; the invited are vouched for (`auth.service.ts:1356,1438`).
6. **The owner's arrival** (`/get-started`): first evidence (the list, in any form), then the four registers with state, each in a right sheet (440), each skippable as a recorded fact, and the second act — issue an invitation, which closes the loop to frame 2.
7. **390 px**: frame 2 on a phone — the link opened in the kitchen; no code to type, one press.

## What each answer writes, and through what

| Answer | Route (exists today) |
|---|---|
| The invitation code | `GET /auth/invite/:code` (`auth.controller.ts:405-409`, `@Public`) returns organisation, restaurant, city, **inviter's name**, role (`auth.service.ts:998-1005`); reasons not_found / used / expired (`:993-996`) — drawn as three sentences, where `InviteLanding.tsx:95` collapses them |
| Join (name, email, password) | `POST /auth/join` (`auth.controller.ts:435-441`; `join-via-invite.dto.ts:4-7`) → users(role from invite, `email_verified: true`), user_restaurant_access, organization_members, team_members claim, tokens carrying restaurant_id + role (`auth.service.ts:1358-1500`); an existing account must give its own password (`:1411-1424`) |
| Accept while signed in | `POST /auth/invite/:code/accept` (`auth.controller.ts:357-371`; `auth.service.ts:1253-1330`); 409 already_member handled as success (`InviteLanding.tsx:69-74`) |
| Found the house (seal) | `POST /auth/register/restaurant` (`auth.controller.ts:390-400`; `register-restaurant.dto.ts:13-86`) → organizations, restaurants(currency code or NULL `auth.service.ts:789`, timezone `:775`, point `:753-758`), users(owner, unverified), memberships, progress row (`:724-850`) |
| Currency | in the founding record, sent only when answered (`Register.tsx:985-990`; `CurrencyStep.tsx:51-57,77`); later `PUT /settings/currency`, owner or manager (`settings.controller.ts:227-244`) |
| Verify | `POST /auth/verify-email` (`auth.controller.ts:447-452`; `VerifyEmail.tsx:23-46`); resend one a minute (`:457-466`) |
| What it pours | `PUT /cellar/:restaurantId/registers` {seven answers, `source: 'confirmed'`} (`cellar.controller.ts:115`; `cellar-registers.dto.ts:16-61`; `useCellarNextData.ts:937-943`) |
| Vendor terms | `PUT /vendor-terms/:providerId` (`vendor-terms.controller.ts:71-83`); offered only once a vendor exists; a column default reads as unknown (`vendor-terms.service.ts:45-58`) |
| What rings the phone | `PATCH /notifications/preferences` (`notifications.controller.ts:237`; `notifications.dto.ts:251-285`): channels, five categories, quiet hours, low-stock — per person |
| Invite a manager | `POST /auth/invite` {restaurantId, role, targetEmail?} owner/manager (`auth.controller.ts:414-430`) → code, expires_at, inviteUrl, pending team_members row (`auth.service.ts:1049-1114`) |

**What the preview can and cannot reveal.** Can: organisation, restaurant, city, role, and the inviter's personal name — to anyone holding the link, unauthenticated (`auth.service.ts:987,1003`; `invite-landing.md` §11). Cannot: when it expires (not in the response; `Register.tsx:478` prints "7 days" as a constant — drawn as "not stated"), whether it was addressed to this person (`targetEmail` stored `:1095`, never checked on join), or any tenant fact (currency, address, registers) — those need a session and appear at the arrival. **The inviter's name is a founder fork** (`invite-landing.md` §13 item 4): this direction draws it, because the sentence is the door, and flags it on-screen as the fork.

**Motion.** `settle` 320 ms on the resolved card and the account column; `turn` 420 ms named for the door-to-invitation page turn; `tuck` ~300 ms spring on the sheet; `pour` 620 ms linear on the hold; `stamp` ~360 ms spring when the wax lands; `tally` 840 ms overdamped on the 61 lines; `ink` 160 ms on hover and focus. `prefers-reduced-motion` collapses each to its end state (the hold becomes a press).

## Two roads not taken inside D

- **Bind the invitation to an email and pre-fill the account from it.** Would make "expecting you" literally true and close the pass-the-link exposure, but `targetEmail` is optional and unchecked today and the sharing model is the founder's open call (`invite-landing.md` §13 item 3). Drawn instead: the card says plainly that whoever holds the link gets the role.
- **Ask the owner "what it pours" inside the founding record and carry the answer across the letter.** Rejected: the write needs a tenant and a verified session, so the answer would sit in the browser through `/verify-email` and could be lost; and a register read off nothing is a guess, which ADR 0108 refuses. It is asked from the list, after the seal.

## Honest gaps (what today's endpoints cannot do)

- **Join / found with Google** — drawn in place, unavailable, with the sentence: `POST /auth/join` and `POST /auth/register/restaurant` take a password; `POST /auth/oauth/google` resolves an existing account only and refuses unknown addresses (`auth.service.ts:1611-1656`). Would need a provider token accepted on both routes and a `user_oauth_accounts` row written with the new user. Microsoft is shown greyed with its own reason (`identity-providers.ts:95-96`).
- **The recorded skip** — `system_audit_log` `configuration_step_skipped` {register, offered, answered: []} (ADR 0113; `get-started.md` §13.7) is not written anywhere; "Confirm later" writes nothing (`CellarRegistersOnboarding.tsx:72-79`). Would need one `SettingsAuditService.record` call (`settings-audit.service.ts:202`).
- **Per-producer keep/mute** — `UpdatePreferencesDto` carries channels, five categories, quiet hours and low-stock; no key per producer. The nine are listed by name; the control writes the categories.
- **The assistant** — `config.propose_batch` is proposed, not built (ADR 0113 rule 5); drawn as an offer with nowhere to go.
- **The joiner's progress** — `GET /onboarding/progress` answers 404 for anyone who joined by invitation, because Path A writes no `user_onboarding_progress` row (`auth.service.ts:1358-1500`; `menus.service.ts:654-665`). The arrival is drawn reading the house's registers and books directly, never that row.
- **Expiry in the preview** — the response carries no `expires_at`; showing a date needs one field added to `getInvitePreview`.

Example data only: Lokanta Meyhane (İstanbul, TRY, Hasan, Defne), The Old Mill (Ann Arbor, USD, Marcus). Codes KX7MP4QA and TH8RW3NC are invented. Nothing under `apps/` was changed.
