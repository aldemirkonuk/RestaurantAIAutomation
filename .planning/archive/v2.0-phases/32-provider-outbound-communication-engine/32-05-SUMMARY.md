---
phase: 32-provider-outbound-communication-engine
plan: "05"
subsystem: frontend
tags: [react-query, modal, form, draft-email, provider-intelligence]
dependency_graph:
  requires:
    - 32-03  # API endpoints: GET/PATCH /procurement/orders/:id/draft, approve-draft, discard-draft
    - 32-04  # API endpoint: PATCH /providers/:id/intelligence
  provides:
    - useDraftEmailQueries hooks (consumed by Plan 32-07 Orders page wiring)
    - DraftEmailApprovalPanel component (consumed by Plan 32-07)
    - ProviderProfileForm component (consumed by Plan 32-07 Providers page wiring)
  affects:
    - apps/web/src/hooks/queries/
    - apps/web/src/components/orders/
    - apps/web/src/components/providers/
tech_stack:
  added: []
  patterns:
    - TanStack Query mutations with onSettled invalidation
    - AnimatePresence + motion.div (Framer Motion) — copied from OrderApprovalModal
    - sonner toast for success/error feedback
    - Two-column grid layout with col-span-2 for full-width fields
key_files:
  created:
    - apps/web/src/hooks/queries/useDraftEmailQueries.ts
    - apps/web/src/components/orders/DraftEmailApprovalPanel.tsx
    - apps/web/src/components/providers/ProviderProfileForm.tsx
  modified: []
decisions:
  - "Used sonner toast (matching existing BranchProviderTransferModal pattern) rather than custom ToastContext in ProviderProfileForm — consistent with component-level usage convention"
  - "apiClient paths omit /api/v1 prefix (base URL already includes it) — confirmed from BranchProviderTransferModal usage"
  - "ProviderProfileForm invalidates queryKeys.providers.all on successful save so Providers.tsx list refreshes automatically"
metrics:
  duration: "~12 minutes"
  completed_date: "2026-05-14"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 0
---

# Phase 32 Plan 05: Frontend Components — Draft Email Queries, Approval Panel, Provider Profile Form

## One-liner

Three pure-new-file additions: React Query hooks for draft email CRUD, an indigo-themed modal for AI draft review/approval, and a 10-field foundational intelligence profile form.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | useDraftEmailQueries.ts | e50b412 | apps/web/src/hooks/queries/useDraftEmailQueries.ts |
| 2 | DraftEmailApprovalPanel.tsx | 5d8f720 | apps/web/src/components/orders/DraftEmailApprovalPanel.tsx |
| 3 | ProviderProfileForm.tsx | a4b2a1e | apps/web/src/components/providers/ProviderProfileForm.tsx |

## Artifacts

### useDraftEmailQueries.ts

Four exports:
- `useGetPendingDraft(orderId)` — GET `/procurement/orders/:id/draft`
- `useApproveDraft()` — POST `/procurement/orders/:id/approve-draft` with `{ modifiedContent?, managerNotes? }`
- `useDiscardDraft()` — POST `/procurement/orders/:id/discard-draft`
- `useEditDraft()` — PATCH `/procurement/orders/:id/draft` with `{ modifiedContent }`

All mutations invalidate `draftKeys.all` and `queryKeys.orders.all` on settled.

### DraftEmailApprovalPanel.tsx

Props: `{ isOpen, draftData, onApprove, onDiscard, onClose, isSubmitting? }`

Key visual/UX features:
- `bg-indigo-900` header with "✦ AI DRAFT READY" + email type badge — visually distinct from `OrderApprovalModal`'s `bg-black`
- AnimatePresence + motion.div animation (scale + opacity + y) — identical to `OrderApprovalModal`
- `border-2 border-indigo-900` on panel container
- Metadata row (provider, email, wine, round count)
- Draft body: `<pre>` in preview mode, `<textarea>` in edit mode — toggled via `isEditing` state
- "Edit Draft" / "Preview" toggle button (`bg-gray-700`)
- Amber constraint warnings block (`bg-amber-50`, `role="alert"`) — conditional on `constraintWarnings.length > 0`
- Read-only disclaimer block (`aria-label="Non-removable WineOps AI disclaimer"`) — renders `draftData.disclaimer`, non-editable per D-32-08
- 2-column action grid: Send Draft (`bg-green-500`) + Discard (`bg-red-500`)
- Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="draft-panel-title"`, `Escape` key → `onClose()`

### ProviderProfileForm.tsx

Props: `{ providerId, initialValues?, onSaved? }`

10 fields in 2-column grid:
1. `specialty_categories` — text input (col-span-2)
2. `primary_region` — text input
3. `distribution_channel` — select: Distributor / Direct Importer / Broker / Producer
4. `business_type` — select: Large Distributor / Small Portfolio / Boutique Importer / Winery Direct
5. `decision_maker_name` — text input
6. `preferred_communication_style` — select: Formal / Casual / Terse / Detailed
7. `typical_response_days` — number input (min=1, max=14)
8. `net_payment_terms` — select: Net-7 / Net-14 / Net-30 / Net-45 / COD
9. `ships_on_days` — multi-checkbox Mon–Fri (col-span-2)
10. `notes` — textarea maxLength=500 (col-span-2)

Save handler: `PATCH /providers/:id/intelligence` with `{ profile_foundational: formValues }` → invalidates `queryKeys.providers.all` → `toast.success('Intelligence profile saved')`.

All inputs have `htmlFor` labels (10 individual `htmlFor` + checkbox `htmlFor` per day = 15 total).

## Verification Results

```
grep -c "bg-indigo-900" DraftEmailApprovalPanel.tsx    → 2  ✓ (≥2 required)
grep -c "AI DRAFT READY" DraftEmailApprovalPanel.tsx   → 1  ✓
grep -c 'role="dialog"' DraftEmailApprovalPanel.tsx    → 1  ✓
grep -c "Non-removable WineOps" DraftEmailApprovalPanel.tsx → 1  ✓
grep -c "isEditing" DraftEmailApprovalPanel.tsx        → 4  ✓ (≥3 required)
grep -c "bg-amber-50" DraftEmailApprovalPanel.tsx      → 1  ✓
grep -c "useApproveDraft|useDiscardDraft|useEditDraft|useGetPendingDraft" useDraftEmailQueries.ts → 4  ✓
grep -c "profile_foundational" ProviderProfileForm.tsx → 1  ✓
grep -c "htmlFor" ProviderProfileForm.tsx              → 10 ✓ (≥5 required)
npx tsc --noEmit (new files only)                      → 0 errors  ✓
```

## Deviations from Plan

None — plan executed exactly as written.

The only micro-decision was confirming that `apiClient` paths omit the `/api/v1` prefix (since the baseURL in `client.ts` already includes `/api/v1`) — this was verified by reading `BranchProviderTransferModal.tsx` which uses `apiClient.post('/providers', ...)`.

## Threat Surface Scan

No new network endpoints introduced. Components are pure frontend — they call existing Phase 32-03/04 endpoints via React Query hooks. Disclaimer rendered as read-only `<div>` (not textarea), satisfying T-32-05-01. `useApproveDraft` sends `modifiedContent` in payload satisfying T-32-05-02. JWT guard on PATCH endpoint is implemented in Plan 32-04 (T-32-05-03).

## Known Stubs

None — all three components are properly wired to real API endpoints and will function once page-level wiring is added in Plan 32-07.

## Self-Check: PASSED

- [x] `apps/web/src/hooks/queries/useDraftEmailQueries.ts` — exists, 4 exports confirmed
- [x] `apps/web/src/components/orders/DraftEmailApprovalPanel.tsx` — exists, role=dialog confirmed
- [x] `apps/web/src/components/providers/ProviderProfileForm.tsx` — exists, profile_foundational confirmed
- [x] Commits: e50b412, 5d8f720, a4b2a1e — all verified in git log
- [x] TypeScript: 0 errors in new files
- [x] Linter: 0 errors in new files
