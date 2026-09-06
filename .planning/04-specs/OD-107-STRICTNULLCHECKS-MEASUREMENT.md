# OD-107 — `strictNullChecks` in the gateway: the measurement

**Status:** measurement only. Nothing was fixed and no `tsconfig` was changed.
**Taken:** 2026-08-27, against `origin/main` @ **`1bcc954d`**, TypeScript 5.3.3
(the version `pnpm-lock.yaml:8` pins — the gateway's `package.json` asks for
`~5.7.0` and does not get it).
**Re-measured once, and it moved.** The first pass ran at `0efe4ba4`; `1bcc954d`
(P3.C, one commit later) landed while this was being written and added **one more
error**, in `ask-ai`. Every figure below is from the re-run — see §9, because that
one-commit drift is itself a finding.
**Answers:** `OD-107 (OPEN-DECISIONS.md:83)`, which says *"A measurement first:
how many errors does `tsc --noEmit --strictNullChecks` actually report? Nobody
has run it. That number decides whether this is a week or an afternoon."*

---

## 0. The answer in one line

**26 errors in 11 of 440 files** — 12 of those errors in 6 production files, the
other 14 in test files. It is an afternoon.

**But the flip does not buy what OD-107 wants it to buy**, and that is the more
important half of this document. See §5.

---

## 1. How this was measured, so it can be re-run

No committed file was edited. A throwaway config was written next to the real
one, run, and deleted:

```json
{ "extends": "./tsconfig.spec.json",
  "compilerOptions": { "noEmit": true, "incremental": false,
                       "pretty": false, "strictNullChecks": true } }
```

```
cd apps/api-gateway && ../../node_modules/.bin/tsc --noEmit -p <that file>
```

Three things had to be checked before any number here is worth anything:

| Check | Result |
|---|---|
| Does the gateway typecheck clean **today**? | Yes — `tsc -p tsconfig.spec.json` exits 0, 0 errors. Every error below is caused by the flag, not pre-existing. |
| Did the compiler actually see the whole app? | Yes — `--listFiles` reports **440** files under `src/`, matching `find src -name '*.ts' \| wc -l` exactly. 331 production + 109 spec. 82,782 LOC. |
| Which config does CI run? | `apps/api-gateway/package.json:10` — `tsc --noEmit -p tsconfig.spec.json`. That config includes `src/**/*` with **no** spec exclusion, so CI typechecks specs too. `tsconfig.json` (what `nest build` uses) excludes them. Both are reported below. |

### A trap that produced a wrong number on the first attempt

Setting only `"strict": true` in the extending config **does not turn on
`strictNullChecks`.** `apps/api-gateway/tsconfig.json:15` sets
`"strictNullChecks": false` explicitly; `extends` merges that key into the child,
and an explicitly-set individual flag beats `strict`. The first `strict: true`
run reported 400 errors, all `TS2339`, and zero null errors — it had silently run
with null checks still off. Every "strict" figure below sets
`strictNullChecks`, `noImplicitAny` and `strictBindCallApply` individually.
Anyone re-running this should do the same or they will measure the wrong thing.

---

## 2. The numbers

Baseline (as committed) = **0 errors** in all rows.

| Configuration | Errors | Files w/ ≥1 error | Prod / spec |
|---|---:|---:|---|
| `strictNullChecks` — CI config (`tsconfig.spec.json`) | **26** | **11 / 440** | 12 / 14 |
| `strictNullChecks` — build config (`tsconfig.json`, no specs) | **12** | **6 / 440** | 12 / 0 |
| `strictNullChecks` + `noImplicitAny` | 35 | 17 / 440 | 20 / 15 |
| `noImplicitAny` alone | 163 | 39 / 440 | — |
| **Full strict** (all flags genuinely on) | **880** | **100 / 440** | 865 / 15 |

(The two middle rows are from the `0efe4ba4` pass and are one error light each;
they are directional only and nothing below depends on them.)

`noImplicitAny` alone is a misleading row and should not be quoted: 130 of its
163 errors are `TS7018` on object literals like `{ trace_id: null }`, which only
fire *because* `strictNullChecks` is off. Turn both on and they vanish — which is
why the combined figure (35) is smaller than `noImplicitAny` alone (163).

### By error code

**`strictNullChecks` (26):** TS2322 ×7, TS18047 ×6, TS18048 ×6, TS2345 ×5,
TS2783 ×1, TS2769 ×1.

**Full strict (880):**

| Code | Count | What it is | Null-safety value |
|---|---:|---|---|
| TS2564 | 444 | `strictPropertyInitialization` on NestJS DTO fields | none |
| TS18046 + TS2339 | 372 + 28 | `useUnknownInCatchVariables` — `catch (e)` then `e.message` | none |
| TS7006/7053/7016 | 11 | `noImplicitAny` (2 are just a missing `@types/amqplib`) | none |
| the null family | 25 | the `strictNullChecks` set above | this is the whole point |

**844 of 880 full-strict errors — 96% — come from two flags that have nothing to
do with null safety.** Every NestJS codebase turns
`strictPropertyInitialization` off (class-validator fills those fields at
runtime); `useUnknownInCatchVariables` is satisfied by `catch (error: any)`,
which this repo already writes in roughly half its catch blocks (e.g.
`procurement.controller.ts:548`).

### By module — is it concentrated?

`strictNullChecks`, production only — **12 errors, 6 files, 5 modules**:

```
6  ask-ai/ask-ai.service.ts
2  toast/toast.service.ts
1  auth/auth.service.ts
1  auth/strategies/microsoft.strategy.ts
1  procurement/procurement.controller.ts
1  providers/provider-intelligence.service.ts
```

This is as concentrated as a distribution gets. **222 of 228 production files are
already clean under `strictNullChecks`.** The per-module ratchet OD-107 floats as
the alternative to a milestone has nothing to ratchet — there are five modules,
and one of them (`ask-ai`) is half the total.

Full strict spreads much wider (100 files, 36 modules), but that spread is the
DTO and catch-block noise, not null safety: the top files are
`dashboard/dto/dashboard-summary.dto.ts` (58), `inventory-ledger/dto/…` (42),
`calendar/dto/…` (40) — all pure `TS2564`.

---

## 3. Genuine defects vs mechanical noise

`strictNullChecks` produces only 26 errors, so **all 26 were classified — this is
the population, not a sample.** A further 22 full-strict errors were read across
11 more files to confirm the `TS2564` / `TS18046` families are uniform. 48
diagnostics examined across 22 files in total.

### All 12 production errors

| # | `file:line` | Code | Verdict |
|---|---|---|---|
| 1–3 | `ask-ai/ask-ai.service.ts:300,301,302` | TS18048 | **Modelling gap, not a runtime bug.** See §4.1. |
| 4–5 | `ask-ai/ask-ai.service.ts:270,290` | TS2345 | Same cause. |
| 6 | `ask-ai/ask-ai.service.ts:447` | TS2322 | Same cause, second result type — `check.payload` is `Record<string, unknown> \| undefined` assigned into `executedPayload: … \| null` (`:428`). Arrived in `1bcc954d`. |
| 7 | `auth/strategies/microsoft.strategy.ts:41` | TS2322 | **Real latent defect.** See §4.2. |
| 8 | `procurement/procurement.controller.ts:546` | TS2345 | **Real, minor.** See §4.3. |
| 9 | `auth/auth.service.ts:739` | TS2345 | Mechanical. `let userId: string \| null = null` at `:646` is assigned at `:704`, before the call; the declaration is wider than the flow. Fix is a narrowing assert. |
| 10 | `providers/provider-intelligence.service.ts:448` | TS2345 | Mechanical. `const result = []` at `:423` infers `never[]` once nulls are checked. Fix: annotate the array. |
| 11–12 | `toast/toast.service.ts:77,79` | TS2322/TS2769 | Mechanical, but flags a real API misuse: `configService.get<string>("TOAST_WEBHOOK_SECRET", null)` matches no `ConfigService.get` overload — the second argument is a default value, and `null` is not one. The field is correctly declared `string \| null` at `:46` and guarded at `:89`, `:126`, `:217`, so behaviour is fine. |

### All 14 test errors — mechanical, every one

- `__tests__/dashboard.service.spec.ts:206,208,209,218,219,220` — `result.reports`
  is `T | null`; line `:205` asserts `expect(result.reports).not.toBeNull()` and
  the compiler cannot see through a Jest matcher. Fix: `!`.
- `simpos/simpos.service.spec.ts:340,341,353` — `Array.prototype.find` returns
  `T | undefined` in a test that knows the row exists.
- `calendar/calendar.controller.spec.ts:151,152`,
  `providers/providers.controller.spec.ts:136,177` — optional DTO fields assigned
  into required response-DTO fixtures.
- `notifications/notifications.controller.spec.ts:416` — `TS2783`: `userId` is set
  and then overwritten by `...updateDto`. The line is dead. A genuine (if
  harmless) test bug, and the only error in the whole run that is a *logic*
  finding rather than a *type* finding.

### The ratio

**Production: 3 of 12 genuine (25%), 9 mechanical.**
**All 26: 4 genuine (15%), 22 mechanical.**
**Full strict, 880: ~4 genuine (0.5%).**

"Genuine" here means *a value that can actually be null at runtime and is used
anyway*: §4.2, §4.3, and the dead `userId` line in
`notifications.controller.spec.ts:416`. The six `ask-ai` errors are counted as
**not** genuine — the invariant holds at runtime — but they are not noise either;
see §4.1.

---

## 4. The defects worth naming

### 4.1 `ask-ai` — the workaround OD-107 was filed over, and its cost

`ask-ai-actions.ts:86-92`:

```ts
export interface ActionValidation {
  ok: boolean;
  /** Present when `ok`. */
  action?: AskAiAction;
  /** Present when not `ok`. Always set — a refusal with no reason is a dead end. */
  reason?: string;
}
```

That comment — *"Present when `ok`"* — is the invariant the compiler is being
asked to take on faith, written down because it could not be expressed. This is
exactly the flattening OD-107 describes, and **6 of the 12 production errors —
half — are its bill.** After `if (!validation.ok) return …`
(`ask-ai.service.ts:259`), `validation.action` is still `AskAiAction | undefined`,
so `:270`, `:290`, `:300-302` all error.

Not a runtime bug: `validateAction` never returns `{ok: true}` without an action.
But it is the precise shape the OD warns about — a narrow a reader believes and
the compiler never checked. With `strictNullChecks` on, the type can go back to
`{ok: true; action} | {ok: false; reason}` and these errors disappear rather than
needing fixes.

**And it is spreading.** OD-107 says the pattern was hit *twice*. It is now three
times in one feature, and the third instance says so in the source —
`ask-ai.service.ts:551-554`, on `validateEdit`'s return type:

```ts
    // Flat, not a discriminated union — the THIRD time OD-107 has forced this
    // in one feature. `strictNullChecks: false` means a boolean discriminant
    // does not narrow, so the union form is a compile error on every field
    // access. Recorded there; worked around here.
```

That third workaround is error #6 in the table above (`:447`), and it landed in
the single commit between this document's two measurement passes.

### 4.2 The one real latent bug: `microsoft.strategy.ts:41`

```ts
const user = await this.authService.findOrCreateOAuthUser({
  provider: "microsoft",
  providerId: profile.oid,        // <- string | undefined
  email,
  name: profile.displayName || email,
});
```

`IProfile.oid` from `passport-azure-ad` is optional — Azure AD omits it for some
tenant/account configurations. `findOrCreateOAuthUser` declares
`providerId: string` (`auth.service.ts:1490-1494`) and writes it to
`users.oauth_id` (`:1527`). `oauth_id` is nullable
(`supabase/migrations/20260805000000_baseline_from_production.sql:5857`), so this
does not throw — it **silently persists a Microsoft OAuth account with a null
provider id**, which is unusable for any future provider-id lookup and cannot be
distinguished afterwards from a legacy row.

Blast radius is bounded: the lookup at `:1498` keys on `email`, not
`providerId`, so there is no auth-bypass here and existing users are unaffected.
The comparable Google path is not affected — its `profile.id` is required.

This is the single finding that justifies the flag on its own, and nothing else
in the repo would have found it.

### 4.3 `procurement.controller.ts:546` — a 500 where a 400 is meant

`dto.modifiedContent` is `modifiedContent?: string`
(`procurement/dto/approve-draft.dto.ts:17`) and is passed to
`editDraft(…, newContent: string)` (`procurement.service.ts:2707-2710`). The
service does guard it — `if (!newContent …) throw new BadRequestException` at
`:2712` — but the controller's own `catch` at `:548` only re-throws
`ForbiddenException` and wraps everything else in a
`HttpException(…, INTERNAL_SERVER_ERROR)`. So `PATCH /orders/:id/draft` with the
body field omitted returns **500 instead of 400**. Small, real, and reachable
from the public API.

---

## 5. Why the number is so small — and why that is the actual finding

26 errors across 82,782 lines is not evidence that the gateway is null-safe. It
had to be explained rather than celebrated, so every property and element access
in production source was classified by what the checker sees at the receiver,
with `strictNullChecks` on (script method: TypeScript compiler API,
`getTypeAtLocation` on the receiver expression of every
`PropertyAccessExpression` / `ElementAccessExpression`; 228 files, spec files
excluded):

```
production member accesses examined: 28,661

  any        3,514   12.3%   <- strictNullChecks can never check these
  nullable     344    1.2%
  sound     24,803   86.5%
```

Two things fall out of that:

1. **The gateway is genuinely null-safe where it is typed.** 344 accesses sit on
   a nullable receiver and only **3** of them error (the `ask-ai` trio) — the
   other 341 are already guarded by `?.`, `&&` or an early return. The code was
   written defensively; it just was not checked.

2. **12.3% of production member accesses are invisible to the flag, permanently.**
   `any` absorbs null. Turning `strictNullChecks` on does not shrink that number
   by one. And `noImplicitAny` will not reach it either: **526 lines of
   production source carry an explicit `: any`** (`grep -rn ": any" src`, spec
   files excluded), so the `any` is deliberate, not inferred — which is why
   `noImplicitAny` finds only 11 real errors.

**Where the `any` comes from.** Chiefly the database boundary.
`database/database.service.ts:8` declares `public supabase: SupabaseClient` with
no `Database` generic, so every `.from(…).select()` in the app returns
`data: any`. A generated `Database` type does exist —
`packages/database/src/types/database.types.ts:10` — but it covers **8 tables**,
and the gateway queries **117 distinct tables** (`grep -ohE '\.from\("[a-z_]+"\)'`,
deduplicated). The gateway does not even depend on `@wineops/database`; it
imports `createClient` directly. The rest of the `any` is a handful of untyped
integration modules — `common/orchestrator/rabbitmq-bridge.service.ts` (195 `any`
receivers, from `amqplib` shipping no types), `pos-hub/pos-adapters.ts` (133, 85%
of its accesses), `logs/logs-timeline.service.ts` (111, 77%),
`communications/email-templates-legacy.ts` (99, 68%).

So the risk OD-107 names — *"code that reads as type-safe is not"* — is real and
is **larger** than the OD assumes, but `strictNullChecks` is orthogonal to it.
The blind spot is at the database boundary, which is precisely where nulls come
from at runtime. Flipping the flag lights up the 87% of the code that was already
fine and leaves the 12% that was never checked exactly as dark as it was.

---

## 6. Is the gateway the outlier? Yes, alone.

| Package | `strict` | Enforced in CI? | Result |
|---|---|---|---|
| `apps/api-gateway` | **`strictNullChecks: false`, `noImplicitAny: false`, `strictBindCallApply: false`** | yes | the subject of this document |
| `apps/web` | `strict: true` | yes | **523 files, `tsc --noEmit` exits 0** — verified in this worktree |
| `apps/mobile` | `strict: true` | yes | — |
| `packages/database` | `strict: true` | **no `typecheck` script** | never run |
| `packages/ui` | `strict: true` | **no `typecheck` script** | never run |

`apps/web` is the same size class as the gateway (523 files vs 440) and carries
full `strict` — plus `noUnusedLocals` and `noUnusedParameters`, which the gateway
does not — at zero errors. The gateway's relaxation is not a house style. It is
one package's default that was never revisited, and it is the only package that
has one.

Separate finding, out of scope but worth a register row: **`packages/database` and
`packages/ui` declare `strict: true` and have no `typecheck` script**, so
`turbo run typecheck` skips them entirely and their strictness is decorative.

---

## 7. Recommendation

**Afternoon, not a milestone — but do it for the right reason, and do not let it
close OD-107.**

Split into three, because they are three different sizes:

**(a) `strictNullChecks: true` — one afternoon. Do it.**
26 errors, 11 files. Most are one-line fixes. One is a real defect (§4.2). Six
are the `ask-ai` flattening, and the right fix there is to *revert the three
workarounds* to proper discriminated unions, which removes them rather than
patching them. `ts-jest` runs with `isolatedModules: true`
(`apps/api-gateway/package.json`), so tests do not typecheck and nothing in the
suite can break from this. No ratchet, no staging, no feature flag — a ratchet
for 26 errors across 5 modules costs more to build than the fix costs to make.

**(b) The rest of `strict` — a separate, smaller decision, mostly cosmetic.**
Do **not** enable `strictPropertyInitialization` (444 errors, zero value on
class-validator DTOs). `useUnknownInCatchVariables` is 400 errors of
`catch (e: any)` and buys nothing this repo needs. `noImplicitAny` is 11 real
errors and worth turning on with the same commit as (a); two of them are fixed by
installing `@types/amqplib`. Recommended end state:
`strict: true` with `strictPropertyInitialization: false` and
`useUnknownInCatchVariables: false` — the standard NestJS posture, reachable for
about 36 fixes.

**(c) Typing the database boundary — that is the milestone, and it is the one
that addresses what OD-107 is actually about.**
117 tables queried, 8 typed. Generating the full `Database` type from the live
schema and threading it through `SupabaseClient<Database>` is where the 3,514
unchecked accesses live, and it is the only work that makes "code that reads as
type-safe is not" stop being true. It is genuinely a week or more, it is
independent of (a), and (a) is a prerequisite for it being worth anything — a
typed client under `strictNullChecks: false` still would not check the nulls it
newly knows about.

---

## 8. Where OD-107's register entry is wrong

The entry is a claim like any other, and two parts of it did not survive contact
with the compiler:

1. *"would surface an unknown number of real null defects across ~100 gateway
   files"* — it surfaces **12 errors in 6 files**, of which **1** is a real
   latent defect. The "~100 files" figure is also an undercount of the gateway
   itself: it is 331 production files, 440 with specs. (100 is, coincidentally,
   the number of files that error under *full* strict — but those are DTO and
   catch-block noise.)
2. *"whether that is a milestone of its own or a per-module ratchet"* — neither.
   It is one commit. The framing assumed a large, spread-out number, and the
   number is small and concentrated.

3. *"forced two result types to be flattened"* — it is **three**, and the third
   one's source comment says so (`ask-ai.service.ts:551-554`). The entry was
   already stale when it was read.

What the entry gets right, and understates: the *silent* failure mode. It is
worse than described — not because unchecked narrows are common, but because
12.3% of production member accesses are on `any` and the flag cannot see them at
all. That part of OD-107 should survive the flip as its own open decision (§7c),
not be closed by it.

---

## 9. The drift, which is the argument for doing (a) now

This was measured twice, six commits of wall-clock apart but **one commit of repo
apart**, because `1bcc954d` merged mid-write:

| | `0efe4ba4` | `1bcc954d` | Δ |
|---|---:|---:|---:|
| `strictNullChecks`, prod | 11 | **12** | +1 |
| `strictNullChecks`, prod+spec | 25 | **26** | +1 |
| full strict | 879 | **880** | +1 |
| `any` receivers, prod | 3,507 | **3,514** | +7 |

One feature commit added one error and seven unchecked member accesses, and both
landed in `ask-ai` — the module already carrying half the total. The added error
is the *third* flattened result type (§4.1), written with a source comment naming
OD-107 as the reason.

That is the real cost of leaving this open: not the 26 errors, which are static
and cheap, but that every feature touching a result type pays the workaround tax
and writes a comment apologising for it. The backlog is not large; it is
*accruing*, and it accrues fastest in the newest code.

---

## Appendix — reproducing this

```bash
pnpm install --filter @wineops/api-gateway --frozen-lockfile
cd apps/api-gateway
cat > tsconfig.measure.json <<'EOF'
{ "extends": "./tsconfig.spec.json",
  "compilerOptions": { "noEmit": true, "incremental": false,
                       "pretty": false, "strictNullChecks": true } }
EOF
../../node_modules/.bin/tsc --noEmit -p tsconfig.measure.json ; rm tsconfig.measure.json
```

For the full-strict figure, add `"strict": true, "noImplicitAny": true,
"strictBindCallApply": true` alongside `strictNullChecks` — see the trap in §1.

The `any`-receiver census used the TypeScript compiler API against
`tsconfig.spec.json` with `strictNullChecks: true` forced, walking every
`PropertyAccessExpression` and `ElementAccessExpression` in non-spec `src/` files
and bucketing `checker.getTypeAtLocation(node.expression)` by
`TypeFlags.Any` / contains-`Null|Undefined|Void` / neither.
