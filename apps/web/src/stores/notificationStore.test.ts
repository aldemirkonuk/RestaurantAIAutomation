import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Receipts walk 2026-11-11, item 5: the store's toasts were never drawn — no
 * component reads `toasts`, and the mounted surface is sonner's AppToaster —
 * so "Receipt verified" (and "Verification failed") never showed. These pin
 * the store to that surface.
 */
const sonner = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: sonner }))

import { useNotificationStore } from './notificationStore'

beforeEach(() => {
  vi.clearAllMocks()
  useNotificationStore.setState({ toasts: [] })
})

describe('notificationStore draws on the mounted toaster', () => {
  it('success reaches sonner with its title, description and the store id', () => {
    const id = useNotificationStore.getState().success('Receipt verified', 'All 6 accepted.')
    expect(sonner.success).toHaveBeenCalledWith(
      'Receipt verified',
      expect.objectContaining({ id, description: 'All 6 accepted.', duration: 5000 }),
    )
  })

  it('error reaches sonner too', () => {
    useNotificationStore.getState().error('Verification failed', 'boom')
    expect(sonner.error).toHaveBeenCalledWith(
      'Verification failed',
      expect.objectContaining({ description: 'boom' }),
    )
  })

  it('removeToast and clearToasts take the drawn toast down', () => {
    const a = useNotificationStore.getState().info('one')
    const b = useNotificationStore.getState().warning('two')
    useNotificationStore.getState().removeToast(a)
    expect(sonner.dismiss).toHaveBeenCalledWith(a)
    useNotificationStore.getState().clearToasts()
    expect(sonner.dismiss).toHaveBeenCalledWith(b)
    expect(useNotificationStore.getState().toasts).toEqual([])
  })

  it('promise dismisses its loading toast and shows the outcome', async () => {
    await useNotificationStore.getState().promise(Promise.resolve(1), {
      loading: 'Saving',
      success: 'Saved',
      error: 'Failed',
    })
    const loadingId = sonner.info.mock.calls[0][1].id
    expect(sonner.dismiss).toHaveBeenCalledWith(loadingId)
    expect(sonner.success).toHaveBeenCalledWith('Saved', expect.anything())
  })
})
