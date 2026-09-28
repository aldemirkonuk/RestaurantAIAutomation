/**
 * CorrectionDialog — the unreadable-value guard is load-bearing. Pin it.
 *
 * Written 2026-09-11 by the auditor of p4bx's batch-69 work. It began as a
 * suspected defect and was measured to be a NON-defect, which is why the
 * component was not changed and this test exists instead.
 *
 * THE SUSPICION. `onApprove` sends
 * `onChallenge ? held.current : (reading() as { value: unknown }).value` — and
 * `reading()` can return `{ ok: false, why }`, whose `.value` is `undefined`.
 * A cast is hiding that from the compiler. `undefined` would be dropped from
 * the JSON body by axios, and the gateway's write uses `body.value ?? null`, so
 * the correction would record "the document states nothing here" — a silent
 * wrong write on the one path with no seal to catch it.
 *
 * THE MEASUREMENT. A same-depth probe copy of this component with ONLY
 * `disabled={!!busy || !read.ok}` weakened to `disabled={!!busy}` DID post
 * `undefined` through exactly the gesture below (probe run 2026-09-11, then
 * deleted). The real component sent nothing. So the cast is unreachable, and
 * what makes it unreachable is the `disabled` guard plus `HoldToApprove`'s own
 * `if (disabled || committedRef.current) return` at the top of both
 * `onKeyDown` and `onPointerDown`.
 *
 * That is a guarantee held in two files by two mechanisms, and nothing else in
 * the suite would notice if either end moved. This test is the notice.
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CorrectionDialog } from '../CorrectionDialog'

const props = (onSubmit: (v: unknown, r: string, c?: string | null) => void) => ({
  path: 'lines[0].netPrice',
  label: 'Unit price, line 1',
  envelope: { value: 142, as_printed: '142,00' },
  onCancel: () => {},
  /*
   * NO `onChallenge` ON PURPOSE. This is the unsealed fallback — the branch no
   * caller reaches today (`CanonicalDocumentPage` always passes one) and the
   * branch a future caller would reach first.
   */
  onSubmit,
})

const control = () =>
  screen.getByRole('button', { name: /Hold to seal this correction|Type a value/ })

describe('CorrectionDialog — a figure the field cannot take is never sent', () => {
  it('sends nothing when the value becomes unreadable between arming and committing', () => {
    const onSubmit = vi.fn()
    render(<CorrectionDialog {...props(onSubmit)} />)

    // Arm on a readable figure, then break it inside the three-second window
    // the keyboard path leaves open, then complete the gesture.
    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: '132' } })
    fireEvent.keyDown(control(), { key: 'Enter' })
    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: 'abc' } })
    fireEvent.keyDown(control(), { key: 'Enter' })

    // Nothing at all — and in particular not `undefined`, which the gateway
    // would read as "the document states nothing here".
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('says why, and disables the control, rather than looking alive and doing nothing', () => {
    render(<CorrectionDialog {...props(vi.fn())} />)
    fireEvent.change(screen.getByTestId('correction-value'), { target: { value: 'abc' } })

    expect(screen.getByTestId('correction-unreadable').textContent).toMatch(/not a number/)
    // BOTH halves of the guarantee: the label changes AND the control is
    // disabled. `HoldToApprove` refuses to arm or commit while disabled.
    expect(control().textContent).toMatch(/Type a value this field can take/)
    expect((control() as HTMLButtonElement).disabled).toBe(true)
  })
})
