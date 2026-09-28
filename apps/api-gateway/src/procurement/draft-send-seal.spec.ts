/**
 * The seal on a letter — ADR 0118, built by packet 2 of the overlay layer.
 *
 * Until 2026-09-06 the only approval of a drafted reply was
 * `POST orders/:id/approve-draft`: a click, and mail left the building on an
 * unsealed request. These assert the two things the new act has to get right:
 *
 *  1. **The seal is over the LETTER, not the order.** A paragraph changed
 *     between the hold and the release must break the args hash. Hashing the
 *     order's total instead — which is what re-using `approve` would have done
 *     — would let the words change freely under a valid seal.
 *  2. **The acts do not interchange.** A seal minted to approve an order's
 *     money cannot be spent to send its mail. `send_draft` is its own act for
 *     the same reason `cancel` is.
 *
 * Plus the two states a mint must tell apart: no draft waiting (404, an
 * ordinary fact) and *whether one is waiting could not be read* (500, never a
 * seal issued over nothing).
 */

import {
  ORDER_CANCEL_ACT,
  ORDER_SEAL_ACT,
  ORDER_SEND_DRAFT_ACT,
  draftSealArgs,
} from "./order-seal";

describe("the act", () => {
  it("is its own act, distinct from approving and cancelling", () => {
    expect(ORDER_SEND_DRAFT_ACT).toBe("send_draft");
    expect(
      new Set([ORDER_SEAL_ACT, ORDER_CANCEL_ACT, ORDER_SEND_DRAFT_ACT]).size,
    ).toBe(3);
  });
});

describe("draftSealArgs — what the hold was over", () => {
  const letter = {
    body: "Dear Hasan,\n\nWe can take six cases at 2,400.\n\n— Ayşe",
    to: "hasan@kavaklidere.example",
    cc: ["ops@house.example"],
  };

  it("changes when the words change — the substitution the seal exists to catch", () => {
    const before = draftSealArgs(letter);
    const after = draftSealArgs({
      ...letter,
      body: letter.body.replace("2,400", "24,000"),
    });
    expect(after).not.toEqual(before);
  });

  it("changes when the recipient changes", () => {
    expect(
      draftSealArgs({ ...letter, to: "someone@else.example" }),
    ).not.toEqual(draftSealArgs(letter));
  });

  it("changes when a copy is added", () => {
    expect(
      draftSealArgs({ ...letter, cc: [...letter.cc, "x@y.example"] }),
    ).not.toEqual(draftSealArgs(letter));
  });

  it("does NOT change on whitespace the textarea added", () => {
    expect(draftSealArgs({ ...letter, body: `${letter.body}\n` })).toEqual(
      draftSealArgs(letter),
    );
    expect(
      draftSealArgs({ ...letter, body: letter.body.replace(/\n\n/g, "\n \n") }),
    ).toEqual(draftSealArgs(letter));
  });

  it("does NOT change when the same copies are re-typed in another order", () => {
    const a = draftSealArgs({ ...letter, cc: ["a@x.example", "b@x.example"] });
    const b = draftSealArgs({ ...letter, cc: ["b@x.example", "A@X.example"] });
    expect(a).toEqual(b);
  });

  it("carries the letter and never the order's figures", () => {
    const args = draftSealArgs(letter);
    expect(Object.keys(args).sort()).toEqual(["body", "cc", "to"]);
  });

  it("survives an absent recipient and absent copies without inventing either", () => {
    const args = draftSealArgs({ body: "x", to: null });
    expect(args.to).toBe("");
    expect(args.cc).toEqual([]);
  });
});

/* ── the mint, against a stubbed database ───────────────────────────────── */

function stub(opts: { pending?: unknown; readError?: string }) {
  const issued: unknown[] = [];
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () =>
      Promise.resolve(
        opts.readError
          ? { data: null, error: { message: opts.readError } }
          : { data: opts.pending ?? null, error: null },
      ),
  };
  return {
    issued,
    self: {
      databaseService: { supabase: { from: () => builder } },
      organizations: {
        assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined),
      },
      sealChallenges: {
        issue: (p: unknown) => {
          issued.push(p);
          return Promise.resolve({
            challenge: "tok",
            expiresAt: "2026-09-06T00:05:00.000Z",
            action: ORDER_SEND_DRAFT_ACT,
          });
        },
      },
      logger: { warn: () => undefined, error: () => undefined },
    },
  };
}

async function mint(s: ReturnType<typeof stub>) {
  const { ProcurementService } = await import("./procurement.service");
  return ProcurementService.prototype.issueDraftSendSeal.call(
    s.self as never,
    "rest-A",
    "ord-1",
    "user-1",
    { body: "Dear Hasan", to: "h@x.example", cc: [] },
  );
}

describe("issueDraftSendSeal", () => {
  it("mints over the letter, bound to this actor, this order and this act", async () => {
    const s = stub({
      pending: {
        id: "conv-1",
        providers: { contact_email: "h@x.example", restaurant_id: "rest-A" },
      },
    });
    const out = await mint(s);
    expect(out.challenge).toBe("tok");
    expect(s.issued[0]).toMatchObject({
      restaurantId: "rest-A",
      actorUserId: "user-1",
      subjectKind: "procurement_order",
      subjectId: "ord-1",
      action: "send_draft",
    });
    expect((s.issued[0] as { args: Record<string, unknown> }).args).toEqual({
      ...draftSealArgs({ body: "Dear Hasan", to: "h@x.example", cc: [] }),
      draftId: "conv-1",
    });
  });

  it("refuses to seal a letter that is not waiting, and issues nothing", async () => {
    const s = stub({ pending: null });
    await expect(mint(s)).rejects.toThrow(/no draft waiting on this order/i);
    expect(s.issued).toHaveLength(0);
  });

  it("tells 'no draft' from 'we could not look', and issues nothing either way", async () => {
    const s = stub({ readError: "relation does not exist" });
    await expect(mint(s)).rejects.toThrow(/could not be read/i);
    expect(s.issued).toHaveLength(0);
  });
});

/* ── the send ───────────────────────────────────────────────────────────── */

describe("sendDraftedReply", () => {
  it("requires manager authority before reading or sending the letter", async () => {
    const { ProcurementService } = await import("./procurement.service");
    const approveDraft = jest.fn();
    const organizations = {
      assertCanManageRestaurant: jest
        .fn()
        .mockRejectedValue(new Error("not manager")),
    };
    await expect(
      ProcurementService.prototype.sendDraftedReply.call(
        { organizations, approveDraft } as never,
        "rest-A",
        "ord-1",
        "staff",
        {},
        { body: "Dear Hasan" },
        "tok",
      ),
    ).rejects.toThrow("not manager");
    expect(approveDraft).not.toHaveBeenCalled();
  });

  it("passes the proof into the atomic sending path instead of redeeming against caller-supplied recipient", async () => {
    const { ProcurementService } = await import("./procurement.service");
    const approveDraft = jest
      .fn()
      .mockResolvedValue({ conversationId: "c", sentAt: "t" });
    const organizations = {
      assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined),
    };
    const dto = { modifiedContent: "Dear Hasan" };
    await ProcurementService.prototype.sendDraftedReply.call(
      { organizations, approveDraft } as never,
      "rest-A",
      "ord-1",
      "manager",
      dto,
      { body: "Dear Hasan", to: "caller@example.test" },
      "tok",
    );
    expect(approveDraft).toHaveBeenCalledWith("rest-A", "ord-1", dto, {
      userId: "manager",
      challenge: "tok",
    });
  });

  it("redeems against the actual pending draft and actual recipient before claiming or dispatch", async () => {
    const { ProcurementService } = await import("./procurement.service");
    const update = jest.fn();
    const conv = {
      id: "replacement-draft",
      content: "Actual body",
      created_at: "2026-09-13",
      providers: {
        contact_email: "actual@example.test",
        restaurant_id: "rest-A",
      },
      procurement_orders: {},
    };
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      single: async () => ({ data: conv, error: null }),
      update,
    };
    const redeem = jest
      .fn()
      .mockRejectedValue(new Error("changed draft or address"));
    const self = {
      databaseService: { supabase: { from: () => builder } },
      newerReplyStillAnalyzing: async () => false,
      sealChallenges: { redeem },
      logger: { error: jest.fn() },
    };
    await expect(
      ProcurementService.prototype.approveDraft.call(
        self as never,
        "rest-A",
        "ord-1",
        {},
        { userId: "manager", challenge: "tok" },
      ),
    ).rejects.toThrow("changed draft or address");
    expect(redeem).toHaveBeenCalledWith(
      expect.objectContaining({
        args: {
          ...draftSealArgs({ body: "Actual body", to: "actual@example.test" }),
          draftId: "replacement-draft",
        },
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });
});
