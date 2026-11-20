/**
 * The house's one low-stock par (ADR 0116: a default is not an answer).
 *
 * A good added with no par of its own takes the par the house stated at
 * /get-started (`restaurants.default_threshold_min`). A house that has stated
 * none takes the column's own default, 3, so the menu path and the inventory
 * path agree. The inventory paths used to write 6 here while the menu path
 * wrote 3, and `||` turned a typed 0 into 6.
 */
export const HOUSE_PAR_FALLBACK = 3;

export async function readHouseThresholdMin(
  client: {
    from: (table: string) => any;
  },
  restaurantId: string,
): Promise<number> {
  const { data } = await client
    .from("restaurants")
    .select("default_threshold_min")
    .eq("id", restaurantId)
    .maybeSingle();
  const stated = data?.default_threshold_min;
  return typeof stated === "number" && Number.isFinite(stated)
    ? stated
    : HOUSE_PAR_FALLBACK;
}
