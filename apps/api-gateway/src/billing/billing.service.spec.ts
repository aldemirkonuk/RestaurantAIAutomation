/**
 * BillingService — the provider path, with the provider stubbed.
 *
 * The four assertions that carry the design:
 *
 *  1. Without `STRIPE_SECRET_KEY` every provider call refuses with the reason
 *     and touches nothing. The 503 is the same one the page's disabled submit
 *     quotes.
 *  2. A SetupIntent is minted, and it is a SetupIntent — the stub records the
 *     path, so a build that quietly created a PaymentIntent would fail here.
 *  3. A redelivered webhook that was already APPLIED is refused; a redelivery
 *     of one that failed halfway is PROCESSED. Getting only the first half
 *     right is the common bug and it silently swallows the event that tells us
 *     a card was removed.
 *  4. An event we ignore is RECORDED as ignored with its reason. A delivery log
 *     holding only the events we liked reports absence as health.
 */

import {
  InternalServerErrorException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { BillingService } from "./billing.service";
import { BillingCustomerService } from "./billing-customer.service";
import { PaymentMethodMirrorService } from "./payment-method-mirror.service";
import { StripeClient } from "./stripe.client";
import { StripeConfigService } from "./stripe-config.service";
import type { DatabaseService } from "../database/database.service";
import * as crypto from "crypto";

const SECRET = "whsec_test_key";
const NOW = Math.floor(Date.now() / 1000);

function signed(body: unknown): { raw: Buffer; header: string } {
  const raw = Buffer.from(JSON.stringify(body));
  const mac = crypto
    .createHmac("sha256", SECRET)
    .update(`${NOW}.${raw.toString("utf8")}`, "utf8")
    .digest("hex");
  return { raw, header: `t=${NOW},v1=${mac}` };
}

interface Harness {
  service: BillingService;
  events: Record<string, { handled: boolean; outcome: string }>;
  inserted: string[];
  mirror: { upserted: unknown[]; removed: string[] };
  stripeCalls: string[];
  /**
   * MUTABLE, so one harness can fail a delivery and then succeed on the
   * redelivery. That sequence is the whole retry contract; a fixture that can
   * only be born broken cannot express it.
   */
  fail: { mode: "mirror" | "stripe" | null; message: string };
}

function makeService(
  opts: {
    secretKey?: string | null;
    webhookSecret?: string | null;
    existingEvent?: { handled: boolean } | null;
    customerId?: string | null;
    restaurantForCustomer?: string | null;
    /** Which half of `apply()` throws: the provider fetch, or the write. */
    failApply?: "mirror" | "stripe" | null;
    failMessage?: string;
  } = {},
): Harness {
  const events: Record<string, { handled: boolean; outcome: string }> = {};
  const inserted: string[] = [];
  const mirror = { upserted: [] as unknown[], removed: [] as string[] };
  const stripeCalls: string[] = [];
  const existing = opts.existingEvent ?? null;
  const fail: Harness["fail"] = {
    mode: opts.failApply ?? null,
    message: opts.failMessage ?? "statement timeout",
  };

  const db = {
    supabase: {
      from: (table: string) => {
        const state: Record<string, unknown> = {};
        const self: Record<string, unknown> = {
          insert: (payload: Record<string, unknown>) => {
            if (table === "billing_webhook_events") {
              const id = String(payload.event_id);
              if (existing || events[id]) {
                return Promise.resolve({
                  data: null,
                  error: { message: "duplicate key value violates unique constraint" },
                });
              }
              inserted.push(id);
              events[id] = { handled: false, outcome: String(payload.outcome) };
            }
            return Promise.resolve({ data: null, error: null });
          },
          update: (payload: Record<string, unknown>) => {
            state.update = payload;
            return self;
          },
          select: () => self,
          eq: (col: string, value: unknown) => {
            if (col === "event_id") state.eventId = String(value);
            return self;
          },
          order: () => self,
          limit: () => self,
          maybeSingle: () => {
            if (table === "billing_webhook_events") {
              if (state.update) {
                const id = String(state.eventId);
                const patch = state.update as Record<string, unknown>;
                events[id] = {
                  handled: Boolean(patch.handled),
                  outcome: String(patch.outcome),
                };
                return Promise.resolve({ data: null, error: null });
              }
              const id = String(state.eventId);
              const row = existing ?? events[id] ?? null;
              return Promise.resolve({ data: row, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          then: (resolve: (v: unknown) => unknown) => {
            if (table === "billing_webhook_events" && state.update) {
              const id = String(state.eventId);
              const patch = state.update as Record<string, unknown>;
              events[id] = {
                handled: Boolean(patch.handled),
                outcome: String(patch.outcome),
              };
            }
            return resolve({ data: null, error: null });
          },
        };
        return self;
      },
    },
  } as unknown as DatabaseService;

  // `??` would be wrong here: `secretKey: null` is the case under test, and
  // nullish-coalescing would quietly turn it back into a configured key.
  const secretKey =
    opts.secretKey === undefined ? "sk_test_key" : opts.secretKey;

  const config = {
    connected: () => secretKey !== null,
    secretKey: () => secretKey,
    webhookSecret: () =>
      opts.webhookSecret === undefined ? SECRET : opts.webhookSecret,
    apiVersion: () => "2024-06-20",
    mode: () => "test",
    livemode: () => false,
    state: () => ({
      connected: secretKey !== null,
      reason:
        secretKey !== null
          ? null
          : "Stripe is not connected — STRIPE_SECRET_KEY is not set on this deployment, so no payment method can be taken and none could exist to list.",
    }),
  } as unknown as StripeConfigService;

  const stripe = {
    createSetupIntent: (input: { customerId: string }) => {
      stripeCalls.push(`setup_intents:${input.customerId}`);
      return Promise.resolve({
        id: "seti_1",
        client_secret: "seti_1_secret_abc",
        status: "requires_payment_method",
        livemode: false,
        payment_method: null,
      });
    },
    listPaymentMethods: (customerId: string) => {
      stripeCalls.push(`list:${customerId}`);
      return Promise.resolve([
        { id: "pm_1", type: "card", livemode: false, created: 1, card: { last4: "4242" } },
      ]);
    },
    retrievePaymentMethod: (id: string) => {
      stripeCalls.push(`retrieve:${id}`);
      if (fail.mode === "stripe") return Promise.reject(new Error(fail.message));
      return Promise.resolve({
        id,
        type: "card",
        livemode: false,
        created: 1,
        card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2029 },
      });
    },
  } as unknown as StripeClient;

  const customerId =
    opts.customerId === undefined ? "cus_1" : opts.customerId;

  const customers = {
    ensure: () => Promise.resolve(customerId),
    find: () => Promise.resolve(customerId),
    restaurantFor: () =>
      Promise.resolve(
        opts.restaurantForCustomer === undefined
          ? "r1"
          : opts.restaurantForCustomer,
      ),
  } as unknown as BillingCustomerService;

  const mirrorService = {
    reconcile: (_r: string, methods: unknown[]) => {
      mirror.upserted.push(...methods);
      return Promise.resolve({ kept: methods.length, removed: 0 });
    },
    upsertOne: (_r: string, pm: unknown) => {
      if (fail.mode === "mirror") return Promise.reject(new Error(fail.message));
      mirror.upserted.push(pm);
      return Promise.resolve();
    },
    removeByRef: (ref: string) => {
      if (fail.mode === "mirror") return Promise.reject(new Error(fail.message));
      mirror.removed.push(ref);
      return Promise.resolve(1);
    },
  } as unknown as PaymentMethodMirrorService;

  return {
    service: new BillingService(db, config, stripe, customers, mirrorService),
    fail,
    events,
    inserted,
    mirror,
    stripeCalls,
  };
}

describe("BillingService — with no credential", () => {
  it("refuses a SetupIntent with the provider's stated reason, and calls nothing", async () => {
    const h = makeService({ secretKey: null });
    await expect(h.service.createSetupIntent("r1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(h.service.createSetupIntent("r1")).rejects.toThrow(
      /STRIPE_SECRET_KEY is not set/,
    );
    expect(h.stripeCalls).toEqual([]);
  });

  it("refuses a sync for the same reason", async () => {
    const h = makeService({ secretKey: null });
    await expect(h.service.sync("r1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(h.stripeCalls).toEqual([]);
  });
});

describe("BillingService — with a credential", () => {
  it("mints a SETUP intent, never a payment intent", async () => {
    const h = makeService();
    const out = await h.service.createSetupIntent("r1");
    expect(out.clientSecret).toBe("seti_1_secret_abc");
    expect(out.mode).toBe("test");
    expect(h.stripeCalls).toEqual(["setup_intents:cus_1"]);
    expect(h.stripeCalls.join()).not.toMatch(/payment_intents|charges/);
  });

  it("says so in words when a restaurant has no provider account yet", async () => {
    const h = makeService({ customerId: null });
    const out = await h.service.sync("r1");
    expect(out.kept).toBe(0);
    expect(out.note).toMatch(/no account at the provider yet/);
    expect(h.stripeCalls).toEqual([]);
  });

  it("reconciles the register against the provider's list", async () => {
    const h = makeService();
    const out = await h.service.sync("r1");
    expect(out.kept).toBe(1);
    expect(h.mirror.upserted).toHaveLength(1);
    expect(out.syncedAt).toEqual(expect.any(String));
  });
});

describe("BillingService — the webhook fails closed and says which check failed", () => {
  it("refuses everything when no webhook secret is configured", async () => {
    const h = makeService({ webhookSecret: null });
    const { raw, header } = signed({ id: "evt_1", type: "payment_method.attached" });
    const out = await h.service.handleWebhook(raw, header);
    expect(out.received).toBe(false);
    expect(out.failure).toBe("no-secret");
    expect(out.reason).toMatch(/STRIPE_WEBHOOK_SECRET is not configured/);
    expect(h.inserted).toEqual([]);
  });

  it("refuses a body whose signature was minted for a different payload", async () => {
    const h = makeService();
    const { header } = signed({ id: "evt_1", type: "payment_method.attached" });
    const out = await h.service.handleWebhook(
      Buffer.from(JSON.stringify({ id: "evt_2", type: "payment_method.detached" })),
      header,
    );
    expect(out.received).toBe(false);
    expect(out.failure).toBe("no-matching-signature");
    expect(h.inserted).toEqual([]);
  });
});

describe("BillingService — the webhook applies exactly once", () => {
  it("records an instrument the provider attached", async () => {
    const h = makeService();
    const { raw, header } = signed({
      id: "evt_a",
      type: "setup_intent.succeeded",
      livemode: false,
      data: { object: { customer: "cus_1", payment_method: "pm_9" } },
    });
    const out = await h.service.handleWebhook(raw, header);

    expect(out).toMatchObject({ received: true, handled: true });
    expect(h.stripeCalls).toContain("retrieve:pm_9");
    expect(h.mirror.upserted).toHaveLength(1);
    expect(h.events["evt_a"]).toEqual({
      handled: true,
      outcome: expect.stringContaining("recorded pm_9"),
    });
  });

  it("removes an instrument the provider detached", async () => {
    const h = makeService();
    const { raw, header } = signed({
      id: "evt_b",
      type: "payment_method.detached",
      livemode: false,
      data: { object: { id: "pm_9" } },
    });
    const out = await h.service.handleWebhook(raw, header);
    expect(out.handled).toBe(true);
    expect(h.mirror.removed).toEqual(["pm_9"]);
  });

  it("refuses a redelivery of an event that was already APPLIED", async () => {
    const h = makeService({ existingEvent: { handled: true } });
    const { raw, header } = signed({
      id: "evt_a",
      type: "payment_method.detached",
      livemode: false,
      data: { object: { id: "pm_9" } },
    });
    const out = await h.service.handleWebhook(raw, header);

    expect(out).toMatchObject({ received: true, handled: false, duplicate: true });
    expect(h.mirror.removed).toEqual([]);
  });

  it("PROCESSES a redelivery of an event that was claimed and never finished", async () => {
    // The half everyone gets wrong. If a claimed-but-unhandled row were treated
    // as a duplicate, a transient failure would permanently swallow the event
    // that tells us a card was removed.
    const h = makeService({ existingEvent: { handled: false } });
    const { raw, header } = signed({
      id: "evt_a",
      type: "payment_method.detached",
      livemode: false,
      data: { object: { id: "pm_9" } },
    });
    const out = await h.service.handleWebhook(raw, header);

    expect(out.duplicate).toBeUndefined();
    expect(out.handled).toBe(true);
    expect(h.mirror.removed).toEqual(["pm_9"]);
  });
});

describe("BillingService — an apply that FAILS is retryable, not lost", () => {
  /**
   * The half the file's own docstring calls out and the suite did not cover.
   *
   * When `apply()` throws, the receipt is settled `handled: false` and the
   * request rethrows a 500 — that 500 is the ONLY thing that makes Stripe
   * redeliver. Two regressions are invisible without these tests: swallowing
   * the error (Stripe sees 200, never retries, the event is gone) and settling
   * `handled: true` on the way out (the redelivery is then refused as a
   * duplicate by the very key that exists to protect us). Either one silently
   * loses the event that says a card was removed.
   */

  const DETACH = {
    id: "evt_fail",
    type: "payment_method.detached",
    livemode: false,
    data: { object: { id: "pm_9" } },
  };

  it("rethrows a 500 so the provider redelivers, instead of swallowing the failure", async () => {
    const h = makeService({ failApply: "mirror", failMessage: "statement timeout" });
    const { raw, header } = signed(DETACH);

    await expect(h.service.handleWebhook(raw, header)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(h.service.handleWebhook(raw, header)).rejects.toThrow(
      /could not be applied: statement timeout/,
    );
  });

  it("leaves the receipt UNHANDLED, carrying the failure's own words", async () => {
    const h = makeService({ failApply: "mirror", failMessage: "statement timeout" });
    const { raw, header } = signed(DETACH);

    await expect(h.service.handleWebhook(raw, header)).rejects.toThrow();

    // Settled, not absent: an unrecorded failure is indistinguishable from a
    // delivery that never arrived.
    expect(h.events["evt_fail"]).toEqual({
      handled: false,
      outcome: "failed: statement timeout",
    });
    expect(h.mirror.removed).toEqual([]);
  });

  it("settles the same way when the PROVIDER fetch fails, before any write", async () => {
    const h = makeService({ failApply: "stripe", failMessage: "Stripe refused the request" });
    const { raw, header } = signed({
      id: "evt_fetch",
      type: "setup_intent.succeeded",
      livemode: false,
      data: { object: { customer: "cus_1", payment_method: "pm_9" } },
    });

    await expect(h.service.handleWebhook(raw, header)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(h.stripeCalls).toContain("retrieve:pm_9");
    expect(h.mirror.upserted).toEqual([]);
    expect(h.events["evt_fetch"].handled).toBe(false);
    expect(h.events["evt_fetch"].outcome).toMatch(/^failed: Stripe refused the request/);
  });

  it("APPLIES the redelivery of an event whose first attempt failed", async () => {
    // The sequence, on one harness and its real recorded state: fail, then the
    // provider retries, then it works. If the failure path had settled
    // `handled: true`, this second call would come back `duplicate` and the
    // detach would never be recorded.
    const h = makeService({ failApply: "mirror" });
    const { raw, header } = signed(DETACH);

    await expect(h.service.handleWebhook(raw, header)).rejects.toThrow();
    expect(h.events["evt_fail"].handled).toBe(false);

    h.fail.mode = null; // the transient cause clears
    const out = await h.service.handleWebhook(raw, header);

    expect(out).toMatchObject({ received: true, handled: true });
    expect(out.duplicate).toBeUndefined();
    expect(h.mirror.removed).toEqual(["pm_9"]);
    expect(h.events["evt_fail"].handled).toBe(true);
  });

  it("refuses a THIRD delivery once the retry succeeded — idempotent on real state", async () => {
    // Idempotency proven against the harness's own recorded receipt rather
    // than against a hand-planted `existingEvent`, so it exercises claim →
    // settle → claim rather than only the second half.
    const h = makeService();
    const { raw, header } = signed(DETACH);

    const first = await h.service.handleWebhook(raw, header);
    expect(first.handled).toBe(true);

    const second = await h.service.handleWebhook(raw, header);
    expect(second).toMatchObject({ received: true, handled: false, duplicate: true });

    // The effect happened exactly once.
    expect(h.mirror.removed).toEqual(["pm_9"]);
    expect(h.inserted).toEqual(["evt_fail"]);
  });
});

describe("BillingService — an ignored event is RECORDED as ignored", () => {
  it("files an unhandled event type with the reason, and changes nothing", async () => {
    const h = makeService();
    const { raw, header } = signed({
      id: "evt_c",
      type: "customer.subscription.created",
      livemode: false,
      data: { object: { customer: "cus_1" } },
    });
    const out = await h.service.handleWebhook(raw, header);

    expect(out).toMatchObject({ received: true, handled: false });
    expect(out.reason).toMatch(/not one of the .* event types this build acts on/);
    expect(h.events["evt_c"].outcome).toMatch(/^ignored:/);
    expect(h.mirror.upserted).toEqual([]);
  });

  it("files an event about a customer no restaurant is linked to", async () => {
    const h = makeService({ restaurantForCustomer: null });
    const { raw, header } = signed({
      id: "evt_d",
      type: "payment_method.attached",
      livemode: false,
      data: { object: { id: "pm_9", customer: "cus_stranger" } },
    });
    const out = await h.service.handleWebhook(raw, header);

    expect(out.handled).toBe(false);
    expect(h.events["evt_d"].outcome).toMatch(
      /no restaurant is linked to customer cus_stranger/,
    );
    expect(h.mirror.upserted).toEqual([]);
  });
});
