## The /team remove dialog could send no hand-over from a button reading "hand over 1 shift" — CLOSED on `fix/teampay-round4-replace-race` — 2026-09-30

Found by CI run 36728755317, the web job on PR #537, whose diff changes no `apps/web` file. `TeamPayRound4.test.tsx` "a refused shift (an overlap, double booking off) cannot be ticked and says it goes to the open pool" expected `deleteTeamMember('m-gone', undefined, { to: 'm-sam', shiftIds: ['fri'], accept: [] })` and received `('m-gone', undefined, null)`. The file passed 30 of 30 locally on `597f728d9`, and 30 of 30 again with 12 CPU-burning processes and six copies running at once.

**Root cause.** This was a product bug that the test happened to hit, not a test bug.
- `RosterSheet.tsx` built the removal as `useMutation({ mutationFn: () => deleteTeamMember(member!.id, undefined, handingOver) })`, closing over the render's `handingOver`.
- React Query 5.90 (`useMutation.js:20-21`) hands a new `mutationFn` to its observer in a `useEffect`, after the paint. `mutate()` then runs whichever function the last effect installed.
- The shifts are ticked by the picker's own effect once the gateway's checks arrive. That update renders on React's default lane, and its passive effects run as a separate Scheduler task.
- When the render uses up React's 5 ms slice, Scheduler yields between the paint and the effects. A click in that gap finds a button already reading "Remove and hand over 1 shift", but `mutate()` runs the previous render's function, which carries `null`.
- A test that clicks straight after a `waitFor` lands in that gap on a slow runner.

**Fix.**
- The hand-over now travels with the click: `mutationFn: (sent) => deleteTeamMember(member!.id, undefined, sent)` and `onClick={() => remove.mutate(handingOver)}`.
- React updates a DOM node's handler at commit, not in an effect, so the value sent is always the one the button shows.

**Regression test.** "sends what the button says, even when clicked the moment it says it" forces the gap on every run:
- `performance.now` jumps 10 ms per read, so Scheduler yields after every task.
- A `MutationObserver` clicks the moment the label changes.
- On `597f728d9` it failed 10 of 10 with the CI signature (`null`). With the fix it passed 10 of 10, and the whole file passed 30 of 30.
- The original flaky test is unchanged; its assertion was right.

CLAIMS `WEB-TEAMPAY-REMOVE-SENDS-WHAT-THE-BUTTON-SAYS`. The verify exits 1 on `597f728d9`, and also on either half reverted alone.

## Other `mutationFn` closures may carry the same gap — OPEN — 2026-09-30

`grep -rn 'mutationFn: () =>' apps/web/src` (tests excluded) finds 26 closure-style mutations in 16 files at `597f728d9`. Most are probably safe, but none has been audited.
- **Only some shapes are exposed.** A closure is exposed only when the value it reads changes in a render that is not a direct response to user input. For example, it is derived from query data or set by an effect, and the render's passive effects are deferred.
- **Most sites close over stable ids or typed form state.** A keystroke renders on the sync lane, and React flushes that render's passive effects before the commit returns.
- **The fix is the same shape as above:** pass the per-click value to `mutate(...)` instead of closing over it.
- **A check that would close it:** a lint rule or grep guard that flags a `mutationFn` reading component state other than ids.
