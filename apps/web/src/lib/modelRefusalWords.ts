/**
 * A refusal from a model-backed reader, in the house's words.
 *
 * WHY. A gateway with no model key answered the photo count with "Anthropic
 * API key not configured — set ANTHROPIC_API_KEY", and the receipts chain's
 * SpotCountPanel toast printed it to a restaurant user (browser walk
 * 2026-11-12). #1095 rewords that refusal at the gateway; this file is the
 * page's own guard, so a chain or a gateway without #1095 still never shows
 * an operator's sentence. The operator's fix belongs in the gateway log.
 *
 * Only a message that names the operator's machinery is replaced. Any other
 * refusal (an unreadable photo, a timeout) is passed through as it came.
 *
 * OFF IS NOT DOWN. A missing key means the feature is not switched on, and
 * nothing the house does later changes that. A vendor error (an overload, a
 * 5xx, exhausted credit) means a reader that IS switched on failed this once,
 * and the house should hear that it can try again. The split is the gateway's
 * own (`paperReaderSaid` in `document-intake.service.ts`: key or
 * not-configured is OFF, anything else is DOWN), so the paper notes and the
 * photo toast never disagree about one outage.
 */

/** The key is missing: the reader is not switched on. Same test as `paperReaderSaid`. */
const READER_OFF_WORDS = /api[\s_-]?key|not configured/i

/** The vendor or its billing, with a key present: the reader is down, not off. */
const VENDOR_WORDS = /anthropic|credit balance|overloaded/i

/** The clause #1095's gateway sends (`photo-count.service.ts` PHOTO_READER_OFF). */
export const PHOTO_COUNT_OFF = 'counting from a photo is not switched on here yet'

/** A reader that is switched on failed this time. One clause, like PHOTO_COUNT_OFF. */
export const PHOTO_COUNT_DOWN = 'counting from a photo is not working just now; try again later'

/** True when a message names the operator's machinery. */
export function namesTheOperator(message: unknown): boolean {
  return (
    typeof message === 'string' && (READER_OFF_WORDS.test(message) || VENDOR_WORDS.test(message))
  )
}

/** A photo-count failure, as one clause a house can read. */
export function photoRefusalWords(message: unknown): string {
  // The key test runs first: "Anthropic API key not configured" names the
  // vendor too, and it is an OFF, not a DOWN.
  if (typeof message === 'string' && READER_OFF_WORDS.test(message)) return PHOTO_COUNT_OFF
  if (namesTheOperator(message)) return PHOTO_COUNT_DOWN
  // One clause: the caller adds its own full stop and next step.
  const said = typeof message === 'string' ? message.trim().replace(/[.\s]+$/, '') : ''
  return said || 'the photo could not be read'
}
