import { Test, TestingModule } from "@nestjs/testing";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { ProcurementOrderStatus } from "./dto/procurement.dto";
import { ORDER_CANCEL_ACT, ORDER_SEAL_ACT, orderSealArgs } from "./order-seal";
import { hashCallArgs, hashSealToken } from "../common/seal/seal-token";

/**
 * ADR 0125 — ending an order is a sealed act, and a refused one changes nothing.
 *
 * These cases drive the REAL `SealChallengeService` over an in-memory
 * `mcp_seal_challenges` table, the way `one-tap-execute.spec.ts` does, rather
 * than a stub that answers "sealed" — a stubbed seal proves the call was made,
 * not that the binding holds. The rows here are literally what
 * `issueOrderCancelSealChallenge` writes.
 *
 * WHAT WOULD HAVE PASSED BEFORE THIS PASS: none of it. `DELETE orders/:id` read
 * an id and an optional `?reason=`, and `cancelOrder` wrote CANCELLED from any
 * state, with no reason, no seal, and no audit row.
 */

type Row = Record<string, any>;

const HOUSE = "rest-A";
const MANAGER = "user-1";
const OTHER_MANAGER = "user-2";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";

interface Harness {
  service: ProcurementService;
  seals: Row[];
  audits: Row[];
  updates: Array<{ table: string; payload: Row }>;
  order: Row;
}

async function build(supabaseHolder: any): Promise<ProcurementService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProcurementService,
      { provide: DatabaseService, useValue: supabaseHolder },
      { provide: EventsService, useValue: { createEvent: jest.fn() } },
      {
        provide: InventoryLedgerService,
        useValue: { recordTransaction: jest.fn() },
      },
      {
        provide: OrchestratorService,
        useValue: { publishEvent: jest.fn(), triggerDraftHttp: jest.fn() },
      },
      { provide: SealChallengeService, useValue: new SealChallengeService(supabaseHolder) },
    ],
  }).compile();
  const svc = module.get<ProcurementService>(ProcurementService);
  jest.spyOn((svc as any).logger, "error").mockImplementation(() => {});
  jest.spyOn((svc as any).logger, "warn").mockImplementation(() => {});
  jest.spyOn((svc as any).logger, "log").mockImplementation(() => {});
  return svc;
}

/** Everything the harness needs, assembled the way the running path assembles it. */
async function makeService(
  orderSeed?: Row,
  seals: Row[] = [],
): Promise<Harness> {
  const audits: Row[] = [];
  const updates: Array<{ table: string; payload: Row }> = [];
  const order: Row = {
    id: ORDER_ID,
    status: ProcurementOrderStatus.APPROVED,
    total_cost: "2000.00",
    provider_id: "prov-1",
    inventory_id: null,
    quantity: 6,
    order_number: "PO-2026-0007",
    ...(orderSeed ?? {}),
  };

  const supabase: any = {
    from(table: string) {
      if (table === "system_audit_log") {
        return {
          insert: (row: Row) => {
            audits.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "mcp_seal_challenges") {
        const api: Record<string, unknown> = {};
        let tokenHash: string | null = null;
        let rowId: string | null = null;
        api.select = () => api;
        api.eq = (col: string, value: string) => {
          if (col === "token_hash") tokenHash = value;
          if (col === "id") rowId = value;
          return api;
        };
        api.maybeSingle = () =>
          Promise.resolve({
            data: seals.find((s) => s.token_hash === tokenHash) ?? null,
            error: null,
          });
        api.insert = (row: Row) => {
          seals.push({ id: `seal-${seals.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        };
        api.update = (patch: Row) => {
          const upd: Record<string, unknown> = {};
          let unspentOnly = false;
          upd.eq = (col: string, value: string) => {
            if (col === "id") rowId = value;
            return upd;
          };
          upd.is = (col: string, value: unknown) => {
            if (col === "redeemed_at" && value === null) unspentOnly = true;
            return upd;
          };
          upd.select = () => ({
            then: (resolve: (v: unknown) => unknown) => {
              const row = seals.find((s) => s.id === rowId);
              if (!row || (unspentOnly && row.redeemed_at)) {
                return Promise.resolve({ data: [], error: null }).then(resolve);
              }
              row.redeemed_at = String(patch.redeemed_at);
              return Promise.resolve({
                data: [{ id: row.id }],
                error: null,
              }).then(resolve);
            },
          });
          return upd;
        };
        return api;
      }

      const q: any = {
        select: () => q,
        insert: () => q,
        update: (payload: Row) => {
          // supabase-js drops `undefined` keys before they reach PostgREST, so
          // the harness has to as well — otherwise a PATCH that names no status
          // would look here like one that set the status to nothing.
          const sent: Row = Object.fromEntries(
            Object.entries(payload).filter(([, v]) => v !== undefined),
          );
          updates.push({ table, payload: sent });
          if (table === "procurement_orders") Object.assign(order, sent);
          return q;
        },
        eq: () => q,
        in: () => q,
        not: () => q,
        neq: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () =>
          table === "procurement_orders"
            ? { data: { ...order }, error: null }
            : { data: null, error: null },
        single: async () =>
          table === "procurement_orders"
            ? { data: { ...order }, error: null }
            : { data: null, error: null },
        then: (resolve: any, reject: any) =>
          Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return q;
    },
  };

  const db = { supabase, getClient: () => supabase } as any;
  const service = await build(db);
  return { service, seals, audits, updates, order };
}

/** Mint through the real service, and get the token back. */
async function mint(h: Harness, actor = MANAGER): Promise<string> {
  const issued = await h.service.issueOrderCancelSealChallenge(
    HOUSE,
    ORDER_ID,
    actor,
  );
  expect(issued.act).toBe(ORDER_CANCEL_ACT);
  return issued.challenge;
}

async function refusal(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (err: any) {
    return err;
  }
  throw new Error("expected a refusal, and the call succeeded");
}

describe("a cancellation has to say why", () => {
  it("refuses an empty reason, in words, before anything is read", async () => {
    const h = await makeService();
    const err = await refusal(() =>
      h.service.cancelOrder(HOUSE, ORDER_ID, MANAGER, "   ", "anything"),
    );
    expect(err.getStatus()).toBe(400);
    expect(String(err.message)).toMatch(/has to say why/);
    expect(String(err.message)).toMatch(/Nothing was changed/);
    expect(h.updates.filter((u) => u.table === "procurement_orders")).toHaveLength(
      0,
    );
  });

  it("refuses a missing reason the same way", async () => {
    const h = await makeService();
    const err = await refusal(() =>
      h.service.cancelOrder(HOUSE, ORDER_ID, MANAGER, undefined, "anything"),
    );
    expect(err.getStatus()).toBe(400);
    expect(h.order.status).toBe(ProcurementOrderStatus.APPROVED);
  });
});

describe("a cancellation redeems a seal, and a refused seal changes nothing", () => {
  it("accepts the seal this house minted, exactly once", async () => {
    const h = await makeService();
    const token = await mint(h);

    const cancelled = await h.service.cancelOrder(
      HOUSE,
      ORDER_ID,
      MANAGER,
      "Vendor cannot deliver before the weekend",
      token,
    );
    expect(cancelled.status).toBe(ProcurementOrderStatus.CANCELLED);
    expect(h.order.rejection_reason).toBe(
      "Vendor cannot deliver before the weekend",
    );
    expect(h.seals.filter((s) => s.redeemed_at)).toHaveLength(1);

    // A replay is a second cancellation, not a retry.
    const err = await refusal(() =>
      h.service.cancelOrder(HOUSE, ORDER_ID, MANAGER, "again", token),
    );
    expect(String(err.message)).toMatch(/already been spent|already cancelled/);
  });

  it("refuses a cancel with no seal at all, and writes nothing", async () => {
    const h = await makeService();
    const err = await refusal(() =>
      h.service.cancelOrder(HOUSE, ORDER_ID, MANAGER, "changed our mind", null),
    );
    expect(err.getStatus()).toBe(403);
    expect(String(err.message)).toMatch(/must be proven rather than asserted/);
    expect(h.order.status).toBe(ProcurementOrderStatus.APPROVED);
    expect(h.audits).toHaveLength(1); // the seal refusal itself, no order_cancelled
    expect(h.audits[0].action).toBe("seal_refused");
  });

  it("refuses an APPROVAL seal spent on a cancellation, naming the act", async () => {
    // Exactly what `issueOrderSealChallenge` writes, for the same order and the
    // same person — everything matches except the act.
    const token = "approval-token-for-this-order";
    const approvalSeal: Row = {
      id: "seal-approve",
      restaurant_id: HOUSE,
      subject_kind: "procurement_order",
      subject_id: ORDER_ID,
      actor_user_id: MANAGER,
      tool_name: ORDER_SEAL_ACT,
      args_hash: hashCallArgs(
        orderSealArgs({ id: ORDER_ID, total: "2000.00", providerId: "prov-1" }),
      ),
      token_hash: hashSealToken(token),
      redeemed_at: null,
      expires_at: new Date(Date.now() + 120_000).toISOString(),
    };
    const h = await makeService(undefined, [approvalSeal]);

    const err = await refusal(() =>
      h.service.cancelOrder(HOUSE, ORDER_ID, MANAGER, "not needed", token),
    );
    expect(err.getStatus()).toBe(403);
    expect(String(err.message)).toMatch(/different act on this order/);
    expect(h.order.status).toBe(ProcurementOrderStatus.APPROVED);
    // And the approval seal is left unspent — a refused act burns nothing.
    expect(approvalSeal.redeemed_at).toBeNull();
  });

  it("refuses another person's cancellation seal", async () => {
    const h = await makeService();
    const token = await mint(h, OTHER_MANAGER);
    const err = await refusal(() =>
      h.service.cancelOrder(HOUSE, ORDER_ID, MANAGER, "mine now", token),
    );
    expect(err.getStatus()).toBe(403);
    expect(String(err.message)).toMatch(/issued to somebody else/);
    expect(h.order.status).toBe(ProcurementOrderStatus.APPROVED);
  });

  it("refuses a seal minted before the order's total changed", async () => {
    const h = await makeService();
    const token = await mint(h);
    h.order.total_cost = "20000.00";
    const err = await refusal(() =>
      h.service.cancelOrder(HOUSE, ORDER_ID, MANAGER, "too expensive", token),
    );
    expect(err.getStatus()).toBe(403);
    expect(String(err.message)).toMatch(/changed after the seal was issued/);
    expect(h.order.status).toBe(ProcurementOrderStatus.APPROVED);
  });

  it("refuses a seal minted before the wine arrived", async () => {
    // The property an approval's seal cannot express: between the hold and the
    // write, the answer to "may this be cancelled" changed from yes to no.
    const h = await makeService();
    const token = await mint(h);
    h.order.status = ProcurementOrderStatus.DELIVERED;
    const err = await refusal(() =>
      h.service.cancelOrder(HOUSE, ORDER_ID, MANAGER, "too late", token),
    );
    // The transition check runs first and refuses with the louder sentence.
    expect(err.getStatus()).toBe(422);
    expect(String(err.message?.message ?? err.message)).toMatch(
      /counted into stock/,
    );
    expect(h.order.status).toBe(ProcurementOrderStatus.DELIVERED);
  });
});

describe("the state machine refuses before a seal is even minted", () => {
  it("will not mint a seal for a delivered order", async () => {
    const h = await makeService({ status: ProcurementOrderStatus.DELIVERED });
    const err = await refusal(() =>
      h.service.issueOrderCancelSealChallenge(HOUSE, ORDER_ID, MANAGER),
    );
    expect(err.getStatus()).toBe(422);
    expect(h.seals).toHaveLength(0);
  });

  it("will not mint a seal for an order already cancelled", async () => {
    const h = await makeService({ status: ProcurementOrderStatus.CANCELLED });
    const err = await refusal(() =>
      h.service.issueOrderCancelSealChallenge(HOUSE, ORDER_ID, MANAGER),
    );
    expect(err.getStatus()).toBe(422);
    expect(String(err.message?.message ?? err.message)).toMatch(
      /already cancelled/,
    );
    expect(h.seals).toHaveLength(0);
  });
});

describe("a cancellation leaves paper", () => {
  it("files order_cancelled naming the actor, the state left and the reason", async () => {
    const h = await makeService();
    const token = await mint(h);
    await h.service.cancelOrder(
      HOUSE,
      ORDER_ID,
      MANAGER,
      "Wine is corked across the whole lot",
      token,
    );

    const row = h.audits.find((a) => a.action === "order_cancelled");
    expect(row).toBeTruthy();
    expect(row!.actor_id).toBe(MANAGER);
    expect(row!.actor_type).toBe("user");
    expect(row!.entity_type).toBe("procurement_order");
    expect(row!.entity_id).toBe(ORDER_ID);
    expect(row!.restaurant_id).toBe(HOUSE);
    expect(row!.reason).toBe("Wine is corked across the whole lot");
    expect(row!.changes.from).toBe(ProcurementOrderStatus.APPROVED);
    expect(row!.changes.to).toBe(ProcurementOrderStatus.CANCELLED);
    expect(row!.changes.act).toBe(ORDER_CANCEL_ACT);
    expect(row!.changes.sealed).toBe(true);
  });
});

describe("a cancelled order does not email its vendor", () => {
  it("cascades AUTO_SEND_SCHEDULED as well as PENDING_APPROVAL", async () => {
    const h = await makeService();
    const token = await mint(h);
    await h.service.cancelOrder(HOUSE, ORDER_ID, MANAGER, "no longer needed", token);

    const cascade = h.updates.find(
      (u) => u.table === "procurement_conversations",
    );
    expect(cascade).toBeTruthy();
    expect(cascade!.payload.status).toBe("CANCELLED");
    // The staged send time is cleared too, so nothing is left due.
    expect(cascade!.payload.scheduled_send_at).toBeNull();
  });
});

describe("the PATCH route is held to the same table", () => {
  it("refuses a status this house does not allow from here", async () => {
    const h = await makeService({ status: ProcurementOrderStatus.DELIVERED });
    const err = await refusal(() =>
      h.service.updateOrder(HOUSE, ORDER_ID, {
        status: ProcurementOrderStatus.PENDING,
      } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(String(err.message?.message ?? err.message)).toMatch(
      /cannot be moved to pending/,
    );
  });

  it("still allows a move the house makes today", async () => {
    const h = await makeService({ status: ProcurementOrderStatus.APPROVED });
    await h.service.updateOrder(HOUSE, ORDER_ID, {
      status: ProcurementOrderStatus.CONFIRMED,
    } as any);
    expect(h.order.status).toBe(ProcurementOrderStatus.CONFIRMED);
  });

  it("leaves a PATCH that carries no status alone", async () => {
    const h = await makeService();
    await h.service.updateOrder(HOUSE, ORDER_ID, {
      managerNotes: "call the rep",
    } as any);
    expect(h.order.status).toBe(ProcurementOrderStatus.APPROVED);
    expect(h.order.manager_notes).toBe("call the rep");
  });
});
