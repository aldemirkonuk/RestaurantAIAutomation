import { HttpException, HttpStatus } from "@nestjs/common";
import { DeliveriesController } from "./deliveries.controller";
import { PROPOSAL_MONEY_KEYS, proposalsForRole } from "./delivery-money-gate";

/**
 * A DELIVERY'S MONEY IS SETTLED BY AN OWNER OR A MANAGER (r28 invoices, G3).
 *
 * Verify writes the agreed price onto the lots a delivery booked, so it decides
 * the house's cost of goods. The six acts that lead there used to answer any
 * signed-in member. Each case runs one call with a non-holder and with a
 * holder, against a `DeliveryService` that records the call: "refused" means
 * the service was never reached, "admitted" means it was.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const DELIVERY = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";

const as = (role: string | null | undefined) => ({
  userId: PERSON,
  restaurantId: HOUSE,
  role,
});
const HOLDERS = [as("owner"), as("manager"), as("admin")];
const NON_HOLDERS = [as("staff"), as(null), as(undefined), as(""), as("sommelier")];

function harness(proposals: Record<string, unknown>[] = []) {
  const reached: string[] = [];
  const ok = (name: string, value: unknown = { done: name }) =>
    jest.fn(async () => {
      reached.push(name);
      return { ok: true, value };
    });
  const deliveries = {
    propose: ok("propose"),
    counter: ok("counter"),
    accept: ok("accept"),
    acceptAsBilled: ok("acceptAsBilled"),
    agree: ok("agree"),
    verify: ok("verify"),
    proposalsFor: ok("proposalsFor", proposals),
    list: ok("list", []),
    create: ok("create"),
    linkDocument: ok("linkDocument"),
  };
  const controller = new DeliveriesController(
    {} as never,
    deliveries as never,
    {} as never,
  );
  return { controller, reached };
}

type User = ReturnType<typeof as>;
type Act = [string, string, (c: DeliveriesController, u: User) => Promise<unknown>];

const PROPOSE_BODY = { side: "restaurant", reason: "PRICE" } as never;

const MONEY_ACTS: Act[] = [
  ["POST :id/proposals", "propose", (c, u) => c.propose(DELIVERY, PROPOSE_BODY, u)],
  ["POST proposals/:pid/counter", "counter", (c, u) => c.counter(PROPOSAL, PROPOSE_BODY, u)],
  ["POST proposals/:pid/accept", "accept", (c, u) => c.accept(PROPOSAL, u)],
  [
    "POST :id/accept-as-billed",
    "acceptAsBilled",
    (c, u) =>
      c.acceptAsBilled(DELIVERY, { documentId: PROPOSAL, lineNo: 1, reason: "as billed" } as never, u),
  ],
  ["POST :id/agree", "agree", (c, u) => c.agree(DELIVERY, u)],
  ["POST :id/verify", "verify", (c, u) => c.verify(DELIVERY, u)],
];

describe("a delivery's money acts need the house's money", () => {
  describe.each(MONEY_ACTS)("%s", (_route, service, call) => {
    it.each(NON_HOLDERS.map((u) => [String(u.role), u] as const))(
      "refuses role %s with a 403 sentence before the service is reached",
      async (_label, user) => {
        const { controller, reached } = harness();
        const err = await call(controller, user).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
        const words = String((err as HttpException).getResponse());
        expect(words).toMatch(/an owner's or a manager's act/);
        expect(words).toMatch(/nothing was recorded/);
        expect(reached).toEqual([]);
      },
    );

    it.each(HOLDERS.map((u) => [String(u.role), u] as const))(
      "admits role %s to the service",
      async (_label, user) => {
        const { controller, reached } = harness();
        await call(controller, user);
        expect(reached).toEqual([service]);
      },
    );
  });

  it("names the staff role and the door in the refusal", async () => {
    const { controller } = harness();
    const err = (await controller
      .verify(DELIVERY, as("staff"))
      .catch((e: unknown) => e)) as HttpException;
    expect(String(err.getResponse())).toMatch(/settles what its goods cost/);
    expect(String(err.getResponse())).toMatch(/signed in as staff/);
    expect(String(err.getResponse())).toMatch(/Counting the goods at the door still goes through/);
  });
});

describe("door work stays open to every member", () => {
  it.each(NON_HOLDERS.map((u) => [String(u.role), u] as const))(
    "lists, creates and attaches for role %s",
    async (_label, user) => {
      const { controller, reached } = harness();
      await controller.list(user);
      await controller.create({ documents: [] } as never, user);
      await controller.link(DELIVERY, { documentId: PROPOSAL, role: "invoice" } as never, user);
      expect(reached).toEqual(["list", "create", "linkDocument"]);
    },
  );
});

describe("the proposal thread withholds money from a non-holder", () => {
  const thread = [
    {
      id: PROPOSAL,
      reason: "PRICE",
      qty_proposed: 12,
      unit_price_proposed: 41.5,
      money_at_risk: 18,
      note: "vendor says 41.50",
    },
  ];

  it.each(NON_HOLDERS.map((u) => [String(u.role), u] as const))(
    "role %s reads quantities and reasons, money as null, and is told it was withheld",
    async (_label, user) => {
      const { controller } = harness(thread);
      const out = (await controller.proposals(DELIVERY, user)) as {
        proposals: Record<string, unknown>[];
        moneyWithheld: boolean;
      };
      expect(out.moneyWithheld).toBe(true);
      expect(out.proposals[0]).toEqual({
        ...thread[0],
        unit_price_proposed: null,
        money_at_risk: null,
      });
      // The stored thread is not mutated by the read.
      expect(thread[0].unit_price_proposed).toBe(41.5);
    },
  );

  it.each(HOLDERS.map((u) => [String(u.role), u] as const))(
    "role %s reads the thread whole",
    async (_label, user) => {
      const { controller } = harness(thread);
      const out = (await controller.proposals(DELIVERY, user)) as {
        proposals: Record<string, unknown>[];
        moneyWithheld: boolean;
      };
      expect(out).toEqual({ proposals: thread, moneyWithheld: false });
    },
  );

  it("withholds exactly the two money keys and keeps them as keys", () => {
    expect([...PROPOSAL_MONEY_KEYS]).toEqual(["unit_price_proposed", "money_at_risk"]);
    const out = proposalsForRole("staff", [{ unit_price_proposed: 1 }]);
    expect(Object.keys(out.proposals[0])).toEqual(["unit_price_proposed"]);
    // A row that never carried the key does not gain it.
    expect(proposalsForRole("staff", [{ id: "x" }]).proposals[0]).toEqual({ id: "x" });
  });
});
