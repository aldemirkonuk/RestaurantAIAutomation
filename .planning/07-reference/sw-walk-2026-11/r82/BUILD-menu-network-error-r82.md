# BUILD menu-network-error r82 (2026-11-19)

Finding: r81 w1 finding 4, raw axios "Network Error" in both /menu sentences and elsewhere.

## Decisions (taken, no founder ask)
- Words: "Mudavym could not be reached just now." (same as #1907 and #1932). Only a failure with code ERR_NETWORK and no response counts as unreachable; an answered 5xx keeps its own handling (the ManualReceiptWorkspace write path treats a no-answer write as "unknown outcome", so it was left alone).
  Rejected: wording ECONNABORTED/timeouts the same (different words, "timed out", not asked); rewriting every `e.message` to prefer response.data.message (scope creep).
- Menu chain cannot import a helper from a main-based PR, so #1931 carries small inline checks (same pattern as #1907/#1932). Rejected: stacking the helper under the menu chain (it would drag a main PR into a 12-PR chain).
- Helper lives in its own file lib/unreachable.ts, not services/api/client.ts, because many tests mock the client module wholesale.
- getErrorMessage (client.ts, ~170 callers) fixed once there, which covers reports, receipts, orders, team, providers and the rest of the callers that use it.

## FIXED
1. /menu sentences: FIXED on #1931, cb79b5856 (menu read sentence, add and discard sentences, kept menus, locked prices, plan reason). Tests: 5 new/changed in MenuNext, MenuVersions, LockedPrices (changed the old "(Network Error)" pin), MenuPlan. Mutants: reverting the 4 source files fails all 5. Menu suite 58/58; web tsc clean. #1931 diff now 13.7K.
2. Everywhere else on main: FIXED on #1946 (DRAFT on main, e5735552a, 28.6K): lib/unreachable.ts, getErrorMessage, CocktailRegister, BottleLeaf, PhotographLabel, PriceLockNote, useCellarNextData (12), CellarRegistersOnboarding, RecipientField, useComposeData errText, senders-format readFailure, HousePriceCell, InventoryCommandPage Active toggle.
   Tests: lib/unreachable.test.ts (5), useComposeData.unreachable.test.ts (2), HousePriceCell, PhotographLabel (2), PriceLockNote (changed pin), senders-format. Full web suite 390 files, 6057 passed, 10 skipped; tsc clean.
   Mutants: isUnreachable returns false: 8 fail. Reverting the 6 tested call sites: 7 fail.
   NOT test-covered per site (mechanical swap, covered only by the helper test): useCellarNextData, BottleLeaf, CocktailRegister, CellarRegistersOnboarding, RecipientField, InventoryCommandPage toggle.

## NOT FIXED
- Other lanes' files (not touched): OneTapActionCenter.tsx:823,938; inventory/next/iv-export.ts:47 (plainText already rejects "network error", falls to its own sentence, so likely fine); useInventoryNextData.ts and the mail files (MailTab, MailThread, useMailData, mail-format) were not grepped line by line beyond the raw-message pattern, which found none besides the two above.
- Raw `err.message` sites outside the listed softwares, left for a follow-up that can reuse failureWords/isUnreachable: settings CellarSection:152,211 and TargetMarginSection:140; team useTeamNextData:701, MyShiftsNext:160-161, FormerStaff:151, TeamOverlays:936; providers useProvidersNextData:87, useVendorScopes:51, useVendorScorecard:36; receiving useReceivingNextData:492; orders useOrdersNextData:509; calendar useCalendarNextData:381; connections cx-format:158, DistributorFeedPanel:202; recommendations failureOf (several); askai ProposalCard; locations AddLocationDialog; documents NewCategoryModal; hooks useInventoryData:88-90, useOrdersData:117, useStorageLocations:96; simpos SimposTerminalPage:229; Login:265, Register:471,853; documents-reports useSortingOfficeData:366. (Those that call getErrorMessage are already fixed.)
- Receipts rc2-format serverMessage line 141 only prints e.message for non-network errors (the network branch above it already says "no answer came back"), left.
- Reports: no raw sites found in reports/ by the grep.

## Browser checks owed (not run: brief forbids the stack)
- /menu with the gateway aborted: both sentences read "(Mudavym could not be reached just now.)", Retry clears them (r81 check 5 re-run at 1440 and 375).
- /cellar bottle leaf, photograph a label, /inventory price cell save, Compose contact add with the gateway down.
- Merge note: #1946 is on main; #1931 is on the menu chain. They touch no common file.
