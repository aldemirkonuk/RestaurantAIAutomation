import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConversationApprovalNotification } from './ConversationApprovalNotification'

/**
 * A vendor's target and offer are the vendor's money. The card printed both
 * behind a literal "$" whatever the vendor quoted in (sim F-341); it now
 * prints the currency the event names, else the bare figure.
 */
const event = (currency?: string | null) => ({
  type: 'ai_conversation_approval' as const,
  conversation_id: 'c1',
  order_id: 'o1',
  provider_name: 'Kavaklidere',
  ai_message: 'We can do the case at 950.',
  conversation_history: [],
  wine_name: 'Okuzgozu 2021',
  target_price: 900,
  current_offer: 950.5,
  currency,
})

describe('ConversationApprovalNotification money', () => {
  it('prints the target and the offer in the money the vendor quoted', () => {
    render(<ConversationApprovalNotification event={event('TRY')} />)
    expect(screen.getByText(/TRY\s?900\.00|₺900\.00/)).toBeInTheDocument()
    expect(screen.getByText(/TRY\s?950\.50|₺950\.50/)).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('prints the bare figures when the vendor named no currency, never "$"', () => {
    render(<ConversationApprovalNotification event={event()} />)
    expect(screen.getByText('900')).toBeInTheDocument()
    expect(screen.getByText('950.50')).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })
})
