import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ServicesSection } from './ServicesSection'
import type { SettingsNextData } from './useSettingsNextData'

vi.mock('../../../services/api/integrations', () => ({ integrationsApi: { getConnections: vi.fn(async () => []) } }))

// F-763: Connect here returns to /settings?tab=services, and so does a refused
// sign-in. The outcome used to be dropped on the floor; it is said here now.
describe('ServicesSection says how a connection attempt ended', () => {
  const data = {
    integrations: { status: 'loading' },
    disconnectIntegration: vi.fn(),
    writer: { busy: null },
  } as unknown as SettingsNextData

  it('says in words that an expired sign-in connected nothing', () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=services&integration_status=error&integration_reason=invalid_state']}>
        <ServicesSection data={data} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Nothing was connected: the sign-in took longer than ten minutes/)).toBeTruthy()
  })

  it('says nothing when no connection attempt came back', () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=services']}>
        <ServicesSection data={data} />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/Nothing was connected/)).toBeNull()
  })
})
