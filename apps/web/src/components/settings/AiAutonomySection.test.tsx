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
    render(<AiAutonomySection />)
    await screen.findByTestId('autonomy-autonomous-send')

    // The whole point of surfacing this switch: the person accountable for it
    // must be able to read what it does without opening the codebase.
    expect(
      screen.getByText(/without your approval/i),
    ).toBeInTheDocument()
  })

  it('shows autonomous send OFF when the restaurant has never set it', async () => {
    render(<AiAutonomySection />)

    const toggle = await screen.findByTestId('autonomy-autonomous-send')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('will not enable autonomous send without an explicit confirmation', async () => {
    const user = userEvent.setup()
    render(<AiAutonomySection />)

    const toggle = await screen.findByTestId('autonomy-autonomous-send')
    await user.click(toggle)

    // A confirmation step stands between the click and the send-without-approval
    // state. Nothing is persisted until it is answered.
    expect(await screen.findByTestId('autonomy-confirm')).toBeInTheDocument()
    expect(api.updateFeatureFlags).not.toHaveBeenCalled()
  })

  it('persists autonomous send only after the confirmation is accepted', async () => {
    const user = userEvent.setup()
    render(<AiAutonomySection />)

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
    render(<AiAutonomySection />)

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
    render(<AiAutonomySection />)

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
    render(<AiAutonomySection />)

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
    render(<AiAutonomySection />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByTestId('autonomy-autonomous-send')).not.toBeInTheDocument()
  })
})
