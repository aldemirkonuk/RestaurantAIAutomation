import {
  confidenceFromCount,
  daysBetween,
  hhmm,
  inferDeliveryWeekdays,
  inferLeadTime,
  inferMinimumOrder,
  inferOrderCutoff,
  inferTerms,
  localMoment,
  weekdayOfDateString,
  type OrderFact,
} from "./term-inference";

/**
 * The arithmetic that turns a house's own orders into a claim about a vendor.
 *
 * Every test here exists because the OPPOSITE behaviour is the plausible one:
 * a lead time that quietly clamps a broken row to zero, a cutoff stated as a
 * time rather than a bracket, a "minimum" that is really an upper bound, a
 * weekday read in UTC. Each of those would produce a confident, wrong number
 * that no reviewer would look at twice.
 */

const ISTANBUL = "Europe/Istanbul";

function order(p: Partial<OrderFact>): OrderFact {
  return {
    requestedAt: null,
    deliveredAt: null,
    expectedDeliveryDate: null,
    totalCost: null,
    status: null,
    ...p,
  };
}

describe("local time is the vendor's time, not UTC", () => {
  it("reads a late-evening UTC instant as the NEXT day in Istanbul", () => {
    // 2026-09-06 is a Sunday. 22:30 UTC is 01:30 on Monday in Istanbul (+03).
    const m = localMoment("2026-09-06T22:30:00Z", ISTANBUL);
    expect(m).not.toBeNull();
    expect(m?.date).toBe("2026-09-07");
    expect(m?.weekday).toBe(1);
    expect(hhmm(m?.minuteOfDay ?? 0)).toBe("01:30");
  });

  it("reads the same instant as Sunday in UTC — which is why the zone is an argument", () => {
    const m = localMoment("2026-09-06T22:30:00Z", "UTC");
    expect(m?.weekday).toBe(0);
  });

  it("returns null for an absent or unparseable date rather than substituting now()", () => {
    expect(localMoment(null, ISTANBUL)).toBeNull();
    expect(localMoment("not a date", ISTANBUL)).toBeNull();
  });

  it("falls back to UTC for an unknown IANA zone instead of throwing", () => {
    const m = localMoment("2026-09-06T22:30:00Z", "Mars/Olympus_Mons");
    expect(m?.date).toBe("2026-09-06");
  });

  it("reads a bare calendar date as a calendar date, with no zone shift", () => {
    expect(weekdayOfDateString("2026-09-07")).toBe(1);
    expect(daysBetween("2026-09-01", "2026-09-04")).toBe(3);
  });
});

describe("delivery weekdays", () => {
  it("finds the Monday/Wednesday/Friday pattern and keeps one stray Saturday out", () => {
    const rows: OrderFact[] = [];
    // Six Mondays, six Wednesdays, six Fridays across September 2026.
    for (const d of [
      "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12",
      "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30", "2026-10-07", "2026-10-14",
      "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16",
    ]) {
      rows.push(order({ deliveredAt: `${d}T09:00:00Z` }));
    }
    rows.push(order({ deliveredAt: "2026-09-12T09:00:00Z" })); // one Saturday

    const f = inferDeliveryWeekdays(rows, "UTC");
    expect(f.known).toBe(true);
    if (!f.known) return;
    expect(f.weekdays).toEqual([1, 3, 5]);
    expect(f.n).toBe(19);
    expect(f.perWeekday[6]).toBe(1);
    expect(f.fromArrivals).toBe(true);
    expect(f.confidence).toBe("high");
  });

  it("says which receipts were only PROMISED, never presenting them as arrivals", () => {
    const f = inferDeliveryWeekdays(
      [
        order({ deliveredAt: "2026-09-07T09:00:00Z" }),
        order({ expectedDeliveryDate: "2026-09-14" }),
      ],
      "UTC",
    );
    expect(f.known).toBe(true);
    if (!f.known) return;
    expect(f.fromArrivals).toBe(false);
    expect(f.basis).toContain("1 signed");
    expect(f.basis).toContain("1 only promised");
  });

  it("refuses to call seven scattered days a pattern", () => {
    const rows = [
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
      "2026-09-11", "2026-09-12", "2026-09-13",
    ].map((d) => order({ deliveredAt: `${d}T09:00:00Z` }));
    const f = inferDeliveryWeekdays(rows, "UTC");
    expect(f.known).toBe(true);
    if (!f.known) return;
    expect(f.confidence).toBe("low");
  });

  it("returns a reason, not an empty weekday list, when no order carries a date", () => {
    const f = inferDeliveryWeekdays([order({}), order({})], "UTC");
    expect(f.known).toBe(false);
    if (f.known) return;
    expect(f.n).toBe(0);
    expect(f.reason).toMatch(/no order/i);
  });
});

describe("lead time", () => {
  it("reports the median AND the slow tail, so a bimodal vendor cannot read as fast", () => {
    const rows: OrderFact[] = [];
    for (let i = 0; i < 9; i += 1) {
      rows.push(
        order({
          requestedAt: `2026-09-0${(i % 9) + 1}T08:00:00Z`,
          deliveredAt: `2026-09-0${(i % 9) + 2}T08:00:00Z`,
        }),
      );
    }
    // Three that took a fortnight.
    rows.push(order({ requestedAt: "2026-08-01T08:00:00Z", deliveredAt: "2026-08-15T08:00:00Z" }));
    rows.push(order({ requestedAt: "2026-08-02T08:00:00Z", deliveredAt: "2026-08-16T08:00:00Z" }));
    rows.push(order({ requestedAt: "2026-08-03T08:00:00Z", deliveredAt: "2026-08-17T08:00:00Z" }));

    const f = inferLeadTime(rows, "UTC");
    expect(f.known).toBe(true);
    if (!f.known) return;
    expect(f.medianDays).toBe(1);
    expect(f.p90Days).toBe(14);
    // A median of 1 with a p90 of 14 is two behaviours, not a lead time.
    expect(f.confidence).toBe("low");
  });

  it("DROPS an arrival dated before its own placement rather than clamping it to zero", () => {
    const f = inferLeadTime(
      [
        order({ requestedAt: "2026-09-10T08:00:00Z", deliveredAt: "2026-09-01T08:00:00Z" }),
        order({ requestedAt: "2026-09-01T08:00:00Z", deliveredAt: "2026-09-03T08:00:00Z" }),
        order({ requestedAt: "2026-09-04T08:00:00Z", deliveredAt: "2026-09-06T08:00:00Z" }),
      ],
      "UTC",
    );
    expect(f.known).toBe(true);
    if (!f.known) return;
    // Two usable rows, both two days. A clamp would have made the median 2 -> 2
    // by accident; the count is what proves the broken row left the sample.
    expect(f.n).toBe(2);
    expect(f.medianDays).toBe(2);
    expect(f.basis).toContain("1 dropped for arriving before placement");
  });

  it("counts in whole local days, so a 23:50 order delivered at 08:00 is one day and not zero", () => {
    const f = inferLeadTime(
      [order({ requestedAt: "2026-09-01T20:50:00Z", deliveredAt: "2026-09-02T05:00:00Z" })],
      ISTANBUL,
    );
    expect(f.known).toBe(true);
    if (!f.known) return;
    expect(f.medianDays).toBe(1);
  });

  it("says the ledger cannot be differenced when every row is backwards", () => {
    const f = inferLeadTime(
      [order({ requestedAt: "2026-09-10T08:00:00Z", deliveredAt: "2026-09-01T08:00:00Z" })],
      "UTC",
    );
    expect(f.known).toBe(false);
    if (f.known) return;
    expect(f.reason).toMatch(/before it was placed/);
  });
});

describe("order cutoff — a bracket, never a time", () => {
  it("brackets the cutoff between the latest hit and the earliest miss", () => {
    const rows = [
      // Made the one-day turnaround, placed 09:00 and 13:40.
      order({ requestedAt: "2026-09-01T09:00:00Z", deliveredAt: "2026-09-02T08:00:00Z" }),
      order({ requestedAt: "2026-09-03T13:40:00Z", deliveredAt: "2026-09-04T08:00:00Z" }),
      // Missed it, placed 15:10 and 17:00 — two days.
      order({ requestedAt: "2026-09-07T15:10:00Z", deliveredAt: "2026-09-09T08:00:00Z" }),
      order({ requestedAt: "2026-09-08T17:00:00Z", deliveredAt: "2026-09-10T08:00:00Z" }),
    ];
    const f = inferOrderCutoff(rows, "UTC");
    expect(f.known).toBe(true);
    if (!f.known) return;
    expect(hhmm(f.notBeforeMinute)).toBe("13:40");
    expect(f.notAfterMinute).not.toBeNull();
    expect(hhmm(f.notAfterMinute as number)).toBe("15:10");
    expect(f.fastestDays).toBe(1);
    expect(f.madeIt).toBe(2);
    expect(f.missed).toBe(2);
  });

  it("reports a floor with NO ceiling — and low confidence — when nothing has ever missed", () => {
    const rows = [
      order({ requestedAt: "2026-09-01T09:00:00Z", deliveredAt: "2026-09-02T08:00:00Z" }),
      order({ requestedAt: "2026-09-03T18:00:00Z", deliveredAt: "2026-09-04T08:00:00Z" }),
    ];
    const f = inferOrderCutoff(rows, "UTC");
    expect(f.known).toBe(true);
    if (!f.known) return;
    expect(hhmm(f.notBeforeMinute)).toBe("18:00");
    expect(f.notAfterMinute).toBeNull();
    expect(f.confidence).toBe("low");
    expect(f.basis).toContain("a floor with no ceiling");
  });

  it("does not invert the bracket when a miss was placed EARLIER than a hit", () => {
    // 08:00 took two days (a holiday, say); 16:00 took one. A naive
    // implementation would return "after 16:00, before 08:00".
    const rows = [
      order({ requestedAt: "2026-09-01T08:00:00Z", deliveredAt: "2026-09-03T08:00:00Z" }),
      order({ requestedAt: "2026-09-04T16:00:00Z", deliveredAt: "2026-09-05T08:00:00Z" }),
    ];
    const f = inferOrderCutoff(rows, "UTC");
    expect(f.known).toBe(true);
    if (!f.known) return;
    expect(hhmm(f.notBeforeMinute)).toBe("16:00");
    expect(f.notAfterMinute).toBeNull();
  });

  it("will not bracket anything from a single order", () => {
    const f = inferOrderCutoff(
      [order({ requestedAt: "2026-09-01T09:00:00Z", deliveredAt: "2026-09-02T08:00:00Z" })],
      "UTC",
    );
    expect(f.known).toBe(false);
    if (f.known) return;
    expect(f.reason).toMatch(/one order cannot bracket/i);
  });
});

describe("minimum order — an upper bound and nothing more", () => {
  it("counts only orders that actually arrived", () => {
    const f = inferMinimumOrder([
      order({ totalCost: 90, status: "cancelled" }),
      order({ totalCost: 400, status: "delivered" }),
      order({ totalCost: 250, status: "completed" }),
    ]);
    expect(f.known).toBe(true);
    if (!f.known) return;
    // 90 was never accepted, so it proves nothing about what they will take.
    expect(f.smallestAccepted).toBe(250);
    expect(f.secondSmallest).toBe(400);
    expect(f.n).toBe(2);
  });

  it("says so when nothing has both arrived and carried a cost", () => {
    const f = inferMinimumOrder([order({ totalCost: 500, status: "pending" })]);
    expect(f.known).toBe(false);
    if (f.known) return;
    expect(f.reason).toMatch(/never landed proves nothing/);
  });
});

describe("payment terms are not inferable, and the bundle says so", () => {
  it("never returns a payment-terms value, whatever the orders look like", () => {
    const bundle = inferTerms(
      [order({ requestedAt: "2026-09-01T09:00:00Z", deliveredAt: "2026-09-02T08:00:00Z", totalCost: 100, status: "delivered" })],
      { zone: "UTC", isColumnDefault: false },
    );
    expect(bundle.paymentTerms.known).toBe(false);
    expect(bundle.paymentTerms.reason).toMatch(/no table records when a vendor invoice/);
    expect(bundle.ordersRead).toBe(1);
    expect(bundle.zone.zone).toBe("UTC");
  });
});

describe("confidence is a stated rule, not a feeling", () => {
  it("has the documented cut points", () => {
    expect(confidenceFromCount(3)).toBe("low");
    expect(confidenceFromCount(4)).toBe("medium");
    expect(confidenceFromCount(11)).toBe("medium");
    expect(confidenceFromCount(12)).toBe("high");
  });
});
