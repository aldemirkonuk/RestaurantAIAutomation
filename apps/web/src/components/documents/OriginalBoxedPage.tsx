/**
 * One page of a PDF original, drawn by us, with ONE outline around the line the
 * sheet has selected.
 *
 * Why we draw the page: a browser's own PDF viewer scrolls, zooms and paginates
 * on its own terms, so a rectangle laid over it would be an estimate. The box
 * here comes from `pdf-line-geometry` on the gateway — the text row that holds
 * the line's printed amount — so it is a citation of the paper, never a guess
 * (ADR 0104). A line with no box never reaches this component.
 *
 * MOTION (ADR 0112, house motion rules). Moving between lines is `transform:
 * translate` only, 180ms on the house curve. The SIZE snaps: width and height
 * are never animated. Under reduced motion there is no transition and no fade.
 * There is no exit animation: with no box the outline is simply not rendered.
 * The page scrolls the box into view with `block: 'nearest'`, smooth only when
 * motion is allowed.
 *
 * A FAILED DRAW SAYS SO (ADR 0020): the line is then not boxed and the sentence
 * says why, rather than showing a blank page that looks like an empty paper.
 */

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../../lib/mudavym/motion'

export interface PageBox {
  page: number
  /** [x0, y0, x1, y1] in 0..1 of the page, y measured from the top. */
  bbox: [number, number, number, number]
}

const HOUSE_CURVE = 'cubic-bezier(0.16, 1, 0.3, 1)'
/** Hundredths of a pixel, so 0.3 × 800 is 240 and not 239.99999999999997. */
const px = (n: number) => Math.round(n * 100) / 100

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  return pdfjs
}

export function OriginalBoxedPage({
  url,
  box,
  onRefresh,
  refreshing,
}: {
  url: string
  box: PageBox
  onRefresh: () => void
  refreshing: boolean
}) {
  const reduced = useReducedMotion()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const outline = useRef<HTMLDivElement>(null)
  const lastPage = useRef<number | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [failed, setFailed] = useState(false)

  // Draw the page. Only a different file or page redraws; a move between lines
  // on the same page leaves the canvas alone.
  useEffect(() => {
    let live = true
    setSize(null)
    setFailed(false)
    void (async () => {
      try {
        const pdfjs = await loadPdfjs()
        const doc = await pdfjs.getDocument({ url }).promise
        const page = await doc.getPage(box.page)
        const base = page.getViewport({ scale: 1 })
        const cssW = wrap.current?.clientWidth || base.width
        const cssH = (cssW * base.height) / base.width
        const dpr = window.devicePixelRatio || 1
        const vp = page.getViewport({ scale: (cssW / base.width) * dpr })
        const el = canvas.current
        const ctx = el?.getContext('2d')
        if (!live || !el || !ctx) throw new Error('no canvas')
        el.width = vp.width
        el.height = vp.height
        await page.render({ canvas: el, canvasContext: ctx, viewport: vp }).promise
        if (live) setSize({ w: cssW, h: cssH })
      } catch {
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [url, box.page])

  const animate = !reduced && lastPage.current === box.page
  useEffect(() => {
    lastPage.current = size ? box.page : null
    outline.current?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [size, box.page, box.bbox, reduced])

  if (failed)
    return (
      <div data-testid="original-page-failed" style={{ fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
        <p style={{ margin: '0 0 6px' }}>
          The page could not be drawn here, so this line is not boxed. The paper itself has not changed.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            padding: '4px 11px',
            borderRadius: 7,
            border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
            background: 'transparent',
            color: 'var(--seal-deep, #14515C)',
            cursor: refreshing ? 'progress' : 'pointer',
          }}
        >
          {refreshing ? 'Fetching a fresh link…' : 'Fetch a fresh link'}
        </button>
      </div>
    )

  const [x0, y0, x1, y1] = box.bbox
  return (
    <div
      ref={wrap}
      data-testid="original-boxed-page"
      style={{ position: 'relative', width: '100%', maxHeight: '60vh', overflow: 'auto' }}
    >
      <div style={{ position: 'relative', width: size?.w, height: size?.h }}>
        <canvas
          ref={canvas}
          aria-label={`Page ${box.page} of the stored document`}
          style={{ display: 'block', width: size?.w ?? '100%', height: size?.h }}
        />
        {size && (
          <div
            ref={outline}
            data-testid="original-box"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              boxSizing: 'border-box',
              width: px((x1 - x0) * size.w),
              height: px((y1 - y0) * size.h),
              transform: `translate(${px(x0 * size.w)}px, ${px(y0 * size.h)}px)`,
              border: '2px solid var(--ink-2, #4F473C)',
              borderRadius: 3,
              pointerEvents: 'none',
              ...(animate ? { transition: `transform 180ms ${HOUSE_CURVE}` } : {}),
            }}
          />
        )}
      </div>
      {!size && <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>Drawing the page…</p>}
    </div>
  )
}

export default OriginalBoxedPage
