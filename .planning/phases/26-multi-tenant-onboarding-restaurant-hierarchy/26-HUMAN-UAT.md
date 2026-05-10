---
status: passed
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
source: [26-VERIFICATION.md]
started: 2026-05-07T21:55:00Z
updated: 2026-05-10T00:00:00Z
---

## Current Test

All 8 tests passed. Phase 26 UAT complete.

## Tests

### 1. Apply DB migrations to Supabase
expected: Run `supabase db push` (or `supabase link` then `supabase db push`) — all 5 Phase 26 migration files apply without errors. Tables `organizations`, `organization_members`, `organization_invites`, `email_verifications`, `restaurant_chains` exist in the Supabase dashboard. `restaurants.city`, `restaurants.phone`, `restaurants.organization_id`, `restaurants.chain_id`, `users.email_verified` columns exist.
result: PASSED — Supabase project linked (exzueerziesmczwlhomd). All 5 migrations applied. Tables and columns confirmed via Supabase dashboard.

### 2. Path B — Owner registers new restaurant (H-01)
expected: Visit `/register` → "Create New Restaurant" card → fill account + restaurant form → submit → email verification page shown → after verifying, dashboard loads. `organizations` and `restaurants` rows appear in Supabase.
result: PASSED — email verification flow confirmed working. 401 bug fixed (removed JwtAuthGuard from verify-email endpoint). DB rows created correctly.

### 3. Path A — Staff joins via invite URL (H-02)
expected: Owner generates invite from Settings → Team → "Invite Member". Visit `/register?invite=XXXXXXXX` → invite code auto-populates → fill account details → submit → dashboard loads with correct restaurant (no email verification needed for Path A).
result: PASSED

### 4. URL param routing — ?type=join skips selector (H-03)
expected: Visit `/register?type=join` → Path A invite entry shown directly, no card selector visible.
result: PASSED

### 5. URL param routing — ?type=new skips selector (H-04)
expected: Visit `/register?type=new` → Path B step 1 shown directly, no card selector visible.
result: PASSED

### 6. Branch switcher groups by chain (H-05)
expected: Owner with 2 chain locations + 1 standalone → Header dropdown shows chain name as header with grouped locations beneath, standalone listed separately. Switcher only visible when >1 branch available.
result: PASSED — required Test 7 first to create chain + locations. Confirmed grouping correct.

### 7. Create chain in Settings (H-06)
expected: Settings → Locations → "Create Chain" → enter name → submit → chain appears in AddLocationDialog dropdown.
result: PASSED

### 8. Add location to chain (H-07)
expected: Settings → Locations → "Add Location" → select chain → fill details → submit → new location appears in branch switcher under chain name.
result: PASSED — required fixing `slug NOT NULL` constraint (auto-generated) and making `email` nullable via migration. Both fixes shipped 2026-05-10.

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0
blocked: 0

## Bugs Fixed During UAT

| Bug | Fix | Commit |
|-----|-----|--------|
| `POST /auth/verify-email` returned 401 | Removed JwtAuthGuard from verify-email endpoint | earlier session |
| `.env` parse error (bare base64 JWT secret split across lines) | Wrapped in quotes | earlier session |
| `restaurants.address` JSONB format mismatch → 500 on Add Location | Fixed address format + org_member fallback upsert | earlier session |
| `restaurants.slug NOT NULL` + `restaurants.email NOT NULL` → 400 on Add Location | Auto-generate slug from name + randomUUID; migrate email to nullable | ae8f506 |
| `EditLocationChainDialog` appeared in lower-right corner | Framer Motion `transform:none` overrides Tailwind `-translate-x/y-1/2`; fixed by moving centering to `style={{x,y}}` | b81f526 |
| `CreateChainDialog` only offered current location as checkbox | Replaced with full standalone checklist; assigns all selected via PATCH | 5682030 |
| `Add one →` opened AddLocationDialog (create new only) | Opens `AssignToChainDialog` — checklist of standalones + fallback to create new | fcf5ede |

## Gaps
