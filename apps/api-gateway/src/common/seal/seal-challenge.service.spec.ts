/**
 * A seal on an ORDER and a seal on a PAYMENT METHOD are redeemed, not asserted.
 *
 * Each case here is a way the mechanism could be decorative. None of them would
 * pass against the tree before this pass, because before it there was no way to
 * seal either subject at all — `approveOrder` took a role and an amount and
 * nothing else, and the three payment writes took a role and nothing else.
 *
 *  1. a seal issues, and the TOKEN IS NEVER STORED — only its sha256;
 *  2. a good seal redeems, exactly once;
 *  3. REPLAY is refused — and refused by the UPDATE's own `redeemed_at IS NULL`
 *     filter, not by a check-then-write in TypeScript;
 *  4. ANOTHER ACTOR cannot spend it;
 *  5. ANOTHER SUBJECT cannot spend it — including an order token on a payment
 *     method whose id happens to be identical, which is the collision the
 *     `subject_kind` column exists for;
 *  6. ANOTHER ACT cannot spend it;
 *  7. CHANGED ARGUMENTS refuse it — the edit-after-approval hole;
 *  8. EXPIRY refuses it;
 *  9. an ABSENT seal refuses, in the words a person can act on;
 * 10. every refusal is FILED before it is thrown, and a filing that fails does
 *     NOT turn the refusal into a 500.
 */

import { ForbiddenException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { SealChallengeService } from "./seal-challenge.service";
import { hashCallArgs, hashSealToken } from "./seal-token";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ORDER = "44444444-4444-4444-8444-444444444444";
const METHOD = "55555555-5555-4555-8555-555555555555";

type SealRow = Record<string, unknown>;

interface Harness {
  service: SealChallengeService;
  seals: SealRow[];
  inserts: SealRow[];
  audits: SealRow[];
  auditFails: { value: boolean };
}

function build(seed: SealRow[] = []): Harness {
  const seals = seed;
  const inserts: SealRow[] = [];
  const audits: SealRow[] = [];
  const auditFails = { value: false };

  const db = {
    supabase: {
      from(table: string) {
        if (table === "system_audit_log") {
          return {
            insert: (row: SealRow) => {
              if (auditFails.value) {
                return Promise.resolve({ error: { message: "audit is down" } });
              }
              audits.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table !== "mcp_seal_challenges") {
          throw new Error(`unexpected table ${table}`);
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
            data: seals.find((s) => s.token_hash === tokenHash) ?? null,
            error: null,
          });
        api.insert = (row: SealRow) => {
          inserts.push(row);
          seals.push({ id: `seal-${seals.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        };
        api.update = (patch: SealRow) => {
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
            then: (resolve: (v: unknown) => unknown) => {
              const row = seals.find((s) => s.id === rowId);
              // Single use is a property of THIS filter, not of the code above.
              if (!row || (unspentOnly && row.redeemed_at)) {
                return Promise.resolve({ data: [], error: null }).then(resolve);
              }
              row.redeemed_at = String(patch.redeemed_at);
              return Promise.resolve({
                data: [{ id: row.id }],
                error: null,
              }).then(resolve);
            },
          });
          return upd;
        };
        return api;
      },
    },
  } as unknown as DatabaseService;

  return {
    service: new SealChallengeService(db),
    seals,
    inserts,
    audits,
    auditFails,
  };
}

const ORDER_ARGS = { orderId: ORDER, total: "2000.00", providerId: "anadolu" };
const PAY_ARGS = { act: "set_default", methodId: METHOD, brand: "visa", last4: "4242" };

function orderSeal(over: SealRow = {}): SealRow {
  return {
    id: "seal-order",
    subject_kind: "procurement_order",
    subject_id: ORDER,
    actor_user_id: MANAGER,
    tool_name: "approve",
    args_hash: hashCallArgs(ORDER_ARGS),
    token_hash: hashSealToken("order-token"),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    redeemed_at: null,
    ...over,
  };
}

function redeemOrder(h: Harness, over: Record<string, unknown> = {}) {
  return h.service.redeem({
    restaurantId: HOUSE,
    actorUserId: MANAGER,
    subjectKind: "procurement_order",
    subjectId: ORDER,
    action: "approve",
    args: ORDER_ARGS,
    challenge: "order-token",
    ...over,
  });
}

describe("SealChallengeService — an order's seal", () => {
  it("issues a token and stores only its hash", async () => {
    const h = build();
    const out = await h.service.issue({
      restaurantId: HOUSE,
      actorUserId: MANAGER,
      subjectKind: "procurement_order",
      subjectId: ORDER,
      action: "approve",
      args: ORDER_ARGS,
    });

    expect(out.challenge).toMatch(/^[0-9a-f]{64}$/);
    const row = h.inserts[0];
    expect(row.subject_kind).toBe("procurement_order");
    expect(row.subject_id).toBe(ORDER);
    expect(row.restaurant_id).toBe(HOUSE);
    expect(row.tool_name).toBe("approve");
    expect(row.args_hash).toBe(hashCallArgs(ORDER_ARGS));
    // The token itself is nowhere in the row. This is the whole mechanism.
    expect(JSON.stringify(row)).not.toContain(out.challenge);
    expect(row.token_hash).toBe(hashSealToken(out.challenge));
    // Expiry is stated by the issuer, never defaulted.
    expect(typeof row.expires_at).toBe("string");
  });

  it("redeems a good seal exactly once, and refuses the replay", async () => {
    const h = build([orderSeal()]);
    await expect(redeemOrder(h)).resolves.toBeUndefined();
    expect(h.seals[0].redeemed_at).toBeTruthy();

    await expect(redeemOrder(h)).rejects.toThrow(/already been spent/i);
    expect(h.audits.at(-1)?.action).toBe("seal_refused");
  });

  it("refuses a seal issued to somebody else", async () => {
    const h = build([orderSeal()]);
    await expect(redeemOrder(h, { actorUserId: OTHER })).rejects.toThrow(
      /issued to somebody else/i,
    );
    expect(h.seals[0].redeemed_at).toBeNull();
  });

  it("refuses a seal issued for a different order", async () => {
    const h = build([orderSeal()]);
    await expect(
      redeemOrder(h, { subjectId: "99999999-9999-4999-8999-999999999999" }),
    ).rejects.toThrow(/different order/i);
  });

  it("refuses a seal issued for a different act on the same order", async () => {
    const h = build([orderSeal({ tool_name: "cancel" })]);
    await expect(redeemOrder(h)).rejects.toThrow(/different act/i);
  });

  it("refuses after the order's total changed — the edit-after-approval hole", async () => {
    const h = build([orderSeal()]);
    await expect(
      redeemOrder(h, {
        args: { ...ORDER_ARGS, total: "20000.00" },
      }),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.seals[0].redeemed_at).toBeNull();
  });

  it("refuses an expired seal", async () => {
    const h = build([
      orderSeal({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    ]);
    await expect(redeemOrder(h)).rejects.toThrow(/expired/i);
  });

  it("refuses an absent seal, in words that say what to do", async () => {
    const h = build([orderSeal()]);
    const err = await redeemOrder(h, { challenge: null }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String(err.message)).toMatch(/must be proven rather than asserted/i);
    expect(String(err.message)).toMatch(/Nothing was changed/i);
  });

  it("refuses a seal this house never issued", async () => {
    const h = build([orderSeal()]);
    await expect(redeemOrder(h, { challenge: "not-a-seal" })).rejects.toThrow(
      /not one this house issued/i,
    );
  });

  it("files every refusal against the house and the subject", async () => {
    const h = build([orderSeal()]);
    await redeemOrder(h, { actorUserId: OTHER }).catch(() => undefined);
    const row = h.audits[0];
    expect(row.action).toBe("seal_refused");
    expect(row.entity_type).toBe("procurement_order");
    expect(row.entity_id).toBe(ORDER);
    expect(row.restaurant_id).toBe(HOUSE);
    expect(row.actor_id).toBe(OTHER);
    expect(String(row.reason)).toMatch(/issued to somebody else/i);
  });

  it("still refuses when the filing itself fails — the paper does not decide", async () => {
    const h = build([orderSeal()]);
    h.auditFails.value = true;
    const err = await redeemOrder(h, { actorUserId: OTHER }).catch((e) => e);
    // A 403, not a 500. The refusal already happened; a failed audit row must
    // not tell the person something false about what just happened.
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(h.audits).toHaveLength(0);
  });
});

describe("SealChallengeService — a payment method's seal", () => {
  const paySeal = (over: SealRow = {}): SealRow => ({
    id: "seal-pay",
    subject_kind: "payment_method",
    subject_id: METHOD,
    actor_user_id: MANAGER,
    tool_name: "set_default",
    args_hash: hashCallArgs(PAY_ARGS),
    token_hash: hashSealToken("pay-token"),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    redeemed_at: null,
    ...over,
  });

  const redeemPay = (h: Harness, over: Record<string, unknown> = {}) =>
    h.service.redeem({
      restaurantId: HOUSE,
      actorUserId: MANAGER,
      subjectKind: "payment_method",
      subjectId: METHOD,
      action: "set_default",
      args: PAY_ARGS,
      challenge: "pay-token",
      ...over,
    });

  it("redeems once and refuses the replay", async () => {
    const h = build([paySeal()]);
    await expect(redeemPay(h)).resolves.toBeUndefined();
    await expect(redeemPay(h)).rejects.toThrow(/already been spent/i);
  });

  it("refuses when the card behind the id changed", async () => {
    const h = build([paySeal()]);
    await expect(
      redeemPay(h, { args: { ...PAY_ARGS, last4: "1881" } }),
    ).rejects.toThrow(/payment method changed after the seal was issued/i);
  });

  it("refuses a seal for `remove` being spent on `set_default`", async () => {
    const h = build([paySeal({ tool_name: "remove" })]);
    await expect(redeemPay(h)).rejects.toThrow(/different act/i);
  });

  it("refuses an ORDER's seal on a payment method with the SAME id", async () => {
    // The collision `subject_kind` exists for: one uuid, two tables.
    const h = build([
      orderSeal({
        subject_id: METHOD,
        token_hash: hashSealToken("pay-token"),
        args_hash: hashCallArgs(PAY_ARGS),
        tool_name: "set_default",
      }),
    ]);
    await expect(redeemPay(h)).rejects.toThrow(/different payment method/i);
    expect(h.seals[0].redeemed_at).toBeNull();
  });

  it("names the payment method, not 'order', in its absent-seal refusal", async () => {
    const h = build([paySeal()]);
    const err = await redeemPay(h, { challenge: "" }).catch((e) => e);
    expect(String(err.message)).toMatch(/This payment method is sealed/i);
  });
});
