import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { OneTapActionsService } from "./one-tap-actions.service";

/**
 * The first real one-tap action, and the three things that must be true of it.
 *
 *   1. PROVEN, THEN DONE, THEN RECORDED — in that order. The old code recorded
 *      first and called a `// TODO` log second, so the row said the house had
 *      confirmed a delivery it had not.
 *   2. AN UNBUILT ACT WRITES NOTHING. Not a completed row, not an execution
 *      result, not a stamp. ADR 0083.
 *   3. A WRITTEN NOTE IS A RECORD AND SAYS SO. It never reaches procurement and
 *      never asks for a seal.
 *
 * Every case here counts calls rather than trusting a return value, because the
 * fault being closed was precisely a method that returned success without
 * having called anything.
 */

type Row = Record<string, unknown>;

interface Harness {
  service: OneTapActionsService;
  /** Tables that received an UPDATE, in order. */
  updates: Array<{ table: string; payload: Row }>;
  /** Every filter each query applied, in order. */
  reads: Array<{ table: string; filters: Record<string, unknown> }>;
  calls: string[];
  redeemArgs: Array<Record<string, unknown>>;
  issueArgs: Array<Record<string, unknown>>;
}

function harness(options: {
  action: Row | null;
  order?: Row | null;
  orderError?: { message: string } | null;
  redeemThrows?: Error;
  deliverThrows?: Error;
  updateError?: { message: string } | null;
}): Harness {
  const updates: Harness["updates"] = [];
  const reads: Harness["reads"] = [];
  const calls: string[] = [];
  const redeemArgs: Array<Record<string, unknown>> = [];
  const issueArgs: Array<Record<string, unknown>> = [];

  const client: any = {
    from(table: string) {
      const entry = { table, filters: {} as Record<string, unknown> };
      reads.push(entry);
      let updatePayload: Row | null = null;
      const q: any = {
        select: () => q,
        insert: () => q,
        update: (payload: Row) => {
          updatePayload = payload;
          updates.push({ table, payload });
          return q;
        },
        is: (c: string, v: unknown) => ((entry.filters[c] = v), q),
        eq: (c: string, v: unknown) => ((entry.filters[c] = v), q),
        order: () => q,
        maybeSingle: async () => {
          if (table === "procurement_orders") {
            if (options.orderError) return { data: null, error: options.orderError };
            return { data: options.order ?? null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === "one_tap_actions" && updatePayload) {
            if (options.updateError)
              return { data: null, error: options.updateError };
            return {
              data: { ...(options.action as Row), ...updatePayload },
              error: null,
            };
          }
          const wanted = entry.filters["restaurant_id"];
          const row = options.action;
          if (wanted != null && row && row.restaurant_id !== wanted)
            return { data: null, error: { message: "no rows" } };
          return row
            ? { data: row, error: null }
            : { data: null, error: { message: "no rows" } };
        },
      };
      return q;
    },
  };

  const db = { getClient: () => client, supabase: client } as any;
  const ws = { server: null } as any;

  const procurement = {
    markDelivered: async (
      restaurantId: string,
      orderId: string,
      userId: string,
    ) => {
      calls.push(`markDelivered(${restaurantId},${orderId},${userId})`);
      if (options.deliverThrows) throw options.deliverThrows;
      return {
        id: orderId,
        orderNumber: "PO-2026-0007",
        status: "DELIVERED",
        quantity: 12,
        bottlesTotal: 72,
      } as any;
    },
  } as any;

  const seals = {
    issue: async (p: Record<string, unknown>) => {
      calls.push("issue");
      issueArgs.push(p);
      return { challenge: "seal-token", expiresAt: "2026-09-05T00:02:00.000Z", action: p.action };
    },
    redeem: async (p: Record<string, unknown>) => {
      calls.push("redeem");
      redeemArgs.push(p);
      if (options.redeemThrows) throw options.redeemThrows;
    },
  } as any;

  return {
    service: new OneTapActionsService(db, ws, procurement, seals),
    updates,
    reads,
    calls,
    redeemArgs,
    issueArgs,
  };
}

const DELIVERY_CARD = {
  id: "act-1",
  restaurant_id: "rest-A",
  user_id: null,
  action_type: "delivery_confirm",
  title: "Confirm the Barolo delivery",
  status: "pending",
  priority: "high",
  related_order_id: "ord-9",
  created_at: new Date().toISOString(),
};

const ORDER = {
  id: "ord-9",
  restaurant_id: "rest-A",
  status: "APPROVED",
  quantity: 12,
  bottles_total: 72,
};

describe("the first real one-tap action — confirming a delivery", () => {
  it("redeems the seal BEFORE the delivery, and records only after both", async () => {
    const h = harness({ action: DELIVERY_CARD, order: ORDER });

    await h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token");

    expect(h.calls).toEqual(["redeem", "markDelivered(rest-A,ord-9,user-1)"]);
    // The record is written after both, never before.
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].table).toBe("one_tap_actions");
  });

  it("binds the seal to this order, this act and the stock about to move", async () => {
    const h = harness({ action: DELIVERY_CARD, order: ORDER });

    await h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token");

    expect(h.redeemArgs[0]).toMatchObject({
      restaurantId: "rest-A",
      actorUserId: "user-1",
      subjectKind: "procurement_order",
      subjectId: "ord-9",
      action: "deliver",
      challenge: "seal-token",
    });
    expect(h.redeemArgs[0].args).toEqual({
      actionId: "act-1",
      orderId: "ord-9",
      quantity: "12",
      bottlesTotal: "72",
      status: "APPROVED",
    });
  });

  it("books nothing and records nothing when the seal is refused", async () => {
    const h = harness({
      action: DELIVERY_CARD,
      order: ORDER,
      redeemThrows: new ForbiddenException("That seal has already been spent."),
    });

    await expect(
      h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "spent"),
    ).rejects.toThrow(/already been spent/);

    expect(h.calls).toEqual(["redeem"]);
    expect(h.updates).toHaveLength(0);
  });

  it("records what the gateway actually did, with explicit keys", async () => {
    const h = harness({ action: DELIVERY_CARD, order: ORDER });

    await h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token");

    const result = h.updates[0].payload.execution_result as Record<string, unknown>;
    expect(result).toMatchObject({
      act: "deliver",
      orderId: "ord-9",
      orderNumber: "PO-2026-0007",
      status: "DELIVERED",
      quantityBooked: 12,
      bottlesBooked: 72,
      sealed: true,
    });
    expect(typeof result.ranAt).toBe("string");
    expect(h.updates[0].payload.executed_by).toBe("user-1");
  });

  it("does not record a delivery that threw", async () => {
    const h = harness({
      action: DELIVERY_CARD,
      order: ORDER,
      deliverThrows: new Error("ledger refused"),
    });

    await expect(
      h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token"),
    ).rejects.toThrow(/ledger refused/);
    expect(h.updates).toHaveLength(0);
  });

  it("refuses an order already booked in, rather than doubling the stock", async () => {
    const h = harness({
      action: DELIVERY_CARD,
      order: { ...ORDER, status: "DELIVERED" },
    });

    await expect(
      h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token"),
    ).rejects.toThrow(/already booked in as delivered/);
    expect(h.calls).toEqual([]);
    expect(h.updates).toHaveLength(0);
  });

  it("refuses a delivery card that names no order", async () => {
    const h = harness({
      action: { ...DELIVERY_CARD, related_order_id: null },
      order: ORDER,
    });

    await expect(
      h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token"),
    ).rejects.toThrow(/names no order/);
    expect(h.updates).toHaveLength(0);
  });

  it("reads the order scoped to the caller's house", async () => {
    const h = harness({ action: DELIVERY_CARD, order: ORDER });

    await h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token");

    const orderRead = h.reads.find((r) => r.table === "procurement_orders");
    expect(orderRead?.filters).toMatchObject({
      id: "ord-9",
      restaurant_id: "rest-A",
    });
  });

  it("raises a failed order read instead of calling it a missing order", async () => {
    // supabase-js resolves { data, error }; treating the error branch as
    // "not found" would tell a manager their order is gone when the database
    // was merely unreachable.
    const h = harness({
      action: DELIVERY_CARD,
      order: null,
      orderError: { message: "connection reset" },
    });

    await expect(
      h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token"),
    ).rejects.toThrow(/could not be read, so nothing was changed: connection reset/);
    expect(h.updates).toHaveLength(0);
  });
});

describe("the acts that are not built", () => {
  const unbuilt = [
    ["low_stock", /negotiation with the vendor/],
    ["price_change", /no route in this house writes a purchase price/],
    ["stock_receipt", /receiving step/],
    ["gmail_send", /cannot be recalled/],
    ["inequality", /not built/],
    ["vintage_sub", /not built/],
  ] as const;

  it.each(unbuilt)("refuses %s with a sentence and writes nothing", async (type, words) => {
    const h = harness({ action: { ...DELIVERY_CARD, action_type: type } });

    await expect(
      h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token"),
    ).rejects.toThrow(words);
    await expect(
      h.service.executeAction("act-1", "rest-A", "user-1", {} as any, "seal-token"),
    ).rejects.toThrow(BadRequestException);

    expect(h.calls).toEqual([]);
    expect(h.updates).toHaveLength(0);
  });

  it("refuses an action type nothing declares", async () => {
    const h = harness({ action: { ...DELIVERY_CARD, action_type: "teleport" } });

    await expect(
      h.service.executeAction("act-1", "rest-A", "user-1", {} as any, null),
    ).rejects.toThrow(/does not recognise the act "teleport"/);
    expect(h.updates).toHaveLength(0);
  });

  it("will not mint a seal for an act that does not exist", async () => {
    const h = harness({ action: { ...DELIVERY_CARD, action_type: "low_stock" } });

    await expect(
      h.service.issueExecutionSeal("act-1", "rest-A", "user-1"),
    ).rejects.toThrow(/negotiation with the vendor/);
    expect(h.calls).toEqual([]);
  });
});

describe("a written action is a record", () => {
  const NOTE = {
    ...DELIVERY_CARD,
    id: "act-2",
    action_type: "custom",
    user_id: "user-1",
    related_order_id: null,
    title: "Call the cellar about Thursday",
  };

  it("records it without a seal and without touching procurement", async () => {
    const h = harness({ action: NOTE });

    await h.service.executeAction("act-2", "rest-A", "user-1", {} as any, null);

    expect(h.calls).toEqual([]);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].payload.execution_result).toMatchObject({
      act: "record",
      sealed: false,
    });
  });

  it("says in the row that no workflow ran, rather than leaving it blank", async () => {
    const h = harness({ action: NOTE });

    await h.service.executeAction("act-2", "rest-A", "user-1", {} as any, null);

    const result = h.updates[0].payload.execution_result as Record<string, unknown>;
    expect(String(result.note)).toMatch(/No workflow runs for a written action/);
  });

  it("refuses to mint a seal for it — there is nothing to prove", async () => {
    const h = harness({ action: NOTE });

    await expect(
      h.service.issueExecutionSeal("act-2", "rest-A", "user-1"),
    ).rejects.toThrow(/note, not a workflow/);
  });
});

describe("minting the seal", () => {
  it("issues one bound to the order, the act and the stock", async () => {
    const h = harness({ action: DELIVERY_CARD, order: ORDER });

    const issued = await h.service.issueExecutionSeal("act-1", "rest-A", "user-1");

    expect(issued).toMatchObject({ challenge: "seal-token", act: "deliver" });
    expect(h.issueArgs[0]).toMatchObject({
      subjectKind: "procurement_order",
      subjectId: "ord-9",
      action: "deliver",
      actorUserId: "user-1",
    });
  });

  it("refuses to mint for an action that is no longer pending", async () => {
    const h = harness({
      action: { ...DELIVERY_CARD, status: "completed" },
      order: ORDER,
    });

    await expect(
      h.service.issueExecutionSeal("act-1", "rest-A", "user-1"),
    ).rejects.toThrow(/already completed/);
    expect(h.calls).toEqual([]);
  });
});

/**
 * ===========================================================================
 * THE ACT, PROVEN AGAINST THE REAL SealChallengeService
 * ===========================================================================
 * Every case above mocks `redeem`, so they prove that the one-tap path CALLS
 * the seal with the right binding — and nothing about whether the seal would
 * actually refuse an order-approval token presented to the delivery write.
 * ADR 0116's addendum claims exactly that ("an order seal minted for `approve`
 * cannot be spent here"), and the claim was resting on a generic case in
 * `common/seal/seal-challenge.service.spec.ts:213-215` that uses `cancel`.
 *
 * So these two drive the REAL service over an in-memory `mcp_seal_challenges`
 * table, the way that suite does, and the approval seal is a GENUINE one: it
 * carries `orderSealArgs(...)` from `procurement/order-seal.ts`, which is what
 * `ProcurementService.issueOrderSealChallenge` mints, rather than a token
 * hand-shaped to fail.
 *
 * The mirror matters as much as the refusal. A test that only proves "the
 * wrong seal is refused" passes just as well against a path that refuses
 * everything, which would be a delivery control that never works.
 */

import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { hashCallArgs, hashSealToken } from "../common/seal/seal-token";
import { ORDER_SEAL_ACT, orderSealArgs } from "../procurement/order-seal";

const HOUSE = "rest-A";
const MANAGER = "user-1";
const ORDER_ID = "ord-9";

interface SealedHarness {
  service: OneTapActionsService;
  seals: Row[];
  audits: Row[];
  updates: Array<{ table: string; payload: Row }>;
  calls: string[];
}

/**
 * The same three tables the running path touches, in memory: the card, the
 * order, and the seal ledger (plus the audit log the refusal is filed in).
 * `mcp_seal_challenges` is modelled the way `seal-challenge.service.spec.ts`
 * models it, so single-use stays a property of the UPDATE's own
 * `redeemed_at IS NULL` filter rather than of anything in TypeScript.
 */
function sealedHarness(seed: Row[] = [], action: Row = DELIVERY_CARD): SealedHarness {
  const seals = seed;
  const audits: Row[] = [];
  const updates: Array<{ table: string; payload: Row }> = [];
  const calls: string[] = [];

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
              return Promise.resolve({ data: [{ id: row.id }], error: null }).then(resolve);
            },
          });
          return upd;
        };
        return api;
      }

      const entry: Record<string, unknown> = {};
      let updatePayload: Row | null = null;
      const q: any = {
        select: () => q,
        insert: () => q,
        update: (payload: Row) => {
          updatePayload = payload;
          updates.push({ table, payload });
          return q;
        },
        is: (c: string, v: unknown) => ((entry[c] = v), q),
        eq: (c: string, v: unknown) => ((entry[c] = v), q),
        order: () => q,
        maybeSingle: async () =>
          table === "procurement_orders"
            ? { data: ORDER, error: null }
            : { data: null, error: null },
        single: async () =>
          updatePayload
            ? { data: { ...action, ...updatePayload }, error: null }
            : { data: action, error: null },
      };
      return q;
    },
  };

  const db = { getClient: () => supabase, supabase } as any;
  const procurement = {
    markDelivered: async (r: string, o: string, u: string) => {
      calls.push(`markDelivered(${r},${o},${u})`);
      return {
        id: o,
        orderNumber: "PO-2026-0007",
        status: "DELIVERED",
        quantity: 12,
        bottlesTotal: 72,
      } as any;
    },
  } as any;

  return {
    service: new OneTapActionsService(
      db,
      { server: null } as any,
      procurement,
      new SealChallengeService(db),
    ),
    seals,
    audits,
    updates,
    calls,
  };
}

describe("an order's APPROVE seal cannot be spent on a delivery", () => {
  /** Exactly what `ProcurementService.issueOrderSealChallenge` writes. */
  function approvalSeal(): Row {
    return {
      id: "seal-approve",
      subject_kind: "procurement_order",
      subject_id: ORDER_ID,
      restaurant_id: HOUSE,
      actor_user_id: MANAGER,
      tool_name: ORDER_SEAL_ACT,
      args_hash: hashCallArgs(
        orderSealArgs({ id: ORDER_ID, total: "2000.00", providerId: "anadolu" }),
      ),
      token_hash: hashSealToken("approve-token"),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      redeemed_at: null,
    };
  }

  it("is the approve act, so this is not a straw seal", () => {
    // If ORDER_SEAL_ACT ever became "deliver", the case below would be
    // asserting nothing at all.
    expect(ORDER_SEAL_ACT).toBe("approve");
    expect(approvalSeal().tool_name).not.toBe("deliver");
  });

  it("refuses it with the act-mismatch sentence, and books nothing", async () => {
    const h = sealedHarness([approvalSeal()]);

    await expect(
      h.service.executeAction("act-1", HOUSE, MANAGER, {} as any, "approve-token"),
    ).rejects.toThrow(
      /That seal was issued for a different act on this order\. A seal approves one act, not a session — nothing was changed\./,
    );

    expect(h.calls).toEqual([]); // markDelivered never ran
    expect(h.updates).toHaveLength(0); // and nothing was recorded
    expect(h.seals[0].redeemed_at).toBeNull(); // the approval seal is still good
  });

  it("throws a 403 naming the ACT — a refusal is not a server fault, and not a vague one", async () => {
    // Both halves are load-bearing. Asserting only ForbiddenException would
    // pass against a service with no act check at all: the args hash differs
    // too, so a 403 still arrives — carrying "this order changed after the
    // seal was issued", which is a false account of what happened.
    const h = sealedHarness([approvalSeal()]);
    const err = await h.service
      .executeAction("act-1", HOUSE, MANAGER, {} as any, "approve-token")
      .then(() => null)
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String(err.message)).toMatch(/different act on this order/);
    expect(String(err.message)).not.toMatch(/changed after the seal was issued/);
  });

  it("files the refusal before throwing it", async () => {
    const h = sealedHarness([approvalSeal()]);
    await h.service
      .executeAction("act-1", HOUSE, MANAGER, {} as any, "approve-token")
      .catch(() => undefined);

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: "seal_refused",
      entity_type: "procurement_order",
      entity_id: ORDER_ID,
      restaurant_id: HOUSE,
    });
    expect((h.audits[0].changes as Row).refusal).toBe("other_action");
    expect((h.audits[0].changes as Row).act).toBe("deliver");
  });

  it("MIRROR — the seal this path mints IS accepted, and is spent exactly once", async () => {
    const h = sealedHarness([]);

    const issued = await h.service.issueExecutionSeal("act-1", HOUSE, MANAGER);
    expect(issued.act).toBe("deliver");
    expect(h.seals).toHaveLength(1);
    expect(h.seals[0].tool_name).toBe("deliver");
    // The token is never stored: only its digest is.
    expect(h.seals[0].token_hash).toBe(hashSealToken(issued.challenge));
    expect(Object.values(h.seals[0])).not.toContain(issued.challenge);

    await h.service.executeAction("act-1", HOUSE, MANAGER, {} as any, issued.challenge);

    expect(h.calls).toEqual([`markDelivered(${HOUSE},${ORDER_ID},${MANAGER})`]);
    expect(h.updates).toHaveLength(1);
    expect((h.updates[0].payload.execution_result as Row).sealed).toBe(true);
    expect(h.seals[0].redeemed_at).not.toBeNull();
    expect(h.audits).toHaveLength(0);

    // And a replay of the same token books nothing a second time.
    await expect(
      h.service.executeAction("act-1", HOUSE, MANAGER, {} as any, issued.challenge),
    ).rejects.toThrow(/already been spent/);
    expect(h.calls).toHaveLength(1);
  });
});
