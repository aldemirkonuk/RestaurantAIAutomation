---
phase: 28-onboarding-reform-menu-import
verified: "2026-07-31"
status: passed
method: "retroactive — live schema, live routes, live code. Not SUMMARY aggregation."
score: "all 5 plans' deliverables verified present and wired"
requirements_satisfied:
  [ACTIVATION-01, ACTIVATION-02, ACTIVATION-03, ACTIVATION-04, ACTIVATION-05,
   MENU-01, MENU-02, MENU-03, MENU-04, MENU-05, MENU-06, MENU-07, MENU-08]
note: "Requirements verified against ROADMAP; these REQ-IDs were never entered into REQUIREMENTS.md (see 44.4 orphaned-ID gap)."
---

# Phase 28 Verification — Onboarding Reform + Menu Import

## Why this exists

The v2.0 audit scored Phase 28 PARTIAL with "zero verification artifacts of any
kind" — five SUMMARY files and nothing else, while ROADMAP.md showed it
`✓ COMPLETE (2026-05-11)`.

## Evidence

| Plan | Deliverable | Verified |
|---|---|---|
| 28-01 | `user_onboarding_progress`, `restaurant_menus`, `menu_items` | All three live; columns read from `information_schema` |
| 28-02 | Menu import API | `menus.controller.ts:14` `@Controller("menus")`, `:19` `@Post("import")`, `:28` `@Post("items")` |
| 28-03 | `/get-started` page | `pages/GetStarted.tsx`, routed in `App.tsx` |
| 28-04 | Checklist + onboarding triggers | `@Controller("onboarding")` at `menus.controller.ts:49`; checklist wired via `DashboardLayout` / `guidance` |
| 28-05 | 9-step wizard → slim redirect | `pages/Onboarding.tsx` is **37 lines**, `navigate('/get-started', { replace: true })` |

Everything the phase promised is present and reachable.

## The finding: this phase was "complete" for 2.5 months without a schema

Phase 28 was marked `✓ COMPLETE (2026-05-11)`. Its three tables were not tracked
by any migration until **2026-07-26** — `20260726135000_menu_onboarding_catchup.sql`,
whose own header records what that cost:

> These three tables were applied to the Restaurant_Wine_Ops project out of band
> (no migration file tracked them), **which is how the broken column names in
> menus.service.ts (`is_active`/`type` instead of `status`/`menu_type`) went
> unnoticed.**

So the ghost-table problem this milestone catalogued abstractly (44.3a, 13 tables
in no migration) has one documented instance of it **causing a live defect**: with
no migration to check against, the service queried columns that did not exist, and
nothing surfaced it for two and a half months.

Both are now correct — the live schema has `menu_type` and `status`, and
`menus.service.ts` uses `status` throughout. Fixed before this verification, by
whoever wrote the catch-up.

**Recorded because it is the best available argument for 44.3a.** "A fresh
environment will not match production" sounds like tidiness debt. This is what it
actually looks like in practice: a phase marked complete, a service querying
non-existent columns, and no mechanism able to notice.

## Conclusion

**Phase 28 is verified.** All five plans' deliverables are present, wired and
reachable, and the schema drift that made it fragile has been closed.

Its 13 REQ-IDs (ACTIVATION-01..05, MENU-01..08) were never entered into
REQUIREMENTS.md and were verified against ROADMAP.md instead — part of the ~100
orphaned IDs still open in 44.4.
