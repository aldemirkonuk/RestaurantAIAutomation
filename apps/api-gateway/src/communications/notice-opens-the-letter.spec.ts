/**
 * r21 (2026-11-13): a notice about mail opens the place that letter is.
 *
 * - A stranger's letter and a held letter (sender unconfirmed, or a From that
 *   names nobody) live in "Who is writing". Their notices linked to the bare
 *   /communications, which opens Letters with that register folded at the
 *   foot of the page; they now open it (`?senders=open`).
 * - A vendor's reply on no order carried no link at all; it now opens the
 *   vendor in Mail (and the thread, when the stored row has a thread key).
 * - A vendor's reply on an order still opens the order, as before.
 */
import {
  WHO_IS_WRITING_URL,
  mailThreadUrl,
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
const house = (orders: Row[] = [ORDER]): Record<string, Row[]> => ({
  restaurants: [{ id: "house-A" }],
  providers: [PROVIDER],
  procurement_orders: orders,
  procurement_conversations: [],
});
const FAIL = `mx.google.com; spf=fail smtp.mailfrom=${VENDOR}; dmarc=fail (p=REJECT) header.from=bigdist.com`;

const emitted = (events: any[]) =>
  events.filter((e) => e[0] === "emitRestaurantNotification").map((e) => e[2]);
const persisted = (events: any[]) =>
  events.filter((e) => e[0] === "persistManagerNotification").map((e) => e[2]);

describe("the links themselves", () => {
  it("Who is writing opens with its register open", () => {
    expect(WHO_IS_WRITING_URL).toBe("/communications?senders=open");
  });

  it("a vendor's thread in Mail, encoded", () => {
    expect(mailThreadUrl("prov-A", "gm:18c2 a")).toBe(
      "/communications?tab=mail&with=vendor%3Aprov-A&thread=gm%3A18c2+a",
    );
  });

  it("no thread key, or a blank one, opens the vendor's threads", () => {
    expect(mailThreadUrl("prov-A", null)).toBe(
      "/communications?tab=mail&with=vendor%3Aprov-A",
    );
    expect(mailThreadUrl("prov-A", "   ")).toBe(
      "/communications?tab=mail&with=vendor%3Aprov-A",
    );
  });
});

describe("a held letter's notice opens Who is writing", () => {
  it("sender unconfirmed: the live notice and the kept one both link there, and say Mail", async () => {
    const { svc, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: `BigDist <${VENDOR}>`,
        subject: "New bank details",
        gmail_message_id: "m-held",
        ingress_authentication_results: FAIL,
      }),
    );
    expect(emitted(events)).toHaveLength(1);
    expect(emitted(events)[0].action_url).toBe("/communications?senders=open");
    expect(emitted(events)[0].message).toContain("on the Mail tab under Who is writing");
    expect(persisted(events)).toHaveLength(1);
    expect(persisted(events)[0].actionUrl).toBe("/communications?senders=open");
  });
});

describe("a vendor's reply", () => {
  it("on no order opens the vendor in Mail (it had no link at all)", async () => {
    const { svc, events } = bridge(house([]));
    await svc.handleInboundEmail(
      inbound({ restaurant_id: "house-A", from: VENDOR, gmail_message_id: "m-none" }),
    );
    expect(emitted(events)).toHaveLength(1);
    expect(emitted(events)[0].action_url).toBe(
      "/communications?tab=mail&with=vendor%3Aprov-A",
    );
  });

  it("on an order still opens the order", async () => {
    const { svc, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({ restaurant_id: "house-A", from: VENDOR, gmail_message_id: "m-order" }),
    );
    expect(emitted(events)[0].action_url).toBe("/orders?order=order-A");
  });
});
