## The /team remove dialog could send no hand-over from a button reading "hand over 1 shift" — CLOSED on `fix/teampay-round4-replace-race` — 2026-09-30

Found by CI run 36728755317, the web job on PR #537, whose diff changes no `apps/web` file. `TeamPayRound4.test.tsx` "a refused shift (an overlap, double booking off) cannot be ticked and says it goes to the open pool" expected `deleteTeamMember('m-gone', undefined, { to: 'm-sam', shiftIds: ['fri'], accept: [] })` and received `('m-gone', undefined, null)`. The file passed 30 of 30 locally on `597f728d9`, and 30 of 30 again with 12 CPU-burning processes and six copies running at once.

**Root cause.** This was a product bug that the test happened to hit, not a test bug.
- `RosterSheet.tsx` built the removal as `useMutation({ mutationFn: () => deleteTeamMember(member!.id, undefined, handingOver) })`, closing over the render's `handingOver`.
- React Query 5.90.16 (`build/modern/useMutation.js:20-22`) hands a new `mutationFn` to its observer in a `useEffect`, a passive effect that runs after the commit (in a browser, after the paint). `mutate()` then runs whichever function the last effect installed.
- The shifts are ticked by the picker's own effect once the gateway's checks arrive. That update renders on React's default lane, and its passive effects run as a separate Scheduler task.
- When the render uses up React's 5 ms slice, Scheduler yields between the commit and the passive effects. A click in that gap finds a button already reading "Remove and hand over 1 shift", but `mutate()` runs the previous render's function, which carries `null`.
- A test that clicks straight after a `waitFor` can land in that gap on a slow runner.

**Fix.**
- The hand-over now travels with the click: `mutationFn: (sent) => deleteTeamMember(member!.id, undefined, sent)` and `onClick={() => remove.mutate(handingOver)}`.
- React 18.3.1 updates a DOM node's handler props at commit (`updateFiberProps` in `commitUpdate`), not in an effect, so the value sent is the one computed in the same render that drew the button's label.
- Unchanged, and not audited here: the rest of the mutation's options are still installed by that same effect. `mutationFn` reads `member!.id`, and `onSuccess` calls the `onChanged` and `onClose` props. So the one-render gap applies to them too. This PR moves only the hand-over, the one value that changes per click, out of that path.

**Regression test.** "sends what the button says, even when clicked the moment it says it" forces the gap on every run:
- `performance.now` jumps 10 ms per read, so Scheduler yields after every task.
- A `MutationObserver` clicks the moment the label changes.
- On `597f728d9` it failed 10 of 10 with the CI signature (`null`). With the fix it passed 10 of 10, and the whole file passed 30 of 30. Those runs used the test before its `try/finally` cleanup. At `e1bb0101f`, both PR #544 reviewers re-measured: with only the fix reverted, 10 of 10 red, each on the final assertion with `null`; with the fix, 10 of 10 green, and the whole file 10 of 10.
- The original flaky test is unchanged; its assertion was right.

CLAIMS `WEB-TEAMPAY-REMOVE-SENDS-WHAT-THE-BUTTON-SAYS`. The verify exits 1 on `597f728d9`, and also on either half reverted alone.

## Other `mutationFn` closures may carry the same gap — OPEN — 2026-09-30

`grep -rn -E 'mutationFn:\s*(async\s*)?\(\s*\)\s*=>' apps/web/src` (tests excluded) finds 30 zero-argument closure mutations in 19 files at this branch's head. That is 26 of the form `() =>` and 4 of the form `async () =>`. The pattern is a heuristic. It misses a `mutationFn` that takes arguments and still reads component state, and it counts sites that close over nothing but stable ids. None of the 30 has been audited.
- **When a site is exposed.** A site is exposed only when the value it reads changes in a render whose passive effects React defers, and a click lands before they run.
  - A render caused by a `setState` inside an effect, as the picker's ticking is, is on the default lane, and its effects are deferred. A React Query result arrives through `useSyncExternalStore` on the sync lane, but an effect that reacts to it is back on the default lane.
  - A keystroke's update is a discrete, sync-lane update, whose effects React flushes before the commit returns. That no longer holds once the update is wrapped in `startTransition` or read through `useDeferredValue`.
- **The fix is the same shape as above.** Pass the per-click value to `mutate(...)` instead of closing over it.
- **A check that would close it:** a lint rule or grep guard that flags a `mutationFn` reading component state other than ids.
