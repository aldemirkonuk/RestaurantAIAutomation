# Direction C — The house's book

**The idea.** The arrival is the opening of the house's ledger: five ruled pages — Currency · What we pour · Whom we buy from · What we hear about · The assistant — behind a contents page that carries each page's state (ruled off with the double rule when answered, open in ink-3 when not, carried forward with a date when skipped, blocked with the reason) and what it unblocks, never a percentage; pages open in any order and the book remembers between sittings.

## What the flow asks, in what order
1. **The flyleaf** (`/register`): who keeps the book and which house it is. Open a house: keeper + house identity and address, currency deliberately not asked here. Join: the 8-character code resolves to "Defne is expecting you at Lokanta Meyhane — as a manager" before the account exists; Google sign-up drawn unavailable.
2. **The letter** (`/verify-email`): the book is bound and closed until the emailed key opens it. No wax — it is the post.
3. **The contents** (`/get-started` as the book): opening stock (the wine list) first, then the folios in any order — fo. 1 Currency · fo. 2 What we pour · fo. 3 Whom we buy from (blocked until a vendor is written) · fo. 4 What we hear about · fo. 5 The assistant (offered, never required). Ruling a page off is a record, reversible by a correcting entry; the wax lands once, on fo. 5's batch.
4. **The phone frame** (390): fo. 3 for one vendor, written by a manager standing at the phone, one gesture.

## What each answer writes, and through which route (read 2026-09-06 in the worktree)
| Page | Writes | Route, file:line |
|---|---|---|
| Flyleaf, open | keeper + house; currency omitted so the row holds NULL, never USD | `POST /auth/register/restaurant` — `AuthContext.tsx:607`, `auth.controller.ts:390`; `Register.tsx:971-997`, `:985-990` |
| Flyleaf, join | the joiner entered in an existing house | read-back `GET /auth/invite/:code` (`Register.tsx:191-213`, `auth.service.ts:1003`); `POST /auth/join` (`Register.tsx:531-532`, `AuthContext.tsx:633`, `auth.controller.ts:435`); by link `InviteLanding.tsx:39-41`, `:128-139`, accept `:61-63` |
| Letter | verified, then to the contents | `POST /auth/verify-email` (`VerifyEmail.tsx:34`, `:43`); `POST /auth/resend-verification` (`:62`; one minute, `:57`) |
| Opening stock | the wine list read and reviewed | `POST /menus/import` (`menus.ts:83`, `menus.controller.ts:36`); review `GetStarted.tsx:246-254` |
| fo. 1 Currency | reporting currency, confirmed from the stated default or typed; "Not yet" carries forward | `PUT /settings/currency` (`settings.controller.ts:227`, owner or manager `:230`; `house-currency.service.ts:39-44`, body only, never derived); journal `reporting_currency_changed` (`settings-audit.service.ts:97`); default from `GET /settings/currency` `country` (`house-currency.service.ts:81-86`); sentence verbatim `CurrencyStep.tsx:53` |
| fo. 2 What we pour | all seven registers at once, `source:'confirmed'`; a hand-switched one is typed | `PUT /cellar/:restaurantId/registers` (`useCellarNextData.ts:941-942`, `cellar.controller.ts:115-140`, `cellar-registers.dto.ts:16-62`); `confirmed_by/at` on the row (`cellar-registers.service.ts:231-232`); evidence `RegisterEvidenceLine.tsx:27-31`; not re-asked / not asked on a failed read `CellarRegistersOnboarding.tsx:43-50`; no-books sentence `CellarRegistersStep.tsx:95` |
| fo. 3 Whom we buy from | per vendor: delivery days, cutoff, lead time, minimum, payment terms — absent unchanged, explicit null withdraws | `PUT /vendor-terms/:providerId` (`vendor-terms.controller.ts:71-106`; not owner-only `:30-35`; `vendor-terms.dto.ts:15-91`); usual currency `PATCH /providers/:id/usual-currency` (`providers.controller.ts:282-296`); journal `vendor_terms_changed` (`settings-audit.service.ts:87`); a vendor enters by `POST /providers` (`providers.controller.ts:201`) |
| fo. 4 What we hear about | the person's channels, categories, quiet hours; the nine producers kept as they are | `PATCH /notifications/preferences` (`notifications.controller.ts:237-259`; `notifications.dto.ts:176-217`, `:251-289`); journal `notification_preferences_changed` (`settings-audit.service.ts:89`); producers `notifications/producers/*.producer.ts` |
| fo. 5 The assistant | a batch in pencil, one seal, posted item by item through the routes above, receipt per item, seven-day undo | `config.propose_batch` — **not built** (ADR 0113 rule 5) |

Two line references in the brief are stale: `notifications.controller.ts:159` is `getUnreadNotifications` (the PATCH is `:237`); `cellar.controller.ts:32` is the controller decorator (the writer is `:115`).

**Marks, used as the house uses them.** Double rule = ruled off; single rule = subtotal (fo. 3 with one of two vendors stated; the opening stock, which can still grow); c/f = offered, skipped, carried forward with its date; posted = written through a route; in pencil = inferred or proposed, grey beside the ink until posted; journal = `system_audit_log`; reopening = a correcting entry, the line struck, never erased; folio (fo.) = the page.

**Motion.** settle 320ms cubic-bezier(.16,1,.3,1) on a page state arriving and the popover; ink 160ms on hover and focus; turn 420ms cubic-bezier(.32,.72,0,1) as each spread enters; pour 620ms linear as the hold fills; stamp ~360ms spring as the wax lands. `prefers-reduced-motion` collapses each to its end state. One overlay: a 320px anchored popover on "Reopen this page", closed by "Not now" (ADR 0112).

## Two roads not taken inside C
- **Currency on the flyleaf, as today** (`Register.tsx:1276-1280`, sent at `:985-990`). Kept off it so every register is a page of the book with one place and one state; the cost is a house that holds NULL between the flyleaf and fo. 1, which the flyleaf says in words rather than hides.
- **One live spread with every page turning in place.** Drawn instead as one interactive spread (fo. 1: rule off, carry forward, reopen, and the contents entry changing with it) plus four still spreads, each with the contents in that moment's state, so the founder sees every page without clicking.

## Honest gaps
- **The skip row.** `configuration_step_skipped` is proposed (ADR 0113; `get-started.md:193`) and absent from `SETTINGS_AUDIT_ACTIONS` (`settings-audit.service.ts:86-104`). Today "Not yet" on fo. 1 (`CurrencyStep.tsx:19-21`) and "Confirm later" on fo. 2 (`CellarRegistersOnboarding.tsx:72-79`) write nothing, so "offered 6 Sep · skipped · c/f" cannot yet be told from a page nobody opened. Drawn "not built — would need" on both pages and struck in the journal.
- **The assistant.** `config.propose_batch`, the provenance reads, `correlation_id` on journal rows (the column exists and nothing sets it, ADR 0113 rule 4), and any route taking an utterance by voice or typing — none built. fo. 5 is drawn to show the shape; every line's posting route exists.
- **fo. 4 is per person, not per house.** The PATCH keys on `userId` (`:243`); there is no restaurant-scoped preference and no per-producer switch — the nine run on one `restaurant_feature_flags` opt-in row (`notification-producers.service.ts:483-487`), a feature the assistant may never propose flipping (ADR 0113 rule 2). Market-price drop is deployment-wide (`market-price.producer.ts:95-97`): told, not offered.
- **Google sign-up.** Only `POST /auth/oauth/google` sign-in exists (`auth.controller.ts:113`); drawn unavailable with a sentence.
- **The book's memory has no single row.** Page state would be assembled from each route's own readout (currency `statedAt/statedBy`, registers `confirmed_at`, vendor-terms sources); `onboarding_progress` knows only `menu_uploaded` and `threshold_configured` (`menus.ts:54-67`). Five reads, not one.
- **Not drawn, not verified.** The low-stock threshold (`ThresholdStep.tsx`; `PATCH /menus/threshold`, `menus.controller.ts:91-101`) has no page in this book and would need a line on fo. 2. Whether a joiner via `POST /auth/join` passes `/verify-email` before the contents is not verified (`Register.tsx:532` goes straight to `/`).

Example data only — Lokanta Meyhane, The Old Mill, Tuna İçecek, Bereket Gıda, Great Lakes Provisions, Defne, Hasan, Marcus. Nothing outside `.planning/sketches/104-onboarding-directions/` was touched.
