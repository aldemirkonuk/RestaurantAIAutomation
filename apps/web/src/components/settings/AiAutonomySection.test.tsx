import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiAutonomySection } from './AiAutonomySection'
import { settingsApi } from '../../services/api/settings'

vi.mock('../../services/api/settings', () => ({
  settingsApi: {
    getFeatureFlags: vi.fn(),
    updateFeatureFlags: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const api = vi.mocked(settingsApi)

function flags(over: Partial<Record<string, boolean>> = {}) {
  return {
    enable_ai_negotiation: true,
    enable_ai_autonomous_send: false,
    ...over,
  } as never
}

describe('AiAutonomySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getFeatureFlags.mockResolvedValue(flags())
    api.updateFeatureFlags.mockImplementation(async (patch) => flags(patch as never))
  })

  it('states the real consequence of autonomous send in the copy', async () => {
    render(<AiAutonomySection canManage />)
    await screen.findByTestId('autonomy-autonomous-send')

    // The whole point of surfacing this switch: the person accountable for it
    // must be able to read what it does without opening the codebase.
    expect(
      screen.getByText(/without your approval/i),
    ).toBeInTheDocument()
  })

  it('shows autonomous send OFF when the restaurant has never set it', async () => {
    render(<AiAutonomySection canManage />)

    const toggle = await screen.findByTestId('autonomy-autonomous-send')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('will not enable autonomous send without an explicit confirmation', async () => {
    const user = userEvent.setup()
    render(<AiAutonomySection canManage />)

    const toggle = await screen.findByTestId('autonomy-autonomous-send')
    await user.click(toggle)

    // A confirmation step stands between the click and the send-without-approval
    // state. Nothing is persisted until it is answered.
    expect(await screen.findByTestId('autonomy-confirm')).toBeInTheDocument()
    expect(api.updateFeatureFlags).not.toHaveBeenCalled()
  })

  it('persists autonomous send only after the confirmation is accepted', async () => {
    const user = userEvent.setup()
    render(<AiAutonomySection canManage />)

    await user.click(await screen.findByTestId('autonomy-autonomous-send'))
    await user.click(await screen.findByTestId('autonomy-confirm'))

    await waitFor(() =>
      expect(api.updateFeatureFlags).toHaveBeenCalledWith({
        enable_ai_autonomous_send: true,
      }),
    )
  })

  it('turns autonomous send back off immediately, with no confirmation', async () => {
    api.getFeatureFlags.mockResolvedValue(flags({ enable_ai_autonomous_send: true }))
    const user = userEvent.setup()
    render(<AiAutonomySection canManage />)

    const toggle = await screen.findByTestId('autonomy-autonomous-send')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await user.click(toggle)

    expect(screen.queryByTestId('autonomy-confirm')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(api.updateFeatureFlags).toHaveBeenCalledWith({
        enable_ai_autonomous_send: false,
      }),
    )
  })

  it('persists the one wired toggle, enable_ai_negotiation', async () => {
    const user = userEvent.setup()
    render(<AiAutonomySection canManage />)

    await user.click(await screen.findByTestId('autonomy-ai-negotiation'))

    await waitFor(() =>
      expect(api.updateFeatureFlags).toHaveBeenCalledWith({
        enable_ai_negotiation: false,
      }),
    )
  })

  it('reverts the switch and says so when the save fails', async () => {
    api.updateFeatureFlags.mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    render(<AiAutonomySection canManage />)

    const toggle = await screen.findByTestId('autonomy-ai-negotiation')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await user.click(toggle)

    // ADR 0020: an optimistic update that fails must revert and tell the user —
    // never leave a switch showing a state the server does not hold.
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('reports a failed load instead of rendering switches at their defaults', async () => {
    api.getFeatureFlags.mockRejectedValue(new Error('boom'))
    render(<AiAutonomySection canManage />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByTestId('autonomy-autonomous-send')).not.toBeInTheDocument()
  })
  // 2026-09-05: `PUT /settings/feature-flags` runs `assertCanManageRestaurant`,
  // so a member who is neither owner nor manager is refused by the route. The
  // section must therefore not offer a control that would fail after the click
  // (ADR 0083) — and must not hide the values either.
  it('renders the switches disabled with the reason for a non-manager', async () => {
    render(<AiAutonomySection canManage={false} />)

    const autonomy = await screen.findByTestId('autonomy-autonomous-send')
    expect(autonomy).toBeDisabled()
    expect(screen.getByTestId('autonomy-ai-negotiation')).toBeDisabled()
    expect(
      screen.getByText(/Only an owner or a manager of this restaurant may change these/i),
    ).toBeInTheDocument()
    // The values are still readable: a setting you cannot see is one you cannot
    // plan around.
    expect(screen.getByTestId('autonomy-ai-negotiation')).toHaveAttribute('aria-checked', 'true')
  })

  it('writes nothing when a non-manager clicks a switch', async () => {
    const user = userEvent.setup()
    render(<AiAutonomySection canManage={false} />)

    await user.click(await screen.findByTestId('autonomy-ai-negotiation'))
    expect(api.updateFeatureFlags).not.toHaveBeenCalled()
  })
})
