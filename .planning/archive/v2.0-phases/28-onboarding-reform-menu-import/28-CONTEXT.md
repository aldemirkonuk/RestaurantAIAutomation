# Phase 28: Onboarding Reform + Menu Import — CONTEXT

Created: 2026-05-09
Status: planning

---

## Problem Being Solved

The current post-registration experience has critical friction and data capture failures:
1. After email verify, users are redirected to a **9-step wizard** (`/onboarding`) — an unacceptable amount of
   friction for B2B restaurant operators who are time-pressed
2. Steps 2 and 3 of the wizard (restaurant profile, manager profile) **duplicate data already collected in
   Register.tsx** — users are asked the same questions twice
3. The single most important action — **uploading the restaurant's menu** — is buried in the wizard as
   "Wine Inventory" and feels optional. It is not: without a menu, WineOps AI has no data to work with
4. The wizard has no connection to the `master_wine_library` pipeline — menu data is collected but not
   enriched and promoted to the global wine library (a missed data flywheel opportunity)
5. New users have no persistent reminder of what to do after dismissing or completing the wizard

---

## Decisions

### D-01: Kill the 9-Step Wizard (Redirect Fix)
After email verification, redirect to `/get-started` (new page) instead of `/onboarding`.
The old `/onboarding` route is preserved for existing users who bookmarked it, but its duplicate
steps (restaurant profile, manager profile, review, complete) are removed. Only genuinely useful steps
that have no other home (POS integration) are kept as optional deep-links from Settings.

### D-02: The Hybrid Flow (Option A+B)
Post-verify flow:
1. → `/get-started`: **one focused screen** with the single goal of importing the restaurant's menu
   - Three import methods shown as equal-weight cards: Photo Scan, CSV/Excel, Manual Entry
   - "Skip for now" link is frictionless — no guilt-trip copy, no warning modals
   - If the user uploads a menu: show progress ("Analyzing your menu...") → then redirect to dashboard
   - If the user skips: redirect to dashboard immediately
2. → `/` (Dashboard): **persistent Setup Checklist** in the top area (below the header)
   - Shows 3 activation tasks: ① Upload your menu ② Add your first vendor ③ Invite your team
   - Each task has a status indicator (incomplete/in-progress/done)
   - The checklist disappears entirely when all 3 are completed
   - Checklist state persists in DB (`user_onboarding_progress` table)

### D-03: Menu Import is the Priority, Not Just Inventory
"Uploading a menu" is distinct from "adding inventory":
- **Menu** = what the restaurant sells to customers (the beverage/wine list with names, by-glass prices)
- **Inventory** = what the restaurant stocks (bottles, quantities, par levels, storage locations)
A single wine item can appear in both. When a menu is uploaded:
1. Extracted wines are submitted to `master_wine_library_submissions` (enrichment pipeline)
2. Extracted wines are also added to the restaurant's `inventory` table with `source = 'menu_import'`
This is the **data flywheel**: every menu upload improves the master wine library for all users.

### D-04: Three Import Methods — One Pipeline
All three methods (photo scan, CSV, manual entry) feed into the same backend pipeline:
- Photo/camera → camera capture component → sends image to LLM extraction endpoint
- CSV/Excel → file upload → server-side CSV parser → same extraction format
- Manual → free-text wine entry form → formats into the same extraction format
Backend entry point: `POST /api/v1/menus/import` with `{ method, data }` — one endpoint handles all three.

### D-05: Menu Data Model
New tables:
- `restaurant_menus`: one per restaurant (or multiple if they have multiple menu versions)
  - `id`, `restaurant_id`, `name` (e.g. "Wine List 2026"), `type` ('beverage' | 'food' | 'full'),
    `created_at`, `updated_at`, `is_active`
- `menu_items`: individual items on a menu
  - `id`, `menu_id`, `restaurant_id`, `name`, `category`, `by_glass_price`, `bottle_price`,
    `vintage`, `region`, `grape_variety`, `wine_library_id` (nullable FK to master_wine_library),
    `inventory_item_id` (nullable FK to inventory), `source` ('scan' | 'csv' | 'manual'),
    `raw_extracted_text`, `created_at`

### D-06: master_wine_library Integration
Each extracted menu item → submit to `master_wine_library_submissions` with:
- `source_type = 'menu_scan'`
- `source_ref = restaurant_menus.id`
- Standard wine fields populated by LLM extraction
Uses the **existing** submission pipeline (already built in prior phases). No new pipeline needed —
just a new source type.

### D-07: Activation Checklist Tracking
`user_onboarding_progress` table:
- `id`, `user_id` (FK to users), `restaurant_id` (FK), 
- `menu_uploaded BOOLEAN DEFAULT FALSE`
- `vendor_added BOOLEAN DEFAULT FALSE`
- `team_member_invited BOOLEAN DEFAULT FALSE`
- `completed_at TIMESTAMPTZ nullable`
- `created_at`
Row is created automatically on restaurant registration (in `auth.service.ts`).
Each task completion updates its boolean column.

### D-08: POS Integration Preserved as Optional
The POS integration step (connecting Square, Clover, etc.) was in the old wizard.
It moves to: Settings → Integrations → "Connect POS". Not part of the mandatory activation flow.
A small "Connect POS" card can appear in the activation checklist as a step 4 once steps 1-3 are done.

---

## User Stories

1. **New owner** finishes registration + email verify → `/get-started` page →
   sees "Import your menu" with 3 options → takes a photo of their paper wine list →
   progress spinner → "Great! We found 42 wines" → clicks "Go to dashboard" →
   dashboard shows Setup Checklist with ① checked
2. **Time-pressed owner** skips the menu step → clicks "Skip for now" → goes straight to dashboard →
   sees Setup Checklist with ① highlighted in orange → later comes back and uploads menu
3. **User opens Inventory page** → sees menu items already there (from scan) with `source = 'menu_import'`

---

## Architecture Fit

- New page: `apps/web/src/pages/GetStarted.tsx` at route `/get-started`
- New component: `apps/web/src/components/dashboard/ActivationChecklist.tsx`
- New API module: `apps/api-gateway/src/menus/menus.module.ts`
- New DB tables: `restaurant_menus`, `menu_items`, `user_onboarding_progress`
- Post-verify redirect: update in `apps/web/src/pages/VerifyEmail.tsx` (or wherever redirect is set)
- master_wine_library pipeline: reuse `master_wine_library_submissions` insert path from prior phases
- The old `apps/web/src/pages/Onboarding.tsx` (1126 lines) is largely retired; route preserved for graceful 404/redirect

---

## What "Menu" Means in WineOps (Data Flywheel)

When a restaurant uploads their menu → LLM extracts individual wine items → each item is:
1. Submitted to `master_wine_library_submissions` with enrichment metadata
2. Cross-referenced against existing `master_wine_library` entries (match or new record)
3. Entries meeting the completeness threshold (≥ 0.3) are auto-promoted to `master_wine_library`
4. Borderline entries go to human review queue
5. Added to the restaurant's `inventory` table (source = 'menu_import')
Over time: every restaurant's menu upload makes the library richer → better AI suggestions for all users.

Right now: beverages/wine menus only. Future phases: full food menus.

---

## Future Extensions (Out of Scope for Phase 28)
- Admin panel to review and approve `master_wine_library_submissions` from menu scans
- AI-powered menu comparison ("Your menu differs from last scan — 5 new wines, 3 removed")
- Shareable digital menu (QR code for customers)
- Food menu item entry + food-wine pairing AI
