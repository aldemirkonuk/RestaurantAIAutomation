/**
 * Read a 409 off a refused approval (F-775).
 *
 * The gateway answers 409 for two different things (`approveOrder` in
 * `procurement.service.ts`):
 *
 *  - `order_already_approved` — a second manager's hold, a stale tab. The
 *    order IS approved; nothing went wrong. Calling it "still pending, nothing
 *    approved" told the person the opposite of the truth, so a caller treats
 *    this one as settled: no error, the list refetches, the row drops out of
 *    the selection.
 *  - anything else (`order_changed_while_approving`, …) — a whole sentence
 *    written to be read. It is printed as it came, never inside the "still
 *    pending" frame, because the order may no longer be pending at all.
 *
 * Structural, like `alreadyDeliveredRefusal`: a proxy can answer 409 with an
 * HTML page, so a body without a usable sentence is not believed — except for
 * the settled case, whose words this side can say for itself.
 */
export interface ApproveConflict {
  /** True when the order was already approved: the outcome the person wanted. */
  settled: boolean;
  /** The gateway's sentence, printed verbatim. */
  message: string;
}

export function approveConflict(error: unknown): ApproveConflict | null {
  const res = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (!res || res.status !== 409) return null;
  const body = res.data as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== 'object') return null;
  const message = typeof body.message === 'string' && body.message ? body.message : null;
  if (body.reason === 'order_already_approved') {
    return { settled: true, message: message ?? 'This order is already approved.' };
  }
  return message ? { settled: false, message } : null;
}
