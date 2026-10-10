/**
 * The words of an order's letters and the vendor's open offer, by role.
 *
 * - F-981: `GET /procurement/orders/:id/deal-proposal` sent the vendor's
 *   proposed and final price, the agreement terms, the quoted sentence and the
 *   summary to every role, though `GET /orders/:id` already cuts the order's
 *   figures for staff (`orderForRole`).
 * - F-982 (coordinator call S144): the letters' own words name prices. Staff
 *   who may send to vendors (ADR 0175 D10 grantees) keep them, because a
 *   letter they approve is a letter they must read; other staff get the
 *   letter without `draftContent`, `rollingSummary` and `specialConditions`,
 *   on `/orders/:id/conversations` and on the phone feed's draft card.
 */
import { ProcurementController } from "./procurement.controller";
import type { ProcurementService } from "./procurement.service";
import { MobileService } from "../mobile/mobile.service";

const USER = { userId: "u-1", restaurantId: "r-1" };

const PROPOSAL = {
  orderId: "o-1",
  conversationId: "c-1",
  providerName: "Acme Wines",
  wineName: "Barolo",
  quantity: 2,
  proposedPrice: 1250,
  finalPrice: 1180,
  deliveryEstimate: "Thursday",
  conditions: "Net 30 at 1180 a case",
  specialConditions: ["1180 only if paid by Friday"],
  commercialTerms: { unit_price: 1180, currency: "TRY" },
  sourceQuote: "We can do 1180 a case",
  conversationSummary: "Vendor came down from 1250 to 1180",
  dealKind: "offer",
  urgency: "normal",
  confidence: 0.9,
  timestamp: "2026-10-10T10:00:00.000Z",
  trust: { score: 0.8, eligible: true, completedOrders: 4 },
};

const LETTER = {
  id: "c-1",
  orderId: "o-1",
  direction: "INBOUND",
  providerName: "Acme Wines",
  quotedPrice: 1250,
  draftContent: "We can do 1180 a case if you take two.",
  rollingSummary: "Vendor came down from 1250 to 1180.",
  specialConditions: ["1180 only if paid by Friday"],
  detectedIntent: "counter_offer",
};

// The reply engine's review flags (inbound-responder computeGuardrails):
// the reasons, and the house's target and the vendor's best price beside them.
const FLAGS = {
  needs_approval: true,
  reasons: ["price_above_target"],
  target_price: 1100,
  best_vendor_price: 1180,
};

const PENDING = {
  id: "c-2",
  orderId: "o-1",
  providerName: "Acme Wines",
  draftContent: "Dear Acme, we accept 1180 a case for two cases.",
  subject: "Re: 1180 a case",
  constraintFlags: { ...FLAGS },
  quotedPrice: 1250,
  negotiatedPrice: 1180,
  quantity: 2,
};

const SENT = {
  id: "c-3",
  orderId: "o-1",
  direction: "OUTBOUND",
  status: "SENT",
  providerName: "Acme Wines",
  draftContent: "Dear Acme, we accept 1180 a case.",
  rollingSummary: "Vendor came down from 1250 to 1180.",
  constraintFlags: { ...FLAGS },
};

const DRAFT = {
  id: "c-2",
  content: "Dear Acme, we accept 1180 a case for two cases.",
  provider_name: "Acme Wines",
};

function controller(maySend: boolean | "unreadable") {
  const service = {
    getDealProposal: jest.fn().mockResolvedValue({ ...PROPOSAL }),
    getOrderConversations: jest.fn().mockResolvedValue([{ ...LETTER }]),
    getActiveConversations: jest.fn().mockResolvedValue([{ ...PENDING }]),
    getConversationHistory: jest.fn().mockResolvedValue([{ ...SENT }]),
    getPendingDraft: jest.fn().mockResolvedValue({
      ...DRAFT,
      constraint_flags: { ...FLAGS },
    }),
    sendOrAskFor: jest
      .fn()
      .mockResolvedValue(
        maySend === "unreadable"
          ? { readable: false, maySend: false }
          : { readable: true, maySend },
      ),
  };
  return {
    service,
    controller: new ProcurementController(
      service as unknown as ProcurementService,
    ),
  };
}

const NOT_HOLDERS = ["staff", null, undefined, "waiter"];

describe("the vendor's open offer by role (F-981)", () => {
  it.each(NOT_HOLDERS)("gives %p the offer with no money", async (role) => {
    const out = await controller(false).controller.getDealProposal("o-1", {
      ...USER,
      role,
    });

    expect(out).toEqual({
      orderId: "o-1",
      conversationId: "c-1",
      providerName: "Acme Wines",
      wineName: "Barolo",
      quantity: 2,
      deliveryEstimate: "Thursday",
      dealKind: "offer",
      urgency: "normal",
      confidence: 0.9,
      timestamp: "2026-10-10T10:00:00.000Z",
      trust: { score: 0.8, eligible: true, completedOrders: 4 },
      amountsWithheld: true,
    });
    expect(JSON.stringify(out)).not.toMatch(/1250|1180/);
  });

  it.each(["owner", "manager"])("gives %s the whole offer", async (role) => {
    const out = await controller(true).controller.getDealProposal("o-1", {
      ...USER,
      role,
    });
    expect(out).toEqual(PROPOSAL);
  });

  it("passes no offer through as no offer", async () => {
    const { controller: c, service } = controller(false);
    service.getDealProposal.mockResolvedValue(null);
    await expect(
      c.getDealProposal("o-1", { ...USER, role: "staff" }),
    ).resolves.toBeNull();
  });
});

describe("an order's letters' words by role (F-982)", () => {
  it.each(NOT_HOLDERS)(
    "gives %p without send authority the letters without their words",
    async (role) => {
      const out = (await controller(false).controller.getOrderConversations(
        "o-1",
        { ...USER, role },
      )) as Record<string, unknown>[];

      for (const key of [
        "draftContent",
        "rollingSummary",
        "specialConditions",
        "quotedPrice",
      ]) {
        expect(out[0]).not.toHaveProperty(key);
      }
      expect(out[0]).toMatchObject({
        id: "c-1",
        providerName: "Acme Wines",
        detectedIntent: "counter_offer",
        amountsWithheld: true,
        wordsWithheld: true,
      });
      expect(JSON.stringify(out)).not.toMatch(/1250|1180/);
    },
  );

  it("keeps the words for staff an owner has allowed to send (ADR 0175 D10)", async () => {
    const out = (await controller(true).controller.getOrderConversations(
      "o-1",
      {
        ...USER,
        role: "staff",
      },
    )) as Record<string, unknown>[];

    expect(out[0]).toMatchObject({
      draftContent: LETTER.draftContent,
      rollingSummary: LETTER.rollingSummary,
      specialConditions: LETTER.specialConditions,
      amountsWithheld: true,
    });
    expect(out[0]).not.toHaveProperty("quotedPrice");
    expect(out[0]).not.toHaveProperty("wordsWithheld");
  });

  it("withholds the words when whether staff may send cannot be read", async () => {
    const out = (await controller(
      "unreadable",
    ).controller.getOrderConversations("o-1", {
      ...USER,
      role: "staff",
    })) as Record<string, unknown>[];

    expect(out[0]).not.toHaveProperty("draftContent");
    expect(out[0].wordsWithheld).toBe(true);
  });

  it.each(["owner", "manager"])(
    "gives %s the whole letter and reads no standing",
    async (role) => {
      const { controller: c, service } = controller(false);
      const out = await c.getOrderConversations("o-1", { ...USER, role });
      expect(out).toEqual([LETTER]);
      expect(service.sendOrAskFor).not.toHaveBeenCalled();
    },
  );
});

describe("the phone feed's drafted reply by role (F-982)", () => {
  const feed = (maySend: boolean) => {
    const procurement = {
      listPendingOrders: async () => [],
      sendOrAskFor: jest.fn().mockResolvedValue({ readable: true, maySend }),
    };
    const service = new MobileService(
      {
        supabase: {
          from: () => {
            const b: any = {};
            for (const m of ["select", "eq", "in", "limit", "maybeSingle"])
              b[m] = () => b;
            b.then = (resolve: any, reject: any) =>
              Promise.resolve({ data: [], error: null }).then(resolve, reject);
            return b;
          },
        },
      } as never,
      procurement as never,
      {
        getPendingConversations: async () => [
          {
            id: "c-9",
            provider_id: "p-1",
            providers: { name: "Acme Wines" },
            content: "Dear Acme, we accept 1180 a case for two cases.",
            created_at: "2026-10-10T10:00:00.000Z",
            order_id: "o-1",
          },
        ],
      } as never,
      { getUnreadNotifications: async () => [] } as never,
    );
    return { service, procurement };
  };

  it("gives staff without send authority the card without the draft's words", async () => {
    const out = await feed(false).service.getFeed("u-1", "r-1", "staff");

    const card = out.items.find((i) => i.kind === "draft_approval")!;
    expect(card.draftContent).toBeNull();
    expect(card.subtitle).not.toMatch(/1180|Dear Acme/);
    expect(card.meta.wordsWithheld).toBe(true);
    expect(card.providerName).toBe("Acme Wines");
    expect(JSON.stringify(out)).not.toMatch(/1180/);
  });

  it("keeps the draft for staff an owner has allowed to send", async () => {
    const out = await feed(true).service.getFeed("u-1", "r-1", "staff");

    const card = out.items.find((i) => i.kind === "draft_approval")!;
    expect(card.draftContent).toMatch(/1180/);
    expect(card.meta.wordsWithheld).toBeUndefined();
  });

  it("gives an owner the draft and reads no standing", async () => {
    const { service, procurement } = feed(false);
    const out = await service.getFeed("u-1", "r-1", "owner");

    expect(out.items[0].draftContent).toMatch(/1180/);
    expect(procurement.sendOrAskFor).not.toHaveBeenCalled();
  });
});

describe("the letters waiting for a send by role (F-982, one route over)", () => {
  it.each(NOT_HOLDERS)(
    "gives %p the queue with no figure, on the flags or beside them",
    async (role) => {
      const out = (await controller(false).controller.getActiveConversations({
        ...USER,
        role,
      })) as Record<string, unknown>[];

      expect(out[0]).not.toHaveProperty("quotedPrice");
      expect(out[0]).not.toHaveProperty("negotiatedPrice");
      expect(out[0].constraintFlags).toEqual({
        needs_approval: true,
        reasons: ["price_above_target"],
      });
      expect(out[0].amountsWithheld).toBe(true);
    },
  );

  it("keeps the words a staff member edits and asks a manager to send (ADR 0175)", async () => {
    const { controller: c, service } = controller(false);
    const out = (await c.getActiveConversations({
      ...USER,
      role: "staff",
    })) as Record<string, unknown>[];

    expect(out[0].draftContent).toBe(PENDING.draftContent);
    expect(out[0]).not.toHaveProperty("wordsWithheld");
    expect(service.sendOrAskFor).not.toHaveBeenCalled();
  });

  it.each(["owner", "manager"])("gives %s the whole queue", async (role) => {
    const out = await controller(false).controller.getActiveConversations({
      ...USER,
      role,
    });
    expect(out).toEqual([PENDING]);
  });
});

describe("the sent-letter ledger by role (F-982, one route over)", () => {
  it.each(NOT_HOLDERS)(
    "gives %p without send authority the letters without their words",
    async (role) => {
      const out = (await controller(false).controller.getConversationHistory({
        ...USER,
        role,
      })) as Record<string, unknown>[];

      for (const key of ["draftContent", "rollingSummary", "constraintFlags"]) {
        expect(out[0]).not.toHaveProperty(key);
      }
      expect(out[0]).toMatchObject({
        id: "c-3",
        providerName: "Acme Wines",
        amountsWithheld: true,
        wordsWithheld: true,
      });
      expect(JSON.stringify(out)).not.toMatch(/1250|1180|1100/);
    },
  );

  it("keeps the words for staff an owner has allowed to send, without the figures", async () => {
    const out = (await controller(true).controller.getConversationHistory({
      ...USER,
      role: "staff",
    })) as Record<string, unknown>[];

    expect(out[0]).toMatchObject({
      draftContent: SENT.draftContent,
      rollingSummary: SENT.rollingSummary,
    });
    expect(out[0].constraintFlags).toEqual({
      needs_approval: true,
      reasons: ["price_above_target"],
    });
    expect(out[0]).not.toHaveProperty("wordsWithheld");
  });

  it("withholds the words when whether staff may send cannot be read", async () => {
    const out = (await controller(
      "unreadable",
    ).controller.getConversationHistory({
      ...USER,
      role: "staff",
    })) as Record<string, unknown>[];
    expect(out[0]).not.toHaveProperty("draftContent");
    expect(out[0].wordsWithheld).toBe(true);
  });

  it.each(["owner", "manager"])(
    "gives %s the whole ledger and reads no standing",
    async (role) => {
      const { controller: c, service } = controller(false);
      expect(await c.getConversationHistory({ ...USER, role })).toEqual([SENT]);
      expect(service.sendOrAskFor).not.toHaveBeenCalled();
    },
  );
});

describe("the pending draft's review flags by role (F-982)", () => {
  it.each(NOT_HOLDERS)(
    "gives %p the flags without the figures",
    async (role) => {
      const out = await controller(false).controller.getPendingDraft("o-1", {
        ...USER,
        role,
      });
      expect(out.draft?.constraint_flags).toEqual({
        needs_approval: true,
        reasons: ["price_above_target"],
      });
      expect(out.draft?.content).toBe(DRAFT.content);
    },
  );

  it("gives an owner the flags whole", async () => {
    const out = await controller(false).controller.getPendingDraft("o-1", {
      ...USER,
      role: "owner",
    });
    expect(out.draft?.constraint_flags).toEqual(FLAGS);
  });
});
