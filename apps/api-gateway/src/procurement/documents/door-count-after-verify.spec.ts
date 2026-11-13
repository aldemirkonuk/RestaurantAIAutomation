import { makeMockDb, MockDb } from "../canonical/delivery-mock";
import { costAfterVerify } from "./door-count-after-verify";
import { DocumentsController } from "./documents.controller";

/**
 * r28 invoices G9: a door count onto a delivery already VERIFIED booked its
 * goods provisional and said nothing; only a second verify costed them. A
 * holder of the house's money now gets them costed at once, at the agreed
 * price; anyone else is told the cost waits for an owner or a manager.
 * All data SYNTHETIC.
 */
const booked = (delta: number) =>
  ({
    ok: true,
    value: {
      deliveryId: "del-1",
      documentId: "door-2",
      booked: [{ documentId: "door-2", lineNo: 1, inventoryId: "inv-1", delta, transactionId: "t1" }],
      notBooked: [],
      bottlesMoved: Math.max(0, delta),
    },
  }) as const;

const finished = (n: number, waiting: { inventoryId: string; reason: string }[] = []) => {
  const calls: number[] = [];
  const finish = async () => {
    calls.push(1);
    return {
      ok: true as const,
      value: {
        deliveryId: "del-1",
        finalised: Array.from({ length: n }, (_, i) => ({
          inventoryId: `inv-${i + 1}`,
          unitCost: 10,
          bottlesFinalised: 6,
        })) as never,
        stillProvisional: waiting,
      },
    };
  };
  return { finish, calls };
};

describe("costAfterVerify (r28 G9)", () => {
  it("costs a manager's late count at once, through finishProvisional", async () => {
    const f = finished(1);
    const out = await costAfterVerify({ deliveryState: "VERIFIED", booking: booked(6), role: "manager", finish: f.finish });
    expect(f.calls).toHaveLength(1);
    expect(out).toMatchObject({ costed: 1, waitsForAManager: false, waiting: [] });
    expect(out!.sentence).toBe(
      "This delivery was already verified, so what this count added was costed at the agreed price now: 1 item.",
    );
  });

  it("an owner and an admin hold the money too; a padded role is read", async () => {
    for (const role of ["owner", "admin", " manager "]) {
      const f = finished(2);
      const out = await costAfterVerify({ deliveryState: "VERIFIED", booking: booked(3), role, finish: f.finish });
      expect(f.calls).toHaveLength(1);
      expect(out!.sentence).toMatch(/2 items\.$/);
    }
  });

  it("a staff count is booked, nothing is posted, and the answer says who costs it", async () => {
    for (const role of ["staff", null, ""]) {
      const f = finished(1);
      const out = await costAfterVerify({ deliveryState: "VERIFIED", booking: booked(6), role, finish: f.finish });
      expect(f.calls).toHaveLength(0);
      expect(out).toMatchObject({ costed: 0, waitsForAManager: true });
      expect(out!.sentence).toMatch(/its cost waits until an owner or a manager checks the cost again/);
    }
  });

  it("says which items stay provisional, and why, once per reason", async () => {
    const reason = "no agreed price reaches this item. The lot stays provisional.";
    const f = finished(0, [
      { inventoryId: "inv-1", reason },
      { inventoryId: "inv-2", reason },
    ]);
    const out = await costAfterVerify({ deliveryState: "VERIFIED", booking: booked(6), role: "owner", finish: f.finish });
    expect(out!.costed).toBe(0);
    expect(out!.waiting).toHaveLength(2);
    expect(out!.sentence).toBe(
      `This delivery was already verified, but nothing this count added could be costed at the agreed price. 2 items stay provisional: ${reason}`,
    );
  });

  it("a failed post is said, with where to retry", async () => {
    const out = await costAfterVerify({
      deliveryState: "VERIFIED",
      booking: booked(6),
      role: "manager",
      finish: async () => ({ ok: false, status: 500, error: "the lots could not be read" }),
    });
    expect(out!.sentence).toBe(
      "This delivery was already verified. What this count added is on the shelf, but its cost could not be posted now: the lots could not be read. Check the cost again on the delivery.",
    );
  });

  it("says nothing for a delivery not yet verified, a failed booking, or a recount that added nothing", async () => {
    const f = finished(1);
    for (const state of ["DELIVERED", "AGREED", "RECONCILING", null]) {
      expect(await costAfterVerify({ deliveryState: state, booking: booked(6), role: "manager", finish: f.finish })).toBeNull();
    }
    expect(
      await costAfterVerify({
        deliveryState: "VERIFIED",
        booking: { ok: false, status: 500, error: "x" },
        role: "manager",
        finish: f.finish,
      }),
    ).toBeNull();
    expect(await costAfterVerify({ deliveryState: "VERIFIED", booking: booked(0), role: "manager", finish: f.finish })).toBeNull();
    expect(await costAfterVerify({ deliveryState: "VERIFIED", booking: booked(-2), role: "manager", finish: f.finish })).toBeNull();
    expect(f.calls).toHaveLength(0);
  });
});

describe("POST door-count onto a verified delivery (r28 G9, the route)", () => {
  const HOUSE = "11111111-1111-4111-8111-111111111111";
  const PERSON = "22222222-2222-4222-8222-222222222222";

  function harness(state: string) {
    const db: MockDb = makeMockDb();
    const calls: Record<string, unknown[]> = { finish: [] };
    const intake = {
      recordDoorCount: async () => ({ documentId: "door-2", parsed: {}, duplicate: false }),
    };
    const deliveries = {
      linkDocument: async (_r: string, deliveryId: string) => ({
        ok: true,
        value: { delivery: { id: deliveryId, state }, alreadyLinked: false },
      }),
    };
    const deliveryStock = {
      bookAtTheDoor: async () => booked(6),
      finishProvisional: async (r: string, d: string, u: string) => {
        calls.finish.push({ r, d, u });
        return { ok: true, value: { deliveryId: d, finalised: [{ inventoryId: "inv-1", unitCost: 10, bottlesFinalised: 6 }], stillProvisional: [] } };
      },
    };
    const none = {} as never;
    const controller = new DocumentsController(
      intake as never, db.client as never, none, none, none, none, none,
      deliveries as never, deliveryStock as never, none, none,
    );
    return { controller, calls };
  }
  const body = { deliveryId: "del-1", lines: [{ lineNo: 1, qty: 6, uom: "bottle" }] } as never;

  it("a manager's count onto a VERIFIED delivery is costed, and the receipt says so", async () => {
    const h = harness("VERIFIED");
    const out = (await h.controller.doorCount(body, { userId: PERSON, restaurantId: HOUSE, role: "manager" } as never)) as {
      booking: { bottlesMoved: number; afterVerify?: { costed: number; sentence: string } };
    };
    expect(h.calls.finish).toEqual([{ r: HOUSE, d: "del-1", u: PERSON }]);
    expect(out.booking.bottlesMoved).toBe(6);
    expect(out.booking.afterVerify).toMatchObject({ costed: 1 });
  });

  it("a staff count onto a VERIFIED delivery posts nothing, and the receipt says who costs it", async () => {
    const h = harness("VERIFIED");
    const out = (await h.controller.doorCount(body, { userId: PERSON, restaurantId: HOUSE, role: "staff" } as never)) as {
      booking: { afterVerify?: { waitsForAManager: boolean } };
    };
    expect(h.calls.finish).toEqual([]);
    expect(out.booking.afterVerify).toMatchObject({ waitsForAManager: true });
  });

  it("a count onto an open delivery is unchanged: no afterVerify, no post", async () => {
    const h = harness("DELIVERED");
    const out = (await h.controller.doorCount(body, { userId: PERSON, restaurantId: HOUSE, role: "manager" } as never)) as {
      booking: Record<string, unknown>;
    };
    expect(h.calls.finish).toEqual([]);
    expect("afterVerify" in out.booking).toBe(false);
  });
});
