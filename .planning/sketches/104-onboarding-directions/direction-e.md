# Direction E - Set the table

**The idea in one sentence.** The whole arrival is one laid table: from a photograph of the wine list and one address the platform sets out what the house pours, buys, hears about and pays in, every inferred value grey with its source named until the person confirms it with one gesture, and one seal at the foot writes the lot item by item and hands back a receipt.

## What the screen asks, and in what order

There is no order; everything is visible at once, and the person moves in any order. The only sequence is physical: the account must exist before the list can be read, because `POST /menus/import` requires a `restaurantId` (`services/api/menus.ts:79-86`, `menus/dto/import-menu.dto.ts:5-13`). So the head of the table is filled first ("Sit down" - a record, not a ceremony), the photograph is held on the table until then, and the four settings are laid grey the moment it is read. The frame is drawn at 14:10, seven minutes after sitting down, with the four settings in four different states so the idiom reads in one still: Pays in confirmed (ink, provenance kept), Pours grey with one line typed over the guess, Buys from typed with one term stated and four "not yet stated", Hears about left - and the leaving recorded.

Join by invite is the same screen from another seat (frame 2): the code resolves to the house and the inviter before the account exists (`Register.tsx:201`, `GET /auth/invite/:code`, `auth.controller.ts:405`), the laid table is shown read-only with Hasan's provenance on every row, and the joiner's only place is name, email and password. No letter to answer on that path (`Register.tsx:240`). The phone frame (390) is the one step done standing: photographing the list at the pass and confirming Pours with one tap; the rest of the table waits at the desk.

## What each answer writes, and through which door

| Setting | Gesture | Writes through |
|---|---|---|
| Sit down (account + house) | plain button, once | `POST /auth/register/restaurant` (`auth.controller.ts:390`; `Register.tsx:971-995` - timezone from the browser at `:984`, currency omitted at this moment, the point only when chosen at `:993`) |
| The letter | none; a place-card | sent on sit-down; `POST /auth/resend-verification` (`VerifyEmail.tsx:62`), redeemed by `POST /auth/verify-email` (`:34`). It holds the next sign-in, not the table. |
| The list | drop, photograph, file from the till, or typed lines | `POST /menus/import` `{method: scan or csv or manual}` (`menus.controller.ts:36`; `GetStarted.tsx:373-389` today) |
| Pours | "That's right - all seven" | `PUT /cellar/:restaurantId/registers` with `source: 'confirmed'`, all seven at once (`cellar.controller.ts:115`; `cellar-registers.dto.ts:61`; `CellarRegistersStep.tsx:12-16`). Inference vocabulary certain, likely, none, unknown from `cellar-registers.ts:38`; soft drinks read from the house's books alone, catalogue not asked (ADR 0108 Decision). |
| Buys from | type a vendor; state a term | `POST /providers` (`providers.controller.ts:201`) then `PUT /vendor-terms/:providerId` (`vendor-terms.controller.ts:71`), each field NULL until stated (`vendor-terms.service.ts:47-59`, ADR 0116) |
| Hears about | "Leave them as they stand" | no preference changed; one `system_audit_log` row `configuration_step_skipped` with `offered` and `answered: []` via `SettingsAuditService.record` (`settings-audit.service.ts:214`; `get-started.md:193`). A stated change would go through `PATCH /notifications/preferences` (`notifications.controller.ts:237-256`) |
| Pays in | "That's right", "Change it", or "Not yet" | `PUT /settings/currency`, owner or manager (`settings.controller.ts:227`); "Not yet" records nothing and every screen says "currency not recorded" (`CurrencyStep.tsx:52-57, :77`) |
| The seal | hold 620 ms (`pour`), wax lands (`stamp`) | applies each confirmed setting through its own door, then a receipt of written / refused / not attempted (ADR 0113 rule 4); anything still grey is recorded as offered and left |
| Join | "Sit down" with the code | `POST /auth/register` (`auth.controller.ts:96`) and `POST /auth/invite/:code/accept` (`:357`; `InviteLanding.tsx:62`) |

Motion: `settle` 320ms on a value turning from grey to ink and on the receipt arriving; `ink` 160ms on hover; `tuck` ~300ms on the assistant's popover entering; `pour` 620ms linear on the hold filling; `stamp` ~360ms on the wax; `tally` 840ms on the foot's count. Reduced motion collapses the hold to a two-step Enter confirm and every transition to its end state.

## Two roads not taken inside this direction

1. **The seal at sit-down.** Spending the wax on account creation (direction D's ceremony) and treating the settings as plain records. Rejected here because the commitment on this screen is the configuration, not the account: the account changes nothing about how the house runs, the table does. Sit-down is therefore a plain button, and the wax lands once, at the foot.
2. **Confirm-all with the seal.** Letting the hold both confirm every grey value and write it, so there is one gesture instead of one per setting plus one seal. Rejected because it makes the seal a confirm-all: a grey value nobody looked at would become the house's word under one thumb. Grey stays grey through the seal and is recorded as left; confirmation is a separate, one-click, reversible gesture per setting.

## The honest gaps

- **The assistant's proposal has no route.** "Lay it by talking" is a control on this screen (a 320px popover, no dim) and its heard sentence lands grey on Buys from - but `config.propose_batch` is proposed, not built (ADR 0113 rule 5). The drawing says so in mono on the control, on the value, and in the receipt as "not attempted".
- **No switch per producer.** The nine producers exist (`notifications/producers/`) but `PATCH /notifications/preferences` carries channels, five categories, quiet hours and low stock, per `userId` - never per house and never per producer (`notifications.dto.ts:251-298`). The nine are listed "as they stand" and the per-producer switch is drawn as not built.
- **No vendor currency.** `SetVendorTermsDto` has no currency field (`vendor-terms.dto.ts:27-90`); the term is drawn as "no place for it".
- **No batch undo yet.** ADR 0113 rule 4a's seven-day "Undo this table" needs every row to carry the batch's `correlation_id`, which `SettingsAuditService.record` never sets (`settings-audit.service.ts:19, :214`). Drawn unavailable with the sentence.
- **The list cannot be read before the house exists**, so a photograph dropped before sit-down is held, not read. A public extraction route would remove the only sequence on the page.
- **No Google sign-up.** `POST /auth/oauth/google` is sign-in (`auth.controller.ts:113`); the row on the house card says so.
- The skip row and the receipt are drawn with the shape ADR 0113 and `get-started.md` 13.7 specify; neither writer is wired to this screen today.
