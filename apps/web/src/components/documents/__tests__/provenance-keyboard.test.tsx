/**
 * ProvenanceHover — a popover that holds actions has to be reachable.
 *
 * Walk-through RECEIPTS-W30 (2026-10-01), measured headless on /receipts: Tab
 * from a field went to "Correct this", the field's blur closed the popover, the
 * focused button was unmounted, and focus fell to <body>. A mouse crossing the
 * 4px gap below the field closed it before it arrived. So a popover with
 * actions is a disclosure the field expands, focus moving inside it keeps it
 * open, Escape gives focus back to the field, and a popover with nothing to
 * press stays a tooltip.
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProvenanceHover } from '../ProvenanceHover'

const envelope = {
  source: 'extracted' as const,
  confidence: null,
  page: 1,
  as_printed: '12.50',
  verified_by: null,
  verified_at: null,
}

function setup(actions = true) {
  const onCorrect = vi.fn()
  const onVerify = vi.fn()
  render(
    <div>
      <ProvenanceHover
        label="Unit price, line 1"
        envelope={envelope}
        path={actions ? 'lines[0].netPrice' : undefined}
        onCorrect={actions ? onCorrect : undefined}
        onVerify={actions ? onVerify : undefined}
      >
        12.50
      </ProvenanceHover>
      <button type="button">after</button>
    </div>,
  )
  const trigger = screen.getByRole('button', { name: 'Where Unit price, line 1 came from' })
  return { onCorrect, onVerify, trigger }
}

describe('ProvenanceHover by keyboard (W30)', () => {
  it('Tab from the field lands on "Correct this" and the popover stays open', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()
    await user.tab()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const group = screen.getByRole('group', { name: 'Where Unit price, line 1 came from' })
    expect(trigger).toHaveAttribute('aria-controls', group.id)
    // A tooltip may hold nothing to press, so this one is not described as one.
    expect(trigger).not.toHaveAttribute('aria-describedby')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Correct this' })).toHaveFocus()
    expect(screen.getByRole('group')).toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('button', { name: 'I have checked this' })).toHaveFocus()
  })

  it('Escape inside closes it and gives focus back to the field, which does not reopen', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()
    await user.tab()
    await user.tab()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('group')).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('Tab past the last action closes it', async () => {
    const user = userEvent.setup()
    setup()
    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('Enter and Space act once each', async () => {
    const user = userEvent.setup()
    const { onCorrect, onVerify } = setup()
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onCorrect).toHaveBeenCalledTimes(1)
    expect(onCorrect).toHaveBeenCalledWith('lines[0].netPrice', 'Unit price, line 1')
    expect(onVerify).not.toHaveBeenCalled()
  })

  it('Space on "I have checked this" acts once', async () => {
    const user = userEvent.setup()
    const { onCorrect, onVerify } = setup()
    await user.tab()
    await user.tab()
    await user.tab()
    await user.keyboard(' ')
    expect(onVerify).toHaveBeenCalledTimes(1)
    expect(onCorrect).not.toHaveBeenCalled()
  })

  // user-event moves the pointer with a null relatedTarget, which React reads as
  // the pointer leaving the window; a browser names the element entered. So the
  // mouse is driven with the events a browser sends, and the gap itself is
  // measured headless (the sketch's trace), not here.
  it('a mouse click still acts exactly once', async () => {
    const user = userEvent.setup()
    const { onCorrect, trigger } = setup()
    await user.hover(trigger)
    const button = screen.getByRole('button', { name: 'Correct this' })
    fireEvent.mouseOut(trigger, { relatedTarget: button })
    fireEvent.mouseOver(button, { relatedTarget: trigger })
    fireEvent.mouseDown(button, { detail: 1 })
    fireEvent.mouseUp(button, { detail: 1 })
    fireEvent.click(button, { detail: 1 })
    expect(onCorrect).toHaveBeenCalledTimes(1)
  })

  it('the space between field and popover belongs to the popover', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()
    await user.hover(trigger)
    const group = screen.getByRole('group')
    expect(group.style.marginTop).toBe('')
    expect(group.style.paddingTop).toBe('4px')
  })

  it('the pointer leaving does not close it while the keyboard stands inside', async () => {
    const user = userEvent.setup()
    const { trigger } = setup()
    await user.tab()
    await user.tab()
    await user.hover(trigger)
    await user.unhover(trigger)
    expect(screen.getByRole('button', { name: 'Correct this' })).toHaveFocus()
    expect(screen.getByRole('group')).toBeInTheDocument()
  })

  it('a read-only field stays a tooltip', async () => {
    const user = userEvent.setup()
    const { trigger } = setup(false)
    await user.tab()
    const tip = screen.getByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-describedby', tip.id)
    expect(trigger).not.toHaveAttribute('aria-expanded')
    expect(screen.queryByRole('group')).toBeNull()
  })
})
