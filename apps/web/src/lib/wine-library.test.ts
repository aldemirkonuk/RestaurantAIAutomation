import { describe, it, expect } from "vitest";
import {
  inventoryKindOf,
  mapApiWineToUiWine,
  wineTypeForKind,
} from "./wine-library";

/**
 * Intelligence-lens defect 4. `mapApiWineToUiWine` hard-coded
 * `liveStock: null, threshold: 6` for every wine in the shared library.
 *
 * `liveStock: null` was honest — a catalogue row has no stock. `threshold: 6`
 * was not: it asserted a par nobody set, on rows belonging to no restaurant.
 * It also made the Sommelier's offline low-stock branch permanently
 * unreachable, because that filter needs `liveStock !== null` — so the
 * fabricated par bought nothing at all and still said something false.
 */
const apiWine = (o: Record<string, unknown> = {}) =>
  ({
    id: "w-1",
    name: "Alvear Solera 1927",
    producer: "Alvear",
    vintage: null,
    price: 42,
    category: "dessert",
    ...o,
  }) as never;

describe("mapApiWineToUiWine — a library row has no stock and no par", () => {
  it("carries no stock, because the catalogue has none", () => {
    expect(mapApiWineToUiWine(apiWine()).liveStock).toBeNull();
  });

  it("does not assert a par of 6 on a row belonging to no restaurant", () => {
    expect(mapApiWineToUiWine(apiWine()).threshold).not.toBe(6);
  });

  it('encodes "no par" as a non-positive par', () => {
    // ADR 0129 (PR #312, not yet on main) defines `par <= 0` as "no par set",
    // which classifies as `unknown` rather than `critical` — so a library wine
    // cannot be rendered "Critical" against a number nobody chose. This test
    // asserts the ENCODING rather than importing that classifier, so it does
    // not silently depend on an unmerged branch.
    expect(mapApiWineToUiWine(apiWine()).threshold).toBeLessThanOrEqual(0);
  });

  it("still maps the fields a catalogue row does have", () => {
    const wine = mapApiWineToUiWine(
      apiWine({ name: "Akakies", producer: "Kir-Yianni" }),
    );
    expect(wine.name).toBe("Akakies");
    expect(wine.producer).toBe("Kir-Yianni");
  });
});

/**
 * F-728. The coercer ended `return "red"`, and it was fed `category`, which is
 * the library's `primary_type`: every beer, spirit and coffee, and every
 * menu-imported wine (`primary_type: "unknown"`), came out a red wine. The
 * kind the gateway already sends (`beverageKind`) was dropped at the type
 * boundary.
 */
describe("mapApiWineToUiWine — a beer is not a red wine", () => {
  it("keeps the library's kind and gives a beer no wine colour", () => {
    const beer = mapApiWineToUiWine(
      apiWine({ name: "Bomonti", category: "unknown", beverageKind: "beer" }),
    );
    expect(beer.kind).toBe("beer");
    expect(beer.type).toBe("unknown");
  });

  it("does not call an unclassified wine red", () => {
    const w = mapApiWineToUiWine(
      apiWine({ category: "unknown", beverageKind: "unknown" }),
    );
    expect(w.type).toBe("unknown");
  });

  it("still reads a wine's colour", () => {
    const w = mapApiWineToUiWine(
      apiWine({ category: "white", beverageKind: "wine" }),
    );
    expect(w.kind).toBe("wine");
    expect(w.type).toBe("white");
  });

  it("only coerces a colour for a wine", () => {
    expect(wineTypeForKind("spirit", "red")).toBe("unknown");
    expect(wineTypeForKind("wine", "red")).toBe("red");
    expect(wineTypeForKind(undefined, "rosé")).toBe("rose");
  });
});

/**
 * F-739. The /inventory row now carries the house item's `kind` and the
 * library's `beverageKind`; a declared keg with no library row is a beer.
 */
describe("inventoryKindOf", () => {
  it("reads a declared keg as beer with no library row", () => {
    expect(inventoryKindOf({ kind: "beer", beverageKind: null })).toBe("beer");
  });

  it("lets the library's verdict replace a kind stored as wine before it was classified", () => {
    expect(inventoryKindOf({ kind: "wine", beverageKind: "spirit" })).toBe(
      "spirit",
    );
  });

  it("stays wine when the library does not know", () => {
    expect(inventoryKindOf({ kind: "wine", beverageKind: "unknown" })).toBe(
      "wine",
    );
  });

  it("is undefined when nobody said", () => {
    expect(inventoryKindOf({})).toBeUndefined();
  });
});
