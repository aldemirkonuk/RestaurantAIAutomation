/**
 * The exposure assertion: sealed, named, never inferred.
 *
 * The founder's Q5 answer, 2026-09-05: *"an owner or manager asserts 'this item
 * is exposed to this series with this pass-through' as a sealed named act
 * (ADR 0107 pattern), a failed write says why"*. Every test here is one of
 * those two clauses.
 */

import { ForbiddenException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import {
  CommodityExposureService,
  EXPOSURE_ACTION,
  type ExposureAssertion,
} from "./commodity-exposure.service";
import { SEAL_SUBJECT_KINDS } from "../common/seal/seal-subject";

const ACTOR = { userId: "u1", restaurantId: "r1" };
const ITEM = "i1";
const KEY = "fao.food_price_index.all";

function assertion(over: Partial<ExposureAssertion> = {}): ExposureAssertion {
  return {
    seriesKey: KEY,
    houseItemId: ITEM,
    passThrough: null,
    passThroughBasis: "unset",
    lagDays: null,
    lagBasis: "unset",
    note: null,
    ...over,
  };
}

interface Write {
  table: string;
  payload: Record<string, unknown>;
}

function makeDb(
  handler: (t: string) => { data?: unknown[]; error?: unknown },
  writes: Write[] = [],
): DatabaseService {
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        insert(payload: Record<string, unknown>) {
          writes.push({ table, payload });
          return builder;
        },
        update(payload: Record<string, unknown>) {
          writes.push({ table, payload });
          return builder;
        },
        maybeSingle() {
          const r = handler(table);
          return Promise.resolve({
            data: (r.data && r.data[0]) ?? null,
            error: r.error ?? null,
          });
        },
        single() {
          const r = handler(table);
          return Promise.resolve({
            data: (r.data && r.data[0]) ?? null,
            error: r.error ?? null,
          });
        },
        then(resolve: (v: unknown) => unknown) {
          const r = handler(table);
          return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(
            resolve,
          );
        },
      };
      return builder;
    },
  };
  return { client } as unknown as DatabaseService;
}

/** A house that owns the item and a register that holds the series. */
function happyDb(writes: Write[] = [], insertError?: unknown) {
  return makeDb((t) => {
    if (t === "restaurant_inventory") {
      return { data: [{ id: ITEM, restaurant_id: "r1" }] };
    }
    if (t === "commodity_index_series") return { data: [{ id: "s1", series_key: KEY }] };
    if (t === "house_item_commodity_exposure") {
      return insertError ? { error: insertError } : { data: [{ id: "e1" }] };
    }
    return { data: [] };
  }, writes);
}

function seals(record: { issued: unknown[]; redeemed: unknown[] } = { issued: [], redeemed: [] }) {
  return {
    issue: async (p: unknown) => {
      record.issued.push(p);
      return { challenge: "tok", expiresAt: "2026-09-05T12:02:00Z", action: EXPOSURE_ACTION };
    },
    redeem: async (p: unknown) => {
      record.redeemed.push(p);
      const c = (p as { challenge?: string }).challenge;
      if (!c) throw new ForbiddenException("This exposure is sealed");
      return { sealId: "seal-1" };
    },
  } as unknown as SealChallengeService;
}

describe("the seal vocabulary knows this act", () => {
  it("declares `commodity_exposure`, which the migration widens the CHECK for", () => {
    // The code and the CHECK move together, by hand, for the reason
    // 20260904210000 gives: a CHECK behind the code is a production failure.
    expect(SEAL_SUBJECT_KINDS).toContain("commodity_exposure");
  });
});

describe("the hold is begun before the write, never in the same request", () => {
  it("issues a seal bound to the ITEM, with the series and the figures in the args", () => {
    // The pass-through is in the args on purpose: an exposure approved at "we
    // do not know" must not be spendable at ninety percent.
    const record = { issued: [] as unknown[], redeemed: [] as unknown[] };
    const svc = new CommodityExposureService(happyDb(), seals(record));
    return svc
      .challenge(ACTOR, assertion({ passThrough: 0.2, passThroughBasis: "house_measured" }))
      .then((out) => {
        expect(out.issued).toBe(true);
        const args = record.issued[0] as Record<string, Record<string, unknown>>;
        expect(args.subjectKind).toBe("commodity_exposure");
        expect(args.subjectId).toBe(ITEM);
        expect(args.action).toBe(EXPOSURE_ACTION);
        expect(args.args.seriesKey).toBe(KEY);
        expect(args.args.passThrough).toBe(0.2);
      });
  });

  it("refuses to mint a seal for an assertion that would be refused anyway", async () => {
    // A seal issued for an act that cannot succeed is a seal a manager holds
    // and is then told meant nothing, which teaches people it is decoration.
    const record = { issued: [] as unknown[], redeemed: [] as unknown[] };
    const svc = new CommodityExposureService(happyDb(), seals(record));
    const out = await svc.challenge(ACTOR, assertion({ seriesKey: "made.up" }));
    expect(out.issued).toBe(false);
    expect(record.issued).toHaveLength(0);
  });
});

describe("a failed write says why — every path", () => {
  it("refuses a series the register does not know", async () => {
    const svc = new CommodityExposureService(happyDb(), seals());
    const out = await svc.assert(ACTOR, assertion({ seriesKey: "made.up" }), "tok");
    expect(out.reason).toBe("unknown_series");
    expect(out.detail).toMatch(/not a series this register knows/);
  });

  it("refuses another house's item, and takes the house from the SESSION", async () => {
    const svc = new CommodityExposureService(
      makeDb((t) => (t === "restaurant_inventory" ? { data: [] } : { data: [] })),
      seals(),
    );
    const out = await svc.assert(ACTOR, assertion(), "tok");
    expect(out.reason).toBe("item_not_this_house");
    expect(out.detail).toMatch(/not on this house's shelf/);
  });

  it("refuses a figure with no basis, in the words a person can act on", async () => {
    const svc = new CommodityExposureService(happyDb(), seals());
    const out = await svc.assert(ACTOR, assertion({ passThrough: 0.5 }), "tok");
    expect(out.reason).toBe("figure_without_a_basis");
    expect(out.detail).toMatch(/which is the honest common case/);
  });

  it("refuses a basis with no figure", async () => {
    const svc = new CommodityExposureService(happyDb(), seals());
    const out = await svc.assert(
      ACTOR,
      assertion({ passThroughBasis: "house_measured" }),
      "tok",
    );
    expect(out.reason).toBe("figure_without_a_basis");
  });

  it("names a duplicate as ALREADY ASSERTED rather than as a broken write", async () => {
    const svc = new CommodityExposureService(
      happyDb([], { message: 'duplicate key value violates unique constraint "idx_..."' }),
      seals(),
    );
    const out = await svc.assert(ACTOR, assertion(), "tok");
    expect(out.reason).toBe("already_asserted");
    expect(out.detail).toMatch(/Retire the existing one/);
  });

  it("lets a refused seal reach the caller as a refusal", async () => {
    // `redeem` throws a whole sentence naming what did not match, and every
    // other sealed act in this codebase relies on that. It is not caught here
    // and softened into an outcome.
    const svc = new CommodityExposureService(happyDb(), seals());
    await expect(svc.assert(ACTOR, assertion(), null)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe("what is written, and what is said about it", () => {
  it("writes the person and says the pass-through is unmeasured, when it is", async () => {
    const writes: Write[] = [];
    const svc = new CommodityExposureService(happyDb(writes), seals());
    const out = await svc.assert(ACTOR, assertion(), "tok");
    expect(out.written).toBe(true);
    expect(out.detail).toMatch(/never measured how much of a move/);
    const w = writes.find((x) => x.table === "house_item_commodity_exposure")!;
    expect(w.payload.asserted_by).toBe("u1");
    expect(w.payload.restaurant_id).toBe("r1");
    expect(w.payload.pass_through).toBeNull();
    expect(w.payload.pass_through_basis).toBe("unset");
  });

  it("states the basis when a figure IS given", async () => {
    const svc = new CommodityExposureService(happyDb(), seals());
    const out = await svc.assert(
      ACTOR,
      assertion({ passThrough: 0.53, passThroughBasis: "issuer_published" }),
      "tok",
    );
    expect(out.detail).toMatch(/53\.0%/);
    expect(out.detail).toMatch(/a figure the issuer published/);
  });
});

describe("retirement, never deletion", () => {
  it("refuses a retirement with no reason", async () => {
    const svc = new CommodityExposureService(happyDb(), seals());
    const out = await svc.retire(ACTOR, "e1", "   ");
    expect(out.written).toBe(false);
    expect(out.detail).toMatch(/names a reason, or it is not a retirement/);
  });

  it("writes the person and the reason, and says the record survives", async () => {
    const writes: Write[] = [];
    const svc = new CommodityExposureService(happyDb(writes), seals());
    const out = await svc.retire(ACTOR, "e1", "we stopped buying it");
    expect(out.reason).toBe("retired");
    expect(out.detail).toMatch(/Retired, not deleted/);
    const w = writes.find((x) => x.table === "house_item_commodity_exposure")!;
    expect(w.payload.retired_by).toBe("u1");
    expect(w.payload.retired_reason).toBe("we stopped buying it");
  });

  it("says nothing was retired when no LIVE row matched, rather than claiming success", async () => {
    const svc = new CommodityExposureService(
      makeDb((t) => (t === "house_item_commodity_exposure" ? { data: [] } : { data: [] })),
      seals(),
    );
    const out = await svc.retire(ACTOR, "e1", "reason");
    expect(out.written).toBe(false);
    expect(out.detail).toMatch(/may already be retired/);
  });
});
