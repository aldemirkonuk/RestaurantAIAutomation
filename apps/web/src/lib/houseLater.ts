export const LAST_INVOICE_LATER_KEY = 'mudavym:last-invoice-later'

/**
 * The name of the file this tab noted for `restaurantId`'s last invoice, by
 * `userId`, or null. Only the name is noted, and only in this tab: the file is
 * not sent or kept (the last invoice is a later folio, ADR 0213 row 10). A
 * name stamped with another house or another person, or with no house or no
 * person (noted before the stamps existed), is ignored: it cannot be shown to
 * be this house's or this person's (ADR 0309). An invoice's file name can name
 * its supplier. With no house or no person given, nothing is read.
 */
export function readLastInvoiceLater(
  restaurantId: string | null | undefined,
  userId: string | null | undefined,
): { name: string } | null {
  if (!restaurantId || !userId) return null
  try {
    const value = sessionStorage.getItem(LAST_INVOICE_LATER_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as { name?: unknown; restaurantId?: unknown; userId?: unknown }
    if (parsed.restaurantId !== restaurantId) return null
    if (!parsed.userId || parsed.userId !== userId) return null
    return typeof parsed.name === 'string' && parsed.name ? { name: parsed.name } : null
  } catch {
    return null
  }
}

/** Notes a file's name for `restaurantId` and `userId`, in this tab. With no house or no person, nothing is noted. */
export function writeLastInvoiceLater(
  restaurantId: string | null | undefined,
  userId: string | null | undefined,
  name: string,
) {
  if (!restaurantId || !userId) return
  sessionStorage.setItem(LAST_INVOICE_LATER_KEY, JSON.stringify({ restaurantId, userId, name }))
}
