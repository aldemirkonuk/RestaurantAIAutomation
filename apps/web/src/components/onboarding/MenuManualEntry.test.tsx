/** Walk 2026-11-11: the typed-lines price headings said "($)" in a TRY house. */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))

import { MenuManualEntry } from './MenuManualEntry'

describe('MenuManualEntry price headings', () => {
  it("name the house's currency code when it is known", () => {
    render(<MenuManualEntry onSuccess={vi.fn()} currency="TRY" />)
    expect(screen.getByRole('columnheader', { name: 'Glass (TRY)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Bottle (TRY)' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('$')
  })

  it('name no currency when none is known, never a dollar sign', () => {
    render(<MenuManualEntry onSuccess={vi.fn()} currency={null} />)
    expect(screen.getByRole('columnheader', { name: 'Glass' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Bottle' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('$')
  })
})
