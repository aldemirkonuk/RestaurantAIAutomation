/**
 * The two order senders print a per-bottle figure in the order's own money.
 * They have no HTTP caller today (closed by ADR 0149), so they are exercised
 * directly: a lira order reads lira, an order with no stated currency reads a
 * bare figure, a dollar order still reads `$`. Never an assumed dollar.
 */
import { NotificationsService } from "./notifications.service";

function senderWith() {
  const sent: any[] = [];
  const svc: any = Object.create(NotificationsService.prototype);
  svc.sendToUser = jest.fn(async (_user: string, payload: any) => {
    sent.push(payload);
  });
  return { svc: svc as NotificationsService, sent };
}

const approval = {
  userId: "u1",
  orderId: "o1",
  wineName: "Sancerre",
  quantity: 6,
  providerName: "Terroir",
  price: 1240.5,
};

const offer = {
  userId: "u1",
  orderId: "o1",
  wineName: "Sancerre",
  currentPrice: 50,
  proposedPrice: 42,
  providerName: "Terroir",
};

describe("order notification senders say the order's own money", () => {
  it("[REVERT-FAILS] order approval: lira, bare and dollars", async () => {
    const { svc, sent } = senderWith();
    await svc.sendOrderApprovalNotification({ ...approval, currency: "TRY" });
    await svc.sendOrderApprovalNotification({ ...approval });
    await svc.sendOrderApprovalNotification({ ...approval, currency: "USD" });
    expect(sent[0].body).toContain("(₺1,240.50/bottle)");
    expect(sent[0].body).not.toContain("$");
    expect(sent[1].body).toContain("(1,240.50/bottle)");
    expect(sent[1].body).not.toContain("$");
    expect(sent[2].body).toContain("($1,240.50/bottle)");
  });

  it("[REVERT-FAILS] price offer: lira, bare and dollars", async () => {
    const { svc, sent } = senderWith();
    await svc.sendPriceNegotiationNotification({ ...offer, currency: "TRY" });
    await svc.sendPriceNegotiationNotification({ ...offer });
    await svc.sendPriceNegotiationNotification({ ...offer, currency: "USD" });
    expect(sent[0].body).toContain("offered ₺42.00/bottle");
    expect(sent[0].body).not.toContain("$");
    expect(sent[1].body).toContain("offered 42.00/bottle");
    expect(sent[1].body).not.toContain("$");
    expect(sent[2].body).toContain("offered $42.00/bottle");
  });
});
