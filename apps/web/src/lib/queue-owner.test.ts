import { describe, expect, it } from 'vitest'
import { isPermanentRefusal, statusOf } from './queue-owner'

const axiosError = (status: number, data?: unknown) => ({ response: { status, data } })

describe('statusOf (F-950)', () => {
  it('reads "still being saved from your last try" as no answer yet, so it is retried', () => {
    const err = axiosError(409, {
      statusCode: 409,
      reason: 'still_running',
      message: 'This is still being saved from your last try.',
    })
    expect(statusOf(err)).toBeUndefined()
    expect(isPermanentRefusal(statusOf(err))).toBe(false)
  })

  it('keeps any other 409 a refusal', () => {
    const err = axiosError(409, { reason: 'order_already_delivered' })
    expect(statusOf(err)).toBe(409)
    expect(isPermanentRefusal(statusOf(err))).toBe(true)
  })

  it('reads the status of an error with no body, and none from a network error', () => {
    expect(statusOf(axiosError(400))).toBe(400)
    expect(statusOf(new Error('Network Error'))).toBeUndefined()
  })
})
