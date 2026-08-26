---
title: OD-81 scoping — what a report generator costs, and what "no" looks like
status: awaiting founder decision
updated: 2026-08-26
links: ["[[OPEN-DECISIONS]]", "[[0020-no-fabricated-answers]]", "[[OD-77-81-SESSION-PLAN]]", "[[documents-reports]]", "[[reports]]", "[[communications]]"]
---

# OD-81 — is report generation in scope this milestone?

> **Retire-to-write:** this document **supersedes the `## OD-81 — Reports have no
> producer` section** of `.planning/04-specs/OD-77-81-SESSION-PLAN.md`. That
> section was a two-paragraph brief written before anything was verified; three of
> its five factual claims turned out to be wrong (see §1). When OD-81 is decided,
> delete that section and leave the pointer here.

**The founder's call. This document does not pick.** The ADR-0020 half — the
surfaces that were claiming success they did not have — was fixed without waiting
for it, and is described in §4.

---

## 1. Verified state, 2026-08-26, against `origin/main` 443f159d

Every line below was checked. Where the register was wrong, the correction is
marked. Corrections are made **in place** in `OPEN-DECISIONS.md` per the rule
against silent deletion.

| # | Claim in the register | Verdict |
|---|---|---|
| 1 | `POST /reports/generate` is the only writer of `generated_reports` | ✅ **TRUE** |
| 2 | It inserts `status: "pending"` with NULL file urls | ✅ **TRUE**, cited lines drifted (`:42-67` → `:42-71`) |
| 3 | Every `/documents-reports` control hits `alert("No file available")` | ✅ **TRUE** — fixed, §4 |
| 4 | `scheduled_reports` has **zero readers** | ❌ **WRONG twice over** — see below |
| 5 | The weekly email's `topSellers` are hard-coded literals | ❌ **ALREADY FIXED** — see below |

### 1.1 The only writer — confirmed, and it is a writer that cannot finish

`ReportsService.generateReport` (`apps/api-gateway/src/reports/reports.service.ts:42-71`)
inserts `status: "pending"` and never sets `pdf_url` / `excel_url` / `csv_url`.

Searched for any other writer or updater across the **whole** repo — the gateway,
`services/agent-orchestrator` (Python), `services/self-evolution`,
`services/database`, `supabase/migrations`, both `migrations_archive/` folders,
and Supabase edge functions. Results:

- The only other statements against the table are `listReports` (`:73-96`),
  `getReport` (`:98-119`) and `deleteReport` (`:130-145`) — two reads and a delete.
- **There is no `UPDATE` on `generated_reports` anywhere in the repository.** A
  row inserted as `pending` is `pending` forever by construction.
- Python touches it exactly once, read-only:
  `services/agent-orchestrator/api/health_routes.py:165` averages
  `generated_reports.generation_time_ms` for the `business` metrics block. That
  column has no writer either, so the "report generation time" metric is
  structurally incapable of returning a number.
- **There is no `supabase/functions/` directory.** No edge function exists to be
  the missing producer.

**Production shape** (project `Restaurant_Wine_Ops` / `exzueerziesmczwlhomd`, the
only `ACTIVE_HEALTHY` project; confirmed live by 10 `restaurants` and 27
`procurement_conversations`):

```
select count(*) ... from public.generated_reports;
→ total 0 | with_pdf 0 | with_excel 0 | with_csv 0
```

**Zero rows.** Not "rows without files" — no one has ever generated a report at
all, including through the `/communications` "Generate Now" button that *did*
reach the endpoint. That is the demand signal, and §5 weighs how much to read
into it.

Also measured: `generated_reports` has RLS **enabled with zero policies**. The
browser cannot read it under any key; only the service-role gateway can. That is
the safe direction, and it is what OD-45's move of this table behind the gateway
bought. It also means any future download URL must be minted server-side.

### 1.2 `scheduled_reports` — the register was wrong, and the truth is worse

The register says "zero readers". Both halves of that are off:

- **It has readers.** `GET /reports/schedules` → `listSchedules`
  (`reports.service.ts:181-201`) → `apps/web/src/services/api/reports.ts:116` →
  `Communications.tsx` → `ReportScheduler.tsx`, which renders the list. NEW-359
  wired this up after the register entry was written.
- **The table does not exist in production.** `information_schema.tables` returns
  exactly two report tables: `generated_reports` and `manager_report_profiles`.
  `scheduled_reports` is defined **only** in
  `supabase/migrations_archive/20260208024921_baseline_schema.sql:408` and
  `services/database/migrations_archive/008_providers_and_reports.sql:23` — both
  archived, neither applied.

This is exactly the migrations-vs-production divergence the OD-81 brief warned to
check for, and it lands on this feature. The practical consequence: **both**
`POST /reports/schedule` and `GET /reports/schedules` fail 100% of the time in
production. Scheduling was never real — not "built but unexecuted", *absent at
the database*.

There is also no executor: nothing anywhere reads `next_run_at`. `scheduleReport`
(`:151-162`) does not even write that column.

### 1.3 The weekly email's `topSellers` — **already fixed, nothing is being mailed**

This was the highest-priority item in the brief. Answering it explicitly:

**No fabricated figures are going out over email.** The hard-coded top-sellers
table and the flat `$50/bottle` inventory valuation were removed on 2026-08-26 by
commit `39abb348` ("fix: OD-83/84/85/86 — controls that do nothing, and numbers
that were invented", PR #71), as part of closing OD-85.

Current state of `apps/api-gateway/src/communications/scheduled-tasks.service.ts`
(read-only; that file is owned by another workstream and was not touched here):

- `getWeeklyTopSellers` (`:1029-1065`) aggregates real rows from
  `wine_consumption_log`, counting only lines with a non-null `total_revenue` so
  that `sold` and `revenue` describe the same set of sales. It returns `[]` on
  failure and the template omits the section on an empty array.
- `getWeeklyReportData` (`:1078-1144`) returns an all-zero `nothingToReport`
  object on failure, where it previously fell through to a fixture and mailed it.
- `valueInventory` (`:999-1014`) sums real per-unit prices and skips unpriced
  items, understating rather than inventing.
- The only surviving occurrence of the old literals in the file is line 1135, a
  comment recording what was removed.

The brief cited `scheduled-tasks.service.ts:1027-1054` as the fabrication site;
that range now holds the **fix**. Independently corroborated by the resolved
OD-85 entry in `OPEN-DECISIONS.md`.

> Caveat, stated because it is adjacent and unresolved: `wine_consumption_log`
> currently has **0 rows** in production, so the Top Sellers section will be
> absent from the email rather than populated. That is honest behaviour, not a
> defect — but it means the fix has not yet been exercised against real data.

---

## 2. What a real generator actually needs

Scoped, not designed. Four questions, each with a real answer available today.

### 2.1 The render path

Three candidates, in ascending cost:

| Option | Mechanism | Already in the repo? |
|---|---|---|
| **R1 — client-side** | `jspdf` + `jspdf-autotable` + `exceljs` in the browser | **Yes, and already written.** `apps/web/src/lib/exportHelpers.ts` has working `exportToCSV` / `exportToPDF` / `exportToExcel`. All three deps are installed (`apps/web/package.json:43,46,47`). It has **zero importers** — orphaned, not missing. |
| **R2 — server-side, no browser** | `pdf-lib` + `exceljs` in the gateway, drawing from data | **Deps present.** `apps/api-gateway/package.json:48,58`. `pdf-lib` is currently used only to *split* PDFs (`menus/parsers/scan-parser.service.ts`), not to compose them. Composition means hand-laying text and tables — no HTML. |
| **R3 — HTML → PDF** | Headless Chromium (Puppeteer/Playwright) rendering a template | **No.** Not a gateway dependency. Adds ~300MB to the image and a browser process to the Railway container. Buys real layout control and lets the existing email templates be reused. |

The honest framing: **R1 is not a smaller version of R2/R3 — it is a different
feature.** It hands the user a file; it does not create an artifact. It cannot
populate `generated_reports`, cannot email anything, and cannot run on a
schedule, because none of that happens in a browser tab.

### 2.2 Storage

Only needed for R2/R3. Production has **exactly one** Supabase Storage bucket:
`vendor-attachments`. There is **no reports bucket**; one must be created, and
created private — a public bucket makes every report readable by URL to anyone
who guesses it, which given RLS-on-zero-policies on the table would be the only
unauthenticated hole in the whole feature.

### 2.3 Authorising the download

`GET /reports/:id/download` already exists
(`apps/api-gateway/src/reports/reports.controller.ts:103-130`). It scopes by
`restaurantId` from the JWT and returns `{ url }` — today always `null`.

The gap: it returns a **stored** URL. With a private bucket that URL is not
usable, and with a public bucket it is a permanent unguarded link. The correct
shape is for this endpoint to mint a **short-lived signed URL** at request time,
after the tenant check it already performs. That is a change to this handler, not
a new endpoint — a genuinely small piece, but it must not be skipped, and it is
the one place where getting it wrong is a security bug rather than a cosmetic one.

### 2.4 The trigger

- **On-demand** works today: `POST /reports/generate` already creates the row. A
  generator would advance it. Nothing else is needed.
- **Scheduled does not exist and is not close.** It needs, in order: the
  `scheduled_reports` table actually created in production (§1.2); a writer for
  `next_run_at`; a cron that reads it; and — because of **OD-87**, still open —
  that cron must iterate tenants rather than reading `DEFAULT_RESTAURANT_ID`,
  which is how all 9 existing crons work. Scheduled reports are gated behind
  OD-87 whether or not OD-81 is a yes.

### 2.5 Effort

Deliberately coarse; these are shapes, not estimates to be held to.

- **R1, on-demand export only:** small. Generalise the orphaned `exportHelpers`
  beyond its inventory shape, wire it to `/reports`, delete the two `alert(...)`
  "install jspdf" branches that can no longer fire. No migration, no bucket, no
  auth change.
- **R2, on-demand server-side artifacts:** medium. Composition code per report
  type, a private bucket, the signed-URL change to `:id/download`, a status
  advance, and failure handling for a row that renders half-way. This is the
  "render → store → advance status + url" phase the brief describes.
- **R2 + scheduling:** medium plus a blocked dependency. Everything above, plus a
  new migration for `scheduled_reports`, an executor, and OD-87 resolved first.

---

## 3. What a "yes" unblocks

- `/documents-reports` — becomes an archive with contents instead of a folder
  view over an empty table. Its View / Download / Print controls re-enable
  **automatically**: the fix in §4 keys them on `fileUrl` per row rather than a
  hard-coded flag, so a populated `pdf_url` turns them back on with no code change.
- `/reports` — the Generate button can be re-enabled honestly for the first time.
- `/communications` — "Generate Now" becomes truthful; the schedule list becomes
  meaningful **only** if §2.4's scheduled path is also taken.
- `generated_reports.generation_time_ms` — the `business` metrics block in
  `health_routes.py:88,165` starts returning a real number instead of null.
- `scheduled_reports` — unblocked only by the full scheduled path, not by R1 or
  by on-demand R2.

Note the asymmetry: **on-demand generation unblocks three surfaces; scheduling
unblocks one and costs the most.** They do not have to be decided together.

---

## 4. What was fixed already, without waiting for the decision (ADR 0020)

Fabrication is not a feature question. Shipped on `docs/od-81-reports-honesty`:

1. **`/communications` "Generate Now" was lying.** It called
   `POST /reports/generate` and then raised
   `toast.success('Report generated', 'Filed in Documents & Reports.')` with an
   Open action that navigated to a Documents entry containing no file. Two false
   statements plus a control that manufactured unopenable rows.
   `handleGenerateReportNow` was **deleted**, not relabelled; the button is
   disabled and carries the reason.
2. **`/communications` schedule panel described itself** as configuring
   "automatic report generation and delivery", and headed saved rows "Active
   schedules". Nothing runs them. Now stated plainly, and headed "Saved schedules
   (n) · not running".
3. **A failed read was rendering as emptiness.** `refreshSchedules` swallowed the
   error under the comment "listing is additive — a failure shouldn't blank the
   tab" — and blanked the tab anyway, drawing identically to "you have no
   schedules". Given §1.2, that failure is not an edge case: it is the **only**
   path in production. Now surfaced as a distinct state.
4. **`/documents-reports` dead controls.** View / Download / Print could only
   reach `alert("No file available")`. The alerts are gone; the controls are
   disabled with the reason, and a banner states the condition once up front.
   Email and Copy link stay live — both already degrade honestly without a file.
5. **`/reports`** was already honest (ReportGenerator's disabled button and
   "not available yet" banner, from the earlier sweep) and was left untouched.

Nothing was silently removed. Every disabled control states why, so a founder who
wants the feature can still see where it would live.

---

## 5. Recommendation

**Recommend: no full generator this milestone. Take R1 (client-side on-demand
export) as a separate, smaller decision if the founder wants a file in hand now.**

**The one fact that drives it:** `generated_reports` has **0 rows in
production** — and the button that would have created them was live and lying on
`/communications`, not disabled. Nobody has ever tried to generate a report. Every
other surface in this register was found broken *because someone hit it*; this one
has no such evidence behind it.

The honest weakness of that argument, stated rather than buried: the system is
effectively single-tenant today (OD-87 exists precisely because there is one
configured restaurant), so "no demand" is measured against a very small
denominator. It is the best signal available, not a strong one. If the founder
knows of a customer commitment that needs a PDF, that knowledge outranks this
table and the recommendation should flip.

Two further reasons, weaker but pointing the same way:

- **Scheduling is not one decision away.** It needs a table that does not exist,
  an executor that does not exist, and OD-87 resolved first. A "yes" that quietly
  includes scheduled delivery is three times the size it looks.
- **The cheap path is already written and unused.** `exportHelpers.ts` is real,
  working, dependency-complete and has zero importers. If the goal is "the
  manager can get a PDF", R1 reaches it without a bucket, a migration, a cron, or
  a signed-URL security surface.

**What "no" looks like:** exactly what §4 already shipped. The surfaces state that
generation is not built, disable the controls that cannot work, and keep the
templates visible as a preview of intent. Nothing further is needed to hold that
position — this PR is the "no" implementation, and it is safe to leave in place
whichever way the decision goes, because every disable is computed from the data
rather than hard-coded off.
