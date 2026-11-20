# r75 login-h1 build (2026-11-19)
PR: #1894 (draft, branch feat/r73-c3-pageturn), new commits 543f288b4 (H1) and 237a681dd (slow-lazy test); head 237a681dd.
Done: Login and Register leaf titles H2 -> H1 (forgot/reset/verify already H1 via AuthSpread; page-title name is applied by viewTransition.ts to the first H1). Tests: pages/__tests__/authTitles.h1.test.tsx (3), PageTurnRouter.test.tsx slow lazy (900 ms chunk, release at holdMs).
Mutation: H1->H2 fails login+register; hold timer 60 s fails slow test. tsc clean. vitest touched dirs 833 pass / 1 fail (shellOverlays CommandPalette, pre-existing at 2f97df4bb). vite build chunk delta 0 B.
Left: Register dead second branch (if(true) else) still has its own h1, untouched. Verify/reset not rendered in the H1 test (AuthSpread test covers them).
Browser checks owed: /login 1440 and 375 outline one H1 "Welcome back."; Create one now glides H1; Back returns; reduced motion instant.
