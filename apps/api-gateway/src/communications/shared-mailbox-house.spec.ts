/**
 * QA round 25 (2026-11-07), cross-tenant BLOCKER: two houses list the same
 * vendor address, and a letter to house A that came through the shared Gmail
 * mailbox was filed under house B's vendor and order, because that path
 * published no house and the bridge took the first provider row of any
 * house. Here: the publisher stamps the receiving house, the bridge scopes
 * every read to it, and an event with no house is held for the operator,
 * unattributed: never dropped, never guessed.
 *
 * Every store lists house B's rows FIRST, so a lookup that is not scoped to
 * the receiving house resolves to house B.
 */
import { CommunicationsController } from "./communications.controller";
import { receivingHouse } from "./shared-mailbox-house";
import { bridge, inbound, memoryDb, Row } from "./testing/mail-store";

const SHARED = "sales@bigdist.com";
const VENDOR_B = {
  id: "prov-B",
  restaurant_id: "house-B",
  name: "BigDist (B)",
  contact_email: "Sales@BigDist.com",
  deleted_at: null,
};
const VENDOR_A = {
  id: "prov-A",
  restaurant_id: "house-A",
  name: "BigDist (A)",
  contact_email: SHARED,
  deleted_at: null,
};
const ORDER_B = {
  id: "order-B",
  provider_id: "prov-B",
  restaurant_id: "house-B",
  status: "NEGOTIATING",
  wine_name: "Opus One Reserve",
};
const ORDER_A = {
  id: "order-A",
  provider_id: "prov-A",
  restaurant_id: "house-A",
  status: "NEGOTIATING",
  wine_name: "Barolo",
};
const THREAD_B = {
  id: "conv-B",
  restaurant_id: "house-B",
  order_id: "order-B",
  thread_id: "thread-B",
  gmail_thread_id: "gt-B",
  direction: "outbound",
  email_headers: {},
  mirrored_by_grant_id: null,
};
const THREAD_A = {
  ...THREAD_B,
  id: "conv-A",
  restaurant_id: "house-A",
  order_id: "order-A",
  thread_id: "thread-A",
  gmail_thread_id: "gt-A",
};

function twoHouses(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    restaurants: [{ id: "house-B" }, { id: "house-A" }],
    providers: [VENDOR_B, VENDOR_A],
    procurement_orders: [ORDER_B, ORDER_A],
    procurement_conversations: [THREAD_B, THREAD_A],
    ...extra,
  };
}

describe("receivingHouse: the house a shared-mailbox letter was written to", () => {
  const resolve = (
    tables: Record<string, Row[]>,
    letter: any,
    failing?: string[],
  ) => receivingHouse(memoryDb(tables, failing).supabase, letter);

  it("a reply in a thread house A wrote is house A's, though both houses list the vendor", async () => {
    expect(
      await resolve(twoHouses(), { from: SHARED, gmailThreadId: "gt-A" }),
    ).toEqual({ restaurantId: "house-A", how: "thread" });
  });

  it("a thread holding rows of two houses names no house", async () => {
    const tables = twoHouses({
      procurement_conversations: [
        THREAD_B,
        THREAD_A,
        { ...THREAD_B, id: "conv-B2", gmail_thread_id: "gt-A" },
      ],
    });
    expect(
      await resolve(tables, { from: SHARED, gmailThreadId: "gt-A" }),
    ).toEqual({ restaurantId: null, how: "thread_in_many_houses" });
  });

  it("a thread row a person's mirrored mailbox produced does not decide the shared mailbox's house", async () => {
    const tables = twoHouses({
      procurement_conversations: [
        { ...THREAD_B, gmail_thread_id: "gt-X", mirrored_by_grant_id: "g1" },
      ],
    });
    expect(
      await resolve(tables, { from: SHARED, gmailThreadId: "gt-X" }),
    ).toEqual({ restaurantId: null, how: "vendor_in_many_houses" });
  });

  it("a fresh letter from a vendor both houses list names no house", async () => {
    expect(await resolve(twoHouses(), { from: SHARED })).toEqual({
      restaurantId: null,
      how: "vendor_in_many_houses",
    });
    expect(
      await resolve(twoHouses(), { from: `"BigDist" <${SHARED}>` }),
    ).toEqual({ restaurantId: null, how: "vendor_in_many_houses" });
  });

  it("a fresh letter from a vendor only one house lists is that house's", async () => {
    const tables = twoHouses({ providers: [VENDOR_A] });
    expect(await resolve(tables, { from: SHARED })).toEqual({
      restaurantId: "house-A",
      how: "vendor",
    });
  });

  it("a deleted vendor does not count as a second house", async () => {
    const tables = twoHouses({
      providers: [{ ...VENDOR_B, deleted_at: "2026-11-01" }, VENDOR_A],
    });
    expect(await resolve(tables, { from: SHARED })).toEqual({
      restaurantId: "house-A",
      how: "vendor",
    });
  });

  it("a wildcard sender is not a vendor of either house", async () => {
    for (const from of [
      "%@bigdist.com",
      "_____@bigdist.com",
      "*@bigdist.com",
    ]) {
      expect(await resolve(twoHouses(), { from })).toEqual({
        restaurantId: null,
        how: "no_house",
      });
    }
  });

  it("a stranger is the only house's when there is one house, and no house's when there are two", async () => {
    expect(
      await resolve(
        { restaurants: [{ id: "house-A" }], providers: [VENDOR_A] },
        { from: "hello@stranger.example" },
      ),
    ).toEqual({ restaurantId: "house-A", how: "only_house" });
    expect(
      await resolve(twoHouses(), { from: "hello@stranger.example" }),
    ).toEqual({ restaurantId: null, how: "no_house" });
  });

  it.each([
    [
      "the thread",
      "procurement_conversations",
      { from: SHARED, gmailThreadId: "gt-A" },
    ],
    ["the vendors", "providers", { from: SHARED }],
    ["the houses", "restaurants", { from: "hello@stranger.example" }],
  ])(
    "a failed read of %s names no house, never a guess",
    async (_l, table, letter) => {
      const oneHouse = {
        restaurants: [{ id: "house-A" }],
        providers: [VENDOR_A],
        procurement_conversations: [THREAD_A],
      };
      expect(await resolve(oneHouse, letter)).toMatchObject({
        restaurantId: "house-A",
      });
      expect(await resolve(oneHouse, letter, [table])).toEqual({
        restaurantId: null,
        how: "read_failed",
      });
    },
  );
});

const housesTouched = (events: any[]) =>
  events
    .filter((e) =>
      [
        "emitRestaurantNotification",
        "emitConversationUpdated",
        "persistManagerNotification",
      ].includes(e[0]),
    )
    .map((e) => e[1]);

describe("the bridge: two houses, the same vendor address", () => {
  it("a letter to house A is filed under house A's vendor and order only", async () => {
    const { svc, inserts, events } = bridge(twoHouses());
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: `BigDist <${SHARED}>`,
        gmail_message_id: "m-A",
      }),
    );
    const rows = inserts
      .filter((i) => i.table === "procurement_conversations")
      .map((i) => i.row);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      restaurant_id: "house-A",
      provider_id: "prov-A",
      order_id: "order-A",
    });
    expect(new Set(housesTouched(events))).toEqual(new Set(["house-A"]));
    const responder = events.find((e) => e[0] === "responder")?.[1];
    expect(responder).toMatchObject({
      restaurantId: "house-A",
      orderId: "order-A",
      providerId: "prov-A",
    });
  });

  it("a letter to house A carrying house B's Gmail thread does not join house B's thread or order", async () => {
    const { svc, inserts, events } = bridge(twoHouses());
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: SHARED,
        gmail_thread_id: "gt-B",
        gmail_message_id: "m-AB",
      }),
    );
    const row = inserts.find(
      (i) => i.table === "procurement_conversations",
    )?.row;
    expect(row).toMatchObject({
      restaurant_id: "house-A",
      provider_id: "prov-A",
    });
    expect(row?.order_id).not.toBe("order-B");
    expect(row?.thread_id).not.toBe("thread-B");
    expect(housesTouched(events)).not.toContain("house-B");
  });

  it("an order row of house B that names house A's vendor is not house A's open order", async () => {
    // A mixed-house row is what the order agent wrote before this fix (QA
    // round 25, Python: house B's vendor under house A); the open-order
    // fallback must not trust provider_id alone to say whose order it is.
    const MIXED = { ...ORDER_B, id: "order-mixed", provider_id: "prov-A" };
    const { svc, inserts } = bridge(
      twoHouses({ procurement_orders: [MIXED, ORDER_B, ORDER_A] }),
    );
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: SHARED,
        gmail_message_id: "m-mx",
      }),
    );
    const row = inserts.find(
      (i) => i.table === "procurement_conversations",
    )?.row;
    expect(row).toMatchObject({
      restaurant_id: "house-A",
      order_id: "order-A",
    });
  });

  it.each([
    [undefined, "no_house"],
    ["", "no_house"],
    ["   ", "no_house"],
  ])(
    "an event with restaurant_id %j is held unattributed: no vendor, order, notice or responder",
    async (restaurantId, why) => {
      const { svc, inserts, events } = bridge(twoHouses());
      await svc.handleInboundEmail(
        inbound({
          ...(restaurantId === undefined
            ? {}
            : { restaurant_id: restaurantId }),
          from: `BigDist <${SHARED}>`,
          subject: "Re: Opus One Reserve",
          body: "Confirming the Opus One Reserve price.",
          gmail_message_id: "m-none",
          gmail_thread_id: "gt-B",
        }),
      );
      expect(inserts).toEqual([]);
      expect(housesTouched(events)).toEqual([]);
      expect(events.some((e) => e[0] === "responder")).toBe(false);
      expect(events.some((e) => e[0] === "prospect")).toBe(false);
      const held = events.filter((e) => e[0] === "hold").map((e) => e[1]);
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({
        senderEmail: SHARED,
        subject: "Re: Opus One Reserve",
        gmailMessageId: "m-none",
        gmailThreadId: "gt-B",
        why,
      });
    },
  );

  it("the hold says why the publisher found no house", async () => {
    const { svc, events } = bridge(twoHouses());
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: null,
        house_resolution: "vendor_in_many_houses",
        from: SHARED,
        gmail_message_id: "m-why",
      }),
    );
    expect(events.find((e) => e[0] === "hold")?.[1].why).toBe(
      "vendor_in_many_houses",
    );
  });
});

describe("the shared-mailbox publishers stamp the receiving house", () => {
  const MSG = (id: string, threadId: string) => ({
    id,
    threadId,
    payload: {
      headers: [
        { name: "From", value: `BigDist <${SHARED}>` },
        { name: "Subject", value: "Re: order" },
      ],
      body: { data: Buffer.from("ok").toString("base64url") },
    },
  });

  function controller(tables: Record<string, Row[]>) {
    const published: any[] = [];
    const db = memoryDb(tables);
    const messages = [MSG("g1", "gt-A"), MSG("g2", "gt-fresh")];
    const watch: any = {
      isReady: () => true,
      getLastHistoryId: async () => "1",
      updateHistoryId: async () => undefined,
      fetchNewMessages: async () => messages,
      getMessage: async (id: string) => messages.find((m) => m.id === id),
      startWatch: async () => undefined,
      gmail: {
        users: {
          messages: {
            list: async () => ({
              data: { messages: messages.map((m) => ({ id: m.id })) },
            }),
          },
        },
      },
    };
    const c = new CommunicationsController(
      {} as any,
      { getSenderEmail: () => "house@mudavym.example" } as any,
      {} as any,
      watch,
      {
        publishEvent: async (_x: string, _k: string, p: any) =>
          void published.push(p),
      } as any,
      { get: () => undefined } as any,
      db as any,
      { verifyPushRequest: async () => true } as any,
    );
    return { c, published };
  }
  const push = {
    message: {
      data: Buffer.from(
        JSON.stringify({ emailAddress: "x@y", historyId: 2 }),
      ).toString("base64"),
    },
  };
  const stamps = (published: any[]) =>
    published.map((p) => [
      p.gmail_message_id,
      p.restaurant_id,
      p.house_resolution,
    ]);
  const WANT = [
    ["g1", "house-A", "thread"],
    ["g2", null, "vendor_in_many_houses"],
  ];

  it("the Gmail push path", async () => {
    const { c, published } = controller(twoHouses());
    await c.handleGmailWebhook(push, "Bearer t");
    expect(stamps(published)).toEqual(WANT);
  });

  it("the force-fetch recovery path", async () => {
    const { c, published } = controller(twoHouses());
    await c.forceGmailFetch({ minutesBack: 5 });
    expect(stamps(published)).toEqual(WANT);
  });
});
