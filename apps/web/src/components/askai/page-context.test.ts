/**
 * Page context is the only reason "reorder this" can work, and the only place
 * the UI puts words into the model's mouth. Both halves get pinned here.
 */

import { describe, it, expect } from 'vitest'
import { composeUtterance, derivePageContext } from './page-context'

const ID = '11111111-1111-4111-8111-111111111111'

describe('derivePageContext', () => {
  it('names the page in words an operator would recognise', () => {
    expect(derivePageContext('/orders').label).toBe('Orders')
    expect(derivePageContext('/inventory').label).toBe('Inventory')
  })

  it('picks up the record the route already names', () => {
    const ctx = derivePageContext(`/orders/${ID}`)
    expect(ctx.recordId).toBe(ID)
    expect(ctx.line).toContain(ID)
  })

  it('falls back to the query string when the path carries no id', () => {
    expect(derivePageContext('/inventory', `?item=${ID}`).recordId).toBe(ID)
  })

  it('does not invent a record id out of a plain route', () => {
    expect(derivePageContext('/inventory').recordId).toBeUndefined()
  })
})

describe('composeUtterance', () => {
  it('appends the context line the operator can see', () => {
    const ctx = derivePageContext('/orders')
    const sent = composeUtterance('  draft a reply  ', ctx)

    expect(sent.startsWith('draft a reply')).toBe(true)
    expect(sent).toContain(ctx.line)
  })

  it('sends exactly the words typed when context is off', () => {
    // Not a nicety: this is the escape hatch for an operator who does not want
    // the page steering a proposal that becomes a purchase order.
    expect(composeUtterance('  order 6 barolo ', null)).toBe('order 6 barolo')
  })
})
