/**
 * The letters' words and the order's figures on the doors the S145 cut missed.
 *
 * - F-986: `/conversations` (list, threads, thread/:id, by-provider, by-order,
 *   :id), `/conversations/pending/list` and `/communications/letters/queued`
 *   gave every role the letters' words and the order's negotiated and final
 *   price. Coordinator call S144: a non-holder keeps the words only under
 *   ADR 0175 D10 send authority; nobody but a holder gets the figures.
 * - F-988: `GET /procurement/last-agreement` gave staff the agreed price that
 *   `GET /procurement/orders` withholds from them.
 *
 * The provider conversation-memory gate (owner/manager, as MailTone) is
 * pinned by `auth/guards/route-access.expected.json`.
 */
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import type { DatabaseService } from "../database/database.service";
import type { VendorSendAuthorityService } from "../organizations/vendor-send-authority.service";
import { HouseLettersService } from "../communications/letters/house-letters.service";
import type { HouseSenderService } from "../communications/letters/house-sender.service";
import type { IntegrationsOauthService } from "../integrations/integrations-oauth.service";
import { ProcurementController } from "../procurement/procurement.controller";
import type { ProcurementService } from "../procurement/procurement.service";
import { lastAgreementAnswer } from "../procurement/last-agreement";

const USER = { userId: "u-1", restaurantId: "r-1" };

const ROW = {
  id: "c-1",
  order_id: "o-1",
  direction: "inbound",
  message_text: "We can do 1180 a case if you take two.",
  content: "We can do 1180 a case.",
  rolling_summary: "Vendor came down from 1250 to 1180.",
  conversation_summary: "1180 a case.",
  conversation_context: { last_price: 1180 },
  constraint_flags: { reasons: ["price_above_target"], target_price: 1100 },
  email_headers: { subject: "Re: Barolo at 1180" },
  created_at: "2026-10-10T10:00:00.000Z",
  procurement_orders: {
    id: "o-1",
    order_number: "PO-1",
    quantity: 2,
    status: "pending",
    negotiated_price: 1180,
    final_price: 1180,
  },
};

function authority(maySend: boolean) {
  return {
    readout: jest.fn().mockResolvedValue({ readable: true, maySend }),
  } as unknown as VendorSendAuthorityService;
}

/** A controller over a real service whose reads are stubbed. */
function conversations(maySend: boolean) {
  const service = new ConversationsService(
    {} as DatabaseService,
    undefined,
    authority(maySend),
  );
  const page = () => ({
    conversations: [structuredClone(ROW)],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  });
  jest
    .spyOn(service, "listConversations")
    .mockImplementation(async () => page());
  jest
    .spyOn(service, "listConversationThreads")
    .mockImplementation(async () => ({ ...page(), threads: [] }) as any);
  jest
    .spyOn(service, "assertProviderInHouse")
    .mockResolvedValue(undefined as any);
  jest.spyOn(service, "assertOrderInHouse").mockResolvedValue(undefined as any);
  jest
    .spyOn(service, "getPendingConversations")
    .mockImplementation(async () => [structuredClone(ROW)]);
  jest.spyOn(service, "getThread").mockImplementation(
    async () =>
      ({
        thread_id: "t-1",
        message_count: 1,
        first_message_at: null,
        last_message_at: null,
        summary: null,
        summary_updated_at: null,
        provider: { id: "p-1", name: "Acme" },
        order: structuredClone(ROW.procurement_orders),
        messages: [
          { id: "c-1", direction: "inbound", message_text: ROW.message_text },
        ],
      }) as any,
  );
  jest
    .spyOn(service, "getConversation")
    .mockImplementation(async () => structuredClone(ROW));
  return new ConversationsController(service);
}

/** Every list-shaped door, as one row each. */
async function listDoors(c: ConversationsController, role: string | null) {
  const u = USER as any;
  return {
    list: (await c.listConversations(u, role)).conversations[0],
    threads: (await c.listConversationThreads(u, role)).conversations[0],
    byProvider: (await c.getByProvider(u, role, "p-1")).conversations[0],
    byOrder: (await c.getByOrder(u, role, "o-1")).conversations[0],
    pending: (await c.getPendingConversations(u, role)).conversations[0],
  } as Record<string, any>;
}

describe("the /conversations reads by role (F-986)", () => {
  it.each(["staff", null])(
    "give %p without send authority neither the words nor the figures",
    async (role) => {
      const rows = await listDoors(conversations(false), role);
      for (const [door, row] of Object.entries(rows)) {
        for (const key of [
          "message_text",
          "content",
          "rolling_summary",
          "conversation_summary",
          "conversation_context",
          "constraint_flags",
          "email_headers",
        ])
          expect([door, key, key in row]).toEqual([door, key, false]);
        expect([door, row.procurement_orders.negotiated_price]).toEqual([
          door,
          undefined,
        ]);
        expect([door, row.procurement_orders.final_price]).toEqual([
          door,
          undefined,
        ]);
        expect(row.procurement_orders.order_number).toBe("PO-1");
        expect(row.wordsWithheld).toBe(true);
        expect(row.amountsWithheld).toBe(true);
      }
    },
  );

  it("give a D10 grantee the words without the figures", async () => {
    const rows = await listDoors(conversations(true), "staff");
    for (const [door, row] of Object.entries(rows)) {
      expect([door, row.message_text]).toEqual([door, ROW.message_text]);
      expect([door, row.constraint_flags]).toEqual([
        door,
        { reasons: ["price_above_target"] },
      ]);
      expect([door, "negotiated_price" in row.procurement_orders]).toEqual([
        door,
        false,
      ]);
      expect(row.wordsWithheld).toBeUndefined();
    }
  });

  it.each(["owner", "manager"])("give %p the rows whole", async (role) => {
    const rows = await listDoors(conversations(false), role);
    for (const row of Object.values(rows)) {
      expect(row.message_text).toBe(ROW.message_text);
      expect(row.procurement_orders.negotiated_price).toBe(1180);
      expect(row.amountsWithheld).toBeUndefined();
    }
  });

  it("cuts one thread: the order's figures always, the words without D10", async () => {
    const staff = (await conversations(false).getThread(
      USER as any,
      "staff",
      "t-1",
    )) as any;
    expect(staff.order.negotiated_price).toBeUndefined();
    expect(staff.order.order_number).toBe("PO-1");
    expect(staff.messages[0].message_text).toBeUndefined();
    expect(staff.wordsWithheld).toBe(true);

    const grantee = (await conversations(true).getThread(
      USER as any,
      "staff",
      "t-1",
    )) as any;
    expect(grantee.order.negotiated_price).toBeUndefined();
    expect(grantee.messages[0].message_text).toBe(ROW.message_text);

    const owner = (await conversations(false).getThread(
      USER as any,
      "owner",
      "t-1",
    )) as any;
    expect(owner.order.negotiated_price).toBe(1180);
    expect(owner.messages[0].message_text).toBe(ROW.message_text);
  });

  it("cuts one letter's words without D10", async () => {
    const staff = (await conversations(false).getConversation(
      USER as any,
      "staff",
      "c-1",
    )) as any;
    expect(staff.ai_message).toBeUndefined();
    expect(staff.conversation_context).toBeUndefined();
    expect(staff.wordsWithheld).toBe(true);
    const grantee = (await conversations(true).getConversation(
      USER as any,
      "staff",
      "c-1",
    )) as any;
    expect(grantee.ai_message).toBe(ROW.message_text);
  });

  it("keeps nothing when the standing cannot be read", async () => {
    const service = new ConversationsService({} as DatabaseService);
    expect(await service.readsLettersFor("u-1", "r-1", "staff")).toBe(false);
    expect(await service.readsLettersFor("u-1", "r-1", "owner")).toBe(true);
  });
});

describe("the queued letters' subject by role (F-986)", () => {
  function letters(maySend: boolean) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => ({
        data: [
          {
            id: "l-1",
            provider_id: "p-1",
            scheduled_send_at: null,
            email_headers: { subject: "Barolo at 1180", to: "a@acme.test" },
            created_at: "2026-10-10T10:00:00.000Z",
          },
        ],
        error: null,
      }),
    };
    const db = { client: { from: () => chain } } as unknown as DatabaseService;
    return new HouseLettersService(
      db,
      {} as HouseSenderService,
      {} as IntegrationsOauthService,
      authority(maySend),
    );
  }

  it("drops the subject for staff without send authority", async () => {
    const [row] = (await letters(false).queued("r-1", {
      userId: "u-1",
      role: "staff",
    })) as any[];
    expect("subject" in row).toBe(false);
    expect(row.wordsWithheld).toBe(true);
    expect(row.to).toBe("a@acme.test");
  });

  it("keeps it for a D10 grantee and for a manager", async () => {
    const [grantee] = (await letters(true).queued("r-1", {
      userId: "u-1",
      role: "staff",
    })) as any[];
    expect(grantee.subject).toBe("Barolo at 1180");
    const [manager] = (await letters(false).queued("r-1", {
      userId: "u-1",
      role: "manager",
    })) as any[];
    expect(manager.subject).toBe("Barolo at 1180");
  });
});

describe("the last agreement by role (F-988)", () => {
  const LINE = {
    price: 1180,
    priceUom: "case",
    pricePackSize: 6,
    currency: "TRY",
    unitType: "case",
    bottlesPerUnit: 6,
    agreedOn: "2026-10-01T10:00:00.000Z",
    orderNumber: "PO-1",
  };

  it("says a price was agreed without naming it", () => {
    const a = lastAgreementAnswer(LINE, false, "Acme", false, null, true);
    expect(a.state).toBe("found");
    expect(a.amountsWithheld).toBe(true);
    for (const key of ["price", "priceUom", "pricePackSize"])
      expect(key in a).toBe(false);
    expect(a.sentence).not.toMatch(/1180/);
    expect(a.sentence).toContain("Acme");
    expect(a.sentence).toContain("PO-1");
  });

  it.each([
    ["staff", true],
    [null, true],
    ["owner", false],
    ["manager", false],
  ])("the route asks for %p's answer withheld: %p", async (role, withheld) => {
    const lastAgreementFor = jest
      .fn()
      .mockResolvedValue({ state: "none", sentence: "" });
    const controller = new ProcurementController({
      lastAgreementFor,
    } as unknown as ProcurementService);
    await controller.lastAgreement({ ...USER, role }, "p-1", "i-1");
    expect(lastAgreementFor).toHaveBeenCalledWith(
      "r-1",
      "p-1",
      "i-1",
      withheld,
    );
  });
});
