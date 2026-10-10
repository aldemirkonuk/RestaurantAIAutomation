/**
 * Settings → Team, the labour target box (F-352).
 *
 * It started at '28' for a house with no target, so Settings showed a figure
 * nobody chose while /team said none was on file, and focusing the box and
 * leaving it saved that 28 as if the owner had. These pin: an empty box when
 * there is no target, nothing sent when it is left alone, an owner's own 28
 * shown as 28, and no database words on screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TeamLaborSettings } from './TeamLaborSettings'
import { getTeamSettings, updateTeamSettings, type TeamSettings as SharedTeamSettings } from '../../services/api/team'

type TeamSettings = SharedTeamSettings & { labor_target_chosen?: boolean | null }

vi.mock('../../services/api/team', () => ({
  getTeamSettings: vi.fn(),
  updateTeamSettings: vi.fn(),
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const OWNER_MAY = { trackingOff: true, trackingOn: true, target: true, doubleBooking: true }

function settings(over: Partial<TeamSettings> = {}): TeamSettings {
  return {
    restaurant_id: 'r1',
    labor_tracking_enabled: true,
    labor_target_pct: null,
    allow_double_booking: false,
    moneyVisibleTo: 'owner',
    configured: false,
    labor_target_chosen: false,
    mayChange: OWNER_MAY,
    ...over,
  }
}

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return render(<TeamLaborSettings />, { wrapper })
}

beforeEach(() => {
  vi.mocked(getTeamSettings).mockReset()
  vi.mocked(updateTeamSettings).mockReset()
  vi.mocked(updateTeamSettings).mockImplementation(async (patch) =>
    settings({ configured: true, labor_target_pct: patch.laborTargetPct, labor_target_chosen: true }),
  )
})

describe('the labour target box (F-352)', () => {
  it('starts empty for a house with no target, never at 28', async () => {
    vi.mocked(getTeamSettings).mockResolvedValue(settings())
    draw()
    const box = (await screen.findByLabelText('Labor target percent')) as HTMLInputElement
    expect(box.value).toBe('')
    expect(screen.getByText(/No target set/)).toBeInTheDocument()
  })

  it('sends nothing when the box is focused and left alone', async () => {
    vi.mocked(getTeamSettings).mockResolvedValue(settings())
    draw()
    const box = await screen.findByLabelText('Labor target percent')
    fireEvent.focus(box)
    fireEvent.blur(box)
    // A mutation starts on a later tick: wait for it before saying it did not.
    await new Promise((r) => setTimeout(r, 50))
    expect(updateTeamSettings).not.toHaveBeenCalled()
  })

  it('shows a stored 28 nobody chose as empty, the way /team reads it', async () => {
    vi.mocked(getTeamSettings).mockResolvedValue(
      settings({ configured: true, labor_target_pct: 28, labor_target_chosen: false }),
    )
    draw()
    const box = (await screen.findByLabelText('Labor target percent')) as HTMLInputElement
    expect(box.value).toBe('')
  })

  it("saves an owner's 28 when they type it", async () => {
    vi.mocked(getTeamSettings).mockResolvedValue(
      settings({ configured: true, labor_target_pct: 28, labor_target_chosen: false }),
    )
    draw()
    const box = await screen.findByLabelText('Labor target percent')
    fireEvent.change(box, { target: { value: '28' } })
    fireEvent.blur(box)
    await waitFor(() => expect(updateTeamSettings).toHaveBeenCalledWith({ laborTargetPct: 28 }))
  })

  it('shows a 28 the owner chose as 28', async () => {
    vi.mocked(getTeamSettings).mockResolvedValue(
      settings({ configured: true, labor_target_pct: 28, labor_target_chosen: true }),
    )
    draw()
    const box = (await screen.findByLabelText('Labor target percent')) as HTMLInputElement
    await waitFor(() => expect(box.value).toBe('28'))
  })

  it('speaks no database words', async () => {
    vi.mocked(getTeamSettings).mockResolvedValue(
      settings({ configured: true, labor_target_pct: 31, labor_target_chosen: true }),
    )
    const { container } = draw()
    await screen.findByLabelText('Labor target percent')
    expect(container.textContent).not.toMatch(/Supabase|team_settings/)
  })
})
