import { describe, expect, it } from 'vitest'
import { returnPathAfterSignIn } from './returnPath'

describe('returnPathAfterSignIn (F-213)', () => {
  it('keeps the query and hash of the page a signed-out visitor was sent away from', () => {
    const state = { from: { pathname: '/inventory', search: '?item=42&from=mail', hash: '#lots' } }
    expect(returnPathAfterSignIn('', state)).toBe('/inventory?item=42&from=mail#lots')
  })

  it('keeps the whole ?redirect= path, query included', () => {
    expect(returnPathAfterSignIn('?redirect=%2Forders%3Frecurring%3Dabc', null)).toBe('/orders?recurring=abc')
  })

  it.each([
    'https://evil.example/steal',
    '//evil.example/steal',
    '/\\evil.example',
    'javascript:alert(1)',
    'orders',
  ])('sends a redirect that is not a path on this site (%s) home instead', (raw) => {
    expect(returnPathAfterSignIn(`?redirect=${encodeURIComponent(raw)}`, null)).toBe('/')
  })

  it('refuses router state that points off this site', () => {
    expect(returnPathAfterSignIn('', { from: { pathname: '//evil.example', search: '' } })).toBe('/')
  })

  it('goes home when nothing says where to', () => {
    expect(returnPathAfterSignIn('', undefined)).toBe('/')
    expect(returnPathAfterSignIn('', { from: { pathname: 42 } })).toBe('/')
  })
})
