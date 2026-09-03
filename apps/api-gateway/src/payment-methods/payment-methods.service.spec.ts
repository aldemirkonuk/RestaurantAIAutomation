/**
 * PaymentMethodsService — the register is real; the create path still refuses.
 *
 * The assertions that carry the design:
 *
 *  1. With no provider credential, `create` throws 503 with the reason. It does
 *     NOT insert. A register that accepted the write would render a row that
 *     looks exactly like a chargeable instrument and is not one — the
 *     fabricated-record shape ADR 0020 exists to stop.
 *  2. `list` returns the provider's state alongside the rows, so an empty list
 *     can be told apart from an impossible one. "No cards on file" and "no
 *     provider is connected, so no card can exist" are the same JSON in any API
 *     that returns only an array.
 *  3. NEW with ADR 0110 — removal DETACHES AT THE PROVIDER FIRST. Dropping our
 *     row alone leaves a live instrument on the customer that the next
 *     reconcile faithfully restores: the delete appears to work and silently
 *     undoes itself. The order is asserted, not just the calls.
 *  4. NEW — `setDefault` writes the default at the provider BEFORE the local
 *     flag. "Charged first" is a fact about Stripe's customer; a local-only
 *     flip makes the page say one thing and the charge do another.
 */

import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PaymentMethodsService } from "./payment-methods.service";
import { DatabaseService } from "../database/database.service";
import { BillingCustomerService } from "../billing/billing-customer.service";
import { StripeClient } from "../billing/stripe.client";
import { StripeConfigService } from "../billing/stripe-config.service";
import type { PaymentProviderState } from "./dto/payment-method.dto";

type Result = { data: unknown; error: { message: string } | null };

interface Probe {
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  deletes: number;
  /** Every provider and database effect, in the order it happened. */
  order: string[];
}

const DISCONNECTED: PaymentProviderState = {
  id: "stripe",
  connected: false,
  reason:
    "Stripe is not connected — STRIPE_SECRET_KEY is not set on this deployment, so no payment method can be taken and none could exist to list.",
  mode: null,
  secretKeyPresent: false,
  webhookSecretPresent: false,
  apiVersion: "2024-06-20",
  webhookLastReceivedAt: null,
  webhookLastEventType: null,
  webhookReason:
    "STRIPE_WEBHOOK_SECRET is not set, so every delivery is refused and this register only changes when someone is looking at it.",
};

const CONNECTED: PaymentProviderState = {
  ...DISCONNECTED,
  connected: true,
  reason: null,
  mode: "test",
  secretKeyPresent: true,
  webhookSecretPresent: true,
  webhookReason:
    "STRIPE_WEBHOOK_SECRET is set, but no signed delivery has ever arrived at this deployment.",
};

function makeService(
  result: Result,
  state: PaymentProviderState = DISCONNECTED,
): { service: PaymentMethodsService; probe: Probe } {
  const probe: Probe = { inserts: [], updates: [], deletes: 0, order: [] };

  const builder = () => {
    const self: Record<string, unknown> = {
      select: () => self,
      insert: (payload: Record<string, unknown>) => {
        probe.inserts.push(payload);
        probe.order.push("db:insert");
        return self;
      },
      update: (payload: Record<string, unknown>) => {
        probe.updates.push(payload);
        probe.order.push("db:update");
        return self;
      },
      delete: () => {
        probe.deletes += 1;
        probe.order.push("db:delete");
        return self;
      },
      eq: () => self,
      order: () => self,
      limit: () => self,
      single: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (v: Result) => unknown) => resolve(result),
    };
    return self;
  };

  const db = { supabase: { from: () => builder() } };

  const config = {
    state: () => state,
    stateWithDelivery: () => Promise.resolve(state),
    connected: () => state.connected,
  } as unknown as StripeConfigService;

  const stripe = {
    detachPaymentMethod: (id: string) => {
      probe.order.push(`stripe:detach:${id}`);
      return Promise.resolve({ id });
    },
    setDefaultPaymentMethod: (cus: string, pm: string) => {
      probe.order.push(`stripe:default:${cus}:${pm}`);
      return Promise.resolve({ id: cus, livemode: false });
    },
  } as unknown as StripeClient;

  const customers = {
    ensure: () => Promise.resolve("cus_1"),
    find: () => Promise.resolve("cus_1"),
  } as unknown as BillingCustomerService;

  return {
    service: new PaymentMethodsService(
      db as unknown as DatabaseService,
      config,
      stripe,
      customers,
    ),
    probe,
  };
}

const ROW = {
  id: "22222222-2222-2222-2222-222222222222",
  kind: "card",
  brand: "visa",
  last4: "4242",
  exp: "04/2029",
  is_default: true,
  provider: "stripe",
  provider_ref: "pm_123",
  provider_type: "card",
  synced_at: null,
  livemode: false,
  created_at: "2026-09-03T09:00:00.000Z",
};

describe("PaymentMethodsService — with no provider connected", () => {
  it("reports the provider as not connected, with the reason in words", () => {
    const { service } = makeService({ data: [], error: null });
    const state = service.providerState();

    expect(state.connected).toBe(false);
    expect(state.reason).toContain("Stripe is not connected");
    expect(state.secretKeyPresent).toBe(false);
  });

  it("refuses to record an instrument, and writes nothing", async () => {
    const { service, probe } = makeService({ data: ROW, error: null });

    await expect(
      service.create("r1", {
        kind: "card",
        brand: "visa",
        last4: "4242",
        exp: "04/2029",
        providerRef: "pm_fabricated",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(probe.inserts).toHaveLength(0);
  });

  it("returns an empty register that says WHY it is empty", async () => {
    const { service } = makeService({ data: [], error: null });
    const out = await service.list("r1");

    expect(out.methods).toEqual([]);
    expect(out.provider.connected).toBe(false);
    expect(out.provider.reason).toMatch(/STRIPE_SECRET_KEY is not set/i);
  });

  it("refuses to change which instrument is charged first — there is nothing to charge", async () => {
    const { service, probe } = makeService({ data: ROW, error: null });
    await expect(service.setDefault("r1", ROW.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(probe.updates).toHaveLength(0);
    expect(probe.order.filter((o) => o.startsWith("stripe:"))).toEqual([]);
  });

  it("says a webhook secret that was never delivered to is NOT healthy", () => {
    const { service } = makeService({ data: [], error: null }, CONNECTED);
    const state = service.providerState();
    expect(state.webhookLastReceivedAt).toBeNull();
    expect(state.webhookReason).toMatch(/no signed delivery has ever arrived/);
  });
});

describe("PaymentMethodsService — with a provider connected", () => {
  it("records the instrument the provider handed back", async () => {
    const { service, probe } = makeService({ data: ROW, error: null }, CONNECTED);

    const row = await service.create("r1", {
      kind: "card",
      brand: "visa",
      last4: "4242",
      exp: "04/2029",
      isDefault: true,
      providerRef: "pm_123",
    });

    expect(row.last4).toBe("4242");
    expect(row.isDefault).toBe(true);
    expect(probe.inserts[0]).toMatchObject({
      restaurant_id: "r1",
      provider: "stripe",
      provider_ref: "pm_123",
    });
  });

  it("carries no cardholder, address or PAN field into the row it writes", async () => {
    const { service, probe } = makeService({ data: ROW, error: null }, CONNECTED);
    await service.create("r1", { kind: "card", providerRef: "pm_123" });

    const written = Object.keys(probe.inserts[0]);
    for (const forbidden of ["pan", "number", "cvc", "address", "name"]) {
      expect(written).not.toContain(forbidden);
    }
  });

  it("says the provider is connected, in which mode, and on which API version", async () => {
    const { service } = makeService({ data: [ROW], error: null }, CONNECTED);
    const out = await service.list("r1");

    expect(out.provider).toMatchObject({
      id: "stripe",
      connected: true,
      reason: null,
      mode: "test",
      apiVersion: "2024-06-20",
    });
    expect(out.methods).toHaveLength(1);
  });

  it("reports a row that has never been confirmed as syncedAt: null, not as its creation date", async () => {
    const { service } = makeService({ data: [ROW], error: null }, CONNECTED);
    const [row] = (await service.list("r1")).methods;
    expect(row.syncedAt).toBeNull();
    expect(row.createdAt).toBe("2026-09-03T09:00:00.000Z");
    expect(row.providerType).toBe("card");
  });

  it("DETACHES at the provider before it deletes the row", async () => {
    const { service, probe } = makeService({ data: ROW, error: null }, CONNECTED);
    await service.remove("r1", ROW.id);

    const detachAt = probe.order.indexOf("stripe:detach:pm_123");
    const deleteAt = probe.order.indexOf("db:delete");
    expect(detachAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(detachAt);
  });

  it("writes the default at the provider before flipping the local flag", async () => {
    const { service, probe } = makeService({ data: ROW, error: null }, CONNECTED);
    await service.setDefault("r1", ROW.id);

    const providerAt = probe.order.indexOf("stripe:default:cus_1:pm_123");
    const localAt = probe.order.indexOf("db:update");
    expect(providerAt).toBeGreaterThanOrEqual(0);
    expect(localAt).toBeGreaterThan(providerAt);
  });
});

describe("PaymentMethodsService — reads and removals fail loudly", () => {
  it("throws on a read error instead of returning an empty register", async () => {
    const { service } = makeService({
      data: null,
      error: { message: "statement timeout" },
    });

    await expect(service.list("r1")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(service.list("r1")).rejects.toThrow(
      "The payment register could not be read: statement timeout",
    );
  });

  it("404s a removal that matched nothing rather than reporting success", async () => {
    const { service, probe } = makeService({ data: null, error: null }, CONNECTED);

    await expect(service.remove("r1", ROW.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // and it must not have detached anything at the provider on the way
    expect(probe.order.filter((o) => o.startsWith("stripe:"))).toEqual([]);
  });
});
