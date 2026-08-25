---
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
reviewed: 2026-05-09T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - apps/api-gateway/src/organizations/dto/update-location.dto.ts
  - apps/api-gateway/src/organizations/organizations.service.ts
  - apps/api-gateway/src/organizations/organizations.controller.ts
findings:
  critical: 3
  warning: 5
  info: 2
  total: 10
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-05-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Three files implement the PATCH `/organizations/locations/:id` endpoint, an extended POST `/organizations/chains` with optional auto-assign, and the `getUserOrgIdsWithFallback` legacy-repair helper. The org-boundary checks on the read path are structurally sound, but three critical defects were found: the fallback repair silently promotes every legacy user to `owner`, the write path of `updateLocationChain` is not org-scoped (TOCTOU window), and all DTO fields arrive with zero runtime validation. Five warnings cover error-type assumptions, non-deterministic org selection, plain-`Error` 500s, and `req.user` type safety.

---

## Critical Issues

### CR-01: Legacy-user repair silently escalates every affected user to `owner`

**File:** `apps/api-gateway/src/organizations/organizations.service.ts:59`

**Issue:** When the fallback path fires for a user with no `organization_members` row, the repair upsert hard-codes `role: 'owner'`. Any legitimate non-owner employee (manager, staff) who pre-dates the org system will have an `owner` row inserted for them on their next API call. This grants full organization control to users who should not have it.

**Fix:**
```typescript
// Determine the correct role before upserting.
// If we cannot determine it, default to 'member', never 'owner'.
await this.databaseService.supabase.from('organization_members').upsert(
  { organization_id: rest.organization_id, user_id: userId, role: 'member' },
  { onConflict: 'organization_id,user_id' },
);
```
If `owner` is truly needed for a specific migration scenario, drive it from a column on the `users` row (e.g., `users.legacy_role`) rather than hard-coding.

---

### CR-02: `updateLocationChain` write is not org-scoped — TOCTOU window allows cross-org write

**File:** `apps/api-gateway/src/organizations/organizations.service.ts:96-99`

**Issue:** The restaurant's org membership is verified via a `SELECT` (lines 77-83), but the subsequent `UPDATE` (lines 96-99) only filters by `id`. There is no `.in('organization_id', orgIds)` guard on the update. Between the read and the write, the `organization_id` column could change (or the membership row could be deleted). More importantly, the write path itself never enforces the boundary — if the read check is bypassed by any future code path calling the update query directly, the cross-org write succeeds silently.

**Fix:**
```typescript
const { error } = await this.databaseService.supabase
  .from('restaurants')
  .update({ chain_id: chainId })
  .eq('id', restaurantId)
  .in('organization_id', orgIds);   // <-- add this guard
if (error) throw new Error(`Failed to update location: ${error.message}`);
```

---

### CR-03: Zero runtime validation on all DTOs — type coercion bypasses org-boundary checks

**File:** `apps/api-gateway/src/organizations/dto/update-location.dto.ts:1-3`
**File:** `apps/api-gateway/src/organizations/organizations.controller.ts:47, 59, 72`

**Issue:** `UpdateLocationDto` has no class-validator decorators (`@IsOptional`, `@IsUUID`, `@IsString`). The inline body types on `POST /chains` and `POST /locations` are plain TypeScript interfaces with no runtime enforcement. NestJS's `ValidationPipe` is not applied at the method or class level in the controller. This means:
- `chainId` can arrive as an integer, empty string, or arbitrary object; the org-boundary query at line 87 receives unchecked input.
- `name` on `POST /chains` is never checked for presence; a missing `name` produces a raw Supabase error message surfaced to the client.
- A caller can send `{ "chainId": "" }` and the truthy guard at line 86 is skipped (empty string is falsy), writing `chain_id: ""` to the DB without any ownership check being performed.

**Fix:**
```typescript
// update-location.dto.ts
import { IsOptional, IsUUID } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsUUID()
  chainId?: string | null;
}
```
Apply `ValidationPipe` globally in `main.ts` or at controller level with `@UsePipes(new ValidationPipe({ whitelist: true }))`. Create proper DTO classes for `POST /chains` and `POST /locations` with `@IsString()`, `@IsNotEmpty()`, `@IsOptional()`, and `@IsUUID()` decorators as appropriate.

---

## Warnings

### WR-01: `catch (e)` in fire-and-continue block assumes `e` is an `Error` instance

**File:** `apps/api-gateway/src/organizations/organizations.service.ts:187`

**Issue:** `e.message` is accessed without checking that `e` is an `Error`. In TypeScript strict mode, `e` inside a `catch` block is typed as `unknown`. If someone throws a string or a non-Error object, `e.message` is `undefined` and the log line reads `"...failed to assign restaurant X: undefined"`, losing diagnostic context. In older JS engines or re-thrown non-Error values this is a runtime `TypeError`.

**Fix:**
```typescript
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  this.logger.error(
    `Chain created but failed to assign restaurant ${dto.restaurantId}: ${msg}`,
  );
}
```

---

### WR-02: Non-deterministic org selection when user belongs to multiple organizations

**File:** `apps/api-gateway/src/organizations/organizations.service.ts:163-167`
**File:** `apps/api-gateway/src/organizations/organizations.service.ts:219-221`

**Issue:** Both `createChain` and `createLocation` use `orgIds[0]` as a fallback when `ownedOrg` is null. The order of `orgIds` is whatever Supabase returns from the `organization_members` query, which has no `ORDER BY`. For a user who is a member (not owner) of multiple orgs, the target org for newly created resources is undefined behavior. This could silently place chains or locations in the wrong org.

**Fix:** Require the caller to supply an explicit `organizationId` in the request body, or at minimum document that this endpoint is restricted to users who own exactly one org. If multi-org membership is a real case, surface an error rather than guessing:
```typescript
if (!ownedOrg) throw new BadRequestException(
  'Cannot determine target organization — please specify organizationId',
);
```

---

### WR-03: Service throws plain `Error` on user-facing failures — all surface as HTTP 500

**File:** `apps/api-gateway/src/organizations/organizations.service.ts:74, 100, 160, 181, 214, 242`

**Issue:** Six call sites throw `new Error(...)` for conditions like "user has no organization" (a 403/400 scenario) or "failed to create chain" (a 422 or 500 depending on cause). NestJS's default exception filter converts unrecognized errors to 500. Clients receive no actionable HTTP status and internal error strings are potentially leaked in the response body in development mode.

**Fix:** Use NestJS HTTP exceptions consistently:
```typescript
// line 74
throw new ForbiddenException('User has no organization');

// line 100
throw new InternalServerErrorException('Failed to update location');

// line 160
throw new ForbiddenException('User has no organization');
```
Import `ForbiddenException`, `BadRequestException`, `InternalServerErrorException` from `@nestjs/common` alongside the existing `NotFoundException`.

---

### WR-04: `req.user` typed as `any` — guard bypass causes unhandled TypeError rather than 401

**File:** `apps/api-gateway/src/organizations/organizations.controller.ts:30, 38, 57, 70`

**Issue:** Every handler accesses `req.user.userId` with `req.user` typed as `any`. If `JwtAuthGuard` attaches `user` under a different key, or if a misconfigured strategy returns a user object without a `userId` field, the expression evaluates to `undefined` silently. The service then queries with `userId = undefined` which will either match no rows or (worse) match all rows depending on the DB driver's serialization.

**Fix:** Define an interface and assert or validate `userId` before use:
```typescript
interface AuthenticatedUser { userId: string; }
// In each handler:
const userId: string = (req.user as AuthenticatedUser)?.userId;
if (!userId) throw new UnauthorizedException('Missing user identity');
```

---

### WR-05: `createLocation` in service does not validate `chainId` org-boundary

**File:** `apps/api-gateway/src/organizations/organizations.service.ts:236`

**Issue:** When a `chainId` is provided in `POST /locations`, it is written directly to the new restaurant row without any check that the chain belongs to the same organization. An authenticated user from Org A who discovers a chain UUID from Org B can create a new restaurant in Org A linked to Org B's chain. This violates the org-boundary guarantee.

**Fix:** Mirror the chain-ownership check that exists in `updateLocationChain` (lines 86-94):
```typescript
if (dto.chainId) {
  const { data: chain } = await this.databaseService.supabase
    .from('restaurant_chains')
    .select('organization_id')
    .eq('id', dto.chainId)
    .in('organization_id', orgIds)
    .maybeSingle();
  if (!chain) throw new NotFoundException('Chain not found or access denied');
}
```

---

## Info

### IN-01: `UpdateLocationDto` should use `class-transformer` `@Type` for null coercion

**File:** `apps/api-gateway/src/organizations/dto/update-location.dto.ts:2`

**Issue:** The comment states `null = remove from chain`. JSON `null` deserializes correctly, but without `@Transform` or `@Type` annotations the behavior with `ValidationPipe({ transform: true })` depends on NestJS version defaults. Explicit documentation via decorator makes intent clear for maintainers.

**Fix:**
```typescript
import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateLocationDto {
  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === undefined ? undefined : value ?? null))
  chainId?: string | null;
}
```

---

### IN-02: Magic default timezone `'America/New_York'` in `createLocation`

**File:** `apps/api-gateway/src/organizations/organizations.service.ts:234`

**Issue:** The timezone default is a hard-coded string embedded in a DB insert. If the default ever needs to change (or if the platform goes international), this requires a code change and re-deploy. It also produces incorrect data for non-US users who omit the field.

**Fix:** Promote to a named constant in a shared config module:
```typescript
// config/defaults.ts
export const DEFAULT_TIMEZONE = 'America/New_York';

// usage
timezone: dto.timezone ?? DEFAULT_TIMEZONE,
```
Longer term, derive the default from the user's locale/country at the API layer rather than hard-coding it.

---

_Reviewed: 2026-05-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
