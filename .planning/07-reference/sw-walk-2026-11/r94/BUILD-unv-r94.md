# BUILD r94 unverified-confidence (2026-11-19)

PRs (DRAFT): #1966 gateway (fix/r94-unv-confidence -> fix/r93-priors-verify, 9,061 chars), #1967 web words (fix/r94-unv-card-words -> fix/r91-taste-line / #1962, 5,796 chars).

## Decisions recorded (no founder question asked)
- Base: the brief said stack on #1964's branch, but the UNV codes exist only on #1965's branch (fix/r93-priors-verify, itself on #1964), so the gateway PR stacks there.
- Web: the "Worked out from:" line (taste-worked-from) is not in the #1964 chain (it lives in #1960/#1962), so the web half is a separate PR on #1962's branch.
- Factor 0.8 (UNV_Q_FACTOR): verified figures sit within ~10 % of the source page; UNV ones were recalled, cut-dependent or off by 20-25 % (hard cheese Na 1530 vs 1175 mg, feta 917 vs 1139). Twice the error, a fifth less belief. A starting value for the blind panel to fit, not a measurement. Applied through classQ() on both paths that read a class q (pure class-prior line; good borrowing unstated axes).
- Marker: pure class-prior lines from a UNV class get from 'class_prior_estimate'; prov stays 'class_prior', basis.classPrior count unchanged. A good-with-own-layer line stays 'good' (its own taste leads), but its borrowed share is discounted.
- PRIORS_VERSION 4 -> 5 (stored layers carry old confidence).
- Card words: "Tomato (typical of its kind, an estimate)", extending the existing "typical of its kind". No numbers (ADR 0104). The web parser would have dropped the new value silently without the PR (keeps only known values).

## Proof
- Gateway: tsc -p tsconfig.spec.json exit 0; full jest 656 suites passed, 12111 tests passed, 14 skipped. Taste suites 130 -> 131 tests pass.
- Mutations (each fails a new test): classQ(cls) -> cls.q on the pure path; marker -> 'class_prior'; borrowed average -> raw q (needed an extra test, added).
- Web: vitest inventory + cellar recipe + services/api 55 files / 1063 tests passed; tsc has no apps/web errors (only packages/ui unresolved modules, worktree link artifact). Mutations: wording back to plain; parser set without new value, both fail.

## Not done
- Web full vitest suite not run (touched folders only). No browser check (told not to start the stack).
- 0.8 is unfitted. The "Lime juice" example in the brief is class lemon-lime, which is not UNV, so it keeps "typical of its kind"; the estimate wording shows on tomato, bacon, feta, hard cheese, stock and the other UNV classes.
