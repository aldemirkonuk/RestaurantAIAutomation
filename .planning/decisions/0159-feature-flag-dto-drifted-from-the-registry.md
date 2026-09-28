# 0159 — UpdateFeatureFlagsDto drifted from the registry it is supposed to gate

- **Status:** Proposed
- **Date:** 2026-09-17
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** feature flags, mudavym_design, ValidationPipe, whitelist, forbidNonWhitelisted, UpdateFeatureFlagsDto, FeatureFlagsDto, class-validator, dynamic decoration, FeaturesSection
- **Links:** [[0099-vendor-email-had-no-caller-identity]] (the same bug shape — a DTO missing a field the global pipe then 400s), `apps/api-gateway/src/settings/feature-flag-registry.ts` (OD-86, the single source of truth this DTO fell out of step with)

## Context

`apps/api-gateway/src/settings/dto/feature-flags.dto.ts`'s `UpdateFeatureFlagsDto`
declared three properties: `enable_ai_negotiation`, `enable_ai_autonomous_send`,
`enable_house_inbox_read`. But `settings.service.ts:95` (`updateFeatureFlags`)
reads every key in `ACTIVE_FEATURE_FLAG_KEYS` — which, since the Mudavym
redesign wave started, has grown to 24 entries: the same three, plus 21
`mudavym_design_*` page flags (`feature-flag-registry.ts:44-192`), added one
page at a time as each page shipped (most recently `mudavym_design_logs`,
2026-09-12). The DTO was last hand-edited 2026-09-05, when
`enable_house_inbox_read` was added; nothing added the redesign keys.

The global pipe (`main.ts:51-56`) is
`new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
By that pipe's own contract, a body property with no validation decorator on
the target class is stripped (`whitelist`) or, with `forbidNonWhitelisted`
also on, rejected outright with a 400. `apps/web/src/pages/settings/next/FeaturesSection.tsx`
renders one toggle per `mudavym_design_*` key the registry declares, and
`useSettingsNextData.ts`'s `saveFlag` sends exactly `PUT /settings/feature-flags`
with `{ [key]: value }` — a body carrying only that one key.

**Measured, not assumed (2026-09-17).** A real `ValidationPipe`, built with
`main.ts`'s exact options, run against `UpdateFeatureFlagsDto` with
`{ mudavym_design_dashboard: true }`:

```
STATUS: 400
RESPONSE: {"message":["property mudavym_design_dashboard should not exist"],"error":"Bad Request","statusCode":400}
```

The same body with `enable_ai_negotiation` alongside the redesign key produced
the identical rejection — one bad key fails the whole request, so pairing a
known-good flag with a redesign flag does not help. A control case,
`{ enable_house_inbox_read: true }` (a key the DTO does declare), passed
through unchanged, confirming the pipe — not something else — was the cause.

**Why no existing test caught it.** `settings.service.spec.ts` calls
`service.updateFeatureFlags()` directly with a plain object, bypassing the
controller and the global pipe entirely. `flag-writes-are-role-gated.spec.ts`
constructs the controller by hand and calls its method directly — same gap.
Nothing in the suite ran a request body through the actual
`ValidationPipe` for this DTO. This is the identical shape of gap
[[0099-vendor-email-had-no-caller-identity]] found on the communications side:
a DTO under `forbidNonWhitelisted` that fell behind what the real caller sends,
caught by nothing because the tests exercised the service, not the pipe.

**Practical effect:** every `mudavym_design_*` toggle in Settings — the entire
per-restaurant switch for the Mudavym redesign rollout — was un-settable
through the real HTTP API. `GET /settings/feature-flags` and
`POST /settings/feature-flags/check` (what `useMudavymDesign.ts` actually reads
from) were unaffected, because neither runs through a DTO on the way out. Only
the write side was broken.

## Options considered

1. **Hand-add the 21 missing properties to both DTOs.** Matches the existing
   style exactly (rich per-flag Swagger description, explicit decorators) and
   is the smallest diff. Costs exactly the thing that produced this bug: a
   second hand-kept list duplicating `ACTIVE_FEATURE_FLAGS`, which will drift
   again the next time a page team adds a `mudavym_design_<page>` entry to the
   registry and reasonably assumes — as `FeaturesSection.tsx`'s own header
   comment already claims — that "a flag added to `feature-flag-registry.ts`
   appears here without this file being edited."
2. **Add a TS index signature and stop there, leaving `whitelist`/
   `forbidNonWhitelisted` as-is.** Does nothing: an index signature is
   compile-time only and does not register a `class-validator` decorator, so
   the pipe still strips/rejects the property at runtime. Confirmed by the
   same probe.
3. **Drop `forbidNonWhitelisted` (or `whitelist`) for this route specifically.**
   Rejected: it is the protection this exact registry/DTO lineage exists to
   keep (OD-86, ADR 0020) — without it, a typo'd or renamed key would be
   silently accepted by the pipe and then silently dropped or misapplied by
   `updateFeatureFlags`'s own allowlist loop, trading a loud 400 for a quiet
   no-op. It also regresses the useful case this pipe already catches: a
   genuinely unknown key still needs to be refused (a fix must not weaken
   that — see the "still rejects" tests below).
4. **Generate the decorated properties from `ACTIVE_FEATURE_FLAG_KEYS` at
   module load, programmatically.** `class-validator`/`@nestjs/swagger`
   decorators are plain functions that register metadata on the prototype;
   calling `IsOptional()(Dto.prototype, key)` etc. directly is identical in
   effect to writing `@IsOptional()` on that property by hand — confirmed with
   a probe test before relying on it. The three flags with real per-flag
   documentation stay hand-written (for the description and the reviewer);
   every other registry key is decorated in a loop, so the registry stays the
   one place that says which flags exist, matching its own header comment
   ("The one place that says which feature flags are real").
5. *(Doing nothing)* — every Mudavym redesign flag stays permanently
   un-settable through Settings, silently, for as long as the registry keeps
   growing. This is a live production defect on the founder's own current
   milestone (ADR 0149, finish every Mudavym page), not a hypothetical.

## Decision

Option 4: generate the DTO properties from `ACTIVE_FEATURE_FLAG_KEYS`,
excluding the three hand-declared ones, applying `@IsOptional()`/`@IsBoolean()`
(and `@ApiPropertyOptional()`/`@ApiProperty()` for Swagger) programmatically at
class-definition time. This closes the current 21-key gap and — the reason it
beats option 1 — closes the same gap automatically for every future
`mudavym_design_<page>` entry a page team adds, which is the actual failure
mode here: the registry moved and the DTO didn't, twice (once at
`mudavym_design_logs`, and structurally every time before that a page's flag
was never reachable at all).

A regression test (`apps/api-gateway/src/settings/feature-flags-dto-validation.spec.ts`)
runs the real `ValidationPipe`, built with `main.ts`'s exact options, against
both DTOs — including one request per every key currently in
`ACTIVE_FEATURE_FLAG_KEYS` — so a future registry addition that isn't picked
up (e.g., someone reverts the dynamic loop back to a hand list) fails CI
immediately rather than shipping a silently-broken toggle again.

## Consequences

- **Easier:** a page team adding `mudavym_design_<newpage>` to
  `ACTIVE_FEATURE_FLAGS` needs no DTO change at all — the registry addition is
  sufficient for both the read side (already true before this fix) and the
  write side (true after it). The two can no longer drift apart by omission.
- **Harder / given up:** the dynamically-decorated keys get a generic Swagger
  description ("Declared active by the feature-flag registry") rather than a
  bespoke one. This matches what `FeaturesSection.tsx` already does for its
  own "Other active flags" section, so it is not a new inconsistency.
- **What would trigger revisiting this:** a future flag whose value is not a
  plain boolean (the registry's `ActiveFeatureFlagSpec.defaultValue` is typed
  `boolean`, so this isn't imminent) — the generation loop assumes every
  registry key validates the same way, and a non-boolean flag would need a
  per-key override, not a blanket loop.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-17 | — | Created (Proposed) — measured before writing the fix; awaiting founder review |
