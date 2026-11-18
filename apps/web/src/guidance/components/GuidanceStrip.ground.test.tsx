import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GuidanceStrip } from './GuidanceStrip'
import { BrandMark } from '../../components/brand/BrandMark'

describe('ground hooks the charcoal stylesheet relies on', () => {
  it('the tip strip carries the strip, title, body and action hooks', () => {
    const { container } = render(
      <GuidanceStrip
        data-guidance="tip-strip"
        ariaLabel="Page tip"
        title="T"
        body="B"
        primaryLabel="Take tour"
        onPrimary={() => {}}
        onLater={() => {}}
        onDismissForever={() => {}}
        dismissForeverLabel="Don't show again"
      />,
    )
    expect(container.querySelector('.mdv-guidance-strip')).not.toBeNull()
    expect(container.querySelector('.mdv-guidance-title')).not.toBeNull()
    expect(container.querySelector('.mdv-guidance-body')).not.toBeNull()
    expect(container.querySelector('.mdv-guidance-primary')).not.toBeNull()
    expect(container.querySelectorAll('.mdv-guidance-quiet')).toHaveLength(2)
  })

  it('the ink brand mark reads the ink token, not a fixed charcoal hex', () => {
    const { container } = render(<BrandMark variant="mark" />)
    const cls = container.querySelector('span')!.className
    expect(cls).toContain('text-inkm-1')
    expect(cls).not.toContain('text-[#211C16]')
  })
})
