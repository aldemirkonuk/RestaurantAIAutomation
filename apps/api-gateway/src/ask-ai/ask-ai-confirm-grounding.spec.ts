import { AskAiService } from "./ask-ai.service";
import { DatabaseService } from "../database/database.service";
import { ProcurementService } from "../procurement/procurement.service";

/**
 * The confirm gate re-grounds EVERY payload, not just edited ones.
 *
 * This behaviour was documented before it was true. `confirm()` said grounding
 * is "re-derived from the CURRENT candidate set", but the whole re-validation
 * sat inside `if (editedPayload)`, so an untouched confirm executed whatever was
 * stored at propose time with no check at all.
 *
 * That matters because a proposal is not short-lived. It survives a reload, it
 * sits in the open list until somebody acts on it, and "untouched" therefore
 * routinely means days old — long enough for the vendor to be deactivated. The
 * executor does not save us: `createOrder` checks the restaurant has SOME active
 * provider, never that it has THIS one.
 *
 * Not a tenant break — the stored payload was grounded to this tenant when it
 * was written — but a stale reference on the path that creates purchase orders.
 */

type Row = Record<string, any>;

const INV = "11111111-1111-4111-8111-111111111111";
const PROV = "22222222-2222-4222-8222-222222222222";
const DEAD_PROV = "99999999-9999-4999-8999-999999999999";
const ORDER = "33333333-3333-4333-8333-333333333333";

/** The stored proposal, pointing at a vendor that was active when it was made. */
function storedRow(providerId: string): Row {
  return {
    id: "act-1",
    restaurant_id: "r1",
    family: "procurement",
    action_type: "reorder",
    payload: { inventoryId: INV, providerId, quantity: 6 },
    nf_event_id: null,
  };
}

function makeClient(
  row: Row | null,
  candidates: { providers: Row[] },
  opts: { failLookup?: string } = {},
) {
  const updates: Row[] = [];
  const client = {
    from(table: string) {
      const filters: Array<[string, any]> = [];
      const api: any = {
        _update: null as Row | null,
        select: () => api,
        eq: (col: string, val: any) => {
          filters.push([col, val]);
          return api;
        },
        not: () => api,
        order: () => api,
        limit: async (_n: number) => {
          // The targeted existence lookups an untouched confirm now makes.
          if (opts.failLookup === table) {
            return { data: null, error: { message: "boom" } };
          }
          const id = filters.find(([c]) => c === "id")?.[1];
          if (table === "restaurant_inventory") {
            return { data: id === INV ? [{ id }] : [], error: null };
          }
          if (table === "providers") {
            return {
              data: candidates.providers.some((p) => p.id === id)
                ? [{ id }]
                : [],
              error: null,
            };
          }
          if (table === "procurement_orders") {
            return { data: id === ORDER ? [{ id }] : [], error: null };
          }
          return { data: [], error: null };
        },
        update(patch: Row) {
          api._update = patch;
          updates.push({ table, ...patch });
          return api;
        },
        maybeSingle: async () => ({ data: row, error: null }),
        single: async () => ({ data: row, error: null }),
        then(resolve: any) {
          if (table === "restaurant_inventory") {
            resolve({ data: [{ id: INV, wine_name: "Barolo" }], error: null });
          } else if (table === "providers") {
            resolve({ data: candidates.providers, error: null });
          } else if (table === "procurement_orders") {
            resolve({ data: [], error: null });
          } else {
            resolve({ data: row, error: null });
          }
        },
      };
      return api;
    },
  };
  return { client, updates };
}

function makeService(client: any, procurement: any): AskAiService {
  return new AskAiService(
    { getClient: () => client } as unknown as DatabaseService,
    {} as any,
    {} as any,
    { record: () => {}, recordForEvent: () => {} } as any,
    procurement as unknown as ProcurementService,
  );
}

describe("AskAiService.confirm — grounding is not conditional on an edit", () => {
  it("executes an untouched confirm whose ids are still real", async () => {
    const { client } = makeClient(storedRow(PROV), {
      providers: [{ id: PROV, name: "Acme" }],
    });
    const createOrder = jest.fn().mockResolvedValue({ id: "order-9" });
    const service = makeService(client, { createOrder });

    const res = await service.confirm("r1", "u1", "act-1");

    expect(createOrder).toHaveBeenCalledTimes(1);
    // No payload was supplied, so the ledger must NOT record a human edit.
    expect(res).toMatchObject({ executed: true, edited: false });
  });

  it("REFUSES an untouched confirm whose vendor has since gone inactive", async () => {
    // The provider no longer comes back from a direct, is_active-filtered
    // lookup — it was deactivated after the proposal was made.
    const { client, updates } = makeClient(storedRow(DEAD_PROV), {
      providers: [{ id: PROV, name: "Acme" }],
    });
    const createOrder = jest.fn().mockResolvedValue({ id: "order-9" });
    const service = makeService(client, { createOrder });

    await expect(service.confirm("r1", "u1", "act-1")).rejects.toThrow(
      /vendor this refers to is no longer available/,
    );

    // Nothing ran...
    expect(createOrder).not.toHaveBeenCalled();
    // ...and the row was rolled back to `proposed` rather than stranded at
    // `confirmed` with no execution behind it.
    const rolledBack = updates.filter((u) => u.status === "proposed");
    expect(rolledBack).toHaveLength(1);
    expect(rolledBack[0]).toMatchObject({
      confirmed_by: null,
      confirmed_at: null,
    });
  });

  it("rolls the claim back when the re-check itself fails, not just when it says no", async () => {
    // The checks throw a 503 on a failed query, by design. That throw used to
    // escape past the rollback and strand the row at `confirmed`, where neither
    // `confirm` nor `discard` can reach it — a transient blip losing a proposal
    // permanently.
    const { client, updates } = makeClient(
      storedRow(PROV),
      { providers: [{ id: PROV, name: "Acme" }] },
      { failLookup: "restaurant_inventory" },
    );
    const createOrder = jest.fn();
    const service = makeService(client, { createOrder });

    await expect(service.confirm("r1", "u1", "act-1")).rejects.toThrow(
      /Could not confirm that action/,
    );

    expect(createOrder).not.toHaveBeenCalled();
    const rolledBack = updates.filter((u) => u.status === "proposed");
    expect(rolledBack).toHaveLength(1);
  });

  it("confirms an untouched vendor_draft whose order sits OUTSIDE the prompt cap", async () => {
    // The regression this replaced: grounding an untouched confirm against the
    // candidate set imposed the prompt's 20-order cap on it. Orders are ordered
    // `created_at desc` and capped, so a perfectly live order aged out of the
    // window as newer ones arrived, and its confirm started failing with "I
    // could not find that" — which was false. The cap keeps the PROMPT small;
    // it has no business in a question about one known id.
    //
    // Here the candidate lists are EMPTY — the id is nowhere near the window —
    // and the confirm must still go through, because the order exists.
    const { client } = makeClient(
      {
        id: "act-2",
        restaurant_id: "r1",
        family: "communications",
        action_type: "vendor_draft",
        payload: { orderId: ORDER, instruction: "Chase the delivery." },
        nf_event_id: null,
      },
      { providers: [] },
    );
    const generateAiReply = jest
      .fn()
      .mockResolvedValue({ triggered: true, draftId: "draft-3" });
    const service = makeService(client, { generateAiReply });

    const res = await service.confirm("r1", "u1", "act-2");

    expect(generateAiReply).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ executed: true, edited: false });
  });
});
