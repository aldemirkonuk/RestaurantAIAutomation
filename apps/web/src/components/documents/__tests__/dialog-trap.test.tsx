/**
 * The two field dialogs keep the keyboard inside, and hand it back to the field
 * (walk-through RECEIPTS-W31, 2026-10-01).
 *
 * Measured on /receipts, headless: Tab left "Correct …" at the fifth press and
 * "Confirm …" at the second, onto the page behind an aria-modal backdrop, and an
 * Escape pressed from there left "Correct …" open. Both now sit on the house's
 * `Panel` (ADR 0112, walk-through RECEIPTS-W32), which owns all of this; these
 * cases hold the two dialogs to it. The same opening gesture as the page is
 * used here: a field's popover, whose button unmounts once pressed.
 */

import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProvenanceHover } from '../ProvenanceHover'
import { CorrectionDialog } from '../CorrectionDialog'
import { FieldVerifyDialog } from '../FieldVerifyDialog'

const envelope = {
  source: 'extracted' as const,
  confidence: null,
  page: 1,
  as_printed: '142,00',
  verified_by: null,
  verified_at: null,
}

function Page({ onCancel }: { onCancel: () => void }) {
  const [open, setOpen] = useState<null | 'correct' | 'verify'>(null)
  const close = () => {
    onCancel()
    setOpen(null)
  }
  return (
    <>
      <button type="button">before</button>
      <ProvenanceHover
        label="Unit price, line 1"
        envelope={envelope}
        path="lines[0].netPrice"
        onCorrect={() => setOpen('correct')}
        onVerify={() => setOpen('verify')}
      >
        142,00
      </ProvenanceHover>
      <button type="button">after</button>
      {open === 'correct' && (
        <CorrectionDialog
          path="lines[0].netPrice"
          label="Unit price, line 1"
          envelope={{ value: 142, as_printed: '142,00' }}
          onCancel={close}
          onSubmit={() => {}}
        />
      )}
      {open === 'verify' && (
        <FieldVerifyDialog
          path="lines[0].netPrice"
          label="Unit price, line 1"
          envelope={{ value: 142, as_printed: '142,00' }}
          onCancel={close}
          onConfirm={() => {}}
        />
      )}
    </>
  )
}

const field = () => screen.getByRole('button', { name: 'Where Unit price, line 1 came from' })

async function openBy(user: ReturnType<typeof userEvent.setup>, which: 'correct' | 'verify') {
  field().focus()
  await user.tab()
  if (which === 'verify') await user.tab()
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  return dialog
}

describe.each(['correct', 'verify'] as const)('the %s dialog by keyboard (W31, W32)', (which) => {
  it('Tab and Shift+Tab never leave it', async () => {
    const user = userEvent.setup()
    render(<Page onCancel={() => {}} />)
    const dialog = await openBy(user, which)
    for (let i = 0; i < 12; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 12; i++) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('the page behind holds still while it is open, and is let go after', async () => {
    const user = userEvent.setup()
    render(<Page onCancel={() => {}} />)
    document.body.style.overflow = 'auto'
    await openBy(user, which)
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  it('focus lands where the job starts, and the way out is a word', async () => {
    const user = userEvent.setup()
    render(<Page onCancel={() => {}} />)
    const dialog = await openBy(user, which)
    // Correcting starts by typing; confirming starts on the control that writes nothing.
    if (which === 'correct') expect(document.activeElement).toBe(screen.getByTestId('correction-value'))
    else expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    // Never the field's key (walk-through RECEIPTS-W33).
    expect(dialog.textContent).not.toContain('lines[0].netPrice')
  })

  it('Escape closes it from anywhere and the field holds focus, closed', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<Page onCancel={onCancel} />)
    await openBy(user, which)
    ;(document.activeElement as HTMLElement).blur()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(field()).toHaveFocus()
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group')).toBeNull()
  })

  // Pressed with the mouse while the field already holds focus: the field
  // fires no focus event then, so nothing may be left waiting to swallow one.
  it('the field opens again on the next real focus', async () => {
    const user = userEvent.setup()
    render(<Page onCancel={() => {}} />)
    act(() => field().focus())
    const action = screen.getByRole('button', {
      name: which === 'correct' ? 'Correct this' : 'I have checked this',
    })
    fireEvent.mouseDown(action, { detail: 1 })
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(field()).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(field()).toHaveFocus()
    expect(screen.getByRole('group')).toBeInTheDocument()
  })
})
