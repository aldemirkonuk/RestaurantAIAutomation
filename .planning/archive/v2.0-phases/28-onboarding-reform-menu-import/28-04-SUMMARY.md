---
phase: 28-onboarding-reform-menu-import
plan: "04"
subsystem: frontend-sidebar + backend-triggers
tags: [onboarding, sidebar, checklist, activation, variant-b]
dependency_graph:
  requires: [28-01, 28-02, 28-03]
  provides: [sidebar-checklist, onboarding-auto-triggers, completed_at-logic]
  affects: [Sidebar, providers.service, auth.service, menus.service]
tech_stack:
  added: []
  patterns:
    - framer-motion AnimatePresence for slide-in panel
    - fire-and-forget Supabase updates in backend services
    - position:absolute left:100% overlay pattern for sidebar panel
key_files:
  created:
    - apps/web/src/components/onboarding/GettingStartedPanel.tsx
  modified:
    - apps/web/src/components/layout/Sidebar.tsx
    - apps/api-gateway/src/providers/providers.service.ts
    - apps/api-gateway/src/auth/auth.service.ts
    - apps/api-gateway/src/menus/menus.service.ts
decisions:
  - "Panel positioned absolute left:full ml-2 so it floats beside the sidebar without modal overlay"
  - "vendor_added and team_member_invited triggers use fire-and-forget (.then) to avoid blocking primary operations"
  - "markMenuUploaded in menus.service.ts now re-fetches progress row to set completed_at after all 3 tasks done"
  - "updateOnboardingProgress already had merged-state completed_at logic — markMenuUploaded now consistent"
metrics:
  duration: "~20 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 4
  files_changed: 5
---

# Phase 28 Plan 04: Frontend — Sidebar Activation Checklist (Variant B) + Backend Auto-Triggers Summary

**One-liner:** Variant B sidebar checklist with slide-in GettingStartedPanel and fire-and-forget backend triggers for vendor_added, team_member_invited, and completed_at.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | GettingStartedPanel slide-in component | `321a600` | `GettingStartedPanel.tsx` (created) |
| 2 | Getting Started nav item in Sidebar | `c7c6de6` | `Sidebar.tsx` |
| 3 | Backend auto-triggers (vendor + invite) | `0bde64e` | `providers.service.ts`, `auth.service.ts` |
| 4 | completed_at auto-set in menus.service | `922286b` | `menus.service.ts` |

## What Was Built

### GettingStartedPanel (Task 1)
- Slide-in panel using `motion.div` with `initial={{ opacity:0, x:-20 }}` → `animate={{ opacity:1, x:0 }}`
- Positioned `absolute top-0 left-full ml-2` — floats beside the sidebar, no modal backdrop
- Shows 4 tasks: account (always done), menu upload, vendor add, team invite
- Completed tasks: green `CheckCircle2` + strikethrough gray text, no CTA
- Incomplete tasks: gray `Circle` + wine-red CTA link with navigation
- Header: title + "N/4 complete" count + X close button
- Footer: "Don't show again" dismiss button calls `onDismiss` prop
- Left border accent: 4px solid `#722F37`

### Sidebar Integration (Task 2)
- Added `Rocket` to lucide-react import
- Added `useOnboardingProgress` hook and `GettingStartedPanel` imports
- New `showChecklist` state and computed `completedCount` / `showChecklistItem`
- "Get started" button with progress badge appears above bottom section when `showChecklistItem` is true
- Badge shows count (0–4) in wine-red circle; disappears when all 4 done
- `AnimatePresence` wraps panel for smooth mount/unmount animation
- Dismiss calls `update({ checklist_dismissed: true })` and closes panel

### Backend Triggers (Task 3)
- **providers.service.ts** `createProvider`: after mapping provider row, fire-and-forget updates `vendor_added=true` filtered by `restaurant_id`
- **auth.service.ts** `generateInvite`: after invite row created, fire-and-forget updates `team_member_invited=true` filtered by `restaurant_id`
- Both log a warning on error but never throw — primary operation always succeeds

### completed_at Auto-Set (Task 4)
- **menus.service.ts** `markMenuUploaded`: after setting `menu_uploaded=true`, re-fetches the progress row and sets `completed_at` if all three flags are true and `completed_at` is null
- `updateOnboardingProgress` already had this logic via merged-state check — both paths are now consistent

## Deviations from Plan

### Auto-fixed Issues
None.

### Adjustments
**1. [Clarification] updateOnboardingProgress already had completed_at logic**
- The existing `updateOnboardingProgress` method already computes merged state and sets `completed_at` when all three flags are true.
- Task 4 was scoped to add the same check to `markMenuUploaded` (which bypasses `updateOnboardingProgress`).
- No change was needed to `updateOnboardingProgress` — it was already correct.

## Known Stubs
None. All progress data flows from real Supabase rows via the existing `useOnboardingProgress` hook.

## Threat Flags
None. No new network endpoints, auth paths, or schema changes introduced. The onboarding progress updates use existing RLS-protected table rows.

## Self-Check

### Created files exist:
- [x] `apps/web/src/components/onboarding/GettingStartedPanel.tsx` — 130 lines

### Commits exist:
- [x] `321a600` — feat(28-04): add GettingStartedPanel slide-in component
- [x] `c7c6de6` — feat(28-04): add Getting Started nav item + checklist panel to Sidebar
- [x] `0bde64e` — feat(28-04): auto-update vendor_added + team_member_invited on backend
- [x] `922286b` — feat(28-04): set completed_at when all onboarding tasks done

## Self-Check: PASSED
