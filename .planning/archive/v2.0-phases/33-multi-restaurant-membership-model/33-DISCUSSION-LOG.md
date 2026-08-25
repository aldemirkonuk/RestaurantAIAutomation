# Phase 33: Multi-Restaurant Membership Model — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 33-multi-restaurant-membership-model
**Areas discussed:** Existing-user invite flow, Team tab scope, Role per restaurant, Member deactivation

---

## Existing-User Invite Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Redirect to /login first | Auto-consume invite after login | |
| 'You already have an account' screen | Sign In button then auto-joins | |
| You decide | Redirect with invite code as query param | |
| Freeform | Invite landing page asking "Add this restaurant to your branches?" | ✓ |

**User's choice:** Dedicated `/invite/[code]` page showing "Do you want to add [Restaurant] to your branches?" — handles both logged-in and logged-out scenarios. User clarified this was an invitation to join another restaurant, and the UX should feel deliberate.

---

### Logged-in user visiting invite link

| Option | Description | Selected |
|--------|-------------|----------|
| Full page at /invite/[code] | Shows restaurant name, logo, role | |
| Modal overlay | User sees dashboard behind | |
| You decide | Full page — supports both states | ✓ |

**User's choice:** You decide — handle both logged-in and logged-out gracefully (locked as full page).

---

### Duplicate invite (already a member)

| Option | Description | Selected |
|--------|-------------|----------|
| Silent skip | Toast 'You're already a member', redirect | ✓ (you decide) |
| Error page | 'You already have access to this restaurant' | |

**User's choice:** You decide → silent skip with toast.

---

### New user (no account) + invite link

| Option | Description | Selected |
|--------|-------------|----------|
| Combined flow | Create account + join in one flow | |
| Separate, pre-filled | Redirect to /register with invite code | ✓ (you decide) |

**User's choice:** You decide → separate, pre-filled (reuses existing Path A).

---

### Expired or already-used invite code

| Option | Description | Selected |
|--------|-------------|----------|
| Clear error with CTA | 'Expired. Ask owner for a new one.' | ✓ |
| Generic 404 | Not found page | |
| You decide | Clear error page | |

**User's choice:** Clear error page with actionable CTA.

---

## Team Tab Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Per-restaurant only | Members of [This Branch] | ✓ |
| Both views | This Branch + All Locations tabs | |
| You decide | Per-restaurant — simpler | |

**User's choice:** Per-restaurant. User deferred to Claude's recommendation but noted edge cases for managers — Claude explained role-at-branch permission tier architecture (owner/manager/staff).

---

### Empty state

| Option | Description | Selected |
|--------|-------------|----------|
| Invite CTA button | 'Invite your first team member' | ✓ |
| Placeholder skeleton rows | Banner 'No team members yet' | |
| You decide | CTA button | |

**User's choice:** CTA button.

---

### Staff visibility of Team tab

| Option | Description | Selected |
|--------|-------------|----------|
| Hidden for staff | Only managers/owners see Team tab | |
| Read-only for staff | Can see but not invite/remove | ✓ (you decide) |

**User's choice:** You decide → read-only for staff.

---

### Pending invites

| Option | Description | Selected |
|--------|-------------|----------|
| Show pending section | Code + expiry + revoke button | ✓ (you decide) |
| Active members only | No pending section | |

**User's choice:** You decide → show pending.

---

## Role Per Restaurant

### Role communication to frontend

| Option | Description | Selected |
|--------|-------------|----------|
| JWT includes active branch role | Refresh on branch switch | |
| API call /me/role on branch switch | No JWT churn | ✓ (you decide) |

**User's choice:** You decide → API call, role stored in AuthContext.

---

### Where role is displayed in UI

| Option | Description | Selected |
|--------|-------------|----------|
| Badge in branch switcher | 'The Vine · Manager' | |
| Profile only | Settings → Profile section | ✓ |
| You decide | Badge in switcher | |

**User's choice:** Profile only — "profile is enough, otherwise it might be too crowded."

---

### Role change UX

| Option | Description | Selected |
|--------|-------------|----------|
| Inline dropdown in Team tab | Fast, no extra navigation | ✓ (you decide) |
| Member detail panel/modal | Click into member | |

**User's choice:** You decide → inline dropdown.

---

### Multiple owners per restaurant

| Option | Description | Selected |
|--------|-------------|----------|
| One owner only | Single owner, can transfer | |
| Multiple owners allowed | Business partners | ✓ |
| You decide | Multiple owners recommended | |

**User's choice:** Multiple owners allowed.

---

### RLS data visibility by role

| Option | Description | Selected |
|--------|-------------|----------|
| Same data, different actions | Roles affect actions only | ✓ |
| Role-based data access | Staff see less data | |
| You decide | Same data for Phase 33 | |

**User's choice:** Same data, different actions for Phase 33.

---

## Member Deactivation

### Removal type

| Option | Description | Selected |
|--------|-------------|----------|
| Soft deactivate | Remove from table, keep history | |
| Hard delete | Delete user_restaurant_access row | ✓ |
| You decide | Hard delete + keep user account | |

**User's choice:** Hard delete the access row.

---

### Confirmation step

| Option | Description | Selected |
|--------|-------------|----------|
| Confirmation dialog | 'Remove [Name] from [Restaurant]?' | ✓ |
| Undo toast | 5-second undo | |
| You decide | Dialog recommended | |

**User's choice:** Confirmation dialog.

---

### Self-leave

| Option | Description | Selected |
|--------|-------------|----------|
| Allow self-leave | 'Leave this restaurant' button | ✓ |
| No self-leave | Owner must remove | |
| You decide | Allow self-leave | |

**User's choice:** Allow self-leave.

---

### Last owner protection

| Option | Description | Selected |
|--------|-------------|----------|
| Block with message | 'Transfer ownership or delete' | ✓ + extra |
| Allow with warning | 'Restaurant will be ownerless' | |
| You decide | Block recommended | |

**User's choice:** Option A (block) + additionally show 30-day data deletion warning on account deletion, "just like how Supabase does."

---

### Notification on removal

| Option | Description | Selected |
|--------|-------------|----------|
| Email notification | 'You have been removed from...' | |
| No notification | Lose access on next visit | ✓ |
| You decide | Email recommended | |

**User's choice:** No notification.

---

### What removed user sees on next visit

| Option | Description | Selected |
|--------|-------------|----------|
| Redirect with branch switch option | 'No longer have access' page | ✓ (you decide) |
| Forced logout | Re-login to discover | |

**User's choice:** You decide → graceful redirect with branch-switch option.

---

## Claude's Discretion

- `/invite/[code]` page layout and visual design
- Exact `/me/role` endpoint shape
- Account deletion 30-day pipeline implementation details (scope conservatively)
- Redirect-after-login when invite code is preserved across login/register
- Staff read-only Team tab view controls
- Pending invites section placement in Team tab

## Deferred Ideas

- All Locations cross-restaurant org-wide view (future org-management phase)
- Role-based data visibility / staff cannot see cost data (Phase 34+)
- 30-day deletion pipeline automation (separate infrastructure task)
- SSO for invite acceptance (already deferred since Phase 26)
