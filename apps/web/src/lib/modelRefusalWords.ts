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
 */

/** Words that are the operator's, never the house's: the key, its vendor, its billing. */
const OPERATOR_WORDS = /anthropic|api[\s_-]?key|credit balance|not configured/i

/** The clause #1095's gateway sends (`photo-count.service.ts` PHOTO_READER_OFF). */
export const PHOTO_COUNT_OFF = 'counting from a photo is not switched on here yet'

/** True when a message names the operator's machinery. */
export function namesTheOperator(message: unknown): boolean {
  return typeof message === 'string' && OPERATOR_WORDS.test(message)
}

/** A photo-count failure, as one clause a house can read. */
export function photoRefusalWords(message: unknown): string {
  if (namesTheOperator(message)) return PHOTO_COUNT_OFF
  // One clause: the caller adds its own full stop and next step.
  const said = typeof message === 'string' ? message.trim().replace(/[.\s]+$/, '') : ''
  return said || 'the photo could not be read'
}
