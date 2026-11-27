import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GuidanceStrip } from './GuidanceStrip'

/**
 * ADR 0112: reduced motion is no animation at all, the opacity fade included (r103 mail-8). framer-motion
 * paints its `initial` styles on the first render, so a strip that starts at opacity 0 is a fade in progress.
 */
const props = {
  title: 'A tip',
  body: 'Say what the page does.',
  primaryLabel: 'Take tour',
  onPrimary: () => {},
  onLater: () => {},
  onDismissForever: () => {},
  dismissForeverLabel: "Don't show again",
  ariaLabel: 'Page tip',
  'data-guidance': 'tip-strip',
}

function stubMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('the page tip strip', () => {
  it('starts from nothing and fades in when motion is allowed', () => {
    stubMotion(false)
    render(<GuidanceStrip {...props} />)
    expect(screen.getByRole('region', { name: 'Page tip' }).getAttribute('style') ?? '').toContain('opacity: 0')
  })

  it('is simply there, with no fade, when the person asked for reduced motion', () => {
    stubMotion(true)
    render(<GuidanceStrip {...props} />)
    const style = screen.getByRole('region', { name: 'Page tip' }).getAttribute('style') ?? ''
    expect(style).not.toContain('opacity: 0')
    expect(style).not.toContain('translateY(-4px)')
  })
})
