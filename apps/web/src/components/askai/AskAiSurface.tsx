/**
 * AskAiSurface — mounts the global Ask AI bar and owns its open state.
 *
 * Rendered once inside the authenticated layout, beside the ⌘K palette.
 *
 * NOT A CONTEXT PROVIDER, DELIBERATELY
 * ------------------------------------
 * The obvious shape here is `<AskAiProvider>{children}</AskAiProvider>` with a
 * `useAskAi()` hook. Nothing would call it: the bar is opened by ⌘⇧K and by one
 * palette command, both of which dispatch a window event — the same decoupling
 * `CommandProvider` already uses for `wineops:command-open`. A context nobody
 * reads is API surface pretending to be architecture, so the event IS the API
 * and this component only listens.
 *
 * WHY THE SHORTCUT IS NOT REGISTERED HERE
 * --------------------------------------
 * `CommandProvider` says of itself that it "owns the global keyboard system",
 * and it means it: its ⌘K handler runs in the CAPTURE phase and calls
 * `stopPropagation` precisely so there is one authoritative ⌘K per page. A
 * second capture listener racing it for ⌘⇧K would be the fight the founder said
 * not to pick, and the winner would depend on mount order — the worst kind of
 * bug to own. So ⌘⇧K lives in that same switch and arrives here as an event.
 */

import { useCallback, useEffect, useState } from 'react'
import { AskAiBar } from './AskAiBar'
import { ASK_AI_OPEN_EVENT } from './events'

export function AskAiSurface() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    const onOpen = () => setOpen((v) => !v)
    window.addEventListener(ASK_AI_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(ASK_AI_OPEN_EVENT, onOpen)
  }, [])

  // Lock background scroll while the bar is open — the same treatment the
  // palette gives its overlays, so the two cannot leave the body stuck.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return <AskAiBar open={open} onClose={close} />
}

export default AskAiSurface
