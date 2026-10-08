import { beforeEach, describe, expect, it } from 'vitest'
import { LAST_INVOICE_LATER_KEY, readLastInvoiceLater, writeLastInvoiceLater } from './houseLater'

describe('last-invoice later inscription', () => {
  beforeEach(() => sessionStorage.clear())

  it('notes a dropped filename for its house without making it a required step', () => {
    expect(readLastInvoiceLater('house-1', 'user-1')).toBeNull()
    writeLastInvoiceLater('house-1', 'user-1', 'suvla-sept.pdf')
    expect(readLastInvoiceLater('house-1', 'user-1')).toEqual({ name: 'suvla-sept.pdf' })
  })

  it("never shows one house's note under another house", () => {
    writeLastInvoiceLater('house-1', 'user-1', 'suvla-sept.pdf')
    expect(readLastInvoiceLater('house-2', 'user-1')).toBeNull()
    expect(readLastInvoiceLater(null, 'user-1')).toBeNull()
  })

  it('ignores a note written before the house stamp existed', () => {
    sessionStorage.setItem(LAST_INVOICE_LATER_KEY, JSON.stringify({ name: 'suvla-sept.pdf' }))
    expect(readLastInvoiceLater('house-1', 'user-1')).toBeNull()
  })

  it('notes nothing when no house is open', () => {
    writeLastInvoiceLater(null, 'user-1', 'suvla-sept.pdf')
    expect(sessionStorage.getItem(LAST_INVOICE_LATER_KEY)).toBeNull()
  })

  it("never shows one person's note to another person in the same tab", () => {
    writeLastInvoiceLater('house-1', 'user-1', 'suvla-sept.pdf')
    expect(readLastInvoiceLater('house-1', 'user-2')).toBeNull()
    expect(readLastInvoiceLater('house-1', undefined)).toBeNull()
  })

  it('ignores a note with no person stamp, and notes nothing without a person', () => {
    sessionStorage.setItem(LAST_INVOICE_LATER_KEY, JSON.stringify({ restaurantId: 'house-1', name: 'suvla-sept.pdf' }))
    expect(readLastInvoiceLater('house-1', 'user-1')).toBeNull()
    sessionStorage.clear()
    writeLastInvoiceLater('house-1', undefined, 'suvla-sept.pdf')
    expect(sessionStorage.getItem(LAST_INVOICE_LATER_KEY)).toBeNull()
  })
})
