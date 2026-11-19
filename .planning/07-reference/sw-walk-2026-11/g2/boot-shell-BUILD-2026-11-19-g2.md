# g2 boot-shell build (2026-11-19)
Gap verified real at owner tip: #1822 (feat/r58-d-shell-first-paint, 6a5b69a85) index.html always painted sidebar + title bar; #1831/#1847 do not touch index.html.
PR: #1910 (draft, base feat/r58-d-shell-first-paint), branch feat/g2-boot-shell-auth-frame, head 4bebc29b2.
Change: apps/web/index.html head script #boot-frame sets data-boot-frame="auth" for login/register/get-started/verify-email/forgot-password/reset-password/invite/no-access; CSS drops sidebar column, centres title bar. Test in ShellSkeleton.test.tsx (+13 tests).
Mutation: attribute not set (10 fail), invite dropped (1), sidebar not hidden (1); all restored.
Suites: vitest mudavym + ProtectedRoute.loading 30 files/419 pass; tsc --noEmit clean; vite build ok.
Left: "/" token-aware frame (landing vs dashboard); /story /privacy /terms /choose-house keep sidebar frame; auth route list is hand-kept in index.html.
Browser checks owed: see PR body (5 checks; g2 walkers own the browser).
