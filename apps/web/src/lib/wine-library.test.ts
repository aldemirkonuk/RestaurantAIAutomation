import { describe, it, expect } from "vitest";
import { mapApiWineToUiWine } from "./wine-library";

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
