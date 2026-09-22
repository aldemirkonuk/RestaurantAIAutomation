import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { AskAiService, PROPOSAL_SEAL_ACT } from "./ask-ai.service";
import {
  AskAiController,
  UNSEALED_CONFIRM_RETIRED,
} from "./ask-ai.controller";
import { hashCallArgs } from "../common/seal/seal-token";
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
 *   5. letting a role below owner/manager reach either route;
 *   6. an operator's EDIT reaching the apply outside the seal — "Never without
 *      the seal" (the founder, 2026-09-21, on /ask): the Ask panel's card edits
 *      first, the seal is minted on the edit when the hold begins, and the
 *      apply must carry that same edit back;
 *   7. the retired unsealed confirm route still reaching the service.
 */

type Row = Record<string, any>;
const INV = "11111111-1111-4111-8111-111111111111";
const PROV = "22222222-2222-4222-8222-222222222222";
/** A second active vendor in this house — what an operator's edit picks. */
const PROV_2 = "44444444-4444-4444-8444-444444444444";
/** A vendor that is NOT in this house's candidate set. */
const FOREIGN = "99999999-9999-4999-8999-999999999999";

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
          if (id === undefined) {
            // The candidate LISTS an edit is grounded against (no id filter).
            if (table === "restaurant_inventory")
              return { data: [{ id: INV, wine_name: "Barolo" }], error: null };
            if (table === "providers")
              return {
                data: [
                  { id: PROV, name: "Acme" },
                  { id: PROV_2, name: "Beta" },
                ],
                error: null,
              };
            return { data: [], error: null };
          }
          // The direct existence lookups every apply makes.
          if (table === "restaurant_inventory")
            return { data: id === INV ? [{ id }] : [], error: null };
          if (table === "providers")
            return {
              data: id === PROV || id === PROV_2 ? [{ id }] : [],
              error: null,
            };
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

/**
 * A seal store that keeps the one promise the real service makes about
 * arguments: a seal redeems only for the arguments it was minted on (the real
 * `redeem` compares `hashCallArgs` the same way; its own suite pins the rest).
 * One seal, one spend.
 */
function makeBindingSeals() {
  const minted = new Map<string, { argsHash: string; spent: boolean }>();
  let n = 0;
  return {
    issue: jest.fn(async (params: any) => {
      n += 1;
      const challenge = `seal-${n}`;
      minted.set(challenge, { argsHash: hashCallArgs(params.args), spent: false });
      return { challenge, expiresAt: "2026-09-21T14:04:11Z", action: params.action };
    }),
    redeem: jest.fn(async (params: any) => {
      const seal = minted.get(params.challenge ?? "");
      if (!seal) throw new ForbiddenException("No seal was carried.");
      if (seal.spent) throw new ForbiddenException("That seal has already been spent.");
      if (seal.argsHash !== hashCallArgs(params.args)) {
        throw new ForbiddenException(
          "This proposal changed after the seal was issued, so nothing was changed.",
        );
      }
      seal.spent = true;
      return { sealId: params.challenge };
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
    // `confirmSealed`: `requireSeal()`'s internal fault happens strictly
    // before the write (`applyAfterSeal`), so it is re-shaped into the same
    // `ForbiddenException` a refused redemption throws — "nothing was
    // written", not a terminal 5xx (see confirmSealed's own comment).
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", "seal-token"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // `issueProposalSeal` (the MINT step) is unaffected: the web card's own
    // mint-failure path (`ProposalCard.tsx`'s `onChallenge`) never sets a
    // terminal phase for any mint error, so this one is left as the real
    // status the gateway fault is.
    await expect(
      svc.issueProposalSeal("r1", "u1", "act-1"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(writes).toEqual([]);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("an internal seal-check fault never reaches the caller as a raw 5xx — the row is still `proposed`, not terminal", async () => {
    // Distinct from the "no seal service wired" case above: here the seal
    // service IS wired, but `redeem` itself throws something that is not a
    // business refusal (`ForbiddenException`) — e.g. a bug in the seal
    // service's own internals. `confirmSealed` must still re-shape it rather
    // than let it pass through as the raw error, because the invariant
    // ("redeem runs before any write") does not care WHY redeem threw.
    const seals = makeSeals();
    seals.redeem = jest.fn(async (_params: any) => {
      throw new Error("unexpected seal-service fault");
    });
    const { client, writes } = makeClient(proposal());
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(client, { createOrder }, seals);
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", "seal-token"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The raw error's own text never reaches the caller.
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", "seal-token"),
    ).rejects.not.toThrow("unexpected seal-service fault");
    expect(writes).toEqual([]);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("a DB read fault fetching the proposal's own stored args never reaches the caller as a raw 5xx either", async () => {
    // `readProposalSealArgs` runs before `requireSeal`/`redeem`, inside the
    // same try/catch — also strictly before the only write, so a Supabase
    // error here is the same "internal fault, not a decision" class as a
    // redeem-side one, and must be re-shaped the same way, not left as the
    // `ServiceUnavailableException` `readProposalSealArgs` itself throws.
    const seals = makeSeals();
    const writes: Row[] = [];
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () =>
                table === "ai_proposed_actions"
                  ? { data: null, error: { message: "connection reset" } }
                  : { data: null, error: null },
            }),
          }),
        }),
      }),
    };
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(client, { createOrder }, seals);
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", "seal-token"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", "seal-token"),
    ).rejects.not.toThrow("connection reset");
    expect(seals.redeem).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("the re-shape leaves the two real answers alone: a proposal already handled is still 'gone' (404), a refusal keeps its own sentence", async () => {
    // The catch re-shapes only an INTERNAL fault. A proposal another tab
    // already applied must still answer 404, which the card shows as
    // "already handled — nothing ran twice"; re-shaped into a 403 it would
    // say "Try again" and offer a hold that can never work. And a refusal
    // must still carry the seal's own words (spent, expired, changed), not
    // the generic "could not be checked".
    const seals = makeSeals();
    const handled = makeClient(proposal({ status: "executed" }));
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(handled.client, { createOrder }, seals);
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", "seal-token"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(seals.redeem).not.toHaveBeenCalled();
    expect(handled.writes).toEqual([]);

    const refusing = makeSeals({ refuse: true });
    const open = makeClient(proposal());
    const svc2 = makeService(open.client, { createOrder }, refusing);
    await expect(
      svc2.confirmSealed("r1", "u1", "act-1", "spent"),
    ).rejects.toThrow("That seal has already been spent.");
    expect(open.writes).toEqual([]);
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe("an edit is applied only inside its seal (\"Never without the seal\", 2026-09-21)", () => {
  const EDIT = { inventoryId: INV, providerId: PROV_2, quantity: 8 };

  it("mints on the edit: the seal binds the stored proposal AND the edited payload", async () => {
    const seals = makeSeals();
    const { client } = makeClient(proposal());
    const svc = makeService(client, {}, seals);
    await svc.issueProposalSeal("r1", "u1", "act-1", EDIT);
    expect(seals.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectKind: "ai_proposed_action",
        subjectId: "act-1",
        action: "apply",
        args: {
          actionId: "act-1",
          family: "procurement",
          actionType: "reorder",
          payload: { inventoryId: INV, providerId: PROV, quantity: 6 },
          edit: EDIT,
        },
      }),
    );
  });

  it("mints NO seal for an edit the apply would refuse (a vendor outside this house)", async () => {
    const seals = makeSeals();
    const { client } = makeClient(proposal());
    const svc = makeService(client, {}, seals);
    await expect(
      svc.issueProposalSeal("r1", "u1", "act-1", { ...EDIT, providerId: FOREIGN }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(seals.issue).not.toHaveBeenCalled();
  });

  it("applies the edit it was minted on, and records it as an edit", async () => {
    const seals = makeBindingSeals();
    const { client } = makeClient(proposal());
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(client, { createOrder }, seals);
    const { challenge } = await svc.issueProposalSeal("r1", "u1", "act-1", EDIT);
    const res = await svc.confirmSealed("r1", "u1", "act-1", challenge, EDIT);
    expect(res).toMatchObject({ executed: true, edited: true });
    expect(createOrder).toHaveBeenCalledWith(
      "r1",
      "u1",
      expect.objectContaining({ providerId: PROV_2, quantity: 8 }),
      { source: "ask_ai" },
    );
  });

  it("refuses an edit carried on a seal minted UNTOUCHED — nothing written, nothing ordered", async () => {
    const seals = makeBindingSeals();
    const { client, writes } = makeClient(proposal());
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(client, { createOrder }, seals);
    const { challenge } = await svc.issueProposalSeal("r1", "u1", "act-1");
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", challenge, EDIT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("refuses an edit changed AFTER the hold began — the seal is on the first edit", async () => {
    const seals = makeBindingSeals();
    const { client, writes } = makeClient(proposal());
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(client, { createOrder }, seals);
    const { challenge } = await svc.issueProposalSeal("r1", "u1", "act-1", EDIT);
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", challenge, { ...EDIT, quantity: 80 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("refuses an untouched apply on a seal minted for an edit", async () => {
    const seals = makeBindingSeals();
    const { client } = makeClient(proposal());
    const createOrder = jest.fn(async () => ({ id: "order-9" }));
    const svc = makeService(client, { createOrder }, seals);
    const { challenge } = await svc.issueProposalSeal("r1", "u1", "act-1", EDIT);
    await expect(
      svc.confirmSealed("r1", "u1", "act-1", challenge),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("the service has no public unsealed apply left to call", () => {
    // `confirm` was the public door the retired route used. The executor is
    // now `applyAfterSeal`, private, reached only from `confirmSealed`.
    expect("confirm" in AskAiService.prototype).toBe(false);
  });
});

describe("the sealed routes carry the edit through", () => {
  // The controller is the unit here: its job is to hand the body's edit to
  // the service on BOTH sealed routes. The service is a recording double.
  const EDIT = { inventoryId: INV, providerId: PROV_2, quantity: 8 };
  const user = { userId: "u1", restaurantId: "r1" };

  it("seal-challenge mints on the body's edit", async () => {
    const svc = { issueProposalSeal: jest.fn(async () => ({})) };
    const controller = new AskAiController(svc as unknown as AskAiService);
    await controller.sealChallenge("act-1", { payload: EDIT }, user);
    expect(svc.issueProposalSeal).toHaveBeenCalledWith("r1", "u1", "act-1", EDIT);
  });

  it("sealed-confirm carries the header's seal and the body's edit", async () => {
    const svc = { confirmSealed: jest.fn(async () => ({})) };
    const controller = new AskAiController(svc as unknown as AskAiService);
    await controller.sealedConfirm("act-1", { payload: EDIT }, user, "seal-9");
    expect(svc.confirmSealed).toHaveBeenCalledWith("r1", "u1", "act-1", "seal-9", EDIT);
  });

  it("an untouched apply carries no edit and a missing header is null, not a seal", async () => {
    const svc = { confirmSealed: jest.fn(async () => ({})) };
    const controller = new AskAiController(svc as unknown as AskAiService);
    await controller.sealedConfirm("act-1", {}, user, undefined);
    expect(svc.confirmSealed).toHaveBeenCalledWith("r1", "u1", "act-1", null, undefined);
  });
});

describe("the unsealed confirm route is retired", () => {
  it("answers 410 and names the sealed route, touching nothing", () => {
    const svc = {
      confirmSealed: jest.fn(),
      issueProposalSeal: jest.fn(),
      discard: jest.fn(),
    };
    const controller = new AskAiController(svc as unknown as AskAiService);
    let thrown: unknown;
    try {
      controller.retiredConfirm();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GoneException);
    const message = (thrown as GoneException).message;
    expect(message).toContain("/ask-ai/actions/:id/seal-challenge");
    expect(message).toContain("/ask-ai/actions/:id/sealed-confirm");
    expect(message).toContain("nothing was applied");
    expect(message).toBe(UNSEALED_CONFIRM_RETIRED);
    expect(svc.confirmSealed).not.toHaveBeenCalled();
    expect(svc.issueProposalSeal).not.toHaveBeenCalled();
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
