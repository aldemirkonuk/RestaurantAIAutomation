# Phase 26: Multi-Tenant Onboarding & Restaurant Hierarchy — Research

**Researched:** 2026-05-06
**Domain:** Full-stack multi-tenancy — Supabase migrations, NestJS endpoints, React wizard UX
**Confidence:** HIGH (all key files read directly from codebase)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Two-path registration — Path A (join via 8-char alphanumeric invite code) and Path B (create new restaurant). No "enter restaurant ID directly" field. Large card-style path selectors, not radio buttons.

**D-02:** Password security — bcrypt server-side (Supabase handles via existing system), plain text over HTTPS from frontend. No client-side hashing.

**D-03:** Restaurant hierarchy — `organizations` table → one-to-many `restaurants`. Owner auto-assigned. All agents/data scoped to `restaurant_id`. Organization is grouping only.

**D-04:** Invite codes — 8-char alphanumeric (uppercase, no ambiguous 0/O/1/I), expires 7 days, single-use (marked `used_at`), sharing via code + copy-able invite URL (`/register?invite=XXXXXXXX`), joining user gets `manager` role. Preview card before confirm.

**D-05:** Email verification — Supabase built-in for Path B (create). Path A (invite) skips verification. "Check your email" holding page with resend button (rate-limited 1/min).

**D-06:** Branch context switcher — `availableRestaurants` wired from org membership. Shows name + city. Persists in `localStorage`. Switch reloads data without full page refresh. Only visible with ≥2 branches.

**D-07:** Full-stack scope — frontend (Register.tsx, Settings.tsx, AuthContext.tsx, top nav), backend (5 new endpoints), database (3 new tables + RLS).

**D-08:** UX elevation — progressive wizard, inline invite validation (debounced 400ms), smart timezone auto-detect, copy-able link, error recovery, branch switcher loading state with optimistic UI.

**D-09:** RLS — every new table gets RLS. Specific policies per table as documented in CONTEXT.md.

### Claude's Discretion

- Invite code generation algorithm (crypto-random, server-side)
- Exact animation/transition details for wizard steps (use existing framer-motion patterns from Login.tsx)
- Whether to add onboarding checklist after restaurant creation (recommended but implementation details deferred)

### Deferred Ideas (OUT OF SCOPE)

- SSO / Google / Microsoft login for new registrations (already wired, keep as-is)
- Billing per organization
- Cross-restaurant reporting / consolidated dashboards
- Mobile app registration
- Role permission matrix UI
- Org-level admin dashboard
- Bulk invite (CSV upload)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ONBOARD-01 | Fix broken registration — remove restaurantId field from register form | Current `register()` in `auth.service.ts` requires `data.restaurantId` — must be replaced with two-path flow |
| ONBOARD-02 | Path B wizard: Step 1 (account) → Step 2 (restaurant) → Step 3 (verify email) | `Register.tsx` needs full rewrite; follow Login.tsx motion.div patterns; 3-step wizard |
| ONBOARD-03 | Path A wizard: Step 1 (invite code entry) → Step 2 (preview + account fields) → redirect | Inline validation via `GET /auth/invite/:code`; auto-extract from `?invite=` URL param |
| ONBOARD-04 | Email verification holding page with resend (rate-limited 1/min) | Custom token approach required (see Email Verification section); email via existing comm infrastructure |
| ONBOARD-05 | `POST /auth/register/restaurant` endpoint — create org + restaurant + user atomically | New endpoint in `AuthController`; use `@Public()` + `TenantBypass`; DB transaction pattern |
| ONBOARD-06 | `organizations` and `organization_members` tables with RLS | Migration file naming `20260506000000_organizations.sql`; follow `user_roles.sql` pattern |
| ONBOARD-07 | Timezone auto-detection (`Intl.DateTimeFormat().resolvedOptions().timeZone`) | Frontend only; pass in restaurant creation payload |
| ONBOARD-08 | Registration wizard matches Login.tsx card/motion style exactly | Use identical classes: `bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8` |
| INVITE-01 | `POST /auth/invite` endpoint — generate 8-char invite code | Protected (JwtAuthGuard + `@Roles('owner', 'manager')`); crypto-random server-side |
| INVITE-02 | `GET /auth/invite/:code` endpoint — preview invite (public) | Returns `{ valid, organization, restaurant, inviter }` or `{ valid: false, reason }` |
| INVITE-03 | `POST /auth/join` endpoint — consume invite code + create user | Atomic: validate code → mark used_at → insert user → insert org_member in single transaction |
| INVITE-04 | Invite UI in Settings → Team section | Follow `InviteDialog.tsx` (studio/certify) pattern; Radix Dialog + copy-URL button |
| ORG-01 | `organizations` table migration | Migration `20260506000000_organizations.sql` |
| ORG-02 | `organization_members` table migration | Same migration file; note existing `user_restaurant_access` table overlap |
| ORG-03 | `organization_invites` table migration | 8-char code (NOT UUID), `used_at`, `expires_at`, `invited_by`, `restaurant_id` |
| ORG-04 | `GET /organizations/branches` endpoint — list branches for context switcher | Protected; filter by `organization_members.user_id` = current user |
| ORG-05 | `AuthContext.availableRestaurants` wired from org membership | Change `string[]` to `RestaurantBranch[]`; update Header.tsx together |

</phase_requirements>

---

## Summary

Phase 26 is a full-stack overhaul replacing a broken single-form registration with a two-path wizard and introducing org/branch hierarchy. The key implementation challenge is that the project uses a **custom auth system** (bcrypt + NestJS JWT), NOT Supabase Auth SDK — so "Supabase built-in email verification" requires a custom token approach rather than calling `supabase.auth.signUp()`. All five new API endpoints are additions to the existing `AuthController` plus a new `OrganizationsController`. The frontend changes are additive (new wizard components) except for one breaking interface change in `AuthContext` (`availableRestaurants: string[]` → rich objects).

The Header.tsx already has a restaurant switcher UI shell (lines 104-155) that maps over `availableRestaurants` — it just shows raw IDs today. This is the upgrade target, not a net-new component slot. Supabase migration naming follows `YYYYMMDDHHMMSS_description.sql` (verified from codebase). The invite code subsystem is a net-new `organization_invites` table — distinct from the existing `invite_tokens` table (which handles studio UUID tokens, unrelated).

**Primary recommendation:** Build all five new endpoints as methods on `AuthService` + `AuthController` (inline with existing auth wiring), plus a new `OrganizationsModule` for the branches endpoint. Use a custom `email_verifications` table for Path B email verification. Change `availableRestaurants` to `RestaurantBranch[]` in a single coordinated AuthContext + Header.tsx update.

---

## Standard Stack

### Core (all already installed — no new installs needed)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `framer-motion` | ^10.18.0 | Wizard step animations, AnimatePresence transitions | [VERIFIED: package.json] |
| `@radix-ui/react-dialog` | ^1.0.5 | Invite generation modal in Settings | [VERIFIED: package.json] |
| `react-router-dom` | ^6.21.1 | `useSearchParams()` for `?invite=` extraction, `useNavigate()` | [VERIFIED: package.json] |
| `@tanstack/react-query` | ^5.17.9 | Branch list fetching with optimistic UI | [VERIFIED: package.json] |
| `date-fns` | ^3.0.6 | Invite expiry formatting (already used in InviteDialog.tsx) | [VERIFIED: package.json] |
| `sonner` | ^1.3.1 | Toast notifications for copy, errors | [VERIFIED: package.json] |
| `axios` | ^1.13.2 | API calls from AuthContext (existing pattern) | [VERIFIED: package.json] |
| `bcrypt` | ^5.1.1 (api-gateway) | Password hashing (existing — no change) | [VERIFIED: api-gateway package.json] |
| `@nestjs/jwt` | ^10.2.0 | JWT sign/verify (existing — no change) | [VERIFIED: api-gateway package.json] |
| `@supabase/supabase-js` | ^2.103.0 | Database access via DatabaseService | [VERIFIED: api-gateway package.json] |
| Node.js built-in `crypto` | Node 22.22.2 | `crypto.randomBytes()` for invite code generation | [VERIFIED: node --version] |

**No new packages required.** All tooling is already installed.

### Alternatives Considered

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| Custom email verification tokens | Supabase Auth `auth.signUp()` | The project uses a custom users table + JWT auth, not Supabase Auth. Mixing would require reconciling two user stores and complicates refresh token flow |
| Radix Dialog for invite | Native `<dialog>` | Radix already used in `InviteDialog.tsx` — consistent pattern |
| `crypto.randomBytes` for code generation | `nanoid` or `uuid` | `crypto` is Node built-in (zero deps), and the charset control is simple with `Buffer.toString('hex')` + char replacement |

---

## Architecture Patterns

### Recommended Project Structure (new files)

```
apps/api-gateway/src/
├── auth/
│   ├── auth.controller.ts        # ADD: register/restaurant, invite, join, invite/:code endpoints
│   ├── auth.service.ts           # ADD: registerRestaurant(), generateInvite(), joinViaInvite(), getInvitePreview()
│   └── dto/                      # ADD: register-restaurant.dto.ts, invite.dto.ts, join.dto.ts
├── organizations/                 # NEW module
│   ├── organizations.controller.ts   # GET /organizations/branches
│   ├── organizations.service.ts
│   └── organizations.module.ts

apps/web/src/
├── pages/
│   └── Register.tsx              # REPLACE entirely (two-path wizard)
├── contexts/
│   └── AuthContext.tsx           # UPDATE: availableRestaurants interface + API call
├── components/
│   └── layout/
│       └── Header.tsx            # UPDATE: branch switcher to show name+city
├── pages/
│   └── Settings.tsx              # ADD: Team section with invite generation

supabase/migrations/
├── 20260506000000_organizations.sql          # organizations + organization_members + RLS
├── 20260506000001_organization_invites.sql   # organization_invites table + RLS
├── 20260506000002_email_verifications.sql    # email_verifications table (Path B only)
├── 20260506000003_restaurants_city_column.sql # ADD city column to restaurants table
```

### Pattern 1: NestJS Controller Pattern (follow existing settings.controller.ts)

```typescript
// Source: apps/api-gateway/src/settings/settings.controller.ts (verified)
@ApiTags('auth')
@ApiBearerAuth('JWT-auth')
@Controller('auth')
export class AuthController {
  // PUBLIC endpoint — no guards, use @Public() decorator
  @Post('register/restaurant')
  @Public()   // from apps/api-gateway/src/auth/decorators/public.decorator.ts
  async registerRestaurant(@Body() dto: RegisterRestaurantDto) { ... }

  // PUBLIC endpoint — invite preview before joining
  @Get('invite/:code')
  @Public()
  async getInvitePreview(@Param('code') code: string) { ... }

  // PUBLIC endpoint — join via invite
  @Post('join')
  @Public()
  async joinViaInvite(@Body() dto: JoinViaInviteDto) { ... }

  // PROTECTED — only owner/manager can generate invites
  @Post('invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  async generateInvite(@CurrentUser() user: any, @Body() dto: InviteDto) { ... }
}
```

**Key insight:** `@Public()` is required for registration endpoints because `TenantGuard` is a global `APP_GUARD` (verified in `app.module.ts` line 78-81). Without `@Public()`, the guard will run before user is authenticated. The `@Public()` decorator sets `IS_PUBLIC_KEY` metadata which `TenantGuard` respects (verified in `tenant.guard.ts` lines 13-17).

### Pattern 2: Atomic DB Transaction for Registration (critical)

```typescript
// Source: [ASSUMED] — NestJS service pattern; Supabase doesn't support native transactions via JS client
// Use sequential inserts with rollback on failure
async registerRestaurant(dto: RegisterRestaurantDto): Promise<TokenPair> {
  let orgId: string | null = null;
  let restaurantId: string | null = null;
  let userId: string | null = null;

  try {
    // 1. Create organization
    const { data: org } = await this.db.supabase
      .from('organizations').insert({ name: dto.restaurantName + ' Group', ... }).select().single();
    orgId = org.id;

    // 2. Create restaurant (linked to org)
    const { data: restaurant } = await this.db.supabase
      .from('restaurants').insert({ name: dto.restaurantName, organization_id: org.id, city: dto.city, ... }).select().single();
    restaurantId = restaurant.id;

    // 3. Hash password + create user
    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
    const { data: user } = await this.db.supabase
      .from('users').insert({ email: dto.email, password_hash: passwordHash, restaurant_id: restaurantId, role: 'owner', ... }).select().single();
    userId = user.user_id;

    // 4. Add to organization_members
    await this.db.supabase.from('organization_members').insert({ user_id: userId, organization_id: orgId, role: 'owner' });

    // 5. Queue email verification (Path B only)
    await this.queueEmailVerification(userId, dto.email);

    return this.generateTokens(user);
  } catch (err) {
    // Manual rollback — delete in reverse order
    if (userId) await this.db.supabase.from('users').delete().eq('user_id', userId);
    if (restaurantId) await this.db.supabase.from('restaurants').delete().eq('id', restaurantId);
    if (orgId) await this.db.supabase.from('organizations').delete().eq('id', orgId);
    throw new BadRequestException('Registration failed: ' + err.message);
  }
}
```

### Pattern 3: Invite Code Generation (server-side, Claude's discretion)

```typescript
// Source: Node.js crypto built-in (verified: Node 22.22.2)
// 8-char alphanumeric, no ambiguous chars (0, O, 1, I)
function generateInviteCode(): string {
  const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars (excludes 0,O,1,I)
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes)
    .map(b => CHARSET[b % CHARSET.length])
    .join('');
}
// Entropy: 32^8 = 1,099,511,627,776 possible codes
```

### Pattern 4: Framer Motion Wizard Steps (follow Login.tsx exactly)

```typescript
// Source: apps/web/src/pages/Login.tsx + Register.tsx (verified)
// Outer container:
<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4 py-12">
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className="w-full max-w-2xl"
  >
    {/* Card */}
    <div className="bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8">
      {/* Step content — use AnimatePresence + key prop for step transitions */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.25 }}
        >
          {/* Step JSX */}
        </motion.div>
      </AnimatePresence>
    </div>
  </motion.div>
</div>
```

### Pattern 5: AuthContext `availableRestaurants` Upgrade (breaking change — coordinate update)

```typescript
// Source: apps/web/src/contexts/AuthContext.tsx (verified)
// CURRENT (line 25): availableRestaurants: string[]
// PROPOSED:
interface RestaurantBranch {
  id: string;
  name: string;
  city: string;
}
// Update AuthContextType:
availableRestaurants: RestaurantBranch[]
// Update sync effect (currently line 182):
// After login, call GET /organizations/branches to populate with { id, name, city }[]
// localStorage key 'availableRestaurants' stores JSON of RestaurantBranch[]
// Header.tsx must update in the same wave — it currently maps restaurantId strings (line 134)
```

### Anti-Patterns to Avoid

- **String `===` comparison for invite codes**: Use `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` for constant-time comparison — prevents timing attacks that could reveal valid vs. invalid codes via response time differences.
- **Query string for invite URLs in path params**: The existing `InviteDialog.tsx` (studio) notes in a comment: "Token in path param, not query string (Pitfall 2 — prevents server log and Referer header leakage)". However, the CONTEXT.md explicitly specifies `/register?invite=XXXXXXXX` (query string). This is acceptable for 8-char human-friendly codes (unlike UUIDs) because they're single-use, short-lived, and the UX benefit of pasting the full URL is high. Proceed with query string per locked D-04.
- **Checking `rows.length > 0` for invite consumption**: Instead, UPDATE with `WHERE used_at IS NULL` and check `count` returned — prevents TOCTOU race condition where two requests validate the same code simultaneously.
- **Not updating `X-Restaurant-Id` header on branch switch**: `setActiveRestaurantId` must update `api.defaults.headers.common['X-Restaurant-Id']` (already in existing implementation at line 200 — preserve this).
- **Duplicate `user_restaurant_access` vs `organization_members`**: The existing `user_restaurant_access` table (in migration 20260208024921) already tracks `user_id, restaurant_id, role`. The new `organization_members` tracks `user_id, organization_id, role`. These serve different purposes — don't confuse them or try to reuse `user_restaurant_access` for org membership.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Invite code entropy | Custom char substitution on UUID | `crypto.randomBytes(8)` + charset map | Built-in, correct entropy, no deps |
| Dialog/modal for invite | Custom overlay + z-index stack | `@radix-ui/react-dialog` (already installed) | Accessibility, focus trap, existing pattern in `InviteDialog.tsx` |
| Debounced invite validation | Manual `setTimeout` management | `useCallback` + `useRef` for timer, or `@tanstack/react-query` with `enabled` flag | Race conditions if done manually |
| Toast messages | Custom toast state | `sonner` (already used in Settings.tsx line 35) | Already wired |
| Animation orchestration | CSS keyframes | `framer-motion` `AnimatePresence` + `mode="wait"` | Already in project, smooth step transitions |
| Date formatting for invite expiry | Manual date math | `date-fns` `format()` + `addDays()` (used in InviteDialog.tsx line 4) | Already imported in the reference component |

---

## Critical Codebase Findings

### Finding 1: Auth System is Custom (NOT Supabase Auth SDK)

[VERIFIED: apps/api-gateway/src/auth/auth.service.ts]

The project uses a **custom auth system**: bcrypt password hashing in `auth.service.ts`, JWT generated by `@nestjs/jwt`, and a `users` table in Supabase (accessed via service role key). The system does NOT call `supabase.auth.signUp()` or any Supabase Auth API.

**Impact on D-05 (Email Verification):** Decision D-05 says "Supabase built-in email verification" — but this is architecturally incompatible with the current system without a full auth migration. Supabase's email verification is a feature of Supabase Auth SDK (triggered by `auth.signUp()`), which the project has never used.

**Recommended approach:** Custom email verification token stored in a new `email_verifications` table. On Path B registration: generate a UUID token, store it with expiry, send an email via the existing communications infrastructure (Phase 23 Gmail). Verification link: `/verify-email?token=UUID`. This is consistent with the existing custom auth paradigm and requires zero architectural changes.

```sql
-- New table: email_verifications
CREATE TABLE email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Alternative**: Mark the user as `email_verified = false` and gate dashboard access in `JwtStrategy` or `ProtectedRoute`. Simpler but less secure. [ASSUMED — decision for planner/user]

### Finding 2: `restaurants` Table Missing `city` Column

[VERIFIED: supabase/migrations/20260208024921_new-migration.sql lines 26-35]

Current `restaurants` table: `id, name, address, timezone, cuisine_type, seating_capacity, created_at, updated_at`

Missing: `city` column (required by D-06: branch switcher shows "restaurant name + city").

**Required action:** Migration to add `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS city VARCHAR(100);` AND `ADD COLUMN IF NOT EXISTS phone VARCHAR(50);` (needed for Path B form step 2 per CONTEXT.md specifics).

### Finding 3: Header.tsx Already Has Restaurant Switcher (Upgrade, Not Net-New)

[VERIFIED: apps/web/src/components/layout/Header.tsx lines 104-155]

The switcher already exists with correct `AnimatePresence` dropdown pattern. Current gaps:
1. Shows raw `restaurantId` string (line 145) — needs restaurant name + city
2. Only visible when `activeRestaurantId` is set (line 105) — should also require `availableRestaurants.length > 1` per D-06
3. `availableRestaurants` is `string[]` (one hardcoded ID) — needs real org data

The switcher dropdown motion pattern is already exactly what's needed:
```
initial={{ opacity: 0, y: 10, scale: 0.98 }}
animate={{ opacity: 1, y: 0, scale: 1 }}
exit={{ opacity: 0, y: 10, scale: 0.98 }}
```

### Finding 4: `AuthContext.availableRestaurants` is `string[]` — Breaking Change Required

[VERIFIED: apps/web/src/contexts/AuthContext.tsx lines 25, 182-184]

Current: `availableRestaurants: string[]` set to `[user.restaurantId]` after login.

**Breaking change:** Needs to become `RestaurantBranch[]` or add a parallel `availableRestaurantDetails` field. Since Header.tsx consumes this in the same wave as the AuthContext update, a direct type change (breaking but coordinated) is cleaner than a parallel field.

After login, fetch `GET /organizations/branches` to populate. Use React Query or a single `useEffect` call within `AuthProvider`. Store as `JSON.stringify()` in `localStorage`.

### Finding 5: `invite_tokens` Table Exists (Studio Only — Don't Confuse)

[VERIFIED: supabase/migrations/20260413000003_invite_tokens.sql]

An `invite_tokens` table already exists — it stores UUID tokens for studio role grants (Phase 13). This is entirely separate from the new `organization_invites` system. The new table must be named `organization_invites` to avoid confusion.

### Finding 6: `InviteDialog.tsx` is a Direct Reference for Settings Team Section

[VERIFIED: apps/web/src/pages/studio/certify/InviteDialog.tsx]

The studio invite dialog uses:
- `@radix-ui/react-dialog` with `Dialog.Root`, `Dialog.Portal`, `Dialog.Content` wrapped in `motion.div`
- Two-phase UI: form → generated link with copy button
- `navigator.clipboard.writeText()` for copy
- `Check` icon from `lucide-react` for confirmation feedback
- `format()` from `date-fns` for expiry display

The new Settings → Team invite dialog should mirror this pattern exactly, adapted for 8-char codes (not UUID URLs).

### Finding 7: `user_restaurant_access` Table Already Exists

[VERIFIED: supabase/migrations/20260208024921_new-migration.sql line 54]

A `user_restaurant_access (id, user_id, restaurant_id, role, granted_at)` table already exists. This could potentially serve as the bridge between users and restaurants for multi-branch access, but the CONTEXT.md decision (D-03) calls for a new `organization_members` table tracking `user_id ↔ organization_id`. These serve different purposes:
- `user_restaurant_access`: direct user-to-restaurant access (existing)
- `organization_members`: user-to-organization membership (new)

Both may ultimately be needed. The branches endpoint can JOIN `organization_members → organizations → restaurants` to list all branches.

### Finding 8: `TenantGuard` Global Guard — New Public Endpoints Need `@Public()`

[VERIFIED: apps/api-gateway/src/app.module.ts lines 78-81, tenant.guard.ts lines 13-17]

`TenantGuard` is registered as a global `APP_GUARD`. It reads `IS_PUBLIC_KEY` metadata. All new public registration endpoints MUST use the `@Public()` decorator from `apps/api-gateway/src/auth/decorators/public.decorator.ts` — otherwise the guard will reject unauthenticated requests before JwtAuthGuard even runs.

### Finding 9: App.tsx `/register` Route is a Single Route — Use `useSearchParams()`

[VERIFIED: apps/web/src/App.tsx line 78]

`<Route path="/register" element={<Register />} />` — single route. The `?invite=XXXXXXXX` query param is handled inside the Register component via `useSearchParams()` from `react-router-dom`. No new routes needed. The component reads the invite param on mount and auto-navigates to Path A if present.

### Finding 10: `RolesGuard` and `@Roles()` Decorator Available

[VERIFIED: apps/api-gateway/src/auth/guards/roles.guard.ts]

`RolesGuard` exists and is exported from `AuthModule`. It accepts `@Roles('owner', 'manager')`. The guard treats owner and manager as equivalent (lines 31-34). Use `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('owner', 'manager')` for the `POST /auth/invite` endpoint.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Existing bcrypt + JWT pattern (no change) |
| V3 Session Management | Yes | Existing refresh token pattern (no change) |
| V4 Access Control | Yes | `RolesGuard` + `@Roles('owner', 'manager')` for invite generation |
| V5 Input Validation | Yes | NestJS `class-validator` DTOs for all new endpoints |
| V6 Cryptography | Yes | `crypto.randomBytes()` for invite codes — never Math.random() |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Invite code timing attack | Spoofing | `crypto.timingSafeEqual()` for code comparison; constant-time |
| Code enumeration / brute-force | Spoofing | Rate limiting (existing `RateLimitGuard` global); 32^8 code space |
| TOCTOU on invite consumption | Tampering | `UPDATE ... WHERE used_at IS NULL` returning row count; reject if count=0 |
| Mass registration (spam) | DoS | Existing `RateLimitGuard` global; add per-IP limit on `POST /auth/register/restaurant` |
| Email verification bypass | Spoofing | Token UUID stored server-side; frontend cannot self-certify; gate dashboard on `email_verified` flag |
| Tenant isolation during org creation | Elevation | New org endpoints have no `restaurant_id` in JWT yet — `@Public()` and explicit DB queries bypass TenantGuard correctly |

---

## Common Pitfalls

### Pitfall 1: Forgetting `@Public()` on Registration Endpoints

**What goes wrong:** `TenantGuard` (global APP_GUARD) blocks unauthenticated `POST /auth/register/restaurant` with a silent 403.
**Why it happens:** TenantGuard runs before JwtAuthGuard on public routes. Without `@Public()`, it proceeds to check `user.restaurantId` which is undefined, but also tries to match request body.
**How to avoid:** Every new registration/join/preview endpoint must have `@Public()` decorator.
**Warning signs:** Frontend gets 403 on registration before any JWT is present.

### Pitfall 2: `availableRestaurants` Type Mismatch Breaking Header.tsx

**What goes wrong:** Header.tsx maps `availableRestaurants.map((restaurantId) => ...)` — if the type changes to `RestaurantBranch[]` without updating Header.tsx, `restaurantId.id` access will silently render `[object Object]`.
**How to avoid:** Update `AuthContext.tsx` and `Header.tsx` in the same task/wave. Update the localStorage serialization in `logout()` to clear `availableRestaurants` (already done at line 319).
**Warning signs:** Branch switcher shows `[object Object]` for restaurant names.

### Pitfall 3: Race Condition on Invite Code Consumption

**What goes wrong:** Two concurrent requests both read `used_at IS NULL`, both validate, both attempt to consume the same code — one succeeds, one creates a duplicate user.
**Why it happens:** Read-then-write pattern without atomic update.
**How to avoid:** Use a single `UPDATE organization_invites SET used_at = NOW() WHERE code = $1 AND used_at IS NULL AND expires_at > NOW()` — check `data.length === 1` (Supabase returns updated rows). If 0 rows updated, code was already used.

### Pitfall 4: `restaurants` Table Missing `city` Column

**What goes wrong:** Trying to insert city into restaurant record at registration fails with column-not-found error.
**How to avoid:** Migration `20260506000003_restaurants_city_column.sql` must run before any registration endpoint is tested.

### Pitfall 5: `AuthContext.register()` Still Called by Old Code Paths

**What goes wrong:** `AuthContext.register()` sends to `POST /api/v1/auth/register` which still expects `restaurantId` — if any code calls `register()` with old signature, it will hit the old endpoint.
**How to avoid:** The old `POST /auth/register` endpoint should either be deprecated (return 410 Gone) or updated. `AuthContext.register()` can be removed or repurposed for the join path. New methods: `registerRestaurant()` and `joinViaInvite()` should be added to `AuthContextType`.

### Pitfall 6: Email Verification Pending State Not Blocking Dashboard

**What goes wrong:** User registers via Path B, skips email verification, and accesses full dashboard with `email_verified = false`.
**How to avoid:** `ProtectedRoute.tsx` should check `user.emailVerified` flag (from JWT payload or `/api/v1/auth/me` response). If false, redirect to `/verify-email` holding page. The flag must be included in JWT payload via `generateTokens()`.

---

## Code Examples

### Invite Code Consumption (Atomic — Server-side)

```typescript
// Source: [ASSUMED pattern] — Supabase JS client UPDATE returning affected rows
async joinViaInvite(dto: JoinViaInviteDto): Promise<TokenPair> {
  // Step 1: Atomically mark invite as used
  const { data: invite, error } = await this.db.supabase
    .from('organization_invites')
    .update({ used_at: new Date().toISOString(), used_by_email: dto.email })
    .eq('code', dto.code.toUpperCase())
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select()
    .single();

  if (error || !invite) {
    throw new BadRequestException('Invite code is invalid, expired, or already used');
  }

  // Step 2: Create user linked to restaurant from invite
  const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
  const { data: user } = await this.db.supabase
    .from('users')
    .insert({
      email: dto.email,
      password_hash: passwordHash,
      name: dto.name,
      restaurant_id: invite.restaurant_id,
      role: 'manager', // locked per D-04
    })
    .select()
    .single();

  // Step 3: Add to organization_members
  await this.db.supabase.from('organization_members').insert({
    user_id: user.user_id,
    organization_id: invite.organization_id,
    role: 'manager',
    invited_via: invite.id,
  });

  return this.generateTokens(user);
}
```

### Inline Invite Validation (Frontend — debounced 400ms)

```typescript
// Source: [ASSUMED pattern] — standard React debounce with useEffect
const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
const [validating, setValidating] = useState(false);

useEffect(() => {
  if (inviteCode.length !== 8) { setInvitePreview(null); return; }
  const timer = setTimeout(async () => {
    setValidating(true);
    try {
      const resp = await fetch(`/api/v1/auth/invite/${inviteCode.toUpperCase()}`);
      const data = await resp.json();
      setInvitePreview(data);
    } catch { setInvitePreview({ valid: false, reason: 'network_error' }); }
    finally { setValidating(false); }
  }, 400);
  return () => clearTimeout(timer);
}, [inviteCode]);
```

### Supabase Migration (follow `user_roles.sql` pattern exactly)

```sql
-- Phase 26 ORG-01, ORG-02: organizations + organization_members tables
-- [VERIFIED: migration naming from supabase/migrations/ directory]

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  owner_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager', 'staff')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Organizations: owner can read/update their own org
CREATE POLICY "org_owner_access" ON organizations
  FOR ALL USING (auth.uid()::text = owner_id::text);

-- Organization members: members can read their own memberships
CREATE POLICY "org_members_read_own" ON organization_members
  FOR SELECT USING (auth.uid()::text = user_id::text);

-- Organization members: owner can read all members of their org
CREATE POLICY "org_owner_read_members" ON organization_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE organizations.id = organization_members.organization_id
      AND organizations.owner_id::text = auth.uid()::text
    )
  );
```

### New NestJS `OrganizationsModule` (follow `SettingsModule` pattern)

```typescript
// Source: apps/api-gateway/src/settings/settings.module.ts (verified)
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
// Add to app.module.ts imports[] — same pattern as SettingsModule
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Multi-step forms as one big page | Wizard with `AnimatePresence` + step key | Framer Motion v6+ | Phase 26 uses `mode="wait"` for clean step transitions |
| UUID invite tokens (hard to share verbally) | Short alphanumeric codes + URL | Established pattern | Codifies the UX pattern from CONTEXT.md D-04 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Email verification requires a custom `email_verifications` table (not Supabase Auth SDK) | Finding 1, ONBOARD-04 | If the team wants to migrate to Supabase Auth, the approach changes significantly and is out of scope for this phase |
| A2 | Sending verification email uses existing Phase 23 Gmail/communications infrastructure | ONBOARD-04 | If Gmail infra is not wired up for transactional emails, need alternative (Resend, SendGrid) |
| A3 | `user_restaurant_access` table (existing) does NOT replace `organization_members` (new) | Finding 7 | If they should be merged, schema needs reconciliation |
| A4 | Supabase `.update().eq().is('used_at', null).select().single()` returns null data (not an error) when no rows match | Code Examples | If it returns an error instead of null data, error handling differs |
| A5 | Changing `availableRestaurants: string[]` to `RestaurantBranch[]` is acceptable as a breaking change (no other consumers) | Finding 4 | If other components consume `availableRestaurants`, they must all be updated in the same wave |

---

## Open Questions

1. **Email verification infrastructure**
   - What we know: Custom auth system, no Supabase Auth SDK signUp()
   - What's unclear: Does Phase 23 Gmail integration support sending transactional emails programmatically from NestJS? Or does a third-party service (Resend/SendGrid) need to be added?
   - Recommendation: Check `apps/api-gateway/src/communications/` for existing email-sending capability. If it exists, wire it. If not, add `@sendgrid/mail` or similar as a dependency in the plan.

2. **`organization_id` on `restaurants` table**
   - What we know: Current `restaurants` table has no `organization_id` FK
   - What's unclear: Should `restaurants.organization_id` be added via migration? Or is the join via `organization_members + user_restaurant_access`?
   - Recommendation: Add `organization_id UUID REFERENCES organizations(id)` to `restaurants` table — this is required for `GET /organizations/branches` to work cleanly.

3. **`AuthContext.register()` method — deprecate or repurpose?**
   - What we know: `AuthContext.register()` sends to `POST /api/v1/auth/register` which expects `restaurantId`
   - What's unclear: Are there other callers of `AuthContext.register()` beyond Register.tsx?
   - Recommendation: Remove `register()` from `AuthContextType`. Add `registerRestaurant(data)` and `joinViaInvite(data)` as the two new methods.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Invite code generation (`crypto`) | ✓ | 22.22.2 | — |
| Supabase CLI | Running migrations | ✓ | 2.84.2 | — |
| `framer-motion` | Wizard animations | ✓ | ^10.18.0 | — |
| `@radix-ui/react-dialog` | Invite dialog in Settings | ✓ | ^1.0.5 | — |
| `react-router-dom` `useSearchParams` | Extract `?invite=` from URL | ✓ | ^6.21.1 | — |
| Gmail / email sending service | Email verification (Path B) | ⚠️ | Unknown | Add Resend or SendGrid if not available |

**Missing dependencies with no fallback:** None confirmed blocking.

**Missing dependencies with fallback:** Email sending — check Phase 23 Gmail integration. If not wired for transactional sends, plan must include email service setup.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (frontend) + Jest (api-gateway) [ASSUMED — check package.json test scripts] |
| Config file | `vitest.config.ts` or `jest.config.ts` [ASSUMED] |
| Quick run command | `pnpm test --run` (frontend) |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated? |
|--------|----------|-----------|-----------|
| ONBOARD-01 | Register.tsx renders path selector, not restaurantId field | unit | ✓ |
| ONBOARD-03 | `?invite=CODE` auto-extracts code and navigates to Path A | unit | ✓ |
| INVITE-02 | `GET /auth/invite/:code` returns valid preview or error reason | integration | ✓ |
| INVITE-03 | Invite consumption is atomic — second request with same code returns error | integration | ✓ |
| ORG-04 | `GET /organizations/branches` returns branches for authenticated user | integration | ✓ |
| ONBOARD-05 | Org + restaurant + user created atomically; rollback on partial failure | integration | ✓ |

### Wave 0 Gaps

- [ ] `supabase/migrations/20260506000000_organizations.sql` — must run before integration tests
- [ ] `supabase/migrations/20260506000001_organization_invites.sql`
- [ ] `supabase/migrations/20260506000002_email_verifications.sql`
- [ ] `supabase/migrations/20260506000003_restaurants_city_column.sql`
- [ ] Add `organizations` FK to `restaurants` table

---

## Sources

### Primary (HIGH confidence — VERIFIED from codebase)
- `apps/api-gateway/src/auth/auth.service.ts` — custom bcrypt auth, register() implementation
- `apps/api-gateway/src/auth/auth.controller.ts` — endpoint patterns, decorator usage
- `apps/api-gateway/src/auth/auth.module.ts` — module wiring
- `apps/api-gateway/src/app.module.ts` — global guards (TenantGuard, RateLimitGuard)
- `apps/api-gateway/src/common/tenant/tenant.guard.ts` — @Public() bypass logic
- `apps/api-gateway/src/auth/decorators/public.decorator.ts` — IS_PUBLIC_KEY
- `apps/api-gateway/src/auth/guards/roles.guard.ts` — @Roles() guard
- `apps/api-gateway/src/settings/settings.controller.ts` — NestJS controller pattern
- `apps/api-gateway/src/database/database.service.ts` — Supabase client (service role)
- `apps/web/src/pages/Register.tsx` — current broken form
- `apps/web/src/pages/Login.tsx` — visual reference, motion.div patterns
- `apps/web/src/contexts/AuthContext.tsx` — availableRestaurants: string[], register() signature
- `apps/web/src/components/layout/Header.tsx` — existing restaurant switcher (lines 104-155)
- `apps/web/src/components/layout/DashboardLayout.tsx` — layout structure
- `apps/web/src/App.tsx` — routing, single /register route
- `apps/web/src/pages/Settings.tsx` — section card pattern to follow
- `apps/web/src/pages/studio/certify/InviteDialog.tsx` — invite dialog reference
- `supabase/migrations/20260413000003_invite_tokens.sql` — existing studio invite tokens
- `supabase/migrations/20260413000000_user_roles.sql` — migration pattern to follow
- `supabase/migrations/20260208024921_new-migration.sql` — restaurants table schema, user_restaurant_access
- `services/database/migrations/012_create_users_table.sql` — users table schema
- `apps/web/package.json` — frontend dependency versions
- `apps/api-gateway/package.json` — backend dependency versions

### Tertiary (LOW confidence — not verified in this session)
- Email verification via existing communications infrastructure — presence and capability not confirmed

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified from package.json
- Architecture: HIGH — all patterns verified directly from source files
- DB migration patterns: HIGH — read from existing migration files
- Email verification approach: MEDIUM — custom approach recommended based on verified auth system; specific email-sending capability not confirmed
- Pitfalls: HIGH — derived from direct codebase analysis

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (stable stack)
