# Phase 33: Multi-Restaurant Membership Model — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the three root causes of broken restaurant membership: (1) write to `user_restaurant_access` as the authoritative membership table, (2) allow existing users to join additional restaurants via invite without crashing, (3) update the Settings → Team tab to show per-restaurant rosters with correct role-based permissions.

Backend: `auth.service.ts` (joinViaInvite, registerRestaurant), new `/invite/[code]` route, backfill migration, RLS updates.
Frontend: Settings → Team tab redesign, new `/invite/[code]` landing page, branch-switcher behavior on access loss.

</domain>

<decisions>
## Implementation Decisions

### Existing-User Invite Flow
- **D-01:** A dedicated `/invite/[code]` full-page route handles ALL invite landing scenarios (logged-in and logged-out).
  - Logged-out: show restaurant name + "Sign in to accept" / "Create account to accept"
  - Logged-in: show "Add **[Restaurant Name]** to your branches?" with a single confirm button
- **D-02:** New user (no account) who clicks an invite link → redirected to `/register` with invite code pre-filled as query param; existing `/register` Path A flow handles the join.
- **D-03:** If the user is already a member of the restaurant being invited to → silent skip: toast "You're already a member of **[Restaurant]**", redirect to that restaurant's dashboard.
- **D-04:** Expired or already-used invite code at `/invite/[code]` → clear error page: "This invite has expired. Ask the restaurant owner for a new one."

### Team Tab Scope
- **D-05:** Settings → Team shows **per-restaurant** roster only — "Members of **[Active Branch]**". No org-wide view in Phase 33.
- **D-06:** Role displayed is each member's role AT THIS BRANCH (from `user_restaurant_access.role`), not a global role.
- **D-07:** Permission tiers for Team tab actions:
  - `owner`: can invite, change any member's role, remove any member
  - `manager`: can invite staff only; cannot change roles or remove members
  - `staff`: read-only view of team roster
- **D-08:** Empty state for a branch with no members: single "Invite your first team member" CTA button.
- **D-09:** Pending invites section in Team tab (codes sent but not yet accepted), showing invite code, expiry date, and a revoke button.

### Role Per Restaurant
- **D-10:** Multiple owners are allowed per restaurant (useful for business partners).
- **D-11:** Active branch role communicated to frontend via API call (`/me/role?restaurantId=[id]`) on each branch switch — stored in `AuthContext`. No JWT churn.
- **D-12:** User's current role (at active branch) is visible in Settings → Profile only. Branch switcher dropdown is kept uncluttered.
- **D-13:** Inline role editing in Team tab — dropdown next to each member row to change their role (owner only).
- **D-14:** RLS scope for Phase 33: all roles within a restaurant see the same data. Roles affect ACTIONS only (invite, remove, role change), not data visibility. Role-based data filtering is deferred to a future phase.

### Member Deactivation / Removal
- **D-15:** Removing a member = hard delete of the `user_restaurant_access` row. User account and all historical data are preserved; they simply lose access to this restaurant.
- **D-16:** All removals require a confirmation dialog: "Remove **[Name]** from **[Restaurant]**? They will lose access immediately."
- **D-17:** Self-leave is allowed ("Leave this restaurant" button). Blocked only if the user is the last owner.
- **D-18:** Last-owner protection: if the last owner tries to leave or be removed → block with message: "You're the only owner. Transfer ownership or delete the restaurant first." Additionally, if they attempt full account deletion, show a final warning: "Deleting your account will permanently delete all restaurant data in 30 days." (mirrors Supabase's account deletion flow).
- **D-19:** No email notification sent on member removal — the removed user simply loses access on next visit.
- **D-20:** Removed user who visits the app while still session-active → redirect to "You no longer have access to **[Restaurant]**" page with option to switch to another branch if they belong to one.

### Claude's Discretion
- `/invite/[code]` page layout and visual design (handled by gsd-ui-phase).
- Exact `/me/role` endpoint shape (handled by planner/researcher).
- Account deletion 30-day pipeline implementation details (flag for planner — this extends scope; planner should scope conservatively).
- Redirect-after-login flow when invite code is preserved across login/register (implementation detail, standard pattern).
- `staff` read-only Team tab view — show the member list but disable invite/remove/role-change controls.
- Pending invites section placement (above or below active members list — researcher to decide based on existing UI patterns).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research & Architecture
- `.planning/phases/33-multi-restaurant-membership-model/33-RESEARCH.md` — Complete root cause analysis, schema evidence, broken scenarios (12), and proposed workspace membership model. PRIMARY reference for all backend work.

### Prior Phase Decisions
- `.planning/phases/26-multi-tenant-onboarding-restaurant-hierarchy/26-CONTEXT.md` — D-04 (invite codes: 8-char, single-use, owner-generated), D-06 (branch switcher in top nav), D-03 (org → restaurants hierarchy). Do not re-design what Phase 26 already decided.

### Database Schema
- `supabase/migrations/20260208024921_new-migration.sql` — Baseline `users`, `user_restaurant_access`, `restaurants` tables.
- `supabase/migrations/20260506000000_organizations.sql` — `organizations`, `organization_members`, `organization_invites` tables (Phase 26).

### Backend Services
- `apps/api-gateway/src/auth/auth.service.ts` — `joinViaInvite` (the crashing function), `registerRestaurant`, `checkEmailExists`.
- `apps/api-gateway/src/auth/auth.controller.ts` — Auth routes, invite endpoints.

### Frontend Auth
- `apps/web/src/contexts/AuthContext.tsx` — `availableRestaurants`, `switchRestaurant`, `activeRestaurantId` — extend to include `activeRole`.
- `apps/web/src/pages/Settings.tsx` — Current Team tab implementation (Section `team`).
- `apps/web/src/pages/Register.tsx` — Path A (join via invite) — extend to accept pre-filled invite code from `/invite/[code]` redirect.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `InviteTeamDialog` component (`apps/web/src/components/team/InviteTeamDialog.tsx`) — existing invite modal; reuse or extend for Team tab.
- `AuthContext.availableRestaurants` + `switchRestaurant` — already handles multi-branch; extend to include `activeRole` per branch.
- `Settings.tsx` `team` section — existing Team UI scaffold to rebuild per-restaurant.
- `/register` Path A flow — existing invite-code input; extend to accept pre-filled code from query param.

### Established Patterns
- `user_restaurant_access` table exists in schema but has zero writes — Phase 33 activates it as the authoritative membership source.
- RLS policies currently use `users.restaurant_id` (single FK) — must be updated to join `user_restaurant_access`. The RESEARCH.md has the exact queries.
- `organization_members` stays for org-level membership (is the user in the company?). `user_restaurant_access` answers the per-restaurant question.
- Zustand `useAuthStore` + `AuthContext` must remain in sync (see fix from prior phase — `setActiveRestaurantId` must be called on every branch switch).

### Integration Points
- New `/invite/[code]` frontend route → `/api/v1/auth/invite/:code` backend endpoint (GET for info, POST for accept).
- `joinViaInvite` backend fix: remove `BadRequestException('Email already registered')` guard, write to `user_restaurant_access` on success.
- Backfill migration: seed `user_restaurant_access` from existing `users.restaurant_id` values for all current users.
- RLS migration: swap `users.restaurant_id` references to `EXISTS (SELECT 1 FROM user_restaurant_access WHERE user_id = auth.uid() AND restaurant_id = ...)`.

</code_context>

<specifics>
## Specific Ideas

- **Supabase-like account deletion warning:** Last owner deleting account → 30-day data deletion countdown, styled like Supabase's destructive action confirmation.
- **Branch switcher behavior on access loss:** Removed user mid-session → graceful redirect to "You no longer have access" page with branch switch option (not a forced logout).
- **Invite page:** `/invite/[code]` must show the restaurant's name prominently before the user commits to joining.

</specifics>

<deferred>
## Deferred Ideas

- **All Locations cross-restaurant view** in Settings → Team — future org-management phase. Phase 33 is per-restaurant only.
- **Role-based data visibility** (staff cannot see cost/financial data) — Phase 34 or later. Phase 33 scopes roles to actions only.
- **30-day account deletion pipeline** — flagged but the automated 30-day deletion job is out of Phase 33 scope. Phase 33 shows the warning; the deletion scheduler is a separate infrastructure task.
- **SSO / Google / Microsoft login for invite acceptance** — already out of scope per Phase 26 D-06; remains deferred.

</deferred>

---

*Phase: 33-multi-restaurant-membership-model*
*Context gathered: 2026-05-14*
