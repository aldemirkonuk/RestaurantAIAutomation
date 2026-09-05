/**
 * The transport, and the guard that makes "no charges" structural.
 *
 * ADR 0110 said this build stops at "a card on file" because pricing was an
 * open decision (OD-23). A comment saying so does not survive a contributor who
 * has not read it; `FORBIDDEN_PATHS` does. These tests prove the guard throws
 * AND that no HTTP request is built when it does — a guard that refuses after
 * the call has gone out is decoration.
 *
 * WHAT CHANGED ON 2026-09-06, AND WHAT DID NOT
 * --------------------------------------------
 * The founder answered OD-23's message-billing half and decided the credit
 * purchase charges the card on file (ADR 0121 addendum, Q2). The guard's own
 * refusal named that as its precondition — "Removing this guard is a decision,
 * not a refactor" — so exactly ONE door was cut through it: `chargeCardOnFile`,
 * for a PaymentIntent behind a redeemed seal.
 *
 * Everything else stayed shut, and the tests below are what keep it that way:
 * `payment_intents` is STILL refused through the ordinary `post`, so a second
 * charging caller fails; and every other money-moving resource is refused with
 * or without the exemption, so the door cannot be widened by reusing the key.
 */

import { ServiceUnavailableException } from "@nestjs/common";
import axios from "axios";
import { StripeClient } from "./stripe.client";
import { StripeConfigService } from "./stripe-config.service";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeClient(secret: string | null = "sk_test_key") {
  const post = jest.fn().mockResolvedValue({ data: { id: "ok" } });
  const get = jest.fn().mockResolvedValue({ data: { data: [] } });
  mockedAxios.create.mockReturnValue({ post, get } as never);

  const config = {
    secretKey: () => secret,
    apiVersion: () => "2024-06-20",
    state: () => ({
      connected: secret !== null,
      reason: secret
        ? null
        : "Stripe is not connected — STRIPE_SECRET_KEY is not set.",
    }),
  } as unknown as StripeConfigService;

  return { client: new StripeClient(config), post, get };
}

beforeEach(() => jest.clearAllMocks());

describe("StripeClient — the money-moving resources are unreachable", () => {
  const forbidden = [
    "payment_intents",
    "charges",
    "subscriptions",
    "invoices",
    "refunds",
    "transfers",
    "payouts",
    "checkout/sessions",
  ];

  it.each(forbidden)("refuses to call /%s, and sends nothing", async (path) => {
    const { client, post } = makeClient();
    await expect(
      (
        client as unknown as {
          post: (p: string, b: Record<string, unknown>) => Promise<unknown>;
        }
      ).post(path, {}),
    ).rejects.toThrow(/takes money in exactly one place/);
    expect(post).not.toHaveBeenCalled();
  });

  it("STILL refuses /payment_intents through the ordinary post, after the one door was cut", async () => {
    // The whole point of keeping the entry on the deny-list rather than
    // deleting it: `chargeCardOnFile` can charge, and a second caller cannot.
    const { client, post } = makeClient();
    await expect(
      (
        client as unknown as {
          post: (p: string, b: Record<string, unknown>) => Promise<unknown>;
        }
      ).post("payment_intents", { amount: 5000 }),
    ).rejects.toThrow(/takes money in exactly one place/);
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses a sub-path of a forbidden resource too", async () => {
    const { client, post } = makeClient();
    await expect(
      (
        client as unknown as {
          get: (p: string, q: Record<string, unknown>) => Promise<unknown>;
        }
      ).get("payment_intents/pi_123", {}),
    ).rejects.toThrow(/ADR 0110/);
    expect(post).not.toHaveBeenCalled();
  });

  it("still allows the four calls the build needs", async () => {
    const { client, post, get } = makeClient();
    await client.createSetupIntent({
      customerId: "cus_1",
      restaurantId: "r1",
      sealId: "seal-1",
    });
    await client.listPaymentMethods("cus_1");
    await client.detachPaymentMethod("pm_1");
    expect(post).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("StripeClient.chargeCardOnFile — the one door, and what goes through it", () => {
  /**
   * NO LIVE STRIPE CALL. `axios` is mocked at module scope for this whole file
   * and `makeClient` hands back the `post` spy, so what is asserted is the
   * REQUEST this product would make — the path, the body and the idempotency
   * header — against Stripe's documented PaymentIntent parameters. A test that
   * reached Stripe would be a test that can take money.
   */
  it("posts a confirmed off-session PaymentIntent for the stated amount", async () => {
    const { client, post } = makeClient();
    await client.chargeCardOnFile({
      customerId: "cus_1",
      paymentMethodId: "pm_1",
      amountMinor: 5000,
      currency: "USD",
      restaurantId: "r1",
      sealId: "seal-1",
      idempotencyKey: "text-credits:seal-1",
      description: "Mudavym message credits",
    });

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body, options] = post.mock.calls[0];
    expect(path).toBe("/payment_intents");
    const sent = new URLSearchParams(body as string);
    expect(sent.get("amount")).toBe("5000");
    // Lower-cased for Stripe in exactly one place; the ledger holds ISO 4217
    // upper-case, and the two must not drift.
    expect(sent.get("currency")).toBe("usd");
    expect(sent.get("customer")).toBe("cus_1");
    expect(sent.get("payment_method")).toBe("pm_1");
    expect(sent.get("confirm")).toBe("true");
    expect(sent.get("off_session")).toBe("true");
    // The seal travels in metadata, the same way the SetupIntent carries its
    // own: it is the only thing that survives the round trip.
    expect(sent.get("metadata[mudavym_seal_id]")).toBe("seal-1");
    expect(sent.get("metadata[mudavym_restaurant_id]")).toBe("r1");
    expect(sent.get("metadata[mudavym_purpose]")).toBe("text_credit_purchase");
    expect(
      (options as { headers?: Record<string, string> })?.headers?.[
        "Idempotency-Key"
      ],
    ).toBe("text-credits:seal-1");
  });

  it("refuses without a credential rather than failing at the network", async () => {
    const { client, post } = makeClient(null);
    await expect(
      client.chargeCardOnFile({
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        amountMinor: 5000,
        currency: "USD",
        restaurantId: "r1",
        sealId: "seal-1",
        idempotencyKey: "text-credits:seal-1",
        description: "Mudavym message credits",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("StripeClient — without a credential", () => {
  it("refuses with the provider's own reason rather than a network error", async () => {
    const { client, post } = makeClient(null);
    await expect(client.listPaymentMethods("cus_1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(post).not.toHaveBeenCalled();
  });
});

describe("StripeClient — form encoding", () => {
  it("nests objects the way Stripe expects", () => {
    const form = StripeClient.form({
      customer: "cus_1",
      metadata: { mudavym_restaurant_id: "r1" },
      invoice_settings: { default_payment_method: "pm_1" },
    });
    expect(form.get("customer")).toBe("cus_1");
    expect(form.get("metadata[mudavym_restaurant_id]")).toBe("r1");
    expect(form.get("invoice_settings[default_payment_method]")).toBe("pm_1");
  });

  it("drops undefined and null rather than sending the string 'undefined'", () => {
    const form = StripeClient.form({ a: undefined, b: null, c: "" });
    expect(form.has("a")).toBe(false);
    expect(form.has("b")).toBe(false);
    expect(form.get("c")).toBe("");
  });

  it("carries an Idempotency-Key on every POST", async () => {
    const { client, post } = makeClient();
    await client.createCustomer({
      name: "Ada Lokantası",
      restaurantId: "r1",
      idempotencyKey: "mudavym:customer:r1:test",
    });
    expect(post.mock.calls[0][2].headers["Idempotency-Key"]).toBe(
      "mudavym:customer:r1:test",
    );
  });
});
