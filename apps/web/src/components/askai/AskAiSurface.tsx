/**
 * AskAiSurface — mounts the Ask panel where the house shell is NOT on (the
 * legacy `DashboardLayout`, reachable only through the browser override since
 * `shell` joined LIVE_PAGES). The house shell mounts the panel itself, so it
 * can dock it in the counter's slot (`HouseShell.tsx`).
 *
 * Here the panel always LIES OVER the page: the legacy layout has no counter
 * slot to dock into, and ADR 0145 fork 3 ("Lie over it", 2026-09-25) is the
 * answer for every width without one.
 *
 * NOT A CONTEXT PROVIDER, DELIBERATELY
 * ------------------------------------
 * The panel is opened by ⌘⇧K, the palette row, the rail, the header and "Keep
 * asking", all of which dispatch a window event — the same decoupling
 * `CommandProvider` already uses for `wineops:command-open`. A context nobody
 * reads is API surface pretending to be architecture, so the event IS the API
 * and `useAskPanel` only listens.
 *
 * WHY THE SHORTCUT IS NOT REGISTERED HERE
 * --------------------------------------
 * `CommandProvider` owns the global keyboard system: its ⌘K handler runs in
 * the CAPTURE phase and calls `stopPropagation` so there is one authoritative
 * ⌘K per page. A second capture listener racing it for ⌘⇧K would make the
 * winner depend on mount order. So ⌘⇧K lives in that same switch and arrives
 * here as an event.
 */

import { AskPanel } from './AskPanel'
import { useAskPanel, useOverlayScrollLock } from './useAskPanel'

export function AskAiSurface() {
  const ask = useAskPanel()
  useOverlayScrollLock(ask.open)
  return (
    <AskPanel
      placement="overlay"
      open={ask.open}
      onClose={ask.close}
      followUp={ask.followUp}
      onDropFollowUp={ask.dropFollowUp}
    />
  )
}

export default AskAiSurface
