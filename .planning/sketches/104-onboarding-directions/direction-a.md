# 104 A — First evidence

**The idea.** The house's first ledger row is written before its first setting: one photograph of the last invoice through the door becomes six lines, a vendor, a price and a currency, and every register is then read from what that paper said and confirmed in place — nothing is asked that the paper already answered, and what the paper did not answer stays open, never defaulted.

## What the flow asks, in order

1. `/register` — two doors. Open a house: name, email, password, house name, address (six fields, no currency question). Join a house: the 8-character code resolves to house, city, inviter and role before the account exists; then name, email, password.
2. `/verify-email` — "open it on the phone you will photograph with": the link signs in the device that opens it; the door is the next screen.
3. The door (`/get-started` collapsed to one question) — photograph the last invoice; second road: photograph the wine list. A 390px frame draws the manager doing it standing up.
4. What the paper answered — the photo beside the canonical document; under it, in order: currency, vendor, vendor terms, what this house pours, low-stock line. Each proposal sits grey (inferred) until confirmed; "Not now" is recorded as a skip. Then the one seal, press-and-hold: "Enter it in the book".
5. The book, opened — one row; each register with its provenance (confirmed by / offered and skipped / never asked); the nine notification producers offered with defaults kept; the assistant offered for what the paper left open.

## What each answer writes, and through which route (worktree feat/mudavym-new-pages @ 5443a0b8 unless marked main)

| Answer | Route | Cited |
|---|---|---|
| Open a house | `POST /auth/register/restaurant`; `currency` omitted, so the row stays NULL | auth.controller.ts:390; register-restaurant.dto.ts:13-16; Register.tsx:985-990 (the omit path exists today) |
| Join a house | `GET /auth/invite/:code` then `POST /auth/join`; `?invite=CODE` prefill | auth.controller.ts:405,435; InviteLanding.tsx:11-20; Register.tsx:173-178; staff see StaffWelcome, GetStarted.tsx:234-236 |
| Verify | `POST /auth/verify-email` returns tokens stored on the opening device; resend `POST /auth/resend-verification` | VerifyEmail.tsx:31-45,55-62; auth.controller.ts:448,457 |
| The photograph | `POST /procurement/documents`, source "photo": classifies, extracts, stores; writes no stock, cost or orders; returns the parse (vendorName, currencySeen, lines) | documents.controller.ts:66-77,436-443,503-509; documents.dto.ts:19,46-49; document-extractor.service.ts:98-120; extracted jsonb, document-intake.service.ts:309 |
| The wine list (road 2) | `POST /menus/import`, source "scan", then today's review screen | menus.controller.ts:36; menus.ts:75-83; MenuScanUpload.tsx:14-19 |
| Currency | `PUT /settings/currency`, owner or manager, audited; the paper's `currencySeen` is the evidence; if the paper prints none, the address's country stands in as a stated default; "Not now" records nothing | settings.controller.ts:227; house-currency.service.ts:1-70; CurrencyStep.tsx:46-57; invoice-currency.ts:1-30 |
| Vendor | `POST /providers` with the name pre-filled from the parse; then `PATCH /providers/:id/usual-currency` | providers.controller.ts:201,282 |
| Vendor terms | `PUT /vendor-terms/:providerId` with `paymentTerms` only; the other four columns stay NULL, and NULL means nobody said | vendor-terms.controller.ts:71; vendor-terms.dto.ts:27-90 |
| What this house pours | `PUT /cellar/:restaurantId/registers`, source "confirmed"; the inference reads inventory kinds and names, menu items and cocktails, so it can only speak once the lines are house items | cellar.controller.ts:115; cellar-registers.dto.ts:31-60; cellar-registers.ts:13-21,248,332-343,372-378 |
| Low-stock line | `PATCH /onboarding/threshold`; the 6 is stated as a default | menus.controller.ts:91-99; ThresholdStep.tsx:80-81 (today's skip writes nothing) |
| Notifications | `PATCH /notifications/preferences`, defaults kept, offered | notifications.controller.ts:237; notifications.dto.ts:193-218,251-300 |
| The seal: enter the row | items `POST /inventory/:restaurantId/items/bulk` (wineDraft, Provisional when unmatched); the paper `POST /procurement/documents/:id/verify` (transcription faithful, no stock); the event `POST /procurement/deliveries` with no orderId, permanently UNORDERED, the invoice attached with its role | inventory.controller.ts:77-83; documents.controller.ts:1136-1142; deliveries.controller.ts:80-99,143-163 |
| Stock | on origin/main fed2b7ca the door count books provisional lots against the delivery when each line names its `inventoryId`; on this worktree the same route books nothing | main: documents.controller.ts:307,415-429, deliveries.dto.ts:148-154, delivery-stock.service.ts:1-45; here: deliveries.controller.ts:41-44,234-240 |

Motion, from the house tokens: `settle` 320ms on each proposal arriving and each confirm; `ink` 160ms on hover and focus; `pour` 620ms linear as the hold fills; `stamp` spring ~360ms as the wax lands; `tally` 840ms as the total counts. Reduced motion collapses every one to its end state. Overlays: one POPOVER (320px, anchored, no dim, close is "Not now") for choosing a different currency; no sheet, no panel.

## Two roads not taken inside A

- **Keep the currency question at `/register` as well.** Safer for a house whose first invoice prints no currency, but it puts a setting before the evidence, which is the one thing this direction refuses; the address stays as the stated fallback when the paper is mute.
- **A seal per register.** Six ceremonies instead of one. The wax is rationed to the commitment that does not reverse in one click, and a currency, a vendor name and a threshold all do; only the row entering the book does not.

## Honest gaps

- **The skip writer is not built.** "Not now" is drawn writing a `system_audit_log` row `configuration_step_skipped` with what was offered; no route writes it today (get-started.md:193; sketch 101 onboarding-step.html:235-245). Drawn with the mono note.
- **Payment terms are typed, not inferred.** The extractor's contract has no payment-terms field (document-extractor.service.ts:98-120), so "Vade: 30 gün" reaches the book only through the person; the provenance says "typed".
- **Nothing matches the paper's vendor name to a provider.** `vendorName` lives only in the extracted jsonb; the person is the match, and the vendor is created from a pre-filled name.
- **Register inference does not read a document.** `inferRegisters` reads inventory, menu and cocktail rows, never document lines, so "what this house pours" can only be proposed after the six lines have become house items — the sketch orders the confirms accordingly and says so on the screen.
- **A house item is still a wine on this tree.** `CreateInventoryItemDto` wants a `wineId` and the bulk route resolves `wineDraft` against the Master Library; rakı, pilsner and soda land as Provisional entries in a wine library. ADR 0115's `kind` and `uom` are decided, not built here.
- **Stock and cost differ by tree.** origin/main books provisional stock at the door and settles cost at VERIFIED (PR #333); this worktree's deliveries write neither. The drawing names both rather than choosing one.
- **No class-A price sighting.** It is written only from a verified receipt that carries a currency (own-paper-sighting.ts:282-296) and the receiving screen sends none, so the paper's prices reach the document lines and not the price register.
- **Per-producer notification switches do not exist.** The DTO holds five categories, quiet hours, low-stock and two modes; the nine are offered and written as the categories they fall into.
- **The assistant's batch is not built.** `config.propose_batch` is ADR 0113 rule 5 (:298-313); "Talk it through" is drawn unavailable with that sentence. Google sign-up is not a route and is not drawn as one.

Example data only: Lokanta Meyhane, Marmara İçecek Dağıtım, Hasan, Defne, the lines and the figures are invented. The repo facts are cited by file:line and were measured on this worktree on 2026-09-06.
