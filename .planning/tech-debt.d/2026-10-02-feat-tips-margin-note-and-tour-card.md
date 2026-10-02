## Tip choices made in the phone app can be hidden by a browser's own copy — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its audit fix round. Line numbers are at that branch's head after this fragment.

**What.** The web app now stamps every tip save with `saved_at` (`apps/web/src/guidance/GuidanceProvider.tsx:222`), and `mergeGuidance` lets the account's copy stand alone only when its stamp is later than this browser's (`GuidanceProvider.tsx:153-155`). The phone app saves its guidance copy without a stamp (`apps/mobile/src/guidance/GuidanceProvider.tsx:152-157`); that copy comes from its own `mergeGuidance`, which keeps only `global`, `pages` and `guide` (`:47-54`). The gateway deep-merges a save into what it holds (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`, `:100`), so after a phone save the account's copy keeps the last web stamp. In the browser that made that last web save, the two stamps tie and this browser's copy is laid over the account's, so wherever the phone changed a setting this browser also holds (a page's tip, "Don't show tips again"), this browser's value shows, and its next save writes that value back to the account.

The winner is also decided by each device's clock, so a browser whose clock runs ahead can keep winning over a later save made elsewhere.

**Fix.** Have the phone app write `saved_at` the same way (or move the stamp to the gateway, set at save time), and add the phone to the cross-device test in `apps/web/src/guidance/GuidanceProvider.test.tsx`.

## "Turn tips back on" leaves a page's old snooze on the account — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its audit fix round. This predates the PR.

**What.** `resetTips` sets each page to `{ tip: 'unseen', tour }` with no `snooze_until` (`apps/web/src/guidance/GuidanceProvider.tsx:395-419`). The gateway's deep merge keeps every key a save leaves out (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`), so a page snoozed with "Not now" in the last four hours (`GuidanceProvider.tsx:351-352`) keeps its `snooze_until` on the account. The browser that pressed the button lays its own copy over the account's and shows the tip; another browser that loads the newer account copy hides that page's tip until the snooze runs out (`GuidanceProvider.tsx:320`), up to four hours.

**Fix.** Send `snooze_until: null` for each page in `resetTips` (the deep merge stores a `null`, and the check at `:320` already reads it as no snooze; the type in `apps/web/src/guidance/types.ts:19` needs to allow it), or have the gateway replace `guidance` instead of deep-merging it.

## A shared browser carries one person's tip choices into the next person's account — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a. The stored copy predates the PR; the PR widens what it carries.

**What.** This browser's copy of guidance is kept under one fixed key, `wineops_guidance_v1` (`apps/web/src/guidance/GuidanceProvider.tsx:60`), not keyed to the signed-in person. Logout (`apps/web/src/stores/authStore.ts:190-204`) clears the tokens (`clearTokens`, `:97-103`), the user and the house selection, and leaves that copy in place; nothing else in `apps/web/src` removes it except "Turn tips back on" (`GuidanceProvider.tsx:405`). When the next person signs in on the same browser, `mergeGuidance` lays the stored copy over their account's copy unless the account's was saved later (`GuidanceProvider.tsx:140-163`, the test at `:155`), and every save is built from that merge (`:237-246`), so their first guidance save writes the previous person's choices into their own account. This PR widens it: "Don't show tips again" now sets `hide_all_tips` for every page (`:372`), so one click on a shared terminal turns tips off for whoever signs in next (unless their account's copy was saved after that click), and their first save makes it stick on their account.

**Fix.** Key the stored copy to the signed-in person (`wineops_guidance_v1:<userId>`), or remove it on logout and whenever the signed-in person changes. Add a test that signs in as a second person after the first turned tips off.

## The tour's focus hand-off finds nothing in the house shell — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a. This predates the PR.

**What.** `focusTourHelpButton` (`apps/web/src/guidance/announce.tsx:19-29`) parks focus on `[data-guidance="tour-help"]` or `[data-guidance="learn-help"]`. The first is drawn only by `TourHelpButton` (`apps/web/src/guidance/components/TourHelpButton.tsx:43`), which is exported (`apps/web/src/guidance/index.ts:6`) and mounted nowhere. The second is in the legacy sidebar (`apps/web/src/components/layout/Sidebar.tsx:738`), which is drawn only when the house shell is off (`apps/web/src/components/layout/DashboardLayout.tsx:54-55`). So in the house shell every call is a no-op: when a tour starts from a tip (`GuidanceProvider.tsx:285`), ends, or cannot start (`apps/web/src/guidance/tours/TourEngine.tsx:62`, `:78`, `:98`, `:145`, `:244`), focus stays wherever the removed tip or driver.js's teardown leaves it. Not tried in a browser.

**Fix.** Give the house shell one stable guidance entry point carrying `data-guidance="tour-help"` (or hand focus back to the element that started the tour), and add a test that a tour's end leaves focus on it.

## The PageTipStrip story draws a tip that no longer exists — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its ADR 0090 audit at 2f068d31a.

**What.** `apps/web/src/guidance/components/PageTipStrip.stories.tsx:3-38` does not render `PageTipStrip`; it draws its own white card with "Take tour", "Later" and "Don't show again" (`:21`, `:27`, `:33`). The component this PR ships is the margin note with "Show me — N steps", "Not now" and "Don't show tips again" (`apps/web/src/guidance/components/PageTipStrip.tsx:62-104`), so Storybook shows the retired design and words.

**Fix.** Render the real `PageTipStrip` in the story under a stand-in guidance context (with and without "Show me"), or delete the story.
