# BUILD cellar-dead r84 (2026-11-19)
PR #1953 (draft), base fix/r83-unreachable-recs-ask-auth (#1952), branch fix/r84-cellar-registers-onboarding-dead, head 4c22b633f. Diff 4,844 chars.

Done: deleted apps/web/src/components/onboarding/CellarRegistersOnboarding.tsx (no importer; no test of its own existed). get-started.md lines 59 and 73 now say removed. grep: only a historical comment in styles/mudavym-ground.test.ts:272 remains.
Proof: tsc --noEmit exit 0; vitest GetStarted.cellarRegisters + pages/cellar + styles + components/onboarding: 18 files, 357 tests pass. GetStarted.cellarRegisters.test.tsx already proves the step is not mounted. Mutation: a deletion has no new spec; restoring the file would leave the grep proof as the only check (not a mutation test).

Decision (taken, not asked): delete. Rationale: ADR 0213 moved the question out of onboarding, nothing imports it, and #1946's edit of it is then superseded. Rejected: keep and wire back in (reopens a closed ADR 0213 decision); leave dead (keeps stale edits alive). Deferred: a cellar-registers question at /get-started is a separate future slice. CellarRegistersStep and useCellarRegisters stay (cellar page uses them).
Not done: ADR/planning prose in wines.md, 0113, 0169, sketch 101 still name the file historically (left as record).
