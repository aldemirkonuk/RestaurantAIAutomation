import { useLayoutEffect, useState, type RefObject } from 'react'

const DEFAULT_MAX_W = 448 // Tailwind max-w-md (28rem)

/**
 * Position a fixed dialog below `anchorRef`, right-aligned to the anchor’s right edge.
 * Returns null when `open` is false or no anchor — caller should center in viewport instead.
 */
export function useAnchoredDialogPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null> | undefined,
  modalMaxWidthPx: number = DEFAULT_MAX_W,
): { top: number; left: number } | null {
  const [anchorPos, setAnchorPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setAnchorPos(null)
      return
    }
    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const top = r.bottom + 10
      let left = r.right - modalMaxWidthPx
      left = Math.max(16, left)
      if (left + modalMaxWidthPx > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - modalMaxWidthPx - 16)
      }
      setAnchorPos({ top, left })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchorRef, modalMaxWidthPx])

  return anchorPos
}
