---
phase: 28-onboarding-reform-menu-import
plan: 01
status: complete
completed: "2026-05-11"
---

# Plan 01 Summary: Database — restaurant_menus + menu_items + user_onboarding_progress

## What Was Built
Three new Supabase tables applied via MCP `apply_migration`:

1. **`restaurant_menus`** — Named menu collections with `season` (spring/summer/fall/winter/year_round/event), `year`, `menu_type` (beverage/food/full/bar/events), and `status` (active/draft/archived). Supports Phase 28 multi-menu model.
2. **`menu_items`** — Individual wine items extracted from menus. `source` (scan/csv/manual), `status` (approved/flagged/in_review). Manually entered items default to `flagged`. Linked to `restaurant_menus`, `restaurants`, `master_wine_library`.
3. **`user_onboarding_progress`** — Per-user activation checklist state: `menu_uploaded`, `vendor_added`, `team_member_invited`, `checklist_dismissed`, `completed_at`. Includes `updated_at` trigger.

## RLS Policies
- `restaurant_menus`: `restaurant_id IN (SELECT restaurant_id FROM users WHERE user_id = auth.uid())`
- `menu_items`: same restaurant-scoped policy
- `user_onboarding_progress`: `user_id = auth.uid()` (user sees only their own row)

## Backfill
Existing users backfilled with smart detection: `vendor_added=true` if they have providers, `team_member_invited=true` if a second user shares their restaurant. 5+ rows confirmed in production.

## auth.service.ts Seed
`registerRestaurant()` now seeds a `user_onboarding_progress` row immediately after creating the user + restaurant. Fire-and-forget pattern — never blocks registration response.

## Key Deviations from Plan
- Added `season` + `year` columns to `restaurant_menus` (multi-menu decision from user session)
- Added `checklist_dismissed` to `user_onboarding_progress` (dismissable panel decision)
- RLS policy fixed to use `user_id` (not `id`) matching actual `users` table PK

## Self-Check: PASSED
- ✅ All 3 tables visible in Supabase (confirmed via execute_sql)
- ✅ Backfill rows confirmed (5 rows with smart vendor/team detection)
- ✅ RLS policies corrected for actual schema
- ✅ auth.service.ts seed added (fire-and-forget, non-blocking)
