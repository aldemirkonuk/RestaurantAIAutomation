# BUILD gw r88 (2026-11-19): taste roll-up role gate (r87 finding 3)

Branch fix/r88-taste-rollup-role, head d1e92c427, stacked DRAFT PR #1959 on #1958 (feat/taste-r86-rollup-layers).
Why stacked: #1958 diff is 27,778; the fix makes it 33,352 (> 30,000). #1959 diff 5,574.
Propagated by plain merge: resolve/r84-recipe-taste-meet 6ff1852fb, resolve/r85-dish-taste-meet 2b1dfbb84 (both already contained #1958's head; no PRs of their own; #1954 diff 10,007, #1956 4,040 unchanged in size).

## Change
apps/api-gateway/src/taste/taste.controller.ts: rollup() checks tenant (subject()), then `roleSatisfies(user.role, 'manager')`; else ForbiddenException(ROLLUP_REFUSAL = "Working out a taste from a recipe is for the house's owners and managers."). Caller type gained `role`.
Spec: taste.controller.spec.ts (+owner/manager run, staff/null/undefined/admin/nonsense refused with sentence and service not called, other-house owner refused as not-your-house, preview + read open to staff).

## Decisions
- Inline roleSatisfies, not @Roles/RolesGuard: RolesGuard answers only "Forbidden resource"; brief wants a sentence; precedent assertSeesHouseAmounts (dashboard) and approval gate. Rejected: @Roles + exception filter (new machinery); a dish-only gate (cocktail rolls up too).
- roleSatisfies ranks admin/null/unknown below manager = RolesGuard exactness (ADR 0164); null never satisfies (absence-reported-as-health).
- Only the roll-up is gated. POST .../house writes a house-source layer authored by the caller (their own palate), not a recipe layer; preview writes nothing; both stay open to any member (class doc: roles gate money, not palates). Rejected: gating /house (would stop staff describing taste; product call not in brief).
- Tenant check first so other house reads "That is not your house." (403), not the role sentence.

## Proof
- jest src/taste/taste.controller.spec.ts: 12 passed. Pre-fix: 5 failed, 7 passed.
- Mutation (committed first): check -> `if (false)`: 5 failed 7 passed; admit staff: 1 failed 11 passed. Restored.
- Full gateway jest: Test Suites 2 skipped, 654 passed; Tests 14 skipped, 12085 passed.
- tsc --noEmit -p tsconfig.json: no output beyond TS2307.

## Not done
- No HTTP-level (supertest) 201/403 test; unit test calls the handler. @HttpCode(201) untouched.
- Web side untouched (already hides the button from staff).
- No browser/stack check (told not to start it).
