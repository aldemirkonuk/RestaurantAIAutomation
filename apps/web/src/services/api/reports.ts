import { apiClient } from './client'

/**
 * Reports API client.
 *
 * The Scheduled Reports UI shipped wired to `console.log` even though
 * POST /reports/schedule, GET /reports/schedules, DELETE /reports/schedules/:id
 * and POST /reports/generate already existed server-side. This client closes
 * that gap (UX paths NEW-359 / NEW-360).
 *
 * [2026-09-17, OD-81] POST /reports/generate is retired (410) and its client
 * call is gone: it filed a pending row nothing ever wrote. The real writer is
 * the report export at the bottom of this file.
 *
 * `restaurantId` is taken from the authenticated user server-side, so it is
 * deliberately absent from these payloads.
 */

/** Mirrors ReportType in apps/api-gateway/src/reports/dto/reports.dto.ts. */
export type ReportType =
  | 'inventory_summary'
  | 'sales_analysis'
  | 'procurement_history'
  | 'financial_summary'
  | 'compliance_report'

/** Mirrors ReportFormat. Note the backend has no 'sheets'/'drive' formats. */
export type ReportFormat = 'pdf' | 'excel' | 'csv'

export interface ScheduleReportPayload {
  reportType: ReportType
  title: string
  parameters?: Record<string, unknown>
  frequency: string
  dayOfWeek?: number
  dayOfMonth?: number
  timeOfDay?: string
  recipients?: string[]
}

export interface ScheduledReport {
  id: string
  reportType: string
  title: string
  frequency: string
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  timeOfDay?: string | null
  recipients?: string[] | null
  nextRunAt?: string | null
  createdAt?: string
}

/**
 * Mirrors ReportResponseDto in apps/api-gateway/src/reports/dto/reports.dto.ts,
 * which in turn mirrors the real `generated_reports` columns.
 *
 * OD-45: the previous browser-side shape had `format`, `file_url` and a `metadata`
 * object holding title/description/period/sentTo/fileSize/tags/status. None of
 * those columns exist on the table — every one of them read as undefined. The
 * fields below are the actual ones; `summary`, `periodStart` and `periodEnd`
 * replace the invented `metadata.description` and `metadata.period`.
 */
export interface GeneratedReport {
  id: string
  restaurantId: string
  title: string
  reportType: string
  status: string
  pdfUrl?: string | null
  excelUrl?: string | null
  csvUrl?: string | null
  summary?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  createdAt?: string
}

export interface ReportListResponse {
  reports: GeneratedReport[]
  /** Null when the gateway could not count. Never the page length — see below. */
  total: number | null
}

/**
 * The server's own page bound (`reports.service.ts:95`, `Math.min(200, … ?? 100)`).
 *
 * ADR 0086 capped this read, which until then returned the whole table. A cap
 * a caller does not know about is a window it will render as a total, so the
 * number is declared here and sent explicitly rather than inherited from the
 * server default: a list that comes back at this length is a FLOOR, and the
 * page that renders it has to say so.
 */
export const REPORTS_PAGE_LIMIT = 100

/**
 * GET /reports — replaces a direct `supabase.from('generated_reports')` read.
 *
 * The table has RLS enabled and zero policies, so the anon-key client the browser
 * uses got `[]` back with no error: the page looked empty rather than broken. The
 * gateway holds the service-role key and scopes by the restaurant on the JWT.
 */
export async function listReports(): Promise<GeneratedReport[]> {
  const { data } = await apiClient.get<ReportListResponse>('/reports', {
    params: { limit: REPORTS_PAGE_LIMIT },
  })
  return Array.isArray(data?.reports) ? data.reports : []
}

/**
 * Same endpoint, with the gateway's `count: "exact"` total kept instead of
 * thrown away — a register count must be the count, not an array length.
 *
 * `limit` bounds the ROWS, never the total: the gateway counts over the whole
 * filtered set, so a caller that renders twenty rows can ask for a page and
 * still print the real figure beside it.
 */
export async function listReportsWithTotal(
  opts: { limit?: number; offset?: number } = {},
): Promise<{
  reports: GeneratedReport[]
  total: number | null
}> {
  const { data } = await apiClient.get<ReportListResponse>('/reports', {
    params: { limit: opts.limit, offset: opts.offset },
  })
  const reports = Array.isArray(data?.reports) ? data.reports : []
  // `reports.length` is NOT a fallback for the total. Since ADR 0086 bounded the
  // query, using it would report the page size as the count — the window-as-total
  // fault this function's own docblock exists to prevent. Unknown stays unknown.
  return { reports, total: typeof data?.total === 'number' ? data.total : null }
}

export const REPORT_TYPES: readonly ReportType[] = [
  'inventory_summary',
  'sales_analysis',
  'procurement_history',
  'financial_summary',
  'compliance_report',
]

export interface ReportCrossFileRegister {
  count: number
  sample?: string | null
}

/** Null paper/conversations = the report names no period; nothing is invented. */
export interface ReportCrossFile {
  periodStart: string | null
  periodEnd: string | null
  paper: ReportCrossFileRegister | null
  conversations: ReportCrossFileRegister | null
}

/** "Cross-filed under" — the other registers holding this report's period. */
export async function getReportCrossFile(id: string): Promise<ReportCrossFile> {
  const { data } = await apiClient.get<ReportCrossFile>(`/reports/${id}/cross-file`)
  return {
    periodStart: data?.periodStart ?? null,
    periodEnd: data?.periodEnd ?? null,
    paper: data?.paper ?? null,
    conversations: data?.conversations ?? null,
  }
}

/** "File to…" — re-file a report under a different type. */
export async function refileReport(
  id: string,
  reportType: ReportType,
): Promise<GeneratedReport> {
  const { data } = await apiClient.patch<GeneratedReport>(`/reports/${id}`, { reportType })
  return data
}

export async function deleteReport(id: string): Promise<void> {
  await apiClient.delete(`/reports/${id}`)
}

export async function scheduleReport(payload: ScheduleReportPayload): Promise<ScheduledReport> {
  const { data } = await apiClient.post<ScheduledReport>('/reports/schedule', payload)
  return data
}

export async function listReportSchedules(): Promise<ScheduledReport[]> {
  const { data } = await apiClient.get<ScheduledReport[]>('/reports/schedules')
  return Array.isArray(data) ? data : []
}

export async function deleteReportSchedule(id: string): Promise<void> {
  await apiClient.delete(`/reports/schedules/${id}`)
}

/* ───────────────────────────────────────────── report exports (OD-81) ──── */

/**
 * `POST /reports/generate` is retired (410): it filed a `generated_reports` row
 * marked pending that nothing ever wrote. A report now is an EXPORT — one
 * cutting of the /reports sheet, written by the gateway to a CSV and a
 * print-ready page and stored with an honest status
 * (`apps/api-gateway/src/reports/exports/`, ADR 0149 row 20).
 *
 * Mirrors ReportExportResponseDto in
 * apps/api-gateway/src/reports/dto/report-exports.dto.ts key for key;
 * `scripts/check_web_reads_gateway_dto_keys.py` fails the build on a key the
 * gateway does not send.
 */
export type ReportExportStatus = 'queued' | 'ready' | 'failed'
export type ReportExportFormat = 'csv' | 'html'

export interface ReportExport {
  id: string
  cutting: string
  title: string
  windowLabel: string
  windowDays: number | null
  status: ReportExportStatus
  /** Present exactly when status is failed. */
  failureReason: string | null
  /** Figures written as withheld rather than as a number. Null until written. */
  withheldCount: number | null
  csvBytes: number | null
  htmlBytes: number | null
  attempts: number
  requestedAt: string
  startedAt: string
  finishedAt: string | null
}

export interface ReportExportList {
  exports: ReportExport[]
  /** The exact count, or null when the gateway could not count — never the page length. */
  total: number | null
}

/** The server's default page, and the shelf's page size (`report-exports.service.ts` listExports). */
export const REPORT_EXPORTS_PAGE_LIMIT = 20

/**
 * `offset` pages past the newest `limit`: page 2 of 20 is `{ limit: 20, offset: 20 }`.
 * `total` is the exact count over the whole house — never the page length — so a
 * caller on page 3 can still tell how many pages there are in total.
 */
export async function listReportExports(
  opts: { limit?: number; offset?: number } = {},
): Promise<ReportExportList> {
  const { data } = await apiClient.get<ReportExportList>('/reports/exports', {
    params: { limit: opts.limit ?? REPORT_EXPORTS_PAGE_LIMIT, offset: opts.offset ?? 0 },
  })
  if (!data || !Array.isArray(data.exports))
    // A 200 without the list is not "no exports": say the answer was unreadable.
    throw new Error('the gateway answered without a list of exports')
  return { exports: data.exports, total: typeof data.total === 'number' ? data.total : null }
}

/** `days` only for the till — the one cutting whose window the reader picks. */
export async function requestReportExport(input: { cutting: string; days?: number }): Promise<ReportExport> {
  const { data } = await apiClient.post<ReportExport>('/reports/exports', input)
  return data
}

export async function retryReportExport(id: string): Promise<ReportExport> {
  const { data } = await apiClient.post<ReportExport>(`/reports/exports/${id}/retry`)
  return data
}

/**
 * The written file's text. Fetched through `apiClient` because the route needs
 * the bearer token a plain link would not carry; the caller hands it to the
 * reader as a file. The filename is built here, from the row, rather than read
 * from `Content-Disposition`, which a cross-origin response does not expose.
 */
export async function downloadReportExport(
  exp: Pick<ReportExport, 'id' | 'cutting' | 'finishedAt'>,
  format: ReportExportFormat,
): Promise<{ filename: string; mime: string; body: string }> {
  const { data } = await apiClient.get<string>(`/reports/exports/${exp.id}/download`, {
    params: { format },
    responseType: 'text',
    // The body is the file, not JSON: never let the client try to parse it.
    transformResponse: [(raw: unknown) => raw],
  })
  if (typeof data !== 'string') throw new Error('the gateway answered without the file')
  const day = exp.finishedAt ? exp.finishedAt.slice(0, 10) : 'undated'
  return {
    filename: `mudavym-${exp.cutting}-${day}.${format}`,
    mime: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8',
    body: data,
  }
}
