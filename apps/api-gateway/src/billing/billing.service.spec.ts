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
  tablesRead: string[];
  chargeArgs: Record<string, unknown>[];
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
    /**
     * The `payment_methods` rows the MIRROR holds. `undefined` means one card;
     * `[]` means the house has none. This is the register the house was SHOWN,
     * and `chargeForMessageCredits` must read it rather than asking the
     * provider — charging an instrument the page never displayed is how a
     * dispute starts.
     */
    paymentMethods?: Record<string, unknown>[];
    /** Make the `payment_methods` read fail, which is NOT "this house has none". */
    failPaymentMethodsRead?: string | null;
    /** What `chargeCardOnFile` answers, or throws. */
    chargeStatus?: string | null;
    chargeThrows?: string | null;
  } = {},
): Harness {
  const events: Record<string, { handled: boolean; outcome: string }> = {};
  const inserted: string[] = [];
  const mirror = { upserted: [] as unknown[], removed: [] as string[] };
  const stripeCalls: string[] = [];
  /** Every table the service SELECTed, so a spec can assert what it read. */
  const tablesRead: string[] = [];
  /** The exact argument object `chargeCardOnFile` was handed. */
  const chargeArgs: Record<string, unknown>[] = [];
  const paymentMethodRows =
    opts.paymentMethods === undefined
      ? [
          {
            id: "pm-row-1",
            restaurant_id: "r1",
            kind: "card",
            brand: "visa",
            last4: "4242",
            provider: "stripe",
            provider_ref: "pm_mirror_1",
            is_default: true,
            synced_at: "2026-09-06T00:00:00Z",
          },
        ]
      : opts.paymentMethods;
  const existing = opts.existingEvent ?? null;
  const fail: Harness["fail"] = {
    mode: opts.failApply ?? null,
    message: opts.failMessage ?? "statement timeout",
  };

  const db = {
    supabase: {
      from: (table: string) => {
        const state: Record<string, unknown> = {};
        if (table === "payment_methods") {
          // A real chain: `.select().eq().eq().order().order()` then awaited.
          // The service filters on `kind = "card"`, so the stub applies it —
          // a stub that ignored the filter could not fail a test about which
          // instrument is chosen.
          const eq: Record<string, unknown> = {};
          const pmSelf: Record<string, unknown> = {
            select: () => {
              tablesRead.push("payment_methods");
              return pmSelf;
            },
            eq: (col: string, value: unknown) => {
              eq[col] = value;
              return pmSelf;
            },
            order: () => pmSelf,
            limit: () => pmSelf,
            then: (resolve: (v: unknown) => unknown) => {
              if (opts.failPaymentMethodsRead) {
                return resolve({
                  data: null,
                  error: { message: opts.failPaymentMethodsRead },
                });
              }
              const rows = paymentMethodRows.filter((r) =>
                Object.entries(eq).every(([k, v]) => r[k] === v),
              );
              return resolve({ data: rows, error: null });
            },
          };
          return pmSelf;
        }
        const self: Record<string, unknown> = {
          insert: (payload: Record<string, unknown>) => {
            if (table === "billing_webhook_events") {
              const id = String(payload.event_id);
              if (existing || events[id]) {
                return Promise.resolve({
                  data: null,
                  error: {
                    message: "duplicate key value violates unique constraint",
                  },
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
        {
          id: "pm_1",
          type: "card",
          livemode: false,
          created: 1,
          card: { last4: "4242" },
        },
      ]);
    },
    chargeCardOnFile: (input: Record<string, unknown>) => {
      stripeCalls.push(`payment_intents:${String(input.paymentMethodId)}`);
      chargeArgs.push(input);
      if (opts.chargeThrows)
        return Promise.reject(new Error(opts.chargeThrows));
      return Promise.resolve({
        id: "pi_1",
        status:
          opts.chargeStatus === undefined ? "succeeded" : opts.chargeStatus,
        amount: input.amountMinor,
        currency: String(input.currency).toLowerCase(),
        livemode: false,
        payment_method: input.paymentMethodId,
      });
    },
    retrievePaymentMethod: (id: string) => {
      stripeCalls.push(`retrieve:${id}`);
      if (fail.mode === "stripe")
        return Promise.reject(new Error(fail.message));
      return Promise.resolve({
        id,
        type: "card",
        livemode: false,
        created: 1,
        card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2029 },
      });
    },
  } as unknown as StripeClient;

  const customerId = opts.customerId === undefined ? "cus_1" : opts.customerId;

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
      if (fail.mode === "mirror")
        return Promise.reject(new Error(fail.message));
      mirror.upserted.push(pm);
      return Promise.resolve();
    },
    removeByRef: (ref: string) => {
      if (fail.mode === "mirror")
        return Promise.reject(new Error(fail.message));
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
    tablesRead,
    chargeArgs,
  };
}

describe("BillingService — with no credential", () => {
  it("refuses a SetupIntent with the provider's stated reason, and calls nothing", async () => {
    const h = makeService({ secretKey: null });
    await expect(
      h.service.createSetupIntent("r1", "seal-1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(h.service.createSetupIntent("r1", "seal-1")).rejects.toThrow(
      /STRIPE_SECRET_KEY is not set/,
    );
    expect(h.stripeCalls).toEqual([]);
  });

  it("refuses a sync for the same reason", async () => {
    const h = makeService({ secretKey: null });
    await expect(h.service.sync("r1", "reconcile-only")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(h.stripeCalls).toEqual([]);
  });
});

describe("BillingService — with a credential", () => {
  it("mints a SETUP intent, never a payment intent", async () => {
    const h = makeService();
    const out = await h.service.createSetupIntent("r1", "seal-1");
    expect(out.clientSecret).toBe("seti_1_secret_abc");
    expect(out.mode).toBe("test");
    expect(h.stripeCalls).toEqual(["setup_intents:cus_1"]);
    expect(h.stripeCalls.join()).not.toMatch(/payment_intents|charges/);
  });

  it("says so in words when a restaurant has no provider account yet", async () => {
    const h = makeService({ customerId: null });
    const out = await h.service.sync("r1", "reconcile-only");
    expect(out.kept).toBe(0);
    expect(out.note).toMatch(/no account at the provider yet/);
    expect(h.stripeCalls).toEqual([]);
  });

  it("reconciles the register against the provider's list", async () => {
    const h = makeService();
    const out = await h.service.sync("r1", "reconcile-only");
    expect(out.kept).toBe(1);
    expect(h.mirror.upserted).toHaveLength(1);
    expect(out.syncedAt).toEqual(expect.any(String));
  });
});

describe("BillingService — the webhook fails closed and says which check failed", () => {
  it("refuses everything when no webhook secret is configured", async () => {
    const h = makeService({ webhookSecret: null });
    const { raw, header } = signed({
      id: "evt_1",
      type: "payment_method.attached",
    });
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
      Buffer.from(
        JSON.stringify({ id: "evt_2", type: "payment_method.detached" }),
      ),
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

    expect(out).toMatchObject({
      received: true,
      handled: false,
      duplicate: true,
    });
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
    const h = makeService({
      failApply: "mirror",
      failMessage: "statement timeout",
    });
    const { raw, header } = signed(DETACH);

    await expect(h.service.handleWebhook(raw, header)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(h.service.handleWebhook(raw, header)).rejects.toThrow(
      /could not be applied: statement timeout/,
    );
  });

  it("leaves the receipt UNHANDLED, carrying the failure's own words", async () => {
    const h = makeService({
      failApply: "mirror",
      failMessage: "statement timeout",
    });
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
    const h = makeService({
      failApply: "stripe",
      failMessage: "Stripe refused the request",
    });
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
    expect(h.events["evt_fetch"].outcome).toMatch(
      /^failed: Stripe refused the request/,
    );
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
    expect(second).toMatchObject({
      received: true,
      handled: false,
      duplicate: true,
    });

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
    expect(out.reason).toMatch(
      /not one of the .* event types this build acts on/,
    );
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

/**
 * `chargeForMessageCredits` — the only method in this product that moves money.
 *
 * WHY THESE CASES EXIST (audit finding, 2026-09-06). Until today this method had
 * zero direct coverage: `text-credits.seal.spec.ts` mocks it wholesale and this
 * file never called it. So a regression in the `requires_action` check — the one
 * that keeps Stripe's "the cardholder must authenticate" from being filed as a
 * payment — would have failed none of the 553 tests. That is the shape this repo
 * calls absence-reported-as-health: a green suite over an unexamined method.
 *
 * THE METHOD ITSELF IS REAL HERE. `StripeClient` and `DatabaseService` are
 * stubbed at their own boundaries and `chargeForMessageCredits` is not mocked,
 * so the branch under test is the shipped one. Every case below was proven by a
 * ONE-CHANGE MUTATION in a scratch copy of `billing.service.ts`; the mutation is
 * named on each case.
 */
describe("BillingService.chargeForMessageCredits — the five outcomes", () => {
  const charge = (h: Harness) =>
    h.service.chargeForMessageCredits({
      restaurantId: "r1",
      amountMinor: 5000,
      currency: "USD",
      sealId: "seal-1",
    });

  it("charges the mirror's instrument and reports it succeeded", async () => {
    const h = makeService();
    const out = await charge(h);

    expect(out.charged).toBe(true);
    if (!out.charged) throw new Error("unreachable");
    expect(out.paymentIntentId).toBe("pi_1");
    expect(out.status).toBe("succeeded");
    expect(out.words).toContain("5000 USD");
  });

  it("refuses with `provider_not_connected` and asks the provider NOTHING", async () => {
    // MUTATION: delete the `config.connected()` guard -> this fails, because the
    // stub would then be asked to charge with no credential configured.
    const h = makeService({ secretKey: null });
    const out = await charge(h);

    expect(out.charged).toBe(false);
    if (out.charged) throw new Error("unreachable");
    expect(out.reason).toBe("provider_not_connected");
    expect(out.words).toContain("STRIPE_SECRET_KEY is not set");
    expect(h.stripeCalls).toEqual([]);
    expect(h.tablesRead).toEqual([]);
  });

  it("refuses with `no_customer` when the house has no provider account", async () => {
    // MUTATION: `if (!customerId)` -> `if (false)` — this fails, because the
    // charge then goes out with an empty customer.
    const h = makeService({ customerId: null });
    const out = await charge(h);

    expect(out.charged).toBe(false);
    if (out.charged) throw new Error("unreachable");
    expect(out.reason).toBe("no_customer");
    expect(h.stripeCalls).toEqual([]);
  });

  it("refuses with `no_instrument` when the register holds no card", async () => {
    // MUTATION: return `providerRef: "pm_x"` from instrumentToCharge when the
    // rows are empty -> this fails.
    const h = makeService({ paymentMethods: [] });
    const out = await charge(h);

    expect(out.charged).toBe(false);
    if (out.charged) throw new Error("unreachable");
    expect(out.reason).toBe("no_instrument");
    expect(out.words).toContain("no card on file");
    expect(h.stripeCalls).toEqual([]);
  });

  it("refuses with `read_failed`, which is NOT the same as having no card", async () => {
    // MUTATION: drop the `if (error)` branch in instrumentToCharge so a failed
    // read falls through to `rows = []` -> this fails, because the reason
    // becomes `no_instrument` and the house is told to add a card it already has.
    const h = makeService({ failPaymentMethodsRead: "connection reset" });
    const out = await charge(h);

    expect(out.charged).toBe(false);
    if (out.charged) throw new Error("unreachable");
    expect(out.reason).toBe("read_failed");
    expect(out.words).toContain("connection reset");
    expect(out.words).toContain("not the same as this house having no card");
    expect(h.stripeCalls).toEqual([]);
  });

  it("refuses with `refused_by_provider` when the provider throws", async () => {
    // MUTATION: remove the try/catch -> this fails with an unhandled rejection
    // instead of a sentence, and the purchase route would 500 rather than void.
    const h = makeService({ chargeThrows: "Your card was declined." });
    const out = await charge(h);

    expect(out.charged).toBe(false);
    if (out.charged) throw new Error("unreachable");
    expect(out.reason).toBe("refused_by_provider");
    expect(out.words).toContain("Your card was declined.");
    expect(out.words).toContain(
      "Nothing is queued and nothing will settle later",
    );
  });
});

describe("BillingService.chargeForMessageCredits — a 200 is not a payment", () => {
  const charge = (h: Harness) =>
    h.service.chargeForMessageCredits({
      restaurantId: "r1",
      amountMinor: 5000,
      currency: "USD",
      sealId: "seal-1",
    });

  /**
   * THE CASE THE AUDIT WAS ABOUT. Stripe answers 200 with a PaymentIntent whose
   * status is `requires_action` or `requires_payment_method`; only `succeeded`
   * means money moved. A build that read the HTTP code alone would file every
   * one of these as a payment and credit a house that was never charged.
   *
   * MUTATION for all four: `if (status !== "succeeded")` -> `if (false)`. Each
   * case below then reports `charged: true`, and each one fails.
   */
  it.each([
    "requires_action",
    "requires_payment_method",
    "requires_confirmation",
    "processing",
    "canceled",
  ])("refuses a PaymentIntent whose status is %s", async (status) => {
    const h = makeService({ chargeStatus: status });
    const out = await charge(h);

    expect(out.charged).toBe(false);
    if (out.charged) throw new Error("unreachable");
    expect(out.reason).toBe("refused_by_provider");
    expect(out.words).toContain(status);
    expect(out.words).toContain(
      "Nothing is queued and nothing will settle later",
    );
  });

  it("tells a manager what to do about `requires_action` specifically", async () => {
    // The one status with a human next step, and the sentence is the product.
    // MUTATION: delete the `status === "requires_action"` clause -> this fails.
    const h = makeService({ chargeStatus: "requires_action" });
    const out = await charge(h);
    if (out.charged) throw new Error("unreachable");
    expect(out.words).toContain(
      "cannot be given without the cardholder present",
    );
  });

  it("does not treat a MISSING status as success", async () => {
    // MUTATION: `intent.status ?? "succeeded"` -> this fails. A provider that
    // returned no status must not be read as one that returned the good one.
    const h = makeService({ chargeStatus: null });
    const out = await charge(h);

    expect(out.charged).toBe(false);
    if (out.charged) throw new Error("unreachable");
    expect(out.words).toContain("no status returned");
  });
});

describe("BillingService.chargeForMessageCredits — what it reads, and what it sends", () => {
  it("charges the instrument from the MIRROR, and never asks the provider for one", async () => {
    // Charging something the page never displayed is how a dispute starts, so
    // the register the house was SHOWN is the source.
    // MUTATION: swap `instrumentToCharge` for `this.stripe.listPaymentMethods`
    // -> this fails on both assertions.
    const h = makeService();
    await h.service.chargeForMessageCredits({
      restaurantId: "r1",
      amountMinor: 5000,
      currency: "USD",
      sealId: "seal-1",
    });

    expect(h.tablesRead).toContain("payment_methods");
    expect(h.stripeCalls).not.toContain("list:cus_1");
    expect(h.chargeArgs[0].paymentMethodId).toBe("pm_mirror_1");
  });

  it("passes the seal id as the idempotency key, so a retry cannot charge twice", async () => {
    // MUTATION: `idempotencyKey: randomUUID()` -> this fails. The key is what
    // makes Stripe return the ORIGINAL intent after a crash between the charge
    // and the ledger write.
    const h = makeService();
    await h.service.chargeForMessageCredits({
      restaurantId: "r1",
      amountMinor: 5000,
      currency: "USD",
      sealId: "seal-42",
    });

    expect(h.chargeArgs[0].idempotencyKey).toBe("text-credits:seal-42");
    // And the seal travels on the intent itself, which is the handle the
    // reconcile searches by.
    expect(h.chargeArgs[0].sealId).toBe("seal-42");
    expect(h.chargeArgs[0].restaurantId).toBe("r1");
    expect(h.chargeArgs[0].amountMinor).toBe(5000);
    expect(h.chargeArgs[0].currency).toBe("USD");
  });

  it("does not lower-case the currency on its way in — that is the client's job", async () => {
    // The ledger holds ISO 4217 upper-case and Stripe wants lower-case. The
    // conversion happens in exactly ONE place (`StripeClient.chargeCardOnFile`,
    // proven in stripe.client.spec.ts). Two places is how the two drift.
    const h = makeService();
    await h.service.chargeForMessageCredits({
      restaurantId: "r1",
      amountMinor: 5000,
      currency: "TRY",
      sealId: "seal-1",
    });
    expect(h.chargeArgs[0].currency).toBe("TRY");
  });
});
