/**
 * Property tests over the table-side money math (r56 audit): what a till line
 * takes off the shelf, what a pour costs, and what margin a price carries.
 * Seeded, so a failure is the same failure on every run.
 *
 *  P1 A resolved sale volume never exceeds the container it pours from, and a
 *     volume equal to the container is a whole-bottle sale.
 *  P2 An explicit volume outranks the label; a bottle label never reads sizes.
 *  P3 A bottle's worth of pours costs the bottle: glassCostFrom x (bottle/pour)
 *     is the bottle cost, for any positive pour and bottle size.
 *  P4 A glass costs less than the bottle whenever the pour is smaller.
 *  P5 The advised price carries the target margin to the cent, and the advice
 *     says raise only when the advised price is above today's.
 */
import {
  resolveSaleVolume,
  inventoryVolumesFromRow,
} from "./pos-hub.service";
import {
  glassCostFrom,
  adviseToTarget,
  toCents,
} from "../pricing/margin-to-target";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const BOTTLES = [187, 375, 500, 700, 750, 1000, 1500, 3000];

describe("resolveSaleVolume (P1, P2)", () => {
  it("never resolves past the container, and a full container is a whole bottle", () => {
    const r = rng(11);
    for (let i = 0; i < 2000; i++) {
      const bottle = BOTTLES[Math.floor(r() * BOTTLES.length)];
      const inv = inventoryVolumesFromRow({
        bottle_size_ml: bottle,
        pour_size_ml: 100 + Math.floor(r() * 100),
        menu_price_current: 50,
      });
      const ml = Math.floor(r() * (bottle * 1.5));
      const out = resolveSaleVolume(ml, "glass", inv);
      if (out.mode === "volume") expect(out.ml).toBeLessThanOrEqual(bottle);
      if (out.mode === "whole_bottle") expect(ml).toBe(bottle);
      if (ml > bottle) expect(out.mode).toBe("unresolved");
    }
  });

  it("an explicit volume outranks the label; a bottle label needs no size", () => {
    const inv = inventoryVolumesFromRow({
      bottle_size_ml: 750,
      pour_size_ml: 150,
      menu_price_current: 60,
    });
    expect(resolveSaleVolume(60, "glass", inv)).toEqual({ mode: "volume", ml: 60 });
    expect(resolveSaleVolume(null, "glass", inv)).toEqual({ mode: "volume", ml: 150 });
    expect(resolveSaleVolume(null, "bottle", null)).toEqual({ mode: "whole_bottle" });
    expect(resolveSaleVolume(null, "glass", null).mode).toBe("unresolved");
  });
});

describe("glassCostFrom (P3, P4)", () => {
  it("a bottle's worth of pours costs the bottle", () => {
    const r = rng(23);
    for (let i = 0; i < 2000; i++) {
      const cost = Math.round(r() * 50000) / 100 + 1;
      const bottle = BOTTLES[Math.floor(r() * BOTTLES.length)];
      const pour = 30 + Math.floor(r() * (bottle - 30));
      const glass = glassCostFrom(cost, pour, bottle) as number;
      expect(glass * (bottle / pour)).toBeCloseTo(cost, 6);
      if (pour < bottle) expect(glass).toBeLessThan(cost);
    }
  });
  it("a size that is not known has no cost", () => {
    expect(glassCostFrom(40, null, 750)).toBeNull();
    expect(glassCostFrom(40, 150, 0)).toBeNull();
    expect(glassCostFrom(null, 150, 750)).toBeNull();
  });
});

describe("adviseToTarget (P5)", () => {
  it("the advised price carries the target margin to the cent", () => {
    const r = rng(37);
    for (let i = 0; i < 2000; i++) {
      const cost = Math.round((1 + r() * 400) * 100) / 100;
      const targetPct = 20 + Math.floor(r() * 70);
      const price = Math.round((1 + r() * 900) * 100) / 100;
      const a = adviseToTarget({
        kind: "bottle",
        price,
        unitCost: cost,
        targetPct,
        bandPct: 0,
      });
      if (a.state === "raise" || a.state === "lower") {
        const advised = a.advisedPrice as number;
        const margin = ((advised - cost) / advised) * 100;
        // a cent of rounding moves the margin by at most 0.01 / advised
        expect(Math.abs(margin - targetPct)).toBeLessThanOrEqual(
          (0.005 / advised) * 100 + 1e-9,
        );
        expect(a.state === "raise").toBe(advised > price);
        expect(advised).toBe(toCents(cost / (1 - targetPct / 100)));
      }
    }
  });
});
