/**
 * The outline on the original: a citation of one text row, drawn on a page we
 * render ourselves. EVERY value is SYNTHETIC. pdfjs is mocked: jsdom has no
 * canvas, and the geometry itself is proven on the gateway.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OriginalPane, type OriginalPaneProps } from './OriginalPane'
import type { FieldEnvelope } from '../../services/api/canonical'

const state = vi.hoisted(() => ({ fail: false }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: state.fail
      ? Promise.reject(new Error('synthetic'))
      : Promise.resolve({
          getPage: async () => ({
            getViewport: () => ({ width: 600, height: 800 }),
            render: () => ({ promise: Promise.resolve() }),
          }),
        }),
  }),
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))

const env = (page: number | null, bbox: [number, number, number, number] | null) =>
  ({ value: 1, source: 'extracted', confidence: null, page, bbox }) as FieldEnvelope<unknown>

const props = (over: Partial<OriginalPaneProps>): OriginalPaneProps => ({
  documentId: 'doc-1',
  imageUrl: 'https://example.test/synthetic.pdf',
  reason: null,
  contentType: 'application/pdf',
  filename: 'synthetic.pdf',
  storagePath: 'synthetic.pdf',
  sourceChannel: 'email',
  fetchedAt: Date.now(),
  onRefresh: vi.fn(),
  refreshing: false,
  selectedLabel: 'Line 1',
  ...over,
})

function reduced(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('reduce'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

const scroll = vi.fn()
beforeEach(() => {
  state.fail = false
  scroll.mockClear()
  Element.prototype.scrollIntoView = scroll
  HTMLCanvasElement.prototype.getContext = (() => ({})) as never
  reduced(false)
})
afterEach(() => vi.restoreAllMocks())

async function open(over: Partial<OriginalPaneProps>) {
  const view = render(<OriginalPane {...props(over)} />)
  await userEvent.click(screen.getByTestId('open-original'))
  return view
}

describe('OriginalPane — the outline', () => {
  it('puts one outline where the bbox says, in page pixels, and says which page', async () => {
    await open({ selectedEnvelope: env(2, [0.1, 0.2, 0.5, 0.3]) })
    const box = await screen.findByTestId('original-box')
    // Page drawn 600 x 800 css px.
    expect(box.style.transform).toBe('translate(60px, 160px)')
    expect(box.style.width).toBe('240px')
    expect(box.style.height).toBe('80px')
    expect(box.style.border).toContain('2px solid')
    expect(box.style.borderRadius).toBe('3px')
    expect(screen.getByText(/Line 1 — page 2, outlined on the original/)).toBeInTheDocument()
    expect(screen.getAllByTestId('original-box')).toHaveLength(1)
  })

  it('moves between lines with transform only, 180ms on the house curve, never width or height', async () => {
    const { rerender } = await open({ selectedEnvelope: env(1, [0.1, 0.2, 0.5, 0.3]) })
    const first = await screen.findByTestId('original-box')
    expect(first.style.transition).toBe('')
    rerender(<OriginalPane {...props({ selectedEnvelope: env(1, [0.2, 0.5, 0.6, 0.55]) })} />)
    const box = screen.getByTestId('original-box')
    expect(box.style.transform).toBe('translate(120px, 400px)')
    expect(box.style.transition).toBe('transform 180ms cubic-bezier(0.16, 1, 0.3, 1)')
    expect(box.style.transition).not.toMatch(/width|height|opacity/)
    expect(box.style.width).toBe('240px')
    expect(box.style.height).toBe('40px')
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' }))
  })

  it('has no transition and no fade under reduced motion, and scrolls without smoothing', async () => {
    reduced(true)
    const { rerender } = await open({ selectedEnvelope: env(1, [0.1, 0.2, 0.5, 0.3]) })
    await screen.findByTestId('original-box')
    rerender(<OriginalPane {...props({ selectedEnvelope: env(1, [0.2, 0.5, 0.6, 0.55]) })} />)
    const box = screen.getByTestId('original-box')
    expect(box.style.transition).toBe('')
    expect(box.style.opacity).toBe('')
    expect(box.style.animation).toBe('')
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' }))
  })

  it('draws nothing and says no position kept when the line has no bbox', async () => {
    await open({ selectedEnvelope: env(null, null) })
    expect(screen.queryByTestId('original-box')).toBeNull()
    expect(screen.getByText(/no position kept on the original, so nothing is boxed/)).toBeInTheDocument()
  })

  it('never boxes a photo, even if an envelope carried a bbox', async () => {
    await open({
      imageUrl: 'https://example.test/synthetic.png',
      contentType: 'image/png',
      filename: 'synthetic.png',
      selectedEnvelope: env(1, [0.1, 0.2, 0.5, 0.3]),
    })
    expect(screen.queryByTestId('original-box')).toBeNull()
    expect(screen.getByText(/no position kept/)).toBeInTheDocument()
  })

  it('names a failed page draw and offers a fresh link, with no outline', async () => {
    state.fail = true
    const onRefresh = vi.fn()
    await open({ onRefresh, selectedEnvelope: env(1, [0.1, 0.2, 0.5, 0.3]) })
    expect(await screen.findByTestId('original-page-failed')).toHaveTextContent('could not be drawn here')
    expect(screen.queryByTestId('original-box')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Fetch a fresh link' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('removes the outline with no exit animation when the next line has none', async () => {
    const { rerender } = await open({ selectedEnvelope: env(1, [0.1, 0.2, 0.5, 0.3]) })
    await screen.findByTestId('original-box')
    rerender(<OriginalPane {...props({ selectedEnvelope: env(null, null) })} />)
    expect(screen.queryByTestId('original-box')).toBeNull()
  })
})
