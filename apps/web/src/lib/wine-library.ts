import type { Wine as ApiWine } from "../services/api/types";
import type { Wine as UiWine } from "../data/wineData";

type WineType = UiWine["type"];

function coerceWineType(type: string | undefined): WineType {
  const t = (type || "").toLowerCase().trim();
  if (t === "red") return "red";
  if (t === "white") return "white";
  if (t === "sparkling") return "sparkling";
  if (t === "rose" || t === "rosé") return "rose";
  if (t === "dessert") return "dessert";
  // Was "red" (F-728): every beer, spirit, coffee and menu-imported wine
  // came out a red wine. A style nobody stated is unknown, as in
  // data/wineData.ts's coercer.
  return "unknown";
}

/**
 * The wine colour of a row, read only when the row IS a wine. `kind` is the
 * library's `beverage_kind` (or the house item's `kind`); a beer or a gin has
 * no colour, so it is `unknown` whatever `category` says. A row whose kind
 * was not sent keeps the old reading of `category` (the library's
 * `primary_type`, which only ever holds wine styles).
 */
export function wineTypeForKind(
  kind: string | null | undefined,
  category: string | undefined,
): WineType {
  if (kind && kind !== "wine" && kind !== "unknown") return "unknown";
  return coerceWineType(category);
}

/**
 * What an inventory row IS. A kind other than `wine` on the house item is a
 * statement (the house declared it, or the library said so when it was
 * added) and wins. Otherwise the library's current verdict is used, since a
 * row stored as `wine` before the library classified it would still say
 * wine. Undefined when neither source said anything.
 */
export function inventoryKindOf(
  item: { kind?: string | null; beverageKind?: string | null },
  libraryKind?: string | null,
): string | undefined {
  if (item.kind && item.kind !== "wine") return item.kind;
  const library = item.beverageKind || libraryKind;
  if (library && library !== "unknown") return library;
  return item.kind || library || undefined;
}

export function mapApiWineToUiWine(wine: ApiWine): UiWine {
  return {
    id: wine.id,
    name: wine.name || "Unknown Wine",
    displayName: wine.displayName || undefined,
    producer: wine.producer || "Unknown Producer",
    vintage: wine.vintage ?? null,
    price: Number.isFinite(wine.price) ? wine.price : 0,
    marketPrice: Number.isFinite(wine.retailPriceAvg as number)
      ? (wine.retailPriceAvg as number)
      : undefined,
    type: wineTypeForKind(wine.beverageKind, wine.category),
    kind: wine.beverageKind || undefined,
    grape: wine.grapeVariety || "Unknown",
    country: wine.country || "Unknown",
    region: wine.region || "Unknown",
    appellation: wine.appellation || "Unknown",
    body: "medium",
    sweetness: "dry",
    acidity: "medium",
    alcohol: 0,
    aromas: [],
    flavors: [],
    // A LIBRARY row has no stock and no par — those are properties of a
    // restaurant's inventory, not of the shared catalogue. `liveStock: null`
    // was already honest; `threshold: 6` was not, and it is the reason the
    // Sommelier's offline low-stock branch could never fire (intelligence
    // lens, defect 4): the filter needs `liveStock !== null`, so a fabricated
    // par bought nothing and asserted something false.
    //
    // 0 encodes "no par set", which ADR 0129 defines as `unknown` rather than
    // critical — so a library wine cannot be classified as low against a
    // number nobody chose. Consumers that use this as a FORM DEFAULT
    // (`wine.threshold || 10`) are unaffected; consumers that would use it as
    // a VERDICT now get `unknown`, which is the truth.
    liveStock: null,
    threshold: 0,
    bottleSizeMl: wine.bottleSizeMl ?? 750,
    saleType: (wine as unknown as Record<string, unknown>).saleType as
      | UiWine["saleType"]
      | undefined,
    pourSizeMl: (wine as unknown as Record<string, unknown>).pourSizeMl as
      | number
      | undefined,
    menuPriceGlass: (wine as unknown as Record<string, unknown>)
      .menuPriceGlass as number | undefined,
    menuPrice: (wine as unknown as Record<string, unknown>).menuPrice as
      | number
      | undefined,
    provider: {
      name: "Unknown Provider",
      contact: "Contact Provider",
      phone: "N/A",
      email: "N/A",
      address: "N/A",
    },
    isActive: true,
  };
}

export function mapApiWinesToUiWines(wines: ApiWine[]): UiWine[] {
  return wines.map(mapApiWineToUiWine);
}
