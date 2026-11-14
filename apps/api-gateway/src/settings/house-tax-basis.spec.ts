/**
 * A house can say whether its prices hold tax and whether it reclaims the tax
 * it pays (ADR 0359 C2/C3, lane 3.5a). Fixtures are SYNTHETIC.
 */
import { BadRequestException, ForbiddenException, InternalServerErrorException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SETTINGS_AUDIT_ACTIONS } from "../settings-audit/settings-audit.service";
import { SetHouseTaxBasisDto } from "./dto/house-tax-basis.dto";
import { HouseTaxBasisController } from "./house-tax-basis.controller";
import { HouseTaxBasisService, TAX_BASIS_AUDIT_ACTION } from "./house-tax-basis.service";

const REST = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type Result = { data: unknown; error: unknown };

/** Answers per table, in order for `restaurants` (before, then after), and records writes. */
function makeDb(restaurants: Result[], opts: { updateError?: { message: string }; users?: Result } = {}) {
  const calls = { updates: [] as Array<{ row: Record<string, unknown>; id: unknown }>, selects: [] as string[] };
  let r = 0;
  const client = {
    from(table: string) {
      let pending: Record<string, unknown> | null = null;
      const chain: Record<string, (...a: any[]) => any> = {};
      chain.select = (cols: string) => {
        if (table === "restaurants") calls.selects.push(cols);
        return chain;
      };
      chain.update = (row: Record<string, unknown>) => {
        pending = row;
        return chain;
      };
      chain.eq = (_col: string, val: unknown) => {
        if (pending) {
          calls.updates.push({ row: pending, id: val });
          return Promise.resolve({ data: null, error: opts.updateError ?? null });
        }
        return chain;
      };
      chain.maybeSingle = async () => {
        if (table === "users") return opts.users ?? { data: { name: "SYNTHETIC owner" }, error: null };
        const out = restaurants[Math.min(r, restaurants.length - 1)];
        r += 1;
        return out;
      };
      return chain;
    },
  };
  return { calls, databaseService: { client } as any };
}

function audit(receipt = { recorded: true, reason: null as string | null }) {
  const filed: any[] = [];
  return { filed, record: async (c: any) => (filed.push(c), receipt) } as any;
}

const UNSET: Result = {
  data: { tax_basis: "unset", reclaims_input_tax: null, tax_basis_since: null, tax_basis_set_at: null, tax_basis_set_by: null },
  error: null,
};
const answered = (basis: string, reclaims: boolean | null, since = "2027-01-05T09:00:00Z"): Result => ({
  data: { tax_basis: basis, reclaims_input_tax: reclaims, tax_basis_since: since, tax_basis_set_at: "2027-02-01T09:00:00Z", tax_basis_set_by: USER },
  error: null,
});

describe("HouseTaxBasisService.read", () => {
  it("an unanswered house reads unset, readable, with no author", async () => {
    const db = makeDb([UNSET]);
    const out = await new HouseTaxBasisService(db.databaseService, audit()).read(REST);
    expect(out).toMatchObject({ basis: "unset", reclaimsInputTax: null, since: null, statedBy: null, readable: true, reason: null });
    expect(db.calls.selects).toEqual(["tax_basis, reclaims_input_tax, tax_basis_since, tax_basis_set_at, tax_basis_set_by"]);
  });

  it("an answered house reads its answers, the switch date and who gave them", async () => {
    const db = makeDb([answered("prices_include_tax", true)]);
    const out = await new HouseTaxBasisService(db.databaseService, audit()).read(REST);
    expect(out).toMatchObject({
      basis: "prices_include_tax",
      reclaimsInputTax: true,
      since: "2027-01-05T09:00:00Z",
      statedAt: "2027-02-01T09:00:00Z",
      statedBy: { userId: USER, name: "SYNTHETIC owner" },
      readable: true,
    });
  });

  it("a house that charges no VAT reads as reclaiming nothing", async () => {
    const db = makeDb([answered("not_vat_charging", null)]);
    const out = await new HouseTaxBasisService(db.databaseService, audit()).read(REST);
    expect(out.reclaimsInputTax).toBe(false);
  });

  it("a failed read is unreadable, in the house's words, never unset-and-readable", async () => {
    const db = makeDb([{ data: null, error: { message: "relation restaurants: permission denied" } }]);
    const out = await new HouseTaxBasisService(db.databaseService, audit()).read(REST);
    expect(out.readable).toBe(false);
    expect(out.reason).toBe("the house's tax answer could not be read just now");
    expect(out.reason).not.toMatch(/relation|permission/);
  });
});

describe("HouseTaxBasisService.write", () => {
  it("records both answers with their author, and files the change", async () => {
    const db = makeDb([UNSET, answered("prices_include_tax", true)]);
    const a = audit();
    const out = await new HouseTaxBasisService(db.databaseService, a).write(REST, "prices_include_tax", true, USER);
    expect(db.calls.updates).toHaveLength(1);
    const { row, id } = db.calls.updates[0];
    expect(id).toBe(REST);
    expect(row).toMatchObject({ tax_basis: "prices_include_tax", reclaims_input_tax: true, tax_basis_set_by: USER });
    expect(typeof row.tax_basis_set_at).toBe("string");
    // The switch date is the database's to set, never the gateway's.
    expect(row).not.toHaveProperty("tax_basis_since");
    expect(a.filed).toEqual([
      expect.objectContaining({
        action: "house_tax_basis_changed",
        register: "tax-basis",
        actorUserId: USER,
        entityId: REST,
        fields: {
          tax_basis: { from: "unset", to: "prices_include_tax" },
          reclaims_input_tax: { from: null, to: true },
        },
      }),
    ]);
    expect(out).toMatchObject({ basis: "prices_include_tax", reclaimsInputTax: true, audited: true });
  });

  it("a house that charges no VAT is stored as reclaiming nothing when it leaves the answer out", async () => {
    const db = makeDb([UNSET, answered("not_vat_charging", false)]);
    await new HouseTaxBasisService(db.databaseService, audit()).write(REST, "not_vat_charging", undefined, USER);
    expect(db.calls.updates[0].row).toMatchObject({ tax_basis: "not_vat_charging", reclaims_input_tax: false });
  });

  it("refuses a no-VAT house that says it reclaims, and writes nothing", async () => {
    const db = makeDb([UNSET]);
    await expect(
      new HouseTaxBasisService(db.databaseService, audit()).write(REST, "not_vat_charging", true, USER),
    ).rejects.toThrow(/charges no VAT has no VAT to reclaim/);
    expect(db.calls.updates).toEqual([]);
  });

  it("refuses a VAT-charging house that does not say whether it reclaims", async () => {
    for (const reclaims of [undefined, null, "yes"]) {
      const db = makeDb([UNSET]);
      await expect(
        new HouseTaxBasisService(db.databaseService, audit()).write(REST, "prices_exclude_tax", reclaims, USER),
      ).rejects.toThrow(BadRequestException);
      expect(db.calls.updates).toEqual([]);
    }
  });

  it("refuses unset and any basis outside the three", async () => {
    for (const basis of ["unset", "kdv_inside", "", null, 3]) {
      const db = makeDb([UNSET]);
      await expect(
        new HouseTaxBasisService(db.databaseService, audit()).write(REST, basis, true, USER),
      ).rejects.toThrow(/is not an answer this product knows/);
      expect(db.calls.updates).toEqual([]);
    }
  });

  it("refuses a no-VAT reclaim answer that is not a yes or a no", async () => {
    const db = makeDb([UNSET]);
    await expect(
      new HouseTaxBasisService(db.databaseService, audit()).write(REST, "not_vat_charging", "no", USER),
    ).rejects.toThrow(/a yes or a no/);
    expect(db.calls.updates).toEqual([]);
  });

  it("writes nothing when the house's current answer cannot be read", async () => {
    const db = makeDb([{ data: null, error: { message: "timeout" } }]);
    await expect(
      new HouseTaxBasisService(db.databaseService, audit()).write(REST, "prices_include_tax", true, USER),
    ).rejects.toThrow(InternalServerErrorException);
    expect(db.calls.updates).toEqual([]);
  });

  it("the same answers again change nothing: no write, no trail row, the author stays", async () => {
    const db = makeDb([answered("prices_include_tax", true)]);
    const a = audit();
    const out = await new HouseTaxBasisService(db.databaseService, a).write(REST, "prices_include_tax", true, USER);
    expect(db.calls.updates).toEqual([]);
    expect(a.filed).toEqual([]);
    expect(out).toMatchObject({ audited: false, auditReason: "nothing changed", statedAt: "2027-02-01T09:00:00Z" });
  });

  it("a changed reclaim answer alone is a change, and files both fields' before and after", async () => {
    const db = makeDb([answered("prices_include_tax", true), answered("prices_include_tax", false)]);
    const a = audit();
    await new HouseTaxBasisService(db.databaseService, a).write(REST, "prices_include_tax", false, USER);
    expect(db.calls.updates).toHaveLength(1);
    expect(a.filed[0].fields).toEqual({
      tax_basis: { from: "prices_include_tax", to: "prices_include_tax" },
      reclaims_input_tax: { from: true, to: false },
    });
  });

  it("a failed write says nothing changed and files nothing", async () => {
    const db = makeDb([UNSET], { updateError: { message: "check violation" } });
    const a = audit();
    await expect(
      new HouseTaxBasisService(db.databaseService, a).write(REST, "prices_include_tax", true, USER),
    ).rejects.toThrow("Could not record the tax answer. Nothing was changed.");
    expect(a.filed).toEqual([]);
  });

  it("a trail row that failed is visible on the readout", async () => {
    const db = makeDb([UNSET, answered("prices_exclude_tax", false)]);
    const out = await new HouseTaxBasisService(db.databaseService, audit({ recorded: false, reason: "trail down" })).write(
      REST,
      "prices_exclude_tax",
      false,
      USER,
    );
    expect(out).toMatchObject({ audited: false, auditReason: "trail down" });
  });

  it("the action is one the trail reads back", () => {
    expect(TAX_BASIS_AUDIT_ACTION).toBe("house_tax_basis_changed");
    expect(SETTINGS_AUDIT_ACTIONS).toContain(TAX_BASIS_AUDIT_ACTION);
  });
});

describe("HouseTaxBasisController", () => {
  it("checks the caller may manage the house before anything is written", async () => {
    const order: string[] = [];
    const svc = { write: jest.fn(async () => (order.push("write"), {} as any)), read: jest.fn() };
    const orgs = { assertCanManageRestaurant: jest.fn(async () => void order.push("role")) };
    const c = new HouseTaxBasisController(svc as any, orgs as any);
    await c.write(REST, { basis: "prices_include_tax", reclaimsInputTax: true }, USER);
    expect(orgs.assertCanManageRestaurant).toHaveBeenCalledWith(USER, REST, expect.any(String));
    expect(svc.write).toHaveBeenCalledWith(REST, "prices_include_tax", true, USER);
    expect(order).toEqual(["role", "write"]);
  });

  it("a caller who may not manage the house writes nothing", async () => {
    const svc = { write: jest.fn(), read: jest.fn() };
    const orgs = { assertCanManageRestaurant: jest.fn(async () => { throw new ForbiddenException("no"); }) };
    const c = new HouseTaxBasisController(svc as any, orgs as any);
    await expect(c.write(REST, { basis: "prices_include_tax", reclaimsInputTax: true }, USER)).rejects.toThrow(ForbiddenException);
    expect(svc.write).not.toHaveBeenCalled();
  });

  it("a session with no house reads and writes nothing", async () => {
    const svc = { write: jest.fn(), read: jest.fn() };
    const orgs = { assertCanManageRestaurant: jest.fn() };
    const c = new HouseTaxBasisController(svc as any, orgs as any);
    await expect(c.read("")).rejects.toThrow(/not attached to a restaurant/);
    await expect(c.write("", { basis: "prices_include_tax" }, USER)).rejects.toThrow(/not attached to a restaurant/);
    expect(svc.read).not.toHaveBeenCalled();
    expect(svc.write).not.toHaveBeenCalled();
  });
});

describe("SetHouseTaxBasisDto", () => {
  const errs = async (body: object) =>
    (await validate(plainToInstance(SetHouseTaxBasisDto, body))).flatMap((e) => Object.values(e.constraints ?? {}));

  it("admits the three answers, with or without a reclaim answer", async () => {
    expect(await errs({ basis: "prices_include_tax", reclaimsInputTax: true })).toEqual([]);
    expect(await errs({ basis: "prices_exclude_tax", reclaimsInputTax: false })).toEqual([]);
    expect(await errs({ basis: "not_vat_charging" })).toEqual([]);
  });

  it("refuses unset, an unknown basis, and a reclaim answer that is not a boolean", async () => {
    expect((await errs({ basis: "unset" })).join(" ")).toMatch(/is not an answer this product knows/);
    expect((await errs({ basis: "kdv" })).join(" ")).toMatch(/is not an answer this product knows/);
    expect((await errs({ basis: "prices_include_tax", reclaimsInputTax: "yes" })).join(" ")).toMatch(/a yes or a no/);
  });
});
