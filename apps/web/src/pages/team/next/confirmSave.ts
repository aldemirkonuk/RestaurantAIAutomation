/**
 * An edit whose reply was lost (F-1084).
 *
 * A save can commit and still come back as a timeout or a 5xx. The sheet then
 * said "not saved", the person pressed Try again, and the gateway's
 * compare-and-set refused the retry with "Someone else changed this", about a
 * change that was the person's own. So when a save's outcome is unknown, or a
 * retry after one is refused as changed, the row is read back: if it holds
 * what was sent, the save landed and is answered as saved.
 */
import { getErrorStatus, isUnconfirmedWrite } from '../../../services/api/client';

/** The save may have landed, and the row could not be read back to check. */
export class NotConfirmedError extends Error {
  constructor() {
    super('save not confirmed');
    this.name = 'NotConfirmedError';
  }
}

/**
 * Runs `write`. `landed` reads the row back and answers whether it holds what
 * was sent (`null` = it could not tell). `tried` remembers, across presses of
 * the same sheet, that an earlier attempt went unconfirmed.
 *
 * Resolves `null` when the write is known to have landed only by reading it
 * back; throws `NotConfirmedError` when it may have landed and the read could
 * not say; otherwise passes the write's own answer or refusal through.
 */
export async function saveOrConfirm<T>(
  write: () => Promise<T>,
  landed: () => Promise<boolean | null>,
  tried: { current: boolean },
): Promise<T | null> {
  try {
    const out = await write();
    tried.current = false;
    return out;
  } catch (e) {
    const unconfirmed = isUnconfirmedWrite(e);
    if (!unconfirmed && !(getErrorStatus(e) === 409 && tried.current)) throw e;
    if (unconfirmed) tried.current = true;
    let held: boolean | null;
    try {
      held = await landed();
    } catch {
      held = null;
    }
    if (held === true) {
      tried.current = false;
      return null;
    }
    if (held === null && unconfirmed) throw new NotConfirmedError();
    throw e;
  }
}
