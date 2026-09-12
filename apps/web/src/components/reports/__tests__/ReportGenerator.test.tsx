/**
 * The Generate button must not claim to have produced anything.
 *
 * `POST /reports/generate` only inserts a `generated_reports` row with
 * `status: "pending"` and NULL file urls, and nothing in the repo ever renders
 * a file — so the button stays honestly unavailable. What used to be here
 * simulated the whole flow client-side: a fake "ready" status, a file size from
 * `Math.random()`, and a Download button that popped an alert.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportGenerator } from '../ReportGenerator'

describe('ReportGenerator', () => {
  it('says generation is unavailable before the user picks anything', () => {
    render(<ReportGenerator />)
    expect(
      screen.getByText(/Report file generation is not available yet/i),
    ).toBeInTheDocument()
  })

  it('leaves the Generate button disabled', async () => {
    const user = userEvent.setup()
    render(<ReportGenerator />)
    await user.click(screen.getByText('Weekly Summary Report'))

    expect(screen.getByRole('button', { name: /Generate Report/i })).toBeDisabled()
  })

  it('never shows a generated file, size or download', async () => {
    const user = userEvent.setup()
    render(<ReportGenerator />)
    await user.click(screen.getByText('Weekly Summary Report'))

    expect(screen.queryByText(/Recently Generated/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/KB/)).not.toBeInTheDocument()
  })
})
