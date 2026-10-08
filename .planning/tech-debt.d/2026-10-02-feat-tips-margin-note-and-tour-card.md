## Tip choices made in the phone app can be hidden by a browser's own copy — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570). Every line number in this file is measured at the commit that last wrote it, unless a sentence names another commit; `@tanstack/query-core` numbers are at the version named beside them.

**What.** The phone app saves its whole guidance copy with no `saved_at` (`apps/mobile/src/guidance/GuidanceProvider.tsx:152-157`), and the gateway deep-merges it (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`), so the account keeps the last web stamp. Two results: in the browser that made that web save, the stamps tie and this browser's own copy is laid over the phone's change (`apps/web/src/guidance/GuidanceProvider.tsx:180-189`, `:210`, `:213-226`); and a phone save built from an older read writes old values back, `hide_all_tips: false` included.

**Fix.** Have the phone send only the keys an action changed, stamped, as the web app does (`GuidanceProvider.tsx:304`, `:316-321`), or stamp on the gateway (last entry). Add the phone to the two-browser tests.

## "Turn tips back on" leaves a page's old snooze on the account — ~~OPEN~~ CLOSED 2026-10-03 (feat/tips-margin-note-and-tour-card, PR #570, gate round-7 fix) — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its audit fix round. This predates the PR. Closed by the same PR's gate round-7 fix.

**What it was.** At 37841f602, `resetTips` set each page to `{ tip: 'unseen', tour }` with no `snooze_until` (`apps/web/src/guidance/GuidanceProvider.tsx:431-455` at that commit). The gateway's deep merge keeps every key a save leaves out (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`), so a page snoozed with "Not now" in the last four hours kept its `snooze_until` on the account, and another browser that loaded the newer account copy hid that page's tip until the snooze ran out, up to four hours.

**Fixed.** `resetTips` now sends `{ tip: 'unseen', snooze_until: null }` for every page id and every page in the read, with `hide_all_tips: false` and `tips_snoozed_until: null` (`apps/web/src/guidance/GuidanceProvider.tsx:479-503`). The deep merge stores a `null`, the snooze check reads it as no snooze (`:411`), and `apps/web/src/guidance/types.ts:20` and `:44` allow it. A page's tour is left as the account holds it. Pinned by `apps/web/src/guidance/GuidanceProvider.test.tsx:287` (what the save sends) and `:553` (two browsers, with the real preferences hook and a copy of the gateway's merge).

## A shared browser carries one person's tip choices into the next person's account — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a. The stored copy predates the PR; the PR widens what it carries ("Don't show tips again" now sets `hide_all_tips`, `apps/web/src/guidance/GuidanceProvider.tsx:459-462`, `:476`).

**What.** This browser's guidance copy sits under one fixed key, `wineops_guidance_v1` (`GuidanceProvider.tsx:81`), not keyed to the person, and sign-out (`endSession`, `apps/web/src/contexts/AuthContext.tsx:1048-1085`) leaves it. Guidance takes the person's id from `useAuthStore` (`GuidanceProvider.tsx:256`, `apps/web/src/hooks/useUserPreferences.ts:143`), whose user is persisted as `auth-storage` (`apps/web/src/stores/authStore.ts:315-321`) and is not cleared at sign-out either. At the next load whose `/auth/me` read succeeds, the stored copy is laid over the new person's account copy unless the account's carries a readable stamp and the stored copy none or an earlier one (`GuidanceProvider.tsx:180-189`, `:210`), so the previous person's tip choices show in this browser until a save here finds the account stamped as late as the copy (`:311-314`). A save sends the account only the keys its action changed (`:316-321`), except the setup nudge's counts, which are built on the merged copy (`:522-542`) and so can carry the previous person's count to the new account.

**Fix (owed, none made in #570).**
- Remove `wineops_guidance_v1` in `endSession`, beside its read-cache clear.
- Clear the store's user in `endSession` (not in the store's `logout`, which nothing calls), and set it at an in-page sign-in; or take guidance's id from `useAuth().user`.
- Or key the copy to the person (`wineops_guidance_v1:<userId>`) using `useAuth().user`'s id, not the store's, so a sign-in path that skips `endSession` cannot carry it over.
- Test: sign out through `useAuth().logout`, sign in as a second person after the first turned tips off, and check the second person's first save.

## The tour's focus hand-off finds nothing in the house shell — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a. This predates the PR.

**What.** `focusTourHelpButton` (`apps/web/src/guidance/announce.tsx:19-29`) parks focus on `[data-guidance="tour-help"]` or `[data-guidance="learn-help"]`. The first is drawn only by `TourHelpButton` (`apps/web/src/guidance/components/TourHelpButton.tsx:43`), which is exported (`apps/web/src/guidance/index.ts:6`) and mounted nowhere. The second is in the legacy sidebar (`apps/web/src/components/layout/Sidebar.tsx:738`), which is drawn only when the house shell is off (`apps/web/src/components/layout/DashboardLayout.tsx:65-67`). So in the house shell every call is a no-op: when a tour starts from a tip (`GuidanceProvider.tsx:370`), ends, or cannot start (`apps/web/src/guidance/tours/TourEngine.tsx:62`, `:78`, `:98`, `:145`, `:244`), focus stays wherever the removed tip or driver.js's teardown leaves it. Not tried in a browser.

**Fix.** Give the house shell one stable guidance entry point carrying `data-guidance="tour-help"` (or hand focus back to the element that started the tour), and add a test that a tour's end leaves focus on it.

## The PageTipStrip story draws a tip that no longer exists — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a.

**What.** `apps/web/src/guidance/components/PageTipStrip.stories.tsx:3-38` does not render `PageTipStrip`; it draws its own white card with "Take tour", "Later" and "Don't show again" (`:21`, `:27`, `:33`). The component this PR ships is the margin note with "Show me — N steps", "Not now" and "Don't show tips again" (`apps/web/src/guidance/components/PageTipStrip.tsx:62-104`), so Storybook shows the retired design and words.

**Fix.** Render the real `PageTipStrip` in the story under a stand-in guidance context (with and without "Show me"), or delete the story.

## The legacy Learn & Help panel drops its saves without a word while the account's copy is unread — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its second gate round.

**What.** Until a read of the account's copy has succeeded, `accountCopy` is `'loading'` or `'failed'` (`apps/web/src/guidance/GuidanceProvider.tsx:267-271`) and `persistGuidance` drops every guidance save (`:335`). Help's "Page tips" card hides its button then (`apps/web/src/pages/help/next/HelpNext.tsx:142-151`) and no tip shows (`GuidanceProvider.tsx:391`), but the legacy sidebar's LearnPanel does not read `accountCopy`. Its "Reset page tips" (`apps/web/src/guidance/components/LearnPanel.tsx:256`) does nothing at all then, since the tab's session reset sits inside the dropped save (`GuidanceProvider.tsx:479-503`). A tour started from its list (`LearnPanel.tsx:44-58`, `startTour` at `GuidanceProvider.tsx:367-376`) still starts, but its start, finish or skip is not saved (`:349-363`), so that page's tip can come back once the copy is read. Neither says anything. LearnPanel is drawn only in the legacy sidebar (`apps/web/src/components/layout/Sidebar.tsx:716`, `:762`), shown only when the house shell is off (`apps/web/src/components/layout/DashboardLayout.tsx:65-67`). `markUseCardSeen` (`GuidanceProvider.tsx:505-517`) is gated the same way and has no caller in `apps/web/src`. Not tried in a browser.

**Fix.** Have LearnPanel read `accountCopy` and hold its reset button and tour list until it is `'read'`, as Help's card does, or retire the legacy sidebar's guidance entry points.

## Before any read succeeds, another preference's save does not show until one does — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its second gate round, and narrowed in its third. The window it was filed for is closed; this is what the fix leaves. Restated in its fourth: for the Reports sheet the save is not only unseen, it replaces the account's sheet (filed separately, the next entry).

**Closed.** A preferences save made while no read had succeeded (the first one loading, or failed) ran the hook's optimistic `setQueryData` over nothing. TanStack Query records that as a successful read: `setData` dispatches `success`, whose state sets `error: null` and `status: 'success'` (`@tanstack/query-core` 5.90.16, `build/modern/query.js:60-69`, `:342-354`, and `successState` at `:402-410`). The cache then held only the saved key, and guidance read it as the account's copy. Now `onMutate` writes only over data a read returned (`apps/web/src/hooks/useUserPreferences.ts:174-186`), and the provider asks the hook whether a read has succeeded (`isAccountRead`, `:234-242`; `apps/web/src/guidance/GuidanceProvider.tsx:267-271`). `apps/web/src/pages/help/next/HelpNext.test.tsx` pins both cases with the real hook, an Ask-mode save (`askLastMode`) after a failed read and one made during the first read: no setup nudge, no guidance save.

**What remains.** With no successful read, a save through the hook still goes to the gateway, but nothing on screen shows it until a read succeeds (`onSettled` refetches, `useUserPreferences.ts:198-204`), and never if reads keep failing. Two writers lean on the optimistic copy to show the change:
- The Reports sheet is derived only from `preferences` (`apps/web/src/pages/reports/next/useReportsNextData.ts:244`, saved at `:297`). For it the gap is worse than display: with no successful read, an edit is built from the default sheet and the save replaces the account's stored `blocks` whole. That predates this PR, which changes only what the person sees. It is its own OPEN entry, the next one.
- A vendor rating is built from `preferences.providerRatings` (`apps/web/src/pages/providers/next/NewVendorSheet.tsx:367-368`). That is an object keyed by vendor, which the gateway's deep merge merges key by key (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:39-47`), so the account's other ratings survive the save.

The others do not: the Ask panel keeps its own mode (`apps/web/src/components/askai/AskPanel.tsx:216-231`), Team goals keep local state (`apps/web/src/components/team/TeamGoalsSettings.tsx:23-34`), and `GroundChoiceSync` keeps reporting the read failure rather than taking its own write for the account's answer (`apps/web/src/lib/mudavym/GroundChoiceSync.tsx:94-106`). Reasoned from the code; not tried in a browser.

**Fix.** On a successful PATCH, write the gateway's merged row into the cache (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:100` merges it, `:118-122` and `:139-143` return it), which is a real answer from the account. `patchPreferences` must then stop turning a missing `preferences` into `{}` (`useUserPreferences.ts:139`), or that stand-in comes back. This fixes the display only; it does not stop the Reports overwrite, which needs the gate in the next entry.

## Before any read succeeds, a Reports edit replaces the account's saved sheet — OPEN — 2026-10-03

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its fourth gate round (audit at 689799e0a: both reviewers found it, and reviewer A reproduced it with the real hook). This predates the PR. The PR does not change the Reports code.

**What.** With no successful read of the account's preferences (the first one loading, or failed), `preferences` is an empty stand-in: the `{}` placeholder (`apps/web/src/hooks/useUserPreferences.ts:152`) or `{}` (`:207`). The sheet then decodes to the default one (`apps/web/src/pages/reports/next/useReportsNextData.ts:143-144`, `:244`). "Arrange the sheet" is not held back (`apps/web/src/pages/reports/next/ReportsNext.tsx:380`): arranging copies the default sheet into the draft (`:161`, and a goals-desk proposal at `:293`), and "Rule it off" saves it (`:166`, through `useReportsNextData.ts:295-300`). `encodeSheet` writes a block for every analysis id (`useReportsNextData.ts:180-191`), and the gateway's deep merge replaces an array whole (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:39-50`). So the PATCH replaces the account's stored `reportsSheet.blocks` with the draft: the default sheet with whatever was changed in it before "Rule it off" (`ReportsNext.tsx:161`, `:293`, `:166`, `:375-376`). The arrangement the account held is gone.

On main the same save made the same overwrite, and its optimistic write then showed the edit. In this PR that write is skipped when no read has returned data (`useUserPreferences.ts:183-186`), so the edit does not show until a read succeeds. The PR changes only what the person sees, not what is saved.

`sheetKnown` does not hold this back. It is documented as false while the preferences API has not answered (`useReportsNextData.ts:220-221`), but it is `!isLoading` (`:319`). TanStack's `isLoading` is `isPending && isFetching` (`@tanstack/query-core` 5.90.16, `build/modern/queryObserver.js:308-310`); placeholder data reports `success` (`:265-283`), and a failed read reports `error`, so `sheetKnown` is true under placeholder data and after a failed read. Nothing in `apps/web/src` reads it; only a test stub sets it (`apps/web/src/pages/reports/next/ReportsNext.test.tsx:437`). Reasoned from the code here; not tried in a browser.

**Fix.** Gate the Reports editor on a successful read: derive `sheetKnown` from the hook's `isAccountRead` (`useUserPreferences.ts:242`), and hold "Arrange the sheet" and placing a goals-desk proposal until it is true. Add a test with a failed first read that checks no PATCH carries `reportsSheet`.

## Which copy of the tip choices wins rests on device clocks, and no ADR records the rule — OPEN — 2026-10-03

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its gate round-7 audit at 37841f602 (PR comment 5975870123). ADR 0251 D2 says "Don't show tips again" holds "until the person turns tips back on"; ADR 0251 is on #566's branch. `git grep saved_at -- .planning/decisions` finds nothing, so the rule below is in no ADR; a bracket under ADR 0251 is owed once #566 and #570 have both merged.

**The rule as built** (`apps/web/src/guidance/GuidanceProvider.tsx`):
- A web save sends the account only the keys its action changed, with `saved_at` from the saving device's clock (`:300-324`). The gateway deep-merges it (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`), and the preferences hook merges it into its cache the same way (`apps/web/src/hooks/useUserPreferences.ts:105-122`, `:183-186`).
- This browser's own copy holds the saves made here, stamped with the latest (`:96-140`). At a save it starts again from that save alone when it has no readable stamp, or when the cached account copy is stamped as late as it (`:311-314`).
- On reading, the account's copy stands alone when this browser holds no readable copy, or the account's stamp is readable and this browser's is missing or earlier (`:180-189`, `:210`); otherwise this browser's copy is laid over it, key by key (`:213-226`).
- Pinned in `apps/web/src/guidance/GuidanceProvider.test.tsx`: the newer copy wins (`:222-266`), what each save sends (`:268-304`), the two-browser tests (`:421-565`), and an unstamped copy left by an earlier build, at a save and at the read (the last two tests).

**Where D2 is not met.** Cases 1-4 are worse than main, because main's stored copy kept every key it held, a page's `dismissed` included, and always won (`GuidanceProvider.tsx:112-130` at c4005eb09); on main nothing a person could press set `hide_all_tips` (its strip's "Don't show again" dismissed one page, `apps/web/src/guidance/components/PageTipStrip.tsx:22-23` at c4005eb09). Gate round 8's reviewer B reproduced 1-3 against a stand-in for the gateway, not the real one; the rest are reasoned from the code.
1. A whole-copy save with no stamp: the phone app (first entry), or a tab still on the previous build, which sends the copy it merged from its stored copy and the account's read (`GuidanceProvider.tsx:172-181` at c4005eb09). Nothing forces an open tab onto a new build (`apps/web/src/lib/register-sw.ts` reloads only when the service worker changes).
2. Two saves at the gateway at once: `updatePreferences` reads and writes in two statements (`user-preferences.service.ts:89-108`), so the second can put back what the first changed, also within one browser (`apps/web/src/guidance/components/SetupNudgeBanner.tsx:39`).
3. A save that does not reach the account keeps its effect only in this browser, until this browser's copy starts again at a later save that finds the account stamped as late as it (`:311-314`), normally the second save after it. If a later save is sent while it is on its way, that is at once: the hook stamps its cache when a save is sent (`useUserPreferences.ts:183-186`) and puts it back only if that save fails (`:190-197`).
4. A page's "Don't show again" saved by the previous build and never written to the account is unstamped in the stored copy, so it loses at the next read to a stamped account copy (`:180-189`), and that page's tip shows again.
5. Clock skew: a browser whose clock runs ahead keeps its copy over later saves made elsewhere; one running behind does not reach a browser holding a later stamp. The gate round-7 audit reproduced a browser a day ahead staying off after "Turn tips back on" elsewhere.
6. A shared browser (the shared-browser entry above, which this PR widens).

**Also left.** The setup nudge's counts are sent as the merged value plus one (`:522-542`), so two browsers can send the same count, and an older read a lower one. The list of use cards seen is sent whole, and the gateway replaces an array whole (`:505-517`); `markUseCardSeen` has no caller in `apps/web/src`.

**Fix (owed, none made in #570).**
- Stamp `saved_at` on the gateway when it stores a save, and keep the stamp it returns (cases 1, 5).
- Phone app: the first entry's fix (case 1).
- One database statement for the read and the merge (case 2).
- A TanStack `scope` on the preferences save, so one browser's saves go out in order (case 2, within one browser).
- An increment the gateway applies for the nudge's counts (Also left).
- Add each case to the two-browser tests as it is fixed.
