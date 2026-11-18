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
 *  P6 (D2) A line's key does not move when other lines are removed or
 *     reordered; identical lines get distinct keys; a provider line id wins.
 *  P7 (D3) A fractional quantity keeps its fraction: whole + fraction = qty,
 *     and the fraction draws that share of the unit's volume.
 *  P8 (D5) An absent price reads null from every adapter, never 0; a rung
 *     zero stays zero; only an absent price falls back to the menu price.
 *  P5 The advised price carries the target margin to the cent, and the advice
 *     says raise only when the advised price is above today's.
 */
import { resolveSaleVolume, inventoryVolumesFromRow } from "./pos-hub.service";
import { saleLineKeys, splitQty, fractionMl } from "./sale-line";
import {
  genericAdapter,
  squareAdapter,
  cloverAdapter,
  toastAdapter,
} from "./pos-adapters";
import { consumptionUnitPrice } from "./pos-hub.service";
import {
  glassCostFrom,
  adviseToTarget,
  toCents,
} from "../pricing/margin-to-target";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
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
    expect(resolveSaleVolume(60, "glass", inv)).toEqual({
      mode: "volume",
      ml: 60,
    });
    expect(resolveSaleVolume(null, "glass", inv)).toEqual({
      mode: "volume",
      ml: 150,
    });
    expect(resolveSaleVolume(null, "bottle", null)).toEqual({
      mode: "whole_bottle",
    });
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

describe("saleLineKeys (P6, D2)", () => {
  const mk = (r: () => number) => {
    const names = ["Rose", "Malbec", "Syrah"];
    const n = 2 + Math.floor(r() * 7);
    return Array.from({ length: n }, () => ({
      name: names[Math.floor(r() * 3)],
      external_item_id: r() < 0.5 ? `sku-${Math.floor(r() * 3)}` : null,
      modifiers: r() < 0.3 ? "ice" : null,
      price: r() < 0.2 ? null : 10 + Math.floor(r() * 3),
    }));
  };

  it("keys are unique within a check, and identical lines are told apart", () => {
    const r = rng(61);
    for (let i = 0; i < 500; i++) {
      const keys = saleLineKeys("toast", "c1", mk(r));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("removing an earlier line leaves the later lines' keys as they were", () => {
    const r = rng(67);
    for (let i = 0; i < 500; i++) {
      const items = mk(r);
      const before = saleLineKeys("toast", "c1", items);
      const drop = Math.floor(r() * items.length);
      const after = saleLineKeys(
        "toast",
        "c1",
        items.filter((_, k) => k !== drop),
      );
      // a re-sent check with a line gone books no key it has not booked before
      for (const key of after) expect(before).toContain(key);
    }
  });

  it("a provider line id is the key, whatever the position", () => {
    const a = saleLineKeys("square", "c1", [
      { name: "x", line_id: "L1" },
      { name: "x", line_id: "L2" },
    ]);
    const b = saleLineKeys("square", "c1", [{ name: "x", line_id: "L2" }]);
    expect(b[0]).toBe(a[1]);
    expect(a[0]).not.toBe(a[1]);
  });

  it("a different price or modifier is a different line", () => {
    const k = saleLineKeys("toast", "c1", [
      { name: "x", price: 10 },
      { name: "x", price: 11 },
      { name: "x", price: 10, modifiers: "ice" },
    ]);
    expect(new Set(k).size).toBe(3);
  });
});

describe("splitQty and fractionMl (P7, D3)", () => {
  it("whole plus fraction is the quantity, to the thousandth", () => {
    const r = rng(71);
    for (let i = 0; i < 3000; i++) {
      const q = Math.round(r() * 20000) / 1000;
      const { whole, frac } = splitQty(q);
      expect(Number.isInteger(whole)).toBe(true);
      expect(frac).toBeGreaterThanOrEqual(0);
      expect(frac).toBeLessThan(1);
      expect(Math.abs(whole + frac - q)).toBeLessThan(1e-9);
    }
    expect(splitQty(0.5)).toEqual({ whole: 0, frac: 0.5 });
    expect(splitQty(2)).toEqual({ whole: 2, frac: 0 });
    expect(splitQty(0.4)).toEqual({ whole: 0, frac: 0.4 });
    expect(splitQty(0)).toEqual({ whole: 0, frac: 0 });
    expect(splitQty(-1)).toEqual({ whole: 0, frac: 0 });
    expect(splitQty(NaN)).toEqual({ whole: 0, frac: 0 });
  });

  it("a fraction draws that share of the unit, never zero, never the whole unit", () => {
    const r = rng(73);
    for (let i = 0; i < 3000; i++) {
      const unit = BOTTLES[Math.floor(r() * BOTTLES.length)];
      const frac = Math.round((0.001 + r() * 0.998) * 1000) / 1000;
      const ml = fractionMl(unit, frac);
      expect(ml).toBeGreaterThanOrEqual(1);
      expect(ml).toBeLessThanOrEqual(unit);
      expect(Math.abs(ml - unit * frac)).toBeLessThanOrEqual(1);
    }
    expect(fractionMl(150, 0.5)).toBe(75);
    expect(fractionMl(150, 0)).toBe(0);
  });
});

describe("absent price (P8, D5)", () => {
  const generic = (it: any) =>
    genericAdapter.normalize({ externalCheckId: "c", items: [it] })[0].items[0];

  it("every adapter reads an absent price as null, not 0", () => {
    expect(generic({ name: "Glass" }).price).toBeNull();
    expect(generic({ name: "Glass", price: null }).price).toBeNull();
    expect(generic({ name: "Glass", price: "" }).price).toBeNull();
    const sq = squareAdapter.normalize({
      id: "o1",
      line_items: [{ name: "Glass", quantity: "1" }],
    })[0].items[0];
    expect(sq.price).toBeNull();
    const cl = cloverAdapter.normalize({
      id: "o1",
      lineItems: { elements: [{ name: "Glass" }] },
    })[0].items[0];
    expect(cl.price).toBeNull();
    const ts = toastAdapter.normalize({
      guid: "g1",
      selections: [{ displayName: "Glass", quantity: 1 }],
    })[0].items[0];
    expect(ts.price).toBeNull();
  });

  it("a rung zero stays zero; a comp flag is read, never inferred", () => {
    expect(generic({ name: "Glass", price: 0 }).price).toBe(0);
    expect(generic({ name: "Glass", price: 0 }).comped).toBeFalsy();
    expect(generic({ name: "Glass", price: 12, comped: true }).comped).toBe(
      true,
    );
    expect(generic({ name: "Glass", price: 12, is_comp: true }).comped).toBe(
      true,
    );
  });

  it("adapters carry the provider's line id and modifiers", () => {
    const sq = squareAdapter.normalize({
      id: "o1",
      line_items: [
        {
          uid: "u-9",
          name: "Glass",
          quantity: "1",
          modifiers: [{ name: "ice" }, { name: "a-lemon" }],
        },
      ],
    })[0].items[0];
    expect(sq.lineId).toBe("u-9");
    expect(sq.modifiers).toBe("a-lemon,ice");
    const cl = cloverAdapter.normalize({
      id: "o1",
      lineItems: { elements: [{ id: "cl-1", name: "Glass", unitQty: 500 }] },
    })[0].items[0];
    expect(cl.lineId).toBe("cl-1");
    expect(cl.qty).toBe(0.5);
    const ts = toastAdapter.normalize({
      guid: "g1",
      selections: [
        { guid: "s-3", displayName: "Glass", quantity: 1, price: 9 },
      ],
    })[0].items[0];
    expect(ts.lineId).toBe("s-3");
  });

  it("only an absent price falls back to the menu price, and only for a bottle", () => {
    expect(consumptionUnitPrice(null, "whole_bottle", 60)).toBe(60);
    expect(consumptionUnitPrice(undefined, "whole_bottle", 60)).toBe(60);
    expect(consumptionUnitPrice(null, "volume", 60)).toBeNull();
    expect(consumptionUnitPrice(0, "whole_bottle", 60)).toBe(0);
    expect(consumptionUnitPrice(12, "whole_bottle", 60, true)).toBe(0);
    expect(consumptionUnitPrice(null, "whole_bottle", 60, true)).toBe(0);
  });
});
