# Phase 13: Dev Onboarding UI with Manual Override Access — Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a role-gated data authoring surface at a completely separate route (`/dev/onboarding` or `/studio`) where developers and certified contributors can ingest wine records through the existing pipeline (PDF upload, crawler URL, or manual entry), review extracted/enriched output with per-field confidence and source attribution, and manually override individual field values with full auditability before promoting records into production dataset tables.

This phase does NOT touch the existing `Onboarding.tsx` restaurant setup wizard. Different audience, different purpose.

</domain>

<decisions>
## Implementation Decisions

### A — Role & Auth Architecture

- **D-01:** Use Supabase RLS + `user_roles` junction table (not extending the existing `owner/manager/staff` enum). A user can hold multiple roles simultaneously (e.g., both `manager` and `certified_contributor`). DB-level enforcement — no API can bypass it.
- **D-02:** Three new roles: `developer`, `certified_contributor`, `review_admin`.
- **D-03:** Role granting is **invite-based** — `review_admin` generates a single-use invite token with expiry. User clicks link → role granted automatically. Creates exclusivity and is effortless for recipients (Linear/Notion/Vercel Teams pattern).
- **D-04:** No self-service role escalation. Users cannot grant themselves roles.

### B — Field Editor UX Pattern

- **D-05:** **Inline click-to-edit** — clicking any field cell in the wine record table makes it an editable input in place. Spreadsheet-like feel. No slide-over panels or modals.
- **D-06:** **Fixed column order** for the review table — wine_name, vintage, producer, region, country, grape_variety, color, primary_type, sweetness_level, price_bottle, price_glass, vintage_score, ... Always same columns, predictable and scannable.
- **D-07:** **Smart reason enforcement** — reason field is required ONLY when overriding a field that already has confidence ≥ 0.8. Filling a NULL field? No reason needed. Overriding a high-confidence value? Must provide a short justification. Citation URL is always optional.
- **D-08:** Reason input appears inline below the edited field (not a modal). Short placeholder text guides users: "e.g. confirmed on producer website, verified from label photo".

### C — Route & Ingestion Entry Point

- **D-09:** **Completely separate route** — `/dev/onboarding` (or `/studio`). Not an extension of the existing `Onboarding.tsx` wizard. Not inside `AdminPanel.tsx`. A purpose-built data authoring screen.
- **D-10:** **Command-palette style ingestion** — a single smart input bar at the top of the screen. User pastes a URL or drags-drops a PDF. System auto-detects the type and routes accordingly (URL → crawler, PDF → Vision extraction, manual field input → seed record). Zero decision fatigue.
- **D-11:** The screen has two primary sections: (1) ingestion trigger at top, (2) wine records table below showing the session results with inline editing.

### D — Override Promotion Policy

- **D-12:** **Trust-level based promotion** for certified contributors:
  - New certified_contributor → overrides go to review_admin approval queue
  - After N consecutive approved overrides (default N=5, configurable) → auto-promote status earned, future overrides bypass queue
- **D-13:** **Instant-promote for developers and review_admins** — internal trusted actors. Full audit trail still recorded to `field_corrections` regardless. No queue friction.
- **D-14:** **Approval queue page for review_admins** — a dedicated list of pending overrides showing: wine name, field name, old value → new value, actor, reason, citation, timestamp. One-click approve or reject with optional rejection note.
- **D-15:** All overrides (instant or queued) are recorded to `field_corrections` (or `override_events`) with: actor_id, old_value, new_value, reason, citation_url, citation_snippet, timestamp, promotion_status, approved_by.

### Claude's Discretion

- Exact route name (`/dev/onboarding` vs `/studio` vs `/data/authoring`) — choose the clearest name
- Exact column order within the fixed field layout — follow the `master_wine_library_submissions` schema field order
- Trust-level N threshold UI — configurable in settings, default 5
- Exact invite token expiry duration — 7 days is standard

### Deferred Ideas (noted, not in scope)

- **Contributor points/rewards system** — user suggested: many correct overrides → points → unlock rewards, discounts, exclusive deals for certified sommeliers/producers. Excellent idea for a future gamification phase. Record as backlog item.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backend — existing tables and patterns this phase builds on
- `supabase/migrations/20260404000002_field_corrections.sql` — existing field_corrections table schema (audit trail foundation)
- `supabase/migrations/20260405000000_field_confidence.sql` — field confidence model Phase 7 created
- `supabase/migrations/20260405000001_field_review_queue.sql` — existing field_review_queue schema
- `services/agent-orchestrator/api/research_routes.py` — verify_admin_token pattern (auth header approach)
- `services/agent-orchestrator/api/onboarding_routes.py` — existing onboarding API endpoints (PDF extract trigger)

### Frontend — existing patterns to reuse
- `apps/web/src/contexts/AuthContext.tsx` — existing auth context with role field (extend for new roles)
- `apps/web/src/pages/Onboarding.tsx` — do NOT modify this file; reference only for wizard pattern context
- `apps/web/src/components/ui/` — existing UI primitives: button, card, badge, input, form, empty-state, loading-skeleton
- `apps/web/src/components/ProtectedRoute.tsx` — existing role-gate pattern to extend for new roles

### No external specs — requirements fully captured in decisions above

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/src/components/ui/badge.tsx` — use for confidence level badges (red/amber/green)
- `apps/web/src/components/ui/card.tsx` — wine record cards / session container
- `apps/web/src/components/ui/button.tsx` — approve/reject/submit buttons
- `apps/web/src/components/ui/input.tsx` — inline edit fields, reason input
- `apps/web/src/components/ui/empty-state.tsx` — empty session state
- `apps/web/src/components/ui/loading-skeleton.tsx` — extraction in-progress state
- `apps/web/src/components/ProtectedRoute.tsx` — already handles role-based route gating; extend for developer/certified_contributor/review_admin roles
- `framer-motion` — already installed; use for smooth inline edit transitions and queue animations

### Established Patterns
- React + Vite + TypeScript + Tailwind — all established
- Radix UI primitives already in use (Dialog, DropdownMenu, Select, Switch, Tabs, Tooltip)
- react-hook-form for all form submissions (already installed)
- `useRestaurantSettingsStore` (Zustand) — pattern for local state; create `useOnboardingSessionStore` similarly
- Lucide-react icons — already used extensively, keep consistent
- Axios via AuthContext API client — use for all backend calls

### Integration Points
- `/api/v1/onboarding/extract` (POST) — existing PDF extraction endpoint to trigger from the new UI
- `/api/v1/research/trigger` (POST) — existing research trigger from Phase 12
- New endpoints needed: session CRUD, field override submission, override approval, invite token generation/redemption, trust-level promotion
- Supabase `user_roles` table (new), `onboarding_sessions` table (new), `override_events` table (new or extend field_corrections)

</code_context>

<specifics>
## Specific Ideas

- Command-palette ingestion bar: the user was excited about the "feels like magic" UX — make it feel premium. Single bar, auto-detect, instant routing.
- Exclusivity framing for certified contributors: invite flow, not sign-up flow. The distinction matters psychologically.
- Trust-level progression should be visible to the contributor — show them "4/5 approvals toward auto-promote status" so they know progress is being tracked.
- Deferred gamification: contributor points, rewards, discounts for certified sommeliers — this is a compelling future phase (Phase 14 candidate).

</specifics>

<deferred>
## Deferred Ideas

- **Contributor gamification layer** — points system, override acceptance rate score, rewards/discounts for certified sommeliers/producers. Excellent future phase, not in scope for Phase 13.
- **Push notifications for review_admin** — in-app notification when override is queued. Would complement the approval queue page. Future enhancement.
- **Bulk override approval** — select multiple pending overrides and approve all at once. Useful at scale but not needed for MVP.

</deferred>

---

*Phase: 13-dev-onboarding-ui-with-manual-override-access*
*Context gathered: 2026-04-07*
