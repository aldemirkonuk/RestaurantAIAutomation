---
type: page
route: /documents-reports
slug: documents-reports
component: apps/web/src/pages/DocumentsPage.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /documents-reports — Documents & Reports

## 1. Purpose

"Invoices, receipts, and generated report history" (`Sidebar.tsx:128`). Two tabs
(`DocumentsPage.tsx:99`): **reports** — the generated-report archive (view, copy
deep link, delete), live-updating as new reports land; **history** — the classified
vendor conversation list shared with `/communications`.

## 2. Entry

- Sidebar "Documents & Reports" (`components/layout/Sidebar.tsx:126`); command
  palette (`components/command/commands.ts:82`).
- Toast deep link after generating a report on `/communications`
  (`pages/Communications.tsx:315`).
- Self-produced share links `…/documents-reports?doc=:id` (`DocumentsPage.tsx:318`).
- [PAGE_MAP](../foundation/PAGE_MAP.md):116 lists it as no-inbound — scan missed the
  sidebar and the toast link.

## 3. Files

- Route binding: `apps/web/src/App.tsx:280` (lazy import :96).
- `apps/web/src/pages/DocumentsPage.tsx` (962 lines).
- Shared render: `components/communications/ClassifiedConversationList.tsx`
  (mounted :452).

## 4. Endpoints

Atlas row for conversations: [ENDPOINTS](../foundation/ENDPOINTS.md):180. The report
archive itself does **not** go through the api-gateway:

| Source | Operation | Call site |
|---|---|---|
| Supabase direct | `generated_reports` select (per restaurant, newest first) | `hooks/queries/useReportQueries.ts:26` (used DocumentsPage.tsx:103) |
| Supabase direct | `generated_reports` delete | `useReportQueries.ts:37` (DocumentsPage.tsx:104) |
| Gateway | `/conversations/threads` + `/thread/:id` + `/stats/overview`, POST `/:id/summarize` | ClassifiedConversationList → `hooks/queries/useConversationQueries.ts:194-240` |

Realtime: `useReportSubscription` pushes `generated` report events into the list
(`DocumentsPage.tsx:31,125`).

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** — the archive half of S15 (owner opens the weekly digest); the digest
itself computes at Plus and its scheduled send is flagged off
([TIER-MAP](../03-scenarios/TIER-MAP.md):51).

## 7. Rebrand surface

**0 user-visible strings** in the page file (no `wineops` hits). Report *contents*
may carry the WineOps title given them at generation time
(`pages/Reports.tsx:531`) — that debt is counted on reports.md. Layout chrome per
dashboard.md §7.

## 8. State & config

- Browser talks to Supabase directly for this table (`lib/supabase` client,
  `useReportQueries.ts:3`) — RLS posture matters here more than gateway guards;
  per-tenant RLS on authed clients is a decided deferral (`v3.0-TECH-DEBT.md:450`).
- `?doc=:id` deep-link param produced (:318); no flags or env gates.

## 9. Gaps

- The two tabs duplicate `/communications` content (ClassifiedConversationList is
  mounted on both) — one of the split/merge candidates the retire-to-write rule
  exists for (CLAUDE.md §4); no decision recorded either way.
- Direct-Supabase delete with deferred RLS (§8) means authorization for report
  deletion rests on the anon-key policy set — worth a verification pass, not
  asserted broken (no debt-register entry).
