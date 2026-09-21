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

function build(r: HouseRegisters, days: 30 | 90 | 365 = 90, providerId = V) {
  return buildVendorScorecard({
    providerId,
    providerName: "Skurnik",
    days,
    now: NOW,
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
    detected_sentiment: null,
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

describe("on time — the built rule, with its denominator", () => {
  it("counts landed-by-23:59-UTC on the expected date, and lists an undated delivery without counting it", () => {
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
    expect(m.sentence).toContain("4 of 6 landed by the expected date.");
    expect(m.sentence).toContain("by 1, 3 days");
    expect(m.sentence).toContain(
      "1 is listed and not counted: no expected date.",
    );
    expect(built.card.fact).toEqual({
      text: "4 of 6 on time",
      outcome: "answered",
    });
    const late = built.entries
      .filter((e) => e.measure === "onTime" && e.hit === false)
      .map((e) => e.daysLate);
    expect(late.sort()).toEqual([1, 3]);
  });

  it("lists an order past its date and not landed as open beside the figure, never in it, and never before its date", () => {
    const out = (expected: string, status: string) => ({
      id: `out-${expected}-${status}`,
      order_number: `PO-OUT-${status}-${expected}`,
      provider_id: V,
      status,
      expected_delivery_date: expected,
      delivered_at: null,
    });
    const rows = [
      ...[1, 2, 3, 4, 5].map((d) =>
        arrival(`2026-09-0${d}T10:00:00Z`, `2026-09-0${d}`),
      ),
      out("2026-09-06", "IN_TRANSIT"), // 11 days past it: open
      out("2026-09-16", "CONFIRMED"), // deadline 23:59:59 on the 16th: 1 day past
      out("2026-09-17", "CONFIRMED"), // due today: not late yet
      out("2026-09-01", "PENDING"), // never placed with the vendor: not theirs
      out("2026-09-02", "CANCELLED"), // closed: not outstanding
      out("2026-06-01", "IN_TRANSIT"), // prior window: open there, not here
    ];
    const built = build(regs({ arrivals: ok(rows) }));
    const m = measure(built.card, "onTime");
    expect(m).toMatchObject({
      outcome: "answered",
      sample: 5,
      hits: 5,
      open: 2,
      rows: 7,
    });
    expect(m.excluded).toEqual([]);
    expect(m.sentence).toBe(
      "5 of 5 landed by the expected date. 2 orders are past the expected date and not landed — not counted, not forgotten.",
    );
    expect(built.card.fact).toEqual({
      text: "5 of 5 on time · 2 overdue",
      outcome: "answered",
    });
    const open = docketFor(built, "onTime").filter((e) => e.open);
    expect(open.map((e) => [e.title, e.daysLate, e.counted])).toEqual([
      ["PO-OUT-CONFIRMED-2026-09-16", 1, false],
      ["PO-OUT-IN_TRANSIT-2026-09-06", 11, false],
    ]);
    expect(open[1].detail).toBe(
      "Expected by 6 Sep 2026; 11 days past it and not landed.",
    );
    expect(
      built.entries.filter((e) => e.window === "prior" && e.open),
    ).toHaveLength(1);
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
    expect(m.sentence).toBe(
      "4 deliveries with an expected date in 90 days — too few to score; 5 are needed.",
    );
    expect(built.card.fact).toEqual({
      text: "4 deliveries — too few to score",
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
    expect(m.priorSentence).toBe("prior 90 d · 3 of 5");
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
    expect(measure(card, "onTime").priorSentence).toBe("prior 90 d · 5 of 5");
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
      "4 of 6 invoiced lines were at the agreed price. 1 above it. 1 below it.",
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
  it("rebuilds the sketch's Skurnik record: $286.00 of $412.50, the promised claim in the denominator only", () => {
    const rows = [
      claim("credited", 182.5, 182.5, "2026-07-03T10:00:00Z"),
      claim("credited", 118, 103.5, "2026-07-27T10:00:00Z"),
      claim("promised", 112, null, "2026-08-09T10:00:00Z", {
        promised_at: "2026-08-09T10:00:00Z",
      }),
    ];
    const built = build(regs({ credits: ok(rows) }));
    const m = measure(built.card, "credits");
    expect(m.outcome).toBe("answered");
    expect(m.money).toEqual([{ currency: "USD", allowed: 286, asked: 412.5 }]);
    expect(m.hits).toBe(2);
    expect(m.open).toBe(1);
    expect(m.sentence).toContain(
      "$286.00 recovered by credit memo of $412.50 asked, on 3 claims; 2 credited.",
    );
    const promised = built.entries.find((e) => e.detail.startsWith("Promised"));
    expect(promised?.detail).toBe(
      "Promised, 39 days ago, not recovered — promised is not recovered.",
    );
    expect(promised?.amountAllowed).toBeNull();
  });

  it("never adds two currencies together: two totals and no share", () => {
    const rows = [
      claim("credited", 100, 100, "2026-09-01T10:00:00Z", { currency: "USD" }),
      claim("credited", 1200, 1200, "2026-09-02T10:00:00Z", {
        currency: "TRY",
      }),
    ];
    const m = measure(build(regs({ credits: ok(rows) })).card, "credits");
    expect(m.outcome).toBe("answered");
    expect(m.value).toBeNull();
    expect(m.money?.map((x) => x.currency)).toEqual(["TRY", "USD"]);
    expect(m.sentence).toContain(
      "Money in two currencies is not added together",
    );
  });

  it("prints a claim whose currency is not recorded as a bare amount, and says why", () => {
    const rows = [
      claim("credited", 50, 40, "2026-09-01T10:00:00Z", { currency: null }),
    ];
    const built = build(regs({ credits: ok(rows) }));
    const m = measure(built.card, "credits");
    expect(m.money).toEqual([{ currency: null, allowed: 40, asked: 50 }]);
    expect(m.sentence).toContain(
      "40.00 recovered by credit memo of 50.00 asked",
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

describe("tone is a minor reading, in no figure", () => {
  it("counts a model's labels and says no person has labelled one", () => {
    const rows = [
      msg("inbound", "2026-09-01T10:00:00Z", "a", {
        detected_sentiment: "negative",
      }),
      msg("inbound", "2026-09-02T10:00:00Z", "b", {
        detected_sentiment: "professional",
      }), // off-enum writer
      msg("inbound", "2026-09-03T10:00:00Z", "c"),
    ];
    const card = build(regs({ mail: ok(rows) })).card;
    expect(card.tone).toMatchObject({
      outcome: "answered",
      read: 1,
      messages: 3,
      labelledByPerson: 0,
    });
    expect(card.tone.sentence).toBe(
      "A model read the tone of 1 of 3 vendor messages; no person has labelled one. Tone is in no figure above.",
    );
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
