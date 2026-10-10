import { NotificationsService } from "./notifications.service";

/**
 * F-889 — the order-approval and price-offer push bodies printed a literal
 * `$…/bottle` whatever the house's money. A lira house now reads its offer in
 * lira, grouped its own way; a house that recorded no money reads the bare
 * figure, never a guessed dollar.
 *
 * [REVERT-FAILS] marks a test that fails against the code before F-889.
 */

function houseDb(row: Record<string, unknown> | null) {
  const q: any = {
    select: () => q,
    eq: () => q,
    limit: () => Promise.resolve({ data: row ? [row] : [], error: null }),
  };
  return { supabase: { from: () => q } } as any;
}

function service(row: Record<string, unknown> | null) {
  const svc = new NotificationsService(
    { server: { to: () => ({ emit: () => undefined }) } } as any,
    { get: () => undefined } as any,
    houseDb(row),
  );
  const sent = jest.spyOn(svc, "sendToUser").mockResolvedValue(null);
  return { svc, sent };
}

const LIRA = { currency: "TRY", country: "TR", timezone: "Europe/Istanbul" };

describe("push bodies say money the house's way (F-889)", () => {
  it("[REVERT-FAILS] a lira house's order-approval body names lira, grouped", async () => {
    const { svc, sent } = service(LIRA);
    await svc.sendOrderApprovalNotification({
      userId: "u-1",
      restaurantId: "r-1",
      orderId: "o-1",
      wineName: "Kalecik Karası",
      quantity: 12,
      providerName: "Ege Şarap",
      price: 1240.5,
    });
    const body = sent.mock.calls[0][1].body;
    expect(body).toBe(
      "12 bottles of Kalecik Karası from Ege Şarap (₺1.240,50 a bottle)",
    );
    expect(body).not.toMatch(/\$/);
  });

  it("[REVERT-FAILS] a lira house's price-offer body names lira and its percent", async () => {
    const { svc, sent } = service(LIRA);
    await svc.sendPriceNegotiationNotification({
      userId: "u-1",
      restaurantId: "r-1",
      orderId: "o-1",
      wineName: "Kalecik Karası",
      currentPrice: 1600,
      proposedPrice: 1400,
      providerName: "Ege Şarap",
    });
    const body = sent.mock.calls[0][1].body;
    expect(body).toBe(
      "Ege Şarap offered ₺1.400,00 a bottle for Kalecik Karası (%12,5 lower)",
    );
  });

  it("[REVERT-FAILS] a house with no recorded money reads the bare figure, never a dollar", async () => {
    const { svc, sent } = service(null);
    await svc.sendPriceNegotiationNotification({
      userId: "u-1",
      restaurantId: "r-1",
      orderId: "o-1",
      wineName: "Rioja",
      currentPrice: 40,
      proposedPrice: 44,
      providerName: "Iberia",
    });
    const body = sent.mock.calls[0][1].body;
    expect(body).toBe("Iberia offered 44.00 a bottle for Rioja (10.0% higher)");
  });
});
