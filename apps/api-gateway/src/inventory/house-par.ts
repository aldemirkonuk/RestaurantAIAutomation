import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * The house's one low-stock par (ADR 0116: a default is not an answer).
 *
 * A good added with no par of its own takes the par the house stated at
 * /get-started (`restaurants.default_threshold_min`). A house that has stated
 * none takes the column's own default, 3, so the menu path and the inventory
 * path agree. The inventory paths used to write 6 here while the menu path
 * wrote 3, and `||` turned a typed 0 into 6.
 *
 * A read that FAILS is not "the house stated none": it throws a 503 so the
 * add refuses (nothing is written) instead of holding a house that stated 12
 * to a guessed 3.
 */
export const HOUSE_PAR_FALLBACK = 3;

export async function readHouseThresholdMin(
  client: {
    from: (table: string) => any;
  },
  restaurantId: string,
): Promise<number> {
  const { data, error } = await client
    .from("restaurants")
    .select("default_threshold_min")
    .eq("id", restaurantId)
    .maybeSingle();
  if (error) {
    throw new HttpException(
      "The house's par could not be read; nothing was added.",
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  const stated = data?.default_threshold_min;
  return typeof stated === "number" && Number.isFinite(stated)
    ? stated
    : HOUSE_PAR_FALLBACK;
}
