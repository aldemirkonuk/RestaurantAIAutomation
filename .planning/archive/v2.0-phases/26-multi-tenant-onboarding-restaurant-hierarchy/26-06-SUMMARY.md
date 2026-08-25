---
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
plan: "06"
subsystem: frontend-settings
tags: [invite, team, locations, chains, settings, dialogs]
dependency_graph:
  requires: [26-02, 26-04, 26-05]
  provides: [invite-management-ui, locations-management-ui]
  affects: [Settings.tsx, AuthContext.tsx]
tech_stack:
  added: []
  patterns: [radix-dialog, two-phase-form-ui, role-gated-ui, chain-grouped-list]
key_files:
  created:
    - apps/web/src/components/team/InviteTeamDialog.tsx
    - apps/web/src/components/locations/AddLocationDialog.tsx
  modified:
    - apps/web/src/pages/Settings.tsx
decisions:
  - "D-04 complied: copy button writes full invite URL (/register?invite=CODE) not just the code"
  - "Invite code displayed separately in large monospace with tracking-widest for readability"
  - "Locations section owner-only; Team (invite) section visible to owner and manager"
  - "Create Chain uses inline form in Settings (not a dialog) to reduce UX friction for single-field entry"
  - "AddLocationDialog fetches chains on open; chain selector hidden when no chains exist"
  - "locationsList seeded from availableRestaurants context, kept in sync via useEffect"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-07"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
---

# Phase 26 Plan 06: Invite & Locations Management UI Summary

**One-liner:** Owner/manager invite UI with 8-char code + copy-able invite URL, plus owner-only location & chain management in Settings.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create InviteTeamDialog.tsx | `99e7a32` | `apps/web/src/components/team/InviteTeamDialog.tsx` |
| 2 | Add Team section to Settings.tsx | `1ea8f13` | `apps/web/src/pages/Settings.tsx` |
| 3 | Create AddLocationDialog.tsx + Locations section | `3218561` | `apps/web/src/components/locations/AddLocationDialog.tsx`, `apps/web/src/pages/Settings.tsx` |

## What Was Built

### InviteTeamDialog.tsx
- Two-phase Radix Dialog mirroring the existing `InviteDialog.tsx` (studio) pattern
- **Phase 1 (form):** optional target email + role selector (manager/staff) + Generate button
- **Phase 2 (result):** invite code displayed in large `font-mono font-bold tracking-widest`; invite URL in copyable row with clipboard button
- Copy button calls `navigator.clipboard.writeText(invite.inviteUrl)` — copies the full `/register?invite=XXXXXXXX` URL per D-04 mandate (not just the code)
- `toast.success('Invite URL copied to clipboard!')` on copy; `toast.error(...)` on API failure
- `handleClose()` resets all state on close/dismiss

### Settings.tsx — Team Section
- Inserted above Measurement & Volume section
- Card with `bg-white rounded-2xl border border-gray-200 shadow-sm` matching existing patterns
- "Invite Member" button visible only to `owner` or `manager` roles
- Opens `InviteTeamDialog` with `activeRestaurantId` from `useAuth()`
- Empty state shown in body (invite list = future enhancement as noted in plan)

### AddLocationDialog.tsx
- Radix Dialog with `framer-motion` animation, same visual pattern as InviteTeamDialog
- Fetches `GET /api/v1/organizations/chains` on dialog open; chain selector hidden when no chains exist
- Submits `POST /api/v1/organizations/locations` with: name, address, city, phone?, cuisineType?, timezone (auto-detected), chainId?
- Inline validation: name + address + city required; toast.error on missing fields
- `onLocationAdded` callback fires with `{ id, name }` on success

### Settings.tsx — Locations Section
- Owner-only (`user?.role === 'owner'`), rendered below Team section
- Lists `locationsList` (seeded from `availableRestaurants`, synced via `useEffect`) grouped by `chain_name`
- Chains rendered as collapsible groups; standalone locations (null `chain_name`) grouped under "Standalone Locations" label (only shown if > 1)
- Active badge shown for `branch.id === activeRestaurantId`
- "Create Chain" inline form: input + button → `POST /api/v1/organizations/chains`; `toast.success` on creation
- "Add Location" button → opens `AddLocationDialog`

## Deviations from Plan

None — plan executed exactly as written.

The `err: any` type in error catch blocks was replaced with `err: unknown` + `instanceof Error` narrowing (Rule 2 — stricter TypeScript safety); this does not change runtime behavior.

## Threat Mitigations Verified (T-26-06-01)

- UI hides "Invite Member" button from `staff` role: `user?.role === 'owner' || user?.role === 'manager'`
- Locations section is `owner`-only in UI: `user?.role === 'owner'`
- Backend independently enforces roles via `@Roles('owner','manager')` guard (implemented in Plan 26-02)

## Known Stubs

None — both dialogs make live API calls to backend endpoints implemented in Phase 26 Plan 02 (invite) and Plan 03 (chains/locations). The locationsList empty-state is not a stub; it reflects the real context value.

## Self-Check

- [x] `apps/web/src/components/team/InviteTeamDialog.tsx` — exists, committed `99e7a32`
- [x] `apps/web/src/components/locations/AddLocationDialog.tsx` — exists, committed `3218561`
- [x] `apps/web/src/pages/Settings.tsx` — modified, committed `1ea8f13` + `3218561`
- [x] TypeScript build passes: `pnpm build` exits 0, 0 `error TS` lines
- [x] All 3 tasks committed individually
- [x] STATE.md NOT modified
- [x] ROADMAP.md NOT modified

## Self-Check: PASSED
