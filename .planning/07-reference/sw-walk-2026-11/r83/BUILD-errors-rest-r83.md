# BUILD errors-rest r83 (2026-11-19)

Brief: apply lib/unreachable.ts (#1946) to the remaining raw err.message / "Network Error" sites listed in r82/BUILD-menu-network-error-r82.md, in stacked DRAFT PRs, each <= 30K.

## Decisions (taken, no founder ask)
- All three PRs are DRAFT on #1946's branch (fix/r82-unreachable-in-words-helper), grouped by area, no shared files between them, so they merge in any order after #1946.
- Same rule as r82: only ERR_NETWORK with no response is "unreachable"; an answered failure keeps its own handling.
- Fixed at the chokepoint where one exists (receiving failureOf, recommendations failureOf, calendar messageOf, groundChoice) so every caller below it is covered. Rejected: touching each caller.
- Left alone (already clean or out of lane): askai ProposalCard / AskAiActionError, dashboard OneTapPanel and notifications failures (use getErrorMessage, fixed in #1946); Login and Register (AuthContext words ERR_NETWORK itself); NewCategoryModal (localStorage, no network); ask-format (own "did not come back" words); OneTapActionCenter and useInventoryQueries (mail/inventory chain files); iv-export / iv-failure (inventory chain); PlacesAutocomplete (Google Maps); studio tools (internal); receipts rc2-format line 141 (network branch above it already words it).

## FIXED
1. #1950 settings + team + providers (15.9K): TargetMarginSection, CellarSection (2), useTeamNextData, MyShiftsNext (2), FormerStaff, TeamOverlays export, useProvidersNextData, useVendorScopes, useVendorScorecard. Tests: lib/unreachable.sites-a.test.tsx (6); revert of 9 source files fails 6/6.
2. #1951 orders + receiving + calendar + connections + shared hooks (15.4K): useOrdersNextData, receiving failureOf + useManagerQueue, calendar messageOf + EventSheet, connections readError + DistributorFeedPanel, SimposTerminalPage, useInventoryData (3), useOrdersData, useStorageLocations. Tests: lib/unreachable.sites-b.test.tsx (5); revert of 10 source files fails 5/5.
3. #1952 recommendations + locations + ground + sorting office (10.3K): rec-format failureOf, AddLocationDialog, groundChoice, GroundChoiceSync, useSortingOfficeData. Tests: 4 new cases in 4 existing files; revert of 6 source files fails 4/4.
Suites: A 91 files/1252 passed, B 87/1357, C 74/1182; web tsc clean on each.

## NOT test-covered per site (mechanical swap)
CellarSection (2), TeamOverlays export, useVendorScopes, calendar messageOf + EventSheet, DistributorFeedPanel, SimposTerminalPage, useOrdersData, useStorageLocations reasonOf, useSortingOfficeData.

## NOT FIXED
- Sites in the chains I was told not to touch (OneTapActionCenter 823/938, inventory iv-*, mail files).
- Receiving/notifications/recommendations components that print `failure.message` are covered through their failureOf only if the failure is built there; any component building its own message string was not found by grep.
- ask-format.ts:399, studioApi, PlacesAutocomplete, sync-manager, websocket: other-purpose strings, not changed.

## Browser checks owed (stack forbidden)
Settings target margin and team week/former staff/my shifts, providers list, orders/receiving/calendar/connections pages, /recommendations, add-location dialog with the gateway aborted: sentences read "Mudavym could not be reached just now."
