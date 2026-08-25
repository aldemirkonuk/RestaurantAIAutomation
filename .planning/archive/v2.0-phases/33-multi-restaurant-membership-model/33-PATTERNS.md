# Phase 33: Multi-Restaurant Membership Model — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 14 new/modified files
**Analogs found:** 13 / 14

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/api-gateway/src/auth/auth.service.ts` | service | request-response | self (modify joinViaInvite, registerRestaurant, switchRestaurant, generateTokens) | self-modify |
| `apps/api-gateway/src/auth/auth.controller.ts` | controller | request-response | self (add GET /me/role, POST /invite/:code/accept) | self-modify |
| `apps/api-gateway/src/restaurants/members.service.ts` | service | CRUD | `apps/api-gateway/src/organizations/organizations.service.ts` | exact |
| `apps/api-gateway/src/restaurants/members.controller.ts` | controller | CRUD | `apps/api-gateway/src/organizations/organizations.controller.ts` | exact |
| `apps/api-gateway/src/restaurants/restaurants.module.ts` | config | N/A | `apps/api-gateway/src/organizations/organizations.module.ts` | exact |
| `apps/api-gateway/src/auth/dto/accept-invite.dto.ts` | model | N/A | `apps/api-gateway/src/auth/dto/join-via-invite.dto.ts` | exact |
| `apps/api-gateway/src/auth/dto/update-member-role.dto.ts` | model | N/A | `apps/api-gateway/src/auth/dto/invite.dto.ts` | role-match |
| `apps/web/src/contexts/AuthContext.tsx` | provider | request-response | self (add activeRole field to User + /me/role fetch on switch) | self-modify |
| `apps/web/src/pages/Settings.tsx` | component | CRUD | self (rebuild team section) + `apps/web/src/components/team/InviteTeamDialog.tsx` | self-modify |
| `apps/web/src/pages/Register.tsx` | component | request-response | self (read ?invite= param from /invite/:code redirect) | self-modify |
| `apps/web/src/pages/InviteLanding.tsx` | component | request-response | `apps/web/src/pages/VerifyEmail.tsx` | exact |
| `apps/web/src/pages/NoAccess.tsx` | component | request-response | `apps/web/src/pages/VerifyEmail.tsx` | role-match |
| `supabase/migrations/20260514_phase33_ura_schema.sql` | migration | batch | `supabase/migrations/20260506000000_organizations.sql` | exact |
| `apps/web/src/App.tsx` | config/router | N/A | self (add /invite/:code and /no-access routes, same as /verify-email pattern) | self-modify |

---

## Pattern Assignments

---

### `apps/api-gateway/src/restaurants/members.controller.ts` (controller, CRUD)

**Analog:** `apps/api-gateway/src/organizations/organizations.controller.ts`

**Imports pattern** (lines 1–26):
```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { MembersService } from './members.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Request } from 'express';

interface AuthenticatedUser {
  userId: string;
  role: string;
}
```

**Controller declaration + class-level guards** (lines 32–38):
```typescript
@Controller('restaurants')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class MembersController {
  private readonly logger = new Logger(MembersController.name);
  constructor(private readonly membersService: MembersService) {}
```

**GET handler pattern** (lines 40–48 of organizations.controller.ts):
```typescript
@Get(':restaurantId/members')
async getMembers(
  @Req() req: Request & { user: AuthenticatedUser },
  @Param('restaurantId') restaurantId: string,
) {
  const userId: string = (req.user as AuthenticatedUser)?.userId;
  if (!userId) throw new ForbiddenException('Missing user identity');
  return this.membersService.getMembers(userId, restaurantId);
}
```

**PATCH + role-guard pattern** (lines 71–80 of organizations.controller.ts):
```typescript
@Patch(':restaurantId/members/:memberId')
@UseGuards(RolesGuard)
@Roles('owner')
async updateMemberRole(
  @Req() req: Request & { user: AuthenticatedUser },
  @Param('restaurantId') restaurantId: string,
  @Param('memberId') memberId: string,
  @Body() body: UpdateMemberRoleDto,
): Promise<void> {
  const userId = (req.user as AuthenticatedUser)?.userId;
  if (!userId) throw new ForbiddenException('Missing user identity');
  return this.membersService.updateMemberRole(userId, restaurantId, memberId, body.role);
}
```

**DELETE handler pattern** (lines 82–90 of organizations.controller.ts):
```typescript
@Delete(':restaurantId/members/:memberId')
@UseGuards(RolesGuard)
@Roles('owner')
async removeMember(
  @Req() req: Request & { user: AuthenticatedUser },
  @Param('restaurantId') restaurantId: string,
  @Param('memberId') memberId: string,
): Promise<void> {
  const userId = (req.user as AuthenticatedUser)?.userId;
  if (!userId) throw new ForbiddenException('Missing user identity');
  return this.membersService.removeMember(userId, restaurantId, memberId);
}
```

---

### `apps/api-gateway/src/restaurants/members.service.ts` (service, CRUD)

**Analog:** `apps/api-gateway/src/organizations/organizations.service.ts`

**Imports + class declaration** (lines 1–32 of organizations.service.ts):
```typescript
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);
  constructor(private readonly databaseService: DatabaseService) {}
```

**Authorization guard pattern — verify caller has access to restaurant** (lines 86–100 of organizations.service.ts):
```typescript
private async assertMembership(
  actorUserId: string,
  restaurantId: string,
  requiredRole?: 'owner' | 'manager',
): Promise<{ role: string }> {
  const { data: access } = await this.databaseService.supabase
    .from('user_restaurant_access')
    .select('role')
    .eq('user_id', actorUserId)
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .maybeSingle();
  if (!access) throw new ForbiddenException('Access denied to this restaurant');
  if (requiredRole && access.role !== requiredRole) {
    throw new ForbiddenException(`Only ${requiredRole}s can perform this action`);
  }
  return access;
}
```

**Supabase query pattern for member roster** (lines 174–200 of organizations.service.ts):
```typescript
async getMembers(actorUserId: string, restaurantId: string) {
  await this.assertMembership(actorUserId, restaurantId);

  const { data: members, error } = await this.databaseService.supabase
    .from('user_restaurant_access')
    .select(`
      id, role, granted_at, valid_until, is_active,
      users!user_id ( user_id, name, email, avatar_url, auth_provider ),
      organization_invites!invited_via ( code, invited_by )
    `)
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('granted_at', { ascending: true });

  if (error) {
    this.logger.error(`Failed to fetch members for restaurant ${restaurantId}: ${error.message}`);
    return [];
  }
  return members ?? [];
}
```

**Error/rollback pattern** (lines 522–528 of auth.service.ts):
```typescript
} catch (err) {
  if (userId) await this.databaseService.supabase.from('users').delete().eq('user_id', userId);
  if (restaurantId) await this.databaseService.supabase.from('restaurants').delete().eq('id', restaurantId);
  this.logger.error(`Operation rollback triggered: ${err.message}`);
  throw new BadRequestException('Operation failed: ' + err.message);
}
```

**Soft-deactivation pattern (D-15 decision: hard delete of URA row):**
```typescript
async removeMember(actorUserId: string, restaurantId: string, targetUserId: string): Promise<void> {
  await this.assertMembership(actorUserId, restaurantId, 'owner');

  // Last-owner guard (D-18): prevent removing the only owner
  const { count } = await this.databaseService.supabase
    .from('user_restaurant_access')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('role', 'owner')
    .eq('is_active', true);

  const isTargetOwner = await /* check target's role */ ...;
  if (isTargetOwner && (count ?? 0) <= 1) {
    throw new BadRequestException(
      "You're the only owner. Transfer ownership or delete the restaurant first.",
    );
  }

  // D-15: hard delete of user_restaurant_access row
  const { error } = await this.databaseService.supabase
    .from('user_restaurant_access')
    .delete()
    .eq('user_id', targetUserId)
    .eq('restaurant_id', restaurantId);

  if (error) throw new InternalServerErrorException('Failed to remove member');
}
```

---

### `apps/api-gateway/src/restaurants/restaurants.module.ts` (config)

**Analog:** `apps/api-gateway/src/organizations/organizations.module.ts` (lines 1–13):
```typescript
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class RestaurantsModule {}
```

Register in `app.module.ts` using same import pattern as `OrganizationsModule` (line 27 of app.module.ts).

---

### `apps/api-gateway/src/auth/auth.service.ts` — modify joinViaInvite (service, request-response)

**Analog:** self — existing `joinViaInvite` (lines 701–753)

**Bug to fix — remove the crashing guard** (lines 702–707):
```typescript
// REMOVE THIS BLOCK:
const { data: existing } = await this.databaseService.supabase
  .from('users').select('email').eq('email', dto.email).maybeSingle();
if (existing) throw new BadRequestException('Email already registered');
```

**Replace with dual-path logic:**
```typescript
// NEW: existing user → add membership; new user → create user first
const { data: existingUser } = await this.databaseService.supabase
  .from('users').select('*').eq('email', dto.email).maybeSingle();

let user: any;
if (existingUser) {
  // Existing user: check for duplicate membership (D-03)
  const { data: existing } = await this.databaseService.supabase
    .from('user_restaurant_access')
    .select('id')
    .eq('user_id', existingUser.user_id)
    .eq('restaurant_id', invite.restaurant_id)
    .maybeSingle();
  if (existing) {
    // D-03: silent skip — already a member
    await this.databaseService.supabase  // un-consume invite
      .from('organization_invites')
      .update({ used_at: null, used_by_email: null })
      .eq('id', invite.id);
    throw new ConflictException('already_member');  // frontend maps to toast
  }
  user = existingUser;
} else {
  // New user: create account (existing path)
  const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
  const { data: newUser, error: userErr } = await this.databaseService.supabase
    .from('users').insert({ ...fields }).select().single();
  if (userErr || !newUser) { /* rollback + throw */ }
  user = newUser;
}

// Both paths: write user_restaurant_access row (RC-2 fix)
await this.databaseService.supabase.from('user_restaurant_access').insert({
  user_id: user.user_id,
  restaurant_id: invite.restaurant_id,
  role: invite.role,
  invited_via: invite.id,
  is_active: true,
});

// Both paths: upsert organization_members (handles existing org members gracefully)
await this.databaseService.supabase.from('organization_members').upsert(
  { organization_id: invite.organization_id, user_id: user.user_id, role: invite.role, invited_via: invite.id },
  { onConflict: 'organization_id,user_id' },
);
```

**registerRestaurant — add URA write** (after line 499 of auth.service.ts, existing org_members insert):
```typescript
// Add immediately after organization_members insert:
await this.databaseService.supabase.from('user_restaurant_access').insert({
  user_id: userId,
  restaurant_id: restaurantId,
  role: 'owner',
  invited_via: null,
  is_active: true,
});
```

**switchRestaurant — add fine-grained URA check** (lines 251–301 — replace org-only check):
```typescript
// NEW: check user_restaurant_access first (fine-grained)
const { data: access } = await this.databaseService.supabase
  .from('user_restaurant_access')
  .select('role')
  .eq('user_id', userId)
  .eq('restaurant_id', targetRestaurantId)
  .eq('is_active', true)
  .maybeSingle();

if (!access) {
  // Legacy fallback: org-level check for users without URA rows (Wave 4 transition)
  // ... existing org-level validation ...
  // (keep the existing org-member check here verbatim as fallback)
}
```

**generateTokens — read role from URA** (lines 308–345 — add after studioRoles fetch):
```typescript
// NEW: fetch per-restaurant role from user_restaurant_access
let restaurantRole = user.role; // fallback for legacy users
try {
  const { data: membership } = await this.databaseService.supabase
    .from('user_restaurant_access')
    .select('role')
    .eq('user_id', user.user_id)
    .eq('restaurant_id', user.restaurant_id)
    .eq('is_active', true)
    .maybeSingle();
  if (membership?.role) restaurantRole = membership.role;
} catch { /* non-critical — legacy fallback already set */ }

const payload = {
  sub: user.user_id,
  email: user.email,
  role: restaurantRole,   // ← now per-restaurant role from URA
  restaurantId: user.restaurant_id,
  emailVerified: user.email_verified ?? false,
  app_metadata: { roles: studioRoles },
};
```

---

### `apps/api-gateway/src/auth/auth.controller.ts` — add /me/role (controller, request-response)

**Analog:** self — existing `getProfile` (lines 132–139)

**New GET /me/role endpoint pattern** (copy from lines 132–139):
```typescript
/**
 * Get the caller's role at a specific restaurant.
 * Called by frontend on every branch switch (D-11).
 */
@Get('me/role')
@UseGuards(JwtAuthGuard)
async getMyRole(
  @Req() req: Request & { user: any },
  @Query('restaurantId') restaurantId: string,
) {
  const role = await this.authService.getUserRoleAtRestaurant(req.user.userId, restaurantId);
  return { success: true, role };
}
```

**New POST /invite/:code/accept pattern** (copy from existing `joinViaInvite` handler, lines 189–195):
```typescript
/**
 * Accept an invite as an already-authenticated (existing) user.
 * Logged-out users continue to use POST /join (Path A) unchanged.
 */
@Post('invite/:code/accept')
@UseGuards(JwtAuthGuard)
async acceptInvite(
  @Req() req: Request & { user: any },
  @Param('code') code: string,
) {
  const result = await this.authService.acceptInviteAsExistingUser(req.user.userId, code);
  return { success: true, ...result };
}
```

---

### `apps/api-gateway/src/auth/dto/accept-invite.dto.ts` (model)

**Analog:** `apps/api-gateway/src/auth/dto/join-via-invite.dto.ts` (lines 1–8):
```typescript
import { IsString, Length } from 'class-validator';

export class AcceptInviteDto {
  @IsString() @Length(8, 8) code: string;
}
```

---

### `apps/api-gateway/src/auth/dto/update-member-role.dto.ts` (model)

**Analog:** `apps/api-gateway/src/auth/dto/invite.dto.ts` (lines 1–7):
```typescript
import { IsIn } from 'class-validator';

export class UpdateMemberRoleDto {
  @IsIn(['owner', 'manager', 'staff']) role: 'owner' | 'manager' | 'staff';
}
```

---

### `apps/web/src/pages/InviteLanding.tsx` (component, request-response)

**Analog:** `apps/web/src/pages/VerifyEmail.tsx` (full file, 210 lines)

**Imports pattern** (lines 1–9 of VerifyEmail.tsx):
```typescript
import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { Wine, Users, CheckCircle, Loader2, AlertCircle, Building2 } from 'lucide-react'
import { Button } from '../components/ui'
import { toast } from 'sonner'
```

Note: use `useParams` (for `/invite/:code`) instead of `useSearchParams`.

**Page layout pattern** (lines 109–116 of VerifyEmail.tsx):
```typescript
return (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4 py-12">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-md"
    >
```

**Branding header pattern** (lines 117–125 of VerifyEmail.tsx):
```typescript
<div className="text-center mb-8">
  <div className="inline-flex items-center justify-center w-16 h-16 bg-wine-600 rounded-2xl mb-4 shadow-lg">
    <Wine className="w-8 h-8 text-white" />
  </div>
  <h1 className="text-2xl font-bold text-gray-900">Join {restaurantName}</h1>
  <p className="text-gray-500 mt-2">Invited by <strong>{inviter}</strong></p>
</div>
```

**Card + glass effect pattern** (line 127 of VerifyEmail.tsx):
```typescript
<div className="bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8">
```

**Error display pattern** (lines 134–139 of VerifyEmail.tsx):
```typescript
{error && (
  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
    <p className="text-sm text-red-700">{error}</p>
  </div>
)}
```

**API call pattern — fetch invite preview on mount** (copy from Register.tsx lines 144–166):
```typescript
const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

useEffect(() => {
  if (!code || code.length !== 8) return
  const fetchPreview = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${API_URL}/api/v1/auth/invite/${code.toUpperCase()}`)
      const data = await resp.json()
      setInvitePreview(data)
    } catch {
      setError('Could not load invite details.')
    } finally {
      setLoading(false)
    }
  }
  fetchPreview()
}, [code])
```

**Authenticated accept — call POST /invite/:code/accept** (new pattern):
```typescript
const handleAccept = async () => {
  setSubmitting(true)
  try {
    const token = localStorage.getItem('accessToken')
    const resp = await fetch(`${API_URL}/api/v1/auth/invite/${code}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) {
      const data = await resp.json()
      throw new Error(data.message || 'Failed to accept invite')
    }
    toast.success(`Added ${invitePreview?.restaurant} to your branches!`)
    await refreshBranches()
    navigate('/')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to accept invite'
    if (msg === 'already_member') {
      toast.success(`You're already a member of ${invitePreview?.restaurant}`)
      navigate('/')
    } else {
      setError(msg)
    }
  } finally {
    setSubmitting(false)
  }
}
```

**Button pattern** (lines 161–171 of VerifyEmail.tsx):
```typescript
<Button className="w-full h-12" onClick={handleAccept} disabled={submitting}>
  {submitting ? (
    <>
      <Loader2 className="w-4 h-4 animate-spin mr-2" />
      Joining...
    </>
  ) : (
    `Add ${invitePreview?.restaurant} to my branches`
  )}
</Button>
```

**Logged-out path** — show two buttons linking to `/register?invite=${code}` and `/login?redirect=/invite/${code}`.

---

### `apps/web/src/pages/NoAccess.tsx` (component, request-response)

**Analog:** `apps/web/src/pages/VerifyEmail.tsx` — use the success/error state card pattern

**Minimal pattern:**
```typescript
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { ShieldOff, Wine } from 'lucide-react'
import { Button } from '../components/ui'

export function NoAccess() {
  const { availableRestaurants, setActiveRestaurantId } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-wine-50/30 to-gray-50 px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md text-center"
      >
        {/* WineOps branding header — same as VerifyEmail lines 117-125 */}
        {/* Message: "You no longer have access to [Restaurant]" */}
        {/* If availableRestaurants.length > 1: show "Switch to another branch" dropdown */}
        {/* Link to /login if no branches remain */}
      </motion.div>
    </div>
  )
}
```

**Switch branch pattern** (reuse `setActiveRestaurantId` from AuthContext lines 271–293):
```typescript
const handleSwitch = async (id: string) => {
  await setActiveRestaurantId(id)
  navigate('/')
}
```

---

### `apps/web/src/contexts/AuthContext.tsx` — add activeRole (provider, request-response)

**Analog:** self — extend existing User interface and fetchAndSetBranches pattern

**Extend User interface** (lines 12–20):
```typescript
interface User {
  userId: string
  email: string
  name: string
  role: 'owner' | 'manager' | 'staff'         // ← keep for legacy compat
  restaurantId: string
  emailVerified?: boolean
  studioRoles?: ('developer' | 'certified_contributor' | 'review_admin')[]
  activeRole?: 'owner' | 'manager' | 'staff'   // ← ADD: per-branch role from /me/role
}
```

**Extend AuthContextType** (lines 53–70):
```typescript
interface AuthContextType {
  // ...existing fields...
  activeRole: 'owner' | 'manager' | 'staff' | null   // ← ADD
}
```

**Fetch activeRole on branch switch** (copy pattern from setActiveRestaurantId callback, lines 271–293):
```typescript
const setActiveRestaurantId = useCallback(async (restaurantId: string) => {
  // ...existing switch-restaurant + localStorage logic (unchanged)...

  // ADD: fetch role for the new active restaurant
  try {
    const roleResp = await api.get('/api/v1/auth/me/role', { params: { restaurantId } })
    setActiveRole(roleResp.data.role ?? null)
  } catch {
    setActiveRole(null)   // graceful — JWT role is still usable as fallback
  }
}, [])
```

---

### `apps/web/src/pages/Settings.tsx` — Team tab redesign (component, CRUD)

**Analog:** self — existing team section (lines 714–752) + `InviteTeamDialog.tsx` patterns

**Section header pattern** (lines 714–735 — keep exact structure, update subtitle):
```typescript
<div id="team" className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
  <div className="px-6 py-4 flex items-center justify-between border-b border-gray-50">
    <div className="flex items-center gap-2">
      <Users className="w-4 h-4 text-wine-500" />
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Team</h2>
        <p className="text-xs text-gray-400 mt-0.5">Members of <strong>{activeRestaurantName}</strong></p>
      </div>
    </div>
    {/* Invite button: owner can invite any role; manager can invite staff only (D-07) */}
    {(user?.role === 'owner' || user?.role === 'manager') && (
      <button ref={teamInviteAnchorRef} ... className="...bg-wine-600 hover:bg-wine-700 text-white...">
        Invite
      </button>
    )}
  </div>
```

**Member row pattern** (follow Locations tree row pattern from lines 787–840):
```typescript
{/* Member row */}
<div className="flex items-center justify-between px-6 py-3 hover:bg-gray-50 group">
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-full bg-wine-100 flex items-center justify-center">
      <span className="text-wine-700 text-xs font-semibold">{member.name[0]}</span>
    </div>
    <div>
      <p className="text-sm font-medium text-gray-900">{member.name}</p>
      <p className="text-xs text-gray-400">{member.email}</p>
    </div>
  </div>
  <div className="flex items-center gap-2">
    {/* Role badge / inline dropdown for owner (D-13) */}
    {user?.role === 'owner' ? (
      <select value={member.role} onChange={...} className="text-xs border ...">
        <option value="owner">Owner</option>
        <option value="manager">Manager</option>
        <option value="staff">Staff</option>
      </select>
    ) : (
      <span className="text-xs text-gray-500 capitalize">{member.role}</span>
    )}
    {/* Remove button: owner only (D-07) */}
    {user?.role === 'owner' && member.userId !== user.userId && (
      <button onClick={() => handleRemove(member)} className="opacity-0 group-hover:opacity-100 ...">
        <Trash2 className="w-3.5 h-3.5 text-red-400" />
      </button>
    )}
  </div>
</div>
```

**Fetch members pattern** (follow the same API call pattern as branches fetch in AuthContext lines 213–252):
```typescript
const fetchMembers = useCallback(async () => {
  if (!activeRestaurantId) return
  setLoadingMembers(true)
  try {
    const token = localStorage.getItem('accessToken')
    const resp = await fetch(`${API_URL}/api/v1/restaurants/${activeRestaurantId}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) throw new Error('Failed to fetch members')
    setMembers(await resp.json())
  } catch {
    toast.error('Could not load team members')
  } finally {
    setLoadingMembers(false)
  }
}, [activeRestaurantId])
```

**Empty state pattern** (lines 736–742 — reuse exactly):
```typescript
<div className="px-6 py-8 flex flex-col items-center text-center">
  <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center mb-3">
    <Users className="w-5 h-5 text-gray-300" />
  </div>
  <p className="text-sm font-medium text-gray-500">No team members yet</p>
  <p className="text-xs text-gray-400 mt-1">Generate an invite code to bring your team in.</p>
</div>
```

**Confirmation dialog pattern** (follow MoreHorizontal menu pattern already in Settings for location delete):
```typescript
{/* Removal confirmation uses toast + confirm inline, not a full Dialog, for speed */}
const handleRemove = (member: Member) => {
  toast(`Remove ${member.name} from ${activeRestaurantName}?`, {
    action: {
      label: 'Remove',
      onClick: () => doRemove(member.userId),
    },
    cancel: { label: 'Cancel', onClick: () => {} },
  })
}
```

---

### `apps/web/src/pages/Register.tsx` — accept ?invite= from /invite/:code redirect (component)

**Analog:** self — existing `?invite=` param reading (lines 127–142):
```typescript
// Already exists in Register.tsx — no change needed for the URL param read
// ?invite=CODE → Path A (join) with code pre-filled
useEffect(() => {
  const code = searchParams.get('invite')
  const type = searchParams.get('type')
  if (code) {
    setInviteCode(code.toUpperCase())
    setPath('join')        // ← auto-switch to Path A
    setPathAStep(1)
  } else if (type === 'join') {
    setPath('join')
  }
}, [searchParams])
```

The `/invite/:code` landing page redirects new users to `/register?invite=${code}` — this path already works. No changes needed beyond ensuring the redirect URL matches `?invite=` (not `?code=`).

---

### `supabase/migrations/20260514_phase33_ura_schema.sql` (migration, batch)

**Analog:** `supabase/migrations/20260506000000_organizations.sql` (full file)

**Migration header pattern** (line 1 of organizations.sql):
```sql
-- Phase 33 URA-01: alter user_restaurant_access + backfill + RLS
-- Per CONTEXT.md D-01: user_restaurant_access is authoritative membership table
```

**ALTER TABLE pattern** (follow organizations.sql `CREATE TABLE IF NOT EXISTS` style):
```sql
ALTER TABLE user_restaurant_access
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS valid_from     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS valid_until    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invited_via    UUID REFERENCES organization_invites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES users(user_id) ON DELETE SET NULL;
```

**CREATE INDEX pattern** (lines 22–23 of organizations.sql):
```sql
CREATE INDEX IF NOT EXISTS idx_ura_restaurant_active
  ON user_restaurant_access(restaurant_id, is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_ura_user_active
  ON user_restaurant_access(user_id, is_active)
  WHERE is_active = TRUE;
```

**Backfill pattern** (idempotent INSERT ... ON CONFLICT DO NOTHING):
```sql
-- Backfill from users.restaurant_id (Wave 2)
INSERT INTO user_restaurant_access (user_id, restaurant_id, role, granted_at, is_active)
SELECT user_id, restaurant_id, COALESCE(role, 'manager'), created_at, TRUE
FROM users
WHERE restaurant_id IS NOT NULL
ON CONFLICT (user_id, restaurant_id) DO NOTHING;
```

**RLS policy pattern** (lines 25–55 of organizations.sql):
```sql
ALTER TABLE user_restaurant_access ENABLE ROW LEVEL SECURITY;

-- Users can read their own access rows
CREATE POLICY "ura_read_own" ON user_restaurant_access
  FOR SELECT USING (user_id::text = auth.uid()::text);

-- Org owners can read all URA rows for their restaurants
CREATE POLICY "ura_org_owner_read" ON user_restaurant_access
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM restaurants r
      JOIN organizations o ON o.id = r.organization_id
      WHERE r.id = user_restaurant_access.restaurant_id
        AND o.owner_id::text = auth.uid()::text
    )
  );
```

---

### `apps/web/src/App.tsx` — add new routes (router, config)

**Analog:** self — existing public route pattern (lines 108–112):
```typescript
// Add alongside /verify-email (public route, no ProtectedRoute wrapper):
<Route path="/invite/:code" element={<InviteLanding />} />
<Route path="/no-access" element={<NoAccess />} />
```

---

## Shared Patterns

### Authentication Guard (backend)
**Source:** `apps/api-gateway/src/auth/guards/jwt-auth.guard.ts` + `roles.guard.ts`
**Apply to:** All new/modified controller endpoints

```typescript
// Class-level: authenticate all routes in controller
@UseGuards(JwtAuthGuard)

// Method-level: role-restrict destructive actions
@UseGuards(RolesGuard)
@Roles('owner')                    // only owner can remove members / change roles
@Roles('owner', 'manager')         // both can invite
```

**RolesGuard note** (roles.guard.ts lines 31–35): current implementation treats `owner` and `manager` as equal at the guard level — **for Phase 33 the `members.service.ts` must perform the finer-grained check itself** (e.g., manager can only invite staff, owner can do everything per D-07).

### Error Handling (backend)
**Source:** All service files — `organizations.service.ts` lines 92–124
**Apply to:** `members.service.ts`, modified `auth.service.ts` sections

```typescript
// Standard NestJS exception hierarchy:
throw new ForbiddenException('Access denied to this restaurant');   // 403
throw new NotFoundException('Member not found');                     // 404
throw new BadRequestException('...');                                // 400
throw new ConflictException('already_member');                       // 409
throw new InternalServerErrorException('Failed to update member');   // 500
```

### Toast / Error Pattern (frontend)
**Source:** `apps/web/src/components/team/InviteTeamDialog.tsx` lines 56–59, `VerifyEmail.tsx` lines 85–88
**Apply to:** `InviteLanding.tsx`, `NoAccess.tsx`, `Settings.tsx` team section

```typescript
// Success
toast.success('Joined [Restaurant] successfully!')
// Error
toast.error(err instanceof Error ? err.message : 'Something went wrong')
// Conditional (D-03 already member)
toast.success(`You're already a member of ${restaurantName}`)
navigate('/')
```

### API Call Pattern (frontend — direct fetch)
**Source:** `apps/web/src/components/team/InviteTeamDialog.tsx` lines 36–61
**Apply to:** `InviteLanding.tsx`, Settings team tab member fetch

```typescript
const token = localStorage.getItem('accessToken')
const resp = await fetch(`${API_URL}/api/v1/...`, {
  method: 'POST',  // or GET / PATCH / DELETE
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify({ ... }),
})
if (!resp.ok) {
  const data = await resp.json()
  throw new Error(data.message || 'Operation failed')
}
```

### Supabase Upsert (idempotent write)
**Source:** `apps/api-gateway/src/organizations/organizations.service.ts` lines 69–73
**Apply to:** `auth.service.ts` joinViaInvite organization_members write, migration backfill

```typescript
await this.databaseService.supabase.from('organization_members').upsert(
  { organization_id: orgId, user_id: userId, role: invite.role },
  { onConflict: 'organization_id,user_id' },
);
```

### Wine-themed button styles
**Source:** `apps/web/src/pages/Settings.tsx` lines 726–733
**Apply to:** `InviteLanding.tsx`, `NoAccess.tsx` primary buttons

```typescript
// Primary CTA:
className="flex items-center gap-1.5 px-3.5 py-2 bg-wine-600 hover:bg-wine-700 text-white text-sm font-medium rounded-xl transition-colors"
// Secondary/outline:
className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-xl transition-colors"
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| None — all files have strong codebase analogs | — | — | — |

---

## Metadata

**Analog search scope:** `apps/api-gateway/src/`, `apps/web/src/`, `supabase/migrations/`
**Files scanned:** 26 source files + 4 migration files
**Pattern extraction date:** 2026-05-14
