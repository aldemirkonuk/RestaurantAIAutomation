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

export interface GeneratedReport {
  id: string
  title: string
  reportType: string
  format?: string
  fileUrl?: string | null
  createdAt?: string
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
