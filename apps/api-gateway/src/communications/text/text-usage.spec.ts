/**
 * The meter, the allowance and the refusal (OD-23, answered 2026-09-05).
 *
 * THE ASSERTIONS THAT MATTER MOST ARE THE THREE ABOUT ABSENCE:
 *
 *   1. An UNSET allowance prints "no allowance stated" and DOES NOT REFUSE.
 *      Rendering it as 0 would silence every house on the deployment on the
 *      strength of a number nobody chose — the same fault
 *      `restaurants.subscription_tier DEFAULT 'pilot'` already caused.
 *   2. A FAILED READ is neither allowed nor refused. It is a third verdict,
 *      because treating it as allowed spends money we cannot account for and
 *      treating it as refused silences a house over our own outage.
 *   3. A house on its OWN provider keys is not gated at all, and the sentence
 *      says why rather than just letting it through.
 */

import {
  asDatabaseService,
  makeStubDb,
  type StubDb,
} from "../../team/testing/supabase-stub";
import {
  TextUsageService,
  PLATFORM_FEE_BASIS_UNSET,
} from "./text-usage.service";

const RID = "restaurant-1";
const SEAL = "seal-1";
const USER = "user-sam";

function seed(
  over: Partial<Record<string, any[]>> = {},
  errors: Record<string, { message: string }> = {},
): StubDb {
  return makeStubDb(
    {
      restaurants: [
        {
          id: RID,
          subscription_tier: "pilot",
          timezone: "Europe/Istanbul",
          currency: null,
        },
      ],
      plan_message_allowances: [],
      house_message_allowances: [],
      house_message_meter: [],
      house_message_credits: [],
      ...over,
    },
    errors,
  );
}

const svc = (db: StubDb) => new TextUsageService(asDatabaseService(db));

const metered = (n: number, counted: boolean, month = "2026-09") =>
  Array.from({ length: n }, (_, i) => ({
    id: `m-${counted ? "c" : "f"}-${i}`,
    restaurant_id: RID,
    month_key: month,
    counts_against_allowance: counted,
    channel: "sms",
    provider: "twilio",
    provider_cost_state: "not_reported_yet",
  }));

const NOW = new Date("2026-09-20T21:30:00Z");

describe("monthKeyFor — the month is the HOUSE's, not the server's", () => {
  it("uses the house timezone and reports which one it used", () => {
    const out = svc(seed()).monthKeyFor("Europe/Istanbul", NOW);
    expect(out).toEqual({
      monthKey: "2026-09",
      monthTimezone: "Europe/Istanbul",
    });
  });

  it("rolls a late-evening UTC message into the next month for a house that is ahead", () => {
    // 2026-09-30T22:30Z is already 2026-10-01 in Istanbul. A UTC month key
    // would bill it to September, which is the boundary Meta's own rate cards
    // are applied across ("based on WhatsApp Business account timezone").
    const late = new Date("2026-09-30T22:30:00Z");
    expect(svc(seed()).monthKeyFor("Europe/Istanbul", late).monthKey).toBe(
      "2026-10",
    );
    expect(svc(seed()).monthKeyFor("UTC", late).monthKey).toBe("2026-09");
  });

  it("falls back to UTC and SAYS SO rather than throwing on a bad timezone", () => {
    const out = svc(seed()).monthKeyFor("Not/AZone", NOW);
    expect(out.monthTimezone).toBe("UTC");
    expect(out.monthKey).toBe("2026-09");
  });
});

describe("readout — absence is reported as absence", () => {
  it("prints 'no allowance stated' for a plan with no row, and never zero", async () => {
    const out = await svc(seed()).readout(RID, NOW);
    expect(out.allowance).toBeNull();
    expect(out.allowanceWords).toContain("No allowance stated");
    expect(out.allowanceWords).toContain("not an allowance of zero");
    expect(out.readable).toBe(true);
  });

  it("counts the two kinds of message apart", async () => {
    const db = seed({
      house_message_meter: [...metered(3, true), ...metered(5, false)],
    });
    const out = await svc(db).readout(RID, NOW);
    expect(out.usedThisMonth).toBe(3);
    expect(out.freeThisMonth).toBe(5);
  });

  it("does not count another month against this one", async () => {
    const db = seed({
      house_message_meter: [
        ...metered(2, true),
        ...metered(9, true, "2026-08"),
      ],
    });
    expect((await svc(db).readout(RID, NOW)).usedThisMonth).toBe(2);
  });

  it("returns null, not zero, when the meter read FAILS, and names it", async () => {
    const db = seed({}, { "house_message_meter:select": { message: "boom" } });
    const out = await svc(db).readout(RID, NOW);
    expect(out.usedThisMonth).toBeNull();
    expect(out.readable).toBe(false);
    expect(out.reason).toContain("counted messages");
    expect(out.reason).toContain("unknown rather than as zero");
  });

  it("carries an allowance with its source when one is set", async () => {
    const db = seed({
      plan_message_allowances: [
        {
          plan_code: "pilot",
          monthly_allowance: 200,
          stated_source: "measured usage, 2026-Q4, p4-scratch/meter-census.md",
        },
      ],
    });
    const out = await svc(db).readout(RID, NOW);
    expect(out.allowance).toBe(200);
    expect(out.allowanceWords).toContain("200 messages a month");
    expect(out.allowanceWords).toContain("measured usage");
  });

  it("sums a credit balance in minor units and names the currency", async () => {
    const db = seed({
      house_message_credits: [
        {
          id: "c1",
          restaurant_id: RID,
          entry_kind: "purchase",
          amount_minor: 5000,
          currency: "USD",
          recorded_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "c2",
          restaurant_id: RID,
          entry_kind: "debit",
          amount_minor: -90,
          currency: "USD",
          recorded_at: "2026-09-02T00:00:00Z",
        },
      ],
    });
    const out = await svc(db).readout(RID, NOW);
    expect(out.creditBalanceMinor).toBe(4910);
    expect(out.creditCurrency).toBe("USD");
    expect(out.creditCurrencyMixed).toBe(false);
  });

  it("refuses to add two currencies together, and flags that it did not", async () => {
    const db = seed({
      house_message_credits: [
        {
          id: "c1",
          restaurant_id: RID,
          entry_kind: "purchase",
          amount_minor: 5000,
          currency: "USD",
          recorded_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "c2",
          restaurant_id: RID,
          entry_kind: "purchase",
          amount_minor: 100000,
          currency: "TRY",
          recorded_at: "2026-09-02T00:00:00Z",
        },
      ],
    });
    const out = await svc(db).readout(RID, NOW);
    expect(out.creditCurrencyMixed).toBe(true);
    // The newest currency only: 5000 + 100000 is not money in any currency.
    expect(out.creditBalanceMinor).toBe(100000);
    expect(out.creditCurrency).toBe("TRY");
  });
});

describe("gate — what may leave, and the sentence when nothing may", () => {
  it("allows a house with no stated allowance, and says nothing is being counted", async () => {
    const g = await svc(seed()).gate({
      restaurantId: RID,
      ownKeys: false,
      now: NOW,
    });
    expect(g.verdict).toBe("allowed");
    expect(g.words).toContain("no message allowance stated");
  });

  it("allows a house on its own provider keys without consulting the allowance", async () => {
    const db = seed({
      plan_message_allowances: [
        {
          plan_code: "pilot",
          monthly_allowance: 1,
          stated_source: "measured usage after one quarter",
        },
      ],
      house_message_meter: metered(50, true),
    });
    const g = await svc(db).gate({
      restaurantId: RID,
      ownKeys: true,
      now: NOW,
    });
    expect(g.verdict).toBe("allowed");
    expect(g.words).toContain("billed to it by that provider");
  });

  it("counts down inside a stated allowance", async () => {
    const db = seed({
      plan_message_allowances: [
        {
          plan_code: "pilot",
          monthly_allowance: 10,
          stated_source: "measured usage after one quarter",
        },
      ],
      house_message_meter: metered(4, true),
    });
    const g = await svc(db).gate({
      restaurantId: RID,
      ownKeys: false,
      now: NOW,
    });
    expect(g.verdict).toBe("allowed");
    expect(g.words).toContain("6 of this month's 10");
  });

  it("spends credits once the allowance is used", async () => {
    const db = seed({
      plan_message_allowances: [
        {
          plan_code: "pilot",
          monthly_allowance: 2,
          stated_source: "measured usage after one quarter",
        },
      ],
      house_message_meter: metered(2, true),
      house_message_credits: [
        {
          id: "c1",
          restaurant_id: RID,
          entry_kind: "purchase",
          amount_minor: 5000,
          currency: "USD",
          recorded_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    const g = await svc(db).gate({
      restaurantId: RID,
      ownKeys: false,
      now: NOW,
    });
    expect(g.verdict).toBe("allowed");
    expect(g.words).toContain("paid for out of credits");
  });

  it("REFUSES past the allowance with no credits, and names both ways to continue", async () => {
    const db = seed({
      plan_message_allowances: [
        {
          plan_code: "pilot",
          monthly_allowance: 2,
          stated_source: "measured usage after one quarter",
        },
      ],
      house_message_meter: metered(2, true),
    });
    const g = await svc(db).gate({
      restaurantId: RID,
      ownKeys: false,
      now: NOW,
    });
    expect(g.verdict).toBe("refused");
    expect(g.words).toContain("nothing was sent");
    expect(g.words).toContain(
      "Nothing has been queued and nothing will arrive later",
    );
    expect(g.words).toContain("buy credits");
    expect(g.words).toContain("own Twilio or Meta account");
    expect(g.words).toContain("stated platform fee");
  });

  it("answers UNKNOWN, not refused, when the meter could not be read", async () => {
    const db = seed({}, { "house_message_meter:select": { message: "boom" } });
    const g = await svc(db).gate({
      restaurantId: RID,
      ownKeys: false,
      now: NOW,
    });
    expect(g.verdict).toBe("unknown");
    expect(g.words).toContain("could not be determined");
    expect(g.words).toContain("not the same as the allowance being spent");
  });
});

describe("recordPurchase — money in, with its provenance", () => {
  it("writes a sealed purchase with the fee rule as it stands today", async () => {
    const db = seed();
    const out = await svc(db).recordPurchase({
      restaurantId: RID,
      sealId: SEAL,
      amountMinor: 5000,
      currency: "USD",
      recordedBy: USER,
      paymentRef: "pi_1",
    });
    expect(out.recorded).toBe(true);
    const written = db.tables.house_message_credits[0];
    expect(written.entry_kind).toBe("purchase");
    expect(written.seal_id).toBe(SEAL);
    expect(written.meter_id).toBeNull();
    expect(written.currency).toBe("USD");
    // The fee is a SENTENCE saying no rate has been set, not a number nobody chose.
    expect(written.fee_basis).toBe(PLATFORM_FEE_BASIS_UNSET);
    expect(written.fee_basis).toContain("No platform fee has been set");
  });

  it("refuses an amount with no currency, and writes nothing", async () => {
    const db = seed();
    const out = await svc(db).recordPurchase({
      restaurantId: RID,
      sealId: SEAL,
      amountMinor: 5000,
      currency: "$$",
      recordedBy: USER,
      paymentRef: "pi_1",
    });
    expect(out.recorded).toBe(false);
    expect(out.words).toContain("is not money");
    expect(db.tables.house_message_credits).toHaveLength(0);
  });

  it("refuses a zero or negative purchase, and writes nothing", async () => {
    const db = seed();
    for (const amountMinor of [0, -1, 1.5]) {
      const out = await svc(db).recordPurchase({
        restaurantId: RID,
        sealId: SEAL,
        amountMinor,
        currency: "USD",
        recordedBy: USER,
        paymentRef: "pi_1",
      });
      expect(out.recorded).toBe(false);
    }
    expect(db.tables.house_message_credits).toHaveLength(0);
  });

  it("says the balance is UNCHANGED when the write fails, rather than reporting success", async () => {
    const db = seed(
      {},
      { "house_message_credits:insert": { message: "boom" } },
    );
    const out = await svc(db).recordPurchase({
      restaurantId: RID,
      sealId: SEAL,
      amountMinor: 5000,
      currency: "USD",
      recordedBy: USER,
      paymentRef: "pi_1",
    });
    expect(out.recorded).toBe(false);
    expect(out.words).toContain("was NOT recorded");
    expect(out.words).toContain("balance is unchanged");
  });
});

describe("entries — an unreadable ledger is not an empty one", () => {
  it("returns null rows and the reason when the read fails", async () => {
    const db = seed(
      {},
      { "house_message_credits:select": { message: "boom" } },
    );
    const out = await svc(db).entries(RID);
    expect(out.rows).toBeNull();
    expect(out.reason).toBe("boom");
  });

  it("returns an empty array when there genuinely are none", async () => {
    const out = await svc(seed()).entries(RID);
    expect(out.rows).toEqual([]);
    expect(out.reason).toBeNull();
  });
});

describe("one house first — the founder's answer to question 8", () => {
  /**
   * `plan_message_allowances` is keyed on `plan_code`, and
   * `restaurants.subscription_tier` carries `DEFAULT 'pilot'` on every house
   * that never chose it. So a number written to the plan row lands on the whole
   * fleet at once, which is exactly what "one house first, deliberately, then
   * watch" refused. These cases are what make the per-house row load-bearing
   * rather than decorative.
   */
  const houseRow = (allowance: number | null) => ({
    restaurant_id: RID,
    monthly_allowance: allowance,
    stated_source:
      "founder, 2026-09-06: first house to carry a stated allowance",
    set_via: "founder_script",
    set_by: null,
    set_at: "2026-09-06T00:00:00Z",
  });

  const planRow = (allowance: number | null) => ({
    plan_code: "pilot",
    monthly_allowance: allowance,
    stated_source: "measured usage after one quarter, fleet-wide",
    stated_at: "2026-09-06T00:00:00Z",
  });

  it("uses the HOUSE's number over the plan's, and says which it used", async () => {
    const db = seed({
      house_message_allowances: [houseRow(50)],
      plan_message_allowances: [planRow(9999)],
    });
    const out = await svc(db).readout(RID, NOW);
    expect(out.allowance).toBe(50);
    expect(out.allowanceScope).toBe("house");
    expect(out.allowanceWords).toContain("for THIS house specifically");
    expect(out.allowanceWords).toContain("not for its plan");
  });

  it("falls back to the plan's number and says THAT is where it came from", async () => {
    const db = seed({ plan_message_allowances: [planRow(300)] });
    const out = await svc(db).readout(RID, NOW);
    expect(out.allowance).toBe(300);
    expect(out.allowanceScope).toBe("plan");
    expect(out.allowanceWords).toContain("included on this plan");
  });

  it("reports scope 'none' when neither row exists", async () => {
    const out = await svc(seed()).readout(RID, NOW);
    expect(out.allowanceScope).toBe("none");
    expect(out.allowance).toBeNull();
  });

  it("a house row with a NULL number is NOT the same as no row, and says so", async () => {
    const db = seed({ house_message_allowances: [houseRow(null)] });
    const out = await svc(db).readout(RID, NOW);
    expect(out.allowance).toBeNull();
    expect(out.allowanceScope).toBe("house");
    expect(out.allowanceWords).toContain("No allowance stated for this house");
    expect(out.allowanceWords).toContain("not an allowance of zero");
  });

  it("does NOT fall through to the plan when the house row could not be READ", async () => {
    // The shape this guards: answering with the fleet's number when the house's
    // own read failed is a wrong answer that looks exactly like a right one.
    const db = seed(
      { plan_message_allowances: [planRow(9999)] },
      { "house_message_allowances:select": { message: "connection reset" } },
    );
    const out = await svc(db).readout(RID, NOW);
    expect(out.allowance).toBeNull();
    expect(out.allowanceScope).toBe("none");
    expect(out.readable).toBe(false);
    expect(out.reason).toContain("this house's allowance");
    expect(out.allowanceWords).toContain("could not be read");
  });

  it("THE REFUSAL, proven against the one house's own allowance", async () => {
    // The whole point of question 8: the founder sets a number on one house and
    // watches. This is what that house sees when it passes the number he set.
    const db = seed({
      house_message_allowances: [houseRow(2)],
      house_message_meter: metered(2, true),
    });
    const g = await svc(db).gate({
      restaurantId: RID,
      ownKeys: false,
      now: NOW,
    });
    expect(g.verdict).toBe("refused");
    expect(g.readout.allowanceScope).toBe("house");
    expect(g.words).toContain("This month's 2 included messages are used");
    expect(g.words).toContain("nothing was sent");
    expect(g.words).toContain(
      "Nothing has been queued and nothing will arrive later",
    );
    expect(g.words).toContain("buy credits");
    expect(g.words).toContain("own Twilio or Meta account");
  });

  it("counts down inside the one house's own allowance", async () => {
    const db = seed({
      house_message_allowances: [houseRow(10)],
      house_message_meter: metered(4, true),
    });
    const g = await svc(db).gate({
      restaurantId: RID,
      ownKeys: false,
      now: NOW,
    });
    expect(g.verdict).toBe("allowed");
    expect(g.words).toContain("6 of this month's 10");
  });

  it("still does not gate a house on its own provider keys", async () => {
    const db = seed({
      house_message_allowances: [houseRow(1)],
      house_message_meter: metered(50, true),
    });
    const g = await svc(db).gate({
      restaurantId: RID,
      ownKeys: true,
      now: NOW,
    });
    expect(g.verdict).toBe("allowed");
    expect(g.words).toContain("billed to it by that provider");
  });
});

describe("recordPurchase — a credit never exists without a payment", () => {
  it("refuses an empty payment reference, and writes nothing", async () => {
    const db = seed();
    const out = await svc(db).recordPurchase({
      restaurantId: RID,
      sealId: SEAL,
      amountMinor: 5000,
      currency: "USD",
      recordedBy: USER,
      paymentRef: "   ",
    });
    expect(out.recorded).toBe(false);
    expect(out.words).toContain("names the payment it was charged on");
    expect(db.tables.house_message_credits).toHaveLength(0);
  });

  it("writes the PaymentIntent id onto the row", async () => {
    const db = seed();
    await svc(db).recordPurchase({
      restaurantId: RID,
      sealId: SEAL,
      amountMinor: 5000,
      currency: "USD",
      recordedBy: USER,
      paymentRef: "pi_3Nabc",
    });
    expect(db.tables.house_message_credits[0].payment_ref).toBe("pi_3Nabc");
  });
});

describe("purchaseForSeal — the recovery read", () => {
  it("finds a purchase already written for this seal", async () => {
    const db = seed({
      house_message_credits: [
        {
          id: "c1",
          restaurant_id: RID,
          entry_kind: "purchase",
          seal_id: SEAL,
          amount_minor: 5000,
          currency: "USD",
          recorded_at: "2026-09-06T00:00:00Z",
        },
      ],
    });
    const out = await svc(db).purchaseForSeal(RID, SEAL);
    expect(out.found).toBe(true);
    expect(out.entryId).toBe("c1");
    expect(out.readable).toBe(true);
  });

  it("says the read FAILED rather than answering 'no'", async () => {
    const db = seed(
      {},
      { "house_message_credits:select": { message: "boom" } },
    );
    const out = await svc(db).purchaseForSeal(RID, SEAL);
    expect(out.readable).toBe(false);
    expect(out.found).toBe(false);
  });
});
