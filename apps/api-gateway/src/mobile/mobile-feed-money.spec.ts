/**
 * The phone feed's order line prints the order's own money, in whole units:
 * lira reads lira, an order that names no currency reads a bare figure, a
 * dollar order still reads `$`. Never an assumed dollar.
 */
import { MobileService } from "./mobile.service";

const svc: any = Object.create(MobileService.prototype);
const names = new Map([["p1", "Terroir"]]);

function subtitle(over: Record<string, any>) {
  return svc.orderSubtitle(
    { quantity: 6, providerId: "p1", totalCost: 1240.5, ...over },
    names,
  );
}

describe("mobile feed order subtitle", () => {
  it("[REVERT-FAILS] says a lira order in lira", () => {
    const s = subtitle({ currency: "TRY" });
    expect(s).toContain("₺1,241");
    expect(s).not.toContain("$");
  });

  it("[REVERT-FAILS] says an order with no currency bare", () => {
    for (const currency of [undefined, null, "nonsense"]) {
      const s = subtitle({ currency });
      expect(s).toBe("6 bottles · Terroir · 1,241");
      expect(s).not.toContain("$");
    }
  });

  it("still says a dollar order with $", () => {
    expect(subtitle({ currency: "USD" })).toContain("$1,241");
  });
});
