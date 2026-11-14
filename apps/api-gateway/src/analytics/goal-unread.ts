import { HOUSE_ZONE_UNSET } from "../common/house-day";
import { WholeReadError } from "../common/read-whole-window";
import { UncountedConsumptionError } from "./consumption-units";
import { UncostedOrdersError } from "./order-cost";

/**
 * A goal reading refused for a reason written for the house (days of stock
 * with a good that has no cost, say). Its message is shown as it stands.
 */
export class GoalReadingRefused extends Error {
  constructor(sentence: string) {
    super(sentence);
    this.name = "GoalReadingRefused";
  }
}

/**
 * What a goal whose reading failed for a reason that is not the house's says
 * (r34 walk w3, R-F7). The same words the reports page uses for a register
 * whose read failed on the server.
 */
export const GOAL_UNREAD_ON_OUR_SIDE = "Mudavym’s side failed while reading it.";

/**
 * Why a goal could not be read, in the house's words (r34 walk w3, R-F7).
 *
 * The reason reaches the goal card ("This goal could not be scored (…)"), the
 * bench and the stored row (`current_unread`, read by every later reader). It
 * was the raw error, so a missing table printed
 * "PGRST205 Could not find the table 'public.wine_consumption_log' in the
 * schema cache" to an owner.
 *
 * An allowlist, not a filter of database-looking text: only a refusal this
 * gateway wrote for the house is said as written. Anything else (a PostgREST
 * code, a driver message, a TypeError) is said as a failure on Mudavym's side,
 * so a new kind of raw error is hidden by default rather than shown. The raw
 * message is the caller's to log.
 */
export function goalUnreadInWords(err: unknown): string {
  if (err instanceof WholeReadError) {
    // The message names what was read and why in words, then the database's
    // own detail in parentheses. The detail is the raw part; it is dropped.
    return err.message.replace(` (${err.detail})`, "");
  }
  if (
    err instanceof GoalReadingRefused ||
    err instanceof UncostedOrdersError ||
    err instanceof UncountedConsumptionError
  )
    return err.message;
  if (err instanceof Error && err.message === HOUSE_ZONE_UNSET)
    return HOUSE_ZONE_UNSET;
  return GOAL_UNREAD_ON_OUR_SIDE;
}
