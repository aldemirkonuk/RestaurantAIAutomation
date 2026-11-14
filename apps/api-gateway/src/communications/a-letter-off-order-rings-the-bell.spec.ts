/**
 * r38 (2026-11-13), gap 6: mail that arrives while nobody is looking leaves
 * a notice.
 *
 * A vendor's letter on no order raised only the live toast, which is lost
 * when no screen is open. It now also rings the bell of the house's owners
 * and managers (the people who may answer it), once per thread while that
 * notice is unread. Mass mail does not ring it, and a letter on an order is
 * left to the responder, as before.
 */
import {
  LETTER_BELL_ROLES,
  offOrderLetterNotice,
} from "../common/orchestrator/rabbitmq-bridge.service";
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
const house = (
  orders: Row[] = [],
  notifications: Row[] = [],
): Record<string, Row[]> => ({
  restaurants: [{ id: "house-A" }],
  providers: [PROVIDER],
  procurement_orders: orders,
  procurement_conversations: [],
  notifications,
});
const bells = (events: any[]) =>
  events.filter((e) => e[0] === "persistManagerNotification");
const letter = (o: Record<string, any> = {}) =>
  inbound({
    restaurant_id: "house-A",
    from: `BigDist <${VENDOR}>`,
    subject: "Price list for December",
    gmail_message_id: "m-1",
    ...o,
  });
const unread = (o: Record<string, any> = {}): Row => ({
  id: "n-1",
  restaurant_id: "house-A",
  status: "unread",
  metadata: { kind: "vendor_letter", mail_key: "vendor:prov-A" },
  ...o,
});

describe("the notice itself", () => {
  const base = {
    providerId: "prov-A",
    providerName: "BigDist",
    senderEmail: VENDOR,
    subject: "Price list for December",
    threadKey: "gm:18c2",
  };

  it("names the vendor, quotes the subject, and opens the thread in Mail", () => {
    const { mailKey, notice } = offOrderLetterNotice(base);
    expect(mailKey).toBe("thread:gm:18c2");
    expect(notice).toEqual({
      type: "vendor_reply",
      title: "BigDist wrote to the house",
      message:
        '"Price list for December", from sales@bigdist.com. It is not on an order, and it waits for the house\'s reply on the Mail tab in Communications.',
      priority: "low",
      actionUrl:
        "/communications?tab=mail&with=vendor%3Aprov-A&thread=gm%3A18c2",
      metadata: {
        kind: "vendor_letter",
        mail_key: "thread:gm:18c2",
        provider_id: "prov-A",
        thread_key: "gm:18c2",
      },
    });
  });

  it("with no thread key, or a blank one, it stands for the vendor", () => {
    for (const threadKey of [null, "   "]) {
      const { mailKey, notice } = offOrderLetterNotice({ ...base, threadKey });
      expect(mailKey).toBe("vendor:prov-A");
      expect(notice.actionUrl).toBe(
        "/communications?tab=mail&with=vendor%3Aprov-A",
      );
      expect(notice.metadata.thread_key).toBeNull();
    }
  });

  it("a vendor with no name on file is named by the address it wrote from", () => {
    for (const providerName of [null, "  "]) {
      const { notice } = offOrderLetterNotice({ ...base, providerName });
      expect(notice.title).toBe("sales@bigdist.com wrote to the house");
    }
  });

  it("a letter with no subject says so, and a long one is cut at 80", () => {
    expect(
      offOrderLetterNotice({ ...base, subject: "  " }).notice.message,
    ).toMatch(/^A letter with no subject, from sales@bigdist\.com\./);
    const long = "x".repeat(120);
    expect(
      offOrderLetterNotice({ ...base, subject: long }).notice.message,
    ).toMatch(new RegExp(`^"${"x".repeat(80)}", from`));
  });

  it("rings only the people who may answer it", () => {
    expect([...LETTER_BELL_ROLES]).toEqual(["owner", "manager"]);
  });
});

describe("a vendor's letter on no order", () => {
  it("rings the bell once, for owners and managers, opening the vendor in Mail", async () => {
    const { svc, events } = bridge(house());
    await expect(svc.handleInboundEmail(letter())).resolves.toBe("filed");
    const rung = bells(events);
    expect(rung).toHaveLength(1);
    const [, restaurantId, n, opts] = rung[0];
    expect(restaurantId).toBe("house-A");
    expect(n.type).toBe("vendor_reply");
    expect(n.title).toBe("BigDist wrote to the house");
    expect(n.actionUrl).toBe("/communications?tab=mail&with=vendor%3Aprov-A");
    expect(n.metadata.mail_key).toBe("vendor:prov-A");
    expect(opts).toEqual({ roles: LETTER_BELL_ROLES });
  });

  it("the live toast still fires beside it", async () => {
    const { svc, events } = bridge(house());
    await svc.handleInboundEmail(letter());
    expect(
      events.filter((e) => e[0] === "emitRestaurantNotification"),
    ).toHaveLength(1);
  });

  it("does not ring again while the house's notice for it is unread", async () => {
    const { svc, events } = bridge(house([], [unread()]));
    await svc.handleInboundEmail(letter());
    expect(bells(events)).toHaveLength(0);
  });

  it("rings again once that notice was read", async () => {
    const { svc, events } = bridge(house([], [unread({ status: "read" })]));
    await svc.handleInboundEmail(letter());
    expect(bells(events)).toHaveLength(1);
  });

  it("another house's unread notice for the same key does not silence it", async () => {
    const { svc, events } = bridge(
      house([], [unread({ restaurant_id: "house-B" })]),
    );
    await svc.handleInboundEmail(letter());
    expect(bells(events)).toHaveLength(1);
  });

  it("an unread notice for another vendor does not silence it", async () => {
    const { svc, events } = bridge(
      house([], [unread({ metadata: { mail_key: "vendor:prov-B" } })]),
    );
    await svc.handleInboundEmail(letter());
    expect(bells(events)).toHaveLength(1);
  });

  it("rings anyway when the notices cannot be read", async () => {
    const { svc, events } = bridge(house([], [unread()]), ["notifications"]);
    await svc.handleInboundEmail(letter());
    expect(bells(events)).toHaveLength(1);
  });

  it.each([
    ["bulk", { precedence: "bulk" }],
    ["list", { "list-unsubscribe": "<mailto:out@bigdist.com>" }],
    ["auto-submitted", { "auto-submitted": "auto-replied" }],
  ])("mass mail (%s) does not ring it", async (_kind, headers) => {
    const { svc, events } = bridge(house());
    await svc.handleInboundEmail(letter({ headers }));
    expect(bells(events)).toHaveLength(0);
  });
});

describe("a vendor's letter on an order", () => {
  it("does not ring this bell: the responder has the order's notices", async () => {
    const { svc, events } = bridge(house([ORDER]));
    await svc.handleInboundEmail(letter());
    expect(bells(events)).toHaveLength(0);
    expect(events.some((e) => e[0] === "responder")).toBe(true);
  });
});
