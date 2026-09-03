/**
 * The transport, and the guard that makes "no charges" structural.
 *
 * ADR 0110 says this build stops at "a card on file" because pricing is an
 * open decision (OD-23). A comment saying so does not survive a contributor who
 * has not read it; `FORBIDDEN_PATHS` does. These tests prove the guard throws
 * AND that no HTTP request is built when it does — a guard that refuses after
 * the call has gone out is decoration.
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
      reason: secret ? null : "Stripe is not connected — STRIPE_SECRET_KEY is not set.",
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
      (client as unknown as {
        post: (p: string, b: Record<string, unknown>) => Promise<unknown>;
      }).post(path, {}),
    ).rejects.toThrow(/stops at "a card on file"/);
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses a sub-path of a forbidden resource too", async () => {
    const { client, post } = makeClient();
    await expect(
      (client as unknown as {
        get: (p: string, q: Record<string, unknown>) => Promise<unknown>;
      }).get("payment_intents/pi_123", {}),
    ).rejects.toThrow(/ADR 0110/);
    expect(post).not.toHaveBeenCalled();
  });

  it("still allows the four calls the build needs", async () => {
    const { client, post, get } = makeClient();
    await client.createSetupIntent({ customerId: "cus_1", restaurantId: "r1" });
    await client.listPaymentMethods("cus_1");
    await client.detachPaymentMethod("pm_1");
    expect(post).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(1);
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
