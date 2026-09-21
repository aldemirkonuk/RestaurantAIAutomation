import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { AskAiService, PROPOSAL_SEAL_ACT } from "./ask-ai.service";
import { AskAiController } from "./ask-ai.controller";
import { DatabaseService } from "../database/database.service";
import { ProcurementService } from "../procurement/procurement.service";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { SEAL_SUBJECT_KINDS, subjectNoun } from "../common/seal/seal-subject";

/**
 * A proposal is applied only by the seal (the founder's pick of 2026-09-21,
 * sketch 119 D: the house counter holds "Mudavym proposes", and a proposal is
 * applied only by the seal).
 *
 * The unit under test is `AskAiService.issueProposalSeal` / `confirmSealed`,
 * real. The seal service is a recording collaborator (its own suite,
 * seal-challenge.service.spec.ts, pins issue/redeem), the database a
 * supabase-js-shaped fake. Each case is a way a sealed apply could be weaker
 * than the order seal it copies:
 *
 *   1. minting for a proposal in another house, or one already handled;
 *   2. binding the seal to anything but the proposal's stored arguments;
 *   3. writing before the seal is redeemed, or despite a refused redemption;
 *   4. applying with no seal service wired at all;
 *   5. letting a role below owner/manager reach either route.
 */

type Row = Record<string, any>;
const INV = "11111111-1111-4111-8111-111111111111";
const PROV = "22222222-2222-4222-8222-222222222222";

function proposal(over: Row = {}): Row {
  return {
    id: "act-1",
    restaurant_id: "r1",
    family: "procurement",
    action_type: "reorder",
    payload: { inventoryId: INV, providerId: PROV, quantity: 6 },
    status: "proposed",
    nf_event_id: null,
    ...over,
  };
}

function makeClient(row: Row | null) {
  const writes: Row[] = [];
  const client = {
    from(table: string) {
      const filters: Array<[string, any]> = [];
      let updating: Row | null = null;
      const api: any = {
        select: () => api,
        eq: (col: string, val: any) => {
          filters.push([col, val]);
          return api;
        },
        not: () => api,
        order: () => api,
        limit: async () => {
          const id = filters.find(([c]) => c === "id")?.[1];
          if (table === "restaurant_inventory")
            return { data: id === INV ? [{ id }] : [], error: null };
          if (table === "providers")
            return { data: id === PROV ? [{ id }] : [], error: null };
          return { data: [], error: null };
        },
        update(patch: Row) {
          updating = patch;
          writes.push({ table, ...patch });
          return api;
        },
        maybeSingle: async () => {
          if (table !== "ai_proposed_actions" || !row)
            return { data: null, error: null };
          const byId = filters.find(([c]) => c === "id")?.[1];
          const house = filters.find(([c]) => c === "restaurant_id")?.[1];
          if (byId !== row.id || house !== row.restaurant_id)
            return { data: null, error: null };
          if (updating) return { data: { ...row, ...updating }, error: null };
          return { data: row, error: null };
        },
        then(resolve: any) {
          resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
  return { client, writes };
}

function makeSeals(opts: { refuse?: boolean } = {}) {
  const calls: Array<{ op: string; params: any }> = [];
  return {
    calls,
    issue: jest.fn(async (params: any) => {
      calls.push({ op: "issue", params });
      return {
        challenge: "seal-token",
        expiresAt: "2026-09-21T14:04:11Z",
        action: params.action,
      };
    }),
    redeem: jest.fn(async (params: any) => {
      calls.push({ op: "redeem", params });
      if (opts.refuse) {
        throw new ForbiddenException("That seal has already been spent.");
      }
      return { sealId: "seal-1" };
    }),
  };
}

function makeService(client: any, procurement: any, seals?: any) {
  return new AskAiService(
    { getClient: () => client } as unknown as DatabaseService,
    {} as any,
    {} as any,
    { record: () => {}, recordForEvent: () => {} } as any,
    procurement as unknown as ProcurementService,
    seals,
  );
}

describe("minting a proposal's seal", () => {
  it("binds the seal to this person, this proposal, the act `apply` and the STORED arguments", async () => {
    const seals = makeSeals();
    const { client } = makeClient(proposal());
    const svc = makeService(client, {}, seals);
    const res = await svc.issueProposalSeal("r1", "u1", "act-1");
    expect(res).toEqual({
      challenge: "seal-token",
      expiresAt: "2026-09-21T14:04:11Z",
      act: "apply",
    });
    expect(seals.issue).toHaveBeenCalledWith({
      restaurantId: "r1",
      actorUserId: "u1",
      subjectKind: "ai_proposed_action",
      subjectId: "act-1",
      action: PROPOSAL_SEAL_ACT,
      args: {
        actionId: "act-1",
        family: "procurement",
        actionType: "reorder",
        payload: { inventoryId: INV, providerId: PROV, quantity: 6 },
      },
    });
  });

  it("will not mint for a proposal in another house", async () => {
    const seals = makeSeals();
    const { client } = makeClient(proposal({ restaurant_id: "r2" }));
    const svc = makeService(client, {}, seals);
    await expect(
      svc.issueProposalSeal("r1", "u1", "act-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(seals.issue).not.toHaveBeenCalled();
  });

  it("will not mint for a proposal already handled", async () => {
    const seals = makeSeals();
    const { client } = makeClient(proposal({ status: "executed" }));
    const svc = makeService(client, {}, seals);
    await expect(
      svc.issueProposalSeal("r1", "u1", "act-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(seals.issue).not.toHaveBeenCalled();
  });
});

describe("applying behind the seal", () => {
  it("redeems the seal BEFORE anything is written, then applies the stored proposal", async () => {
    const seals = makeSeals();
    const { client, writes } = makeClient(proposal());
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(client, { createOrder }, seals);
    const res = await svc.confirmSealed("r1", "u1", "act-1", "seal-token");
    expect(seals.redeem).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectKind: "ai_proposed_action",
        subjectId: "act-1",
        action: "apply",
        challenge: "seal-token",
        args: expect.objectContaining({
          payload: { inventoryId: INV, providerId: PROV, quantity: 6 },
        }),
      }),
    );
    expect(res).toMatchObject({ executed: true, edited: false });
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(writes.length).toBeGreaterThan(0);
  });

  it("a refused redemption writes nothing and applies nothing", async () => {
    const seals = makeSeals({ refuse: true });
    const { client, writes } = makeClient(proposal());
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(client, { createOrder }, seals);
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", "spent"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("with no seal service wired, refuses — it never applies unsealed", async () => {
    const { client, writes } = makeClient(proposal());
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(client, { createOrder });
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", "seal-token"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(
      svc.issueProposalSeal("r1", "u1", "act-1"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(writes).toEqual([]);
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe("the routes take standing", () => {
  it.each(["sealChallenge", "sealedConfirm"])(
    "%s is owner or manager only",
    (handler) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        (AskAiController.prototype as any)[handler],
      );
      expect(roles).toEqual(["owner", "manager"]);
    },
  );

  it("the seal names a proposal as a proposal", () => {
    expect(SEAL_SUBJECT_KINDS).toContain("ai_proposed_action");
    expect(subjectNoun("ai_proposed_action")).toBe("proposal");
  });
});
