import type { Logger } from "@nestjs/common";
import { currencyCode } from "../../common/iso-4217";

/**
 * The house's own currency, for a sentence about the house's own books.
 *
 * A goal measures the house's books: its till (wine revenue, average check) or
 * its buying (purchasing spend). Those figures are said in the money the house
 * named in Settings (`restaurants.currency`). This is the second step of the
 * money rule: a record's own currency, else the house's, else the bare figure.
 *
 * `null` in three cases, and every one of them prints the bare figure through
 * `money()`, never a borrowed `$`:
 *   - the house has not named its money (the column is nullable, ADR 0117);
 *   - the column holds something that is not an ISO 4217 code;
 *   - the read failed. A bare figure is still true; a guessed sign is not.
 */
export async function readHouseCurrency(
  client: any,
  restaurantId: string,
  logger: Pick<Logger, "warn">,
  producer: string,
): Promise<string | null> {
  try {
    const { data, error } = await client
      .from("restaurants")
      .select("currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      logger.warn(
        `${producer.toUpperCase()}_HOUSE_CURRENCY_UNREADABLE restaurant=${restaurantId} — ` +
          `${error.message}. Amounts in this run are said as bare figures.`,
      );
      return null;
    }
    return currencyCode(data?.currency);
  } catch (e: any) {
    logger.warn(
      `${producer.toUpperCase()}_HOUSE_CURRENCY_UNREADABLE restaurant=${restaurantId} — ` +
        `${e?.message ?? String(e)}. Amounts in this run are said as bare figures.`,
    );
    return null;
  }
}
