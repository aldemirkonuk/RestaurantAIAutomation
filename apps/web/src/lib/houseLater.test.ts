import { describe, expect, it } from 'vitest'
import { readLastInvoiceLater, writeLastInvoiceLater } from './houseLater'

describe('last-invoice later inscription', () => {
  it('keeps a dropped filename without making it a required step', () => {
    sessionStorage.clear()
    expect(readLastInvoiceLater()).toBeNull()
    writeLastInvoiceLater('suvla-sept.pdf')
    expect(readLastInvoiceLater()).toEqual({ name: 'suvla-sept.pdf' })
  })
})
