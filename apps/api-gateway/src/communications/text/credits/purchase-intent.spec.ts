/**
 * The intent row closes the window (ADR 0121 addendum; founder, 2026-09-05:
 * *"Close it now with the intent row"*).
 *
 * FOUR PROPERTIES, AND THE FIRST IS THE ONE THAT MATTERS MOST:
 *
 *   1. THE INTENT EXISTS BEFORE THE CHARGE, and it says `charge_may_exist`
 *      before the provider is asked. Proven by a MUTATION: the charge stub
 *      records the intent's state as it stood when it was called, so a build
 *      that charged first — or that marked the row after the call — fails here
 *      rather than passing with a comment claiming the order.
 *   2. A crash between the charge and the credit leaves a RECONCILABLE row, and
 *      the response never says charged-true / recorded-false again.
 *   3. Reconcile is idempotent: running it twice settles once.
 *   4. The provider is read BY THE SEAL ID, from a fixtured search response.
 *
 * NOTHING HERE TALKS TO STRIPE. The search and charge are stubbed at the
 * BillingService boundary; the request Stripe would actually receive is proven
 * in `billing/stripe.client.spec.ts` against a mocked axios.
 */

import { ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import { DatabaseService } from "../../../database/database.service";
import { SealChallengeService } from "../../../common/seal/seal-challenge.service";
import { OrganizationsService } from "../../../organizations/organizations.service";
import type { BillingService } from "../../../billing/billing.service";
import { TextUsageService } from "../text-usage.service";
import { TextCreditsController } from "./text-credits.controller";
import { PurchaseIntentService } from "./purchase-intent.service";
import {
  PurchaseIntentReconciler,
  SEARCH_LAG_FLOOR_MS,
} from "./purchase-intent.reconciler";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

function req(userId = MANAGER) {
  return { user: { userId, restaurantId: HOUSE } } as unknown as Request & {
    user: { userId: string; restaurantId?: string };
  };
}

/**
 * SOURCE: the Stripe PaymentIntent search response shape —
 * `{ object: "search_result", data: [...], has_more }` — as documented for
 * `GET /v1/payment_intents/search`. Retrieved through Twilio-style first-party
 * docs is not applicable here; this is Stripe's own envelope, transcribed, and
 * it is fed to the BillingService boundary rather than to axios.
 */
const stripeSearchHit = (sealId: string, status = "succeeded") => ({
  readable: true,
  succeeded: status === "succeeded",
  paymentIntentId: `pi_for_${sealId}`,
  status,
  words:
    status === "succeeded"
      ? `The provider confirms pi_for_${sealId} succeeded.`
      : `The provider holds pi_for_${sealId} with status "${status}"; no money moved.`,
});

const stripeSearchEmpty = {
  readable: true,
  succeeded: false,
  paymentIntentId: null,
  status: null,
  words: "The provider reports no charge carrying this seal.",
};

/**
 * One in-memory store for the seal table, the intents and the credits.
 *
 * Hand-built because `SealChallengeService` looks a seal up by `token_hash` on
 * redemption and by `id` on assertion, and the intents need real filtering on
 * `seal_id`, `id` and `state` for the state machine to be exercised at all.
 */
function build(
  opts: {
    charge?:
      | {
          charged: true;
          paymentIntentId: string;
          status: string;
          words: string;
        }
      | { charged: false; reason: string; words: string };
    creditWriteFails?: boolean;
    find?: unknown;
  } = {},
) {
  const seals: Row[] = [];
  const intents: Row[] = [];
  const credits: Row[] = [];

  const table = (rows: Row[], name: string) => {
    const api: Record<string, unknown> = {};
    const eq: Record<string, unknown> = {};
    let ins: Row[] = [];
    const inSets: Record<string, unknown[]> = {};
    const neq: Record<string, unknown> = {};
    const isNull: Record<string, boolean> = {};
    const match = (r: Row) =>
      Object.entries(eq).every(([k, v]) => r[k] === v) &&
      Object.entries(inSets).every(([k, v]) => v.includes(r[k])) &&
      Object.entries(neq).every(([k, v]) => r[k] !== v) &&
      Object.keys(isNull).every((k) => r[k] === null || r[k] === undefined);

    api.select = () => api;
    api.order = () => api;
    api.limit = () => api;
    api.is = (col: string, value: unknown) => {
      if (value === null) isNull[col] = true;
      return api;
    };
    api.eq = (col: string, value: unknown) => {
      eq[col] = value;
      return api;
    };
    api.neq = (col: string, value: unknown) => {
      neq[col] = value;
      return api;
    };
    api.in = (col: string, values: unknown[]) => {
      inSets[col] = values;
      return api;
    };
    api.maybeSingle = () =>
      Promise.resolve({ data: rows.filter(match)[0] ?? null, error: null });
    api.single = () =>
      Promise.resolve({ data: rows.filter(match)[0] ?? null, error: null });
    api.then = (r: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows.filter(match), error: null }).then(r);

    api.insert = (row: Row) => {
      if (name === "house_message_credits" && opts.creditWriteFails) {
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { message: "connection reset" },
              }),
          }),
        };
      }
      // The unique index on (seal_id) where entry_kind='purchase', in memory.
      if (
        name === "house_message_credits" &&
        row.entry_kind === "purchase" &&
        rows.some(
          (r) => r.entry_kind === "purchase" && r.seal_id === row.seal_id,
        )
      ) {
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: {
                  message: "duplicate key value violates unique constraint",
                },
              }),
          }),
        };
      }
      if (
        name === "house_message_purchase_intents" &&
        rows.some((r) => r.seal_id === row.seal_id)
      ) {
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: {
                  message: "duplicate key value violates unique constraint",
                },
              }),
          }),
        };
      }
      const written = {
        id: `${name === "house_message_credits" ? "credit" : "intent"}-${rows.length + 1}`,
        intended_at: new Date().toISOString(),
        ...row,
      };
      rows.push(written);
      ins = [written];
      return {
        select: () => ({
          single: () => Promise.resolve({ data: written, error: null }),
        }),
      };
    };

    api.update = (patch: Row) => {
      const upd: Record<string, unknown> = {};
      upd.eq = (col: string, value: unknown) => {
        eq[col] = value;
        return upd;
      };
      upd.neq = (col: string, value: unknown) => {
        neq[col] = value;
        return upd;
      };
      upd.in = (col: string, values: unknown[]) => {
        inSets[col] = values;
        return upd;
      };
      // `.is(col, null)` is how the seal spends itself exactly once
      // (`seal-challenge.service.ts`), so the stub has to honour it or the
      // single-use property would be untested here.
      upd.is = (col: string, value: unknown) => {
        if (value === null) isNull[col] = true;
        return upd;
      };
      const apply = () => {
        const hit = rows.filter(match);
        for (const r of hit) Object.assign(r, patch);
        return hit;
      };
      upd.select = () => ({
        maybeSingle: () =>
          Promise.resolve({ data: apply()[0] ?? null, error: null }),
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: apply(), error: null }).then(r),
      });
      upd.then = (r: (v: unknown) => unknown) => {
        apply();
        return Promise.resolve({ data: null, error: null }).then(r);
      };
      return upd;
    };
    void ins;
    return api;
  };

  const db = {
    supabase: {
      from(name: string) {
        if (name === "system_audit_log") {
          return { insert: () => Promise.resolve({ error: null }) };
        }
        return table(seals, name);
      },
    },
    client: {
      from(name: string) {
        if (name === "house_message_purchase_intents")
          return table(intents, name);
        if (name === "house_message_credits") return table(credits, name);
        if (name === "restaurants")
          return table(
            [
              {
                id: HOUSE,
                subscription_tier: "pilot",
                timezone: "UTC",
                currency: null,
              },
            ],
            name,
          );
        return table([], name);
      },
    },
  } as unknown as DatabaseService;

  const organizations = {
    assertCanManageRestaurant: jest.fn(async () => undefined),
  } as unknown as OrganizationsService;

  const sealService = new SealChallengeService(db);
  const usage = new TextUsageService(db);
  const intentService = new PurchaseIntentService(db);

  /**
   * THE MUTATION CATCH. The charge stub reads the intent row AS IT STANDS WHEN
   * THE PROVIDER IS CALLED and records it. A build that charged before writing
   * the intent would find no row; one that marked the state after the call would
   * find `intended`. Either fails the assertion, which is what makes the order
   * a property of the code rather than of a comment.
   */
  const stateAtChargeTime: (string | null)[] = [];
  const charge = jest.fn(
    async (_input: {
      restaurantId: string;
      amountMinor: number;
      currency: string;
      sealId: string;
    }) => {
      const row = intents.find((i) => i.seal_id === _input.sealId);
      stateAtChargeTime.push(row ? String(row.state) : null);
      return (
        opts.charge ?? {
          charged: true as const,
          paymentIntentId: "pi_1",
          status: "succeeded",
          words: "Charged 5000 USD minor units to the card on file.",
        }
      );
    },
  );

  const findChargeForSeal = jest.fn(
    async (sealId: string) =>
      (opts.find ?? stripeSearchHit(sealId)) as ReturnType<
        typeof stripeSearchHit
      >,
  );

  const billing = {
    chargeForMessageCredits: charge,
    findChargeForSeal,
  } as unknown as BillingService;

  const reconciler = new PurchaseIntentReconciler(
    intentService,
    usage,
    billing,
  );
  const controller = new TextCreditsController(
    usage,
    organizations,
    sealService,
    billing,
    intentService,
    reconciler,
  );

  return {
    controller,
    reconciler,
    intentService,
    usage,
    intents,
    credits,
    charge,
    findChargeForSeal,
    stateAtChargeTime,
  };
}

async function buy(c: ReturnType<typeof build>) {
  const minted = await c.controller.sealChallenge(req(), {
    amountMinor: 5000,
    currency: "USD",
  });
  return c.controller.purchase(
    req(),
    { amountMinor: 5000, currency: "USD" },
    minted.challenge,
  );
}

describe("the intent row exists before the charge", () => {
  it("writes it, and marks it charge_may_exist BEFORE the provider is asked", async () => {
    const c = build();
    const out = await buy(c);

    expect(c.intents).toHaveLength(1);
    // The mutation catch: a build that charged first would record `null` here,
    // and one that marked the row afterwards would record `intended`.
    expect(c.stateAtChargeTime).toEqual(["charge_may_exist"]);
    expect(out.state).toBe("settled");
    expect(out.settled).toBe(true);
    expect(c.intents[0].state).toBe("settled");
    expect(c.intents[0].payment_ref).toBe("pi_1");
    expect(c.intents[0].credit_entry_id).toBe(out.entryId);
  });

  it("does not charge at all when the seal is refused, and writes no intent", async () => {
    const c = build();
    await expect(
      c.controller.purchase(
        req(),
        { amountMinor: 5000, currency: "USD" },
        "no",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(c.intents).toHaveLength(0);
    expect(c.charge).not.toHaveBeenCalled();
  });

  it("voids the intent when the provider refuses, because that IS proof", async () => {
    const c = build({
      charge: {
        charged: false,
        reason: "no_instrument",
        words: "This house has no card on file, so nothing was charged.",
      },
    });
    const out = await buy(c);
    expect(out.state).toBe("voided");
    expect(out.settled).toBe(false);
    expect(c.credits).toHaveLength(0);
    expect(c.intents[0].state).toBe("voided");
    expect(String(c.intents[0].void_reason)).toContain("no_instrument");
  });
});

describe("a crash between the charge and the credit leaves a reconcilable row", () => {
  it("never says charged-true / recorded-false again", async () => {
    const c = build({ creditWriteFails: true });
    const out = await buy(c);

    // The response carries ONE state, not two booleans that disagree.
    expect(out).not.toHaveProperty("charged");
    expect(out).not.toHaveProperty("recorded");
    expect(out.state).toBe("charge_may_exist");
    expect(out.settled).toBe(false);
    expect(out.paymentIntentId).toBe("pi_1");
    expect(out.words).toContain("will be completed by a reconcile");
    expect(out.words).toContain("nothing will be charged twice");

    // And the row is on disk, reconcilable.
    expect(c.intents[0].state).toBe("charge_may_exist");
    expect(c.intents[0].charge_attempted_at).toBeTruthy();
  });

  it("the reconcile settles it from the provider, read BY THE SEAL ID", async () => {
    const c = build({ creditWriteFails: true });
    await buy(c);
    const sealId = String(c.intents[0].seal_id);

    // The credit write is only broken for the request; the reconcile writes it.
    const fixed = build();
    fixed.intents.push({ ...c.intents[0] });

    const run = await fixed.reconciler.run({ restaurantId: HOUSE });
    expect(run.considered).toBe(1);
    expect(fixed.findChargeForSeal).toHaveBeenCalledWith(sealId);
    expect(run.results[0].outcome).toBe("settled");
    expect(run.results[0].paymentIntentId).toBe(`pi_for_${sealId}`);
    expect(fixed.credits).toHaveLength(1);
    expect(fixed.credits[0].payment_ref).toBe(`pi_for_${sealId}`);
    expect(fixed.intents[0].state).toBe("settled");
  });
});

describe("the reconcile is idempotent", () => {
  it("settles once however many times it runs", async () => {
    const c = build({ creditWriteFails: true });
    await buy(c);
    const open = { ...c.intents[0] };

    const fixed = build();
    fixed.intents.push(open);

    const first = await fixed.reconciler.run();
    const second = await fixed.reconciler.run();
    const third = await fixed.reconciler.run();

    expect(first.results[0].outcome).toBe("settled");
    // A settled row leaves the open set, so later runs have nothing to do —
    // which is the shape that makes running it on a timer safe.
    expect(second.considered).toBe(0);
    expect(third.considered).toBe(0);
    expect(fixed.credits).toHaveLength(1);
  });

  it("settles against an existing credit rather than writing a second one", async () => {
    // The half-finished shape a reconcile actually meets: the credit landed and
    // the intent did not close.
    const c = build();
    c.credits.push({
      id: "credit-1",
      restaurant_id: HOUSE,
      entry_kind: "purchase",
      seal_id: "seal-1",
      amount_minor: 5000,
      currency: "USD",
      payment_ref: "pi_for_seal-1",
      recorded_at: new Date().toISOString(),
    });
    c.intents.push({
      id: "intent-1",
      restaurant_id: HOUSE,
      seal_id: "seal-1",
      amount_minor: 5000,
      currency: "USD",
      state: "charge_may_exist",
      intended_by: MANAGER,
      intended_at: new Date(Date.now() - SEARCH_LAG_FLOOR_MS * 2).toISOString(),
      charge_attempted_at: new Date(
        Date.now() - SEARCH_LAG_FLOOR_MS * 2,
      ).toISOString(),
    });

    const run = await c.reconciler.run();
    expect(run.results[0].outcome).toBe("already_settled");
    expect(c.credits).toHaveLength(1);
    expect(c.intents[0].state).toBe("settled");
  });
});

describe("the reconcile refuses to guess", () => {
  const openRow = (ageMs: number) => ({
    id: "intent-1",
    restaurant_id: HOUSE,
    seal_id: "seal-1",
    amount_minor: 5000,
    currency: "USD",
    state: "charge_may_exist",
    intended_by: MANAGER,
    intended_at: new Date(Date.now() - ageMs).toISOString(),
    charge_attempted_at: new Date(Date.now() - ageMs).toISOString(),
  });

  it("leaves a YOUNG intent open when the provider returns nothing", async () => {
    const c = build({ find: stripeSearchEmpty });
    c.intents.push(openRow(1000));
    const run = await c.reconciler.run();

    expect(run.results[0].outcome).toBe("too_young_to_judge");
    expect(c.intents[0].state).toBe("charge_may_exist");
    // The attempt is still recorded: a reconcile that leaves no trace when it
    // finds nothing to do is indistinguishable from one that never ran.
    expect(c.intents[0].reconciled_at).toBeTruthy();
    expect(String(c.intents[0].reconcile_detail)).toContain(
      "search index runs behind",
    );
  });

  it("voids an OLD intent when the provider returns nothing", async () => {
    const c = build({ find: stripeSearchEmpty });
    c.intents.push(openRow(SEARCH_LAG_FLOOR_MS * 3));
    const run = await c.reconciler.run();

    expect(run.results[0].outcome).toBe("voided");
    expect(c.intents[0].state).toBe("voided");
    expect(String(c.intents[0].void_reason)).toContain(
      "no charge carrying this seal",
    );
    expect(c.credits).toHaveLength(0);
  });

  it("voids on a charge the provider says did NOT succeed, quoting its status", async () => {
    const c = build({ find: stripeSearchHit("seal-1", "requires_action") });
    c.intents.push(openRow(1000));
    const run = await c.reconciler.run();

    expect(run.results[0].outcome).toBe("voided");
    expect(String(c.intents[0].void_reason)).toContain("requires_action");
    expect(c.credits).toHaveLength(0);
  });

  it("does NOT void when the provider could not be asked", async () => {
    const c = build({
      find: {
        readable: false,
        succeeded: false,
        paymentIntentId: null,
        status: null,
        words: "The provider could not be asked about this purchase: timeout.",
      },
    });
    c.intents.push(openRow(SEARCH_LAG_FLOOR_MS * 3));
    const run = await c.reconciler.run();

    expect(run.results[0].outcome).toBe("read_failed");
    // An unanswered provider is not proof that no charge exists.
    expect(c.intents[0].state).toBe("charge_may_exist");
    expect(run.results[0].words).toContain("not proof that no charge exists");
  });

  it("reports considered: null when the open set itself could not be read", async () => {
    const c = build();
    jest
      .spyOn(c.intentService, "open_intents")
      .mockResolvedValue({ rows: null, reason: "connection reset" });
    const run = await c.reconciler.run();

    expect(run.considered).toBeNull();
    expect(run.results).toHaveLength(0);
    expect(run.reason).toContain("not the same as there being none");
  });
});

describe("POST /communications/text-credits/reconcile", () => {
  it("runs the reconciler and hands back what it did", async () => {
    const c = build({ find: stripeSearchEmpty });
    c.intents.push({
      id: "intent-1",
      restaurant_id: HOUSE,
      seal_id: "seal-1",
      amount_minor: 5000,
      currency: "USD",
      state: "charge_may_exist",
      intended_at: new Date(Date.now() - SEARCH_LAG_FLOOR_MS * 3).toISOString(),
      charge_attempted_at: new Date(
        Date.now() - SEARCH_LAG_FLOOR_MS * 3,
      ).toISOString(),
    });
    const run = await c.controller.reconcile({ restaurantId: HOUSE });
    expect(run.considered).toBe(1);
    expect(run.results[0].outcome).toBe("voided");
  });
});
