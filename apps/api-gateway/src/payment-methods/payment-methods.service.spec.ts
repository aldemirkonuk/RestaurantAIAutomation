/**
 * PaymentMethodsService — the register is real; the create path refuses.
 *
 * The two assertions that carry the design:
 *
 *  1. With no provider credential, `create` throws 503 with the reason. It does
 *     NOT insert. A register that accepted the write would render a row that
 *     looks exactly like a chargeable instrument and is not one — the
 *     fabricated-record shape ADR 0020 exists to stop.
 *  2. `list` returns the provider's state alongside the rows, so an empty list
 *     can be told apart from an impossible one. "No cards on file" and "no
 *     provider is connected, so no card can exist" are the same JSON in any API
 *     that returns only an array.
 */

import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentMethodsService } from "./payment-methods.service";
import { DatabaseService } from "../database/database.service";

type Result = { data: unknown; error: { message: string } | null };

interface Probe {
  inserts: Record<string, unknown>[];
}

function makeService(
  result: Result,
  env: Record<string, string | undefined> = {},
): { service: PaymentMethodsService; probe: Probe } {
  const probe: Probe = { inserts: [] };

  const builder = () => {
    const self: Record<string, unknown> = {
      select: () => self,
      insert: (payload: Record<string, unknown>) => {
        probe.inserts.push(payload);
        return self;
      },
      update: () => self,
      delete: () => self,
      eq: () => self,
      order: () => self,
      single: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (v: Result) => unknown) => resolve(result),
    };
    return self;
  };

  const db = { supabase: { from: () => builder() } };
  const config = { get: (key: string) => env[key] };

  return {
    service: new PaymentMethodsService(
      db as unknown as DatabaseService,
      config as unknown as ConfigService,
    ),
    probe,
  };
}

const CONNECTED = { STRIPE_SECRET_KEY: "sk_test_provider_is_wired" };

const ROW = {
  id: "22222222-2222-2222-2222-222222222222",
  kind: "card",
  brand: "visa",
  last4: "4242",
  exp: "04/2029",
  is_default: true,
  provider: "stripe",
  created_at: "2026-09-03T09:00:00.000Z",
};

describe("PaymentMethodsService — with no provider connected", () => {
  it("reports the provider as not connected, with the reason in words", () => {
    const { service } = makeService({ data: [], error: null });
    const state = service.providerState();

    expect(state.connected).toBe(false);
    expect(state.reason).toContain("Stripe is not connected");
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
    expect(out.provider.reason).toMatch(/no provider credential is configured/i);
  });

  it("treats an empty-string credential as absent, not as configured", () => {
    const { service } = makeService({ data: [], error: null }, {
      STRIPE_SECRET_KEY: "   ",
    });
    expect(service.providerState().connected).toBe(false);
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

  it("says the provider is connected in the list response", async () => {
    const { service } = makeService({ data: [ROW], error: null }, CONNECTED);
    const out = await service.list("r1");

    expect(out.provider).toEqual({ id: "stripe", connected: true, reason: null });
    expect(out.methods).toHaveLength(1);
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
    const { service } = makeService({ data: null, error: null }, CONNECTED);

    await expect(service.remove("r1", ROW.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
