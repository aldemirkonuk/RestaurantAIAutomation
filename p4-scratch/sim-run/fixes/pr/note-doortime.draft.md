> **[2026-10-07 12:39Z, fixer, local head 78c0f16e5]** Not pushed; the coordinator pushes. This answers the ADR 0090 BLOCK at `be073f594`, which was on prose only: three records called open what the same tree records as decided. Commits since `be073f594`:
> - `4d0ac8a22` merges origin/main `5e6c0684e` (#620), clean, through `merge_main.sh`. It carries git's default merge message. #620's migration is `20261223030000`; this PR's `20261223040000` stays later, and the migration-order and uniqueness guards exit 0.
> - `78c0f16e5` is docs and comments only:
>   - The migration header line and the `delivered_at` comment in `receiving.service.ts` now say the backfill was declined (ADR 0286 follow-up 3). Each is one comment line. No SQL statement and no code changed, and no line count moved, so `file:line` citations still hold.
>   - README row 0286 now names only what is still open. Follow-ups 1 and 8 are each owed a fix. Follow-up 5, the read-side as-of control, was not asked and is not filed. It also says 4(b) and 4(c) are possible but not owed. Backfill, the refused-order date and the floor are gone from the row, because follow-ups 3, 6 and 7 are answered as built.
>   - ADR 0286 has new dated brackets, each keeping the old words as "Was: ...". They cover line 57 ("or a backfill is chosen"), the Follow-ups heading, and the headings of follow-ups 3 and 7. Further brackets mark the follow-up 6 and 7 sentences that predate their answers, and one review-trail row was added.
>   - The tech-debt entry gets the same brackets on lines 33, 35, 50, 52, 58, 60 and 62.
>
> At `78c0f16e5`:
> - `lanecheck.sh`: every guard has rc=0 (migration order and uniqueness, OD ids, conflict markers, citation pairing, ADR numbers). The branch is 15 files against origin/main `5e6c0684e`, and ownership is `[]`.
> - Decision claims under Python 3.11: 926 checked, 926 holding.
> - `npx jest src/procurement/receiving.spec.ts src/notifications`: 29 suites and 506 tests pass.
>
> **Stale lines in this PR body (the coordinator edits them):**
> - "No fork is left open on this branch." → "No fork this branch raised is left open. The read-side as-of control (ADR 0286 follow-up 5) was not asked and stays open. It is outside this PR and is not filed yet."
> - "Founder answers to the "Forks deferred" below" → "Founder answers to the "Forks answered" below"
> - "`tech-debt.d/2026-10-04-fix-door-keeps-the-arrival-time.md`: 2 CLOSED entries and 5 OPEN ones." → "`tech-debt.d/2026-10-04-fix-door-keeps-the-arrival-time.md`: 4 CLOSED entries, 1 ANSWERED and 2 OPEN."
> - "CLOSED: receipt dating; the stock-movement date." → "CLOSED: receipt dating; the stock-movement date; a late sync onto an order that refuses the receipt (no change); no floor on back-dating (no change). ANSWERED: backfill (forward-only, no change)."
> - "OPEN: the door-count and delivery-create routes; backfill (fork); a late sync onto an order that refuses the receipt; no floor on back-dating (fork); the retroactive-order route." → "OPEN: the door-count and delivery-create routes; the retroactive-order route."
> - "## Forks deferred (each is the founder's; none changes this PR's code under the recommendation)" → "## Forks answered (each was the founder's; he picked the recommended option every time, so none changes this PR's code)"
> - "A read-only query to size (b) per house, for the coordinator to run if the founder asks (it was run only on an empty local database):" → "(b) was rejected on 2026-10-06, so nobody needs to run this sizing query; it is kept for the record (it was run only on an empty local database):"
> - Under the refused-order fork, "(a) As built. **Recommended until ruled.**" → "(a) As built. **Chosen on 2026-10-07: "Leave it, logged (Recommended)".**"
> - "**Old rows are not re-dated** (the backfill fork)." → "**Old rows are not re-dated**: the founder declined a backfill on 2026-10-06 (ADR 0286 follow-up 3)."
> - The 04:16Z block's "The branch is 15 files against origin/main `42fe1252b`" and "This head is not audited" both describe `be073f594`. This block replaces them for `78c0f16e5`.
>
> **Not done:**
> - The live body is not edited, and nothing is pushed.
> - Local Postgres (pgtest) was not re-run. The migration change is one `--` header line, and the `COMMENT ON COLUMN` text is untouched.
> - `DoorNext.test.tsx` and the other web tests were not run, because no web file changed.
> - The "Recommended" markers inside each answered fork in this body are left as historical text. Only the lines above are flagged.
> - This head has not been audited. A fresh full ADR 0090 audit of `78c0f16e5` is owed before merge.
