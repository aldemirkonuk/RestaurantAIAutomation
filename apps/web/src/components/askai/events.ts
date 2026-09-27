/**
 * The window event that opens the Ask panel.
 *
 * Its own module so `CommandProvider` — which registers the ⌘⇧K binding, since
 * it owns the global keyboard system — can import the name without importing
 * the panel, its API clients, or anything else Ask drags in.
 *
 * Every door opens the SAME panel (ADR 0145, "One panel, two modes", founder,
 * 2026-09-26, round 6): ⌘⇧K, the header's Ask, the rail's first row, the
 * phone's Ask door, the palette row, and "Keep asking" on an open folio at
 * `/ask`.
 */
export const ASK_AI_OPEN_EVENT = 'wineops:askai-open'

/** What a door may hand the panel as it opens it. */
export interface AskOpenDetail {
  /**
   * "Keep asking" from an open folio: the next question is sent as a re-ask
   * of this folio (`previousFolioId`), so the gateway labels it a follow-up
   * or a correction. The panel shows it and the person can drop it.
   */
  followUp?: { folioId: string; utterance: string }
}

/**
 * Open the Ask panel from anywhere. With no detail it toggles (⌘⇧K twice
 * closes it); with a follow-up it always opens, carrying that folio.
 */
export function openAskAi(detail?: AskOpenDetail): void {
  window.dispatchEvent(new CustomEvent<AskOpenDetail | undefined>(ASK_AI_OPEN_EVENT, { detail }))
}
