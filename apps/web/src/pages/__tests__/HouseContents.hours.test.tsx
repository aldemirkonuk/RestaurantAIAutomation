/** r109 onboarding g1: /house says when the hours from the Places pick did not save. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api/documents', () => ({ documentsApi: { upload: vi.fn() } }))
vi.mock('../../services/api/arrival', () => ({ skipFolio: vi.fn() }))
vi.mock('../../services/api/vendors', () => ({ addCustomProvider: vi.fn() }))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn().mockResolvedValue({ vendor_added: true }) }))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: vi.fn().mockResolvedValue(null) } }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'owner', restaurantId: 'h1' } }) }))

import HouseContents from '../HouseContents'
import { HOURS_UNSAVED_KEY, writeHoursUnsaved } from '../../lib/houseHoursNote'

// The page holds its rows until the setup read lands (#2354), so a test starts
// from the settled page: wait for the closing link, which shows with the rows.
const page = async () => {
  const view = render(<MemoryRouter><HouseContents /></MemoryRouter>)
  await screen.findAllByRole('link', { name: 'Go to the desk' })
  return view
}

beforeEach(() => sessionStorage.clear())

describe('HouseContents: hours not saved', () => {
  it('says so, with a Settings link to the hours tab', async () => {
    writeHoursUnsaved('h1')
    await page()
    expect(screen.getByTestId('house-hours-unsaved')).toHaveTextContent('Your opening hours from Google were not saved.')
    expect(screen.getByRole('link', { name: 'Set them in Settings' })).toHaveAttribute('href', '/settings?tab=hours')
  })

  it('says nothing for another house in the same tab', async () => {
    writeHoursUnsaved('h2')
    await page()
    expect(screen.queryByTestId('house-hours-unsaved')).not.toBeInTheDocument()
  })

  it('says nothing when no note was left, or the note does not parse', async () => {
    await page()
    expect(screen.queryByTestId('house-hours-unsaved')).not.toBeInTheDocument()
    sessionStorage.setItem(HOURS_UNSAVED_KEY, '{not json')
    await page()
    expect(screen.queryByTestId('house-hours-unsaved')).not.toBeInTheDocument()
  })
})
