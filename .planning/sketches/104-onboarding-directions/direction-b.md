# Direction B — The interview

**The idea, in one sentence.** The arrival is one conversation whose every sentence lands beside it as rows carrying a reason and a provenance (typed · spoken · inferred · confirmed · defaulted · skipped · not yet answered · cannot be recorded), and one seal applies those rows item by item — nothing the platform inferred is written before the seal, and a skip is a row too.

## What the flow asks, in order

1. **The door** (`/register`): invited, or opening a house. Invited: the eight-character code resolves to "Hasan is expecting you at Lokanta Meyhane — as a manager" before any account exists, then name, email, password. Opening: house and person; where it is; what money it reports in, stated as a default in words ("Defaulted from Türkiye. We will record TRY. Change it if that is wrong.") with "Not yet" a real answer. No wax: the account is a record.
2. **The letter** (`/verify-email`): the interview waits, and says what is on the server (account, house, TRY) and what is not (everything it will ask).
3. **The interview** (`/get-started`, replaced): the assistant reads what the house exposes and names every source; the first evidence is the menu photo; then "What does this house pour?" (inferred, then confirmed by voice); "Whom do you buy from?" and each vendor's terms, one skipped; the nine producers, defaults kept, offered; the low-stock line; the consent question for a person's own mailbox, in its own 620px panel.
4. **The seal**: hold to apply; the receipt names each row — written · refused · recorded · not attempted · not offered — and the date the seven-day undo window ends (ADR 0113 rule 4a).
5. **A joiner** arrives to the house as the owner left it, with what is still open ("offered 6 September, skipped" is a different sentence from "never asked"), and may answer.

## What each answer writes, through which route

- Invite resolution: `GET /auth/invite/:code` (auth.controller.ts:405, public; Register.tsx:192-213). Join: `POST /auth/join` (auth.controller.ts:435; Register.tsx:531-532, no letter for a joiner).
- Account, house, address with its point, currency when answered: `POST /auth/register/restaurant` (auth.controller.ts:390); currency sent only when answered (Register.tsx:985-990); the sentence is CurrencyStep.tsx:51-57; a later answer goes through `PUT /settings/currency` (settings.controller.ts:227; house-currency.service.ts:39-44).
- The letter: `POST /auth/verify-email` (VerifyEmail.tsx:31-34); `POST /auth/resend-verification` (VerifyEmail.tsx:62, once a minute :55-59).
- The menu photo: `POST /menus/import`, scan (GetStarted.tsx:371-378, 406); registers inferred from the house's own books (cellar-registers.service.ts:19-36; ADR 0108).
- What we pour: `PUT /cellar/:rid/registers` (cellar.controller.ts:115), `registers[{id, carried}]` with one `source` per write (cellar-registers.dto.ts:16-61) — confirmed answers in one PUT, unconfirmed inferences in a second with `source: inferred`, so the readout keeps calling them guesses.
- Vendors and terms: `POST /providers` (providers.controller.ts:201), then `PUT /vendor-terms/:providerId` (vendor-terms.controller.ts:71; vendor-terms.dto.ts:26-84) — days, cutoff, minimum, lead time, payment terms; an unmentioned column stays NULL (ADR 0116).
- What we hear about: `PATCH /notifications/preferences` (notifications.controller.ts:237-258) — channels, five families, quiet hours; per user, not per house.
- The low-stock line: `PATCH /onboarding/threshold` (menus.controller.ts:91; menus.ts:132-138).
- The skip and the kept default: one `system_audit_log` row, `configuration_step_skipped`, `changes: {register, subject, offered, answered: []}`, no setting changed (ADR 0113 :340-343).
- The seal: the hold as built (HoldToApprove.tsx:1-20) — pour, linear, 620ms; tuck on an early release with "Released at N% — nothing written"; stamp on landing. Apply is never exposed as a tool; the seal in a first-party client is its only caller (ADR 0113 rule 5).

## Two roads not taken inside B

- **One register at a time, each with its own seal** (ADR 0113 option B). A sentence like "Anadolu — Tuesdays and Fridays, thirty days to pay" moves three registers at once, which fourteen questions cannot compress; six ceremonies devalue the wax; and a transcript without the rows beside it hides provenance. The rows are the product; the talk is how they arrive.
- **The assistant before the account exists.** Rule 6 reads a house, and there is no house to read at `/register`; so the door keeps the interview's voice but is typed only, and the assistant begins the moment there is something to read. Voice-first was declined for the same reason sketch 101 drew typing: it is the harder case on a page of registers, and it waits on no open decision.

## Honest gaps (each one is drawn on the screen in mono)

- `config.propose_batch` is not built (ADR 0113 rule 5); `SettingsAuditService.record` never sets `correlation_id` or `reason` (settings-audit.service.ts:205-221); the ask-ai allowlist has two families, procurement and communications (ask-ai-actions.ts:32) — a configuration family is a founder decision.
- `configuration_step_skipped` is not in `SETTINGS_AUDIT_ACTIONS` (settings-audit.service.ts:86-104). One constant, no migration.
- Producers cannot be held one by one: the route carries five families (notifications.dto.ts:193-217) and is keyed on the user. Told, not offered.
- A vendor's usual currency has no field on `SetVendorTermsDto` (vendor-terms.dto.ts:26-84). Told, not offered; each invoice keeps its own.
- Voice: the speech provider and whether a spoken setup is a record are open (ADR 0113 Q6, Q7). The microphone is drawn, not built.
- The market price drop is a deployment env var (market-price.producer.ts:95-97). Named, not offered.
- Mailbox consent as an onboarding step is not built; the table exists (20260903151000_the_house_declares_a_person_consents.sql; ADR 0114 §2).
- Not asked, and drawn as such: Google sign-up (direction D's road); the time zone, read from the browser and never asked (Register.tsx:984); the approval ceiling, held back until the role gate of rule 2 exists.
- Verification: rendered in the Browser pane from `file://` on both grounds; tokens, emoji and structure checked by grep. No file under `apps/` was changed.

**Motion, named from the house tokens.** settle 320ms cubic-bezier(.16,1,.3,1) as rows arrive · ink 160ms on hover and focus · tuck spring ~300ms when the hold is released early · turn 420ms cubic-bezier(.32,.72,0,1) as the receipt comes in · pour linear 620ms as the hold fills · stamp spring ~360ms as the wax lands · tally overdamped spring 840ms as the count settles. `prefers-reduced-motion: reduce` collapses every one to its end state and the hold to a two-step confirm.
