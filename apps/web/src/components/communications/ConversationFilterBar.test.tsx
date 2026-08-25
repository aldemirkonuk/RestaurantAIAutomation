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

  describe('time filter', () => {
    it('defaults to All time and opens a custom range panel', () => {
      render(
        <ConversationFilterBar
          filters={EMPTY_CONVERSATION_FILTERS}
          onChange={vi.fn()}
        />,
      )
      const trigger = screen.getByLabelText('Filter by time range')
      expect(trigger).toHaveTextContent('All time')

      fireEvent.click(trigger)
      expect(screen.getByLabelText('From date')).toBeInTheDocument()
      expect(screen.getByLabelText('To date')).toBeInTheDocument()
      expect(screen.getByLabelText('Filter by month')).toBeInTheDocument()
      expect(screen.getByLabelText('Filter by quarter')).toBeInTheDocument()
      expect(document.querySelectorAll('select')).toHaveLength(0)
    })

    it('emits dateFrom/dateTo while preserving other active filters', () => {
      const onChange = vi.fn()
      render(
        <ConversationFilterBar
          filters={{
            ...EMPTY_CONVERSATION_FILTERS,
            providerId: 'prov-1',
            orderNumber: 'WO-7',
            page: 4,
          }}
          onChange={onChange}
        />,
      )
      fireEvent.click(screen.getByLabelText('Filter by time range'))
      fireEvent.change(screen.getByLabelText('From date'), {
        target: { value: '2026-03-01' },
      })

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: '2026-03-01',
          providerId: 'prov-1',
          orderNumber: 'WO-7',
          page: 1,
        }),
      )
    })

    it('clears the range when a quarter is picked so windows never overlap', () => {
      const onChange = vi.fn()
      render(
        <ConversationFilterBar
          filters={{
            ...EMPTY_CONVERSATION_FILTERS,
            dateFrom: '2026-03-01',
            dateTo: '2026-03-31',
          }}
          onChange={onChange}
        />,
      )
      fireEvent.click(screen.getByLabelText('Filter by time range'))
      fireEvent.click(screen.getByLabelText('Filter by quarter'))
      fireEvent.click(screen.getByRole('option', { name: 'Q2' }))

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          quarter: 'Q2',
          dateFrom: '',
          dateTo: '',
          month: '',
        }),
      )
    })

    it('shows one chip for the active window that clears every time field', () => {
      const onChange = vi.fn()
      render(
        <ConversationFilterBar
          filters={{
            ...EMPTY_CONVERSATION_FILTERS,
            dateFrom: '2026-03-01',
            dateTo: '2026-03-31',
          }}
          onChange={onChange}
        />,
      )
      fireEvent.click(
        screen.getByRole('button', { name: /2026-03-01 → 2026-03-31/ }),
      )
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: '',
          dateTo: '',
          month: '',
          quarter: '',
          year: '',
        }),
      )
    })
  })
})
