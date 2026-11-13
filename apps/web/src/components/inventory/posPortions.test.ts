import { describe, it, expect } from "vitest";
import { portionsFor, type PortionFacts } from "./posPortions";

const f = (o: Partial<PortionFacts>): PortionFacts => ({
  kind: "wine",
  uom: "bottle",
  bottleMl: null,
  pourMl: null,
  ...o,
});
const texts = (facts: PortionFacts | null, house: number | null = null) =>
  portionsFor(facts, house).offers.map((o) => o.text);

describe("portionsFor (r24 pos-portions)", () => {
  it("a soda is a bottle or can at its size, and never a glass", () => {
    const p = portionsFor(f({ kind: "soft_drink", bottleMl: 330, pourMl: 150 }), 150);
    expect(p.offers).toEqual([
      { text: "Bottle or can 330ml", saleUnit: "bottle", saleVolumeMl: null, shape: "whole", blocked: null, needs: null },
    ]);
  });

  it("a soda with no size says so, and is still one unit a sale", () => {
    const [o] = portionsFor(f({ kind: "non_alcoholic" }), null).offers;
    expect(o.text).toBe("Bottle or can · size not known");
    expect(o.blocked).toBeNull();
    expect(o.saleVolumeMl).toBeNull();
  });

  it("a wine with no size: no 750, and its glass cannot be chosen", () => {
    const p = portionsFor(f({ kind: "wine", pourMl: 125 }), 150);
    expect(p.offers.map((o) => o.text)).toEqual(["Bottle · size not known", "Glass: size not known"]);
    expect(p.offers[1].blocked).toMatch(/does not say what one bottle holds/);
    expect(p.offers[1].saleVolumeMl).toBeNull();
  });

  it("a sized wine pours its own confirmed pour, else the house's, else nothing", () => {
    expect(portionsFor(f({ bottleMl: 750, pourMl: 125 }), 150).offers[1]).toMatchObject({
      text: "Glass 125ml",
      saleUnit: "glass",
      saleVolumeMl: 125,
      blocked: null,
    });
    expect(portionsFor(f({ bottleMl: 750 }), 150).offers[1].saleVolumeMl).toBe(150);
    const none = portionsFor(f({ bottleMl: 750 }), null).offers[1];
    expect(none.text).toBe("Glass: size not known");
    expect(none.blocked).toMatch(/pour is confirmed/);
    expect(portionsFor(f({ bottleMl: 750 }), null).offers[0].text).toBe("Bottle 750ml");
  });

  it("a spirit is a bottle or a shot, and the house's wine pour is not a shot", () => {
    expect(texts(f({ kind: "spirit", bottleMl: 700, pourMl: 40 }))).toEqual(["Bottle 700ml", "Shot 40ml"]);
    const p = portionsFor(f({ kind: "whiskey", bottleMl: 700 }), 150);
    expect(p.offers[1]).toMatchObject({ text: "Shot: size not known", saleUnit: "shot" });
    expect(p.offers[1].blocked).toMatch(/shot size is not confirmed/);
  });

  it("a pour larger than the bottle cannot be chosen", () => {
    const o = portionsFor(f({ kind: "spirit", bottleMl: 50, pourMl: 60 }), null).offers[1];
    expect(o.blocked).toMatch(/more than one bottle holds/);
  });

  it("a bottled beer is a bottle or can; a keg beer is a glass", () => {
    expect(texts(f({ kind: "beer", bottleMl: 330, pourMl: 300 }))).toEqual(["Bottle or can 330ml"]);
    expect(texts(f({ kind: "beer", uom: "keg", bottleMl: 30000, pourMl: 400 }))).toEqual(["Glass 400ml"]);
  });

  it("a good kept by the piece is one piece; kept by volume or the case, nothing, with the reason", () => {
    expect(texts(f({ kind: "food", uom: "each" }))).toEqual(["One piece"]);
    const ml = portionsFor(f({ kind: "soft_drink", uom: "ml" }), 150);
    expect(ml.offers).toEqual([]);
    expect(ml.note).toMatch(/kept by volume/);
    expect(portionsFor(f({ kind: "wine", uom: "case" }), 150).note).toMatch(/kept by the case/);
  });

  it("r26: a blocked pour says what would unblock it, so the panel can ask for only that", () => {
    expect(portionsFor(f({ bottleMl: 750 }), null).offers[1].needs).toBe("pour");
    expect(portionsFor(f({ kind: "spirit", bottleMl: 700 }), null).offers[1].needs).toBe("pour");
    expect(portionsFor(f({ pourMl: 125 }), null).offers[1].needs).toBe("size");
    expect(portionsFor(f({ kind: "spirit", bottleMl: 50, pourMl: 60 }), null).offers[1].needs).toBe("fit");
    expect(portionsFor(f({ bottleMl: 750 }), 150).offers.map((o) => o.needs)).toEqual([null, null]);
  });

  it("unread facts offer nothing and say why", () => {
    const p = portionsFor(null, 150);
    expect(p.offers).toEqual([]);
    expect(p.note).toMatch(/could not be read/);
  });
});
