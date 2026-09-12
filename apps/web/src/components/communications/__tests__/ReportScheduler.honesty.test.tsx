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
import userEvent from '@testing-library/user-event'
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

  /*
   * This one replaced a weaker assertion that the "Generating..." label is
   * absent. That assertion passed against the pre-fix component too — the label
   * only appears mid-flight — so it could not have caught the regression it
   * existed to catch. Clicking is the discriminator: on the old code the click
   * reached `onGenerateNow` and posted a report row.
   */
  it('cannot be clicked into calling onGenerateNow', async () => {
    const onGenerateNow = vi.fn()
    const user = userEvent.setup()
    render(<ReportScheduler onGenerateNow={onGenerateNow} />)

    await user.click(screen.getByRole('button', { name: /Generate Now/i }))

    expect(onGenerateNow).not.toHaveBeenCalled()
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

  /*
   * ADR 0020: "an error must never render as emptiness". This is not a
   * hypothetical path — `public.scheduled_reports` does not exist in the
   * production database (verified 2026-08-26), so `GET /reports/schedules`
   * fails every single time and the error branch is the ONLY branch a real user
   * reaches. Before the fix, `refreshSchedules` swallowed it and the tab drew
   * exactly as though the user had no schedules.
   */
  it('says a failed read failed, instead of drawing it as "none"', () => {
    render(
      <ReportScheduler schedules={[]} schedulesError="relation does not exist" />,
    )
    expect(
      screen.getByText(/Saved schedules — could not be read/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/relation does not exist/i)).toBeInTheDocument()
  })

  /*
   * Asserted on the row's own title, not on the list heading. Checking the
   * heading would pass against the pre-fix component for the wrong reason — it
   * headed the list "Active schedules", so a query for "Saved schedules" was
   * absent there too. The title is rendered either way, so this discriminates.
   */
  it('does not present stale rows as current when the read failed', () => {
    render(<ReportScheduler schedules={[schedule]} schedulesError="boom" />)
    expect(screen.queryByText(schedule.title)).not.toBeInTheDocument()
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument()
  })
})
