import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { IntegrationReturnNotice } from './IntegrationReturnNotice'

// F-822: every reason the gateway can put on the return URL is read from the
// gateway's own source, so a new reason without a sentence fails here.
const service = readFileSync(
  resolve(__dirname, '../../../../api-gateway/src/integrations/integrations-oauth.service.ts'),
  'utf8',
)
const listed = [...(service.match(/INTEGRATION_RETURN_REASONS = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map(m => m[1])
// Literals handed straight to the return URL, read independently of the list
// so a reason emitted but never listed is caught too.
const emitted = new Set([
  ...[...service.matchAll(/resultUrl\([^)]*"error",\s*"([a-z_]+)"/g)].map(m => m[1]),
  ...[...service.matchAll(/refused\("([a-z_]+)"\)/g)].map(m => m[1]),
  ...[...service.matchAll(/ConsentMembershipRefusal\("([a-z_]+)"\)/g)].map(m => m[1]),
  ...[...service.matchAll(/\? "([a-z_]+)"\s*: "([a-z_]+)"/g)].flatMap(m => [m[1], m[2]]),
])
const FALLBACK = /without a confirmed connection/

describe('return notice reasons', () => {
  it('reads the gateway list and every reason the gateway emits is on it', () => {
    expect(listed.length).toBeGreaterThan(5)
    expect(listed).toEqual(expect.arrayContaining(['membership_refused', 'membership_unreadable', 'held_by_another_house']))
    expect(emitted.size).toBeGreaterThan(5)
    expect([...emitted].filter(r => !listed.includes(r))).toEqual([])
  })

  it.each(listed)('has a plain sentence for %s', reason => {
    render(<MemoryRouter initialEntries={[`/profile?integration_status=error&integration=gmail_send&integration_reason=${reason}`]}><IntegrationReturnNotice /></MemoryRouter>)
    expect(screen.queryByText(FALLBACK)).toBeNull()
    expect(screen.getByRole('status').textContent).not.toMatch(/_/)
  })

  it('still falls back for a reason nobody emits', () => {
    render(<MemoryRouter initialEntries={['/profile?integration_status=error&integration_reason=not_a_reason']}><IntegrationReturnNotice /></MemoryRouter>)
    expect(screen.getByText(FALLBACK)).toBeInTheDocument()
  })
})
