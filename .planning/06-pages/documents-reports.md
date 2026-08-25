---
type: page
route: /documents-reports
slug: documents-reports
component: apps/web/src/pages/DocumentsPage.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]"]
---

# /documents-reports — Documents & Reports

## Surface — buttons → where they go

- **Reports / Communication History tabs** → (on this page)
- **View / Print** → opens `report.fileUrl` (preview / new tab for print)
- **Download** → opens `report.fileUrl` in a new tab
- **Email** → external `mailto:` compose with the report link
- **Copy link** → clipboard (`fileUrl` or `/documents-reports?doc=:id`)
- **Delete / batch delete** → API delete-report mutation
- (no outbound navigation — dead-end page)

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

## 10. Maturity

**hollow.**

This is a document archive in which no document has a file. Every row it lists
comes from `generated_reports`, and the only writer of that table inserts
`status:"pending"` with `pdf_url`/`excel_url`/`csv_url` NULL
(`apps/api-gateway/src/reports/reports.service.ts:42-67`); nothing in the repo ever
completes a row or attaches a file (grep for the table name returns this service and
migrations only). `mapGeneratedReportToUi` therefore always produces
`fileUrl: undefined` (`DocumentsPage.tsx:100-113`), which means **every** action on
the Reports tab takes its failure branch:

| Button | Line | What actually happens |
|---|---|---|
| View | `DocumentsPage.tsx:332-335` | `alert("No file available to preview for …")` |
| Download | `:317-323` | `alert("No file available for …")` |
| Print | `:357-366` | `alert("No file available to print for …")` |
| Email | `:339-352` | `mailto:` body reads "(No file attached yet.)" |
| Copy link | `:367-369` | Falls back to `…/documents-reports?doc=<id>` — **a link this page never reads.** No `useSearchParams`, no `doc` param handler anywhere in the 1,012-line file (verified by grep) |
| Delete / batch delete | `:325-329`, `:404-411` | Real — `DELETE /reports/:id`, scoped by `restaurant_id` |

Two further fabrications: the Communication-History tab badge is fed by `commStats`,
which hardcodes `emailCount: 0, smsCount: 0` and renders `commStats.total` — the
count of **reports**, not messages (`:234-236`, rendered `:467`). And `sentTo`,
`fileSize` and `tags` are deliberately left empty because no column backs them
(`:94-113`) — that part is honest, and is the OD-45 correction.

**§3 and §4 above are stale.** The page is 1,012 lines, not 962, and it no longer
talks to Supabase directly: OD-45 routed reads and deletes through the gateway
(`hooks/queries/useReportQueries.ts:10-46`), because the table has RLS on with zero
policies and the anon-key client silently returned `[]`. §11 below is the current
shape.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/reports` | JWT (class, `reports.controller.ts:27`) | `:48-63` | `{reports[], total}` — restaurant from the JWT, not the client |
| DELETE | `/reports/:id` | JWT | `:168-186` | 204; scoped by `restaurant_id` **and** `id` (OD-45) |
| GET | `/conversations/threads`, `/thread/:id`, `/stats/overview` | JWT (class, `conversations.controller.ts:48`) | `:145`, `:216`, `:308` | Thread list / messages / sentiment counts |
| POST | `/conversations/:id/summarize` | JWT | `:291-304` | `{success:true}` — the event it publishes has no subscriber (see communications.md §10) |

Unused by this page but present on the controller: `GET /reports/:id/download`
(`reports.controller.ts:103-130`) returns `{url: null}` for every report, for the
same reason.

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Report rows | `POST /reports/generate` from `/communications` only (`Communications.tsx:305`) | Rows: yes. Files: **no producer exists** |
| Report files | **none** | — |
| Conversation history | Gmail push → `email.inbound.received` → `rabbitmq-bridge.service.ts:528` → `procurement_conversations`; sentiment/intent from `inbound-responder.service.ts:300,520` | Yes (live Gmail watch, OD-78) |
| Realtime toasts | `useReportSubscription` / `useCalendarEventsSubscription` (`DocumentsPage.tsx:157-187`) | Yes — but they only announce the same empty rows |

### Writes

| Write | Downstream reaction |
|---|---|
| Report delete (optimistic, `useReportQueries.ts:52-76`) | Cache rollback on error; no notification, no audit row |
| Nothing else — the page has no create path | — |

## 12. Design intent

**Should be:** the archive where anything the system produced on the owner's behalf
is findable months later — reports, invoices, receipts, vendor correspondence.

| State | Handled? | Evidence |
|---|---|---|
| Loading | **No** | `useGeneratedReports()` destructures only `data` with `= []` (`DocumentsPage.tsx:153`) — a slow fetch is indistinguishable from an empty archive |
| Empty | Partial | Folder tree renders with no years; no explanatory empty state |
| Error | **No** | `error` is never destructured; a 500 renders as an empty archive |
| Permission-denied | **No** | No 403 branch |

**Where the UI misleads**

1. A folder tree, grid/list toggle, filters, batch-select and six per-document
   actions, over rows that can never carry a document.
2. Copy link produces `?doc=<id>`, a URL that resolves to the unfiltered page.
3. The Communication-History badge shows the report count while the tab shows
   conversations.
4. `useReportQueries.ts:23-24` names the exact trap this page fell into once
   already — `placeholderData: []` making a failure look like an empty state — and
   the reports list still has no loading or error branch.

## 13. Roadmap

1. **Report rendering, or retire the archive tab.** Blocked on the same founder
   decision as communications.md item 1: nothing defines what a report artifact is.
2. **Read `?doc=`** (`DocumentsPage.tsx:368` produces it) — select and open that
   report on mount. Two lines; makes the existing share link mean something.
3. **Loading + error branches** on the reports query — the file's own comment
   explains why this matters.
4. **Fix or drop `commStats`** (`:234-236`) — a real message count or no badge.
5. **Decide the `/communications` overlap.** `ClassifiedConversationList` is mounted
   on both pages; retire-to-write (CLAUDE.md §4) requires naming one. No ADR exists.
6. Add procurement documents (`/receipts`) to this archive, or state that receipts
   are deliberately a separate surface — today "Invoices, receipts, and generated
   report history" (`Sidebar.tsx:128`) promises all three and delivers one.
