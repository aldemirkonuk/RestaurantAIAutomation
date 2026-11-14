/**
 * A house states whether its prices hold tax and whether it reclaims the tax
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

/** `restaurants` answers in order (before, then after); every write recorded. */
function svc(rows: Result[], o: { updateError?: { message: string }; receipt?: { recorded: boolean; reason: string | null } } = {}) {
  const updates: Array<{ row: Record<string, unknown>; id: unknown }> = [];
  const selects: string[] = [];
  const filed: any[] = [];
  let r = 0;
  const client = {
    from(table: string) {
      let pending: Record<string, unknown> | null = null;
      const c: Record<string, (...a: any[]) => any> = {};
      c.select = (cols: string) => (table === "restaurants" && selects.push(cols), c);
      c.update = (row: Record<string, unknown>) => ((pending = row), c);
      c.eq = (_k: string, id: unknown) =>
        pending ? (updates.push({ row: pending, id }), Promise.resolve({ data: null, error: o.updateError ?? null })) : c;
      c.maybeSingle = async () =>
        table === "users" ? { data: { name: "SYNTHETIC owner" }, error: null } : rows[Math.min(r++, rows.length - 1)];
      return c;
    },
  };
  const audit = { record: async (x: any) => (filed.push(x), o.receipt ?? { recorded: true, reason: null }) };
  return { s: new HouseTaxBasisService({ client } as any, audit as any), updates, selects, filed };
}

const UNSET: Result = {
  data: { tax_basis: "unset", reclaims_input_tax: null, tax_basis_since: null, tax_basis_set_at: null, tax_basis_set_by: null },
  error: null,
};
const said = (basis: string, reclaims: boolean | null): Result => ({
  data: { tax_basis: basis, reclaims_input_tax: reclaims, tax_basis_since: "2027-01-05T09:00:00Z", tax_basis_set_at: "2027-02-01T09:00:00Z", tax_basis_set_by: USER },
  error: null,
});

describe("HouseTaxBasisService.read", () => {
  it("an unanswered house reads unset, readable, with no author", async () => {
    const t = svc([UNSET]);
    expect(await t.s.read(REST)).toMatchObject({ basis: "unset", reclaimsInputTax: null, since: null, statedBy: null, readable: true });
    expect(t.selects).toEqual(["tax_basis, reclaims_input_tax, tax_basis_since, tax_basis_set_at, tax_basis_set_by"]);
  });

  it("an answered house reads its answers, the switch date and who gave them", async () => {
    expect(await svc([said("prices_include_tax", true)]).s.read(REST)).toMatchObject({
      basis: "prices_include_tax",
      reclaimsInputTax: true,
      since: "2027-01-05T09:00:00Z",
      statedAt: "2027-02-01T09:00:00Z",
      statedBy: { userId: USER, name: "SYNTHETIC owner" },
    });
  });

  it("a house that charges no VAT reads as reclaiming nothing", async () => {
    expect((await svc([said("not_vat_charging", null)]).s.read(REST)).reclaimsInputTax).toBe(false);
  });

  it("a failed read is unreadable, in the house's words", async () => {
    const out = await svc([{ data: null, error: { message: "permission denied for relation" } }]).s.read(REST);
    expect(out).toMatchObject({ readable: false, reason: "the house's tax answer could not be read just now" });
  });
});

describe("HouseTaxBasisService.write", () => {
  it("records both answers with their author, never the switch date, and files the change", async () => {
    const t = svc([UNSET, said("prices_include_tax", true)]);
    const out = await t.s.write(REST, "prices_include_tax", true, USER);
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0].id).toBe(REST);
    expect(t.updates[0].row).toMatchObject({ tax_basis: "prices_include_tax", reclaims_input_tax: true, tax_basis_set_by: USER });
    expect(typeof t.updates[0].row.tax_basis_set_at).toBe("string");
    expect(t.updates[0].row).not.toHaveProperty("tax_basis_since");
    expect(t.filed).toEqual([
      expect.objectContaining({
        action: "house_tax_basis_changed",
        register: "tax-basis",
        actorUserId: USER,
        fields: { tax_basis: { from: "unset", to: "prices_include_tax" }, reclaims_input_tax: { from: null, to: true } },
      }),
    ]);
    expect(out).toMatchObject({ basis: "prices_include_tax", audited: true });
  });

  it("a no-VAT house that leaves the answer out is stored as reclaiming nothing", async () => {
    const t = svc([UNSET, said("not_vat_charging", false)]);
    await t.s.write(REST, "not_vat_charging", undefined, USER);
    expect(t.updates[0].row).toMatchObject({ tax_basis: "not_vat_charging", reclaims_input_tax: false });
  });

  it.each([
    ["a no-VAT house that says it reclaims", "not_vat_charging", true, /charges no VAT has no VAT to reclaim/],
    ["a no-VAT reclaim answer that is not a yes or a no", "not_vat_charging", "no", /a yes or a no/],
    ["a VAT house with no reclaim answer", "prices_exclude_tax", undefined, /reclaims the tax it pays/],
    ["a VAT house with a null reclaim answer", "prices_exclude_tax", null, /reclaims the tax it pays/],
    ["a VAT house with a reclaim answer that is not a boolean", "prices_include_tax", "yes", /reclaims the tax it pays/],
    ["unset", "unset", true, /is not an answer this product knows/],
    ["an unknown basis", "kdv_inside", true, /is not an answer this product knows/],
    ["no basis", null, true, /is not an answer this product knows/],
  ])("refuses %s, and writes nothing", async (_n, basis, reclaims, msg) => {
    const t = svc([UNSET]);
    await expect(t.s.write(REST, basis, reclaims, USER)).rejects.toThrow(BadRequestException);
    await expect(t.s.write(REST, basis, reclaims, USER)).rejects.toThrow(msg);
    expect(t.updates).toEqual([]);
  });

  it("writes nothing when the house's current answer cannot be read", async () => {
    const t = svc([{ data: null, error: { message: "timeout" } }]);
    await expect(t.s.write(REST, "prices_include_tax", true, USER)).rejects.toThrow(InternalServerErrorException);
    expect(t.updates).toEqual([]);
  });

  it("the same answers again write nothing and file nothing, so the author stays", async () => {
    const t = svc([said("prices_include_tax", true)]);
    const out = await t.s.write(REST, "prices_include_tax", true, USER);
    expect([t.updates, t.filed]).toEqual([[], []]);
    expect(out).toMatchObject({ audited: false, auditReason: "nothing changed", statedAt: "2027-02-01T09:00:00Z" });
  });

  it("a changed reclaim answer alone is a change, filed with both fields", async () => {
    const t = svc([said("prices_include_tax", true), said("prices_include_tax", false)]);
    await t.s.write(REST, "prices_include_tax", false, USER);
    expect(t.updates).toHaveLength(1);
    expect(t.filed[0].fields).toEqual({
      tax_basis: { from: "prices_include_tax", to: "prices_include_tax" },
      reclaims_input_tax: { from: true, to: false },
    });
  });

  it("a failed write says nothing changed and files nothing", async () => {
    const t = svc([UNSET], { updateError: { message: "check violation" } });
    await expect(t.s.write(REST, "prices_include_tax", true, USER)).rejects.toThrow("Could not record the tax answer. Nothing was changed.");
    expect(t.filed).toEqual([]);
  });

  it("a trail row that failed is visible on the readout", async () => {
    const t = svc([UNSET, said("prices_exclude_tax", false)], { receipt: { recorded: false, reason: "trail down" } });
    expect(await t.s.write(REST, "prices_exclude_tax", false, USER)).toMatchObject({ audited: false, auditReason: "trail down" });
  });

  it("the action is one the trail reads back", () => {
    expect(SETTINGS_AUDIT_ACTIONS).toContain(TAX_BASIS_AUDIT_ACTION);
  });
});

describe("HouseTaxBasisController", () => {
  const make = (deny = false) => {
    const order: string[] = [];
    const s = { write: jest.fn(async () => (order.push("write"), {} as any)), read: jest.fn() };
    const orgs = {
      assertCanManageRestaurant: jest.fn(async () => {
        order.push("role");
        if (deny) throw new ForbiddenException("no");
      }),
    };
    return { c: new HouseTaxBasisController(s as any, orgs as any), s, orgs, order };
  };

  it("checks the caller may manage the house before anything is written", async () => {
    const t = make();
    await t.c.write(REST, { basis: "prices_include_tax", reclaimsInputTax: true }, USER);
    expect(t.orgs.assertCanManageRestaurant).toHaveBeenCalledWith(USER, REST, expect.any(String));
    expect(t.s.write).toHaveBeenCalledWith(REST, "prices_include_tax", true, USER);
    expect(t.order).toEqual(["role", "write"]);
  });

  it("a caller who may not manage the house writes nothing", async () => {
    const t = make(true);
    await expect(t.c.write(REST, { basis: "prices_include_tax", reclaimsInputTax: true }, USER)).rejects.toThrow(ForbiddenException);
    expect(t.s.write).not.toHaveBeenCalled();
  });

  it("a session with no house reads and writes nothing", async () => {
    const t = make();
    await expect(t.c.read("")).rejects.toThrow(/not attached to a restaurant/);
    await expect(t.c.write("", { basis: "prices_include_tax" }, USER)).rejects.toThrow(/not attached to a restaurant/);
    expect([t.s.read.mock.calls, t.s.write.mock.calls]).toEqual([[], []]);
  });
});

describe("SetHouseTaxBasisDto", () => {
  const errs = async (body: object) =>
    (await validate(plainToInstance(SetHouseTaxBasisDto, body))).flatMap((e) => Object.values(e.constraints ?? {})).join(" ");

  it("admits the three answers, with or without a reclaim answer", async () => {
    expect(await errs({ basis: "prices_include_tax", reclaimsInputTax: true })).toBe("");
    expect(await errs({ basis: "not_vat_charging" })).toBe("");
  });

  it("refuses unset, an unknown basis, and a reclaim answer that is not a boolean", async () => {
    expect(await errs({ basis: "unset" })).toMatch(/is not an answer this product knows/);
    expect(await errs({ basis: "kdv" })).toMatch(/is not an answer this product knows/);
    expect(await errs({ basis: "prices_include_tax", reclaimsInputTax: "yes" })).toMatch(/a yes or a no/);
  });
});
