/**
 * The original, on demand (ADR 0104 D3), when there is nothing to bring
 * (walk-through W8, 2026-10-01). EVERY value below is SYNTHETIC.
 *
 * With no signed link, a "Bring the original" button opened a pane that said
 * "No file was stored" even when a file was stored and only its link failed.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OriginalPane, type OriginalPaneProps } from '../OriginalPane'

const props = (over: Partial<OriginalPaneProps>): OriginalPaneProps => ({
  documentId: 'doc-1',
  imageUrl: null,
  reason: null,
  contentType: null,
  filename: null,
  storagePath: null,
  sourceChannel: 'email',
  fetchedAt: Date.now(),
  onRefresh: vi.fn(),
  refreshing: false,
  ...over,
})

describe('OriginalPane — nothing to bring', () => {
  it('offers no button when no original was stored, and says so', () => {
    render(<OriginalPane {...props({ reason: 'no original was stored for this document' })} />)
    expect(screen.getByTestId('original-unavailable')).toHaveTextContent(
      'No original was stored for this document.',
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('names a failed link as a failure and offers to ask again, never "no file was stored"', async () => {
    const onRefresh = vi.fn()
    render(
      <OriginalPane
        {...props({ reason: 'the stored original could not be signed: synthetic outage', onRefresh })}
      />,
    )
    expect(screen.getByTestId('original-unavailable')).toHaveTextContent(
      'The stored original could not be signed',
    )
    expect(screen.queryByText(/No file was stored/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('still fetches on demand when a signed link exists', () => {
    render(
      <OriginalPane
        {...props({ imageUrl: 'https://example.test/synthetic.png', filename: 'synthetic.png', storagePath: 'synthetic.png' })}
      />,
    )
    expect(screen.getByTestId('open-original')).toHaveTextContent('Bring the original')
  })

  it('sits in a box named "The original", like the provenance under it (W11)', () => {
    // Founder, 2026-10-01: "every component and detail can be read easily …
    // clear divisions".
    const { unmount } = render(<OriginalPane {...props({ reason: 'no original was stored for this document' })} />)
    expect(screen.getByRole('region', { name: 'The original' })).toHaveTextContent(/^The original/)
    unmount()
    render(<OriginalPane {...props({ imageUrl: 'https://example.test/synthetic.png', filename: 'synthetic.png' })} />)
    expect(screen.getByRole('region', { name: 'The original' })).toContainElement(screen.getByTestId('open-original'))
  })
})
