## What

A CI guard (`scripts/check_optional_inject_tokens.py`, own job `optional-inject-tokens`, listed in CI Complete) that fails any `@Optional()` constructor parameter with no `@Inject(...)` whose type has no runtime token: `Pick`/`Partial`/`Omit`/`Required`/`Readonly`/`Record`/etc., an inline object or real union type, an interface, a type alias, or an `import type` name.

## Why

Nest reads a constructor parameter's token from emitted type metadata. Those types emit `Object`, and with `@Optional()` Nest injects `undefined` instead of failing at boot, so the dependency is silently absent in production. #1560 found one in the delivery service.

## Sweep result (r42)

- origin/main (c459b0a12): 71 `@Optional()` uses, 0 offenders.
- All 1008 open PR tips fetched; the 72 whose diff adds an `@Optional()` line were scanned file by file: 0 offenders. The only instance of the bug anywhere is the one #1560 already fixes with `@Inject(VendorSendAuthorityService)`.
- So there is nothing else to fix and no per-provider boot test to add; the guard is the deliverable.

## Proof

- `python3 scripts/check_optional_inject_tokens.py` -> clean (1482 files).
- `--self-test` -> ok (12 shapes plus a multi-parameter constructor).
- Mutations, each killed: disabling the utility-type rule, the interface/alias rule, or the `@Inject` exemption makes `--self-test` fail. Stripping `@Inject` from #1560's tip makes the guard flag `authority: Pick<VendorSendAuthorityService, ...>`.

## Not covered

A plain class name whose provider is not registered in the module is a different fault (Nest's own `@Optional()` then yields `undefined` by design) and is out of scope. Property-style `@Optional()` is not scanned: Nest only property-injects with `@Inject`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
