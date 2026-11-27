## /house leads to the desk, and the setup nudge waits on the menu — CLOSED — 2026-11-07

Filed by `fix/onboarding-house-leads-to-the-desk` (onboarding wave 4, lane 1, second half), under the founder's /goal of 2026-11-07. Cut from `origin/main` beside `fix/onboarding-finish-setup-resumes-at-the-menu` (the `/get-started` half); the lane was split in two because together it was 53K of diff, over the 30K cap. Not stacked on #656.

**What this closes.** Proposal (`p4-scratch/sw-walk/onboarding/proposal.md`) G2 and fork F1/F20. QA round 2 (`qa-report/round2-onboarding.md`): BL-2 and H-1.
- BL-2: `/house` links to `/` from the header mark and from **Go to the desk**.
- H-1: the invoice drop that kept only a file name is gone; one line links to Receipts. `lib/houseLater.ts` is deleted.
- Saving a supplier makes one request: the gateway's `createProvider` already marks `vendor_added`.
- The finish-setup nudge waits on `menu_uploaded`, not `activated` (fork F1), and its words drop "wine list" and "threshold". A manager's button goes to `/menu`.
- Claims: `../decisions/claims.d/fix-onboarding-house-leads-to-the-desk.jsonl`.

## What this half leaves open — OPEN — 2026-11-07

- **Server `activated` (OB-1).** `getOnboardingProgress` still needs `threshold_configured`. It is in the open menu chain (#770, #777, #793). Claim `ONB-SERVER-ACTIVATED-IS-A-MENU` (open) fails the build when OB-1 lands, so the nudge can go back to `!progress.activated` then.
- **#656's rebase.** #656 edits HouseContents and `houseLater.ts`; it must rebase over this half.
