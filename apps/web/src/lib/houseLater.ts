export const LAST_INVOICE_LATER_KEY = 'mudavym:last-invoice-later'

export function readLastInvoiceLater(): { name: string } | null {
  try {
    const value = sessionStorage.getItem(LAST_INVOICE_LATER_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as { name?: string }
    return parsed.name ? { name: parsed.name } : null
  } catch {
    return null
  }
}

export function writeLastInvoiceLater(name: string) {
  sessionStorage.setItem(LAST_INVOICE_LATER_KEY, JSON.stringify({ name }))
}
