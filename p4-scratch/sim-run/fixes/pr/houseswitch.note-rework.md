> **Coordinator note, 2026-10-08T00:55Z. The new head is `c18c94a5f`.** It answers the ADR 0090 BLOCK at `505a03400` (`audits/654-505a03400/report.md`). A BLOCK is permanent, so this head needs a fresh full audit.
>
> **Merge order:** #654 now cites **ADR 0306** (`0306-who-takes-an-entry-is-anyone-on-this-houses-roster.md`). That ADR lives on its own docs PR, branch `docs/who-takes-an-entry-reads-the-house-roster` at `606004296`, so this PR stays at 15 files. **That docs PR must merge first.**
>
> **The decision.** Who takes an entry is any row of this house's roster, whatever its status. The coordinator decided this under the founder's 2026-10-07T20:04:10Z delegation; it is not the founder's pick.
> - The gateway refuses an `assignedTo` that is not a uuid or not a row of the path house's `team_members`. It does not read the row's status.
> - The page offers every row the roster read returns.
> - Grounds:
>   - F4 (2026-09-06): *"the roster it reads is the team's"*.
>   - ADR 0215 item 19: *"Only removal counts"*.
>   - Every other named roster pick at the gateway ignores status.
>   - An assignment is a note that sends and grants nothing (ADR 0191).
> - Rejected, with reasons in the ADR: active only (this PR at `505a03400`), `{active, trial}`, a three-value fail-closed list, and a page-only active filter.
>
> **What the BLOCK raised, and what changed:**
> 1. **Dropping `trial` rows was not a recorded decision.** ADR 0306 records the rule. The code now follows it:
>    - `assertAssigneeOnRoster` selects only `id` and refuses only a missing row (`recommendation-actions.service.ts:449-476`).
>    - The refusal reads *"That person is not on this house's team, so the entry was not assigned to them."* (`:454`). The word "active" is gone.
>    - `loadTeam` has no status filter (`useRecommendationsNextData.ts:817`).
>    - The `setAction` comment now says only what the code knows (`:486-488`). It is the only write of `assigned_to`, the bulk route passes no `assignedTo`, and an `assignedName` alone is not checked.
> 2. **The CLAIMS row cited ADR 0218 r4a3.**
>    - The row is renamed `TD-2026-10-07-ASSIGNEE-ON-THIS-HOUSES-ROSTER` and cites ADR 0306 by number and slug, with no ADR 0218 citation.
>    - It checks that `status` appears nowhere in `assertAssigneeOnRoster`, that the read selects `"id"`, and that exactly one `assigned_to =` write exists.
>    - `TD-2026-10-07-RECOMMENDATIONS-ROSTER-AND-FIGURES-BY-HOUSE` now claims "every row … with no status filter".
>    - Tech-debt item 5 is replaced in place, bracketed and dated, and lists the residuals.
> 3. **"A refused switch forgets nothing" was broader than the code.**
>    - The test is now named "a switch the server refuses forgets nothing" (`houseSwitch.test.tsx:310`).
>    - It also asserts that `clearEntityCache` is not called.
>    - A comment (`:307-309`) says that a switch overtaken by a later one, after its POST answered, has already emptied the device read cache.
>    - The code is unchanged.
>
> **Evidence at `c18c94a5f`.** `origin/main` `62f8967b4` was merged in first, as `1cc13f44d`, with no conflicts.
> - **Gateway jest `src/analytics`:** 57 suites, 880 tests pass. The roster spec has 10 tests: trial, inactive and an unlisted status (`on_leave`) are accepted, and the read filters are exactly `restaurant_id` and `id`.
> - **Web vitest** (`src/pages/recommendations/next` + `houseSwitch.test.tsx`): 18 files, 343 tests pass.
> - **tsc:** gateway and web, 0 errors outside `@simplewebauthn`.
> - **Claims:** 946 checked, 946 holding. All 4 lane rows exit 1 on `origin/main`.
> - **lanecheck:** every rc=0, files=15.
> - **Mutations.** Each was copied with `cp -p` first and restored byte-identical (`cmp`):
>   - (a) Drop the house filter: 5 spec tests fail, and the claim exits 1.
>   - (b) Flip to active only: 3 fail, and the claim exits 1.
>   - (b2) `{active, trial}`: 1 fails, and the claim exits 1.
>   - (c) Three-value list: 1 fails (the unlisted status), and the claim exits 1.
>   - (d) Web active-only filter: 1 vitest fails, and the roster claim exits 1.
>   - (e) Clear the device cache before the POST: 2 houseSwitch tests fail. This one is test-only; no claims row pins that order.
>
> **Not done.**
> - No browser was driven.
> - Production `team_members.status` was not read.
> - Disclosed residuals, not closed:
>   - An `assignedName` sent alone is still unchecked.
>   - The popover shows no status tag, so an inactive person looks active (a tag is owed).
>   - An assignment outlives a later status change or removal.
>   - Invite placeholders are assignable.
>   - Staff see "roster could not be read", yet the gateway accepts a roster id they send.
> - Prettier `--check` flags the five touched code files. The three of them checked at `505a03400` were already flagged there, and no workflow under `.github/workflows` names prettier. Gateway eslint on the two gateway files reports 0 errors and 27 warnings. Web eslint did not run in this worktree: it could not load `eslint-plugin-jsx-a11y`.
> - The PR body below this note still describes `cf2f2a06c`. This note supersedes it wherever they differ.
