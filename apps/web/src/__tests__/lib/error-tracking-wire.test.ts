import { describe, it, expect } from 'vitest'
import * as Sentry from '@sentry/react'
import { scrubSentryEvent } from '../../lib/error-tracking'

/**
 * The scrubber on the WIRE, through the real @sentry/react client.
 *
 * error-tracking-pii.test.ts mocks the SDK and hands `scrubSentryEvent` events
 * it built itself. PR #427's round-2 audit showed why that is not enough on its
 * own: the leak it found lived in fields the SDK attaches (and merges onto the
 * event before `beforeSend`) that no hand-built fixture contained. Here the SDK
 * does the merging — scope breadcrumbs, the scope's transaction name, the
 * exception's own message — and the assertion is on the serialized envelope
 * bytes the transport would have sent. PR #427 round 3 (2026-09-25).
 */
const INVITE = 'k7Qm2VxP9rTzL4nW'
const RESET = 'pkce_e1f3a5c7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7'
const FEED = '9f2c4e6a8b0d1f3e5a7c9b1d3f5e7a9c0b2d4f6e8a0c2e4f6a8b0d2f4e6a8c0b'

function clientCapturingEnvelopes() {
  const sent: string[] = []
  const client = new Sentry.BrowserClient({
    dsn: 'https://public@example.test/1',
    integrations: [],
    stackParser: Sentry.defaultStackParser,
    sendDefaultPii: false,
    transport: (options) =>
      Sentry.createTransport(options, async (request) => {
        sent.push(typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body))
        return { statusCode: 200 }
      }),
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  })
  const scope = new Sentry.Scope()
  scope.setClient(client)
  client.init()
  return { client, scope, sent }
}

describe('Sentry wire — the real SDK merges, the scrubber still wins', () => {
  it('no token leaves in the envelope from breadcrumbs, transaction, message or exception', async () => {
    const { client, scope, sent } = clientCapturingEnvelopes()
    // Shapes @sentry/browser's own breadcrumb handlers produce.
    scope.addBreadcrumb({ category: 'navigation', data: { from: `/reset-password?token=${RESET}`, to: `/invite/${INVITE}` } })
    scope.addBreadcrumb({
      category: 'fetch',
      type: 'http',
      data: { method: 'GET', url: `https://api.mudavym.com/api/v1/auth/invite/${INVITE}`, status_code: 404 },
    })
    scope.addBreadcrumb({
      category: 'console',
      level: 'error',
      message: `feed failed https://api.mudavym.com/api/v1/calendar/feed/${FEED}.ics`,
      data: { arguments: [`feed failed https://api.mudavym.com/api/v1/calendar/feed/${FEED}.ics`], logger: 'console' },
    })
    scope.setTransactionName(`/invite/${INVITE}`)

    client.captureException(new Error(`accept failed for https://mudavym.com/invite/${INVITE}?ref=${RESET}`), {}, scope)
    client.captureMessage(`reset link opened: https://mudavym.com/reset-password?token=${RESET}`, 'warning', {}, scope)
    await client.flush(2000)

    const wire = sent.join('\n')
    expect(sent.length).toBe(2)
    expect(wire).toContain('/invite/<redacted>')
    for (const token of [INVITE, RESET, FEED]) {
      expect(wire).not.toContain(token)
    }
  })
})
