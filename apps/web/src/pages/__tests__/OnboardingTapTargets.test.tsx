/**
 * r109 (r108 walk finding 3): at 375 px these onboarding controls measured
 * 18 to 37 px tall. Each is a tap target, so each holds a 44 px minimum
 * (`min-h-11`), the same rule as `.mdv-pub__verified`. jsdom does no layout,
 * so the spec pins the class that makes the height, not a measurement.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getOnboardingProgress } = vi.hoisted(() => ({ getOnboardingProgress: vi.fn() }))

vi.mock('../../services/api/vendors', () => ({ addCustomProvider: vi.fn(), matchVendorCatalogue: vi.fn() }))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress, updateOnboardingProgress: vi.fn() }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))

import HouseContents from '../HouseContents'

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

const FORTY_FOUR = 'min-h-11'

describe('onboarding tap targets are 44 px', () => {
  it('/house: Read your menu, Receipts, Set it in Settings and both vendor inputs', async () => {
    getOnboardingProgress.mockResolvedValue({ menu_uploaded: false, vendor_added: false })
    render(<MemoryRouter><HouseContents /></MemoryRouter>)
    await screen.findByText(/No menu read yet\./)
    for (const control of [
      screen.getByRole('link', { name: 'Read your menu' }),
      screen.getByRole('link', { name: 'Receipts' }),
      screen.getByRole('button', { name: 'Set it in Settings' }),
    ]) {
      expect(control.className).toContain(FORTY_FOUR)
      expect(control.className).toContain('inline-flex')
    }
    expect(screen.getByLabelText('Vendor').className).toContain(FORTY_FOUR)
    expect(screen.getByLabelText('Vendor email').className).toContain(FORTY_FOUR)
  })

  it('/register: every Back button (a source scan, as the steps are not reachable one by one)', () => {
    const source = readFileSync(join(process.cwd(), 'src/pages/Register.tsx'), 'utf8')
    // The className of the button each `<ArrowLeft /> Back` sits in: the last one before it.
    const backs = source
      .split(/<ArrowLeft[^>]*\/>\s*Back/)
      .slice(0, -1)
      .map((before) => before.slice(before.lastIndexOf('className=')))
    expect(backs).toHaveLength(3)
    for (const className of backs) expect(className).toContain(FORTY_FOUR)
  })
})
