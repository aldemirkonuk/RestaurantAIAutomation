import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KPICard } from '../../molecules/KPICard'
import { DollarSign } from 'lucide-react'

describe('KPICard', () => {
  const mockCard = {
    id: 'revenue',
    title: 'Total Revenue',
    key: 'revenue',
    icon: DollarSign,
    visible: true,
  }

  const mockValue = {
    value: '$50,000',
    change: 5.5,
    changeType: 'increase' as const,
  }

  it('renders card with metric and trend', () => {
    render(<KPICard card={mockCard} value={mockValue} />)
    
    expect(screen.getByText('Total Revenue')).toBeInTheDocument()
    expect(screen.getByText('$50,000')).toBeInTheDocument()
    expect(screen.getByText('+5.5%')).toBeInTheDocument()
  })

  it('shows delete button in edit mode', () => {
    const onDelete = vi.fn()
    render(<KPICard card={mockCard} value={mockValue} isEditMode onDelete={onDelete} />)
    
    const deleteButton = screen.getByRole('button', { name: /delete/i })
    expect(deleteButton).toBeInTheDocument()
  })

  it('calls onDelete when delete button clicked', () => {
    const onDelete = vi.fn()
    render(<KPICard card={mockCard} value={mockValue} isEditMode onDelete={onDelete} />)
    
    const deleteButton = screen.getByRole('button', { name: /delete/i })
    fireEvent.click(deleteButton)
    
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('calls onEdit when card clicked in edit mode', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <KPICard card={mockCard} value={mockValue} isEditMode onEdit={onEdit} />
    )
    
    const cardElement = container.firstChild as HTMLElement
    fireEvent.click(cardElement)
    
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('shows drag handle in edit mode', () => {
    const { container } = render(
      <KPICard card={mockCard} value={mockValue} isEditMode />
    )
    
    const dragHandle = container.querySelector('.absolute.bottom-2')
    expect(dragHandle).toBeInTheDocument()
  })

  it('applies different styles in edit mode', () => {
    const { container } = render(
      <KPICard card={mockCard} value={mockValue} isEditMode />
    )
    
    const cardElement = container.firstChild as HTMLElement
    expect(cardElement).toHaveClass('border-wine-300')
  })
})
