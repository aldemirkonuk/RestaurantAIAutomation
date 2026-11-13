import { ConflictException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { ProcurementOrderStatus as S } from "./dto/procurement.dto";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { ProcurementService } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";
import { PASSING_SEAL } from "./testing/passing-vendor-gates";
import { ORDER_CLOSED_TO_EDITS, MOVING_ON_NEEDS_THE_RIGHT } from "./order-edit-gate";

/**
 * ADR 0254 rule 4 (an approved order moves on only by an owner, a manager or
 * someone given the right; "delivered" only from the door), and a received or
 * closed order is not edited through PATCH orders/:id (r25, QA 3b H4).
 */

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Standing = "owner" | "manager" | "grant" | "ask";

function setup(status: string, standing: Standing = "manager", opts: { writeFinds?: boolean } = {}) {
  const log: string[] = [];
  const writeFilters: string[] = [];
  const order = { id: ORDER, restaurant_id: HOUSE, status };
  const supabase: any = {
    from() {
      let writing = false;
      const q: any = {
        select: () => q,
        update: (p: Record<string, unknown>) => {
          writing = true;
          log.push(`update ${Object.keys(p).filter((k) => p[k] !== undefined).join(",")}`);
          return q;
        },
        eq: (c: string, v: unknown) => {
          if (writing) writeFilters.push(`eq ${c}=${String(v)}`);
          return q;
        },
        in: (c: string, v: unknown[]) => {
          if (writing) writeFilters.push(`in ${c}=${v.join(",")}`);
          return q;
        },
        not: (c: string, op: string, v: string) => {
          if (writing) writeFilters.push(`not ${c} ${op} ${v}`);
          return q;
        },
        maybeSingle: async () => {
          if (writing) {
            return opts.writeFinds === false
              ? { data: null, error: null }
              : { data: { ...order, inventory: null }, error: null };
          }
          log.push("read");
          return { data: { ...order }, error: null };
        },
        single: async () => ({ data: { ...order, inventory: null }, error: null }),
      };
      return q;
    },
  };
  const authority = {
    standing: jest.fn(async () =>
      standing === "ask"
        ? { mode: "ask", basis: null, grant: null, reason: "not_owner_or_manager" }
        : { mode: "send", basis: standing, grant: standing === "grant" ? { id: "g1" } : null },
    ),
  };
  const svc = new ProcurementService(
    { supabase, getClient: () => supabase } as unknown as DatabaseService,
    { createEvent: jest.fn() } as unknown as EventsService,
    { recordTransaction: jest.fn() } as unknown as InventoryLedgerService,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    PASSING_SEAL as any,
    authority as any,
  );
  return { svc, log, writeFilters, authority };
}

async function caught(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a refusal");
}

describe("a received or closed order is not edited", () => {
  it("is exactly the six states where goods arrived or the order ended", () => {
    expect([...ORDER_CLOSED_TO_EDITS].sort()).toEqual(
      [S.CANCELLED, S.COMPLETED, S.DELIVERED, S.FAILED, S.PARTIALLY_RECEIVED, S.REJECTED].sort(),
    );
  });

  it.each(ORDER_CLOSED_TO_EDITS.map((s) => [s]))("refuses a note on a %s order and writes nothing", async (s) => {
    const h = setup(s, "owner");
    const e = await caught(h.svc.updateOrder(HOUSE, ORDER, { managerNotes: "x" }, { actorUserId: "u" }));
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(e.getResponse().reason).toBe("order_closed_to_edits");
    expect(h.log.filter((l) => l.startsWith("update"))).toEqual([]);
  });

  it("names where a delivered order's facts live", async () => {
    const h = setup(S.DELIVERED, "owner");
    const e = await caught(h.svc.updateOrder(HOUSE, ORDER, { discrepancyNotes: "x" }, { actorUserId: "u" }));
    expect(e.getResponse().message).toBe(
      "This order is delivered, so it is no longer edited. What arrived is recorded at the receiving door and what it cost when the delivery is checked. Nothing was changed.",
    );
  });

  it("repeats the rule on the write, and says the order changed when it was received in between", async () => {
    const h = setup(S.CONFIRMED, "manager", { writeFinds: false });
    const e = await caught(h.svc.updateOrder(HOUSE, ORDER, { trackingNumber: "T1" }, { actorUserId: "u" }));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getResponse().reason).toBe("order_closed_while_editing");
    expect(h.writeFilters).toContain(
      `not status in (${ORDER_CLOSED_TO_EDITS.join(",")})`,
    );
  });

  it("leaves a note on an order still on its way to any member (ADR 0244 D2)", async () => {
    const h = setup(S.IN_TRANSIT, "ask");
    await h.svc.updateOrder(HOUSE, ORDER, { managerNotes: "late" }, { actorUserId: "staff-1" });
    expect(h.log).toContain("update manager_notes");
    expect(h.authority.standing).not.toHaveBeenCalled();
  });
});

describe("delivered comes only from the door (ADR 0254 rule 4)", () => {
  it.each([[S.DELIVERED], [S.PARTIALLY_RECEIVED]])(
    "refuses a PATCH to %s for an owner too, before anything is written",
    async (to) => {
      const h = setup(S.CONFIRMED, "owner");
      const e = await caught(h.svc.updateOrder(HOUSE, ORDER, { status: to }, { actorUserId: "u" }));
      expect(e.getResponse().reason).toBe("status_has_its_own_act");
      expect(h.log.filter((l) => l.startsWith("update"))).toEqual([]);
    },
  );

  it("refuses completing a delivered order by PATCH", async () => {
    const h = setup(S.DELIVERED, "owner");
    const e = await caught(h.svc.updateOrder(HOUSE, ORDER, { status: S.COMPLETED }, { actorUserId: "u" }));
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    expect(e.getResponse().reason).toBe("status_has_its_own_act");
    expect(h.log.filter((l) => l.startsWith("update"))).toEqual([]);
  });
});

describe("moving an approved order on needs an owner, a manager or the right (ADR 0254 rule 4)", () => {
  it.each([[S.APPROVED], [S.CONFIRMED], [S.IN_TRANSIT]])(
    "refuses a staff member moving a %s order on, and writes nothing",
    async (from) => {
      const to = from === S.IN_TRANSIT ? S.FAILED : S.IN_TRANSIT;
      const h = setup(from, "ask");
      const e = await caught(h.svc.updateOrder(HOUSE, ORDER, { status: to }, { actorUserId: "staff-1" }));
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.message).toBe(MOVING_ON_NEEDS_THE_RIGHT);
      expect(h.log.filter((l) => l.startsWith("update"))).toEqual([]);
    },
  );

  it("refuses when nobody is named", async () => {
    const h = setup(S.APPROVED, "owner");
    const e = await caught(h.svc.updateOrder(HOUSE, ORDER, { status: S.CONFIRMED }));
    expect(e).toBeInstanceOf(ForbiddenException);
  });

  it.each([["owner"], ["manager"], ["grant"]] as Array<[Standing]>)(
    "lets %s mark an approved order as placed",
    async (who) => {
      const h = setup(S.APPROVED, who);
      await h.svc.updateOrder(HOUSE, ORDER, { status: S.CONFIRMED }, { actorUserId: "u" });
      expect(h.authority.standing).toHaveBeenCalledWith("u", HOUSE);
      expect(h.log).toContain("update status");
    },
  );

  it("leaves a move on an order not yet approved to the transition table alone", async () => {
    const h = setup(S.PENDING, "ask");
    await h.svc.updateOrder(HOUSE, ORDER, { status: S.NEGOTIATING }, { actorUserId: "staff-1" });
    expect(h.authority.standing).not.toHaveBeenCalled();
    expect(h.log).toContain("update status");
  });
});

describe("cancelOrder's own write is not an edit", () => {
  it("writes without the edit read or the closed filter", async () => {
    const h = setup(S.CONFIRMED, "ask");
    await h.svc.updateOrder(
      HOUSE,
      ORDER,
      { status: S.CANCELLED, rejectionReason: "r" },
      { statusTransitionAlreadyChecked: true, cancelReasonCode: "house_decision" as any },
    );
    expect(h.log).toEqual(["update status,rejection_reason,cancel_reason_code"]);
    expect(h.writeFilters.some((f) => f.startsWith("not"))).toBe(false);
  });
});

describe("PATCH /procurement/orders/:id names the editor", () => {
  it("passes the token's person to updateOrder", async () => {
    const updateOrder = jest.fn().mockResolvedValue({ id: "o" });
    const controller = new ProcurementController({ updateOrder } as unknown as ProcurementService);
    await controller.updateOrder("o", { managerNotes: "x" } as any, { userId: "u9", restaurantId: "h" });
    expect(updateOrder).toHaveBeenCalledWith("h", "o", { managerNotes: "x" }, { actorUserId: "u9" });
  });
});
