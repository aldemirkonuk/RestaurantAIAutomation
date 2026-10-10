import {
  houseClock,
  houseDay,
  houseDecimal,
  houseMoney,
  idleStockWords,
  readHousePrice,
  stockValue,
} from "../houseMoney";
import { computeMatch, money } from "../invoiceMatch";
import {
  REVENUE_UNAVAILABLE_MESSAGES,
  resolvePulseStripView,
} from "@/components/today/pulseStripView";
import type { TodayPulse } from "@/api/types";

/**
 * F-885: the phone printed "$12,400" for every house. A figure now prints in
 * the house's money, grouped the house's way, as the gateway's houseMoney does.
 */
describe("houseMoney — the phone's money in the house's terms (F-885)", () => {
  it("prints a lira house in lira with '.' grouping", () => {
    expect(houseMoney(12400, { currency: "TRY", locale: "tr-TR" })).toBe("₺12.400");
  });

  it("prints a euro house in Germany with the symbol after the figure", () => {
    expect(houseMoney(12400, { currency: "EUR", locale: "de-DE" })).toBe("12.400\u00a0€");
  });

  it("prints a dollar house as before", () => {
    expect(houseMoney(12400, { currency: "USD", locale: "en-US" })).toBe("$12,400");
  });

  it("prints no symbol, never a dollar, when no currency is recorded", () => {
    expect(houseMoney(12400, { currency: null, locale: null })).toBe("12,400");
    expect(houseMoney(12400, undefined)).toBe("12,400");
  });

  it("keeps cents only when asked, in the house's decimal mark", () => {
    expect(
      houseMoney(18.5, { currency: "TRY", locale: "tr-TR" }, { maxFractionDigits: 2 }),
    ).toBe("₺18,5");
    expect(houseMoney(18.5, { currency: "TRY", locale: "tr-TR" })).toBe("₺19");
  });

  it("prints a code with no symbol of its own as itself", () => {
    expect(houseMoney(1240, { currency: "ZZZ", locale: "en-US" })).toBe("ZZZ\u00a01,240");
  });
});

/**
 * F-953: shift and freshness times printed on a US 12-hour clock, and rates
 * with a '.' decimal, in a Turkish house.
 */
describe("houseClock and houseDecimal — the house's clock and marks (F-953)", () => {
  it("prints a Turkish shift on the 24-hour clock", () => {
    expect(houseClock("19:00", "tr-TR")).toBe("19:00");
    expect(houseClock("07:30:00", "tr-TR")).toBe("07:30");
  });

  it("keeps the short 12-hour form for a US house and an unknown one", () => {
    expect(houseClock("19:00", "en-US")).toBe("7pm");
    expect(houseClock("19:30", null)).toBe("7:30pm");
    expect(houseClock("00:00", "en-US")).toBe("12am");
  });

  it("prints a rate with the house's decimal mark", () => {
    expect(houseDecimal(2.5, "tr-TR")).toBe("2,5");
    expect(houseDecimal(2.5, null)).toBe("2.5");
  });

  it("says the Today strip's time on the house's clock", () => {
    const at = new Date(2026, 9, 10, 19, 30);
    const view = resolvePulseStripView(pulse({ locale: "tr-TR" }), {
      fetchedAt: at.getTime(),
      now: at.getTime(),
    });
    expect(view.freshness).toBe("As of 19:30");
  });
});

/** F-954: the receive screen printed "TRY 1250.00", en-US and ungrouped. */
describe("receive money — grouped the house's way (F-954)", () => {
  it("groups a lira price with the house's marks", () => {
    expect(money(1250, "TRY", "tr-TR")).toBe("₺1.250,00");
    expect(money(1250, null, "tr-TR")).toBe("1.250,00 (currency not recorded)");
  });

  it("groups with en-US when the house's tag is not known", () => {
    expect(money(1250, "USD")).toBe("$1,250.00");
  });

  it("says the match in the house's marks", () => {
    const r = computeMatch({
      orderedQty: 12,
      poUnitPrice: 1250,
      poCurrency: "TRY",
      invoiceQty: 12,
      invoiceUnitPrice: 1300,
      invoiceCurrency: "TRY",
      acceptedQty: 12,
      locale: "tr-TR",
    });
    expect(r.summary).toContain("Billed ₺1.300,00 against a stated ₺1.250,00");
  });
});

/** F-955: the phone read a Turkish "1.250" as 1.25 and "1.250,00" as nothing. */
describe("readHousePrice — a typed price read with the house's marks (F-955)", () => {
  it("reads a Turkish house's grouped prices as thousands", () => {
    expect(readHousePrice("1.250", "tr-TR")).toEqual({ ok: true, value: 1250 });
    expect(readHousePrice("1.250,00", "tr-TR")).toEqual({ ok: true, value: 1250 });
    expect(readHousePrice("12,50", "tr-TR")).toEqual({ ok: true, value: 12.5 });
    expect(readHousePrice("₺ 1.250,5", "tr-TR")).toEqual({ ok: true, value: 1250.5 });
  });

  it("reads a US house's '1.250' as a decimal and '1,250.00' as thousands", () => {
    expect(readHousePrice("1.250", "en-US")).toEqual({ ok: true, value: 1.25 });
    expect(readHousePrice("1,250.00", "en-US")).toEqual({ ok: true, value: 1250 });
  });

  it("asks rather than guesses when the house's marks are not known", () => {
    const r = readHousePrice("1.250", null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toContain("without a thousands mark");
    expect(readHousePrice("12.50", null)).toEqual({ ok: true, value: 12.5 });
  });

  it("refuses what is not a price, and reads blank as nothing", () => {
    expect(readHousePrice("1.2.3", "tr-TR").ok).toBe(false);
    expect(readHousePrice("-5", "tr-TR").ok).toBe(false);
    expect(readHousePrice("abc", "tr-TR").ok).toBe(false);
    expect(readHousePrice("  ", "tr-TR")).toEqual({ ok: true, value: null });
  });
});

/** F-957: staff are sent no takings; the strip says why, not that a read failed. */
describe("Today strip for staff (F-957)", () => {
  it("says the sales are kept for the owner and managers", () => {
    const view = resolvePulseStripView(
      pulse({ salesState: "withheld", revenueToday: null, checksToday: null }),
    );
    expect(view.revenue).toEqual({
      status: "unavailable",
      message: REVENUE_UNAVAILABLE_MESSAGES.withheld,
    });
  });
});

function pulse(overrides: Partial<TodayPulse>): TodayPulse {
  return {
    salesState: "known",
    revenueToday: 100,
    checksToday: 4,
    revenueLastWeek: null,
    deltaPct: null,
    pendingDecisions: 0,
    criticalCount: 0,
    windowStart: null,
    windowEnd: "2026-10-10T20:00:00.000Z",
    generatedAt: "2026-10-10T20:00:00.000Z",
    currency: "TRY",
    locale: null,
    ...overrides,
  };
}

describe("houseDay — a date in the house's zone and words (F-1029)", () => {
  // 00:30 in Istanbul is still the evening before in Detroit.
  const lateNight = "2026-10-09T21:30:00Z";
  it("dates an Istanbul event on the Istanbul day, in Turkish", () => {
    expect(houseDay(lateNight, "tr-TR", "Europe/Istanbul", { month: "short", day: "numeric" })).toBe("10 Eki");
    expect(houseDay(lateNight, "en-US", "America/Detroit", { month: "short", day: "numeric" })).toBe("Oct 9");
  });
  it("keeps the phone's zone for no zone or one it cannot read, and prints nothing for no date", () => {
    const own = new Date(lateNight).toLocaleDateString("en-US", { day: "numeric" });
    expect(houseDay(lateNight, null, "Not/AZone", { day: "numeric" })).toBe(own);
    expect(houseDay(lateNight, null, null, { day: "numeric" })).toBe(own);
    expect(houseDay(null, "tr-TR", null, { day: "numeric" })).toBe("");
    expect(houseDay("not a date", "tr-TR", null, { day: "numeric" })).toBe("");
  });
});

describe("idle stock and cellar value never read a missing cost as zero (F-1027)", () => {
  const money = (v: number) => houseMoney(v, { currency: "TRY", locale: "tr-TR" });
  it("gives staff, whose rows carry no cost, the count and no false ₺0", () => {
    const dead = [{ quantity: 6 }, { quantity: 2 }, { quantity: 1 }];
    expect(idleStockWords(dead, false, money)).toBe("3 wines · value kept for the owner and managers");
  });
  it("names the wines with no cost for the owner instead of counting them as free", () => {
    expect(idleStockWords([{ quantity: 6, wac: 250 }, { quantity: 2 }], true, money)).toBe(
      "2 wines · ₺1.500 idle (1 with no cost)",
    );
    expect(idleStockWords([{ quantity: 2 }], true, money)).toBe("1 wine · no cost recorded");
    expect(idleStockWords([], true, money)).toBe("None");
  });
  it("values the cellar from the costs it has", () => {
    expect(stockValue([{ quantity: 6, wac: 250 }, { lotLiveQty: 2, wac: 100 }, { quantity: 3 }, { quantity: 0 }])).toEqual({
      value: 1700,
      unpriced: 1,
    });
    expect(stockValue([{ quantity: 3 }])).toEqual({ value: null, unpriced: 1 });
  });
});
