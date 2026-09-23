/**
 * The Ask panel's open state, owned by whoever mounts the panel (the house
 * shell, or the legacy layout's `AskAiSurface`).
 *
 * The event IS the API (see `AskAiSurface`'s note on why there is no context
 * provider): ⌘⇧K, the header, the rail, the phone door, the palette and "Keep
 * asking" all dispatch `ASK_AI_OPEN_EVENT`, and this hook listens.
 */

import { useCallback, useEffect, useState } from 'react'
import { ASK_AI_OPEN_EVENT, type AskOpenDetail } from './events'

export interface AskPanelState {
  open: boolean
  close: () => void
  /** The folio "Keep asking" carried in, until the person drops it or the panel closes. */
  followUp: AskOpenDetail['followUp'] | null
  dropFollowUp: () => void
}

export function useAskPanel(): AskPanelState {
  const [open, setOpen] = useState(false)
  const [followUp, setFollowUp] = useState<AskOpenDetail['followUp'] | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<AskOpenDetail | undefined>).detail
      if (detail?.followUp) {
        setFollowUp(detail.followUp)
        setOpen(true)
        return
      }
      setOpen((v) => !v)
    }
    window.addEventListener(ASK_AI_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(ASK_AI_OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) setFollowUp(null)
  }, [open])

  const close = useCallback(() => setOpen(false), [])
  const dropFollowUp = useCallback(() => setFollowUp(null), [])
  return { open, close, followUp, dropFollowUp }
}

/**
 * Lock the page's scroll while the panel LIES OVER it (the overlay placement).
 * Docked beside a live page, the page must keep scrolling, so the shell does
 * not call this there.
 */
export function useOverlayScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [active])
}
