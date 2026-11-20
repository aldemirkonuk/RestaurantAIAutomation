# Round 19: adversarial re-test of #905, #907, #910, #904, #906, #914

Method: detached worktrees at each PR head, node_modules symlinked, PGlite for SQL, real ValidationPipe for HTTP shape, python mutation scripts (restore in finally). Probes and raw outputs: `round19-probes-recipes-hub/`. The shared checkout was not touched. Prior reports: round17-test-recipe-sheet.md (D1-D11), round17-pr-retest-cost-auth.md, round18-pr-retest-auth-mail-hub.md.

Heads: 905 `3a3bf6c08`, 907 `52fd0e358`, 910 `a0a9535ec`, 904 `bfd27bfa7`, 906 `5a6fc6b46`, 914 `20b88c482`.

## Verdicts

| PR | Verdict | Tests fail without the code? |
|---|---|---|
| #905 recipes 400 + house filters | FIXED | Yes. 9/9 filter removals and all cap mutants caught |
| #907 one sheet per drink | FIXED for the harm (D1); residual: silent draft loss, no warning | Yes for the key. 2 mutants survive (test gaps) |
| #910 paste parser, 40 lines | PARTIAL | 15/16 mutants caught. The exactly-40 boundary is unpinned |
| #904 pos-hub poison line | PARTIAL | Yes (migration test fails without migration). 7 of 14 mutants survive |
| #906 rate-limit edge hop | PARTIAL, one new exposure | 13/18 caught. 5 survive, incl. the reset-controller change |
| #914 verify-email mail state | FIXED for its claim; stale-note gaps | New test fails against base: 8 failed / 5 passed. 11/14 caught |

Counts: 2 FIXED, 4 PARTIAL, 0 NOT FIXED, 0 REGRESSION. Claims verify lines for the 906 and 914 claim files all return rc 0 on pristine heads (re-run after the mutation scripts finished).

## #905 FIXED
- `recipes.service.ts:28` `MAX_LINE_QTY = 100_000`, `:228` `assertSavable`, called first at `:243`. It returns a sentence 400 for a line above 100,000 and for yield above 1,000.
- HTTP (real ValidationPipe, `http905.out.txt`): 1e308, 100000.01, 99999999999999999999999 -> 400 sentence, never reaches the DB. null, "abc", true, [5] -> 400 validation list. NaN -> 400 invalid JSON. Yield 0, -1, 1.5, 1e308, 1001 -> 400. 40 lines OK, 41 -> 400. No 500 found.
- PGlite (`sql905.mjs`): qty 0 and -1 -> RCP00 (400). 1e30 and 9.3e12 kg would be a bigint 22003 (500 without the cap); the cap is the only guard (100001 kg is OK at SQL level).
- Mutation: all 9 `.eq("restaurant_id")` removals caught (lines 55, 73, 79, 105, 111, 128, 133, 210, 280). Yield cap off, line cap off, `assertSavable` call removed, cap raised to 1e12 all caught.
- Notes: `cocktail_ingredients` has no `restaurant_id` column, so it is scoped only through `houseCocktail`. Gateway says "Ingredient N", sheet says "Line N". Unverified: the 1,000 yield cap could block an old row whose yield is above 1,000, since the sheet re-sends `current.yieldServes`.

## #907 FIXED for D1
- `RecipeSheet.tsx:182` `<Sheet key={cocktailId}>`. Render probes (27 pass): dirty A, switch to B, B shows its own values; late A save resolve leaves B untouched; B saves with B's `expectedVersionId` and lines. The key lives inside `RecipeSheet`, so any mount is covered. #910 contains this fix (907 is an ancestor of 910).
- Gap, no draft-lost warning: back on A, typed 45 is gone, value reads 30, silently (P2).
- Turkish comma: "22,5"=22.5, "0,5" and ",5"=0.5, " 7 "=7. "1,000" saves as 1 (silent ambiguity, a thousand typed with a comma). "1.000,5", "5,", full-width digits, "1e3" are blocked.
- Gateway sentence: a 400 string message is shown plus "Not saved. Your recipe is as it was." HTML is escaped. 403/422/500 and non-string messages give the generic text.
- Mutation: key removal, gateway sentence, set-aside kept, put-back, cap checks, line-number off-by-one, comma replace all caught. SURVIVE: "save keeps set-aside" and "refusal accepts any status" (no test pins the 400-only rule; behaviour is correct).
- Not tested: the `CocktailRegister` mount (#892) is not in this head.

## #910 PARTIAL
- Cap: 39 or 40 pasted lines work; 41 or 100 shows "That is N lines; a recipe holds at most 40. Remove N-40 before saving." and "Use these lines" is disabled. 3 existing + 37 OK, 3 + 38 refused. A 10,000-line paste reads in 27 ms. Residual: while refused the textarea is hidden, so the user must re-paste. A legacy 45-line recipe can never be used.
- Parser OK: fractions (1 1/2, ¾, ⅓, 3/4oz), "2 dashes X", numbered-list prefixes, unknown ingredient (saves with `inventoryId` null), garnish/ice/twist/rim (PUT body `role:'untracked', qty:1, unit:'each'`, round trip OK), "Top with soda" blocked with a named line.
- Still guesses or mis-reads: "30 mll gin", "30 mlgin", "1 dasher bitters" become N each; "1:1 syrup 15 ml" and "1 . 2 oz gin" give 1 each with junk text; duplicates not merged; amount box reads "1,000" as 1 but the parser keeps it as text (inconsistent). Bare "dash X" and "a dash of bitters" stay text with no amount (safe).
- Mutation: 15/16 caught; "paste cap >= vs >" survives.
- Tests: `RecipeSheet.tsx:74` `MAX_LINES = 40`.

## #904 PARTIAL
- Fixed: a failing line is stamped and goes to the back (`pos-hub.service.ts` `sendToTheBack` ~2267; budgets `REPLAY_TRY_LIMIT` 2000 at :364). Throwing stock writes and bad stored checks (null/garbage closed_at, items) do not crash the save; other rows book. A good sale behind 2100/4100/6100 poison rows books on save 2/3/4 (bounded, ceil(N/2000) saves). Nothing is lost (900 good rows behind 2100 poison book 0/500/400 over three saves).
- Not fixed, no retry cap: a poison line is retried on every save forever.
- Not fixed, no visible dead-letter: `listUnresolvedLines` exposes no `replay_tried_at`, attempt count or cause. The only signal is the "N past sales could not be taken off stock" message.
- Booking order is not chronological in the log (mid, new, old), but each row is dated by its check close.
- Migration `20270501120000_...replay_tried_at.sql` is idempotent, nullable, version unique; the SQL test fails without it (`sql904.mjs`). Analysis only, not tested: the gateway selects and orders by the column, so it must deploy after the migration.
- Mutation: 7 caught, 7 survive (created_at tie-break; house-scope on stamp, an equivalent mutant; pos_checks-unread, other-mapping, toast-other and toast-no-inventory `looked` paths; select dropping the column). The "one save" test only covers 2100.

## #906 PARTIAL, plus a new exposure
- Fixed: client is the entry left of the edge, not the leftmost. A fresh XFF plus one account = 10 of 1500 allowed. Junk left entries collapse to the peer. `TRUSTED_PROXY_HOPS` is clamped to 1 (except "0", which ignores the header, so all users share one bucket). IPv6 collapses to /64 (`bucketAddress`).
- Still open: with a fresh XFF and a fresh email every request, 1000 of 1500 pass in a minute because the peer bucket is 100x the route limit (`rate-limit.guard.ts` `PEER_LIMIT_FACTOR`). Credential stuffing from one address is bounded to about 1000 per minute, not stopped. Rotating /64s inside a /48 allows 1000. Hex-mapped `::ffff:0102:0304`, NAT64 `64:ff9b::` and 6to4 are not folded.
- New: the per-account bucket on `/auth/login` (`accountKey`, `rate-limit.guard.ts:200,371`) counts all attempts for an email. Any anonymous caller can lock out an owner's real login for the window with 12 attempts per minute from rotating addresses. Plus-addresses use a different bucket; a zero-width-space suffix and full-width variants get different keys; emails over 320 chars collapse to one key.
- Direct-to-Railway: a caller who sends XFF equal to a victim's IP burns that IP's bucket (predates this PR). `requestSource` returns the forged entry on the direct road (documented).
- Shared egress: 700 real browsers behind one Vercel egress hit the 500 peer cap on password reset and everyone behind it is refused for 15 minutes.
- Caveat: the central assumption, one edge hop that appends, is not measured in production (the code comment says so) and I did not measure it. If the edge passes a caller-written single entry through, everything is allowed.
- Mutation: 13/18 caught. Survivors: account lowercase, account trim, account key not route-scoped, "reset uses req.ip again" (the controller change is untested), reset client not /64.

## #914 FIXED for its claim, gaps remain
- States in the app are sent / not_sent / unconfirmed (there is no "bounced" or "pending"; both are read as unconfirmed, never as sent; legacy `{}` reads as sent). `not_sent`: alert "We could not send the verification email. Nothing was sent; send it again below.", the Open-the-email steps hidden, resend present (`VerifyEmail.tsx:53`). `unconfirmed`: status note "Sending is taking longer than usual. The email may still arrive; if it has not in a minute, send a new one." (`verificationMail.ts:38`). Both shells behave the same. Rapid triple click sends one POST. Resend replaces the state. Key cleared on a verified link.
- Enumeration: no new leak. The note carries no PII and is read only from the registrant's own tab storage (`mudavym:verification-mail`).
- Defects: the stored state has no owner or email binding, so a different account on the same tab, an already-verified user, or a token-link screen shows "We could not send ... send it again below" in the wrong context. A logged-out user sees "send it again below" but only a "Sign in to resend" button. A resend failing with 429, network error or 401 stacks two alerts, and on a 429 "Nothing was sent" contradicts the cooldown.
- Mutation: 11/14 caught. Survivors: token-branch resend on mail trouble, legacy subtitle ignoring state, `setLastResent(null)` on resend, "read accepts any string". New test against base: 8 failed / 5 passed, so it fails without the code.

## Skipped or unverified
- Railway edge XFF behaviour (not measured).
- #892 page-level mount of the recipe sheet (not in 907's head).
- #904 deploy-order risk (analysis only).
- #905 yield-cap versus old rows (speculation).
