# r73 c3-pageturn build (2026-11-19)
PR: #1894 (draft), branch feat/r73-c3-pageturn, head 2f97df4bb, base feat/r61-c2-auth-spread-invite (#1870).
Why #1870 not #1871: #1871 sits on a perf branch that lacks #1868-#1870; the chain #1868>#1869>#1870 holds Login, Register and VerifyEmail on AuthSpread.
Done: item 7 (PageTurnRouter + lib/mudavym/viewTransition.ts + page-turn.css, 90/220 ms, page-title H1, Create one now 48 px); item 12 (book centred, 100dvh, place-content center; verify-email spread already in #1869, now test-held).
Tests: viewTransition.test (7), PageTurnRouter.test (9), Login 48 px, recovery verify spread; mutations 8, all killed. tsc clean. Vitest 829 pass, 1 fail (shellOverlays CommandPalette class, untouched file, from base). Build main chunk +1.86 kB (gzip +0.75 kB).
Left: popstate (Back) turns the page too but is not captured the same as push (old frame may already be gone in some browsers: check 2). No browser run.
Browser checks owed: see the PR body (8 checks).
