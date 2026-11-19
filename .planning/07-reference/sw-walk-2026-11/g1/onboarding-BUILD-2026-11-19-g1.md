# g1 onboarding build, 2026-11-19

Gap: owner sign-up (register -> house) never says whether the verification mail left. Verified real at #1562 tip ca97786ad (registerRestaurant fire-and-forget; AuthContext.registerRestaurant never called noteSignUpMail; invite join same).

PR: #1905 (draft), branch fix/owner-sign-up-says-if-the-verification-mail-left, base fix/verify-tab-sees-a-verify-done-elsewhere (#1562), head 14ab61e24.

Changes: auth.service registerRestaurant awaits queueEmailVerification and returns {...tokens, verificationMail}; joinViaInvite returns optional verificationMail (only when it mailed a link); AuthContext registerRestaurant and joinViaInvite call noteSignUpMail.

Tests: house-opening.spec (+3), unproven-address.spec (+2), AuthContext.signUpMail.test (+6). 120 gateway auth + 92 web pass; tsc web/gateway clean (TS2307 ignored); vite build ok.
Mutation: removed await -> 3 registerRestaurant specs fail; removed join await -> 1 fails; removed noteSignUpMail -> 5 new web specs fail.

Left: invite-join on the web lands on its own page (not verified it routes to /verify-email for a held joiner); the "unconfirmed" 8 s bound is unmeasured against production Gmail (unchanged).

Browser checks owed: (1) mailer down, register owner -> /verify-email shows not-sent sentence + Resend; (2) mailer up -> normal copy; (3) invite join with a different address, mailer down -> /verify-email says it did not leave.
