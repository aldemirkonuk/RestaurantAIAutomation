/**
 * Buying message credits is REDEEMED, not asserted (ADR 0107; OD-23 answered
 * 2026-09-05).
 *
 * WHAT THIS CLOSES BEFORE IT CAN OPEN
 * -----------------------------------
 * ADR 0110's addendum recorded, in its own text, that the seal it had just
 * added sat on a route nobody called while the route everybody called ran a
 * role check and nothing else. That was a MODULE boundary rather than a coding
 * mistake — the pass that added the seal named `payment-methods/**` as its
 * scope, and `billing/**` was outside it. The credit ledger is a third money
 * surface, so it is sealed and put inside `check_money_routes_are_sealed.py`'s
 * scope in the same pass that creates it rather than in a later census.
 *
 * THE BINDING IS THE AMOUNT, AND THAT IS THE POINT
 * ------------------------------------------------
 * A seal bound only to the restaurant would let a browser that obtained one
 * gesture spend any figure it liked. The arguments are the amount and the
 * currency, so a seal minted over 50 USD refuses at 500 USD with
 * `arguments_changed` — asserted below, because that is the property the rest
 * of the design rests on.
 *
 * NOTHING IN THIS FILE TAKES A PAYMENT. The route records a purchase; charging
 * an instrument is `/billing`'s job and is deliberately not wired to it.
 */

import { ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import { DatabaseService } from "../../../database/database.service";
import { SealChallengeService } from "../../../common/seal/seal-challenge.service";
import { OrganizationsService } from "../../../organizations/organizations.service";
import { TextUsageService } from "../text-usage.service";
import {
  TextCreditsController,
  creditPurchaseSealArgs,
} from "./text-credits.controller";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const OTHER_MANAGER = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;

function req(userId = MANAGER) {
  return { user: { userId, restaurantId: HOUSE } } as unknown as Request & {
    user: { userId: string; restaurantId?: string };
  };
}

/**
 * A session with no active restaurant.
 *
 * A SEPARATE HELPER, not `req(MANAGER, undefined)`. A default parameter treats
 * an explicitly-passed `undefined` as "not passed" and substitutes the default,
 * so the first draft of this spec asked for a restaurant-less session and got
 * the ordinary one — and passed for the wrong reason until it was run.
 */
function reqWithNoHouse(userId = MANAGER) {
  return { user: { userId } } as unknown as Request & {
    user: { userId: string; restaurantId?: string };
  };
}

/**
 * One in-memory store standing in for `mcp_seal_challenges`,
 * `house_message_credits`, `plan_message_allowances`, `house_message_meter` and
 * `restaurants`.
 *
 * Hand-built rather than reused from `supabase-stub` because
 * `SealChallengeService` looks a seal up by `token_hash` on redemption and by
 * `id` on assertion, and the shape of that lookup is part of what is being
 * tested: a store that answered any filter with the same row would prove
 * nothing about either.
 */
function build(opts: { allow?: boolean } = {}) {
  const seals: Row[] = [];
  const credits: Row[] = [];
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
              return Promise.resolve({
                data: [{ id: row.id }],
                error: null,
              }).then(r);
            },
          });
          return upd;
        };
        return api;
      },
    },
    client: {
      from(table: string) {
        const rows: Row[] =
          table === "house_message_credits"
            ? credits
            : table === "restaurants"
              ? [
                  {
                    id: HOUSE,
                    subscription_tier: "pilot",
                    timezone: "UTC",
                    currency: null,
                  },
                ]
              : [];
        const api: Record<string, unknown> = {};
        api.select = () => api;
        api.eq = () => api;
        api.order = () => api;
        api.limit = () => api;
        api.is = () => api;
        api.maybeSingle = () =>
          Promise.resolve({ data: rows[0] ?? null, error: null });
        api.then = (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null, count: rows.length }).then(
            r,
          );
        api.insert = (row: Row) => ({
          select: () => ({
            single: () => {
              const written = { id: `credit-${credits.length + 1}`, ...row };
              credits.push(written);
              return Promise.resolve({ data: written, error: null });
            },
          }),
        });
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

  const sealService = new SealChallengeService(db);
  const usage = new TextUsageService(db);
  const controller = new TextCreditsController(
    usage,
    organizations,
    sealService,
  );

  return { controller, credits, seals, organizations };
}

describe("POST /communications/text-credits/purchase — the seal is spent, not claimed", () => {
  it("refuses with NO seal header, and writes nothing", async () => {
    const { controller, credits } = build();
    await expect(
      controller.purchase(
        req(),
        { amountMinor: 5000, currency: "USD" },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(credits).toHaveLength(0);
  });

  it("refuses an INVENTED challenge, and writes nothing", async () => {
    const { controller, credits } = build();
    await expect(
      controller.purchase(
        req(),
        { amountMinor: 5000, currency: "USD" },
        "not-a-seal",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(credits).toHaveLength(0);
  });

  it("records the purchase when a freshly minted seal is carried back", async () => {
    const { controller, credits } = build();
    const minted = await controller.sealChallenge(req(), {
      amountMinor: 5000,
      currency: "USD",
    });
    const out = await controller.purchase(
      req(),
      { amountMinor: 5000, currency: "USD" },
      minted.challenge,
    );
    expect(out.recorded).toBe(true);
    expect(credits).toHaveLength(1);
    expect(credits[0].entry_kind).toBe("purchase");
    expect(credits[0].seal_id).toBeTruthy();
    expect(credits[0].currency).toBe("USD");
  });

  it("SPENDS the seal once: the same challenge is refused the second time", async () => {
    const { controller, credits } = build();
    const minted = await controller.sealChallenge(req(), {
      amountMinor: 5000,
      currency: "USD",
    });
    await controller.purchase(
      req(),
      { amountMinor: 5000, currency: "USD" },
      minted.challenge,
    );
    await expect(
      controller.purchase(
        req(),
        { amountMinor: 5000, currency: "USD" },
        minted.challenge,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(credits).toHaveLength(1);
  });

  it("refuses a seal minted for a DIFFERENT amount", async () => {
    const { controller, credits } = build();
    const minted = await controller.sealChallenge(req(), {
      amountMinor: 5000,
      currency: "USD",
    });
    await expect(
      controller.purchase(
        req(),
        { amountMinor: 50000, currency: "USD" },
        minted.challenge,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(credits).toHaveLength(0);
  });

  it("refuses a seal minted for a DIFFERENT currency", async () => {
    const { controller, credits } = build();
    const minted = await controller.sealChallenge(req(), {
      amountMinor: 5000,
      currency: "USD",
    });
    await expect(
      controller.purchase(
        req(),
        { amountMinor: 5000, currency: "TRY" },
        minted.challenge,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(credits).toHaveLength(0);
  });

  it("refuses another PERSON's seal", async () => {
    const { controller, credits } = build();
    const minted = await controller.sealChallenge(req(MANAGER), {
      amountMinor: 5000,
      currency: "USD",
    });
    await expect(
      controller.purchase(
        req(OTHER_MANAGER),
        { amountMinor: 5000, currency: "USD" },
        minted.challenge,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(credits).toHaveLength(0);
  });

  it("runs the manager-or-owner check on all three routes", async () => {
    const { controller, organizations } = build({ allow: false });
    await expect(controller.meter(req())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.sealChallenge(req(), { amountMinor: 1, currency: "USD" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.purchase(req(), { amountMinor: 1, currency: "USD" }, "x"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledTimes(3);
  });

  it("refuses an amount with no currency BEFORE it mints or spends anything", async () => {
    const { controller, seals, credits } = build();
    await expect(
      controller.sealChallenge(req(), { amountMinor: 5000 }),
    ).rejects.toThrow(/three-letter ISO 4217/);
    await expect(
      controller.purchase(req(), { amountMinor: 5000 }, "x"),
    ).rejects.toThrow(/three-letter ISO 4217/);
    expect(seals).toHaveLength(0);
    expect(credits).toHaveLength(0);
  });

  it("refuses a session with no active restaurant", async () => {
    const { controller } = build();
    await expect(controller.meter(reqWithNoHouse())).rejects.toThrow(
      /no active restaurant/,
    );
  });
});

describe("creditPurchaseSealArgs — one definition of what the seal is for", () => {
  it("is the amount and the currency, and nothing else", () => {
    expect(
      creditPurchaseSealArgs({ amountMinor: 5000, currency: "USD" }),
    ).toEqual({
      amountMinor: 5000,
      currency: "USD",
    });
  });

  it("distinguishes two amounts, which is what makes the binding load-bearing", () => {
    expect(
      creditPurchaseSealArgs({ amountMinor: 5000, currency: "USD" }),
    ).not.toEqual(
      creditPurchaseSealArgs({ amountMinor: 50000, currency: "USD" }),
    );
  });
});
