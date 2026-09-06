/**
 * Opening the card form is REDEEMED, not asserted — and recording what came
 * back proves the same seal (founder, 2026-09-05; ADR 0110 addendum,
 * G-PAY-SETUP).
 *
 * THE MEASUREMENT THIS CLOSES
 * ---------------------------
 * ADR 0110's addendum sealed `POST /payment-methods` and then said, in its own
 * text, that the route it had sealed has no caller: nothing in `apps/web` or
 * `apps/mobile` posts to it. An instrument is attached by minting a SetupIntent
 * at `POST /billing/setup-intent`, confirming it on Stripe's origin, and
 * reconciling at `POST /billing/sync`. Both of those ran
 * `assertCanManageRestaurant` and nothing else, so the attack the addendum
 * described in its second paragraph — a manager's session quietly attaching its
 * own instrument as the one the house is charged on — was open on the route
 * everybody actually uses.
 *
 * WHY THIS IS TWO REQUESTS AND ONE SEAL
 * -------------------------------------
 * The seal cannot be redeemed at `sync`: by then the instrument is already
 * attached at Stripe, and refusing afterwards would be an audit trail rather
 * than a guard. It cannot be redeemed twice either. So `setup-intent` SPENDS it
 * and stamps the spent seal's id onto the intent's own metadata at the provider;
 * `sync` names the intent, reads that id back FROM STRIPE, and asserts the seal
 * was redeemed by this person for this house's register. The browser authors
 * neither half of the pairing.
 *
 * PRE-FIX PROOF
 * -------------
 * Cases 1, 2 and 4-9 fail against `git show HEAD:` copies of
 * `billing.controller.ts`, `billing.service.ts`, `stripe.client.ts` and
 * `common/seal/*`, because that controller mints an intent with no seal at all
 * and that `sync` takes no body. Case 3 (the plain reconcile stays open) passes
 * before and after: it is the row of the census that this pass deliberately did
 * NOT change, and a test that only proved the new refusals would not have
 * noticed if the refresh button had been broken.
 */

import { ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import { DatabaseService } from "../database/database.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { PaymentMethodsController } from "../payment-methods/payment-methods.controller";
import type { PaymentMethodsService } from "../payment-methods/payment-methods.service";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import type { BillingCustomerService } from "./billing-customer.service";
import type { PaymentMethodMirrorService } from "./payment-method-mirror.service";
import type { StripeConfigService } from "./stripe-config.service";
import type { StripeClient } from "./stripe.client";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER_HOUSE = "99999999-9999-4999-8999-999999999999";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const OTHER_MANAGER = "33333333-3333-4333-8333-333333333333";
const INTENT = "seti_1";

type Row = Record<string, unknown>;

function req(userId = MANAGER, restaurantId = HOUSE) {
  return { user: { userId, restaurantId } } as unknown as Request & {
    user: { userId: string; restaurantId?: string };
  };
}

/**
 * One in-memory `mcp_seal_challenges` shared by both controllers, because the
 * whole point is that ONE seal minted on `/payment-methods/seal-challenge` is
 * the seal `/billing/setup-intent` spends. Two stores would prove nothing.
 *
 * It answers `maybeSingle` by whichever key the caller filtered on — `redeem`
 * looks a seal up by `token_hash`, `assertRedeemed` by `id` — so a lookup that
 * quietly matched the wrong column would fail here rather than pass.
 */
function build(
  opts: {
    allow?: boolean;
    intentMetadata?: Record<string, unknown> | null;
    stripeKey?: string | null;
  } = {},
) {
  const seals: Row[] = [];
  const audits: Row[] = [];

  const db = {
    supabase: {
      from(table: string) {
        if (table === "system_audit_log") {
          return {
            insert: (row: Row) => {
              audits.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        const api: Record<string, unknown> = {};
        let tokenHash: string | null = null;
        let rowId: string | null = null;
        api.select = () => api;
        api.eq = (col: string, value: string) => {
          if (col === "token_hash") tokenHash = value;
          if (col === "id") rowId = value;
          return api;
        };
        api.maybeSingle = () =>
          Promise.resolve({
            data:
              (tokenHash !== null
                ? seals.find((s) => s.token_hash === tokenHash)
                : seals.find((s) => s.id === rowId)) ?? null,
            error: null,
          });
        api.insert = (row: Row) => {
          seals.push({ id: `seal-${seals.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        };
        api.update = (patch: Row) => {
          const upd: Record<string, unknown> = {};
          let unspentOnly = false;
          upd.eq = (col: string, value: string) => {
            if (col === "id") rowId = value;
            return upd;
          };
          upd.is = (col: string, value: unknown) => {
            if (col === "redeemed_at" && value === null) unspentOnly = true;
            return upd;
          };
          upd.select = () => ({
            then: (r: (v: unknown) => unknown) => {
              const row = seals.find((s) => s.id === rowId);
              if (!row || (unspentOnly && row.redeemed_at)) {
                return Promise.resolve({ data: [], error: null }).then(r);
              }
              row.redeemed_at = String(patch.redeemed_at);
              return Promise.resolve({ data: [{ id: row.id }], error: null }).then(r);
            },
          });
          return upd;
        };
        return api;
      },
    },
  } as unknown as DatabaseService;

  const organizations = {
    assertCanManageRestaurant: jest.fn(async () => {
      if (opts.allow === false) {
        throw new ForbiddenException("Only managers and owners");
      }
    }),
  } as unknown as OrganizationsService;

  const seals_ = new SealChallengeService(db);

  /** Only the two acts this spec needs; `create` has no instrument to read. */
  const paymentMethods = {
    sealFacts: jest.fn(async () => ({
      methodId: "x",
      brand: null,
      last4: null,
    })),
    create: jest.fn(),
    setDefault: jest.fn(),
    remove: jest.fn(),
  } as unknown as PaymentMethodsService;

  const minted: Row[] = [];
  const stripe = {
    createSetupIntent: jest.fn(async (input: Row) => {
      minted.push(input);
      return {
        id: INTENT,
        client_secret: "seti_1_secret_abc",
        status: "requires_payment_method",
        livemode: false,
        payment_method: null,
      };
    }),
    retrieveSetupIntent: jest.fn(async () => ({
      id: INTENT,
      client_secret: "seti_1_secret_abc",
      status: "succeeded",
      livemode: false,
      payment_method: "pm_1",
      metadata:
        opts.intentMetadata === undefined
          ? { mudavym_restaurant_id: HOUSE, mudavym_seal_id: "seal-1" }
          : opts.intentMetadata,
    })),
    listPaymentMethods: jest.fn(async () => []),
  } as unknown as StripeClient;

  const config = {
    connected: () => (opts.stripeKey ?? "sk_test_x") !== null,
    state: () => ({ reason: "STRIPE_SECRET_KEY is not set in this deployment." }),
    mode: () => "test",
    apiVersion: () => "2024-06-20",
    livemode: () => false,
    stateWithDelivery: jest.fn(),
  } as unknown as StripeConfigService;

  const customers = {
    ensure: jest.fn(async () => "cus_1"),
    find: jest.fn(async () => "cus_1"),
    restaurantFor: jest.fn(async () => HOUSE),
  } as unknown as BillingCustomerService;

  const mirror = {
    reconcile: jest.fn(async () => ({ kept: 1, removed: 0 })),
    upsertOne: jest.fn(),
    removeByRef: jest.fn(),
  } as unknown as PaymentMethodMirrorService;

  const billingService = new BillingService(
    db,
    config,
    stripe,
    customers,
    mirror,
  );
  const billing = new BillingController(
    billingService,
    config,
    organizations,
    seals_,
  );
  const payments = new PaymentMethodsController(
    paymentMethods,
    organizations,
    seals_,
  );

  return { billing, payments, stripe, mirror, seals, audits, minted, organizations };
}

/** The `create` seal, minted where the browser mints it. */
async function mintCreate(h: ReturnType<typeof build>, who = req()) {
  const out = await h.payments.sealChallenge(who, { act: "create" });
  return out.challenge;
}

describe("POST /billing/setup-intent — a card form opens only against a redeemed seal", () => {
  it("1. refuses with no seal, and asks the provider for nothing", async () => {
    const h = build();
    await expect(h.billing.setupIntent(req(), undefined)).rejects.toThrow(
      /must be proven rather than asserted/i,
    );
    // The assertion that matters: a controller that refused AFTER minting
    // would still have handed Stripe a customer and created an intent.
    expect(h.stripe.createSetupIntent).not.toHaveBeenCalled();
  });

  it("2. mints against a good seal, stamps the seal id on the intent, and spends it once", async () => {
    const h = build();
    const token = await mintCreate(h);

    const out = await h.billing.setupIntent(req(), token);
    expect(out.clientSecret).toBe("seti_1_secret_abc");
    expect(h.minted[0]).toMatchObject({
      customerId: "cus_1",
      restaurantId: HOUSE,
      sealId: "seal-1",
    });

    await expect(h.billing.setupIntent(req(), token)).rejects.toThrow(
      /already been spent/i,
    );
    expect(h.stripe.createSetupIntent).toHaveBeenCalledTimes(1);
  });

  it("3. refuses a well-formed seal minted for another act on this register", async () => {
    const h = build();
    const other = await h.payments.sealChallenge(req(), {
      act: "set_default",
      methodId: "55555555-5555-4555-8555-555555555555",
    });
    // The refusal names the SUBJECT, not the act, and that is right rather than
    // a near miss: `create`'s subject is the house's register while every other
    // act's subject is the instrument it names (`payment-seal.ts`), so the two
    // seals differ on subject id before they differ on act and the first
    // mismatch is the one reported. The act-only discrimination — same subject,
    // different act — is not reachable from this mint route at all, and is
    // covered where it is: `payment-methods.seal.spec.ts` case 5.
    await expect(
      h.billing.setupIntent(req(), other.challenge),
    ).rejects.toThrow(/issued for a different payment method/i);
    expect(h.stripe.createSetupIntent).not.toHaveBeenCalled();
  });

  it("4. refuses a seal issued to somebody else", async () => {
    const h = build();
    const token = await mintCreate(h, req(OTHER_MANAGER));
    await expect(h.billing.setupIntent(req(), token)).rejects.toThrow(
      /issued to somebody else/i,
    );
    expect(h.stripe.createSetupIntent).not.toHaveBeenCalled();
  });

  it("5. checks the role before it checks the seal, and files nothing when the role fails", async () => {
    const h = build({ allow: false });
    await expect(h.billing.setupIntent(req(), "anything")).rejects.toThrow(
      /Only managers and owners/,
    );
    expect(h.audits).toHaveLength(0);
  });
});

describe("POST /billing/sync — recording a confirmation proves the same seal", () => {
  it("6. accepts the intent whose metadata names the seal this person redeemed", async () => {
    const h = build();
    const token = await mintCreate(h);
    await h.billing.setupIntent(req(), token);

    const out = await h.billing.sync(req(), { setupIntentId: INTENT });
    expect(out.provenance).toBe("sealed-intent");
    expect(out.kept).toBe(1);
    expect(h.mirror.reconcile).toHaveBeenCalledTimes(1);
  });

  it("7. refuses an intent whose seal was issued and never spent, and reconciles nothing", async () => {
    const h = build();
    // Minted, never redeemed: the row exists, so `unknown` would be the wrong
    // refusal and `redeemed_at` is the only thing separating the two.
    await mintCreate(h);

    await expect(
      h.billing.sync(req(), { setupIntentId: INTENT }),
    ).rejects.toThrow(/issued and never spent/i);
    expect(h.mirror.reconcile).not.toHaveBeenCalled();
  });

  it("8. refuses an intent carrying no seal id at all", async () => {
    const h = build({ intentMetadata: { mudavym_restaurant_id: HOUSE } });
    await expect(
      h.billing.sync(req(), { setupIntentId: INTENT }),
    ).rejects.toThrow(/must be proven rather than asserted/i);
    expect(h.mirror.reconcile).not.toHaveBeenCalled();
  });

  it("9. refuses an intent belonging to another restaurant before reading its seal", async () => {
    const h = build({
      intentMetadata: {
        mudavym_restaurant_id: OTHER_HOUSE,
        mudavym_seal_id: "seal-1",
      },
    });
    await expect(
      h.billing.sync(req(), { setupIntentId: INTENT }),
    ).rejects.toThrow(/opened by a different restaurant/i);
    expect(h.mirror.reconcile).not.toHaveBeenCalled();
  });

  it("10. still reconciles with no intent named, and SAYS that nothing was proven", async () => {
    // The census row this pass deliberately left open. With `setup-intent`
    // sealed, the provider's list holds only instruments this house approved,
    // so a plain reconcile writes back the provider's own answer and can
    // neither attach, prefer nor invent one. `provenance` is what stops a
    // reader taking the skipped check for a passed one.
    const h = build();
    const out = await h.billing.sync(req(), {});
    expect(out.provenance).toBe("reconcile-only");
    expect(h.mirror.reconcile).toHaveBeenCalledTimes(1);
  });

  it("11. runs the manager-or-owner check on the plain reconcile too", async () => {
    const h = build({ allow: false });
    await expect(h.billing.sync(req(), {})).rejects.toThrow(
      /Only managers and owners/,
    );
    expect(h.mirror.reconcile).not.toHaveBeenCalled();
  });
});

describe("every refusal is filed before it is thrown", () => {
  it("12. writes a seal_refused row naming the payment register and the act", async () => {
    const h = build();
    await expect(h.billing.setupIntent(req(), undefined)).rejects.toThrow();
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: "seal_refused",
      entity_type: "payment_method",
      entity_id: HOUSE,
      restaurant_id: HOUSE,
    });
    expect(
      (h.audits[0].changes as Record<string, unknown>).act,
    ).toBe("create");
  });
});
