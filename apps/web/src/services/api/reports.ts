import { apiClient } from './client'

/**
 * Reports API client.
 *
 * The Scheduled Reports UI shipped wired to `console.log` even though
 * POST /reports/schedule, GET /reports/schedules, DELETE /reports/schedules/:id
 * and POST /reports/generate already existed server-side. This client closes
 * that gap (UX paths NEW-359 / NEW-360).
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

export interface GenerateReportPayload {
  reportType: ReportType
  title: string
  periodStart: string
  periodEnd: string
  parameters?: Record<string, unknown>
  format?: ReportFormat
}

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
  total: number
}

/**
 * GET /reports — replaces a direct `supabase.from('generated_reports')` read.
 *
 * The table has RLS enabled and zero policies, so the anon-key client the browser
 * uses got `[]` back with no error: the page looked empty rather than broken. The
 * gateway holds the service-role key and scopes by the restaurant on the JWT.
 */
export async function listReports(): Promise<GeneratedReport[]> {
  const { data } = await apiClient.get<ReportListResponse>('/reports')
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
  total: number
}> {
  const { data } = await apiClient.get<ReportListResponse>('/reports', {
    params: { limit: opts.limit, offset: opts.offset },
  })
  const reports = Array.isArray(data?.reports) ? data.reports : []
  return { reports, total: typeof data?.total === 'number' ? data.total : reports.length }
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

export async function generateReport(payload: GenerateReportPayload): Promise<GeneratedReport> {
  const { data } = await apiClient.post<GeneratedReport>('/reports/generate', payload)
  return data
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
