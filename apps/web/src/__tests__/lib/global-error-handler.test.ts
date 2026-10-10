import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * F-733: a stored receipt is shown as `<img src={signed URL}>`, and its failing
 * to load is expected (a HEIC photo, an expired link). The capture-phase
 * resource listener reports it — and must not carry the link's token along.
 */

const captureMessage = vi.hoisted(() => vi.fn())

vi.mock('../../lib/error-tracking', async (orig) => ({
  ...(await orig<typeof import('../../lib/error-tracking')>()),
  errorTracking: { captureMessage: (...a: unknown[]) => captureMessage(...a), captureException: vi.fn() },
}))

import { cleanupGlobalErrorHandler, initGlobalErrorHandler } from '../../lib/global-error-handler'

afterEach(() => {
  cleanupGlobalErrorHandler()
  captureMessage.mockReset()
  document.body.innerHTML = ''
})

describe('a resource that fails to load', () => {
  it('is reported without the query string that holds the signed token', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    initGlobalErrorHandler()
    const img = document.createElement('img')
    img.src = 'https://x.supabase.co/storage/v1/object/sign/docs/r-1/a.heic?token=eyJSECRET'
    document.body.appendChild(img)
    img.dispatchEvent(new Event('error'))

    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(captureMessage.mock.calls[0])).not.toContain('eyJSECRET')
    expect(captureMessage.mock.calls[0][2]).toMatchObject({
      type: 'resource_error',
      url: 'https://x.supabase.co/storage/v1/object/sign/docs/r-1/a.heic',
      tagName: 'IMG',
    })
  })
})
