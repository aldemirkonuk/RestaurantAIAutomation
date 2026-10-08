> **[2026-10-06 ~19:53Z, coordinator, at merge] Merging head `fd4001395`.** The ADR 0090 three-role audit PASSED at this head (plan READY, both reviews APPROVE WITH NOTES, final HOLDS; comment 6021501171). The final reproduced the F9 race on its own (the `/stats` mock delayed 150 ms: the old `getByText` fails with the CI error, the new `findByText` passes). Required CI is green at this head and the branch is up to date with main `5c07cfb23`. One sentence below is narrowed in place, as the reviewers asked: "Three candidates were refuted" now names lines 858, 860 and 902. Two optional follow-ups from the final are not done here: assert `role="alert"` in the 403 test (the old test never pinned it either), and a real-IndexedDB or fake-timer case for F12.

**What this is.** A test-only change to `apps/web/src/pages/receiving/next/ReceivingNext.test.tsx`. No product code changes, one file.

**Why.** F9 ("states the settled-claims failure while the headline figure stands") failed on CI run 37413068256 (PR #622, 2026-10-06 ~04:31Z) with `Unable to find an element with the text: ≥$900`; the headline still showed the em dash. Locally it passed 51/51 in both EDT and UTC.

The cause: the test awaited the settled-claims failure, which comes from the credited-list query, and then read `≥$900` in the same tick. That figure comes from a different query (`/stats`) and is drawn by `RcTally`, which sets its figure in a post-commit effect. On a slow runner the alert can be in the DOM before the headline has its number.

**Reproduced.** I delayed only the `/stats` mock by 150 ms in a scratch copy:
- The original assertion fails with the CI error, `Unable to find an element with the text: ≥$900`.
- `await screen.findByText('≥$900')` passes in the same delayed copy.

**The sweep.** The task asked for a sweep of the file for the same pattern. Workflow `wf_8b40cee3-6e7` ran three finders with three lenses:
- by data source;
- by query-ordering mechanics (react-query 5.90 `notifyManager`);
- by vacuous negatives and loading-state awaits.

They raised 17 candidates, 9 after dedup, and each of the 9 went to an adversarial verifier. Verifiers worked in scratch copies: they delayed the right mock or injected the regression the test guards, then ran the original and the fixed assertion side by side. Every scratch file was deleted afterwards, and the worktree is clean.

| Line (on main) | Test | Finding | Fix |
|---|---|---|---|
| 885 | F9, headline figure stands | **Flake** (the CI failure) | `await screen.findByText('≥$900')` |
| 564 | F6, absent figure is an em dash | Could not fail. The awaited tab paints before the queue answers, and the lane counts and header are dashes too. With the row forced to `$0`, it still passed. | Wait for the row and look for the dash inside it |
| 804 | F7, silent for a measured zero | Could not fail. The negative ran before the queue answered, so with the regression injected it passed and the strip appeared afterwards. | Wait for `Nothing to chase`, which renders only once the queue has answered |
| 848-851 | F8 owner 403 | Could not fail. The trend alert alone says "not permitted" and "HTTP 403", so it passed with the headline no longer telling 403 from 500. | Scope to the headline's own alert |
| 858-862 | F8 owner 500 | Could not fail. The trend alert prints the same status and message, so it passed with the headline swallowing them. | Scope to the headline's own alert |
| 420 | F12, Discard asks first | Could not fail. `discard()` reaches `removePendingMutation` only after an awaited read, so a "discard on no" landed after the negative had run. | Flush one macrotask before the negative |

Each of the five tightened assertions was shown to:
- fail against its injected regression;
- pass against the real code, including with the relevant mock delayed 150 ms.

Three candidates were refuted (lines 858, 860 and 902; 858 and 860 are counted separately, so six fixed plus three refuted makes the nine):
- **Lines 858 and 860, as a flake.** Both owner queries reject at the same promise depth, so both alerts commit together. The scoping fix above removes the dependency anyway.
- **Line 902.** The credited list settles in the same commit as the stats that render "No discrepancies found yet", so its negative does catch the regression.

Everything else in the file was cleared with a one-clause reason each. The per-line list is in the workflow output.

**Stability**
- 20 consecutive runs of the file in local time (EDT): 51/51 every time.
- 20 in `TZ=UTC`: 51/51 every time.
- ESLint is clean, run with the jsx-a11y resolve recipe. The same run fails on an injected mutation, so the clean result is a real one.

**Not covered**
- CI's runner speed cannot be reproduced locally, so the F9 fix is proven by forcing the order with a delayed mock, not by a slow machine.
- The regression proofs for the five tightened assertions are the sweep verifiers' scratch experiments, not re-run by me on the final file. The text I applied is theirs, plus comments.
- A comment in the file (around the F5 short-window and EUR tests) says the manager header `RcTally` lags the row by a tick. One finder measured no lag there, because the header remounts with its value. Those tests use `waitFor`, so the comment is harmless and is left alone.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
