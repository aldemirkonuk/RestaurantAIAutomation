/**
 * A card-on-file change is REDEEMED, not asserted (founder, 2026-09-04; ADR
 * 0110 addendum).
 *
 * The measurement this closes: every write on `PaymentMethodsController` ran
 * `assertCanManageRestaurant` and nothing else. That answers "may this ROLE do
 * it" and cannot answer "did a PERSON do it" — so anything holding a manager's
 * session could attach an instrument, make it the one the provider charges
 * first, or detach the house's card, and the gateway could not tell that from a
 * manager's own thumb. ADR 0110 records that no charge path exists yet, which
 * is exactly why this is cheap to close now rather than after money moves.
 *
 * Each case below fails against the pre-pass controller, because that
 * controller performs the write with no seal at all — cases 1 to 3.
 *
 *  1-3. `create`, `set_default` and `remove` each REFUSE without a seal, and
 *       the service method is NOT called (a test that only asserted the throw
 *       would pass on a controller that checked and then wrote anyway);
 *  4.   a good seal lets the write through, exactly once;
 *  5.   a seal minted for one act cannot pay for another;
 *  6.   a seal minted for one instrument cannot pay for another;
 *  7.   a seal minted while looking at ····4242 cannot be spent after the row
 *       behind that id became a different card;
 *  8.   the seal is issued only to a manager, and the role is re-checked when
 *       the write arrives.
 */

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import { DatabaseService } from "../database/database.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { PaymentMethodsController } from "./payment-methods.controller";
import { PaymentMethodsService } from "./payment-methods.service";
import { CreatePaymentMethodDto } from "./dto/payment-method.dto";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const METHOD = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;

function req() {
  return { user: { userId: MANAGER, restaurantId: HOUSE } } as unknown as Request & {
    user: { userId: string; restaurantId?: string };
  };
}

function build(opts: { allow?: boolean; card?: { brand: string; last4: string } } = {}) {
  const seals: Row[] = [];
  const audits: Row[] = [];
  const card = opts.card ?? { brand: "visa", last4: "4242" };

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
      },
    },
  } as unknown as DatabaseService;

  const service = {
    sealFacts: jest.fn(async () => ({ methodId: METHOD, ...card })),
    create: jest.fn(async () => ({ id: "new" }) as never),
    setDefault: jest.fn(async () => ({ id: METHOD }) as never),
    remove: jest.fn(async () => ({ removed: METHOD })),
  } as unknown as PaymentMethodsService;

  const organizations = {
    assertCanManageRestaurant: jest.fn(async () => {
      if (opts.allow === false) {
        throw new ForbiddenException("Only managers and owners");
      }
    }),
  } as unknown as OrganizationsService;

  const controller = new PaymentMethodsController(
    service,
    organizations,
    new SealChallengeService(db),
  );

  return { controller, service, organizations, seals, audits };
}

async function mint(
  h: ReturnType<typeof build>,
  act: string,
  methodId?: string,
): Promise<string> {
  const out = await h.controller.sealChallenge(req(), { act, methodId });
  return out.challenge;
}

const DTO = {} as CreatePaymentMethodDto;

describe("PaymentMethodsController — a payment write carries a redeemed seal", () => {
  it("refuses `create` with no seal, and does not create", async () => {
    const h = build();
    await expect(h.controller.create(req(), DTO, undefined)).rejects.toThrow(
      /must be proven rather than asserted/i,
    );
    expect(h.service.create).not.toHaveBeenCalled();
  });

  it("refuses `set_default` with no seal, and does not write the default", async () => {
    const h = build();
    await expect(
      h.controller.setDefault(req(), METHOD, undefined),
    ).rejects.toThrow(/must be proven rather than asserted/i);
    expect(h.service.setDefault).not.toHaveBeenCalled();
  });

  it("refuses `remove` with no seal, and detaches nothing", async () => {
    const h = build();
    await expect(h.controller.remove(req(), METHOD, undefined)).rejects.toThrow(
      /must be proven rather than asserted/i,
    );
    expect(h.service.remove).not.toHaveBeenCalled();
  });

  it("lets a good seal through, exactly once", async () => {
    const h = build();
    const token = await mint(h, "set_default", METHOD);
    await h.controller.setDefault(req(), METHOD, token);
    expect(h.service.setDefault).toHaveBeenCalledWith(HOUSE, METHOD);

    await expect(h.controller.setDefault(req(), METHOD, token)).rejects.toThrow(
      /already been spent/i,
    );
    expect(h.service.setDefault).toHaveBeenCalledTimes(1);
  });

  it("refuses a `remove` seal spent on `set_default`", async () => {
    const h = build();
    const token = await mint(h, "remove", METHOD);
    await expect(h.controller.setDefault(req(), METHOD, token)).rejects.toThrow(
      /different act/i,
    );
    expect(h.service.setDefault).not.toHaveBeenCalled();
  });

  it("refuses a seal minted for a different instrument", async () => {
    const h = build();
    const token = await mint(h, "remove", METHOD);
    const other = "66666666-6666-4666-8666-666666666666";
    await expect(h.controller.remove(req(), other, token)).rejects.toThrow(
      /different payment method/i,
    );
    expect(h.service.remove).not.toHaveBeenCalled();
  });

  it("refuses after the card behind that id changed", async () => {
    const h = build();
    const token = await mint(h, "remove", METHOD);
    // The register showed ····4242 when the hold began; the row now says 1881.
    (h.service.sealFacts as jest.Mock).mockResolvedValue({
      methodId: METHOD,
      brand: "visa",
      last4: "1881",
    });
    await expect(h.controller.remove(req(), METHOD, token)).rejects.toThrow(
      /changed after the seal was issued/i,
    );
    expect(h.service.remove).not.toHaveBeenCalled();
  });

  it("seals `create` against the house's register, since there is no instrument yet", async () => {
    const h = build();
    const token = await mint(h, "create");
    expect(h.seals[0].subject_kind).toBe("payment_method");
    expect(h.seals[0].subject_id).toBe(HOUSE);
    expect(h.seals[0].tool_name).toBe("create");
    await h.controller.create(req(), DTO, token);
    expect(h.service.create).toHaveBeenCalledWith(HOUSE, DTO);
  });

  it("refuses a `create` seal spent on a `remove`", async () => {
    const h = build();
    const token = await mint(h, "create");
    await expect(h.controller.remove(req(), METHOD, token)).rejects.toThrow(
      /different payment method/i,
    );
  });

  it("checks the role when the seal is ISSUED, not only when it is spent", async () => {
    const h = build({ allow: false });
    await expect(mint(h, "remove", METHOD)).rejects.toThrow(/managers and owners/i);
    expect(h.seals).toHaveLength(0);
  });

  it("refuses to mint a seal that names no act", async () => {
    const h = build();
    await expect(
      h.controller.sealChallenge(req(), { act: "charge" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.seals).toHaveLength(0);
  });

  it("refuses to mint a per-instrument seal that names no instrument", async () => {
    const h = build();
    await expect(
      h.controller.sealChallenge(req(), { act: "remove" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("never stores the token, only its hash", async () => {
    const h = build();
    const token = await mint(h, "remove", METHOD);
    expect(JSON.stringify(h.seals[0])).not.toContain(token);
    expect(h.seals[0].token_hash).toEqual(expect.any(String));
  });

  it("files the refusal against the house and the instrument", async () => {
    const h = build();
    await h.controller.remove(req(), METHOD, undefined).catch(() => undefined);
    const row = h.audits[0];
    expect(row.action).toBe("seal_refused");
    expect(row.entity_type).toBe("payment_method");
    expect(row.entity_id).toBe(METHOD);
    expect(row.restaurant_id).toBe(HOUSE);
  });
});
