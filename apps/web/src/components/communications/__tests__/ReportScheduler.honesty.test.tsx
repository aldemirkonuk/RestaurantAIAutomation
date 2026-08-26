/**
 * OD-81 / ADR 0020 — the report scheduler must not claim to generate or deliver.
 *
 * Verified at `origin/main` 443f159d: `POST /reports/generate`
 * (`apps/api-gateway/src/reports/reports.service.ts:42-71`) is the ONLY writer of
 * `generated_reports` anywhere in the repo, and it inserts `status: "pending"`
 * with NULL `pdf_url` / `excel_url` / `csv_url`. No gateway job, Python agent,
 * migration or edge function ever renders a file or advances that status, and
 * nothing reads `scheduled_reports.next_run_at`.
 *
 * So: "Generate Now" cannot generate, and a saved schedule cannot run. Before
 * this test, the button called the endpoint and then announced "Report generated
 * — filed in Documents & Reports", and the saved list was headed "Active
 * schedules". Both were false.
 *
 * These assertions are what stops that regressing. Each one fails if the
 * corresponding honesty fix is reverted.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReportScheduler } from '../ReportScheduler'

vi.mock('../../../contexts/RealtimeContext', () => ({
  useRealtimeDispatch: () => vi.fn(),
}))

const schedule = {
  id: 'sch-1',
  title: 'inventory report',
  reportType: 'inventory_summary',
  frequency: 'weekly',
  timeOfDay: '08:00',
  nextRunAt: null,
}

describe('ReportScheduler — ADR 0020', () => {
  it('leaves Generate Now disabled, because nothing can be generated', () => {
    render(<ReportScheduler />)
    expect(
      screen.getByRole('button', { name: /Generate Now/i }),
    ).toBeDisabled()
  })

  it('never shows the in-flight "Generating..." state', () => {
    render(<ReportScheduler />)
    expect(screen.queryByText(/Generating\.\.\./i)).not.toBeInTheDocument()
  })

  it('states up front that generation and delivery are not built', () => {
    render(<ReportScheduler />)
    expect(
      screen.getByText(/Report generation is not built yet/i),
    ).toBeInTheDocument()
  })

  it('does not describe the surface as configuring automatic delivery', () => {
    render(<ReportScheduler />)
    expect(
      screen.queryByText(/Configure automatic report generation and delivery/i),
    ).not.toBeInTheDocument()
  })

  it('calls saved schedules "saved", not "active" — nothing runs them', () => {
    render(<ReportScheduler schedules={[schedule]} />)
    expect(screen.getByText(/Saved schedules \(1\)/i)).toBeInTheDocument()
    expect(screen.queryByText(/Active schedules/i)).not.toBeInTheDocument()
  })
})
