/**
 * The last invoice dropped on /house, kept for this tab so its seller can be
 * proposed after a reload (r109 onboarding g2, ADR 0144 §1). Keyed by house:
 * a note left under another house is ignored. Storage that throws reads as none.
 */
export const LAST_INVOICE_KEY = 'mudavym:house-last-invoice'

export function writeLastInvoice(houseId: string | null | undefined, docId: string) {
  if (!houseId || !docId) return
  try {
    sessionStorage.setItem(LAST_INVOICE_KEY, JSON.stringify({ houseId, docId }))
  } catch {
    /* storage blocked: the proposal lasts this page only */
  }
}

export function readLastInvoice(houseId: string | null | undefined): string | null {
  if (!houseId) return null
  try {
    const raw = sessionStorage.getItem(LAST_INVOICE_KEY)
    if (!raw) return null
    const kept = JSON.parse(raw) as { houseId?: string; docId?: string }
    return kept.houseId === houseId && typeof kept.docId === 'string' && kept.docId ? kept.docId : null
  } catch {
    return null
  }
}
