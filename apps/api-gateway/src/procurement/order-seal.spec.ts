/**
 * Sealing an order is now something the gateway can CHECK.
 *
 * Before this pass `POST /procurement/orders/:id/approve` took a role and an
 * amount and nothing else: ADR 0116's gate answered "may this ROLE seal this
 * figure" and had no way to answer "did a PERSON do this". Every case below
 * fails against that code, because that code accepts an approval with no seal
 * at all — which is case 1.
 *
 *  1. an approval with NO challenge is refused, in words, and nothing is written;
 *  2. an approval with a GOOD challenge goes through;
 *  3. the challenge is bound to the order's own TOTAL, so a seal minted at
 *     2,000 cannot be spent after the order became 20,000;
 *  4. the seal is only issued to somebody who could actually seal — the role
 *     and the policy are checked at issue as well as at redemption;
 *  5. redemption runs AFTER the policy gate, so a person who cannot seal this
 *     order is told that rather than having their seal burned.
 */

import { ForbiddenException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { hashCallArgs, hashSealToken } from "../common/seal/seal-token";
import { ProcurementService } from "./procurement.service";
import { normaliseSealTotal, orderSealArgs } from "./order-seal";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const ORDER = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;

function harness(opts: {
  total?: string | null;
  /** The order's unit prices (answer 10 hashes the chain final/negotiated/quoted). */
  prices?: Row;
  seals?: Row[];
  role?: string | null;
  requiredRole?: "owner" | "manager" | null;
}) {
  const seals = opts.seals ?? [];
  const updates: Row[] = [];
  const audits: Row[] = [];
  const order = {
    id: ORDER,
    total_cost: opts.total === undefined ? "2000.00" : opts.total,
    provider_id: "anadolu",
    inventory_id: null,
    final_price: null,
    status: "pending",
    ...(opts.prices ?? {}),
  } as Row;

  const chain = (result: { data: unknown; error: null }) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit", "neq", "lt"]) {
      self[m] = () => self;
    }
    self.maybeSingle = () => Promise.resolve(result);
    self.single = () => Promise.resolve(result);
    self.then = (r: (v: unknown) => unknown) => Promise.resolve(result).then(r);
    return self;
  };

  const db = {
    supabase: {
      from(table: string) {
        if (table === "procurement_orders") {
          // The house is honoured rather than ignored: every read here is
          // `.eq("restaurant_id", …)`, and a stub that answered the same row
          // for any house would make the 404 path untestable.
          let house: string | null = null;
          const scoped: Record<string, unknown> = {};
          for (const m of ["select", "is", "in", "order", "limit", "neq", "lt"]) {
            scoped[m] = () => scoped;
          }
          scoped.eq = (col: string, value: string) => {
            if (col === "restaurant_id") house = value;
            return scoped;
          };
          const answer = () => ({
            data: house === null || house === HOUSE ? order : null,
            error: null as null,
          });
          scoped.maybeSingle = () => Promise.resolve(answer());
          scoped.single = () => Promise.resolve(answer());
          scoped.then = (r: (v: unknown) => unknown) =>
            Promise.resolve(answer()).then(r);
          return {
            ...scoped,
            update: (patch: Row) => {
              updates.push(patch);
              return chain({
                data: { ...order, ...patch, inventory: null },
                error: null,
              });
            },
          };
        }
        if (table === "system_audit_log") {
          return {
            insert: (row: Row) => {
              audits.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === "mcp_seal_challenges") {
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
              data: seals.find((s) => s.token_hash === tokenHash) ?? null,
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
        }
        return chain({ data: null, error: null });
      },
    },
  } as unknown as DatabaseService;

  const thresholds = {
    read: async () => ({
      readable: true as const,
      reason: null,
      thresholds: [],
    }),
  };
  const organizations = {
    resolveRestaurantRole: async () => opts.role ?? "manager",
    assertCanManageRestaurant: async () => {
      if ((opts.role ?? "manager") === "staff") {
        throw new ForbiddenException("not a manager");
      }
    },
  };

  const service = new ProcurementService(
    db,
    { emit: async () => undefined } as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    thresholds as never,
    organizations as never,
    new SealChallengeService(db),
  );

  return { service, seals, updates, audits, order };
}

const GOOD_ARGS = orderSealArgs({
  id: ORDER,
  total: "2000.00",
  providerId: "anadolu",
});

function unspentSeal(over: Row = {}): Row {
  return {
    id: "seal-1",
    subject_kind: "procurement_order",
    subject_id: ORDER,
    actor_user_id: MANAGER,
    tool_name: "approve",
    args_hash: hashCallArgs(GOOD_ARGS),
    token_hash: hashSealToken("tok"),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    redeemed_at: null,
    ...over,
  };
}

describe("order-seal — what the hash covers", () => {
  it("normalises money to cents, so issue and redemption cannot disagree", () => {
    // PostgREST hands back `numeric` as a string and `float` as a number. A
    // seal that hashed one shape at issue and the other at redemption would
    // refuse every honest approval.
    expect(normaliseSealTotal("2000.00")).toBe(normaliseSealTotal(2000));
    expect(normaliseSealTotal(2000.004)).toBe("2000.00");
  });

  it("hashes an unreadable total as 'unknown', never as zero", () => {
    // Zero is a price. "We could not read it" is not, and the two must not
    // collapse into the same seal.
    expect(normaliseSealTotal(null)).toBe("unknown");
    expect(normaliseSealTotal(0)).toBe("0.00");
    expect(normaliseSealTotal(null)).not.toBe(normaliseSealTotal(0));
  });
});

describe("ProcurementService.approveOrder — the seal is redeemed, not asserted", () => {
  it("refuses an approval carrying NO seal, and writes nothing", async () => {
    const h = harness({});
    const err = await h.service
      .approveOrder(HOUSE, ORDER, MANAGER, null)
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String(err.message)).toMatch(/must be proven rather than asserted/i);
    // The status was never written. This is the case that fails against the
    // pre-pass tree, where the same call returned an APPROVED order.
    expect(h.updates).toHaveLength(0);
    expect(h.audits.some((a) => a.action === "seal_refused")).toBe(true);
  });

  it("approves when the seal is good, and spends it", async () => {
    const h = harness({ seals: [unspentSeal()] });
    await h.service.approveOrder(HOUSE, ORDER, MANAGER, "tok");

    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].approved_by).toBe(MANAGER);
    expect(h.seals[0].redeemed_at).toBeTruthy();
  });

  it("refuses the same seal a second time", async () => {
    const h = harness({ seals: [unspentSeal()] });
    await h.service.approveOrder(HOUSE, ORDER, MANAGER, "tok");
    await expect(
      h.service.approveOrder(HOUSE, ORDER, MANAGER, "tok"),
    ).rejects.toThrow(/already been spent/i);
    expect(h.updates).toHaveLength(1);
  });

  it("refuses a seal minted before the order's total changed", async () => {
    // The seal was taken over 2,000; the order now says 20,000.
    const h = harness({
      total: "20000.00",
      seals: [unspentSeal()],
    });
    await expect(
      h.service.approveOrder(HOUSE, ORDER, MANAGER, "tok"),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.updates).toHaveLength(0);
  });

  it("issues a seal bound to this actor, this order and this order's figures", async () => {
    const h = harness({});
    const out = await h.service.issueOrderSealChallenge(HOUSE, ORDER, MANAGER);

    expect(out.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(out.act).toBe("approve");
    const row = h.seals[0];
    expect(row.subject_kind).toBe("procurement_order");
    expect(row.subject_id).toBe(ORDER);
    expect(row.actor_user_id).toBe(MANAGER);
    expect(row.args_hash).toBe(hashCallArgs(GOOD_ARGS));
    expect(JSON.stringify(row)).not.toContain(out.challenge);
  });

  it("does not issue a seal for a call the gate would refuse anyway", async () => {
    // A seal a manager holds and is then told meant nothing teaches people that
    // the seal is decoration, so `issueOrderSealChallenge` runs the SAME
    // `assertApprovalAllowed` the approval runs. Proved here with the refusal
    // this harness can state unambiguously: an order that does not belong to
    // this house. (The role/threshold refusals are proved, twenty-one ways, in
    // `order-approval-gate.spec.ts`.)
    const h = harness({});
    await expect(
      h.service.issueOrderSealChallenge(
        "77777777-7777-4777-8777-777777777777",
        ORDER,
        MANAGER,
      ),
    ).rejects.toThrow(/nothing to approve/i);
    expect(h.seals).toHaveLength(0);
  });

  it("issues a token that then approves — the two ends agree about the args", async () => {
    const h = harness({});
    const out = await h.service.issueOrderSealChallenge(HOUSE, ORDER, MANAGER);
    await h.service.approveOrder(HOUSE, ORDER, MANAGER, out.challenge);
    expect(h.updates).toHaveLength(1);
  });
});

/**
 * ADR 0244 D3, the founder's answer 10 (2026-09-30), verbatim pick "Add unit
 * price, versioned (Recommended)": the approval seal covers the total, the
 * vendor AND the unit price the approval rules test (final, then negotiated,
 * then quoted), under a version tag; a hold opened before the deploy (version
 * 1: total and vendor) may still finish.
 *
 * [REVERT-FAILS] marks a case that fails on 9c20fd0e3 (#542's head).
 */
describe("the approval seal carries the unit price, versioned (answer 10)", () => {
  /** The version-1 shape, written out: what every hold was minted over before answer 10. */
  const V1 = { orderId: ORDER, total: "2000.00", providerId: "anadolu" };

  it("[REVERT-FAILS] mints version 2 over the total, the vendor and the unit price, never version 1", async () => {
    const h = harness({ prices: { negotiated_price: "400" } });
    await h.service.issueOrderSealChallenge(HOUSE, ORDER, MANAGER);
    expect(h.seals[0].args_hash).toBe(
      hashCallArgs({
        sealVersion: 2,
        orderId: ORDER,
        total: "2000.00",
        providerId: "anadolu",
        unitPrice: "400.00",
      }),
    );
    expect(h.seals[0].args_hash).not.toBe(hashCallArgs(V1));
  });

  it("[REVERT-FAILS] refuses a seal held before the negotiated price changed", async () => {
    const h = harness({ prices: { negotiated_price: "400" } });
    const out = await h.service.issueOrderSealChallenge(HOUSE, ORDER, MANAGER);
    (h.order as Row).negotiated_price = "450";
    await expect(
      h.service.approveOrder(HOUSE, ORDER, MANAGER, out.challenge),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.updates).toHaveLength(0);
  });

  it("[REVERT-FAILS] reads the unit price down the chain: final, then negotiated, then quoted", async () => {
    const h = harness({ prices: { final_price: "380", negotiated_price: "400", quoted_price: "420" } });
    await h.service.issueOrderSealChallenge(HOUSE, ORDER, MANAGER);
    expect(h.seals[0].args_hash).toBe(
      hashCallArgs({ sealVersion: 2, orderId: ORDER, total: "2000.00", providerId: "anadolu", unitPrice: "380.00" }),
    );
  });

  it("a hold opened before the deploy (version 1) still finishes", async () => {
    const h = harness({
      prices: { negotiated_price: "400" },
      seals: [unspentSeal({ args_hash: hashCallArgs(V1) })],
    });
    await h.service.approveOrder(HOUSE, ORDER, MANAGER, "tok");
    expect(h.updates).toHaveLength(1);
  });

  it("a version-1 hold is still refused when the total changed", async () => {
    const h = harness({
      total: "2500.00",
      seals: [unspentSeal({ args_hash: hashCallArgs(V1) })],
    });
    await expect(
      h.service.approveOrder(HOUSE, ORDER, MANAGER, "tok"),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.updates).toHaveLength(0);
  });

  it("an order with no unit price hashes it as 'unknown' at both ends, and approves", async () => {
    const h = harness({});
    const out = await h.service.issueOrderSealChallenge(HOUSE, ORDER, MANAGER);
    expect(h.seals[0].args_hash).toBe(hashCallArgs(orderSealArgs({ id: ORDER, total: "2000.00", providerId: "anadolu", unitPrice: null })));
    await h.service.approveOrder(HOUSE, ORDER, MANAGER, out.challenge);
    expect(h.updates).toHaveLength(1);
  });
});
