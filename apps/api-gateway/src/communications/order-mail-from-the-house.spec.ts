/**
 * Order mail says the house's name, and the page says so (mail software,
 * gaps G3 and G12, 2026-11-11).
 *
 *  - `houseFromName`: the house's display name, else its name, else nothing;
 *    never a guess, never a throw.
 *  - the procurement sender puts that name in the From of an order letter
 *    (it used to say "Mudavym" for every house).
 *  - `GET communications/sender-identity` no longer says "no per-restaurant
 *    sender exists", and names the order-mail From exactly.
 *
 * Run:
 *   cd apps/api-gateway && npx jest order-mail-from-the-house
 */
import { houseFromName } from "./house-from-name";
import { ProcurementService } from "../procurement/procurement.service";
import { CommunicationsController } from "./communications.controller";

type Rows = { branding?: any; house?: any; throws?: boolean };

/** A supabase-shaped reader over two tables; records which house was asked. */
function db(rows: Rows) {
  const asked: Array<[string, string, string]> = [];
  return {
    asked,
    from(table: string) {
      if (rows.throws) throw new Error("connection reset");
      const q: any = {
        select: () => q,
        eq: (col: string, val: string) => {
          asked.push([table, col, val]);
          return q;
        },
        maybeSingle: async () => ({
          data: table === "restaurant_branding" ? rows.branding ?? null : rows.house ?? null,
          error: null,
        }),
      };
      return q;
    },
  };
}

describe("houseFromName (G3)", () => {
  it("prefers the house's display name and asks for this house only", async () => {
    const d = db({ branding: { display_name: "  Kitchenette  " }, house: { name: "K LLC" } });
    expect(await houseFromName(d, "r-1")).toBe("Kitchenette");
    expect(d.asked).toEqual([["restaurant_branding", "restaurant_id", "r-1"]]);
  });

  it("falls back to the house's name when the display name is blank", async () => {
    const d = db({ branding: { display_name: " " }, house: { name: "Meyhouse" } });
    expect(await houseFromName(d, "r-1")).toBe("Meyhouse");
    expect(d.asked[1]).toEqual(["restaurants", "id", "r-1"]);
  });

  it("says nothing rather than guess when nothing can be read", async () => {
    expect(await houseFromName(db({}), "r-1")).toBeUndefined();
    expect(await houseFromName(db({ throws: true }), "r-1")).toBeUndefined();
    expect(await houseFromName(db({ house: { name: "x" } }), "")).toBeUndefined();
  });
});

describe("an order letter's From names the house (G3)", () => {
  function harness(rows: Rows) {
    const sendEmail = jest.fn().mockResolvedValue({ success: true });
    const svc = Object.create(ProcurementService.prototype) as any;
    svc.gmailService = { sendEmail };
    svc.inboundAddress = undefined;
    svc.databaseService = { supabase: db(rows) };
    return { svc, sendEmail };
  }

  it("passes the house's name as fromName", async () => {
    const { svc, sendEmail } = harness({ branding: { display_name: "Kitchenette" } });
    await svc.sendProviderEmail({
      to: "vendor@example.com",
      subject: "Order",
      html: svc.buildEmailHtml("Hello"),
      restaurantId: "r-1",
    });
    expect(sendEmail.mock.calls[0][0].fromName).toBe("Kitchenette");
  });

  it("still sends, under the service default, when the name cannot be read", async () => {
    const { svc, sendEmail } = harness({ throws: true });
    await svc.sendProviderEmail({
      to: "vendor@example.com",
      subject: "Order",
      html: svc.buildEmailHtml("Hello"),
      restaurantId: "r-1",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].fromName).toBeUndefined();
  });
});

describe("GET communications/sender-identity tells the truth (G12)", () => {
  function controller(rows: Rows) {
    const c = Object.create(CommunicationsController.prototype) as any;
    c.gmailService = { getSenderEmail: () => "orders@mudavym.example" };
    c.configService = { get: () => undefined };
    c.databaseService = { supabase: db(rows) };
    return c as CommunicationsController;
  }

  it("says per-house sending exists and names the order-mail From", async () => {
    const out = await controller({ branding: { display_name: "Kitchenette" } }).senderIdentity({
      restaurantId: "r-1",
    });
    expect(out.perHouse.supported).toBe(true);
    expect(out.perHouse.reason).not.toMatch(/No per-restaurant sender exists/);
    expect(out.orderMail).toEqual({
      address: "orders@mudavym.example",
      fromName: "Kitchenette",
      words: expect.stringContaining('as from "Kitchenette"'),
    });
  });

  it("says the default name is a default when the house's name is unread", async () => {
    const out = await controller({}).senderIdentity({ restaurantId: "r-1" });
    expect(out.orderMail.fromName).toBe("Mudavym");
    expect(out.orderMail.words).toMatch(/could not be read/);
  });
});

describe("the house's first live grant is the oldest one (G11)", () => {
  it("reads the grants oldest first, then by id, so two reads name one mailbox", async () => {
    // Imported here so the suites above do not load the letters module.
    const { HouseSenderService } = await import("./letters/house-sender.service");
    const orders: Array<[string, string, unknown]> = [];
    const client = {
      from(table: string) {
        const q: any = {};
        const pass = () => q;
        for (const m of ["select", "eq", "is", "in", "limit", "neq", "gte"]) q[m] = pass;
        q.order = (col: string, opts: unknown) => {
          orders.push([table, col, opts]);
          return q;
        };
        q.maybeSingle = async () => ({ data: null, error: null });
        q.single = async () => ({ data: null, error: null });
        q.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return q;
      },
    };
    const svc = new HouseSenderService(
      { client } as any,
      { get: () => undefined } as any,
    );
    await svc.resolve("r-1", "u-1");
    expect(orders.filter(([t]) => t === "integration_oauth_connections")).toEqual([
      ["integration_oauth_connections", "connected_at", { ascending: true }],
      ["integration_oauth_connections", "id", { ascending: true }],
    ]);
  });
});
