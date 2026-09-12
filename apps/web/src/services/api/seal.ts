/**
 * The two rules every sealed write in the browser obeys, in ONE place.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS (2026-09-11, batch 69)
 * ---------------------------------------------------------------------------
 * `documents.ts` wrote both of these down on 2026-09-06 for the three acts of
 * the /receipts face, and noted beside them that `orders.ts` states the same
 * rule for the order seal — "this is that rule, not a second copy of the
 * policy". Batch 69 seals the two acts on ADR 0104's canonical face, which live
 * in `canonical.ts`. A THIRD copy would have made the sentence in that comment
 * false, and a policy that exists in three files is a policy that will be three
 * different policies by the end of the quarter.
 *
 * So the two rules move here and `documents.ts` imports them. Nothing about
 * either changed; `orders.ts` is left alone deliberately, because rewriting a
 * sealed path this pass did not otherwise touch is a change nobody asked for.
 */

import axios from 'axios'
import { getErrorMessage } from './client'

/**
 * The header every sealed write in this product carries its proof back in.
 *
 * One name, one shape, across orders, payment methods, text credits and the
 * five procurement document acts. The seal is not one of the arguments it is a
 * seal OVER, so it never travels in the body.
 */
export const SEAL_HEADER = 'X-Seal-Challenge'

/** The request config that carries a seal, or nothing when there is none. */
export const sealed = (challenge?: string | null) =>
  challenge ? { headers: { [SEAL_HEADER]: challenge } } : undefined

/**
 * THE REFUSAL HAS TO SURVIVE THE TRIP.
 *
 * The gateway answers a refused seal with a whole sentence naming what did not
 * match and saying that nothing was changed. An axios error carries that in
 * `response.data.message` and puts "Request failed with status code 403" in
 * `.message`, which is what most call sites read. So the server's sentence is
 * promoted onto `.message` and the SAME error object is rethrown — `response`,
 * `status` and `isAxiosError` all intact, because callers branch on
 * `err.response?.status` elsewhere.
 */
export function rethrowSpoken(error: unknown): never {
  if (axios.isAxiosError(error)) {
    const spoken = getErrorMessage(error)
    if (spoken) error.message = spoken
  }
  throw error
}
