---
phase: 34-order-communications-hub-procurement-integrity
plan: "04"
subsystem: frontend
tags: [communications, procurement, history, react-query, typescript]
dependency_graph:
  requires:
    - 34-02  # Backend GET /procurement/conversations/history endpoint
  provides:
    - "useProcurementConversationHistory hook in useConversationQueries.ts"
    - "ProcurementSendHistory component with 4-filter bar and thread replay"
    - "'procurement-history' tab on /communications page"
  affects:
    - "apps/web/src/pages/Communications.tsx"
    - "apps/web/src/hooks/queries/useConversationQueries.ts"
tech_stack:
  added:
    - "ProcurementHistoryItem interface (TypeScript)"
    - "procurementHistoryKeys query key namespace"
    - "useProcurementConversationHistory React Query hook"
    - "ProcurementSendHistory inline component"
    - "EMAIL_TYPE_LABELS / OUTCOME_LABELS display maps"
  patterns:
    - "Inline component pattern (no separate file for ProcurementSendHistory)"
    - "React Query useQuery with staleTime: 30s"
    - "Client-side filter with default 30-day date window"
    - "Expand/collapse row toggle via shared expandedRowId state"
key_files:
  created: []
  modified:
    - apps/web/src/hooks/queries/useConversationQueries.ts
    - apps/web/src/pages/Communications.tsx
decisions:
  - "Inline ProcurementSendHistory component inside Communications.tsx — avoids new file for plan scope, consistent with plan instruction"
  - "Client-side filtering with full dataset fetch — pragmatic for current dataset size; backend wine_name ILIKE already available on endpoint for future pass-through"
  - "Default 30-day date window computed at render time using Date.now() — no stored default in state, purely derived"
  - "expandedRowId lifted to Communications component level — enables future cross-tab state sharing"
  - "Mail icon chosen for 'Procurement Emails' tab — matches email semantics, already in import set"
metrics:
  duration: "<5 minutes"
  completed: "2026-05-18"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 2
  lines_added: 273
---

# Phase 34 Plan 04: Procurement Emails Tab — Communications Hub Summary

## One-Liner

`'procurement-history'` 4th tab on /communications with `ProcurementSendHistory` — expandable rows, 4-filter bar (date/provider/type/wine), and full draft thread replay via `useProcurementConversationHistory` → `GET /procurement/conversations/history`.

## What Was Built

### 1. `useProcurementConversationHistory` hook (useConversationQueries.ts)

- New `ProcurementHistoryItem` TypeScript interface matching the 34-02 backend response DTO (17 fields including `draftContent`, `constraintFlags`, `rollingSummary`, `wineName`, `providerName`)
- `procurementHistoryKeys` query key namespace `['procurement', 'history']`
- `useProcurementConversationHistory()` hook using `useQuery` with 30s staleTime, fetching from `/procurement/conversations/history` via the authenticated `api` axios instance

### 2. `ProcurementSendHistory` inline component (Communications.tsx)

- **4-filter bar** (per D-03): date-from (default last 30 days), provider (free-text ILIKE), email type (select: PRICE_INQUIRY / DEMAND_OFFER / PROMO_INQUIRY / WINE_INQUIRY), wine name (free-text ILIKE)
- **Result count** badge in filter bar
- **Expandable rows**: each row shows wine name, provider, email type badge (indigo pill), date sent, outcome badge (emerald for APPROVED/AUTO_SENT, gray for others)
- **Thread replay panel** (expanded): order number, quantity, round count, sent timestamp; full draft body in monospaced pre block; WineOps AI disclaimer (split on `\n\n—\n`); constraint notes (annotating flags in amber); rolling summary block

### 3. `'procurement-history'` tab in Communications page

- Added as 4th tab to the existing tab nav array (Templates / Send History / Scheduled Reports / **Procurement Emails**)
- Uses `Mail` icon (already imported)
- Passes all filter state down to `ProcurementSendHistory` via props
- `expandedRowId` toggle: clicking same row collapses; clicking different row expands new one

## Threat Mitigation Verification

| Threat ID | Status | Notes |
|-----------|--------|-------|
| T-34-04-01 | Accepted | Draft content visible to authenticated users of /communications — consistent with existing auth model |
| T-34-04-02 | Accepted | Date filter is UX convenience; no security boundary |
| T-34-04-03 | **Mitigated** | Tab key is `'procurement-history'` — confirmed distinct from `'history'`. Done criteria verified: `grep -c "'history'" Communications.tsx` → 3 (existing tab preserved) |

## Done Criteria Results

| Criterion | Expected | Actual | Status |
|-----------|----------|--------|--------|
| `grep -c "procurement-history" Communications.tsx` | ≥ 2 | 3 | ✅ |
| `grep -c "useProcurementConversationHistory" useConversationQueries.ts` | ≥ 1 | 1 | ✅ |
| `grep -c "ProcurementSendHistory" Communications.tsx` | ≥ 2 | 4 | ✅ |
| `grep -c "'history'" Communications.tsx` | ≥ 1 | 3 | ✅ |
| `grep -cE "wine_name\|wineFilter\|wineName" Communications.tsx` | ≥ 3 | 7 | ✅ |
| TypeScript errors in modified files | 0 | 0 | ✅ |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The tab fetches real data from the 34-02 backend endpoint. Empty state ("No procurement emails in this period.") renders gracefully when no data is available.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary surfaces introduced by this plan. The tab is a read-only consumer of the 34-02 endpoint (already in plan threat model).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `92f12c9` | `feat(34-04): add Procurement Emails tab to Communications hub` |

## Self-Check: PASSED

- `apps/web/src/pages/Communications.tsx` — FOUND (modified, staged, committed)
- `apps/web/src/hooks/queries/useConversationQueries.ts` — FOUND (modified, staged, committed)
- Commit `92f12c9` — FOUND in `git log`
- TypeScript errors in modified files — 0
