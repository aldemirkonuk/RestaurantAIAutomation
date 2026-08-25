---
type: page
route: /communications
slug: communications
component: apps/web/src/pages/Communications.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 3
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[documents-reports]]"]
---

# /communications — Communications

## Surface — buttons → where they go

- **Templates / Send History / Scheduled Reports / Procurement Emails tabs** → (on this page)
- **New Email / SMS template** → (builder on this page)
- **Generate report now** → API `POST /reports/generate`; success toast's **Open** → [[documents-reports]] `/documents-reports`
- **Delete schedule** → API (report-schedule delete)

## 1. Purpose

"Vendor email threads, classified and ready to reply" (`Sidebar.tsx:122`). Four tabs
(`Communications.tsx:258,384`): **Templates** (Gmail + SMS builders with saved
templates), **Send History** (classified vendor conversation threads), **Scheduled
Reports** (recurring report delivery), and **Procurement History** (Phase 34
outbound-email audit trail, labelled by `outbound_email_type`).

## 2. Entry

- Sidebar (`components/layout/Sidebar.tsx:120`); command palette
  (`components/command/commands.ts:81`).
- [PAGE_MAP](../foundation/PAGE_MAP.md):113 lists it as no-inbound — the scan missed
  layout components; the sidebar is the real entry.

## 3. Files

- Route binding: `apps/web/src/App.tsx:279` (lazy import :95).
- `apps/web/src/pages/Communications.tsx` (562 lines).
- Rendered: `components/documents/{GmailTemplateBuilder, SMSTemplateBuilder, SavedTemplates, SavedSMSTemplates}.tsx`, `components/communications/{ReportScheduler, ClassifiedConversationList}.tsx` (Communications.tsx:13-31; mounts :506,513,544,553).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):495 (`reports`), :180
(`conversations`), :389 (`procurement`).

| Method | Path | Call site |
|---|---|---|
| POST | `/reports/generate` | `Communications.tsx:305` → `services/api/reports.ts:69` |
| POST | `/reports/schedule` | `Communications.tsx:277` → `reports.ts:74` |
| GET | `/reports/schedules` | `Communications.tsx:265` → `reports.ts:79` |
| DELETE | `/reports/schedules/:id` | `Communications.tsx:325` → `reports.ts:84` |
| GET | `/conversations/threads`, `/conversations/thread/:id`, `/conversations/stats/overview` | `ClassifiedConversationList` → `hooks/queries/useConversationQueries.ts:194,209,225` |
| POST | `/conversations/:id/summarize` | `useRegenerateSummary` → `useConversationQueries.ts:240` |
| GET | `/procurement/conversations/history` | `useProcurementConversationHistory` (Communications.tsx:28) → `useConversationQueries.ts:284` |

Note: the conversation hooks use their **own axios instance** against
`VITE_API_GATEWAY_URL` (`useConversationQueries.ts:4-7`), not the shared `apiClient`.

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** with Plus content: templates and scheduled sends are operate; the
classified-thread view and drafted credit emails are the S02/S03 **Plus**
"understand" rows ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39). Inbound
classification behind it shipped as Phase 0 (memory: inbound-email-intelligence-plan).

## 7. Rebrand surface

**3 user-visible strings** — the email template preview header/footer renders
"WineOps AI": `components/documents/GmailTemplateBuilder.tsx:1349,1417,1464`
(mounted from this page, `Communications.tsx:544`). Page file itself: 0. Layout
chrome per dashboard.md §7.

## 8. State & config

- Channel filter (all/email/SMS) is page state (`Communications.tsx:237`).
- Procurement-history labels depend on `outbound_email_type` staying in sync with the
  DB CHECK constraint (memory: procurement-conversations-schema-gotchas).

## 9. Gaps

- **Scheduled report *sending* is feature-flagged off server-side** — "no mailer —
  scheduled send is feature-flagged" ([TIER-MAP](../03-scenarios/TIER-MAP.md):51, S15
  Plus). The scheduler UI here creates schedules a mailer never executes.
- Saved templates persist client-side through the builder components rather than a
  server store — check before promising cross-device templates (no debt-register
  entry; observed from the component tree).
