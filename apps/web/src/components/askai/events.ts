/**
 * The window event that opens the Ask AI bar.
 *
 * Its own module so `CommandProvider` — which registers the ⌘⇧K binding, since
 * it owns the global keyboard system — can import the name without importing
 * the bar, its API client, or anything else Ask AI drags in.
 */
export const ASK_AI_OPEN_EVENT = 'wineops:askai-open'
