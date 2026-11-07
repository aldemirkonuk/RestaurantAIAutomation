/**
 * QA round 24 (2026-11-07): "names nobody" dropped the letter. A From that
 * names no single address was logged and returned, with no row, prospect or
 * notice. It is now held, filed under no vendor, in the house's "Who is
 * writing" list (the operator's when no house is known). Never guessed.
 */
import { bridge, inbound, Row } from "./testing/mail-store";

const VENDOR = "sales@bigdist.com";
const PROVIDER = {
  id: "prov-A",
  restaurant_id: "house-A",
  name: "BigDist",
  contact_email: VENDOR,
  deleted_at: null,
};
const ORDER = {
  id: "order-A",
  provider_id: "prov-A",
  restaurant_id: "house-A",
  status: "NEGOTIATING",
  wine_name: "Barolo",
};
const house = (): Record<string, Row[]> => ({
  restaurants: [{ id: "house-A" }],
  providers: [PROVIDER],
  procurement_orders: [ORDER],
  procurement_conversations: [],
});

const notices = (events: any[]) =>
  events.filter((e) =>
    ["emitRestaurantNotification", "persistManagerNotification"].includes(e[0]),
  );

describe("the bridge: a From that names nobody is held, never dropped", () => {
  it.each([
    ["two mailboxes", `a@x.example, ${VENDOR}`],
    ["an unclosed quote", `"Sales <${VENDOR}>`],
    ["a group", `Team: a@x.example, b@y.example;`],
  ])("%s, with a house: held in the house, filed under nobody", async (_l, from) => {
    const { svc, inserts, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from,
        subject: "Invoice 4411",
        body: "Please pay.",
        gmail_message_id: "m-1",
        gmail_thread_id: "gt-1",
        attachments: [{ filename: "i.pdf", mime_type: "application/pdf", data: "QQ==" }],
      }),
    );
    expect(inserts).toEqual([]);
    expect(events.some((e) => e[0] === "responder")).toBe(false);
    expect(events.some((e) => e[0] === "prospect")).toBe(false);
    const held = events.filter((e) => e[0] === "held").map((e) => e[1]);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      restaurantId: "house-A",
      heldReason: "sender_unreadable",
      senderEmail: null,
      subject: "Invoice 4411",
      gmailMessageId: "m-1",
      gmailThreadId: "gt-1",
    });
    expect(held[0].senderName).toBe(from);
    const n = notices(events);
    expect(n.map((e) => e[1])).toEqual(["house-A", "house-A"]);
  });

  it("with no house: held for the operator, with no notice to any house", async () => {
    const { svc, inserts, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({ from: `a@x.example, ${VENDOR}`, gmail_message_id: "m-2" }),
    );
    expect(inserts).toEqual([]);
    const held = events.filter((e) => e[0] === "held").map((e) => e[1]);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      restaurantId: null,
      heldReason: "sender_unreadable",
    });
    expect(notices(events)).toEqual([]);
    expect(events.some((e) => e[0] === "hold")).toBe(false);
  });

  it("an empty From is held too, with no label", async () => {
    const { svc, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({ restaurant_id: "house-A", from: "  ", gmail_message_id: "m-3" }),
    );
    const held = events.filter((e) => e[0] === "held").map((e) => e[1]);
    expect(held).toHaveLength(1);
    expect(held[0].senderName).toBeNull();
  });

  it("the label carries no line breaks or control characters", async () => {
    const { svc, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: `a@x.example,\r\n\u0000 ${VENDOR}`,
        gmail_message_id: "m-4",
      }),
    );
    const label = events.find((e) => e[0] === "held")?.[1].senderName;
    expect(label).not.toMatch(/[\u0000-\u001f]/);
  });
});
