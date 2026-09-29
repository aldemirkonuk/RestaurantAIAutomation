# 0236 — The feature-flag DTO follows the registry, not a hand-kept list

- **Status:** Proposed — founder review pending. The fix is a defect repair inside [OD-86](OPEN-DECISIONS.md)'s rule ("`feature-flag-registry.ts` is the single place saying which flags are real"); the choice between the options below is what is proposed.
- **Date:** 2026-09-28 (first drafted 2026-09-17 as a local-only ADR numbered 0159 in snapshot `3e370ce60`, never pushed; renumbered 0236 because 0159 is taken on `main`)
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** feature flags, ValidationPipe, whitelist, forbidNonWhitelisted, UpdateFeatureFlagsDto, FeatureFlagsDto, class-validator, dynamic decoration, mudavym_design_arrival, FeaturesSection
- **Links:** [[0099-vendor-email-had-no-caller-identity]] (same bug shape — a DTO missing a field the global pipe then 400s), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (why `mudavym_design_arrival` is the one page flag still ACTIVE), [[0213-get-started-is-account-then-house-then-first-proof]] (the Arrival book's legacy slot)

## Context

`settings.service.ts:89-104` (`updateFeatureFlags`) reads every key in
`ACTIVE_FEATURE_FLAG_KEYS` off the request body. The route's body type is
`UpdateFeatureFlagsDto`, and the global pipe (`main.ts:53-57`) is
`new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`:
a body property the DTO class does not decorate is a 400.

The DTO hand-declared three keys. The registry (`feature-flag-registry.ts:54-93`)
has four ACTIVE entries on `main` 2ba1326e3: the same three plus
`mudavym_design_arrival` (column `20260922231300`). When the snapshot was
drafted (2026-09-17) the gap was 21 `mudavym_design_*` keys; PR #487 has since
moved 28 of them to `LIVE_IN_CODE_FLAGS`, so the gap shrank to one key but
did not close — the bug is the second list, not its length.

`FeaturesSection.tsx:274-281` renders a toggle for `mudavym_design_arrival`
(it is not `alwaysOn`), and `useSettingsNextData.ts:739-742` (`saveFlag`) sends
`PUT /settings/feature-flags` with `{ [key]: value }`.

**Measured, 2026-09-28, on 2ba1326e3.** The real `ValidationPipe`, built with
`main.ts`'s options, against `UpdateFeatureFlagsDto`, given
`{ mudavym_design_arrival: true }`: rejected, `property mudavym_design_arrival
should not exist`. The same case in
`apps/api-gateway/src/settings/feature-flags-dto-validation.spec.ts` fails on
`main` (5 of 8 cases fail) and passes with this change.

**Why no test caught it.** `settings.service.spec.ts` calls the service
directly and `flag-writes-are-role-gated.spec.ts` calls the controller method
directly; neither runs a body through the pipe.

## Options considered

1. **Hand-add the missing property.** Smallest diff (one key today). Keeps the
   second list that produced the bug; the next ACTIVE key drifts the same way.
2. **Index signature only.** Compile-time only; registers no `class-validator`
   metadata, so the pipe still rejects the key. Does nothing at runtime.
3. **Drop `forbidNonWhitelisted` / `whitelist` for this route.** Rejected: an
   unknown or typo'd key would then pass the pipe and be silently dropped by the
   service's allowlist loop — a loud 400 traded for a quiet no-op.
4. **Decorate the DTOs from `ACTIVE_FEATURE_FLAG_KEYS` at module load.**
   `class-validator` and `@nestjs/swagger` decorators are plain functions that
   register metadata on the prototype; calling `IsBoolean()(Dto.prototype, key)`
   is what `@IsBoolean()` does. The three keys with real descriptions stay
   hand-written; every other ACTIVE key is decorated in a loop.
   **[Corrected 2026-09-29, ADR 0090 audit of #524: the premise is false. `@` on a declared property also emits TypeScript's `design:type` metadata; a direct call does not. `@nestjs/swagger` read the missing type as a circular reference, and `SwaggerModule.createDocument` threw at boot, so the production gateway was down from #509 until #524, which adds `type: Boolean` to both direct `ApiProperty` calls. The same sentence in the comment at `feature-flags.dto.ts:94-96` still needs correcting. See `tech-debt.d/2026-09-29-docs-merge-queue-followups-2026-09-29.md:53`.]**
5. **Do nothing.** The Arrival toggle in Settings stays a 400.

## Proposed decision

Option 4. `apps/api-gateway/src/settings/dto/feature-flags.dto.ts` decorates
every ACTIVE key not in `HAND_DECLARED_FLAG_KEYS` with `@IsOptional()
@IsBoolean()` on `UpdateFeatureFlagsDto` and `@IsBoolean()` on
`FeatureFlagsDto`, plus Swagger metadata. The regression spec runs the real
pipe against: the Arrival body; every ACTIVE key, one request each; a key
added to a mocked registry with no DTO edit; an unknown key, a demoted
`LIVE_IN_CODE_FLAGS` key and a wrong-typed value (all still 400).

## Consequences

- **Easier:** a key added to `ACTIVE_FEATURE_FLAGS` is settable with no DTO edit.
- **Given up:** dynamically decorated keys get a generic Swagger description.
- **Unchanged:** unknown keys and `LIVE_IN_CODE_FLAGS` keys are still refused.
- **Revisit if:** an ACTIVE flag is ever non-boolean — the loop assumes boolean
  (`ActiveFeatureFlagSpec.defaultValue: boolean`); such a flag needs its own
  hand-written property.
- **Open, not decided here:** whether to retire the now-inert
  `mudavym_design_arrival` flag now or later (the cutover manifest recommends
  later, in its own gateway PR). This ADR makes the switch settable while it
  exists; retiring it would remove the spec's Arrival case, not the loop.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-17 | — | Drafted as local-only 0159 (snapshot `3e370ce60`), 21-key gap measured |
| 2026-09-28 | — | Carried to `main` as 0236; re-measured against 2ba1326e3 (one-key gap, `mudavym_design_arrival`); awaiting founder review |
