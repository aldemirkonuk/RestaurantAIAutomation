/**
 * The files a vendor attached to a letter, by role (F-1176).
 *
 * `GET /procurement/orders/:id/attachments` signed a one-hour link for every
 * file on the order, for every signed-in member. Staff without send
 * authority had the letter's words withheld (F-982) and the vendor's price
 * list linked right under it. The files now follow the letters: a holder of
 * the house's money, or a member an owner has allowed to write to vendors
 * (ADR 0175 D10), gets the links; anyone else learns only that files came
 * with which letter, and nothing is signed.
 */
import { ProcurementController } from "./procurement.controller";
import { ProcurementService } from "./procurement.service";

const USER = { userId: "u-1", restaurantId: "r-1" };

const ROWS = [
  {
    id: "a-1",
    conversation_id: "c-1",
    filename: "Acme price list Oct - 1180 a case.pdf",
    mime_type: "application/pdf",
    size_bytes: 52000,
    storage_path: "r-1/o-1/price-list.pdf",
    created_at: "2026-10-10T10:00:00.000Z",
  },
];

function build(maySend: boolean | "unreadable") {
  const createSignedUrl = jest.fn(async (path: string) => ({
    data: { signedUrl: `https://files.test/${path}?token=t` },
  }));
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () =>
      Promise.resolve({ data: ROWS.map((r) => ({ ...r })), error: null }),
  };
  const service = Object.create(
    ProcurementService.prototype,
  ) as ProcurementService;
  (service as any).databaseService = {
    supabase: {
      from: () => chain,
      storage: { from: () => ({ createSignedUrl }) },
    },
  };
  (service as any).logger = { error: jest.fn() };
  (service as any).sendOrAskFor = jest
    .fn()
    .mockResolvedValue(
      maySend === "unreadable"
        ? { readable: false, maySend: false }
        : { readable: true, maySend },
    );
  return {
    createSignedUrl,
    controller: new ProcurementController(service),
  };
}

describe("an order's vendor files by role (F-1176)", () => {
  it.each(["staff", null, undefined, "waiter"])(
    "gives %p without send authority no file name and no link",
    async (role) => {
      const { controller, createSignedUrl } = build(false);
      const out = await controller.getOrderAttachments("o-1", {
        ...USER,
        role,
      });

      expect(out).toEqual([
        {
          id: "a-1",
          conversationId: "c-1",
          createdAt: "2026-10-10T10:00:00.000Z",
          withheld: true,
        },
      ]);
      expect(createSignedUrl).not.toHaveBeenCalled();
      expect(JSON.stringify(out)).not.toMatch(/price|1180|https:/);
    },
  );

  it("gives nothing to open when the send standing cannot be read", async () => {
    const { controller, createSignedUrl } = build("unreadable");
    const out = await controller.getOrderAttachments("o-1", {
      ...USER,
      role: "staff",
    });
    expect(out[0]).toMatchObject({ withheld: true });
    expect(out[0]).not.toHaveProperty("url");
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("gives staff an owner has allowed to send the files (ADR 0175 D10)", async () => {
    const { controller } = build(true);
    const out = await controller.getOrderAttachments("o-1", {
      ...USER,
      role: "staff",
    });
    expect(out[0]).toMatchObject({
      filename: ROWS[0].filename,
      url: "https://files.test/r-1/o-1/price-list.pdf?token=t",
    });
    expect(out[0]).not.toHaveProperty("withheld");
  });

  it.each(["owner", "manager"])(
    "gives %s the files without asking the send standing",
    async (role) => {
      const { controller } = build(false);
      const out = await controller.getOrderAttachments("o-1", {
        ...USER,
        role,
      });
      expect(out[0]).toMatchObject({
        filename: ROWS[0].filename,
        url: expect.stringContaining("https://files.test/"),
      });
    },
  );
});
