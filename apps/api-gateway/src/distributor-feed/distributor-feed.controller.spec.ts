/**
 * The three price-code routes, at the controller (ADR 0126 §7).
 *
 * `price-code-mappings.spec.ts` proves the SERVICE. What is only true at this
 * layer is what the controller does with the session and with the two answers
 * it composes, and one of those was measured wrong here on 2026-09-05:
 *
 *   - the name on a statement comes from the session's `name`. The controller
 *     read `user.fullName`, which `JwtStrategy.validate` never sets, so every
 *     statement was signed with the manager's EMAIL. That is the regression
 *     this file exists to stop coming back;
 *   - every route runs `assertCanManageRestaurant` BEFORE it touches a row —
 *     a read posture and a write posture that disagree is a defect (ADR 0114),
 *     and these rows name a person and their evidence;
 *   - the withdrawal reports how many prices the statement admitted, and
 *     reports `null` as UNKNOWN rather than as none.
 */

import { DistributorFeedController } from "./distributor-feed.controller";
import type { DistributorFeedService } from "./distributor-feed.service";
import type { PriceCodeMappingsService } from "./price-code-mappings.service";
import type { OrganizationsService } from "../organizations/organizations.service";

/** The shape the controller hands the service, typed so `mock.calls[0][0]` is
 *  a value rather than an index into an empty tuple — `jest.fn(async () => …)`
 *  infers no parameters at all. */
interface DeclareArg {
  restaurantId: string;
  distributorKey: string;
  priceCode: string;
  priceBasis: string;
  evidence: string;
  declaredBy: string;
  declaredByName: string;
}

function build(over: Partial<Record<string, unknown>> = {}) {
  const declare = jest.fn(async (_req: DeclareArg) => ({
    ok: true,
    mappingId: "m-1",
    refusedBecause: null,
  }));
  const withdraw = jest.fn(async () => ({
    ok: true,
    mappingId: "m-1",
    refusedBecause: null,
  }));
  const rowsAdmittedBy = jest.fn(async () => ({ count: 2, unreadable: null }));
  const forSender = jest.fn(async () => ({
    restaurantId: "r-1",
    distributorKey: "southern-glazers-il",
    rows: [],
    byCode: {},
    conflicted: [],
    live: 0,
    withdrawn: 0,
    readFailed: false,
    note: "nothing mapped",
  }));
  const assertCanManageRestaurant = jest.fn(async () => undefined);
  const mappings = {
    declare,
    withdraw,
    rowsAdmittedBy,
    forSender,
    ...over,
  } as unknown as PriceCodeMappingsService;
  const organizations = {
    assertCanManageRestaurant,
  } as unknown as OrganizationsService;
  const controller = new DistributorFeedController(
    {} as DistributorFeedService,
    mappings,
    organizations,
  );
  return {
    controller,
    declare,
    withdraw,
    rowsAdmittedBy,
    forSender,
    assertCanManageRestaurant,
  };
}

describe("DistributorFeedController — the statement's signature", () => {
  it("signs with the session's `name`, which is the field JwtStrategy sets", async () => {
    const { controller, declare } = build();
    await controller.declareCode(
      {
        userId: "u-1",
        restaurantId: "r-1",
        name: "Ada Manager",
        email: "ada@example.test",
      },
      "southern-glazers-il",
      { priceCode: "CON", priceBasis: "contract price", evidence: "guide p7" },
    );
    expect(declare.mock.calls[0][0]).toMatchObject({
      declaredByName: "Ada Manager",
    });
  });

  it("falls back to the email only when the session resolves NO name", async () => {
    const { controller, declare } = build();
    await controller.declareCode(
      { userId: "u-1", restaurantId: "r-1", email: "ada@example.test" },
      "southern-glazers-il",
      { priceCode: "CON", priceBasis: "contract price", evidence: "guide p7" },
    );
    expect(declare.mock.calls[0][0]).toMatchObject({
      declaredByName: "ada@example.test",
    });
  });

  it("sends an empty name rather than a placeholder, and lets the service refuse it", async () => {
    const declare = jest.fn(async (_req: DeclareArg) => ({
      ok: false,
      mappingId: null,
      refusedBecause: "the statement must name the person making it",
    }));
    const { controller } = build({ declare });
    const out = await controller.declareCode(
      { userId: "u-1", restaurantId: "r-1" },
      "southern-glazers-il",
      { priceCode: "CON", priceBasis: "contract price", evidence: "guide p7" },
    );
    expect(declare.mock.calls[0][0]).toMatchObject({ declaredByName: "" });
    expect(out.success).toBe(false);
    expect(out.refusedBecause).toMatch(/must name the person/);
  });
});

describe("DistributorFeedController — the gate", () => {
  it("checks the role BEFORE reading, declaring or withdrawing", async () => {
    const { controller, assertCanManageRestaurant, forSender } = build();
    await controller.codesFor(
      { userId: "u-1", restaurantId: "r-1" },
      "southern-glazers-il",
    );
    await controller.declareCode(
      { userId: "u-1", restaurantId: "r-1", name: "Ada" },
      "southern-glazers-il",
      { priceCode: "CON", priceBasis: "contract price", evidence: "guide p7" },
    );
    await controller.withdrawCode(
      { userId: "u-1", restaurantId: "r-1" },
      "m-1",
      { reason: "the rep corrected it" },
    );
    expect(assertCanManageRestaurant).toHaveBeenCalledTimes(3);
    expect(forSender).toHaveBeenCalledTimes(1);
  });

  it("does not read a mapping when the role check throws", async () => {
    const { controller, forSender } = build();
    const boom = new Error("only a manager or an owner may do that");
    const organizations = {
      assertCanManageRestaurant: jest.fn(async () => {
        throw boom;
      }),
    } as unknown as OrganizationsService;
    const gated = new DistributorFeedController(
      {} as DistributorFeedService,
      { forSender } as unknown as PriceCodeMappingsService,
      organizations,
    );
    await expect(
      gated.codesFor({ userId: "u-1", restaurantId: "r-1" }, "rndc-il"),
    ).rejects.toThrow(/only a manager or an owner/);
    expect(forSender).not.toHaveBeenCalled();
  });
});

describe("DistributorFeedController — the withdrawal's count", () => {
  it("names how many prices the statement admitted, and says none was deleted", async () => {
    const { controller } = build();
    const out = await controller.withdrawCode(
      { userId: "u-1", restaurantId: "r-1" },
      "m-1",
      { reason: "the rep corrected it" },
    );
    expect(out.rowsAdmitted).toBe(2);
    expect(out.note).toMatch(/None was deleted/);
  });

  it("reports an uncountable set as UNKNOWN, never as none", async () => {
    const rowsAdmittedBy = jest.fn(async () => ({
      count: null,
      unreadable: "permission denied for table vendor_price_observations",
    }));
    const { controller } = build({ rowsAdmittedBy });
    const out = await controller.withdrawCode(
      { userId: "u-1", restaurantId: "r-1" },
      "m-1",
      { reason: "the rep corrected it" },
    );
    expect(out.rowsAdmitted).toBeNull();
    expect(out.note).toMatch(/unknown, not none/i);
    expect(out.rowsAdmittedUnreadable).toMatch(/permission denied/);
  });
});
