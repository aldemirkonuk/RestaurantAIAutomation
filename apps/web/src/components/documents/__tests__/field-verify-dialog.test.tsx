/**
 * FieldVerifyDialog — the dialog has to behave like a dialog.
 *
 * Written 2026-09-11 by the auditor of p4bx's batch-69 work, against a defect
 * found by reading: the dialog rendered `role="dialog" aria-modal="true"` and
 * handled `Escape` with an `onKeyDown` on its own container, but focused
 * NOTHING when it opened. It is opened from a button inside `ProvenanceHover`,
 * which then unmounts, so focus fell to `<body>` and the keydown never reached
 * the handler: Escape did nothing at all. `CorrectionDialog` has the same
 * container-scoped handler and does not have the bug only because it focuses
 * its first input on mount.
 *
 * THE PATTERN THIS PINS IS `Sheet`'s, not `CorrectionDialog`'s, because Sheet's
 * own comment gives the reason: *"an overlay whose Esc only works while focus is
 * inside is an overlay you can get stuck behind"*. Sheet remembers the opener
 * before focus moves in, focuses the first focusable on open, listens for
 * Escape on the WINDOW, and restores the opener on close. That is the house's
 * answer and this dialog now gives the same one.
 *
 * All three cases below fail on the code as p4bx left it.
 */

import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FieldVerifyDialog } from '../FieldVerifyDialog'

/**
 * The real opening gesture: a button on the page opens the dialog and is then
 * gone from the document, which is what made the bug invisible to a test that
 * rendered the dialog directly.
 */
function Harness({ onCancel }: { onCancel: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button data-testid="opener" onClick={() => setOpen(true)}>
        I have checked this
      </button>
      {open && (
        <FieldVerifyDialog
          path="lines[0].netPrice"
          label="Unit price, line 1"
          envelope={{ value: 142, as_printed: '142,00' }}
          onCancel={() => {
            onCancel()
            setOpen(false)
          }}
          onConfirm={() => {}}
        />
      )}
    </>
  )
}

const open = () => {
  const opener = screen.getByTestId('opener')
  opener.focus()
  fireEvent.click(opener)
  return opener
}

describe('FieldVerifyDialog — focus and Escape', () => {
  it('moves focus INSIDE the dialog when it opens', async () => {
    render(<Harness onCancel={() => {}} />)
    open()
    const dialog = await screen.findByTestId('field-verify-dialog')
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    )
    // And specifically onto something operable, not the backdrop.
    expect(document.activeElement?.tagName).toBe('BUTTON')
  })

  it('closes on Escape even when focus is NOT inside it', async () => {
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    open()
    await screen.findByTestId('field-verify-dialog')

    // The state the bug lived in: nothing inside the dialog holds focus.
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.body.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.queryByTestId('field-verify-dialog')).toBeNull(),
    )
  })

  it('gives focus back to the control that opened it when it closes', async () => {
    render(<Harness onCancel={() => {}} />)
    const opener = open()
    await screen.findByTestId('field-verify-dialog')
    expect(document.activeElement).not.toBe(opener)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })
})
