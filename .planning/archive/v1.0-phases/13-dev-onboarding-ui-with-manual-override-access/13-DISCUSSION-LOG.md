# Phase 13: Dev Onboarding UI — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 13-dev-onboarding-ui-with-manual-override-access
**Areas discussed:** Role & Auth Architecture, Field Editor UX, Route & Ingestion, Override Promotion Policy

---

## A — Role & Auth Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing role enum | Add developer/certified_contributor/review_admin to owner/manager/staff | |
| Separate user_roles table + Supabase RLS | Junction table, multi-role per user, DB-level enforcement | ✓ |
| X-Admin-Key extension | Extend Phase 12 env-based key pattern | |

**User's direction:** Deferred to Claude recommendation — "do what's state of the art"
**Outcome:** Supabase RLS + user_roles junction table selected as state-of-the-art

| Invite option | Description | Selected |
|---------------|-------------|----------|
| review_admin grants via UI | Admin enables accounts in Certification Management tab | |
| Seeded via env/migration | Seed script only, no self-service | |
| Invite-based | review_admin sends single-use invite token, user clicks to get role | ✓ |

**User's direction:** Asked about "what big companies do" and what creates an exclusive, effortless feel
**Outcome:** Invite-based selected (Linear/Notion/Vercel Teams pattern)

---

## B — Field Editor UX Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Inline click-to-edit | Click field cell → editable input in place | ✓ |
| Slide-over panel per field | Right-side panel with full confidence history | |
| Per-wine modal | Full-screen modal with all 18+ fields | |

**User's choice:** Inline

| Reason enforcement | Description | Selected |
|--------------------|-------------|----------|
| Reason required, citation optional | Always need a reason | |
| Role-based enforcement | Certified need citation, developers don't | |
| Smart enforcement | Required only when overriding confidence ≥ 0.8 field | ✓ |
| Fully optional | No enforcement | |

**User's direction:** Liked "option A" (reason required) but worried about too much work for some. After re-framing question around smart vs. always-required, chose smart enforcement.
**Notes:** "I want to make sure they put comments when needed" — smart enforcement satisfies this without blanket friction

| Column ordering | Description | Selected |
|-----------------|-------------|----------|
| Confidence-first | Lowest confidence floats to top | |
| NULL-first | Empty fields shown first | |
| Fixed column order | Same columns always, spreadsheet feel | ✓ |

---

## C — Route & Ingestion Entry Point

| Option | Description | Selected |
|--------|-------------|----------|
| Separate /dev/onboarding route | Completely new route, new audience | ✓ |
| Extend Onboarding.tsx wizard | Add developer-only step to existing wizard | |
| Add to AdminPanel.tsx | New tab in existing admin area | |

| Ingestion UX | Description | Selected |
|--------------|-------------|----------|
| Three tabs (PDF/URL/Manual) | Tab-based method selection | |
| Step-based wizard | Pick type then configure | |
| Command palette | Single smart bar, auto-detects type | ✓ |

**User's choice:** Command palette. "Feels like magic, zero decision fatigue."

---

## D — Override Promotion Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Always queued for review_admin | No auto-promotion ever | |
| Confidence-delta auto-promote | Auto if improving low-confidence field | |
| Trust-level based | Earn auto-promote rights after track record | ✓ |

**User's direction:** "Liked option C" and raised the idea of a gamification layer (points → rewards → discounts for certified sommeliers). Gamification captured as deferred idea.

| Approval UX | Description | Selected |
|-------------|-------------|----------|
| Dedicated approval queue page | List of pending overrides, one-click approve/reject | ✓ |
| Inline badge on wine record | Yellow badge on field, approve without leaving view | |
| Push notification | In-app notification per pending override | |

| Developer promotion | Description | Selected |
|--------------------|-------------|----------|
| Instant-promote | Developers bypass queue, audit trail still recorded | ✓ |
| Self-approve | Developer confirms own override before write | (initially selected, then revised) |
| Same as certified_contributor | Developers also queue | |

**Notes:** User initially selected self-approve, then asked for Claude's recommendation. Recommendation was instant-promote (internal trusted actors, audit trail preserved regardless, self-approve creates friction for bulk data work). User agreed and switched to instant-promote.

---

## Claude's Discretion

- Exact route name (`/dev/onboarding` vs `/studio`)
- Column order within fixed layout (follow submissions schema)
- Trust-level N threshold default (5)
- Invite token expiry (7 days)

## Deferred Ideas

- Contributor points/rewards/discounts gamification system — future phase candidate
- Push notifications for review_admin when override is queued
- Bulk override approval for high-volume scenarios
