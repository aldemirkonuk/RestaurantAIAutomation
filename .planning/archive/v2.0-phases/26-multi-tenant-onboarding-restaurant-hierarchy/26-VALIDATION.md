# Phase 26: Multi-Tenant Onboarding & Restaurant Hierarchy — Validation

**Phase:** 26
**Created:** 2026-05-06
**Derived from:** 26-RESEARCH.md § Validation Architecture

---

## Test Framework

| Property | Value |
|----------|-------|
| Frontend | Vitest — `pnpm test --run` from `apps/web/` |
| Backend  | Jest — `pnpm test` from `apps/api-gateway/` |
| Config   | `vitest.config.ts` (web), `jest.config.ts` (api-gateway) |
| Pre-condition | All 5 Phase 26 migrations applied (`supabase db push`) |

---

## Requirement → Test Map

| Req ID | Behavior Under Test | Test Type | Automated |
|--------|---------------------|-----------|-----------|
| ONBOARD-01 | Register.tsx renders two-card path selector (no `restaurantId` input) | unit | ✓ |
| ONBOARD-02 | Path B wizard: 3-step progression renders account → restaurant → verify-email | unit | ✓ |
| ONBOARD-03 | `?invite=CODE` auto-extracts code and navigates to Path A step 1 | unit | ✓ |
| ONBOARD-03 | `?type=join` skips selector and opens Path A directly | unit | ✓ |
| ONBOARD-03 | `?type=new` skips selector and opens Path B directly | unit | ✓ |
| ONBOARD-04 | VerifyEmail.tsx shows "Check your email" + Resend button | unit | ✓ |
| ONBOARD-05 | `POST /auth/register/restaurant` creates org + restaurant + user atomically | integration | ✓ |
| ONBOARD-05 | Partial failure → transaction rollback, no orphan rows | integration | ✓ |
| ONBOARD-06 | `organizations`, `organization_members`, `organization_invites`, `email_verifications`, `restaurant_chains` tables exist | migration check | ✓ |
| ONBOARD-07 | `POST /auth/verify-email` marks user `email_verified=true` | integration | ✓ |
| ONBOARD-08 | ProtectedRoute redirects `emailVerified=false` user to `/verify-email` | unit | ✓ |
| INVITE-01 | `POST /auth/invite` returns `{code, expiresAt, inviteUrl}` with CHAR(8) code | integration | ✓ |
| INVITE-02 | `GET /auth/invite/:code` returns valid preview `{organization, restaurant, city, role}` | integration | ✓ |
| INVITE-02 | `GET /auth/invite/:code` returns `{valid: false, reason: 'expired'}` for expired code | integration | ✓ |
| INVITE-03 | `POST /auth/join` consumes invite atomically — second call with same code returns 400 | integration | ✓ |
| INVITE-04 | InviteTeamDialog visible to owner/manager only; copy button copies `/register?invite=CODE` | unit | ✓ |
| ORG-01 | `organizations` table has correct columns (id, name, owner_id, created_at, updated_at) | migration check | ✓ |
| ORG-02 | `organization_members` has unique(org_id, user_id) constraint | migration check | ✓ |
| ORG-03 | `organization_invites.code` has UNIQUE index, `used_at` NULL before use | migration check | ✓ |
| ORG-04 | `GET /organizations/branches` returns `[{id, name, city, chain_id, chain_name}]` for user | integration | ✓ |
| ORG-05 | AuthContext `availableRestaurants` populates from `/organizations/branches` after login | unit | ✓ |
| CHAIN-01 | `restaurant_chains` table exists with correct columns and RLS | migration check | ✓ |
| CHAIN-02 | `restaurants.chain_id` is nullable FK to `restaurant_chains` | migration check | ✓ |
| CHAIN-03 | `GET /organizations/chains` returns chains for user's org | integration | ✓ |
| CHAIN-03 | `POST /organizations/chains` creates chain and returns `{id, name, cuisine_type}` | integration | ✓ |
| CHAIN-03 | `POST /organizations/locations` creates restaurant with optional `chainId` | integration | ✓ |
| CHAIN-04 | Header branch switcher groups branches by `chain_name`; standalone listed separately | unit | ✓ |
| CHAIN-04 | Settings Locations section shows chain-grouped branches; Create Chain form present | unit | ✓ |

---

## Automated Verification Commands

### Migration sanity checks
```bash
# All 5 Phase 26 migration files exist
ls supabase/migrations/20260506000*.sql | wc -l  # expect 5

# Key tables
supabase db query "SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('organizations','organization_members','organization_invites','email_verifications','restaurant_chains')"
# expect 5

# chain_id column on restaurants
supabase db query "SELECT column_name FROM information_schema.columns WHERE table_name='restaurants' AND column_name='chain_id'"
# expect 1 row

# RLS enabled on all new tables
supabase db query "SELECT tablename FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename WHERE t.schemaname='public' AND c.relrowsecurity=true AND t.tablename IN ('organizations','organization_members','organization_invites','email_verifications','restaurant_chains')"
# expect 5 rows
```

### TypeScript build (zero errors required)
```bash
cd apps/api-gateway && pnpm build 2>&1 | grep "error TS" | wc -l  # expect 0
cd apps/web && pnpm build 2>&1 | grep "error TS\|Type error" | wc -l  # expect 0
```

### Key endpoint contract checks
```bash
# @Public() on register/join (must return 422/400, NOT 401, for missing body)
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/v1/auth/register/restaurant
# expect 400 or 422 (not 401 — endpoint is public)

curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/v1/auth/join
# expect 400 or 422 (not 401)

# Protected endpoint (must return 401 without auth)
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/api/v1/auth/invite
# expect 401

curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/v1/organizations/branches
# expect 401

curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/v1/organizations/chains
# expect 401
```

### Frontend component checks
```bash
# All new files exist
ls apps/web/src/pages/Register.tsx
ls apps/web/src/pages/VerifyEmail.tsx
ls apps/web/src/components/team/InviteTeamDialog.tsx
ls apps/web/src/components/locations/AddLocationDialog.tsx

# Chain-awareness in AuthContext
grep "chain_id\|chain_name" apps/web/src/contexts/AuthContext.tsx | wc -l  # expect >= 4

# Header chain grouping
grep "branchGroups\|chain_name" apps/web/src/components/layout/Header.tsx | wc -l  # expect >= 3

# URL param routing in Register
grep "type.*join\|type.*new" apps/web/src/pages/Register.tsx | wc -l  # expect >= 2
```

---

## Wave 0 Pre-conditions

Before any integration tests run:
- [ ] `supabase db push` completes without errors (all 5 migrations applied)
- [ ] `apps/api-gateway` TypeScript build passes (0 errors)
- [ ] `apps/web` TypeScript build passes (0 errors)
- [ ] Auth service running at `localhost:4000`

---

## Human UAT (live verification)

| # | Scenario | Steps | Pass Condition |
|---|----------|-------|----------------|
| H-01 | Owner registers new restaurant | Visit `/register` → "Create New Restaurant" → fill form → submit | Dashboard loads, email verification page shown |
| H-02 | Staff joins via invite URL | Visit `/register?invite=XXXXXXXX` → invite auto-populates → fill account → submit | Dashboard loads with correct restaurant |
| H-03 | `/register?type=join` skips selector | Visit URL | Path A invite entry shown directly (no card selector) |
| H-04 | `/register?type=new` skips selector | Visit URL | Path B step 1 shown directly (no card selector) |
| H-05 | Branch switcher groups by chain | Owner has 2 chain locations + 1 standalone | Header dropdown shows chain name header + grouped locations |
| H-06 | Create chain in Settings | Settings → Locations → "Create Chain" → name → submit | Chain appears in AddLocationDialog dropdown |
| H-07 | Add location to chain | Settings → Locations → "Add Location" → select chain → submit | New location appears in branch switcher under chain |
