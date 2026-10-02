## Tip choices made in the phone app can be hidden by a browser's own copy — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its audit fix round. Line numbers are at that branch's head after this fragment.

**What.** The web app now stamps every tip save with `saved_at` (`apps/web/src/guidance/GuidanceProvider.tsx:240`), and `mergeGuidance` lets the account's copy stand alone only when its stamp is later than this browser's (`GuidanceProvider.tsx:161-163`). The phone app saves its guidance copy without a stamp (`apps/mobile/src/guidance/GuidanceProvider.tsx:152-157`); that copy comes from its own `mergeGuidance`, which keeps only `global`, `pages` and `guide` (`:47-54`). The gateway deep-merges a save into what it holds (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`, `:100`), so after a phone save the account's copy keeps the last web stamp. In the browser that made that last web save, the two stamps tie and this browser's copy is laid over the account's, so wherever the phone changed a setting this browser also holds (a page's tip, "Don't show tips again"), this browser's value shows, and its next save writes that value back to the account.

The winner is also decided by each device's clock, so a browser whose clock runs ahead can keep winning over a later save made elsewhere.

**Fix.** Have the phone app write `saved_at` the same way (or move the stamp to the gateway, set at save time), and add the phone to the cross-device test in `apps/web/src/guidance/GuidanceProvider.test.tsx`.

## "Turn tips back on" leaves a page's old snooze on the account — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its audit fix round. This predates the PR.

**What.** `resetTips` sets each page to `{ tip: 'unseen', tour }` with no `snooze_until` (`apps/web/src/guidance/GuidanceProvider.tsx:416-440`). The gateway's deep merge keeps every key a save leaves out (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`), so a page snoozed with "Not now" in the last four hours (`GuidanceProvider.tsx:372-373`) keeps its `snooze_until` on the account. The browser that pressed the button lays its own copy over the account's and shows the tip; another browser that loads the newer account copy hides that page's tip until the snooze runs out (`GuidanceProvider.tsx:341`), up to four hours.

**Fix.** Send `snooze_until: null` for each page in `resetTips` (the deep merge stores a `null`, and the check at `:341` already reads it as no snooze; the type in `apps/web/src/guidance/types.ts:19` needs to allow it), or have the gateway replace `guidance` instead of deep-merging it.

## A shared browser carries one person's tip choices into the next person's account — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a. The stored copy predates the PR; the PR widens what it carries.

**What.** This browser's copy of guidance is kept under one fixed key, `wineops_guidance_v1` (`apps/web/src/guidance/GuidanceProvider.tsx:68`), not keyed to the signed-in person. Logout (`apps/web/src/stores/authStore.ts:190-204`) clears the tokens (`clearTokens`, `:97-103`), the user and the house selection, and leaves that copy in place; nothing else in `apps/web/src` removes it except "Turn tips back on" (`GuidanceProvider.tsx:426`). When the next person signs in on the same browser, `mergeGuidance` lays the stored copy over their account's copy unless the account's was saved later (`GuidanceProvider.tsx:148-171`, the test at `:163`), and every save is built from that merge (`:255-267`), so their first guidance save writes the previous person's choices into their own account. This PR widens it: "Don't show tips again" now sets `hide_all_tips` for every page (`:393`), so one click on a shared terminal turns tips off for whoever signs in next (unless their account's copy was saved after that click), and their first save makes it stick on their account.

**Fix.** Key the stored copy to the signed-in person (`wineops_guidance_v1:<userId>`), or remove it on logout and whenever the signed-in person changes. Add a test that signs in as a second person after the first turned tips off.

## The tour's focus hand-off finds nothing in the house shell — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a. This predates the PR.

**What.** `focusTourHelpButton` (`apps/web/src/guidance/announce.tsx:19-29`) parks focus on `[data-guidance="tour-help"]` or `[data-guidance="learn-help"]`. The first is drawn only by `TourHelpButton` (`apps/web/src/guidance/components/TourHelpButton.tsx:43`), which is exported (`apps/web/src/guidance/index.ts:6`) and mounted nowhere. The second is in the legacy sidebar (`apps/web/src/components/layout/Sidebar.tsx:738`), which is drawn only when the house shell is off (`apps/web/src/components/layout/DashboardLayout.tsx:54-55`). So in the house shell every call is a no-op: when a tour starts from a tip (`GuidanceProvider.tsx:306`), ends, or cannot start (`apps/web/src/guidance/tours/TourEngine.tsx:62`, `:78`, `:98`, `:145`, `:244`), focus stays wherever the removed tip or driver.js's teardown leaves it. Not tried in a browser.

**Fix.** Give the house shell one stable guidance entry point carrying `data-guidance="tour-help"` (or hand focus back to the element that started the tour), and add a test that a tour's end leaves focus on it.

## The PageTipStrip story draws a tip that no longer exists — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a.

**What.** `apps/web/src/guidance/components/PageTipStrip.stories.tsx:3-38` does not render `PageTipStrip`; it draws its own white card with "Take tour", "Later" and "Don't show again" (`:21`, `:27`, `:33`). The component this PR ships is the margin note with "Show me — N steps", "Not now" and "Don't show tips again" (`apps/web/src/guidance/components/PageTipStrip.tsx:62-104`), so Storybook shows the retired design and words.

**Fix.** Render the real `PageTipStrip` in the story under a stand-in guidance context (with and without "Show me"), or delete the story.

## The legacy Learn & Help panel drops its saves without a word while the account's copy is unread — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its second gate round.

**What.** While `accountCopy` is `'loading'` or `'failed'` (`apps/web/src/guidance/GuidanceProvider.tsx:211-217`), `persistGuidance` drops every guidance save (`:259`). Help's "Page tips" card hides its button then (`apps/web/src/pages/help/next/HelpNext.tsx:137-146`) and no tip shows (`GuidanceProvider.tsx:321`), but the legacy sidebar's LearnPanel does not read `accountCopy`. Its "Reset page tips" (`apps/web/src/guidance/components/LearnPanel.tsx:256`) does nothing at all then, since the tab's session reset sits inside the dropped save (`GuidanceProvider.tsx:416-440`). A tour started from its list (`LearnPanel.tsx:44-58`, `startTour` at `GuidanceProvider.tsx:303-311`) still starts, but its start, finish or skip is not saved (`:285-299`), so that page's tip can come back once the copy is read. Neither says anything. LearnPanel is drawn only in the legacy sidebar (`apps/web/src/components/layout/Sidebar.tsx:716`, `:762`), shown only when the house shell is off (`apps/web/src/components/layout/DashboardLayout.tsx:54-55`). `markUseCardSeen` (`GuidanceProvider.tsx:442-454`) is gated the same way and has no caller in `apps/web/src`. Not tried in a browser.

**Fix.** Have LearnPanel read `accountCopy` and hold its reset button and tour list until it is `'read'`, as Help's card does, or retire the legacy sidebar's guidance entry points.

## Another preference saved after a failed read lets guidance act on an empty stand-in — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its second gate round. The gate this PR adds narrows the problem; it does not close it.

**What.** When the preferences read fails, `accountCopy` is `'failed'` and guidance shows no tip, holds the setup nudge and saves nothing (`apps/web/src/guidance/GuidanceProvider.tsx:211-217`). Any other preferences save made then, for example the Ask panel's mode (`apps/web/src/components/askai/AskPanel.tsx:230`) or a vendor rating (`apps/web/src/pages/providers/next/NewVendorSheet.tsx:368`), runs the hook's optimistic `setQueryData` (`apps/web/src/hooks/useUserPreferences.ts:151-154`). TanStack Query records that as a successful read: `setData` dispatches `success`, whose state sets `error: null` and `status: 'success'` (`@tanstack/query-core` 5.90.16, `build/modern/query.js:60-69`, `:342-354`), and the cache now holds only that one key. `onError` restores nothing when there was no earlier copy (`:158-165`), and the refetch from `onSettled` (`:166-172`) keeps that state while it runs (`fetchState` resets `error` only when there is no data, `query.js:391-401`). Until that refetch fails, `accountCopy` reads `'read'` over the stand-in: a tip can show from this browser's copy alone, the setup nudge can show and count itself (`apps/web/src/guidance/components/SetupNudgeBanner.tsx:36-39`), and any guidance save made then is built from the stand-in and deep-merged over the account's copy. Reasoned from the code and the TanStack source; not reproduced in a test or a browser.

**Fix.** Have `useUserPreferences` report whether its data came from a successful read (and have the provider gate on that), or have `onError` remove the cached data when there was no earlier copy and `onMutate` skip the optimistic write while the query holds an error.
