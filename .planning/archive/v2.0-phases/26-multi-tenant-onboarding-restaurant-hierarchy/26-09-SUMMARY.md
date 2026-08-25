# Phase 26 — Step 09: Settings UX Overhaul (Chain CRUD + Navigation)

## Summary

Post-verification UX pass on the Settings page. Implemented chain rename/delete API endpoints, a tree-view Locations layout, and sticky section-anchor navigation. Design decisions were validated through two interactive HTML sketch sessions (006, 007) before coding.

## Motivation

Phase 26 Steps 07–08 wired the data model (EditLocationChainDialog, refreshBranches, chain creation). Step 09 completes the user-facing experience:
- Chain actions (rename, delete) had no UI
- The Locations list had no visual hierarchy for chains with multiple locations
- The Settings page had no navigation structure — users had to scroll blindly to find feature flags

## Changes

### Backend — `apps/api-gateway/src/organizations/`

| File | Change |
|------|--------|
| `dto/rename-chain.dto.ts` | NEW — `{ name: string }` DTO for chain rename endpoint |
| `dto/update-location.dto.ts` | Extended — added optional `name` and `city` fields (was chainId-only) |
| `organizations.service.ts` | Added `renameChain(userId, chainId, name)`, `deleteChain(userId, chainId)`, refactored `updateLocation` to handle name/city/chainId |
| `organizations.controller.ts` | Added `PATCH /chains/:id` → renameChain, `DELETE /chains/:id` → deleteChain; updated `PATCH /locations/:id` to forward name/city |

`deleteChain` detaches all member locations (sets `chain_id = null`) before deleting the chain row, avoiding FK constraint errors.

### Frontend — `apps/web/src/`

| File | Change |
|------|--------|
| `components/locations/CreateChainDialog.tsx` | NEW — modal for chain creation; optional "Add [current location] to this chain" checkbox when current location is standalone |
| `components/locations/EditLocationChainDialog.tsx` | Overhauled — now edits name + city + chain; visual radio cards replace native `<select>`; contextual amber warnings for chain-switch and chain-removal |
| `pages/Settings.tsx` | Full rewrite — see below |

### Settings.tsx — key structural changes

**Navigation (Sketch 006 synthesis — single column + top tabs):**
- Sticky anchor tab bar at `top-16` (below the app header) with four tabs: Team · Locations · Measurement · Features
- `wine-600` filled pill for active tab, `hover:bg-gray-100` for inactive
- Scrollspy via passive `scroll` listener — highlights the section whose top is nearest the 120px threshold (header 64px + tab bar 44px + buffer)
- Each section has `scroll-mt-32` (128px) so `scrollIntoView` clears both sticky bars
- Single-column layout preserved — all sections stack, no isolation

**Locations tree (Sketch 007 synthesis — Variant C structure + Variant A interactions):**
- `ChainTreeNode` component: wine-500 dot root + `flex-1` truncated chain name + location count + ⋯ dropdown (Rename → inline input, blur/Enter saves, Escape cancels; Delete → confirm panel with "X locations will become standalone" warning)
- `ml-[5px] border-l-2 border-gray-100` vertical trunk aligned to the dot's center
- `TreeLocationRow`: `w-5 border-t border-gray-200 -ml-px` horizontal connector + `w-1.5 h-1.5` gray leaf dot + name/city/active badge + hover-reveal edit pencil
- Empty chains: `No locations yet. Add one →` inline CTA
- Standalone section: centered `──── Standalone ────` divider when chains also exist

**Other:**
- Feature flag search bar (filters label + description, hides empty categories)
- `X/N on` badge per category (wine-50/wine-600 when any on, gray otherwise)
- Entire toggle row is clickable (not just the switch thumb)
- `CreateChainDialog` replaces the old buried inline chain creation form

## Sketches Produced

| # | File | Question | Winner |
|---|------|----------|--------|
| 006 | `.planning/sketches/006-settings-layout/index.html` | Single scroll vs. left rail vs. top tabs | ★ Synthesis: single column + top tabs |
| 007 | `.planning/sketches/007-locations-chains/index.html` | How do chains nest without feeling bureaucratic? | ★ Synthesis: C tree + A interactions |

## UAT Impact

Tests H-06 and H-07 in `26-HUMAN-UAT.md` now exercise the improved UI:
- H-06 (Create chain in Settings): chain creation is now via `CreateChainDialog` modal, not an inline form
- H-07 (Add location to chain): `EditLocationChainDialog` now shows visual radio cards for chain selection and also allows name/city editing

## Threat Flags

None — two new network endpoints follow existing auth pattern (Bearer token, org-scoped ownership check). No new trust boundaries.

## Self-Check: PASSED

- [x] `apps/api-gateway/src/organizations/dto/rename-chain.dto.ts` — created
- [x] `apps/api-gateway/src/organizations/dto/update-location.dto.ts` — extended
- [x] `apps/api-gateway/src/organizations/organizations.service.ts` — renameChain, deleteChain, updateLocation
- [x] `apps/api-gateway/src/organizations/organizations.controller.ts` — PATCH/DELETE chains/:id, extended PATCH locations/:id
- [x] `apps/web/src/components/locations/CreateChainDialog.tsx` — created
- [x] `apps/web/src/components/locations/EditLocationChainDialog.tsx` — overhauled
- [x] `apps/web/src/pages/Settings.tsx` — sticky tabs + tree view + chain CRUD
- [x] `.planning/sketches/006-settings-layout/` — sketch + synthesis variant
- [x] `.planning/sketches/007-locations-chains/` — sketch + synthesis variant
- [x] `npx tsc --noEmit` — zero new errors in Settings or location components
