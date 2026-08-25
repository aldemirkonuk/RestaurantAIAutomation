# Phase 33 — Multi-Restaurant Membership Model
## RESEARCH.md

**Created:** 2026-05-14  
**Author:** AI + Architect  
**Status:** Research complete — ready for planning  
**Confidence:** 0.97 (all claims verified against live migration files and service source)

---

## 1. Executive Summary

The current database and service layer has **three partially overlapping systems** for tracking which users belong to which restaurant. None of them is complete. The result is:

- Querying "who are the staff of restaurant X?" has no single correct query.
- An existing user **cannot join a second restaurant** — the invite flow hard-crashes with `BadRequestException('Email already registered')`.
- `user_restaurant_access` exists in the DB schema but **zero code paths write to it** — it is a dead table.
- The JWT embeds a single `restaurantId`, which is a snapshot from registration time and cannot represent multi-restaurant membership.
- RLS policies across all data tables (`restaurant_inventory`, `providers`, etc.) rely on `users.restaurant_id` (single FK) — changing the membership model without updating RLS would break data isolation.

This document maps every broken scenario, the root cause of each, and designs the correct long-term architecture.

---

## 2. Current Schema State (Evidence-Based)

### 2.1 The three membership systems

| System | Table | Written by | Status |
|---|---|---|---|
| Legacy direct FK | `users.restaurant_id` | `registerRestaurant`, `joinViaInvite`, `register` | Active but single-valued |
| Org-level junction | `organization_members` | `registerRestaurant`, `joinViaInvite` | Active but org-level only, not restaurant-level |
| Restaurant-level junction | `user_restaurant_access` | **Nobody** | Dead table — schema exists, zero writes |

### 2.2 `users` table (baseline migration)

```sql
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email    VARCHAR(255) UNIQUE NOT NULL,
    role     VARCHAR(50) DEFAULT 'manager',          -- single flat role column
    restaurant_id UUID REFERENCES restaurants(id)    -- single FK — the core problem
        ON DELETE SET NULL,
    ...
);
```

`restaurant_id` is a **single FK**. It stores whichever restaurant the user was created into. It cannot represent "this user belongs to restaurants A, B, and C."

### 2.3 `user_restaurant_access` table (baseline migration)

```sql
CREATE TABLE IF NOT EXISTS user_restaurant_access (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(user_id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    role          VARCHAR(50) DEFAULT 'manager',
    granted_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, restaurant_id)
);
```

This is the **correct design** for the membership problem. It exists in the DB. But no service writes to it, and no RLS policy reads from it for data access control.

### 2.4 `organization_members` table (Phase 26 migration)

```sql
CREATE TABLE IF NOT EXISTS organization_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL DEFAULT 'manager'
        CHECK (role IN ('owner', 'manager', 'staff')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    invited_via     UUID,
    UNIQUE (organization_id, user_id)
);
```

This tracks membership at the **org level**. One org can have many restaurants. This table answers "is this user in our company?" but not "which specific branches can this user access?" — that granularity is missing.

### 2.5 `joinViaInvite` — the hard crash

```typescript
// auth.service.ts line 702-707
async joinViaInvite(dto: JoinViaInviteDto): Promise<TokenPair> {
    const { data: existing } = await this.databaseService.supabase
      .from('users').select('email').eq('email', dto.email).maybeSingle();
    if (existing) throw new BadRequestException('Email already registered');
    // ... creates new user, then inserts into organization_members only
```

The check `if (existing) throw` fires for **any email that already has an account**, regardless of whether they are joining a new restaurant. The fix is: existing user → add membership row, do NOT create new user.

### 2.6 JWT payload structure

```typescript
const payload = {
    sub: user.user_id,
    email: user.email,
    role: user.role,                    // single flat role
    restaurantId: user.restaurant_id,   // single restaurant from users table
    emailVerified: user.email_verified ?? false,
    app_metadata: { roles: studioRoles },
};
```

`restaurantId` in the JWT is set from `users.restaurant_id` at token generation time. After `switchRestaurant`, a new token is issued with the switched `restaurant_id`. This pattern works fine **as long as the user can actually switch** — the switch is validated via `organization_members → organizations → restaurants.organization_id`, which is correct. The JWT pattern itself does not need to change.

### 2.7 How data access control currently works (RLS baseline)

All data tables (`restaurant_inventory`, `providers`, `calendar_events`, `procurement_orders`, etc.) are filtered by `restaurant_id`. The JWT carries the active `restaurantId`, and the NestJS layer passes `X-Restaurant-Id` header from which services read. RLS policies use service-role key (bypass RLS) from NestJS, so the data scoping is enforced by the service layer's `WHERE restaurant_id = :activeId`, not by PostgreSQL RLS directly on data tables.

This means: the JWT's `restaurantId` is the single gate. As long as `switchRestaurant` only allows the user to switch to a restaurant they legitimately belong to, data isolation holds.

---

## 3. The 12 Broken Scenarios

### Scenario 1 — Manager owns 4–5 different restaurants

**Setup:** An owner registers with Restaurant A. Later adds Branch B, C, D, E via `createLocation`.

**What happens today:**
- Owner's `users.restaurant_id = restaurant_A_id` (set at registration).
- Restaurants B–E have `organization_id = owner_org_id` but are NOT reflected in `users.restaurant_id`.
- `getBranchesForUser` works (via org membership), so the branch switcher UI shows all 5.
- `switchRestaurant` works (validates against `organization_members`).

**What is broken:**
- `GET /staff?restaurantId=B` returns nobody except the owner (indirectly via `users.restaurant_id` pointing to A, which does not match B).
- **No staff roster query works reliably for any restaurant except the one in `users.restaurant_id`.**
- If the owner is queried by `users.restaurant_id = B`, they appear as "not a member of B" even though they own the org that contains B.

**Root cause:** Membership is tracked at org level, not restaurant level. Restaurant-level membership rows (`user_restaurant_access`) are never written.

---

### Scenario 2 — Staff member works at 2 branches of the same chain

**Setup:** Alice is staff at Branch A of "Joe's Wine Bar." Branch B opens, manager invites Alice.

**What happens today:**
```typescript
// joinViaInvite line 702-707
const { data: existing } = ... .from('users').eq('email', alice_email);
if (existing) throw new BadRequestException('Email already registered');
```
Alice's invite attempt **crashes at the email check**. She cannot join Branch B at all.

**Root cause:** `joinViaInvite` treats "email exists" as "registration conflict" instead of "existing user accepting a new membership."

---

### Scenario 3 — Staff works at 2 entirely different companies

**Setup:** Bob is a sommelier who works 3 days at Restaurant X (Org Alpha) and 2 days at Restaurant Y (Org Beta).

**What happens today:** Same crash as Scenario 2. The second invite fails with `BadRequestException`.

**Additional break:** Even if it didn't crash, `users.role` is a single flat column. Bob cannot be `staff` at Org Alpha and `manager` at Org Beta simultaneously — the column holds one value.

**Root cause:** Same as Scenario 2 for the crash. Additionally, `users.role` is not the right place to store role — `user_restaurant_access.role` per-restaurant row is the right place.

---

### Scenario 4 — Staff transferred between branches

**Setup:** Carol moves from Branch A to Branch B within the same org.

**What happens today:**
- Manager would need to manually update `users.restaurant_id = branch_B_id`.
- No API endpoint exists for this.
- Old `users.restaurant_id` value (Branch A) is overwritten — history lost.
- Carol's inventory contributions at Branch A become disassociated from an active staff member.

**Root cause:** No `user_restaurant_access` row with history. Single FK has no versioning.

---

### Scenario 5 — Role change (staff promoted to manager or manager to owner)

**Setup:** Dave is `staff` at Restaurant X. Owner promotes him to `manager`.

**What happens today:**
- `organization_members.role` could be updated to `manager`.
- `users.role` would also need to be updated separately.
- These two can drift if one update is missed.
- JWT still carries the old role until the user logs out and back in, or calls `refresh`.
- No API endpoint exists for "change member role."

**Root cause:** Role is stored in two places (`users.role` and `organization_members.role`) with no synchronization guarantee. The JWT embeds role from `users.role` only.

---

### Scenario 6 — Temporary / seasonal staff with time-limited access

**Setup:** Summer intern Eve is granted access from June 1 to August 31.

**What happens today:**
- No `valid_from` / `valid_until` / `is_active` column on any membership table.
- Eve must be manually deleted to revoke access after August 31.
- No automated revocation or visibility into "access expires in 30 days."

**Root cause:** `user_restaurant_access` was designed as a simple junction — temporal columns were never added.

---

### Scenario 7 — Consultant working across multiple unrelated companies

**Setup:** Frank is an external wine consultant. Three unrelated restaurant groups hire him.

**What happens today:**
- First company creates Frank's account via `joinViaInvite` — works.
- Second company invites Frank — **crashes** (same as Scenario 2).
- Third company — same.

**Additional break:** `organization_members` has `UNIQUE(organization_id, user_id)` — structurally, one row per org is fine. But the code never reaches the org insert because the email check crashes first.

**Root cause:** Same as Scenario 2.

---

### Scenario 8 — Existing user invited to restaurant they already access

**Setup:** Grace is already a staff member at Restaurant A. Someone sends her a duplicate invite to the same restaurant.

**What happens today:** `joinViaInvite` crashes with `'Email already registered'`. A graceful "you already have access" response should be returned instead.

**Root cause:** Same as Scenario 2.

---

### Scenario 9 — Restaurant permanently closed / org deleted

**Setup:** A restaurant closes. The org is deleted or the restaurant row is deleted.

**What happens today:**
- `restaurants` deletion cascades to `providers`, `restaurant_inventory`, etc. ✅
- `organization_members` has `ON DELETE CASCADE` on `organization_id` — org deletion removes memberships. ✅
- `users.restaurant_id` has `ON DELETE SET NULL` — after restaurant deletion, user row has `restaurant_id = NULL`.
- The user now has a valid JWT with `restaurantId = '<deleted_id>'` until it expires (up to 15 minutes; refresh token lasts 7 days).
- `refreshAccessToken` reads `users.restaurant_id` which is now `NULL` — new tokens will have `restaurantId: null`.
- No active session invalidation when the restaurant is deleted.

**What breaks:** For up to 7 days (refresh token validity), a user can keep refreshing tokens with a stale deleted restaurant ID if the refresh token path does not re-check restaurant existence. The token blacklist covers single logout but not "restaurant deleted" cascade invalidation.

---

### Scenario 10 — Data isolation: cross-branch data leak risk

**Setup:** Henry is staff at Branch A and Branch B (once Scenario 2 is fixed). He is currently "active" at Branch A (JWT's `restaurantId = branch_A`).

**What should happen:** Accessing `/inventory` returns only Branch A's data.

**What happens today:** The `X-Restaurant-Id` header in NestJS is set to the JWT's `restaurantId`. All service queries use `WHERE restaurant_id = X-Restaurant-Id`. This is correct for the current single-restaurant model.

**What breaks AFTER fixing Scenario 2:** When Henry switches to Branch B via `switchRestaurant`, a new JWT is issued with `restaurantId = branch_B`. The switch validation checks `organization_members → org → restaurant.organization_id`. But if Henry is in Org Alpha (owns Branch A) and the fix adds him to Org Beta membership as well, the `switchRestaurant` validation would allow him to switch to ANY restaurant in either org, not just the ones he has been explicitly granted access to.

**Root cause:** `switchRestaurant` validates via org membership (coarse-grained). Once `user_restaurant_access` is properly populated, `switchRestaurant` must validate against `user_restaurant_access` (fine-grained), not just org membership.

---

### Scenario 11 — OAuth user (Google/Microsoft) joining via invite

**Setup:** Irene uses Google OAuth to log in. A manager wants to invite her to a restaurant.

**What happens today:**
- `findOrCreateOAuthUser` creates the user on first Google OAuth login, with `restaurant_id = NULL` (no restaurant assigned at OAuth login time).
- `joinViaInvite` requires `dto.email` and `dto.password` — but Irene has no password (OAuth-only account).
- `joinViaInvite` calls `bcrypt.hash(dto.password, ...)` on whatever is submitted, creating a password hash for an OAuth-only user, which is a security concern.
- Additionally: `joinViaInvite` crashes at line 707 if Irene already has an account from OAuth login.

**Root cause:** No invite flow for existing OAuth users. `joinViaInvite` always creates a new user with a password, incompatible with OAuth-only accounts.

---

### Scenario 12 — Staff roster API: no reliable "get all members of restaurant X" query

**Setup:** Manager opens the Team tab in Settings and expects to see all staff for the currently active restaurant.

**What the Settings UI calls:** `GET /organizations/members` (or equivalent) — returns `organization_members` rows.

**What this actually returns:** Everyone in the **org**, not everyone in **this specific restaurant**. If Org Alpha has 3 restaurants with 10 staff each, the team tab for Branch A would show all 30 staff.

**The correct query (does not work today):**
```sql
SELECT u.user_id, u.name, u.email, ura.role, ura.granted_at
FROM user_restaurant_access ura
JOIN users u ON u.user_id = ura.user_id
WHERE ura.restaurant_id = :activeRestaurantId
  AND ura.is_active = true;
```
This query returns zero rows because `user_restaurant_access` is never written to.

**Root cause:** The intended design (populate `user_restaurant_access` per invite/registration) was never implemented.

---

## 4. Root Cause Summary

All 12 scenarios share **three root causes** that must all be fixed together:

| # | Root Cause | Impact |
|---|---|---|
| RC-1 | `joinViaInvite` blocks existing users at email check instead of adding a membership row | Scenarios 2, 3, 7, 8, 11 — any existing user cannot join a second restaurant |
| RC-2 | `user_restaurant_access` is never written to by any code path | Scenarios 1, 4, 10, 12 — no reliable per-restaurant staff roster, no fine-grained access control |
| RC-3 | `users.role` is a single flat column that cannot represent different roles at different restaurants | Scenarios 3, 5 — role management is unreliable and can drift |

---

## 5. Proposed Architecture: Workspace Membership Model

The model is identical to how Slack, Notion, and Linear handle it: **one identity (user), N memberships (workspaces), independent roles per membership.** Restaurants are workspaces.

### 5.1 Canonical membership table design

`user_restaurant_access` becomes the **single source of truth** for "who can access what restaurant with what role." It needs the following additions:

```sql
ALTER TABLE user_restaurant_access
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS valid_from     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS valid_until    TIMESTAMPTZ,                        -- NULL = permanent
  ADD COLUMN IF NOT EXISTS invited_via    UUID REFERENCES organization_invites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES users(user_id) ON DELETE SET NULL;

-- Index for the hot query: "all active members of restaurant X"
CREATE INDEX IF NOT EXISTS idx_ura_restaurant_active
  ON user_restaurant_access(restaurant_id, is_active)
  WHERE is_active = TRUE;

-- Index for "all restaurants user Y can access"
CREATE INDEX IF NOT EXISTS idx_ura_user_active
  ON user_restaurant_access(user_id, is_active)
  WHERE is_active = TRUE;
```

### 5.2 Table relationships (final state)

```
users (identity — one row per human)
  ↓ 1:N
user_restaurant_access (membership — one row per user×restaurant×active-window)
  ↓ N:1
restaurants (workspace — belongs to an organization)
  ↓ N:1
organizations (company — one or many restaurants)
  ↓ 1:N
organization_members (company membership — coarse-grained, for org-level queries)
```

`users.role` and `users.restaurant_id` become **legacy/deprecated** — they are kept for backward compatibility during migration but the authoritative values are `user_restaurant_access.role` and `user_restaurant_access.restaurant_id`.

### 5.3 How `joinViaInvite` must change

```
CURRENT:
  email exists? → throw BadRequestException('Email already registered')

CORRECT:
  email exists?
    YES → load existing user, add user_restaurant_access row + organization_members upsert → return tokens
    NO  → create new user, add user_restaurant_access row + organization_members row → return tokens
```

In both paths:
1. Consume the invite (atomic UPDATE WHERE used_at IS NULL — keep this, it's correct).
2. Add `user_restaurant_access` row for the specific `restaurant_id` from the invite.
3. Upsert `organization_members` for the org (handles both new and existing org members).
4. Issue tokens scoped to the invited `restaurant_id`.

For the "existing user, OAuth account" case: skip password creation. Do not touch `password_hash`.

### 5.4 How `registerRestaurant` must change

In addition to the current writes, add:

```typescript
await supabase.from('user_restaurant_access').insert({
    user_id: userId,
    restaurant_id: restaurantId,
    role: 'owner',
    invited_via: null,
    is_active: true,
});
```

### 5.5 How `switchRestaurant` must change

**Current:** validates via `organization_members → organization_id → restaurant.organization_id` (org-level check).

**New:** validate against `user_restaurant_access` (restaurant-level check):

```typescript
// New validation
const { data: access } = await supabase
    .from('user_restaurant_access')
    .select('role')
    .eq('user_id', userId)
    .eq('restaurant_id', targetRestaurantId)
    .eq('is_active', true)
    .maybeSingle();

if (!access) {
    // Fallback for legacy users (no ura row yet): keep current org-level check
    // once all users have ura rows, remove fallback
}
```

### 5.6 How `generateTokens` must change

The JWT needs the role **for the active restaurant**, not the flat `users.role`:

```typescript
// New: fetch role from user_restaurant_access for the active restaurant
const { data: membership } = await supabase
    .from('user_restaurant_access')
    .select('role')
    .eq('user_id', user.user_id)
    .eq('restaurant_id', user.restaurant_id)
    .eq('is_active', true)
    .maybeSingle();

const role = membership?.role ?? user.role; // fallback for legacy users
```

### 5.7 Staff roster API (new query)

```sql
-- GET /restaurants/:id/members
SELECT
    u.user_id,
    u.name,
    u.email,
    u.avatar_url,
    u.auth_provider,
    ura.role,
    ura.granted_at,
    ura.valid_until,
    ura.is_active,
    oi.code AS invited_via_code,
    inviter.name AS invited_by_name
FROM user_restaurant_access ura
JOIN users u ON u.user_id = ura.user_id
LEFT JOIN organization_invites oi ON oi.id = ura.invited_via
LEFT JOIN users inviter ON inviter.user_id = oi.invited_by
WHERE ura.restaurant_id = :restaurantId
  AND ura.is_active = TRUE
ORDER BY ura.granted_at ASC;
```

This query **works correctly once `user_restaurant_access` is populated**.

### 5.8 Temporal / seasonal access

```typescript
// When generating invite for seasonal staff:
await supabase.from('organization_invites').insert({
    ...inviteData,
    // no change needed — valid_until goes on user_restaurant_access, not invite
});

// On joinViaInvite or addMember:
await supabase.from('user_restaurant_access').insert({
    user_id,
    restaurant_id,
    role,
    valid_until: dto.validUntil ?? null,  // passed from invite or manager override
    is_active: true,
});
```

A scheduled job (or a trigger) deactivates rows where `valid_until < NOW()`:

```sql
-- PostgreSQL function, called by pg_cron or Supabase scheduled function
UPDATE user_restaurant_access
SET is_active = FALSE, deactivated_at = NOW()
WHERE valid_until IS NOT NULL
  AND valid_until < NOW()
  AND is_active = TRUE;
```

### 5.9 Role management API (new endpoint needed)

`PATCH /restaurants/:restaurantId/members/:userId` → updates `user_restaurant_access.role`.

Must also update `users.role` for backward compatibility until legacy FK is fully removed.

### 5.10 Session invalidation when restaurant deleted

When a restaurant is deleted:
1. `user_restaurant_access` rows cascade-delete (ON DELETE CASCADE already on `restaurant_id` FK).
2. Add a DB trigger that inserts invalidated user IDs into a `session_invalidations` table.
3. `refreshAccessToken` checks this table and rejects refresh tokens for invalidated users.

Alternatively (simpler): on restaurant deletion, add all affected user IDs to the token blacklist with TTL = 7 days (refresh token expiry).

---

## 6. Migration Strategy

This must be **zero-downtime** and **fully backward-compatible**. The legacy `users.restaurant_id` and `users.role` columns must continue working during the transition.

### Wave 1 — DB schema (non-breaking)
- Alter `user_restaurant_access` to add `is_active`, `valid_from`, `valid_until`, `invited_via`, `deactivated_at`, `deactivated_by`.
- Add indexes.
- Add `GET /restaurants/:id/members` endpoint.

### Wave 2 — Backfill (data repair)
- For every user with `restaurant_id IS NOT NULL`, insert a row in `user_restaurant_access` (role from `users.role`).
- For every `organization_members` row, derive which restaurant the user is linked to and upsert `user_restaurant_access`.
- Idempotent via `ON CONFLICT (user_id, restaurant_id) DO NOTHING`.

```sql
-- Backfill from users.restaurant_id
INSERT INTO user_restaurant_access (user_id, restaurant_id, role, granted_at, is_active)
SELECT user_id, restaurant_id, role, created_at, TRUE
FROM users
WHERE restaurant_id IS NOT NULL
ON CONFLICT (user_id, restaurant_id) DO NOTHING;
```

### Wave 3 — Service writes (dual-write)
- `registerRestaurant`: also writes `user_restaurant_access`.
- `joinViaInvite`: split into new-user and existing-user paths; both write `user_restaurant_access`.
- `createLocation`: does NOT add owner to `user_restaurant_access` automatically — owner can already switch via org membership. Document this decision.

### Wave 4 — Read migration
- `switchRestaurant`: add fine-grained `user_restaurant_access` check with org-level fallback for legacy users.
- `generateTokens`: read role from `user_restaurant_access` with fallback to `users.role`.
- Staff roster queries: switch to `user_restaurant_access` as primary source.

### Wave 5 — Role management
- New `PATCH /restaurants/:id/members/:userId` endpoint.
- New `DELETE /restaurants/:id/members/:userId` (soft-deactivate, not hard-delete).
- Update Settings → Team tab to show per-restaurant members, not org-wide members.

### Wave 6 — Temporal access
- Add `valid_until` to invite DTO (optional field).
- Scheduled deactivation trigger or pg_cron job.

### Wave 7 — Deprecation (future, not this phase)
- Once all users have `user_restaurant_access` rows and the legacy fallback has zero hits for 30+ days, deprecate `users.restaurant_id` and `users.role`.
- These can be kept as read-only computed columns until next major version.

---

## 7. RLS Impact Assessment

| Table | Current RLS / Scoping | Change Required? |
|---|---|---|
| `restaurant_inventory` | Scoped by `X-Restaurant-Id` header in NestJS service layer | None — service layer already filters by active restaurant ID from JWT |
| `providers` | Same | None |
| `calendar_events` | Same | None |
| `procurement_orders` | Same | None |
| `user_restaurant_access` | RLS enabled (Supabase) — currently no policy | Add: users can read own rows; org owners can read all rows for their restaurants |
| `organization_members` | RLS enabled — members read own; owner reads all | No change |
| `users` | No RLS (service role reads) | No change — accessed via service role in NestJS |

The NestJS service layer's JWT+header model is **sound** and does not need architectural change. The key fix is ensuring `user_restaurant_access` is populated so that `switchRestaurant` can validate at the right granularity.

---

## 8. API Changes Required

| Method | Path | Status | Notes |
|---|---|---|---|
| `POST` | `/auth/join` (joinViaInvite) | **Modify** | Split new-user vs existing-user path |
| `POST` | `/auth/register/restaurant` | **Modify** | Add `user_restaurant_access` write |
| `GET` | `/restaurants/:id/members` | **New** | Staff roster for specific restaurant |
| `PATCH` | `/restaurants/:id/members/:userId` | **New** | Change member role |
| `DELETE` | `/restaurants/:id/members/:userId` | **New** | Soft-deactivate membership |
| `POST` | `/restaurants/:id/members` | **New** | Add existing user to restaurant (manager-initiated, no invite code needed for internal transfers) |

---

## 9. Frontend Changes Required

| Component | Change |
|---|---|
| Settings → Team tab | Filter members by active `restaurantId`, not whole org. Use new `GET /restaurants/:id/members`. |
| Settings → Team → Invite | Optionally pass `valid_until` for seasonal staff. |
| Register.tsx `joinViaInvite` flow | No UI change needed — backend handles existing-user case. |
| Branch switcher | No change — already works via `switchRestaurant`. |

---

## 10. Decisions Locked

| ID | Decision | Rationale |
|---|---|---|
| D-01 | `user_restaurant_access` is the authoritative restaurant membership table | It was designed for this; `users.restaurant_id` is legacy |
| D-02 | Existing user accepting invite → add membership row, never create duplicate user | Standard workspace model; prevents data fragmentation |
| D-03 | `users.role` and `users.restaurant_id` kept for backward-compat during transition | Zero-downtime migration; remove in future phase after all rows backfilled |
| D-04 | `switchRestaurant` validation moves to `user_restaurant_access` with org-level fallback | Fine-grained access control; fallback for legacy gap users |
| D-05 | Role in JWT sourced from `user_restaurant_access.role` for active restaurant | Role must be per-restaurant, not global |
| D-06 | Soft-delete (deactivate) membership rows, never hard-delete | Audit trail, reactivation possible, history preserved |
| D-07 | `createLocation` does NOT auto-add org owner to `user_restaurant_access` | Owner's access is still gated via org membership + `switchRestaurant`; explicit grant model for new locations is safer |
| D-08 | Temporal access via `valid_until` on `user_restaurant_access`, not on invites | Invite is a one-time artifact; the membership duration belongs on the membership row |

---

## 11. Success Criteria for Phase 33

1. `SELECT * FROM user_restaurant_access WHERE restaurant_id = :id AND is_active = TRUE` returns all active members for any restaurant.
2. An existing user can accept an invite to a second restaurant without error.
3. A user belonging to 3 different restaurant groups can switch between all of them via `switchRestaurant`.
4. `GET /restaurants/:id/members` returns the correct per-restaurant roster.
5. `PATCH /restaurants/:id/members/:userId` updates role in both `user_restaurant_access` and `users.role` atomically.
6. `DELETE /restaurants/:id/members/:userId` soft-deactivates the row and the user loses access on next token refresh.
7. Backfill migration is idempotent — running it twice produces no duplicates.
8. All existing users retain access (no regressions from migration).
9. OAuth users (Google/Microsoft) can be added to a restaurant via manager-initiated path.
10. Settings Team tab shows only members of the currently active restaurant, not the whole org.

---

## 12. Out of Scope (This Phase)

- Removing `users.restaurant_id` and `users.role` legacy columns (Wave 7 — future).
- Temporal access UI (admin sets `valid_until` via invite or team settings) — Wave 6.
- Cross-org consultant role management (multi-org JWT) — future.
- Toast POS staff sync (mapping Toast employees to WineOps users) — future.
- SSO / SCIM provisioning — future.
