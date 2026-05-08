---
status: partial
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
source: [26-VERIFICATION.md]
started: 2026-05-07T21:55:00Z
updated: 2026-05-07T21:55:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Apply DB migrations to Supabase
expected: Run `supabase db push` (or `supabase link` then `supabase db push`) — all 5 Phase 26 migration files apply without errors. Tables `organizations`, `organization_members`, `organization_invites`, `email_verifications`, `restaurant_chains` exist in the Supabase dashboard. `restaurants.city`, `restaurants.phone`, `restaurants.organization_id`, `restaurants.chain_id`, `users.email_verified` columns exist.
result: [pending]

### 2. Path B — Owner registers new restaurant (H-01)
expected: Visit `/register` → "Create New Restaurant" card → fill account + restaurant form → submit → email verification page shown → after verifying, dashboard loads. `organizations` and `restaurants` rows appear in Supabase.
result: [pending]

### 3. Path A — Staff joins via invite URL (H-02)
expected: Owner generates invite from Settings → Team → "Invite Member". Visit `/register?invite=XXXXXXXX` → invite code auto-populates → fill account details → submit → dashboard loads with correct restaurant (no email verification needed for Path A).
result: [pending]

### 4. URL param routing — ?type=join skips selector (H-03)
expected: Visit `/register?type=join` → Path A invite entry shown directly, no card selector visible.
result: [pending]

### 5. URL param routing — ?type=new skips selector (H-04)
expected: Visit `/register?type=new` → Path B step 1 shown directly, no card selector visible.
result: [pending]

### 6. Branch switcher groups by chain (H-05)
expected: Owner with 2 chain locations + 1 standalone → Header dropdown shows chain name as header with grouped locations beneath, standalone listed separately. Switcher only visible when >1 branch available.
result: [pending]

### 7. Create chain in Settings (H-06)
expected: Settings → Locations → "Create Chain" → enter name → submit → chain appears in AddLocationDialog dropdown.
result: [pending]

### 8. Add location to chain (H-07)
expected: Settings → Locations → "Add Location" → select chain → fill details → submit → new location appears in branch switcher under chain name.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
