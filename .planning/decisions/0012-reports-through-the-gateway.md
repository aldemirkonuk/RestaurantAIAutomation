---
type: adr
id: 0012
title: Generated reports read through the gateway, not the browser
status: proposed
updated: 2026-08-25
links: []
---

# 0012 — The browser stops reading `generated_reports`; the gateway that owns it answers instead

- **Status:** Proposed — resolves [OD-45](OPEN-DECISIONS.md)
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — recorded by a session; not binding until locked
- **Keywords:** RLS, layer inversion, generated_reports, silent failure, reports, Documents page
- **Links:** [OD-45](OPEN-DECISIONS.md), [0013](0013-one-commitment-guardrail.md)

## Context

`apps/web/src/hooks/queries/useReportQueries.ts` queried and deleted rows in
`generated_reports` directly from the browser's anon-key Supabase client, while
`apps/api-gateway/src/reports/reports.service.ts` already owned every other
operation on that table. `supabase/migrations/20260805000000_baseline_from_production.sql:14383`
enables row-level security on the table and no policy is created anywhere in the repo.

**Verified against production** (`SUPABASE_POOLER_URL`, read from `.env` by a script):

| Fact | Value |
|---|---|
| `pg_class.relrowsecurity` for `public.generated_reports` | `true` |
| `pg_class.relforcerowsecurity` | `false` |
| `pg_policy` rows for the table | **0** |
| Grants held by `anon` / `authenticated` | full DML (SELECT/INSERT/UPDATE/DELETE) |
| Rows in the table (service role) | 0 |
| Public tables with RLS on and zero policies | **142** |

RLS enabled with no policy denies every row to any role without `BYPASSRLS` and
returns an empty set with **no error**. The hook's `placeholderData: []` then made
that indistinguishable from a legitimately empty Documents page. The gateway's
client holds the service-role key, which bypasses RLS, so the same data was
reachable the whole time through a path the page did not take.

A third defect surfaced while checking coverage: the hook's `GeneratedReport`
interface declared `format`, `file_url` and a `metadata` object carrying
`title`/`description`/`period`/`sentTo`/`fileSize`/`tags`/`status`. **None of those
columns exist.** The real table has `title`, `summary`, `report_period_start`,
`report_period_end`, `pdf_url`, `excel_url`, `csv_url`, `status`. Every field the
page read through `metadata` was permanently `undefined`, and
`DocumentsPage.tsx:736` (`typeConfig.icon`) would have thrown on the first real row,
because `report_type` values like `inventory_summary` are not keys of
`reportTypeConfig`. The empty table and the RLS denial were jointly hiding a crash.

## Options considered

1. **Add RLS policies to `generated_reports`.** Fixes the silence, keeps the
   inversion, and — given 142 tables in the same state — makes this table a lone
   exception to a de-facto convention where the gateway is the access path. It also
   leaves the invented-column bug and the `typeConfig` crash untouched, because the
   browser would then successfully fetch rows that do not have the shape the page
   expects. Cheapest to write, worst outcome.
2. **Route the browser through the gateway.** Fixes the inversion and the silence
   together, puts the restaurant scope on the JWT rather than on a client-supplied
   id, and turns a silent `[]` into an HTTP error the query can surface.
3. **Do nothing.** The page reports "no reports" forever, and starts throwing the
   day a policy is added or a row appears.

## Decision

**Option 2 — route through the gateway.**

The endpoint-coverage check the fork demanded came back *mostly* yes, with one real
gap and one shape gap, both closed here rather than half-ported:

- `GET /reports` existed and covered the list. ✅
- **Delete did not exist.** The controller had `DELETE /reports/schedules/:id` for
  *scheduled* reports only; there was no delete for a generated report, which is why
  the page had reached past it. Added `ReportsService.deleteReport` +
  `DELETE /reports/:id`, scoped by `restaurant_id` **and** `id` — the client-side
  delete it replaces filtered on `id` alone, so a guessed uuid crossed tenants.
- **The response shape was short.** `ReportResponseDto` did not carry `summary`,
  `report_period_start` or `report_period_end`, which are the real columns behind
  the page's `description` and `period`. Added. The invented `metadata.*` fields are
  gone; `sentTo`, `fileSize` and `tags` have no column and are now empty rather than
  pretending to have a source.

Found and fixed in passing: `@Get("schedules")` was declared *below* `@Get(":id")`,
and Nest registers in declaration order — so `GET /reports/schedules`, which the web
client already calls, was answered by `getReport()` with `reportId = "schedules"`.

## Consequences

- Easier: one owner for the table; a real failure is now an HTTP error, not `[]`.
- Given up: the browser can no longer read reports without the gateway being up.
- Not addressed: **141 other tables remain RLS-on-with-no-policy.** This ADR fixes
  the one path that reads one of them from the browser; it does not decide the
  policy question for the rest. That belongs in its own decision — the finding is
  recorded here so it is not lost.
- Revisit if: a second surface needs direct Postgres reads (mobile offline sync is
  the plausible one), which would force the policy question properly.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | — | Created; RLS state verified against production |
