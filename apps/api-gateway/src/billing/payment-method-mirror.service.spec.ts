/**
 * The mapping is where a fabricated value would enter the register, so it is a
 * pure static function and it is tested directly.
 *
 * Two assertions matter more than the rest: an unmapped Stripe type must NOT
 * become `card` (a quiet lie about something that will be charged), and a
 * half-known expiry must become null rather than a padded date.
 */

import { PaymentMethodMirrorService } from "./payment-method-mirror.service";
import type { StripePaymentMethod } from "./stripe.client";

const AT = "2026-09-03T12:00:00.000Z";

function pm(over: Partial<StripePaymentMethod> = {}): StripePaymentMethod {
  return {
    id: "pm_1",
    type: "card",
    livemode: false,
    created: 1,
    card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2029 },
    ...over,
  } as StripePaymentMethod;
}

describe("PaymentMethodMirrorService.toRow", () => {
  it("copies the provider's answer, and stamps when it heard it", () => {
    const row = PaymentMethodMirrorService.toRow("r1", pm(), AT);
    expect(row).toMatchObject({
      restaurant_id: "r1",
      kind: "card",
      brand: "visa",
      last4: "4242",
      exp: "04/2029",
      provider: "stripe",
      provider_ref: "pm_1",
      provider_type: "card",
      synced_at: AT,
    });
  });

  it("maps the bank-debit types onto bank_account", () => {
    for (const type of ["us_bank_account", "sepa_debit", "bacs_debit", "acss_debit"]) {
      expect(PaymentMethodMirrorService.toRow("r1", pm({ type }), AT).kind).toBe(
        "bank_account",
      );
    }
  });

  it("files an UNMAPPED type as other, keeping the provider's own word", () => {
    const row = PaymentMethodMirrorService.toRow("r1", pm({ type: "cashapp" }), AT);
    expect(row.kind).toBe("other");
    expect(row.provider_type).toBe("cashapp");
    // The lie this test exists to prevent
    expect(row.kind).not.toBe("card");
  });

  it("leaves the expiry null when only half of it is known", () => {
    expect(
      PaymentMethodMirrorService.toRow(
        "r1",
        pm({ card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: null } }),
        AT,
      ).exp,
    ).toBeNull();
    expect(
      PaymentMethodMirrorService.toRow("r1", pm({ type: "cashapp", card: null }), AT)
        .exp,
    ).toBeNull();
  });

  it("refuses to carry anything into last4 that is not four digits", () => {
    const row = PaymentMethodMirrorService.toRow(
      "r1",
      pm({ card: { last4: "4242424242424242" } }),
      AT,
    );
    expect(row.last4).toBeNull();
  });

  it("takes a bank's name and last four when there is no card object", () => {
    const row = PaymentMethodMirrorService.toRow(
      "r1",
      pm({
        type: "us_bank_account",
        card: null,
        us_bank_account: { bank_name: "Ziraat", last4: "6789" },
      }),
      AT,
    );
    expect(row).toMatchObject({ kind: "bank_account", brand: "Ziraat", last4: "6789" });
  });

  it("records livemode from the provider rather than assuming it", () => {
    expect(PaymentMethodMirrorService.toRow("r1", pm({ livemode: true }), AT).livemode).toBe(
      true,
    );
    expect(PaymentMethodMirrorService.toRow("r1", pm({ livemode: false }), AT).livemode).toBe(
      false,
    );
  });

  it("writes no cardholder, address, PAN or CVC field", () => {
    const row = PaymentMethodMirrorService.toRow("r1", pm(), AT) as unknown as Record<
      string,
      unknown
    >;
    for (const forbidden of ["pan", "number", "cvc", "address", "name", "fingerprint"]) {
      expect(Object.keys(row)).not.toContain(forbidden);
    }
  });
});
