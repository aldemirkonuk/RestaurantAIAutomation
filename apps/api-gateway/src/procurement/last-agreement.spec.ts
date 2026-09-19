/**
 * `GET /procurement/last-agreement` — the route packet 2 had to build.
 *
 * The census draws the new-order sheet with "price and unit come from the
 * agreement on the vendor's row". No route could answer that, so this one is
 * new, and the thing it must never do is the thing every convenience wrapper
 * does: turn a failed read into an empty result.
 *
 * These assert, in order:
 *   1. the three states are three states, and each carries a sentence;
 *   2. a price with no stated unit is reported as UNSTATED, never per bottle;
 *   3. the service scopes by restaurant, provider and item — all three;
 *   4. a thrown read answers `unreadable`, not `none`;
 *   5. the controller refuses a request that names no vendor.
 */

import { lastAgreementAnswer } from "./last-agreement";

describe("lastAgreementAnswer — three states, three sentences", () => {
  it("names a real agreement, its unit pair and the order it came off", () => {
    const a = lastAgreementAnswer(
      {
        price: 2400,
        priceUom: "case",
        pricePackSize: 12,
        currency: "TRY",
        unitType: "case",
        bottlesPerUnit: 12,
        agreedOn: "2026-09-01T10:00:00.000Z",
        orderNumber: "PO-118",
      },
      false,
      "Kavaklıdere",
    );
    expect(a.state).toBe("found");
    expect(a.price).toBe(2400);
    expect(a.priceUom).toBe("case");
    expect(a.pricePackSize).toBe(12);
    expect(a.sentence).toContain("Kavaklıdere");
    expect(a.sentence).toContain("2026-09-01");
    expect(a.sentence).toContain("TRY 2400 per case of 12");
    expect(a.sentence).toContain("PO-118");
    // Offered, never applied — the sheet must not read as already changed.
    expect(a.sentence).toContain("Offered, not applied");
  });

  it("reports an unstated price unit as unstated, never as per bottle", () => {
    const a = lastAgreementAnswer(
      {
        price: 35,
        priceUom: null,
        pricePackSize: null,
        currency: null,
        unitType: "bottle",
        bottlesPerUnit: 1,
        agreedOn: "2026-08-02T00:00:00.000Z",
        orderNumber: null,
      },
      false,
      null,
    );
    expect(a.state).toBe("found");
    expect(a.sentence).toContain("the unit NOT stated");
    expect(a.sentence).not.toContain("per bottle");
    // No vendor name is a noun, not a failure.
    expect(a.sentence).toContain("this vendor");
  });

  it("tells 'nothing was agreed' from 'we could not look'", () => {
    const none = lastAgreementAnswer(null, false, "Banfi");
    const broken = lastAgreementAnswer(null, true, "Banfi");

    expect(none.state).toBe("none");
    expect(none.sentence).toContain("No agreed price with Banfi");
    expect(none.sentence).toContain("nothing is assumed");

    expect(broken.state).toBe("unreadable");
    expect(broken.sentence).toContain("could not be read");
    expect(broken.sentence).toContain("NOT an empty book");
    // The two sentences must not be interchangeable — that is the whole route.
    expect(broken.sentence).not.toEqual(none.sentence);
  });

  it("gives every state a sentence, so no state can render as a blank field", () => {
    for (const a of [
      lastAgreementAnswer(null, false, null),
      lastAgreementAnswer(null, true, null),
      lastAgreementAnswer(
        {
          price: null,
          priceUom: null,
          pricePackSize: null,
          currency: null,
          unitType: null,
          bottlesPerUnit: null,
          agreedOn: null,
          orderNumber: null,
        },
        false,
        null,
      ),
    ]) {
      expect(a.sentence.length).toBeGreaterThan(20);
    }
  });

  it("says so when the order recorded no price at all", () => {
    const a = lastAgreementAnswer(
      {
        price: null,
        priceUom: null,
        pricePackSize: null,
        currency: null,
        unitType: "bottle",
        bottlesPerUnit: 1,
        agreedOn: null,
        orderNumber: "PO-9",
      },
      false,
      null,
    );
    expect(a.sentence).toContain("recorded no price");
    expect(a.sentence).toContain("on a date the row does not carry");
  });
});

/* ── the service read ─────────────────────────────────────────────────────
   A hand-built stub rather than a mocking framework: the assertion is which
   FILTERS were applied, and a stub that records them says that directly. */

type Filter = [string, string, unknown];

function stubDb(opts: {
  rows?: unknown[];
  error?: string;
  vendorName?: string | null;
}) {
  const filters: Filter[] = [];
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push(["eq", col, val]);
      return builder;
    },
    order: () => builder,
    limit: () =>
      opts.error
        ? Promise.resolve({ data: null, error: { message: opts.error } })
        : Promise.resolve({ data: opts.rows ?? [], error: null }),
    maybeSingle: () =>
      Promise.resolve({
        data: opts.vendorName === undefined ? null : { name: opts.vendorName },
        error: null,
      }),
  };
  return {
    filters,
    supabase: {
      from: (table: string) => {
        filters.push(["from", table, null]);
        return builder;
      },
    },
  };
}

/** The method under test, bound to the stub. Nest is not booted for a read. */
async function callLastAgreement(db: ReturnType<typeof stubDb>) {
  const { ProcurementService } = await import("./procurement.service");
  const self: any = {
    databaseService: { supabase: db.supabase },
    logger: { warn: () => undefined, error: () => undefined, log: () => undefined },
  };
  return ProcurementService.prototype.lastAgreementFor.call(
    self,
    "rest-A",
    "prov-1",
    "inv-9",
  );
}

describe("ProcurementService.lastAgreementFor", () => {
  it("scopes by restaurant, vendor and item — all three", async () => {
    const db = stubDb({ rows: [], vendorName: "Kavaklıdere" });
    await callLastAgreement(db);
    const eqs = db.filters.filter((f) => f[0] === "eq").map((f) => `${f[1]}=${f[2]}`);
    expect(eqs).toContain("restaurant_id=rest-A");
    expect(eqs).toContain("inventory_id=inv-9");
    expect(eqs).toContain("procurement_orders.provider_id=prov-1");
    expect(eqs).toContain("procurement_orders.restaurant_id=rest-A");
  });

  it("answers 'unreadable' when the read fails — never 'none'", async () => {
    const db = stubDb({ error: "relation does not exist", vendorName: "Banfi" });
    const a = await callLastAgreement(db);
    expect(a.state).toBe("unreadable");
    expect(a.price).toBeUndefined();
  });

  it("reads the embedded order whether it arrives as an object or an array", async () => {
    const line = {
      final_unit_price: 210,
      price_uom: "case",
      price_pack_size: 6,
      currency: "USD",
      unit_type: "case",
      bottles_per_unit: 6,
    };
    const parent = {
      order_number: "PO-77",
      requested_at: "2026-07-04T00:00:00.000Z",
    };

    const asObject = await callLastAgreement(
      stubDb({ rows: [{ ...line, procurement_orders: parent }], vendorName: "Banfi" }),
    );
    const asArray = await callLastAgreement(
      stubDb({ rows: [{ ...line, procurement_orders: [parent] }], vendorName: "Banfi" }),
    );

    for (const a of [asObject, asArray]) {
      expect(a.state).toBe("found");
      expect(a.orderNumber).toBe("PO-77");
      expect(a.agreedOn).toBe("2026-07-04T00:00:00.000Z");
      expect(a.pricePackSize).toBe(6);
    }
  });
});
