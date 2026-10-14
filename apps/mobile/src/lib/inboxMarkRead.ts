/**
 * What "Mark read" on the phone's inbox reaches (F-1659).
 *
 * It used to send `PATCH /notifications/read/all` for the house: every unread
 * line went, the ones past the fifty the phone had loaded and the orders
 * waiting for approval among them, unseen and with no question asked. Now it
 * marks only the unread lines on screen, never an approval line (an order is
 * approved or turned down, not marked read), and the screen asks first, saying
 * how many it marks and what it leaves.
 */

/** The line types that ask for an order's approval (web `APPROVAL_NOTIFICATION_TYPES`). */
export const APPROVAL_TYPES: ReadonlySet<string> = new Set(["order_pending"]);

export interface MarkReadScope {
  /** The unread, non-approval lines on screen, in the order shown. */
  ids: string[];
  /** Unread approval lines on screen, left open. */
  approvals: number;
}

export function markReadScope(
  items: Array<{ id: string; type?: string | null; status?: string | null }>,
): MarkReadScope {
  const ids: string[] = [];
  let approvals = 0;
  for (const n of items) {
    if (n.status !== "unread") continue;
    if (n.type && APPROVAL_TYPES.has(n.type)) approvals++;
    else ids.push(n.id);
  }
  return { ids, approvals };
}

/** How many ids one bulk request carries (as the web bell slices them). */
export const MARK_READ_SLICE = 100;

export function markReadSlices(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += MARK_READ_SLICE)
    out.push(ids.slice(i, i + MARK_READ_SLICE));
  return out;
}

/**
 * The button and the question, in plain words. `unreadInHouse` is the house's
 * whole unread count, or null when it could not be read.
 */
export function markReadWords(
  scope: MarkReadScope,
  unreadInHouse: number | null,
): { button: string; title: string; message: string } {
  const n = scope.ids.length;
  const button = n === 1 ? "Mark this read" : `Mark these ${n} read`;
  const title = n === 1 ? "Mark this line read?" : `Mark these ${n} lines read?`;
  const stays: string[] = [];
  if (scope.approvals > 0)
    stays.push(
      `${scope.approvals} ${scope.approvals === 1 ? "order waits" : "orders wait"} for your approval`,
    );
  const onScreen = n + scope.approvals;
  if (unreadInHouse === null) stays.push("any further down could not be counted");
  else if (unreadInHouse > onScreen) {
    const more = unreadInHouse - onScreen;
    stays.push(`${more} further down ${more === 1 ? "is" : "are"} not shown`);
  }
  const only = "Only the lines on this screen.";
  const message =
    stays.length === 0 ? only : `${only} These stay unread: ${stays.join("; ")}.`;
  return { button, title, message };
}
