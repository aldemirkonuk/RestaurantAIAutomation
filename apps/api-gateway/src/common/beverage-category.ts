/**
 * The bucket a stock line is grouped under in an analytics breakdown (F-742).
 *
 * The library's `beverage_kind` comes first, so a beer is "beer" and a gin
 * "spirit". A wine falls back to its `primary_type` colour ("red", "white"),
 * which is what these breakdowns grouped by before. A house-declared item
 * with no library row uses its own `restaurant_inventory.kind`.
 *
 * Grouping by `primary_type` alone pooled every beer, spirit and soft drink,
 * and every menu-imported wine, into one "unknown" bucket: `primary_type`
 * only ever holds wine styles. A kind stored as "wine" by default is not
 * evidence, so it never turns an unclassified line into "wine".
 */
export function beverageCategoryOf(
  library:
    | { primary_type?: string | null; beverage_kind?: string | null }
    | null
    | undefined,
  houseKind?: string | null,
): string {
  const kind = library?.beverage_kind;
  if (kind && kind !== "wine" && kind !== "unknown") return kind;
  if (houseKind && houseKind !== "wine") return houseKind;
  const style = library?.primary_type;
  if (style && style !== "unknown") return style;
  return kind === "wine" ? "wine" : "unknown";
}
