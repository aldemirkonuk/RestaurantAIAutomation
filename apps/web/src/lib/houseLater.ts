export const LAST_INVOICE_LATER_KEY = 'mudavym:last-invoice-later'

/**
 * The name of the file this tab noted for `restaurantId`'s last invoice, or
 * null. Only the name is noted, and only in this tab: the file is not sent or
 * kept (the last invoice is a later folio, ADR 0213 row 10). A name stamped
 * with another house, or with none (noted before the stamp existed), is
 * ignored: it cannot be shown to be this house's (ADR 0309).
 */
export function readLastInvoiceLater(restaurantId: string | null): { name: string } | null {
  if (!restaurantId) return null
  try {
    const value = sessionStorage.getItem(LAST_INVOICE_LATER_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as { name?: unknown; restaurantId?: unknown }
    if (parsed.restaurantId !== restaurantId) return null
    return typeof parsed.name === 'string' && parsed.name ? { name: parsed.name } : null
  } catch {
    return null
  }
}

/** Notes a file's name for `restaurantId`, in this tab. With no house, nothing is noted. */
export function writeLastInvoiceLater(restaurantId: string | null, name: string) {
  if (!restaurantId) return
  sessionStorage.setItem(LAST_INVOICE_LATER_KEY, JSON.stringify({ restaurantId, name }))
}
