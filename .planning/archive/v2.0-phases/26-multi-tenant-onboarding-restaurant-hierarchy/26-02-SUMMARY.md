---
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
plan: "02"
subsystem: auth
tags: [auth, registration, invites, email-verification, jwt, multi-tenant]
dependency_graph:
  requires:
    - 26-01 (organizations, organization_invites, email_verifications tables)
  provides:
    - POST /auth/register/restaurant (Path B — new restaurant owner registration)
    - GET /auth/invite/:code (invite preview — public)
    - POST /auth/invite (generate invite code — owner/manager only)
    - POST /auth/join (Path A — join via invite code)
    - POST /auth/verify-email (email verification)
    - POST /auth/resend-verification (resend with rate limit)
    - JWT payload.emailVerified field
  affects:
    - 26-03+ (frontend registration pages depend on these endpoints)
    - All JWT-gated routes (now carry emailVerified claim)
tech_stack:
  added: []
  patterns:
    - Atomic invite consumption via UPDATE WHERE used_at IS NULL (.single() forces 0-row failure)
    - Manual rollback pattern for multi-table creation (no native Supabase transactions)
    - Lazy GmailService.isReady() check with console fallback for dev
    - Crypto-random invite code from unambiguous charset (no 0/O/1/I)
key_files:
  created:
    - apps/api-gateway/src/auth/dto/register-restaurant.dto.ts
    - apps/api-gateway/src/auth/dto/join-via-invite.dto.ts
    - apps/api-gateway/src/auth/dto/invite.dto.ts
  modified:
    - apps/api-gateway/src/auth/auth.service.ts
    - apps/api-gateway/src/auth/auth.controller.ts
    - apps/api-gateway/src/auth/auth.module.ts
decisions:
  - "GmailService.isReady() used (not .isConfigured — private) with to:[email] array per EmailOptions interface"
  - "Invite code uses crypto.randomBytes with modulo mapping to CHARSET (32 chars → 32^8 entropy)"
  - "joinViaInvite rolls back invite.used_at on user creation failure to prevent ghost-consumed invites"
  - "registerRestaurant sets org.owner_id to null on creation then updates after user_id is known"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-07"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 3
---

# Phase 26 Plan 02: Auth Endpoints — Registration, Invites, Email Verification Summary

**One-liner:** Six new NestJS auth endpoints enabling two-path registration (owner self-register + invite-join), invite generation/preview, and email verification with 60-second resend rate limit.

---

## What Was Built

### New Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register/restaurant` | `@Public()` | Path B: creates org + restaurant + owner user atomically |
| GET | `/auth/invite/:code` | `@Public()` | Preview invite — returns `{valid, organization, restaurant, inviter}` or `{valid:false, reason}` |
| POST | `/auth/invite` | JWT + `@Roles('owner','manager')` | Generate 8-char alphanumeric invite code |
| POST | `/auth/join` | `@Public()` | Path A: join via invite code, creates user with `email_verified:true` |
| POST | `/auth/verify-email` | JWT | Consumes email verification token, returns new JWT with `emailVerified:true` |
| POST | `/auth/resend-verification` | JWT | Resends verification email (rate-limited: 1/min via `last_resent_at`) |

### AuthService Methods Added

- **`registerRestaurant(dto)`** — atomic create: org → restaurant → user with manual rollback in reverse order on failure
- **`queueEmailVerification(userId, email)`** — inserts `email_verifications` row, sends email via `GmailService.isReady()` or logs URL for dev
- **`getInvitePreview(code)`** — reads invite with org/restaurant/inviter join, returns structured validity response
- **`generateInvite(userId, restaurantId, dto)`** — validates restaurant ownership, generates collision-checked 8-char code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
- **`joinViaInvite(dto)`** — atomic UPDATE WHERE `used_at IS NULL` to consume invite, creates user with `email_verified:true`, adds to `organization_members`
- **`verifyEmail(userId, token)`** — marks `email_verifications.verified_at`, updates `users.email_verified=true`, returns refreshed JWT
- **`resendVerification(userId, email)`** — 60-second cooldown check, increments `resend_count`, re-queues email

### generateTokens() Updated

Added `emailVerified: user.email_verified ?? false` to the JWT payload (both access and refresh tokens). Path A users get `emailVerified:true` immediately; Path B users start with `false` until they click the verification email.

### DTOs Created

| File | Fields |
|------|--------|
| `register-restaurant.dto.ts` | name, email, password, restaurantName, address, city, phone?, cuisineType?, timezone? |
| `join-via-invite.dto.ts` | code (Length 8,8), name, email, password |
| `invite.dto.ts` | restaurantId, targetEmail?, role? (owner/manager/staff) |

---

## Threat Model Coverage

| Threat ID | Category | Mitigation Implemented |
|-----------|----------|----------------------|
| T-26-02-01 | Spoofing — invite timing attack | Supabase `.eq()` parameterized queries at DB level |
| T-26-02-02 | Tampering — TOCTOU invite consumption | `.update().eq('code',...).is('used_at',null).single()` — returns error if 0 rows |
| T-26-02-03 | DoS — mass registration | Accepted: global RateLimitGuard + bcrypt SALT_ROUNDS=10 natural rate limit |
| T-26-02-04 | Spoofing — email verification bypass | Token stored server-side in `email_verifications`; no self-certification possible |
| T-26-02-05 | Elevation — non-owner generates invite | `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('owner','manager')` on POST /auth/invite |
| T-26-02-06 | Info Disclosure — email in logs | Logger only logs email address, not password/token values |

---

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1 | `8eb96f6` | feat(26-02): DTOs, registerRestaurant, getInvitePreview, emailVerified in JWT |
| Task 2 | `ba3c88f` | feat(26-02): generateInvite, joinViaInvite, verifyEmail, resendVerification |
| Task 3 | — | Verification only — 0 TS errors, build passes, no code changes required |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] GmailService API mismatch**
- **Found during:** Task 1
- **Issue:** Plan specified `this.gmailService.isConfigured` (private field) and `sendEmail({ to: string })`. Actual service has `isReady()` public method and `EmailOptions.to: string[]`
- **Fix:** Used `this.gmailService.isReady()` and `to: [email]` (array wrapping)
- **Files modified:** `apps/api-gateway/src/auth/auth.service.ts`
- **Commit:** `8eb96f6`

---

## Known Stubs

None. All endpoints are fully wired to Supabase queries. GmailService gracefully degrades to console log in development.

---

## Self-Check

### Files exist:
- FOUND: `apps/api-gateway/src/auth/dto/register-restaurant.dto.ts`
- FOUND: `apps/api-gateway/src/auth/dto/join-via-invite.dto.ts`
- FOUND: `apps/api-gateway/src/auth/dto/invite.dto.ts`
- FOUND: `apps/api-gateway/src/auth/auth.service.ts` (modified)
- FOUND: `apps/api-gateway/src/auth/auth.controller.ts` (modified)
- FOUND: `apps/api-gateway/src/auth/auth.module.ts` (modified)

### Commits exist:
- FOUND: `8eb96f6` — feat(26-02): DTOs, registerRestaurant, getInvitePreview, emailVerified in JWT
- FOUND: `ba3c88f` — feat(26-02): generateInvite, joinViaInvite, verifyEmail, resendVerification

### Build verification:
- TypeScript build: 0 errors (`pnpm build` → "Successfully compiled: 155 files with swc")
- `@Public()` count: 3 (register/restaurant, invite/:code, join)
- Old `@Post('register')` endpoint preserved (backward compat)

## Self-Check: PASSED
