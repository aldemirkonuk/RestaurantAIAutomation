import { HttpException, HttpStatus } from "@nestjs/common";
import { DeliveriesController } from "./deliveries.controller";
import {
  assertDeliveryDesk,
  DeliveryDeskAct,
} from "./canonical/delivery-desk-gate";

/**
 * THE DELIVERY DESK IS FOR THE HOUSE'S MONEY HOLDERS; THE DOOR IS NOT (ADR 0312).
 *
 * `DeliveriesController` carried `JwtAuthGuard` and nothing else, so a staff
 * token could put a priced proposal on a delivery, accept it, agree the
 * delivery and verify it, and the verify posts the agreed price as the lots'
 * final cost (`finaliseAtVerified`). Six handlers now call
 * `assertDeliveryDesk` first.
 *
 * ONE FIXTURE, BOTH SIDES, like `documents.money-gate.spec.ts`. The services
 * are tripwires that record a touch and throw, so "refused" is proven to mean
 * refused before any service call. "Admitted" uses services that answer, and
 * asserts each was called once with the token's house.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER_HOUSE = "99999999-9999-4999-8999-999999999999";
const PERSON = "22222222-2222-4222-8222-222222222222";
const DEL = "33333333-3333-4333-8333-333333333333";
const PROP = "44444444-4444-4444-8444-444444444444";
const DOC = "55555555-5555-4555-8555-555555555555";

const as = (role: string | null | undefined) => ({
  userId: PERSON,
  restaurantId: HOUSE,
  role,
});
const HOLDERS = [as("owner"), as("manager"), as("admin"), as("Owner")];
const NON_HOLDERS = [
  as("staff"),
  as("waiter"),
  as(""),
  as(null),
  as(undefined),
];

const PROPOSAL = {
  side: "restaurant",
  reason: "PRICE_VARIANCE",
  unitPriceProposed: 12.5,
  restaurantId: OTHER_HOUSE,
};

function tripwires() {
  const reached: string[] = [];
  const tripwire = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          reached.push(`${name}.${String(prop)}`);
          throw new Error(`REACHED ${name}.${String(prop)}`);
        },
      },
    ) as never;
  const controller = new DeliveriesController(
    tripwire("DeliverySpineService"),
    tripwire("DeliveryService"),
    tripwire("DeliveryClockService"),
  );
  return { controller, reached };
}

function answering() {
  const calls: { name: string; args: unknown[] }[] = [];
  const answer = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          return async (...args: unknown[]) => {
            calls.push({ name: `${name}.${String(prop)}`, args });
            return { ok: true, value: prop === "list" ? [] : { id: DEL } };
          };
        },
      },
    ) as never;
  const controller = new DeliveriesController(
    answer("DeliverySpineService"),
    answer("DeliveryService"),
    answer("DeliveryClockService"),
  );
  return { controller, calls };
}

type User = ReturnType<typeof as>;
type Desk = [
  string,
  DeliveryDeskAct,
  RegExp,
  string,
  (c: DeliveriesController, u: User) => Promise<unknown>,
];

/** The six desk writes, the act each refuses in, and the service each reaches. */
const DESK: Desk[] = [
  [
    "POST :id/proposals",
    "propose",
    /Putting a position on a delivery's record/,
    "DeliveryService.propose",
    (c, u) => c.propose(DEL, PROPOSAL as never, u as never),
  ],
  [
    "POST proposals/:pid/counter",
    "counter",
    /Answering a position on a delivery/,
    "DeliveryService.counter",
    (c, u) => c.counter(PROP, PROPOSAL as never, u as never),
  ],
  [
    "POST proposals/:pid/accept",
    "accept",
    /Accepting a position on a delivery/,
    "DeliveryService.accept",
    (c, u) => c.accept(PROP, u as never),
  ],
  [
    "POST :id/accept-as-billed",
    "accept_as_billed",
    /Accepting a delivery's difference as billed/,
    "DeliveryService.acceptAsBilled",
    (c, u) =>
      c.acceptAsBilled(
        DEL,
        { documentId: DOC, lineNo: 1, reason: "SYNTHETIC: as billed" } as never,
        u as never,
      ),
  ],
  [
    "POST :id/agree",
    "agree",
    /Agreeing a delivery/,
    "DeliveryService.agree",
    (c, u) => c.agree(DEL, u as never),
  ],
  [
    "POST :id/verify",
    "verify",
    /Verifying a delivery/,
    "DeliveryService.verify",
    (c, u) => c.verify(DEL, u as never),
  ],
];

/** The door and read routes, and the service call each must still reach. */
const OPEN: [
  string,
  string,
  (c: DeliveriesController, u: User) => Promise<unknown>,
][] = [
  ["GET /", "DeliveryService.list", (c, u) => c.list(u as never)],
  [
    "POST /",
    "DeliveryService.create",
    (c, u) => c.create({ documents: [] } as never, u as never),
  ],
  ["GET :id", "DeliveryService.byId", (c, u) => c.byId(DEL, u as never)],
  [
    "GET :id/proposals",
    "DeliveryService.proposalsFor",
    (c, u) => c.proposals(DEL, u as never),
  ],
  [
    "POST :id/documents",
    "DeliveryService.linkDocument",
    (c, u) =>
      c.link(DEL, { documentId: DOC, role: "invoice" } as never, u as never),
  ],
];

const settle = async (p: Promise<unknown>) => {
  try {
    return { ok: true as const, v: await p };
  } catch (e) {
    return { ok: false as const, e };
  }
};

describe("the delivery desk refuses a session that does not hold the house's money", () => {
  describe.each(DESK)("%s", (_route, _act, words, _svc, call) => {
    it("refuses staff with a 403 sentence before any service is touched", async () => {
      const h = tripwires();
      const r = await settle(call(h.controller, as("staff")));
      expect(r.ok).toBe(false);
      const err = (r as { e: unknown }).e;
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      const said = String((err as Error).message);
      expect(said).toMatch(words);
      expect(said).toMatch(/an owner's or a manager's act/);
      expect(said).toMatch(
        /You are signed in as staff at this house, so nothing was changed/,
      );
      expect(said).toMatch(/The door count and the photograph still go through/);
      expect(h.reached).toEqual([]);
    });

    it("refuses every non-holder, and tells a session with no role that it has none", async () => {
      for (const u of NON_HOLDERS) {
        const h = tripwires();
        const r = await settle(call(h.controller, u));
        const err = (r as { e: HttpException }).e;
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(h.reached).toEqual([]);
        if (!u.role)
          expect(String(err.message)).toMatch(
            /could not be shown to hold any role at this house/,
          );
      }
    });
  });
});

describe("the delivery desk admits an owner, a manager and an admin", () => {
  describe.each(DESK)("%s", (_route, _act, _words, svc, call) => {
    it("reaches the service once, scoped to the token's house", async () => {
      for (const u of HOLDERS) {
        const h = answering();
        const r = await settle(call(h.controller, u));
        expect(r.ok).toBe(true);
        expect(h.calls.map((c) => c.name)).toEqual([svc]);
        expect(h.calls[0].args[0]).toBe(HOUSE);
      }
    });
  });
});

describe("the door and the reads stay open to staff", () => {
  it.each(OPEN)("%s reaches its service for a staff token", async (_r, svc, call) => {
    const h = answering();
    const r = await settle(call(h.controller, as("staff")));
    expect(r.ok).toBe(true);
    expect(h.calls.map((c) => c.name)).toContain(svc);
    for (const c of h.calls) expect(c.args[0]).toBe(HOUSE);
  });
});

describe("assertDeliveryDesk", () => {
  it("returns for owner and manager and throws a FORBIDDEN HttpException otherwise", () => {
    expect(() => assertDeliveryDesk({ role: "owner" }, "verify")).not.toThrow();
    expect(() => assertDeliveryDesk({ role: " manager " }, "agree")).not.toThrow();
    for (const u of [{ role: "staff" }, { role: null }, {}, null, undefined]) {
      let caught: unknown;
      try {
        assertDeliveryDesk(u as never, "verify");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });

  it("names each act in its own words", () => {
    for (const [, act, words] of DESK) {
      let said = "";
      try {
        assertDeliveryDesk({ role: "staff" }, act);
      } catch (e) {
        said = String((e as Error).message);
      }
      expect(said).toMatch(words);
      for (const [, other, otherWords] of DESK)
        if (other !== act) expect(said).not.toMatch(otherWords);
    }
  });
});
