## Tip choices made in the phone app can be hidden by a browser's own copy — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its audit fix round. Line numbers are at that branch's head after this fragment.

**What.** The web app now stamps every tip save with `saved_at` (`apps/web/src/guidance/GuidanceProvider.tsx:215`), and `mergeGuidance` lets the account's copy stand alone only when its stamp is later than this browser's (`GuidanceProvider.tsx:146-148`). The phone app saves its guidance copy without a stamp (`apps/mobile/src/guidance/GuidanceProvider.tsx:152-157`); that copy comes from its own `mergeGuidance`, which keeps only `global`, `pages` and `guide` (`:47-54`). The gateway deep-merges a save into what it holds (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`, `:100`), so after a phone save the account's copy keeps the last web stamp. In the browser that made that last web save, the two stamps tie and this browser's copy is laid over the account's, so wherever the phone changed a setting this browser also holds (a page's tip, "Don't show tips again"), this browser's value shows, and its next save writes that value back to the account.

The winner is also decided by each device's clock, so a browser whose clock runs ahead can keep winning over a later save made elsewhere.

**Fix.** Have the phone app write `saved_at` the same way (or move the stamp to the gateway, set at save time), and add the phone to the cross-device test in `apps/web/src/guidance/GuidanceProvider.test.tsx`.

## "Turn tips back on" leaves a page's old snooze on the account — OPEN — 2026-10-02

Filed by `feat/tips-margin-note-and-tour-card` (PR #570), from its audit fix round. This predates the PR.

**What.** `resetTips` sets each page to `{ tip: 'unseen', tour }` with no `snooze_until` (`apps/web/src/guidance/GuidanceProvider.tsx:388-412`). The gateway's deep merge keeps every key a save leaves out (`apps/api-gateway/src/user-preferences/user-preferences.service.ts:32-53`), so a page snoozed with "Not now" in the last four hours (`GuidanceProvider.tsx:344-345`) keeps its `snooze_until` on the account. The browser that pressed the button lays its own copy over the account's and shows the tip; another browser that loads the newer account copy hides that page's tip until the snooze runs out (`GuidanceProvider.tsx:313`), up to four hours.

**Fix.** Send `snooze_until: null` for each page in `resetTips` (the deep merge stores a `null`, and the check at `:313` already reads it as no snooze; the type in `apps/web/src/guidance/types.ts:19` needs to allow it), or have the gateway replace `guidance` instead of deep-merging it.
