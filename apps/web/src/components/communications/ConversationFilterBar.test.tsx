import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConversationFilterBar } from './ConversationFilterBar'
import { EMPTY_CONVERSATION_FILTERS } from '../../lib/conversationFilters'

describe('ConversationFilterBar', () => {
  it('renders theme selects (not native <select>) for direction and sentiment', () => {
    render(
      <ConversationFilterBar
        filters={EMPTY_CONVERSATION_FILTERS}
        onChange={vi.fn()}
      />,
    )
    expect(document.querySelectorAll('select')).toHaveLength(0)
    expect(screen.getByLabelText('Filter by direction')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by sentiment')).toBeInTheDocument()
  })

  it('emits sentiment=negative when that option is chosen', () => {
    const onChange = vi.fn()
    render(
      <ConversationFilterBar
        filters={EMPTY_CONVERSATION_FILTERS}
        onChange={onChange}
        sentimentCounts={{ negative: 4, positive: 2, neutral: 10 }}
      />,
    )
    fireEvent.click(screen.getByLabelText('Filter by sentiment'))
    fireEvent.click(screen.getByRole('option', { name: /Negative/ }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sentiment: 'negative', page: 1 }),
    )
  })

  it('shows a dismissible chip for active sentiment filter', () => {
    const onChange = vi.fn()
    render(
      <ConversationFilterBar
        filters={{ ...EMPTY_CONVERSATION_FILTERS, sentiment: 'positive' }}
        onChange={onChange}
      />,
    )
    const chip = screen.getByRole('button', { name: /Positive/ })
    fireEvent.click(chip)
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sentiment: '' }),
    )
  })
})
