/**
 * The seal ceremony, driven the way a keyboard drives it — Enter arms (and
 * mints the seal), Enter commits.
 *
 * Lifted from the pattern `components/orders/__tests__/SealedApproveDie.test.tsx`
 * and `pages/dashboard/next/WaitingOnYou.seal.test.tsx` each wrote inline, so a
 * third surface that seals an order (the house counter's sheet, sketch 119 D)
 * is tested by the same gesture rather than a fourth spelling of it. NOT a
 * click: `HoldToApprove` is a hold and a click fires nothing at all, so a test
 * that clicked would pass whatever the control did.
 */

import { fireEvent } from '@testing-library/react';

/** First press: the gesture BEGINS — this is when the seal must be minted. */
export function beginHold(die: HTMLElement): void {
  fireEvent.keyDown(die, { key: 'Enter' });
}

/** Both presses: begin, then commit. */
export function completeHold(die: HTMLElement): void {
  fireEvent.keyDown(die, { key: 'Enter' });
  fireEvent.keyDown(die, { key: 'Enter' });
}
