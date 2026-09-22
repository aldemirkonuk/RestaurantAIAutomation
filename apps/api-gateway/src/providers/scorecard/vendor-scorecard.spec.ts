/**
 * The operational vendor scorecard's arithmetic — ADR 0207.
 *
 * Nothing is mocked: the unit under test is a pure function, and every case
 * hands it register rows and reads back what it counted. The same invented
 * Skurnik record sketch 117 ran through all three directions (README "Example
 * data") is rebuilt here where a case needs a whole vendor, so the drawing and
 * the code can be compared on the same facts.
 */

import {
  AgreedLineRow,
  ConversationRow,
  CreditRow,
  HouseRegisters,
  MEASURE_KEYS,
  MeasureResult,
  OrderArrivalRow,
  ReceiptEventRow,
  VerifiedLineRow,
  buildVendorScorecard,
  docketFor,
} from "./vendor-scorecard";
import { HouseFrame, houseFrame } from "../../common/house-frame";

/**
 * The house most cases run in: its clock is UTC and it names no country, so
 * dates print as ISO and numbers in plain English formats. Cases about the
 * house's own midnight and formats build their own frame from a house record.
 */
const UTC_HOUSE: HouseFrame = houseFrame({ timezone: "UTC", country: null });

const NOW = new Date("2026-09-17T12:00:00Z");
const V = "prov-skurnik";
const OTHER = "prov-winebow";

type DoorRow = ReceiptEventRow & {
  provider_id: string | null;
  order_number: string | null;
};

function regs(over: Partial<HouseRegisters> = {}): HouseRegisters {
  const empty = { ok: true as const, rows: [], collected: true };
  return {
    arrivals: empty,
    door: empty,
    verified: empty,
    agreedLines: empty,
    mail: empty,
    credits: empty,
    ...over,
  };
}

function build(
  r: HouseRegisters,
  days: 30 | 90 | 365 = 90,
  providerId = V,
  house: HouseFrame = UTC_HOUSE,
) {
  return buildVendorScorecard({
    providerId,
    providerName: "Skurnik",
    days,
    now: NOW,
    house,
    registers: r,
  });
}

function measure(
  card: { measures: MeasureResult[] },
  key: MeasureResult["key"],
): MeasureResult {
  const m = card.measures.find((x) => x.key === key);
  if (!m) throw new Error(`no measure ${key}`);
  return m;
}

let seq = 0;
function arrival(
  delivered: string,
  expected: string | null,
  over: Partial<OrderArrivalRow> = {},
): OrderArrivalRow {
  seq += 1;
  return {
    id: `ord-${seq}`,
    order_number: `PO-${seq}`,
    provider_id: V,
    status: "DELIVERED",
    expected_delivery_date: expected,
    delivered_at: delivered,
    ...over,
  };
}

function door(
  outcome: string | null,
  at: string,
  over: Partial<DoorRow> = {},
): DoorRow {
  seq += 1;
  return {
    id: `ev-${seq}`,
    order_id: `ord-door-${seq}`,
    order_number: `PO-D${seq}`,
    provider_id: V,
    stage: "case_count",
    outcome,
    refusal_reason: null,
    rejected_qty: 0,
    damage_photo_path: null,
    occurred_at: at,
    ...over,
  };
}

function verified(
  at: string,
  priceVerified: boolean | null,
  invoiced: number | null,
  header: number | null,
  over: Partial<VerifiedLineRow> = {},
): VerifiedLineRow {
  seq += 1;
  return {
    id: `ord-v-${seq}`,
    order_number: `PO-V${seq}`,
    provider_id: V,
    match_verified_at: at,
    match_status: priceVerified === false ? "price_variance" : "matched",
    price_verified: priceVerified,
    invoice_unit_price: invoiced,
    final_price: header,
    negotiated_price: null,
    quoted_price: null,
    ...over,
  };
}

function msg(
  dir: "outbound" | "inbound",
  at: string,
  thread: string | null,
  over: Partial<ConversationRow> = {},
): ConversationRow {
  seq += 1;
  return {
    id: `msg-${seq}`,
    provider_id: V,
    direction: dir,
    status: dir === "outbound" ? "SENT" : "RECEIVED",
    sent_at: dir === "outbound" ? at : null,
    received_at: dir === "inbound" ? at : null,
    thread_key: thread,
    gmail_thread_id: null,
    thread_id: null,
    ...over,
  };
}

function claim(
  state: string,
  asked: number,
  allowed: number | null,
  opened: string,
  over: Partial<CreditRow> = {},
): CreditRow {
  seq += 1;
  return {
    id: `claim-${seq}-aaaaaaaa`,
    provider_id: V,
    order_id: null,
    reason: "qty_short",
    currency: "USD",
    claimed_amount: asked,
    credited_amount: allowed,
    state,
    opened_at: opened,
    promised_at: null,
    ...over,
  };
}

const ok = <T>(rows: T[], collected = true) => ({
  ok: true as const,
  rows,
  collected,
});

/** The invariant the Docket rests on: every tally is the count of its rows. */
function assertTalliesAreTheirRows(
  r: HouseRegisters,
  days: 30 | 90 | 365 = 90,
) {
  const built = build(r, days);
  for (const key of MEASURE_KEYS) {
    const m = measure(built.card, key);
    for (const w of ["current", "prior"] as const) {
      const rows = built.entries.filter(
        (e) => e.measure === key && e.window === w,
      );
      const t = w === "current" ? m : m.prior;
      if (t.outcome === "could_not_read" || t.outcome === "not_collected") {
        expect(rows).toHaveLength(0);
        continue;
      }
      expect(t.sample).toBe(rows.filter((e) => e.counted).length);
      if (t.hits !== null)
        expect(t.hits).toBe(rows.filter((e) => e.hit === true).length);
    }
    expect(m.rows).toBe(docketFor(built, key).length);
  }
}

describe("on time — before the house's midnight, with its denominator", () => {
  it("counts landed-before-midnight on the expected date, and lists an undated delivery without counting it", () => {
    const rows = [
      arrival("2026-09-10T09:00:00Z", "2026-09-10"),
      arrival("2026-09-10T23:59:59Z", "2026-09-10"), // the last second still counts
      arrival("2026-09-11T00:00:01Z", "2026-09-10"), // one second over: 1 day late
      arrival("2026-09-01T10:00:00Z", "2026-08-29"), // 3 days late
      arrival("2026-08-20T10:00:00Z", "2026-08-22"),
      arrival("2026-08-02T10:00:00Z", "2026-08-02", {
        status: "PARTIALLY_RECEIVED",
      }),
      arrival("2026-08-05T10:00:00Z", null), // no expected date
      arrival("2026-08-06T10:00:00Z", "2026-08-06", { status: "ORDERED" }), // never arrived: not in the universe
    ];
    const built = build(regs({ arrivals: ok(rows) }));
    const m = measure(built.card, "onTime");
    expect(m.outcome).toBe("answered");
    expect(m.sample).toBe(6);
    expect(m.hits).toBe(4);
    expect(m.value).toBeCloseTo(4 / 6);
    expect(m.excluded).toEqual([{ because: "no expected date", count: 1 }]);
    expect(m.rows).toBe(7);
    expect(m.percent).toBe("67%");
    expect(m.sentence).toBe(
      "67% on time — 4 of 6 by the expected date. 2 landed late, by 1, 3 days. 1 is listed and not counted: no expected date.",
    );
    expect(built.card.fact).toEqual({
      text: "67% on time · 4 of 6",
      outcome: "answered",
    });
    const late = built.entries
      .filter((e) => e.measure === "onTime" && e.hit === false)
      .map((e) => e.daysLate);
    expect(late.sort()).toEqual([1, 3]);
  });

  // The founder's delegation of 2026-09-21 ("think of a best way to handle
  // this ... You tell me"): an order past its date is ASKED first, and counts
  // late only once confirmed — a "Not yet" answer for that expected date, or a
  // landing after it (procurement/overdue-order.ts).
  const out = (
    expected: string,
    status: string,
    over: Partial<OrderArrivalRow> = {},
  ): OrderArrivalRow => ({
    id: `out-${expected}-${status}`,
    order_number: `PO-OUT-${status}-${expected}`,
    provider_id: V,
    status,
    expected_delivery_date: expected,
    delivered_at: null,
    ...over,
  });
  const notYet = (orderId: string, expected: string, at: string) => ({
    order_id: orderId,
    answer: "not_yet",
    expected_date: expected,
    answered_at: at,
  });
  const fiveOnTime = () =>
    [1, 2, 3, 4, 5].map((d) =>
      arrival(`2026-09-0${d}T10:00:00Z`, `2026-09-0${d}`),
    );

  it("lists an order past its date that nobody has answered for as unconfirmed, NOT counted, and never lists it before its date", () => {
    const rows = [
      ...fiveOnTime(),
      out("2026-09-06", "IN_TRANSIT"), // 11 days past it, unanswered
      out("2026-09-16", "CONFIRMED"), // 1 day past, unanswered
      out("2026-09-17", "CONFIRMED"), // due today: not late yet
      out("2026-09-01", "PENDING"), // never placed with the vendor: not theirs
      // Cancelled with no cancel_reason_code and no cancelled_from_status on
      // record (a row from before ADR 0207 round 4's columns existed): listed,
      // never counted, and says so — cancelledEntry's "no code (legacy)" arm.
      out("2026-09-02", "CANCELLED"),
    ];
    const built = build(regs({ arrivals: ok(rows) }));
    const m = measure(built.card, "onTime");
    expect(m).toMatchObject({
      outcome: "answered",
      sample: 5,
      hits: 5,
      open: 2,
      rows: 8,
      overdue: { confirmed: 0, unconfirmed: 2, incomplete: 0 },
    });
    expect(m.sentence).toContain(
      "2 orders are past the expected date and nobody here has said whether they arrived — unconfirmed, not counted.",
    );
    const cancelledLegacy = built.entries.find(
      (e) => e.measure === "onTime" && e.source.id === "out-2026-09-02-CANCELLED",
    );
    expect(cancelledLegacy).toMatchObject({
      counted: false,
      hit: null,
      excludedBecause: "cancelled before a reason was kept",
    });
    expect(built.card.fact.text).toBe(
      "100% on time · 5 of 5 · 2 unconfirmed, not counted",
    );
    const open = docketFor(built, "onTime").filter((e) => e.open);
    expect(
      open.map((e) => [e.title, e.daysLate, e.counted, e.overdue]),
    ).toEqual([
      ["PO-OUT-CONFIRMED-2026-09-16", 1, false, "unconfirmed"],
      ["PO-OUT-IN_TRANSIT-2026-09-06", 11, false, "unconfirmed"],
    ]);
    expect(open[1].detail).toContain(
      'waiting on the question "Did it arrive?"',
    );
  });

  it("ADR 0207 round 4 — a never_arrived cancel counts a miss, dated at its deadline; vendor_cannot_supply and house_decision are listed, never counted; a pre-placement cancel is not listed at all", () => {
    const rows = [
      ...fiveOnTime(),
      out("2026-09-06", "CANCELLED", {
        cancel_reason_code: "never_arrived",
        cancelled_from_status: "IN_TRANSIT",
        cancelled_at: "2026-09-09T00:00:00Z",
      }),
      out("2026-09-10", "CANCELLED", {
        cancel_reason_code: "vendor_cannot_supply",
        cancelled_from_status: "CONFIRMED",
        cancelled_at: "2026-09-08T00:00:00Z",
      }),
      out("2026-09-11", "CANCELLED", {
        cancel_reason_code: "house_decision",
        cancelled_from_status: "CONFIRMED",
        cancelled_at: "2026-09-09T00:00:00Z",
      }),
      // Never placed with the vendor at all: not a vendor event, not listed.
      out("2026-09-12", "CANCELLED", {
        cancel_reason_code: "house_decision",
        cancelled_from_status: "PENDING",
        cancelled_at: "2026-09-09T00:00:00Z",
      }),
    ];
    const built = build(regs({ arrivals: ok(rows) }));
    const m = measure(built.card, "onTime");
    // 5 on-time arrivals + 1 never_arrived miss = 6 sample, 5 hits.
    expect(m).toMatchObject({ outcome: "answered", sample: 6, hits: 5 });
    const neverArrived = built.entries.find(
      (e) => e.measure === "onTime" && e.source.id === "out-2026-09-06-CANCELLED",
    );
    expect(neverArrived).toMatchObject({ counted: true, hit: false, open: false });
    expect(neverArrived?.detail).toContain("never arrived, and cancelled");
    const couldNotSupply = built.entries.find(
      (e) => e.measure === "onTime" && e.source.id === "out-2026-09-10-CANCELLED",
    );
    expect(couldNotSupply).toMatchObject({
      counted: false,
      hit: null,
      excludedBecause: "cancelled — the vendor said it could not supply this order",
    });
    const houseDecision = built.entries.find(
      (e) => e.measure === "onTime" && e.source.id === "out-2026-09-11-CANCELLED",
    );
    expect(houseDecision).toMatchObject({
      counted: false,
      hit: null,
      excludedBecause: "cancelled by the house",
    });
    const prePlacement = built.entries.find(
      (e) => e.measure === "onTime" && e.source.id === "out-2026-09-12-CANCELLED",
    );
    expect(prePlacement).toBeUndefined();
  });

  it("refuses to count a never_arrived cancel that predates its own deadline (never-should-happen, but a read must not guess)", () => {
    const rows = [
      ...fiveOnTime(),
      out("2026-09-06", "CANCELLED", {
        expected_delivery_date: null,
        cancel_reason_code: "never_arrived",
        cancelled_from_status: "IN_TRANSIT",
        cancelled_at: "2026-09-09T00:00:00Z",
      }),
    ];
    const built = build(regs({ arrivals: ok(rows) }));
    const entry = built.entries.find(
      (e) => e.measure === "onTime" && e.source.id === "out-2026-09-06-CANCELLED",
    );
    expect(entry).toMatchObject({ counted: false, hit: null });
    expect(entry?.excludedBecause).toBe("no expected date");
  });

  it("counts an order late once someone here answered Not yet for THAT expected date, in the window its deadline fell in (question 8)", () => {
    const a = out("2026-09-06", "IN_TRANSIT", {
      arrival_answers: [
        notYet(
          "out-2026-09-06-IN_TRANSIT",
          "2026-09-06",
          "2026-09-08T09:00:00Z",
        ),
      ],
    });
    const b = out("2026-09-16", "CONFIRMED", {
      arrival_answers: [
        notYet(
          "out-2026-09-16-CONFIRMED",
          "2026-09-16",
          "2026-09-17T08:00:00Z",
        ),
      ],
    });
    const built = build(regs({ arrivals: ok([...fiveOnTime(), a, b]) }));
    const m = measure(built.card, "onTime");
    expect(m).toMatchObject({
      sample: 7,
      hits: 5,
      open: 2,
      percent: "71%",
      overdue: { confirmed: 2, unconfirmed: 0, incomplete: 0 },
    });
    expect(m.sentence).toContain(
      "2 orders are past the expected date and not landed, and someone here said not yet — counted as late, still open.",
    );
    expect(built.card.fact.text).toBe("71% on time · 5 of 7 · 2 overdue");
    const open = docketFor(built, "onTime").filter((e) => e.open);
    expect(
      open.every(
        (e) => e.counted && e.hit === false && e.overdue === "confirmed",
      ),
    ).toBe(true);
    expect(open[1].detail).toBe(
      "Expected by 2026-09-06; 11 days past it and not landed. Someone here said not yet on 2026-09-08 — counted as late.",
    );
  });

  it("does not let a Not yet for an earlier expected date, or one given before the date passed, confirm the deadline", () => {
    const moved = out("2026-09-10", "CONFIRMED", {
      // The vendor gave a new date; the answer was for the old one.
      arrival_answers: [notYet("x", "2026-09-05", "2026-09-06T09:00:00Z")],
    });
    const early = out("2026-09-12", "CONFIRMED", {
      // Answered before the deadline could have passed anywhere.
      arrival_answers: [notYet("y", "2026-09-12", "2026-09-11T09:00:00Z")],
    });
    const built = build(
      regs({ arrivals: ok([...fiveOnTime(), moved, early]) }),
    );
    const m = measure(built.card, "onTime");
    expect(m.overdue).toEqual({ confirmed: 0, unconfirmed: 2, incomplete: 0 });
    expect(m.sample).toBe(5);
  });

  it("moves an order 30 days past its date to Incomplete orders and out of the figures, answered or not", () => {
    const answered = out("2026-08-10", "IN_TRANSIT", {
      arrival_answers: [notYet("z", "2026-08-10", "2026-08-12T09:00:00Z")],
    });
    const silent = out("2026-08-01", "CONFIRMED");
    const built = build(
      regs({ arrivals: ok([...fiveOnTime(), answered, silent]) }),
    );
    const m = measure(built.card, "onTime");
    expect(m).toMatchObject({
      sample: 5,
      hits: 5,
      overdue: { confirmed: 0, unconfirmed: 0, incomplete: 2 },
    });
    expect(m.sentence).toContain(
      "2 orders are 30 days past the expected date and not arrived — in Incomplete orders under Documents & Reports",
    );
    const inc = docketFor(built, "onTime").filter(
      (e) => e.overdue === "incomplete",
    );
    expect(inc).toHaveLength(2);
    expect(inc.every((e) => !e.counted && e.open)).toBe(true);
    // An order closed with a credit is not an open order at all.
    const closed = build(
      regs({
        arrivals: ok([
          ...fiveOnTime(),
          out("2026-09-06", "IN_TRANSIT", { closed_with_credit: true }),
        ]),
      }),
    );
    expect(measure(closed.card, "onTime")).toMatchObject({ open: 0, rows: 5 });
  });

  it("dates a late landing at its deadline: expected in the prior window and landed in this one, it counts in the prior window", () => {
    // 90-day window from 2026-06-19; expected 2026-06-10 (prior), landed 2026-06-25 (current).
    const lateAcross = arrival("2026-06-25T10:00:00Z", "2026-06-10");
    const built = build(regs({ arrivals: ok([...fiveOnTime(), lateAcross]) }));
    const m = measure(built.card, "onTime");
    expect(m).toMatchObject({ sample: 5, hits: 5 });
    expect(m.prior).toMatchObject({ sample: 1, hits: 0 });
    const e = built.entries.find((x) => x.id === `onTime:${lateAcross.id}`);
    expect(e).toMatchObject({ window: "prior", hit: false, daysLate: 15 });
    expect(e?.detail).toBe(
      "Landed on 2026-06-25, 15 days after the expected date (2026-06-10) — late, in the window its date fell in.",
    );
  });

  it("refuses to score four deliveries, prints the count, and never prints a zero", () => {
    const rows = [1, 2, 3, 4].map((d) =>
      arrival(`2026-09-0${d}T10:00:00Z`, `2026-09-0${d}`),
    );
    const built = build(regs({ arrivals: ok(rows) }));
    const m = measure(built.card, "onTime");
    expect(m.outcome).toBe("too_few");
    expect(m.value).toBeNull();
    expect(m.sample).toBe(4);
    expect(m.percent).toBeNull();
    expect(m.sentence).toBe(
      "4 orders that landed or fell due in 90 days — too few to score; 5 are needed.",
    );
    expect(built.card.fact).toEqual({
      text: "4 orders — too few to score",
      outcome: "too_few",
    });
  });

  it("says a house that never records an expected date is not collected — not late, unknown", () => {
    const built = build(
      regs({ arrivals: ok([arrival("2026-09-01T10:00:00Z", null)], false) }),
    );
    const m = measure(built.card, "onTime");
    expect(m.outcome).toBe("not_collected");
    expect(m.sentence).toMatch(/Not late — unknown\.$/);
    expect(m.rows).toBe(0);
    expect(built.card.fact.outcome).toBe("not_collected");
  });

  it("writes a register that did not answer on its own line, with the reason", () => {
    const built = build(
      regs({ arrivals: { ok: false, reason: "502 upstream" } }),
    );
    const m = measure(built.card, "onTime");
    expect(m.outcome).toBe("could_not_read");
    expect(m.value).toBeNull();
    expect(m.sentence).toBe(
      "The orders book did not answer (502 upstream). This line is unknown, not zero.",
    );
    expect(m.prior.outcome).toBe("could_not_read");
    expect(built.card.quiet).toBe(false);
    expect(built.card.fact).toEqual({
      text: "the orders book did not answer",
      outcome: "could_not_read",
    });
  });
});

describe("the prior window is a window, never an endpoint", () => {
  it("prints both counts when both windows reach the minimum", () => {
    const cur = [1, 2, 3, 4, 5, 6].map((d) =>
      arrival(`2026-09-0${d}T10:00:00Z`, `2026-09-0${d}`),
    );
    // 90 days before 2026-06-19 12:00Z: the prior window. 5 of them, 3 on time.
    const prior = [
      arrival("2026-05-01T10:00:00Z", "2026-05-01"),
      arrival("2026-05-02T10:00:00Z", "2026-05-02"),
      arrival("2026-05-03T10:00:00Z", "2026-05-03"),
      arrival("2026-05-06T10:00:00Z", "2026-05-04"),
      arrival("2026-05-09T10:00:00Z", "2026-05-05"),
    ];
    const m = measure(
      build(regs({ arrivals: ok([...cur, ...prior]) })).card,
      "onTime",
    );
    expect(m.hits).toBe(6);
    expect(m.sample).toBe(6);
    expect(m.prior).toMatchObject({ outcome: "answered", hits: 3, sample: 5 });
    expect(m.priorSentence).toBe("prior 90 d · 60% · 3 of 5");
  });

  it("compares nothing when the prior window is under the minimum, and says the count", () => {
    const cur = [1, 2, 3, 4, 5].map((d) =>
      arrival(`2026-09-0${d}T10:00:00Z`, `2026-09-0${d}`),
    );
    const prior = [
      arrival("2026-05-01T10:00:00Z", "2026-05-01"),
      arrival("2026-05-02T10:00:00Z", "2026-05-02"),
    ];
    const m = measure(
      build(regs({ arrivals: ok([...cur, ...prior]) })).card,
      "onTime",
    );
    expect(m.prior.outcome).toBe("too_few");
    expect(m.prior.value).toBeNull();
    expect(m.priorSentence).toBe("prior 90 d · 2 — too few to compare");
  });

  it("never names a direction: a flat record reads as two equal counts, not 'declining'", () => {
    const cur = [1, 2, 3, 4, 5].map((d) =>
      arrival(`2026-09-0${d}T10:00:00Z`, `2026-09-0${d}`),
    );
    const prior = [1, 2, 3, 4, 5].map((d) =>
      arrival(`2026-05-0${d}T10:00:00Z`, `2026-05-0${d}`),
    );
    const card = build(regs({ arrivals: ok([...cur, ...prior]) })).card;
    const text = JSON.stringify(card);
    expect(text).not.toMatch(/declin|improv|worse|better/i);
    expect(measure(card, "onTime").priorSentence).toBe(
      "prior 90 d · 100% · 5 of 5",
    );
  });

  it("drops rows older than the prior window from both", () => {
    const old = arrival("2026-01-01T10:00:00Z", "2026-01-01");
    const built = build(regs({ arrivals: ok([old]) }));
    expect(built.entries).toHaveLength(0);
  });
});

describe("lines as ordered — the door's verdicts", () => {
  it("counts accepted-as-ordered lines, and a refused box, a short, a photo or a part refusal is not as ordered", () => {
    const rows = [
      door("accepted", "2026-09-01T10:00:00Z"),
      door("accepted", "2026-09-02T10:00:00Z"),
      door("accepted", "2026-09-03T10:00:00Z", { rejected_qty: 2 }),
      door("accepted", "2026-09-04T10:00:00Z", {
        damage_photo_path: "door/1.jpg",
      }),
      door("short", "2026-09-05T10:00:00Z"),
      door("refused", "2026-09-06T10:00:00Z", {
        refusal_reason: "broken_case",
      }),
      door(null, "2026-09-07T10:00:00Z"), // counted, no verdict
    ];
    const built = build(regs({ door: ok(rows) }));
    const m = measure(built.card, "linesAsOrdered");
    expect(m).toMatchObject({
      outcome: "answered",
      sample: 6,
      hits: 2,
      rows: 7,
    });
    expect(m.excluded).toEqual([
      { because: "counted at the door with no verdict recorded", count: 1 },
    ]);
    const refused = built.entries.find((e) => e.detail.startsWith("Refused"));
    expect(refused?.detail).toBe("Refused at the door (broken case).");
  });

  it("keeps one verdict per line: the latest door event that carries one", () => {
    const first = door("short", "2026-09-01T10:00:00Z", { order_id: "ord-x" });
    const later = door("accepted", "2026-09-02T10:00:00Z", {
      order_id: "ord-x",
    });
    const bottleCount = door(null, "2026-09-03T10:00:00Z", {
      order_id: "ord-x",
      stage: "bottle_count",
    });
    const built = build(regs({ door: ok([first, later, bottleCount]) }));
    const lines = built.entries.filter((e) => e.measure === "linesAsOrdered");
    expect(lines).toHaveLength(1);
    expect(lines[0].hit).toBe(true);
    expect(lines[0].source.id).toBe(later.id);
  });

  it("does not attribute a door event with no order to any vendor", () => {
    const built = build(
      regs({
        door: ok([door("short", "2026-09-01T10:00:00Z", { order_id: null })]),
      }),
    );
    expect(built.entries).toHaveLength(0);
  });
});

describe("price as agreed — the verification's own verdict", () => {
  it("counts lines at the agreed price, lists unpriced and uncomparable lines beside the figure", () => {
    const lines = [
      verified("2026-09-01T10:00:00Z", true, 20, 20),
      verified("2026-09-02T10:00:00Z", true, 20, 20),
      verified("2026-09-03T10:00:00Z", true, 20, 20),
      verified("2026-09-04T10:00:00Z", true, 20, 20),
      verified("2026-09-05T10:00:00Z", false, 21, 20),
      verified("2026-09-06T10:00:00Z", false, 18, 20),
      verified("2026-09-07T10:00:00Z", null, null, 20), // no invoice price
      verified("2026-09-08T10:00:00Z", false, 30, null, { id: "ord-keg" }), // keg agreement
    ];
    const agreed: AgreedLineRow[] = [
      {
        order_id: "ord-keg",
        price_uom: "keg",
        price_pack_size: 1,
        final_unit_price: 400,
        currency: "USD",
      },
    ];
    const built = build(regs({ verified: ok(lines), agreedLines: ok(agreed) }));
    const m = measure(built.card, "priceAsAgreed");
    expect(m).toMatchObject({
      outcome: "answered",
      sample: 6,
      hits: 4,
      rows: 8,
    });
    expect(m.sentence).toContain(
      "67% at the agreed price — 4 of 6 invoiced lines. 1 above it. 1 below it.",
    );
    expect(m.excluded.map((x) => x.because).sort()).toEqual([
      "no agreed price it can be compared with",
      "no invoiced price recorded",
    ]);
    const above = built.entries.find((e) => e.invoiced === 21);
    expect(above?.detail).toBe("Invoiced above the agreed price by 5.0%.");
    const keg = built.entries.find((e) => e.source.id === "ord-keg");
    expect(keg?.detail).toMatch(
      /^Not compared: the agreement is priced per keg/,
    );
  });

  it("fails the whole line when the agreed lines could not be read, rather than guessing them", () => {
    const built = build(
      regs({
        verified: ok([verified("2026-09-01T10:00:00Z", true, 20, 20)]),
        agreedLines: { ok: false, reason: "timeout" },
      }),
    );
    const m = measure(built.card, "priceAsAgreed");
    expect(m.outcome).toBe("could_not_read");
    expect(m.reason).toContain("timeout");
  });
});

describe("reply time — our message to their next reply, same thread", () => {
  it("takes the median over answered waits; a chase is not a second wait; an unanswered one is open", () => {
    const rows = [
      // thread a: 2 h
      msg("outbound", "2026-09-01T08:00:00Z", "a"),
      msg("inbound", "2026-09-01T10:00:00Z", "a"),
      // thread b: we write twice, they answer once — 6 h from the FIRST
      msg("outbound", "2026-09-02T08:00:00Z", "b"),
      msg("outbound", "2026-09-02T12:00:00Z", "b"),
      msg("inbound", "2026-09-02T14:00:00Z", "b"),
      // thread c: 1 h, then they write again unprompted (not a reply)
      msg("outbound", "2026-09-03T08:00:00Z", "c"),
      msg("inbound", "2026-09-03T09:00:00Z", "c"),
      msg("inbound", "2026-09-03T11:00:00Z", "c"),
      // thread d: 30 h
      msg("outbound", "2026-09-04T08:00:00Z", "d"),
      msg("inbound", "2026-09-05T14:00:00Z", "d"),
      // thread e: 4 h
      msg("outbound", "2026-09-06T08:00:00Z", "e"),
      msg("inbound", "2026-09-06T12:00:00Z", "e"),
      // thread f: no reply yet
      msg("outbound", "2026-09-15T08:00:00Z", "f"),
      // never confirmed as sent
      msg("outbound", "2026-09-07T08:00:00Z", "g", {
        status: "SEND_UNCONFIRMED",
      }),
      // a draft is not our message
      msg("outbound", "2026-09-08T08:00:00Z", "h", {
        status: "PENDING_APPROVAL",
      }),
      // no thread on record
      msg("outbound", "2026-09-09T08:00:00Z", null),
    ];
    const built = build(regs({ mail: ok(rows) }));
    const m = measure(built.card, "replyTime");
    expect(m.outcome).toBe("answered");
    expect(m.sample).toBe(5);
    expect(m.value).toBe(4); // median of 1, 2, 4, 6, 30
    expect(m.slowestHours).toBe(30);
    expect(m.open).toBe(1);
    expect(m.rows).toBe(8); // 5 answered + 1 open + 1 unconfirmed + 1 unthreaded
    expect(m.sentence).toContain(
      "Median 4 h from our message to their next reply in the same thread, over 5 replies. Slowest 30 h.",
    );
    expect(m.sentence).toContain(
      "1 message has no reply yet — not counted, not forgotten.",
    );
  });

  it("reads direction and thread the way the writers wrote them (upper case, gmail thread)", () => {
    const rows = [0, 1, 2, 3, 4].flatMap((i) => [
      msg("outbound", `2026-09-0${i + 1}T08:00:00Z`, null, {
        direction: "OUTBOUND",
        gmail_thread_id: `t${i}`,
      }),
      msg("inbound", `2026-09-0${i + 1}T09:00:00Z`, null, {
        direction: "INBOUND",
        gmail_thread_id: `t${i}`,
      }),
    ]);
    const m = measure(build(regs({ mail: ok(rows) })).card, "replyTime");
    expect(m).toMatchObject({ outcome: "answered", sample: 5, value: 1 });
  });

  it("matches a sent draft to its reply by the Gmail thread, though the draft kept the key it was inserted with", () => {
    // set_conversation_thread_key() fills thread_key only while it is empty:
    // an agent's draft inserted with no Gmail thread is `msg:<id>` for good,
    // even after the send writes gmail_thread_id; the reply is `gm:<thread>`.
    const rows = [0, 1, 2, 3, 4].flatMap((i) => [
      msg("outbound", `2026-09-0${i + 1}T08:00:00Z`, `msg:draft-${i}`, {
        gmail_thread_id: `g${i}`,
      }),
      msg("inbound", `2026-09-0${i + 1}T11:00:00Z`, `gm:g${i}`, {
        gmail_thread_id: `g${i}`,
      }),
    ]);
    const m = measure(build(regs({ mail: ok(rows) })).card, "replyTime");
    expect(m).toMatchObject({
      outcome: "answered",
      sample: 5,
      value: 3,
      open: 0,
    });
  });

  it("counts an auto-sent message as ours — AUTO_SENT is a send the house recorded", () => {
    const rows = [0, 1, 2, 3, 4].flatMap((i) => [
      msg("outbound", `2026-09-0${i + 1}T08:00:00Z`, `auto-${i}`, {
        status: "AUTO_SENT",
      }),
      msg("inbound", `2026-09-0${i + 1}T10:00:00Z`, `auto-${i}`),
    ]);
    const m = measure(build(regs({ mail: ok(rows) })).card, "replyTime");
    expect(m).toMatchObject({ outcome: "answered", sample: 5, value: 2 });
    expect(m.excluded).toEqual([]);
  });

  it("says not collected when this house has no vendor mail at all — not slow, unknown", () => {
    const m = measure(build(regs({ mail: ok([], false) })).card, "replyTime");
    expect(m.outcome).toBe("not_collected");
    expect(m.sentence).toBe(
      "No vendor mail is recorded for this house, so reply times cannot be measured. Not slow — unknown.",
    );
  });
});

describe("credits — recovered by credit memo, of what was asked", () => {
  const skurnik = () => [
    claim("credited", 182.5, 182.5, "2026-07-03T10:00:00Z"),
    claim("credited", 118, 103.5, "2026-07-27T10:00:00Z"),
    claim("promised", 112, null, "2026-08-09T10:00:00Z", {
      promised_at: "2026-08-09T10:00:00Z",
    }),
  ];

  it("under five claims shows no percent and lists the claims themselves as rows (question 2)", () => {
    const built = build(regs({ credits: ok(skurnik()) }));
    const m = measure(built.card, "credits");
    expect(m).toMatchObject({
      outcome: "too_few",
      sample: 3,
      hits: 2,
      value: null,
      percent: null,
      money: null,
      minimum: 5,
      open: 1,
    });
    expect(m.sentence).toBe(
      "3 claims in 90 days — too few to score; 5 are needed. 1 claim is still open or promised — in what was asked, not in what was recovered.",
    );
    expect(m.listed?.map((e) => e.at)).toEqual([
      "2026-08-09T10:00:00Z",
      "2026-07-27T10:00:00Z",
      "2026-07-03T10:00:00Z",
    ]);
    expect(m.listed?.map((e) => e.detail)).toEqual([
      "Promised, 39 days ago, not recovered — promised is not recovered.",
      "Credited $103.50 of $118.00 asked.",
      "Credited $182.50 of $182.50 asked.",
    ]);
    expect(m.listed?.[0].amountAllowed).toBeNull();
  });

  it("at five claims prints the percent recovered with the money, the promised claim in the denominator only", () => {
    const rows = [
      ...skurnik(),
      claim("credited", 50, 40, "2026-08-20T10:00:00Z"),
      claim("rejected", 20, null, "2026-09-01T10:00:00Z"),
    ];
    const m = measure(build(regs({ credits: ok(rows) })).card, "credits");
    expect(m.outcome).toBe("answered");
    expect(m.listed).toBeNull();
    expect(m.money).toEqual([
      {
        currency: "USD",
        allowed: 326,
        asked: 482.5,
        share: 326 / 482.5,
        percent: "68%",
      },
    ]);
    expect(m.percent).toBe("68%");
    expect(m.value).toBeCloseTo(326 / 482.5);
    expect(m.sentence).toBe(
      "68% recovered — $326.00 by credit memo of $482.50 asked, on 5 claims; 3 credited. 1 claim is still open or promised — in what was asked, not in what was recovered.",
    );
  });

  it("never adds two currencies together: two totals, no single share, and no percent for a currency under five claims (question 2)", () => {
    const rows = [
      claim("credited", 100, 100, "2026-09-01T10:00:00Z", { currency: "USD" }),
      claim("credited", 50, 25, "2026-09-02T10:00:00Z", { currency: "USD" }),
      claim("rejected", 50, null, "2026-09-03T10:00:00Z", { currency: "USD" }),
      claim("credited", 1200, 1200, "2026-09-02T10:00:00Z", {
        currency: "TRY",
      }),
      claim("open", 300, null, "2026-09-04T10:00:00Z", { currency: "TRY" }),
    ];
    const m = measure(build(regs({ credits: ok(rows) })).card, "credits");
    // Five claims in all, so the line answers — but three dollars and two
    // lira are not five of either, so neither currency prints a percent.
    expect(m.outcome).toBe("answered");
    expect(m.value).toBeNull();
    expect(m.percent).toBeNull();
    expect(m.money?.map((x) => [x.currency, x.share, x.percent])).toEqual([
      ["TRY", null, null],
      ["USD", null, null],
    ]);
    expect(m.sentence).toContain(
      "Money in two currencies is not added together",
    );
    expect(m.sentence).toContain(
      "A currency with fewer than 5 claims of its own shows its money and no percent.",
    );
    expect(m.sentence).not.toContain("%");
    expect(m.priorSentence).not.toContain("%");
  });

  it("prints a currency's percent once it alone holds five claims, and only that one's", () => {
    const rows = [
      claim("credited", 100, 100, "2026-09-01T10:00:00Z", { currency: "USD" }),
      claim("credited", 50, 25, "2026-09-02T10:00:00Z", { currency: "USD" }),
      claim("rejected", 50, null, "2026-09-03T10:00:00Z", { currency: "USD" }),
      claim("credited", 40, 40, "2026-09-05T10:00:00Z", { currency: "USD" }),
      claim("credited", 60, 30, "2026-09-06T10:00:00Z", { currency: "USD" }),
      claim("credited", 1200, 1200, "2026-09-02T10:00:00Z", {
        currency: "TRY",
      }),
    ];
    const m = measure(build(regs({ credits: ok(rows) })).card, "credits");
    expect(m.outcome).toBe("answered");
    expect(m.percent).toBeNull();
    // USD: 195 of 300 asked on its own five claims; TRY: one claim, no percent.
    expect(m.money?.map((x) => [x.currency, x.percent])).toEqual([
      ["TRY", null],
      ["USD", "65%"],
    ]);
    expect(m.sentence).toContain("65% recovered — $195.00 by credit memo");
    expect(m.sentence).toContain(
      "A currency with fewer than 5 claims of its own shows its money and no percent.",
    );
  });

  it("prints a claim whose currency is not recorded as a bare amount, and says why", () => {
    const rows = [1, 2, 3, 4, 5].map((d) =>
      claim("credited", 50, 40, `2026-09-0${d}T10:00:00Z`, { currency: null }),
    );
    const built = build(regs({ credits: ok(rows) }));
    const m = measure(built.card, "credits");
    expect(m.money).toEqual([
      {
        currency: null,
        allowed: 200,
        asked: 250,
        share: 0.8,
        percent: "80%",
      },
    ]);
    expect(m.sentence).toContain(
      "80% recovered — 200.00 by credit memo of 250.00 asked",
    );
    expect(m.sentence).toContain(
      "The currency is not recorded on the order behind a claim",
    );
    expect(m.sentence).not.toContain("$");
    expect(built.entries[0].detail).toBe("Credited 40.00 of 50.00 asked.");
  });

  it("with no claim in the window, says nothing was asked — not 'nothing recovered'", () => {
    const m = measure(build(regs({ credits: ok([]) })).card, "credits");
    expect(m.outcome).toBe("too_few");
    expect(m.money).toBeNull();
    expect(m.listed).toBeNull();
    expect(m.sentence).toBe(
      "No claim opened in the last 90 days — nothing asked, nothing to score.",
    );
  });
});

describe("one vendor's card reads only that vendor's rows", () => {
  it("ignores another vendor's deliveries, verdicts, lines, mail and claims", () => {
    const r = regs({
      arrivals: ok([
        arrival("2026-09-01T10:00:00Z", "2026-09-01", { provider_id: OTHER }),
      ]),
      door: ok([door("short", "2026-09-01T10:00:00Z", { provider_id: OTHER })]),
      verified: ok([
        verified("2026-09-01T10:00:00Z", false, 21, 20, { provider_id: OTHER }),
      ]),
      mail: ok([
        msg("outbound", "2026-09-01T08:00:00Z", "z", { provider_id: OTHER }),
      ]),
      credits: ok([
        claim("open", 50, null, "2026-09-01T10:00:00Z", { provider_id: OTHER }),
      ]),
    });
    const built = build(r);
    expect(built.entries).toHaveLength(0);
    expect(built.card.quiet).toBe(true);
    expect(built.card.fact).toEqual({
      text: "nothing in 90 d — nothing to score",
      outcome: "too_few",
    });
  });
});

describe("tone is not on the ledger card", () => {
  it("carries no tone: how a vendor's mail reads is its own owners-and-managers route (the founder, 2026-09-21)", () => {
    const rows = [msg("inbound", "2026-09-01T10:00:00Z", "a")];
    const card = build(regs({ mail: ok(rows) })).card as unknown as Record<
      string,
      unknown
    >;
    expect(card).not.toHaveProperty("tone");
    expect(JSON.stringify(card)).not.toMatch(/sentiment|tone of/i);
  });
});

describe("the Docket is the figures' rows", () => {
  it("holds for a whole vendor in every measure and both windows", () => {
    const r = regs({
      arrivals: ok([
        ...[1, 2, 3, 4, 5, 6].map((d) =>
          arrival(
            `2026-09-0${d}T10:00:00Z`,
            d === 6 ? "2026-09-03" : `2026-09-0${d}`,
          ),
        ),
        arrival("2026-09-07T10:00:00Z", null),
        ...[1, 2].map((d) =>
          arrival(`2026-05-0${d}T10:00:00Z`, `2026-05-0${d}`),
        ),
      ]),
      door: ok([
        door("accepted", "2026-09-01T10:00:00Z"),
        door("short", "2026-09-02T10:00:00Z"),
        door(null, "2026-05-02T10:00:00Z"),
      ]),
      verified: ok([
        verified("2026-09-01T10:00:00Z", true, 20, 20),
        verified("2026-09-02T10:00:00Z", null, null, 20),
      ]),
      mail: ok([
        msg("outbound", "2026-09-01T08:00:00Z", "a"),
        msg("inbound", "2026-09-01T10:00:00Z", "a"),
        msg("outbound", "2026-09-10T08:00:00Z", "b"),
      ]),
      credits: ok([
        claim("credited", 10, 10, "2026-09-01T10:00:00Z"),
        claim("rejected", 5, null, "2026-05-01T10:00:00Z"),
      ]),
    });
    assertTalliesAreTheirRows(r);
    assertTalliesAreTheirRows(r, 30);
    assertTalliesAreTheirRows(r, 365);
  });

  it("filters to one measure, current window, newest first", () => {
    const r = regs({
      arrivals: ok([
        arrival("2026-09-01T10:00:00Z", "2026-09-01"),
        arrival("2026-09-05T10:00:00Z", "2026-09-05"),
        arrival("2026-05-05T10:00:00Z", "2026-05-05"),
      ]),
      credits: ok([claim("open", 5, null, "2026-09-03T10:00:00Z")]),
    });
    const built = build(r);
    const onTime = docketFor(built, "onTime");
    expect(onTime.map((e) => e.at)).toEqual([
      "2026-09-05T10:00:00Z",
      "2026-09-01T10:00:00Z",
    ]);
    expect(docketFor(built, null)).toHaveLength(3);
  });

  it("says no alert is built, on every card", () => {
    const card = build(regs()).card;
    expect(card.alerting).toEqual({
      built: false,
      sentence:
        "No alert is sent from these figures. A labelled set and a shadow run come first, and neither is built yet.",
    });
  });
});

describe("the deadline is the house's own midnight (question 6)", () => {
  const istanbul = houseFrame({
    timezone: "Europe/Istanbul",
    country: "Türkiye",
  });
  const paloAlto = houseFrame({
    timezone: "America/Los_Angeles",
    country: "United States",
  });
  // The real tenant's shape: its zone was cleared with the LA default, and its
  // country keeps many zones.
  const noZone = houseFrame({ timezone: null, country: "United States" });

  const onTimeOf = (rows: OrderArrivalRow[], house: HouseFrame) =>
    measure(build(regs({ arrivals: ok(rows) }), 90, V, house).card, "onTime");

  it("reads Istanbul's midnight: 01:30 local the next morning is late, 23:59 local is on time", () => {
    const rows = [
      arrival("2026-09-10T22:30:00Z", "2026-09-10"), // 01:30 on the 11th, Istanbul
      arrival("2026-09-10T20:59:59Z", "2026-09-10"), // 23:59:59 on the 10th
      ...[1, 2, 3].map((d) =>
        arrival(`2026-09-0${d}T09:00:00Z`, `2026-09-0${d}`),
      ),
    ];
    const m = onTimeOf(rows, istanbul);
    expect(m).toMatchObject({ sample: 5, hits: 4 });
    const late = build(
      regs({ arrivals: ok(rows) }),
      90,
      V,
      istanbul,
    ).entries.find((e) => e.hit === false);
    // A late landing is dated at its DEADLINE (Istanbul's midnight, 21:00Z),
    // so it counts in the window its date fell in; the landing is in its words.
    expect(late?.at).toBe("2026-09-10T21:00:00.000Z");
    expect(late?.daysLate).toBe(1);
    // 22:30Z is 01:30 on the 11th in Istanbul: the landing's day is the house's.
    expect(late?.detail).toContain(
      `Landed on ${new Intl.DateTimeFormat(istanbul.locale as string, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date("2026-09-11T00:00:00Z"))},`,
    );
    // The same rows under the retired rule (23:59:59 UTC) read 5 of 5.
    expect(onTimeOf(rows, UTC_HOUSE).hits).toBe(5);
  });

  it("reads Palo Alto's midnight: 18:00 local on the day is on time, though it is past midnight UTC", () => {
    const rows = [
      arrival("2026-09-11T01:00:00Z", "2026-09-10"), // 18:00 PDT on the 10th
      arrival("2026-09-11T07:00:00Z", "2026-09-10"), // 00:00 PDT on the 11th: late
      ...[1, 2, 3].map((d) =>
        arrival(`2026-09-0${d}T18:00:00Z`, `2026-09-0${d}`),
      ),
    ];
    expect(onTimeOf(rows, paloAlto)).toMatchObject({ sample: 5, hits: 4 });
    expect(onTimeOf(rows, UTC_HOUSE)).toMatchObject({ sample: 5, hits: 3 });
  });

  it("with no zone, never assumes UTC: counts only what holds in every zone and lists the rest", () => {
    const rows = [
      arrival("2026-09-10T09:00:00Z", "2026-09-10"), // before midnight anywhere: on time
      arrival("2026-09-10T18:00:00Z", "2026-09-10"), // before or after, by zone: undecided
      arrival("2026-09-11T12:00:00Z", "2026-09-10"), // after midnight everywhere: late
      ...[1, 2, 3].map((d) =>
        arrival(`2026-09-0${d}T09:00:00Z`, `2026-09-0${d}`),
      ),
    ];
    const built = build(regs({ arrivals: ok(rows) }), 90, V, noZone);
    const m = measure(built.card, "onTime");
    expect(m).toMatchObject({ sample: 5, hits: 4, rows: 6 });
    expect(m.excluded).toEqual([
      {
        because:
          "landed within a day of midnight, and this house's time zone is not known",
        count: 1,
      },
    ]);
    expect(built.card.house).toMatchObject({ zone: null, zoneSource: "none" });
    expect(built.card.house.deadline).toContain(
      "This house records no time zone, and its country keeps",
    );
    expect(built.card.house.deadline).not.toMatch(/UTC/);
  });

  it("with no zone, an order not landed is late only once its date has passed in every zone", () => {
    const out = (expected: string) => ({
      id: `out-${expected}`,
      order_number: `PO-OUT-${expected}`,
      provider_id: V,
      status: "CONFIRMED",
      expected_delivery_date: expected,
      delivered_at: null,
    });
    // NOW is 2026-09-17T12:00Z: the 16th has ended in every zone by exactly
    // then (UTC-12 midnight), the 17th has not ended anywhere.
    const built = build(
      regs({ arrivals: ok([out("2026-09-16"), out("2026-09-17")]) }),
      90,
      V,
      noZone,
    );
    expect(docketFor(built, "onTime").map((e) => e.title)).toEqual([
      "PO-OUT-2026-09-16",
    ]);
  });

  it("uses the country's only zone when the house records none, and says so", () => {
    const frame = houseFrame({ timezone: null, country: "TR" });
    const card = build(regs(), 90, V, frame).card;
    expect(card.house).toMatchObject({
      zone: "Europe/Istanbul",
      zoneSource: "country",
    });
    expect(card.house.deadline).toContain("its country's only zone is used");
  });
});

describe("percent with count, in the house's formats (questions 3 and 7)", () => {
  it("prints the fact and the prior window with the house's own percent and date formats", () => {
    const tr = houseFrame({ timezone: "Europe/Istanbul", country: "Türkiye" });
    expect(tr.locale).toBe(
      `${new Intl.Locale("und", { region: "TR" }).maximize().language}-TR`,
    );
    const rows = [
      ...[1, 2, 3, 4, 5].map((d) =>
        arrival(`2026-09-0${d}T09:00:00Z`, `2026-09-0${d}`),
      ),
      arrival("2026-09-08T09:00:00Z", "2026-09-06"),
    ];
    const built = build(regs({ arrivals: ok(rows) }), 90, V, tr);
    const pct = new Intl.NumberFormat(tr.locale as string, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(0.83);
    expect(built.card.fact.text).toBe(`${pct} on time · 5 of 6`);
    const late = built.entries.find((e) => e.hit === false);
    const trDate = (d: string) =>
      new Intl.DateTimeFormat(tr.locale as string, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${d}T00:00:00Z`));
    expect(late?.detail).toBe(
      `Landed on ${trDate("2026-09-08")}, 2 days after the expected date (${trDate("2026-09-06")}) — late, in the window its date fell in.`,
    );
    expect(built.card.house.locale).toBe(tr.locale);
  });

  it("never prints 100% short of all, nor 0% above none", () => {
    const rows = (hits: number, n: number) =>
      Array.from({ length: n }, (_, i) =>
        arrival(
          `2026-09-${String(1 + (i % 9)).padStart(2, "0")}T0${i % 9}:00:00Z`,
          i < hits ? "2026-09-10" : "2026-08-01",
        ),
      );
    const at = (hits: number, n: number) =>
      measure(build(regs({ arrivals: ok(rows(hits, n)) })).card, "onTime")
        .percent;
    expect(at(199, 200)).toBe("99.5%");
    expect(at(1, 250)).toBe("0.4%");
    expect(at(12, 14)).toBe("86%");
    expect(at(5, 5)).toBe("100%");
    expect(at(0, 5)).toBe("0%");
  });
});
