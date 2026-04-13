import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PreviewOverlay } from '../../preview/PreviewOverlay'

describe('PreviewOverlay', () => {
  beforeEach(() => {
    // Mock document.body.style
    Object.defineProperty(document.body.style, 'overflow', {
      writable: true,
      value: '',
    })
  })

  afterEach(() => {
    document.body.style.overflow = ''
  })

  it('renders when active', () => {
    render(
      <PreviewOverlay isActive onApply={vi.fn()} onCancel={vi.fn()}>
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    expect(screen.getByText('Preview Content')).toBeInTheDocument()
  })

  it('does not render when inactive', () => {
    const { container } = render(
      <PreviewOverlay isActive={false} onApply={vi.fn()} onCancel={vi.fn()}>
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    expect(container.firstChild).toBeNull()
  })

  it('calls onCancel when backdrop clicked', () => {
    const onCancel = vi.fn()
    render(
      <PreviewOverlay isActive onApply={vi.fn()} onCancel={onCancel}>
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    const backdrop = screen.getByText('Preview Content').closest('.fixed')?.querySelector('.absolute')
    if (backdrop) {
      fireEvent.click(backdrop)
      expect(onCancel).toHaveBeenCalledTimes(1)
    }
  })

  it('calls onApply when Apply button clicked', () => {
    const onApply = vi.fn()
    render(
      <PreviewOverlay isActive onApply={onApply} onCancel={vi.fn()} hasChanges>
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    const applyButton = screen.getByText('Apply Changes')
    fireEvent.click(applyButton)
    
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('disables Apply button when no changes', () => {
    render(
      <PreviewOverlay isActive onApply={vi.fn()} onCancel={vi.fn()} hasChanges={false}>
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    const applyButton = screen.getByText('Apply Changes')
    expect(applyButton).toBeDisabled()
  })

  it('handles ESC key to cancel', () => {
    const onCancel = vi.fn()
    render(
      <PreviewOverlay isActive onApply={vi.fn()} onCancel={onCancel}>
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('handles Enter key to apply when changes exist', () => {
    const onApply = vi.fn()
    render(
      <PreviewOverlay isActive onApply={onApply} onCancel={vi.fn()} hasChanges>
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('prevents body scroll when active', () => {
    const { rerender } = render(
      <PreviewOverlay isActive onApply={vi.fn()} onCancel={vi.fn()}>
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    expect(document.body.style.overflow).toBe('hidden')
    
    rerender(
      <PreviewOverlay isActive={false} onApply={vi.fn()} onCancel={vi.fn()}>
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    expect(document.body.style.overflow).toBe('')
  })

  it('shows zoom controls when onZoomChange provided', () => {
    render(
      <PreviewOverlay 
        isActive 
        onApply={vi.fn()} 
        onCancel={vi.fn()} 
        zoom={100}
        onZoomChange={vi.fn()}
      >
        <div>Preview Content</div>
      </PreviewOverlay>
    )
    
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})
