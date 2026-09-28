import { describe, it, expect } from "vitest";
import { coerceWineType, getWineTypeColor } from "./wineData";

/**
 * Antalya night: 26 of 27 rows on a cocktail bar said "Red" — including a Moët
 * and two rosés.
 *
 * Two places did it, and they agreed with each other, which is why nobody
 * caught it: `coerceWineType` ended `return 'red'  // default to red if
 * unknown (should be rare)`, and `useInventoryPage.ts:125` asserted
 * `type: 'red'` outright on any inventory row whose library wine had not
 * loaded. On a venue that sells mostly cocktails and spirits, "should be rare"
 * was 96% of the list.
 *
 * "Red" is not a safe default. It is a claim about the bottle, rendered in a
 * red chip, next to a real one — and unlike a missing value it cannot be
 * spotted by eye.
 */
describe("coerceWineType", () => {
  it("still recognises the types it knows", () => {
    expect(coerceWineType("red")).toBe("red");
    expect(coerceWineType("White")).toBe("white");
    expect(coerceWineType("rosé")).toBe("rose");
    expect(coerceWineType("sparkling")).toBe("sparkling");
    expect(coerceWineType("dessert")).toBe("dessert");
  });

  it("does not call an unrecognised type red", () => {
    expect(coerceWineType("gin")).not.toBe("red");
    expect(coerceWineType("cocktail")).not.toBe("red");
    expect(coerceWineType("Champagne Brut Impérial")).not.toBe("red");
  });

  it("says unknown when it does not know", () => {
    expect(coerceWineType(undefined)).toBe("unknown");
    expect(coerceWineType("")).toBe("unknown");
    expect(coerceWineType("   ")).toBe("unknown");
    expect(coerceWineType("gin")).toBe("unknown");
  });

  it("gives unknown a neutral colour rather than a wine colour", () => {
    const unknown = getWineTypeColor("unknown");
    const red = getWineTypeColor("red");
    expect(unknown.accent).not.toBe(red.accent);
    // Grey: it must not read as a classification anybody made.
    expect(unknown.bg).toMatch(/gray|grey/);
  });
});
