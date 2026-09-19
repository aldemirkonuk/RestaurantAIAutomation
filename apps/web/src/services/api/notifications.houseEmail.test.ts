/**
 * POST /notifications/send-email, client half (ADR 0149 answer 15, 2026-09-16).
 *
 * The gateway now sends only for an owner or manager of the active house, and
 * only to the house's members and vendor-book contacts; anything else is a
 * 400/403/503 carrying a sentence. Before this, the three web callers
 * (QuickGmailModal, the email scheduler, RecurringOrders) posted with bare
 * `axios` — no session token, so the guarded route answered 401 — and read
 * `data.error`, which on a Nest refusal is the status NAME ("Forbidden"), not
 * the reason.
 *
 * These assert the request (path, body, the client that carries the token) and
 * that the gateway's own words reach the person, including through the
 * scheduler, which used to overwrite every failure with "Failed to send email".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendHouseEmail, houseEmailRefusal } from './notifications'
import { apiClient } from './client'
import {
  checkAndSendDueEmails,
  getScheduledEmails,
  scheduleEmail,
} from '../../lib/email-scheduler'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  }
})

const http = vi.mocked(apiClient) as unknown as { post: ReturnType<typeof vi.fn> }

/** The shape axios rejects with for a Nest HttpException. */
const refused = (status: number, message: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { statusCode: status, message, error: 'Forbidden' } },
  })

beforeEach(() => {
  http.post.mockReset()
  try {
    localStorage.clear()
  } catch {
    /* jsdom always has it */
  }
})

describe('sendHouseEmail', () => {
  it('posts to the guarded route through the token-carrying client, with no stray fields', async () => {
    http.post.mockResolvedValue({ data: { success: true, message_id: 'm1' } })
    const receipt = await sendHouseEmail({
      to: ['orders@vendor.test'],
      subject: 'Next week',
      body_html: '<p>Hi</p>',
      body_text: '',
      cc: [],
      bcc: ['accounts@vendor.test'],
    })
    expect(http.post).toHaveBeenCalledTimes(1)
    expect(http.post.mock.calls[0][0]).toBe('/notifications/send-email')
    // Empty cc and an empty text body are omitted, not sent as [] / "".
    expect(http.post.mock.calls[0][1]).toEqual({
      to: ['orders@vendor.test'],
      subject: 'Next week',
      body_html: '<p>Hi</p>',
      bcc: ['accounts@vendor.test'],
    })
    expect(receipt).toMatchObject({ success: true, message_id: 'm1' })
  })

  it('throws on a refusal instead of resolving a { success: false } a caller could miss', async () => {
    http.post.mockRejectedValue(refused(403, 'Not in the book: x@y.test'))
    await expect(
      sendHouseEmail({ to: ['x@y.test'], subject: 's', body_html: 'b' }),
    ).rejects.toThrow()
  })
})

describe('houseEmailRefusal reads the gateway, not the status name', () => {
  it("returns a 403's sentence", () => {
    const words =
      'Mudavym sends only to this house\'s members and the contacts in its vendor book. Not in the book: x@y.test.'
    expect(houseEmailRefusal(refused(403, words))).toBe(words)
  })

  it("joins a validation 400's list", () => {
    expect(
      houseEmailRefusal(
        refused(400, ['Name at least one recipient.', 'The subject must be a single line']),
      ),
    ).toBe('Name at least one recipient. The subject must be a single line.')
  })

  it('names the status when the body carries no words', () => {
    const e = Object.assign(new Error('x'), { response: { status: 502, data: {} } })
    expect(houseEmailRefusal(e)).toBe('The email was not sent (the server answered 502).')
  })

  it('says the server could not be reached when there was no response', () => {
    expect(houseEmailRefusal(new Error('Network Error'))).toBe(
      'The email was not sent: Network Error',
    )
    expect(houseEmailRefusal(undefined)).toBe(
      'The email was not sent: the server could not be reached.',
    )
  })
})

/** A session token naming a person and a house, as the gateway signs it. */
const tokenFor = (sub: string, restaurantId: string) => {
  const b64url = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub, restaurantId })}.sig`
}
const signIn = (sub: string, restaurantId: string) =>
  localStorage.setItem('accessToken', tokenFor(sub, restaurantId))

/** Schedule one entry that is already due, as the signed-in owner. */
const dueNow = (to: string[], subject = 'Hello') => {
  const entry = scheduleEmail(to, subject, '<p>Hi</p>', 'Hi', 0)
  return entry
}

describe('the scheduler keeps the refusal on the entry', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    signIn('user-a', 'house-1')
  })

  it("records the gateway's sentence, not 'Failed to send email'", async () => {
    dueNow(['stranger@example.test'])
    http.post.mockRejectedValue(refused(403, 'Not in the book: stranger@example.test.'))

    await checkAndSendDueEmails()

    const [entry] = getScheduledEmails()
    expect(entry.status).toBe('failed')
    expect(entry.error).toBe('Not in the book: stranger@example.test.')
  })

  it('marks an accepted send as sent', async () => {
    dueNow(['orders@vendor.test'])
    http.post.mockResolvedValue({ data: { success: true, message_id: 'm2' } })

    await checkAndSendDueEmails()

    const [entry] = getScheduledEmails()
    expect(entry.status).toBe('sent')
    expect(entry.error).toBeUndefined()
  })
})

describe('the scheduler sends only its owner\'s queue, once (notify-lane review, 2026-09-17)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('an entry scheduled by one person never fires under the next person to sign in', async () => {
    signIn('user-a', 'house-1')
    dueNow(['orders@vendor.test'])
    http.post.mockResolvedValue({ data: { success: true, message_id: 'm' } })

    signIn('user-b', 'house-1')
    await checkAndSendDueEmails()
    expect(http.post).not.toHaveBeenCalled()
    expect(getScheduledEmails()).toEqual([])

    signIn('user-a', 'house-2') // same person, another house: not this queue either
    await checkAndSendDueEmails()
    expect(http.post).not.toHaveBeenCalled()

    signIn('user-a', 'house-1')
    await checkAndSendDueEmails()
    expect(http.post).toHaveBeenCalledTimes(1)
    expect(getScheduledEmails()[0].status).toBe('sent')
  })

  it('the old unkeyed queue has no owner and is never sent', async () => {
    signIn('user-a', 'house-1')
    // The literal key, not the module's constant, so this cannot pass by
    // writing somewhere the scheduler never looked.
    localStorage.setItem(
      'wineops_scheduled_emails',
      JSON.stringify([
        {
          id: 'old',
          to: ['orders@vendor.test'],
          subject: 'Left behind',
          bodyHtml: '<p>Hi</p>',
          bodyText: 'Hi',
          scheduledAt: Date.now() - 1000,
          createdAt: Date.now() - 5000,
          status: 'pending',
        },
      ]),
    )
    await checkAndSendDueEmails()
    expect(http.post).not.toHaveBeenCalled()
  })

  it('nobody signed in: nothing is sent and nothing can be scheduled', async () => {
    await checkAndSendDueEmails()
    expect(http.post).not.toHaveBeenCalled()
    expect(() => scheduleEmail(['a@b.test'], 's', 'h', 't', 0)).toThrow(/No signed-in house/)
  })

  it('an entry is claimed as sending BEFORE the request is awaited, so an overlapping tick cannot send it twice', async () => {
    signIn('user-a', 'house-1')
    dueNow(['orders@vendor.test'])
    let release: (v: unknown) => void = () => {}
    http.post.mockImplementation(() => new Promise((resolve) => { release = resolve }))

    const first = checkAndSendDueEmails()
    // What another tab reading storage now sees:
    await Promise.resolve()
    expect(getScheduledEmails()[0].status).toBe('sending')
    const second = checkAndSendDueEmails()
    await second
    expect(http.post).toHaveBeenCalledTimes(1)

    release({ data: { success: true, message_id: 'm' } })
    await first
    expect(http.post).toHaveBeenCalledTimes(1)
    expect(getScheduledEmails()[0].status).toBe('sent')
  })

  it('an entry left sending (the tab closed mid-request) is marked failed, never resent', async () => {
    signIn('user-a', 'house-1')
    const entry = dueNow(['orders@vendor.test'])
    const key = `mudavym_scheduled_emails:user-a:house-1`
    const stored = JSON.parse(localStorage.getItem(key)!)
    stored[0].status = 'sending'
    stored[0].sendingSince = Date.now() - 11 * 60 * 1000
    localStorage.setItem(key, JSON.stringify(stored))

    await checkAndSendDueEmails()

    expect(http.post).not.toHaveBeenCalled()
    const [after] = getScheduledEmails()
    expect(after.id).toBe(entry.id)
    expect(after.status).toBe('failed')
    expect(after.error).toMatch(/not retried/)
  })

  it('a session that changes before a claimed entry is sent puts it back, not sends it as someone else', async () => {
    signIn('user-a', 'house-1')
    dueNow(['orders@vendor.test'], 'one')
    dueNow(['orders@vendor.test'], 'two')
    http.post.mockImplementation(async () => {
      signIn('user-b', 'house-1') // the session switches during the first send
      return { data: { success: true, message_id: 'm' } }
    })

    await checkAndSendDueEmails()

    expect(http.post).toHaveBeenCalledTimes(1)
    signIn('user-a', 'house-1')
    const statuses = getScheduledEmails().map((e) => [e.subject, e.status])
    expect(statuses).toEqual([
      ['one', 'sent'],
      ['two', 'pending'],
    ])
  })
})
