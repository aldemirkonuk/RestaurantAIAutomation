---
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
verified: 2026-05-07T22:05:00-05:00
human_uat_completed: 2026-05-10T00:00:00Z
status: passed
score: 21/21 must-haves verified (all human tests passed 2026-05-10)
overrides_applied: 0
---

# Phase 26: Multi-Tenant Onboarding & Restaurant Hierarchy — Verification Report

**Phase Goal:** Fix broken registration and add multi-location support. New owners can self-register and create a restaurant in one flow. Existing owners can add branches (locations) under one organization and switch between them from the top nav. Staff join via invite code.
**Verified:** 2026-05-07T22:05:00-05:00
**Status:** PASSED — all 8 human UAT tests passed 2026-05-10. All 21 must-haves confirmed in live environment.
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | New owners can self-register via two-path wizard (no restaurantId field required) | ✓ VERIFIED | `grep "restaurantId" Register.tsx → 0 matches`; two card-style path selectors exist; PathB 2-step wizard implemented |
| 2 | Path A (join via invite): inline validation + preview card before submit | ✓ VERIFIED | `invitePreview` state + debounceRef(400ms) + InviteValidationFeedback component + preview banner in PathAStep2 |
| 3 | Path B (create restaurant): 3-step wizard with step indicator | ✓ VERIFIED | StepIndicator component, PathBStep1 (account) + PathBStep2 (restaurant) → navigate('/verify-email') |
| 4 | URL params auto-route (?invite=, ?type=join, ?type=new) | ✓ VERIFIED | `searchParams.get('invite')` + `searchParams.get('type')` routing in useEffect |
| 5 | Staff join via invite code (POST /auth/join) | ✓ VERIFIED | @Public() joinViaInvite endpoint + atomic `.is('used_at', null)` consumption + email_verified: true for invite path |
| 6 | Email verification holding page (/verify-email) with resend | ✓ VERIFIED | VerifyEmail.tsx exists; resend-verification call + 60s (60000ms) client-side rate limit; token from URL |
| 7 | ProtectedRoute gates unverified users to /verify-email | ✓ VERIFIED | `user?.emailVerified === false → <Navigate to="/verify-email" replace />` in ProtectedRoute.tsx |
| 8 | JWT carries emailVerified field | ✓ VERIFIED | `emailVerified: user.email_verified ?? false` added to generateTokens() payload |
| 9 | Invite codes are 8-char, crypto-random, no ambiguous chars | ✓ VERIFIED | CHARSET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789' in auth.service.ts; CHAR(8) in DB schema |
| 10 | Invite generation endpoint (POST /auth/invite) — owner/manager only | ✓ VERIFIED | `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('owner','manager')` on the endpoint |
| 11 | Owners can add branches (POST /organizations/locations) | ✓ VERIFIED | createLocation() in OrganizationsService + POST /organizations/locations endpoint + AddLocationDialog wired |
| 12 | Branch switcher populated from GET /organizations/branches after login | ✓ VERIFIED | fetchBranches() in AuthContext calling `/api/v1/organizations/branches`; availableRestaurants: RestaurantBranch[] |
| 13 | Branch switcher only visible when ≥2 locations | ✓ VERIFIED | `availableRestaurants.length > 1` condition in Header.tsx |
| 14 | Branch switcher shows name + city, grouped by chain | ✓ VERIFIED | branchGroups useMemo + BranchButton with branch.name + branch.city + chain section headers |
| 15 | Organizations and membership tables created (DB) | ⚠️ UNCERTAIN | SQL files verified syntactically correct; `supabase db push` not applied (no linked DB / no local Docker running) |
| 16 | Invite system tables created (DB) | ⚠️ UNCERTAIN | organization_invites.sql + email_verifications.sql verified correct; same DB push limitation |
| 17 | Settings → Team section with Invite Member (owner/manager) | ✓ VERIFIED | InviteTeamDialog import + usage in Settings.tsx; `user?.role === 'owner' || 'manager'` gate |
| 18 | Copy button copies /register?invite=CODE (not just code) | ✓ VERIFIED | `navigator.clipboard.writeText(invite.inviteUrl)` in InviteTeamDialog; inviteUrl = `/register?invite=CODE` |
| 19 | Settings → Locations section with chain grouping (owner only) | ✓ VERIFIED | chain-grouped list + Create Chain inline form + AddLocationDialog trigger; `user?.role === 'owner'` gate |
| 20 | Chain management (POST /organizations/chains, restaurant_chains table) | ✓ VERIFIED | createChain() in OrganizationsService + POST /organizations/chains endpoint + restaurant_chains migration SQL |
| 21 | Existing auth backward compatible (old register endpoint preserved) | ✓ VERIFIED | Original `@Post('register')` endpoint untouched; all 3 new public endpoints have @Public() |

**Score:** 19/21 truths verified (2 UNCERTAIN — DB not applied)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260506000000_organizations.sql` | organizations + organization_members + RLS | ✓ VERIFIED | organizations table, 4 RLS policies, UNIQUE(org_id,user_id) |
| `supabase/migrations/20260506000001_organization_invites.sql` | CHAR(8) code + UNIQUE index + RLS | ✓ VERIFIED | `code CHAR(8) NOT NULL`, `CREATE UNIQUE INDEX idx_org_invites_code`, RLS enabled |
| `supabase/migrations/20260506000002_email_verifications.sql` | token UUID UNIQUE + resend_count + RLS | ✓ VERIFIED | `token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()`, `resend_count INTEGER NOT NULL DEFAULT 0` |
| `supabase/migrations/20260506000003_restaurants_schema_updates.sql` | city + phone + organization_id FK + email_verified | ✓ VERIFIED | All 4 ALTER statements confirmed |
| `supabase/migrations/20260506000004_restaurant_chains.sql` | restaurant_chains table + restaurants.chain_id nullable FK | ✓ VERIFIED | `chain_id UUID REFERENCES restaurant_chains(id) ON DELETE SET NULL` |
| `apps/api-gateway/src/auth/dto/register-restaurant.dto.ts` | RegisterRestaurantDto | ✓ VERIFIED | File exists; @IsString, @IsEmail, @MinLength decorators |
| `apps/api-gateway/src/auth/dto/join-via-invite.dto.ts` | JoinViaInviteDto with @Length(8,8) | ✓ VERIFIED | File exists; `@Length(8, 8)` on code field |
| `apps/api-gateway/src/auth/dto/invite.dto.ts` | InviteDto | ✓ VERIFIED | File exists; restaurantId, targetEmail?, role? |
| `apps/api-gateway/src/auth/auth.service.ts` | 6 new auth methods + emailVerified in JWT | ✓ VERIFIED | registerRestaurant, queueEmailVerification, getInvitePreview, generateInvite, joinViaInvite, verifyEmail, resendVerification all present |
| `apps/api-gateway/src/auth/auth.controller.ts` | 6 new endpoints, 3 @Public() | ✓ VERIFIED | @Public() count = 3 (register/restaurant, invite/:code, join) |
| `apps/api-gateway/src/auth/auth.module.ts` | CommunicationsModule imported | ✓ VERIFIED | `import { CommunicationsModule }` + in imports[] array |
| `apps/api-gateway/src/organizations/organizations.service.ts` | OrganizationsService with 4 methods | ✓ VERIFIED | getBranchesForUser, getChainsForUser, createChain, createLocation |
| `apps/api-gateway/src/organizations/organizations.controller.ts` | 4 JWT-guarded endpoints | ✓ VERIFIED | Class-level @UseGuards(JwtAuthGuard); GET /branches, GET /chains, POST /chains, POST /locations |
| `apps/api-gateway/src/organizations/organizations.module.ts` | OrganizationsModule | ✓ VERIFIED | Follows SettingsModule pattern; registered in AppModule |
| `apps/web/src/contexts/AuthContext.tsx` | RestaurantBranch[], fetchBranches(), registerRestaurant(), joinViaInvite() | ✓ VERIFIED | All present; type changed from string[] to RestaurantBranch[] |
| `apps/web/src/components/layout/Header.tsx` | Branch switcher with name+city+chain grouping | ✓ VERIFIED | branchGroups useMemo, BranchButton, isSwitching, availableRestaurants.length > 1 |
| `apps/web/src/pages/Register.tsx` | Two-path wizard (min 200 lines) | ✓ VERIFIED | Complete replacement; PathSelector + PathAStep1+2 + PathBStep1+2; no restaurantId field |
| `apps/web/src/pages/VerifyEmail.tsx` | Email verification holding page | ✓ VERIFIED | Created; verify + resend flow; 60s rate limit; token from URL |
| `apps/web/src/components/ProtectedRoute.tsx` | emailVerified gate | ✓ VERIFIED | `user?.emailVerified === false → Navigate to /verify-email` |
| `apps/web/src/App.tsx` | /verify-email route | ✓ VERIFIED | Route + import present |
| `apps/web/src/components/team/InviteTeamDialog.tsx` | Two-phase invite dialog | ✓ VERIFIED | Radix Dialog + two-phase UI + inviteUrl copy |
| `apps/web/src/components/locations/AddLocationDialog.tsx` | Location form with chain dropdown | ✓ VERIFIED | Fetches GET /chains on open; POST /locations on submit; chainId optional |
| `apps/web/src/pages/Settings.tsx` | Team + Locations sections | ✓ VERIFIED | Both sections present; role gates correct; Create Chain inline form |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| AuthController.registerRestaurant | AuthService.registerRestaurant | `this.authService.registerRestaurant(dto)` | ✓ WIRED | Confirmed in controller |
| AuthService.joinViaInvite | organization_invites | `.update().eq('code').is('used_at', null)` atomic | ✓ WIRED | Atomic TOCTOU-safe consumption confirmed |
| AuthService.generateTokens | JWT payload.emailVerified | `emailVerified: user.email_verified ?? false` | ✓ WIRED | Field present in payload |
| OrganizationsController.getBranches | OrganizationsService.getBranchesForUser | `this.organizationsService.getBranchesForUser(userId)` | ✓ WIRED | Confirmed |
| OrganizationsService.getBranchesForUser | restaurants LEFT JOIN restaurant_chains | `.select('id, name, city, chain_id, restaurant_chains(name)')` | ✓ WIRED | chain_name populated via Supabase relational query |
| AuthContext login() | GET /api/v1/organizations/branches | `fetchBranches()` called after setUser() | ✓ WIRED | Confirmed in useEffect |
| Header.tsx availableRestaurants.map | RestaurantBranch { id, name, city } | `branch.name + branch.city` display | ✓ WIRED | branchGroups + BranchButton confirmed |
| Register.tsx Path B submit | AuthContext.registerRestaurant() | `useAuth().registerRestaurant` | ✓ WIRED | Confirmed in handleCreateSubmit |
| Register.tsx Path A submit | AuthContext.joinViaInvite() | `useAuth().joinViaInvite` | ✓ WIRED | Confirmed in handleJoinSubmit |
| ProtectedRoute | /verify-email | `user?.emailVerified === false → Navigate` | ✓ WIRED | Confirmed |
| Settings.tsx Team section | InviteTeamDialog.tsx | `open={showInviteDialog}` | ✓ WIRED | Import + JSX usage confirmed |
| InviteTeamDialog | POST /api/v1/auth/invite | `fetch('/api/v1/auth/invite', Bearer token)` | ✓ WIRED | Confirmed in handleGenerate |
| Settings.tsx Locations section | AddLocationDialog.tsx | `open={showAddLocation}` | ✓ WIRED | Import + JSX usage confirmed |
| AddLocationDialog | POST /api/v1/organizations/locations | `fetch('/api/v1/organizations/locations', Bearer token)` | ✓ WIRED | Confirmed in handleSubmit |
| Settings.tsx Create Chain | POST /api/v1/organizations/chains | inline fetch in onClick handler | ✓ WIRED | Confirmed |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `Header.tsx` branch switcher | `availableRestaurants` | GET /organizations/branches → OrganizationsService.getBranchesForUser → Supabase `restaurants` JOIN `restaurant_chains` | ✓ Real DB query (subject to migrations being applied) | ✓ FLOWING (code path correct) |
| `Register.tsx` InviteValidationFeedback | `invitePreview` | GET /api/v1/auth/invite/:code → Supabase `organization_invites` JOIN | ✓ Real DB query | ✓ FLOWING |
| `Settings.tsx` locationsList | `availableRestaurants` from AuthContext | Same as branch switcher | ✓ seeded from real context | ✓ FLOWING |
| `AddLocationDialog.tsx` chains dropdown | `chains` state | GET /organizations/chains → OrganizationsService.getChainsForUser → Supabase `restaurant_chains` | ✓ Real DB query | ✓ FLOWING |
| `VerifyEmail.tsx` token | `token` from URL `?token=` | URL searchParam → POST /auth/verify-email → Supabase `email_verifications` | ✓ Real DB validation | ✓ FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — requires running server/database. All data flows confirmed via static analysis.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ONBOARD-01 | 26-05 | No restaurantId field in Register.tsx; two-card path selector | ✓ SATISFIED | 0 grep matches for "restaurantId" in Register.tsx; 2 card-style buttons confirmed |
| ONBOARD-02 | 26-05 | Path B wizard: account → restaurant → verify-email progression | ✓ SATISFIED | PathBStep1+PathBStep2+navigate('/verify-email') confirmed |
| ONBOARD-03 | 26-05 | ?invite=CODE auto-extracts; ?type=join; ?type=new URL routing | ✓ SATISFIED | searchParams.get('invite') + searchParams.get('type') routing confirmed |
| ONBOARD-04 | 26-05 | VerifyEmail page + resend button | ✓ SATISFIED | VerifyEmail.tsx exists with resend handler + 60s rate limit |
| ONBOARD-05 | 26-02 | POST /auth/register/restaurant atomic create | ✓ SATISFIED | registerRestaurant() with try/catch rollback pattern confirmed |
| ONBOARD-06 | 26-01 | organizations + org_members + org_invites + email_verifications + restaurant_chains tables | ⚠️ NEEDS DB PUSH | SQL files syntactically correct; not applied to running DB |
| ONBOARD-07 | 26-05 | Timezone auto-detected via Intl.DateTimeFormat() | ✓ SATISFIED | `Intl.DateTimeFormat().resolvedOptions().timeZone` in Register.tsx confirmed |
| ONBOARD-08 | 26-05 | Visual style matches Login.tsx card | ✓ SATISFIED | `bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8` class confirmed |
| INVITE-01 | 26-02, 26-06 | POST /auth/invite returns {code, expiresAt, inviteUrl} with CHAR(8) | ✓ SATISFIED | generateInvite() + CHARSET confirmed; InviteTeamDialog displays result |
| INVITE-02 | 26-02 | GET /auth/invite/:code returns preview or {valid:false, reason} | ✓ SATISFIED | getInvitePreview() with not_found/used/expired reasons confirmed |
| INVITE-03 | 26-02 | POST /auth/join atomically consumes invite (single-use) | ✓ SATISFIED | `.is('used_at', null)` atomic UPDATE pattern confirmed |
| INVITE-04 | 26-06 | InviteTeamDialog owner/manager only; copy writes /register?invite=CODE | ✓ SATISFIED | Role gate + navigator.clipboard.writeText(invite.inviteUrl) confirmed |
| ORG-01 | 26-01 | organizations table: id, name, owner_id, created_at, updated_at | ✓ SATISFIED (SQL) | Confirmed in migration SQL |
| ORG-02 | 26-01 | organization_members UNIQUE(org_id, user_id) | ✓ SATISFIED (SQL) | `UNIQUE (organization_id, user_id)` in migration confirmed |
| ORG-03 | 26-01 | organization_invites.code UNIQUE index; used_at NULL before use | ✓ SATISFIED (SQL) | `CREATE UNIQUE INDEX idx_org_invites_code` confirmed |
| ORG-04 | 26-03 | GET /organizations/branches returns {id, name, city, chain_id, chain_name} | ✓ SATISFIED | getBranchesForUser() with correct field set + LEFT JOIN confirmed |
| ORG-05 | 26-03, 26-04 | AuthContext availableRestaurants from /organizations/branches | ✓ SATISFIED | fetchBranches() in AuthContext confirmed |
| CHAIN-01 | 26-01 | restaurant_chains table with org FK + RLS | ✓ SATISFIED (SQL) | Migration SQL confirmed; 3 RLS policies |
| CHAIN-02 | 26-01 | restaurants.chain_id nullable FK to restaurant_chains | ✓ SATISFIED (SQL) | `chain_id UUID REFERENCES restaurant_chains(id) ON DELETE SET NULL` confirmed |
| CHAIN-03 | 26-03 | GET + POST /organizations/chains; POST /organizations/locations | ✓ SATISFIED | All 3 endpoints implemented and wired |
| CHAIN-04 | 26-04, 26-06 | Header groups by chain_name; Settings shows chain-grouped list | ✓ SATISFIED | branchGroups useMemo + chain section headers in Header; same in Settings Locations |

**Orphaned requirements note:** Requirement IDs ONBOARD-01..08, ORG-01..05, CHAIN-01..04, INVITE-01..04 do not appear in the central `.planning/REQUIREMENTS.md`. They are tracked only in `26-VALIDATION.md` within the phase directory. This is a cross-phase traceability gap — the requirements exist and are fully implemented, but they are not registered in the central requirements registry.

---

### Anti-Patterns Found

| File | Finding | Severity | Assessment |
|------|---------|----------|------------|
| `apps/web/src/pages/Register.tsx` | `return null` at lines 117, 124 | ℹ️ Info | InviteValidationFeedback early returns when code < 8 chars or preview not loaded — intentional UX gating, not a stub |
| `apps/api-gateway/src/organizations/organizations.service.ts` | `return []` at lines 29, 76, 90, 102 | ℹ️ Info | Error-handling returns on DB error / no org memberships — intentional defensive coding, not stubs |
| All Phase 26 files | No TODO/FIXME/placeholder comments found | ✓ Clean | All implementations are complete |
| `supabase/migrations/*.sql` | No `supabase db push` executed | ⚠️ Warning | Migrations files exist and are syntactically correct, but not applied to any running Supabase instance (no remote link, no local Docker). Phase goal cannot be demonstrated until migrations are applied. |

---

### Human Verification Required

### 1. Database Migration Application

**Test:** Run `supabase db push` (after linking project or starting local Docker instance)
**Expected:** All 5 Phase 26 migrations apply without errors. Tables `organizations`, `organization_members`, `organization_invites`, `email_verifications`, `restaurant_chains` exist. Columns `restaurants.city`, `restaurants.phone`, `restaurants.organization_id`, `restaurants.chain_id`, `users.email_verified` exist.
**Why human:** `supabase db push` failed during plan execution — project not linked to remote Supabase, no local Docker instance running. SQL files are syntactically correct but schema does not exist in any running DB.

### 2. End-to-End Path B Registration (New Owner)

**Test:** Navigate to /register → click "Create a New Restaurant" card → complete account form → complete restaurant form → verify redirect to /verify-email → check email arrives (if Gmail configured) → click verification link → confirm redirect to dashboard
**Expected:** Full flow completes without errors. User appears in DB with `email_verified=false` then `true` after verification. Organization and restaurant rows created atomically.
**Why human:** Requires running backend + applied DB migrations + browser to test full flow.

### 3. End-to-End Path A Registration (Staff Invite)

**Test:** As owner: Settings → Team → Invite Member → generate → copy invite URL → open in new browser tab → complete join form → confirm landing on dashboard with emailVerified=true (no /verify-email redirect). Verify invite code is now `used_at` non-null.
**Expected:** Second attempt with same code returns "invalid, expired, or already used" error.
**Why human:** Requires two authenticated sessions + running DB.

### 4. Branch Switcher Multi-Location UX

**Test:** Log in with an account having 2+ restaurants under same organization. Check top nav — branch switcher should appear. Verify branches show name + city. If chains exist, verify grouping under chain headers.
**Expected:** Switcher hidden when only 1 branch. Grouped by chain_name when set. Optimistic loading spinner during switch.
**Why human:** Requires DB with real multi-location org data.

### 5. Settings Locations: Chain + Location Creation Round-Trip

**Test:** As owner: Settings → Locations section → Create Chain (enter name + submit) → Add Location → verify chain appears in chain dropdown → fill form → submit → confirm toast success → log out + log in → verify new location appears in branch switcher.
**Expected:** POST /organizations/chains and POST /organizations/locations create real DB rows. Branch switcher picks up new location after login.
**Why human:** Requires live DB to verify round-trip persistence.

---

### Gaps Summary

No code-level gaps found. All 21 observable truths have substantive, wired implementations in the codebase. The 2 UNCERTAIN truths relate exclusively to the Supabase migration execution environment — the SQL schemas are correct and complete, but `supabase db push` was not run (documented in 26-01-SUMMARY.md as expected given no project link and no local Docker).

The human verification items are required to confirm the full goal is observably true in a running environment. Once DB migrations are applied and an E2E walkthrough passes, this phase can be marked `passed`.

**Root cause of human_needed status:** `supabase db push` deferred by environment limitations, not by incomplete implementation.

---

*Verified: 2026-05-07T22:05:00-05:00*
*Verifier: Claude (gsd-verifier)*
