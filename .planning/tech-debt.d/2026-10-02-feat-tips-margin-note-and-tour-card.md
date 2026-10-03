## Tip choices made in the phone app can be hidden by a browser's own copy — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its audit fix round. Every line number into this repository is measured at 3ba5bed50, PR #570's branch with origin/main ba9704b59 merged in; the `@tanstack/query-core` ones are at the version named beside them. The commit that wrote this sentence changes only this file, so the numbers hold at that commit too; they drift once the cited files change.

**What.** The web app now stamps every tip save with `saved_at` (`apps/web/src/guidance/GuidanceProvider.tsx:249`), and `mergeGuidance` lets the account's copy stand alone only when its stamp is later than this browser's (`GuidanceProvider.tsx:172-174`). The phone app saves its guidance copy without a stamp (`apps/mobile/src/guidance/GuidanceProvider.tsx:152-157`); that copy comes from its own `mergeGuidance`, which keeps only `global`, `pages` and `guide` (`:47-54`). The gateway deep-merges a save into what it holds (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`, `:100`), so after a phone save the account's copy keeps the last web stamp. In the browser that made that last web save, the two stamps tie and this browser's copy is laid over the account's, so wherever the phone changed a setting this browser also holds (a page's tip, "Don't show tips again"), this browser's value shows, and its next save writes that value back to the account.

The winner is also decided by each device's clock, so a browser whose clock runs ahead can keep winning over a later save made elsewhere.

**Fix.** Have the phone app write `saved_at` the same way (or move the stamp to the gateway, set at save time), and add the phone to the cross-device test in `apps/web/src/guidance/GuidanceProvider.test.tsx`.

## "Turn tips back on" leaves a page's old snooze on the account — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its audit fix round. This predates the PR.

**What.** `resetTips` sets each page to `{ tip: 'unseen', tour }` with no `snooze_until` (`apps/web/src/guidance/GuidanceProvider.tsx:431-455`). The gateway's deep merge keeps every key a save leaves out (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`), so a page snoozed with "Not now" in the last four hours (`GuidanceProvider.tsx:387-388`) keeps its `snooze_until` on the account. The browser that pressed the button lays its own copy over the account's and shows the tip; another browser that loads the newer account copy hides that page's tip until the snooze runs out (`GuidanceProvider.tsx:356`), up to four hours.

**Fix.** Send `snooze_until: null` for each page in `resetTips` (the deep merge stores a `null`, and the check at `:356` already reads it as no snooze; the type in `apps/web/src/guidance/types.ts:19` needs to allow it), or have the gateway replace `guidance` instead of deep-merging it.

## A shared browser carries one person's tip choices into the next person's account — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a. The stored copy predates the PR; the PR widens what it carries. Reviewer B reproduced it in gate round 4 (audit at 689799e0a).

**What.** This browser's copy of guidance is kept under one fixed key, `wineops_guidance_v1` (`apps/web/src/guidance/GuidanceProvider.tsx:79`), not keyed to the signed-in person. Logout (`apps/web/src/stores/authStore.ts:190-204`) clears the tokens (`clearTokens`, `:97-103`), the user and the house selection, and leaves that copy in place; nothing else in `apps/web/src` removes it except "Turn tips back on" (`GuidanceProvider.tsx:441`). When the next person signs in on the same browser, `mergeGuidance` lays the stored copy over their account's copy unless the account's was saved later (`GuidanceProvider.tsx:159-182`, the test at `:174`), and every save is built from that merge (`:264-276`), so their first guidance save writes the previous person's choices into their own account. This PR widens it: "Don't show tips again" now sets `hide_all_tips` for every page (`:408`), so one click on a shared terminal turns tips off for whoever signs in next (unless their account's copy was saved after that click), and their first save makes it stick on their account.

**Fix.** The one-line fix: clear the stored copy on logout (`localStorage.removeItem('wineops_guidance_v1')` in `logout`, `apps/web/src/stores/authStore.ts:190-204`). Keying it to the signed-in person instead (`wineops_guidance_v1:<userId>`) also covers a sign-out that does not run `logout`: a failed token refresh (`authStore.ts:218-222`) and a refresh token rejected at load (`:293-296`) clear the tokens and the user without it. Not fixed in PR #570. Add a test that signs in as a second person after the first turned tips off.

## The tour's focus hand-off finds nothing in the house shell — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a. This predates the PR.

**What.** `focusTourHelpButton` (`apps/web/src/guidance/announce.tsx:19-29`) parks focus on `[data-guidance="tour-help"]` or `[data-guidance="learn-help"]`. The first is drawn only by `TourHelpButton` (`apps/web/src/guidance/components/TourHelpButton.tsx:43`), which is exported (`apps/web/src/guidance/index.ts:6`) and mounted nowhere. The second is in the legacy sidebar (`apps/web/src/components/layout/Sidebar.tsx:738`), which is drawn only when the house shell is off (`apps/web/src/components/layout/DashboardLayout.tsx:65-67`). So in the house shell every call is a no-op: when a tour starts from a tip (`GuidanceProvider.tsx:315`), ends, or cannot start (`apps/web/src/guidance/tours/TourEngine.tsx:62`, `:78`, `:98`, `:145`, `:244`), focus stays wherever the removed tip or driver.js's teardown leaves it. Not tried in a browser.

**Fix.** Give the house shell one stable guidance entry point carrying `data-guidance="tour-help"` (or hand focus back to the element that started the tour), and add a test that a tour's end leaves focus on it.

## The PageTipStrip story draws a tip that no longer exists — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a.

**What.** `apps/web/src/guidance/components/PageTipStrip.stories.tsx:3-38` does not render `PageTipStrip`; it draws its own white card with "Take tour", "Later" and "Don't show again" (`:21`, `:27`, `:33`). The component this PR ships is the margin note with "Show me — N steps", "Not now" and "Don't show tips again" (`apps/web/src/guidance/components/PageTipStrip.tsx:62-104`), so Storybook shows the retired design and words.

**Fix.** Render the real `PageTipStrip` in the story under a stand-in guidance context (with and without "Show me"), or delete the story.

## The legacy Learn & Help panel drops its saves without a word while the account's copy is unread — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its second gate round.

**What.** Until a read of the account's copy has succeeded, `accountCopy` is `'loading'` or `'failed'` (`apps/web/src/guidance/GuidanceProvider.tsx:222-226`) and `persistGuidance` drops every guidance save (`:268`). Help's "Page tips" card hides its button then (`apps/web/src/pages/help/next/HelpNext.tsx:142-151`) and no tip shows (`GuidanceProvider.tsx:336`), but the legacy sidebar's LearnPanel does not read `accountCopy`. Its "Reset page tips" (`apps/web/src/guidance/components/LearnPanel.tsx:256`) does nothing at all then, since the tab's session reset sits inside the dropped save (`GuidanceProvider.tsx:431-455`). A tour started from its list (`LearnPanel.tsx:44-58`, `startTour` at `GuidanceProvider.tsx:312-321`) still starts, but its start, finish or skip is not saved (`:294-308`), so that page's tip can come back once the copy is read. Neither says anything. LearnPanel is drawn only in the legacy sidebar (`apps/web/src/components/layout/Sidebar.tsx:716`, `:762`), shown only when the house shell is off (`apps/web/src/components/layout/DashboardLayout.tsx:65-67`). `markUseCardSeen` (`GuidanceProvider.tsx:457-469`) is gated the same way and has no caller in `apps/web/src`. Not tried in a browser.

**Fix.** Have LearnPanel read `accountCopy` and hold its reset button and tour list until it is `'read'`, as Help's card does, or retire the legacy sidebar's guidance entry points.

## Before any read succeeds, another preference's save does not show until one does — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its second gate round, and narrowed in its third. The window it was filed for is closed; this is what the fix leaves. Restated in its fourth: for the Reports sheet the save is not only unseen, it replaces the account's sheet (filed separately, last entry below).

**Closed.** A preferences save made while no read had succeeded (the first one loading, or failed) ran the hook's optimistic `setQueryData` over nothing. TanStack Query records that as a successful read: `setData` dispatches `success`, whose state sets `error: null` and `status: 'success'` (`@tanstack/query-core` 5.90.16, `build/modern/query.js:60-69`, `:342-354`, and `successState` at `:402-410`). The cache then held only the saved key, and guidance read it as the account's copy. Now `onMutate` writes only over data a read returned (`apps/web/src/hooks/useUserPreferences.ts:155-164`), and the provider asks the hook whether a read has succeeded (`isAccountRead`, `:212-220`; `apps/web/src/guidance/GuidanceProvider.tsx:222-226`). `apps/web/src/pages/help/next/HelpNext.test.tsx` pins both cases with the real hook, an Ask-mode save (`askLastMode`) after a failed read and one made during the first read: no setup nudge, no guidance save.

**What remains.** With no successful read, a save through the hook still goes to the gateway, but nothing on screen shows it until a read succeeds (`onSettled` refetches, `useUserPreferences.ts:176-182`), and never if reads keep failing. Two writers lean on the optimistic copy to show the change:
- The Reports sheet is derived only from `preferences` (`apps/web/src/pages/reports/next/useReportsNextData.ts:244`, saved at `:297`). For it the gap is worse than display: with no successful read, an edit is built from the default sheet and the save replaces the account's stored `blocks` whole. That predates this PR, which changes only what the person sees. It is its own OPEN entry, the last one below.
- A vendor rating is built from `preferences.providerRatings` (`apps/web/src/pages/providers/next/NewVendorSheet.tsx:367-368`). That is an object keyed by vendor, which the gateway's deep merge merges key by key (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:39-47`), so the account's other ratings survive the save.

The others do not: the Ask panel keeps its own mode (`apps/web/src/components/askai/AskPanel.tsx:216-231`), Team goals keep local state (`apps/web/src/components/team/TeamGoalsSettings.tsx:23-34`), and `GroundChoiceSync` keeps reporting the read failure rather than taking its own write for the account's answer (`apps/web/src/lib/mudavym/GroundChoiceSync.tsx:94-106`). Reasoned from the code; not tried in a browser.

**Fix.** On a successful PATCH, write the gateway's merged row into the cache (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:100` merges it, `:118-122` and `:139-143` return it), which is a real answer from the account. `patchPreferences` must then stop turning a missing `preferences` into `{}` (`useUserPreferences.ts:120`), or that stand-in comes back. This fixes the display only; it does not stop the Reports overwrite, which needs the gate in the next entry.

## Before any read succeeds, a Reports edit replaces the account's saved sheet — OPEN — 2026-10-03

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its fourth gate round (audit at 689799e0a: both reviewers found it, and reviewer A reproduced it with the real hook). This predates the PR. The PR does not change the Reports code.

**What.** With no successful read of the account's preferences (the first one loading, or failed), `preferences` is an empty stand-in: the `{}` placeholder (`apps/web/src/hooks/useUserPreferences.ts:133`) or `{}` (`:185`). The sheet then decodes to the default one (`apps/web/src/pages/reports/next/useReportsNextData.ts:143-144`, `:244`). "Arrange the sheet" is not held back (`apps/web/src/pages/reports/next/ReportsNext.tsx:380`): arranging copies the default sheet into the draft (`:161`, and a goals-desk proposal at `:293`), and "Rule it off" saves it (`:166`, through `useReportsNextData.ts:295-300`). `encodeSheet` writes a block for every analysis id (`useReportsNextData.ts:180-191`), and the gateway's deep merge replaces an array whole (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:39-50`). So the PATCH replaces the account's stored `reportsSheet.blocks` with the default sheet plus this one edit, and the arrangement the account held is gone.

On main the same save made the same overwrite, and its optimistic write then showed the edit. In this PR that write is skipped when no read has returned data (`useUserPreferences.ts:161-164`), so the edit does not show until a read succeeds. The PR changes only what the person sees, not what is saved.

`sheetKnown` does not hold this back. It is documented as false while the preferences API has not answered (`useReportsNextData.ts:220-221`), but it is `!isLoading` (`:319`). TanStack's `isLoading` is `isPending && isFetching` (`@tanstack/query-core` 5.90.16, `build/modern/queryObserver.js:308-310`); placeholder data reports `success` (`:265-283`), and a failed read reports `error`, so `sheetKnown` is true under placeholder data and after a failed read. Nothing in `apps/web/src` reads it; only a test stub sets it (`apps/web/src/pages/reports/next/ReportsNext.test.tsx:431`). Reasoned from the code here; not tried in a browser.

**Fix.** Gate the Reports editor on a successful read: derive `sheetKnown` from the hook's `isAccountRead` (`useUserPreferences.ts:220`), and hold "Arrange the sheet" and placing a goals-desk proposal until it is true. Add a test with a failed first read that checks no PATCH carries `reportsSheet`.
