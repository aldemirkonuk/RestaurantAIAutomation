/**
 * Whether a house's till prices include tax, and its rates (F-620 / F-1537,
 * lane 2; founder 2026-10-12, S218: F1 build it, F2 only from now).
 *
 * The real HouseTaxBasisController, HouseTaxBasisService, OrganizationsService
 * (the role gate) and SettingsAuditService run over an in-memory PostgREST
 * double that honours its filters and records every write. The database's own
 * rules (the CHECKs, the version trigger, append-only) are proven in
 * supabase/tests/20270110000000_house_tax_basis_and_rates_test.sql; this file
 * proves the gateway sends only what those rules accept, and nothing at all
 * for a house that has not answered.
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { HouseTaxBasisController } from "./house-tax-basis.controller";
import {
  COCKTAIL_TAX_CATEGORY_AUDIT_ACTION,
  HouseTaxBasisService,
  TAX_BASIS_AUDIT_ACTION,
  TAX_ITEM_PICK_CAP,
  TAX_RATE_AUDIT_ACTION,
  notARateBecause,
  proposalFor,
  rateRowInForce,
  taxWordFor,
  withdrawalRows,
  type TaxRateRow,
} from "./house-tax-basis.service";
import { OrganizationsService } from "../organizations/organizations.service";
import {
  SettingsAuditService,
  SETTINGS_AUDIT_ACTIONS,
} from "../settings-audit/settings-audit.service";
import { REGISTERS } from "../settings-audit/settings-audit.controller";

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private limitN: number | null = null;
  private orderBy: { col: string; asc: boolean }[] = [];
  private one = false;
  private write: { kind: "insert" | "update"; row: Row } | null = null;
  private many: Row[] | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select() {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  is(col: string, v: null) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.orderBy.push({ col, asc: o?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  insert(row: Row | Row[]) {
    // An array is ONE statement: every row lands, or (on a failure) none.
    if (Array.isArray(row)) this.many = row;
    else this.write = { kind: "insert", row };
    return this;
  }
  update(row: Row) {
    this.write = { kind: "update", row };
    return this;
  }
  then(
    resolve: (v: { data: any; error: any }) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    return Promise.resolve(resolve(this.run())).catch(reject);
  }
  private run(): { data: any; error: any } {
    const fail = this.db.failures[this.table];
    if (fail) return { data: null, error: { code: "57014", message: fail } };
    if (this.many) {
      const rows = this.many;
      this.many = null;
      for (const row of rows) {
        this.write = { kind: "insert", row };
        this.run();
      }
      return { data: null, error: null };
    }
    if (this.write) {
      this.db.writes.push({ table: this.table, ...this.write });
      const t = (this.db.tables[this.table] ??= []);
      if (this.write.kind === "update") {
        for (const r of t)
          if (this.filters.every((f) => f(r))) Object.assign(r, this.write.row);
      } else if (this.table === "house_tax_rates") {
        // The database's BEFORE INSERT trigger: the house's next version.
        const mine = t.filter(
          (r) => r.restaurant_id === this.write!.row.restaurant_id,
        );
        const version = mine.reduce((m, r) => Math.max(m, r.version), 0) + 1;
        t.push({
          ...this.write.row,
          version,
          created_at: "2026-10-12T10:00:00Z",
        });
      } else t.push({ ...this.write.row });
      return { data: null, error: null };
    }
    let rows = (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
    if (this.orderBy.length) {
      // Each key in turn, NULLS LAST as PostgREST orders ascending.
      const cmp = (a: Row, b: Row): number => {
        for (const { col, asc } of this.orderBy) {
          const x = a[col] ?? null;
          const y = b[col] ?? null;
          if (x === y) continue;
          if (x === null) return 1;
          if (y === null) return -1;
          return (x < y ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      };
      rows = [...rows].sort(cmp);
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return this.one
      ? { data: rows[0] ?? null, error: null }
      : { data: rows, error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  failures: Record<string, string> = {};
  writes: { table: string; kind: string; row: Row }[] = [];
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const TR = "house-tr";
const US = "house-us";
const ITEM_TR = "0b7c2d1e-1111-4222-8333-444455556666";
const ITEM_US = "9f8e7d6c-1111-4222-8333-444455556666";

function make() {
  const db = new FakeDb();
  db.tables.restaurants = [
    {
      id: TR,
      country: "TR",
      timezone: "Europe/Istanbul",
      tax_basis: "unset",
      tax_basis_confirmed_by: null,
      tax_basis_confirmed_at: null,
    },
    {
      id: US,
      country: "US",
      timezone: "America/New_York",
      tax_basis: "unset",
      tax_basis_confirmed_by: null,
      tax_basis_confirmed_at: null,
    },
  ];
  db.tables.user_restaurant_access = [
    { user_id: "owner-tr", restaurant_id: TR, role: "owner", is_active: true },
    {
      user_id: "manager-tr",
      restaurant_id: TR,
      role: "manager",
      is_active: true,
    },
    { user_id: "staff-tr", restaurant_id: TR, role: "staff", is_active: true },
    { user_id: "owner-us", restaurant_id: US, role: "owner", is_active: true },
  ];
  db.tables.users = [{ user_id: "owner-tr", name: "Ayşe Kaya" }];
  db.tables.restaurant_inventory = [
    { id: ITEM_TR, restaurant_id: TR, wine_name: "Kavaklıdere Yakut" },
    { id: ITEM_US, restaurant_id: US, wine_name: "Napa Red" },
  ];
  db.tables.house_tax_rates = [];
  db.tables.system_audit_log = [];
  const dbs = { client: db, supabase: db, getClient: () => db } as never;
  const audit = new SettingsAuditService(dbs);
  const service = new HouseTaxBasisService(dbs, audit);
  const controller = new HouseTaxBasisController(
    service,
    new OrganizationsService(dbs),
  );
  return { db, controller, service };
}

const house = (db: FakeDb, id: string) =>
  db.tables.restaurants.find((r) => r.id === id)!;
const snapshot = (db: FakeDb) => JSON.stringify(db.tables);

describe("GET /settings/tax-basis — a house that has not answered is a strict no-op", () => {
  it("reads an unset US house as unset, proposes tax on top, and writes nothing anywhere", async () => {
    const { db, controller } = make();
    const before = snapshot(db);
    const out = await controller.read(US);
    expect(out).toMatchObject({
      readable: true,
      basis: "unset",
      answered: false,
      confirmedAt: null,
      confirmedBy: null,
      country: "US",
      taxWord: "sales tax",
      proposal: { basis: "prices_exclude_tax", rates: [] },
      rates: [],
    });
    expect(db.writes).toHaveLength(0);
    expect(snapshot(db)).toBe(before);
  });

  it("proposes KDV-inclusive prices at 10% and 20% for a house in Türkiye, and never writes the proposal", async () => {
    const { db, controller } = make();
    const out = await controller.read(TR);
    expect(out.taxWord).toBe("KDV");
    expect(out.proposal).toMatchObject({
      basis: "prices_include_tax",
      rates: [
        { label: "Food and soft drinks", ratePct: 10 },
        { label: "Alcohol", ratePct: 20 },
      ],
    });
    expect(out.basis).toBe("unset");
    expect(house(db, TR).tax_basis).toBe("unset");
    expect(db.writes).toHaveLength(0);
  });

  it("proposes nothing for a country it has no rule for, or none recorded", () => {
    expect(proposalFor("DE")).toBeNull();
    expect(proposalFor(null)).toBeNull();
    expect(taxWordFor(null)).toBe("tax");
  });

  it("says plainly when the house cannot be read, not that it is unset", async () => {
    const { db, controller } = make();
    db.failures.restaurants = "canceling statement due to statement timeout";
    const out = await controller.read(TR);
    expect(out).toMatchObject({
      readable: false,
      basis: null,
      answered: false,
    });
    expect(out.reason).toContain("statement timeout");
  });

  it("reads a value this build does not know as null, never as a basis", async () => {
    const { db, controller } = make();
    house(db, TR).tax_basis = "prices_maybe_include_tax";
    const out = await controller.read(TR);
    expect(out.basis).toBeNull();
    expect(out.answered).toBe(false);
  });
});

describe("PUT /settings/tax-basis — confirmed once, by an owner or a manager", () => {
  it("writes the answer, the person and the moment in one update on THIS house, audited", async () => {
    const { db, controller } = make();
    const out = await controller.confirm(TR, "owner-tr", {
      basis: "prices_include_tax",
    });
    expect(out).toMatchObject({
      basis: "prices_include_tax",
      answered: true,
      changed: true,
      audited: true,
      confirmedBy: { userId: "owner-tr", name: "Ayşe Kaya" },
    });
    expect(typeof out.confirmedAt).toBe("string");
    const updates = db.writes.filter((w) => w.table === "restaurants");
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0].row).sort()).toEqual([
      "tax_basis",
      "tax_basis_confirmed_at",
      "tax_basis_confirmed_by",
    ]);
    expect(house(db, US).tax_basis).toBe("unset");
    const row = db.tables.system_audit_log[0];
    expect(row).toMatchObject({
      action: TAX_BASIS_AUDIT_ACTION,
      restaurant_id: TR,
      actor_id: "owner-tr",
    });
    expect(row.changes.register).toBe("tax-basis");
    expect(row.changes.fields).toEqual({
      tax_basis: { from: "unset", to: "prices_include_tax" },
    });
    expect(SETTINGS_AUDIT_ACTIONS).toContain(TAX_BASIS_AUDIT_ACTION);
    expect(SETTINGS_AUDIT_ACTIONS).toContain(TAX_RATE_AUDIT_ACTION);
    expect(REGISTERS).toContain("tax-basis");
  });

  it("re-sending the recorded answer writes and files nothing, so the switch date does not move", async () => {
    const { db, controller } = make();
    const first = await controller.confirm(TR, "manager-tr", {
      basis: "prices_include_tax",
    });
    const writes = db.writes.length;
    const again = await controller.confirm(TR, "owner-tr", {
      basis: "prices_include_tax",
    });
    expect(again).toMatchObject({ changed: false, audited: false });
    expect(again.confirmedAt).toBe(first.confirmedAt);
    expect(db.writes).toHaveLength(writes);
    expect(db.tables.system_audit_log).toHaveLength(1);
  });

  it("a changed answer is a new confirmation with a new moment", async () => {
    const { db, controller } = make();
    await controller.confirm(TR, "owner-tr", { basis: "prices_include_tax" });
    house(db, TR).tax_basis_confirmed_at = "2026-10-01T00:00:00.000Z";
    const out = await controller.confirm(TR, "manager-tr", {
      basis: "not_vat_charging",
    });
    expect(out.basis).toBe("not_vat_charging");
    expect(out.confirmedAt).not.toBe("2026-10-01T00:00:00.000Z");
    expect(house(db, TR).tax_basis_confirmed_by).toBe("manager-tr");
  });

  it("refuses unset, an unknown answer and no answer with a sentence, writing nothing", async () => {
    const { db, controller } = make();
    for (const basis of ["unset", "prices_include_vat", undefined, 1]) {
      await expect(
        controller.confirm(TR, "owner-tr", { basis } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      controller.confirm(TR, "owner-tr", { basis: "unset" }),
    ).rejects.toThrow(/cannot be taken back/);
    expect(db.writes).toHaveLength(0);
  });

  it("refuses staff with 403 and writes nothing", async () => {
    const { db, controller } = make();
    await expect(
      controller.confirm(TR, "staff-tr", { basis: "prices_include_tax" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.writes).toHaveLength(0);
  });

  it("refuses to write over a basis it could not read", async () => {
    const { db, service } = make();
    db.failures.restaurants = "connection reset";
    await expect(
      service.confirm(TR, { basis: "prices_include_tax" }, "owner-tr"),
    ).rejects.toThrow(/could not be read, so nothing was changed/);
    expect(db.writes).toHaveLength(0);
  });
});

describe("POST /settings/tax-rates — appended, a percent here, a fraction in the table", () => {
  it("appends a till-category rate as a fraction, and reads it back in force today", async () => {
    const { db, controller } = make();
    const out = await controller.addRate(TR, "owner-tr", {
      keyKind: "pos_category",
      key: "  Alkol ",
      ratePct: 20,
      effectiveFrom: "2026-01-01",
    });
    const insert = db.writes.find((w) => w.table === "house_tax_rates")!;
    expect(insert.kind).toBe("insert");
    expect(insert.row).toEqual({
      restaurant_id: TR,
      key_kind: "pos_category",
      key: "Alkol",
      rate: 0.2,
      effective_from: "2026-01-01",
      effective_to: null,
      created_by: "owner-tr",
    });
    expect(insert.row).not.toHaveProperty("version");
    expect(out.rates).toEqual([
      expect.objectContaining({
        version: 1,
        keyKind: "pos_category",
        key: "Alkol",
        ratePct: 20,
        inForceToday: true,
      }),
    ]);
    expect(db.tables.system_audit_log[0]).toMatchObject({
      action: TAX_RATE_AUDIT_ACTION,
    });
  });

  it("keeps 8.25 percent exact and writes a whole-house rate with an empty key", async () => {
    const { db, service } = make();
    await service.addRate(
      US,
      {
        keyKind: "house",
        key: "ignored",
        ratePct: 8.25,
        effectiveFrom: "2026-10-12",
      },
      "owner-us",
    );
    expect(db.tables.house_tax_rates[0]).toMatchObject({
      key_kind: "house",
      key: "",
      rate: 0.0825,
    });
    const out = await service.read(US);
    expect(out.rates?.[0].ratePct).toBe(8.25);
  });

  it("names one of this house's own items, and answers 404 for another house's item, writing nothing", async () => {
    const { db, controller } = make();
    const ok = await controller.addRate(TR, "owner-tr", {
      keyKind: "house_item",
      key: ITEM_TR.toUpperCase(),
      ratePct: 20,
      effectiveFrom: "2026-10-12",
    });
    expect(ok.rates?.[0]).toMatchObject({
      key: ITEM_TR,
      itemName: "Kavaklıdere Yakut",
    });
    const before = db.writes.length;
    await expect(
      controller.addRate(TR, "owner-tr", {
        keyKind: "house_item",
        key: ITEM_US,
        ratePct: 20,
        effectiveFrom: "2026-10-12",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.writes).toHaveLength(before);
  });

  it("a withdrawal is a row with no rate, and the newest version wins on its span", async () => {
    const { controller } = make();
    await controller.addRate(TR, "owner-tr", {
      keyKind: "house",
      ratePct: 18,
      effectiveFrom: "2020-01-01",
      effectiveTo: "2023-07-10",
    });
    await controller.addRate(TR, "owner-tr", {
      keyKind: "house",
      ratePct: 20,
      effectiveFrom: "2023-07-10",
    });
    const out = await controller.addRate(TR, "owner-tr", {
      keyKind: "pos_category",
      key: "Yemek",
      ratePct: null,
      effectiveFrom: "2026-01-01",
    });
    const byVersion = new Map(out.rates!.map((r) => [r.version, r]));
    expect(byVersion.get(1)).toMatchObject({
      ratePct: 18,
      inForceToday: false,
    });
    expect(byVersion.get(2)).toMatchObject({ ratePct: 20, inForceToday: true });
    expect(byVersion.get(3)).toMatchObject({
      ratePct: null,
      inForceToday: true,
    });
  });

  it("refuses staff with 403 and writes nothing", async () => {
    const { db, controller } = make();
    await expect(
      controller.addRate(TR, "staff-tr", {
        keyKind: "house",
        ratePct: 10,
        effectiveFrom: "2026-10-12",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.writes).toHaveLength(0);
  });

  it.each([
    [
      { keyKind: "menu", ratePct: 10, effectiveFrom: "2026-10-12" },
      /what the rate covers/,
    ],
    [
      {
        keyKind: "pos_category",
        key: " ",
        ratePct: 10,
        effectiveFrom: "2026-10-12",
      },
      /Name the till category/,
    ],
    [
      {
        keyKind: "house_item",
        key: "not-an-id",
        ratePct: 10,
        effectiveFrom: "2026-10-12",
      },
      /by its id/,
    ],
    [
      { keyKind: "house", ratePct: 0.2, effectiveFrom: "2026-10-12" },
      /20 percent is 20, not 0.20/,
    ],
    [
      { keyKind: "house", ratePct: 100, effectiveFrom: "2026-10-12" },
      /outside it/,
    ],
    [
      { keyKind: "house", ratePct: -1, effectiveFrom: "2026-10-12" },
      /outside it/,
    ],
    [
      { keyKind: "house", ratePct: 8.255, effectiveFrom: "2026-10-12" },
      /two decimals/,
    ],
    [{ keyKind: "house", effectiveFrom: "2026-10-12" }, /as a percent/],
    [
      { keyKind: "house", ratePct: 10, effectiveFrom: "2026-02-30" },
      /first day/,
    ],
    [
      {
        keyKind: "house",
        ratePct: 10,
        effectiveFrom: "2026-10-12",
        effectiveTo: "2026-10-12",
      },
      /end after it starts/,
    ],
  ])("refuses %j with a sentence", async (body, why) => {
    expect(notARateBecause(body)).toMatch(why);
    const { db, controller } = make();
    await expect(
      controller.addRate(TR, "owner-tr", body as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.writes).toHaveLength(0);
  });

  it("allows 0 percent and a 1 percent rate (zero-rated and the low KDV band are real)", () => {
    expect(
      notARateBecause({
        keyKind: "house",
        ratePct: 0,
        effectiveFrom: "2026-10-12",
      }),
    ).toBeNull();
    expect(
      notARateBecause({
        keyKind: "house",
        ratePct: 1,
        effectiveFrom: "2026-10-12",
      }),
    ).toBeNull();
  });
});

describe("rateRowInForce — the rule lane 3's ingest reads", () => {
  const rows = [
    {
      keyKind: "house",
      key: "",
      version: 1,
      effectiveFrom: "2020-01-01",
      effectiveTo: "2023-07-10",
      r: 0.18,
    },
    {
      keyKind: "house",
      key: "",
      version: 2,
      effectiveFrom: "2023-07-10",
      effectiveTo: null,
      r: 0.2,
    },
    {
      keyKind: "house",
      key: "",
      version: 3,
      effectiveFrom: "2023-07-10",
      effectiveTo: null,
      r: 0.19,
    },
    {
      keyKind: "pos_category",
      key: "Alkol",
      version: 4,
      effectiveFrom: "2024-01-01",
      effectiveTo: null,
      r: 0.2,
    },
  ];
  it("takes the rate on the check's own date, with the end date exclusive", () => {
    expect(rateRowInForce(rows, "house", "", "2023-07-09")?.r).toBe(0.18);
    expect(rateRowInForce(rows, "house", "", "2023-07-10")?.r).toBe(0.19);
  });
  it("lets a later version over the same span win (a correction is a later row)", () => {
    expect(rateRowInForce(rows, "house", "", "2026-10-12")?.version).toBe(3);
  });
  it("answers null before any rate, and for a key with no row", () => {
    expect(rateRowInForce(rows, "house", "", "2019-12-31")).toBeNull();
    expect(
      rateRowInForce(rows, "pos_category", "Yemek", "2026-10-12"),
    ).toBeNull();
  });
});

/**
 * Wave 52 (F-1585, F-1586): the switch is dated on the house's day, a rate
 * dated ahead stays on the page, and a rate can be withdrawn on a table that
 * refuses every edit.
 */
describe("GET /settings/tax-basis — the switch day is the house's own (F-1585)", () => {
  it("an Istanbul answer at 01:30 on 13 Oct switches on the 13th, not on the UTC 12th", async () => {
    const { db, service } = make();
    Object.assign(house(db, TR), {
      tax_basis: "prices_include_tax",
      tax_basis_confirmed_by: "owner-tr",
      tax_basis_confirmed_at: "2026-10-12T22:30:00Z",
    });
    const out = await service.read(TR, new Date("2026-10-13T08:00:00Z"));
    expect(out.confirmedAt).toBe("2026-10-12T22:30:00Z");
    expect(out.switchDay).toBe("2026-10-13");
  });

  it("an unset house has no switch day", async () => {
    const { service } = make();
    expect((await service.read(TR)).switchDay).toBeNull();
  });
});

describe("POST /settings/tax-rates/withdraw — appended, never edited (F-1586)", () => {
  const NOW = new Date("2026-10-12T09:00:00Z"); // 12 Oct in Istanbul
  const rowsAt = (out: { rates: TaxRateRow[] | null }) =>
    new Map(out.rates!.map((r) => [r.version, r]));

  async function withFuture() {
    const m = make();
    await m.service.addRate(
      TR,
      { keyKind: "house", ratePct: 18, effectiveFrom: "2020-01-01" },
      "owner-tr",
    );
    await m.service.addRate(
      TR,
      { keyKind: "house", ratePct: 20, effectiveFrom: "2027-01-01" },
      "owner-tr",
    );
    return m;
  }

  it("a rate dated ahead is read as upcoming, not lost", async () => {
    const { service } = await withFuture();
    const r = rowsAt(await service.read(TR, NOW));
    expect(r.get(1)).toMatchObject({ inForceToday: true, upcoming: false });
    expect(r.get(2)).toMatchObject({ inForceToday: false, upcoming: true });
  });

  it("withdrawing a rate not yet in force restates what applied before it, from its first day", async () => {
    const { db, service } = await withFuture();
    const out = await service.withdrawRate(TR, 2, "owner-tr", NOW);
    expect(db.tables.house_tax_rates.slice(2)).toEqual([
      expect.objectContaining({
        key_kind: "house",
        key: "",
        rate: 0.18,
        effective_from: "2027-01-01",
        effective_to: null,
        version: 3,
      }),
    ]);
    // No row was edited: the withdrawn one is still there, as it was.
    expect(db.writes.every((w) => w.kind === "insert")).toBe(true);
    expect(db.tables.house_tax_rates[1]).toMatchObject({ rate: 0.2 });
    const rows = out.rates!;
    expect(rateRowInForce(rows, "house", "", "2027-03-01")?.ratePct).toBe(18);
    expect(rowsAt(out).get(2)).toMatchObject({ upcoming: false });
    expect(db.tables.system_audit_log.at(-1)).toMatchObject({
      action: TAX_RATE_AUDIT_ACTION,
    });
  });

  it("withdrawing a rate in force stops it from the house's next day, so today keeps one rate", async () => {
    const { service } = make();
    await service.addRate(
      TR,
      {
        keyKind: "pos_category",
        key: "Alkol",
        ratePct: 2,
        effectiveFrom: "2026-10-01",
      },
      "owner-tr",
    );
    const out = await service.withdrawRate(TR, 1, "owner-tr", NOW);
    const rows = out.rates!;
    expect(
      rateRowInForce(rows, "pos_category", "Alkol", "2026-10-12")?.ratePct,
    ).toBe(2);
    const after = rateRowInForce(rows, "pos_category", "Alkol", "2026-10-13");
    expect(after).toMatchObject({ ratePct: null, version: 2 });
  });

  it("answers 404 for a number this house does not have, and refuses staff, writing nothing", async () => {
    const { db, controller } = await withFuture();
    const before = db.writes.length;
    await expect(
      controller.withdrawRate(US, "owner-us", { version: 2 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.withdrawRate(TR, "staff-tr", { version: 2 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.withdrawRate(TR, "owner-tr", {
        version: "two" as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.writes).toHaveLength(before);
  });

  it("withdrawalRows restores each piece of the key's history, ending where the next row starts", () => {
    const row = (
      version: number,
      ratePct: number | null,
      effectiveFrom: string,
      effectiveTo: string | null = null,
    ): TaxRateRow => ({
      version,
      keyKind: "house",
      key: "",
      itemName: null,
      ratePct,
      effectiveFrom,
      effectiveTo,
      inForceToday: false,
      upcoming: false,
      createdAt: null,
    });
    // 10% until March, then a 12% added earlier from June; a 20% (v3) from
    // February masks both. Withdrawn, the house has 10% to March, nothing
    // until June, then 12%.
    const rows = [
      row(1, 10, "2027-01-01", "2027-03-01"),
      row(2, 12, "2027-06-01"),
      row(3, 20, "2027-02-01"),
    ];
    expect(withdrawalRows(rows, rows[2], "2027-02-01")).toEqual([
      { ratePct: 10, effectiveFrom: "2027-02-01", effectiveTo: "2027-03-01" },
      { ratePct: null, effectiveFrom: "2027-03-01", effectiveTo: "2027-06-01" },
      { ratePct: 12, effectiveFrom: "2027-06-01", effectiveTo: null },
    ]);
  });
});

describe("PUT /settings/tax-basis/cocktail-category — the owner says which rate prices cocktails (F-1615)", () => {
  async function withCategories() {
    const m = make();
    for (const [key, ratePct] of [
      ["Yiyecek", 10],
      ["Alkol", 20],
    ] as const)
      await m.service.addRate(
        TR,
        { keyKind: "pos_category", key, ratePct, effectiveFrom: "2026-10-01" },
        "owner-tr",
      );
    return m;
  }

  it("nobody has chosen on any house until someone does", async () => {
    const { service } = await withCategories();
    const out = await service.read(TR);
    expect(out.cocktailCategory).toBeNull();
    expect(out.cocktailCategoryReason).toBeNull();
  });

  it("records one of the house's own till categories, audited, and reads it back", async () => {
    const { db, controller } = await withCategories();
    const out = await controller.setCocktailCategory(TR, "manager-tr", {
      category: " Alkol ",
    });
    expect(out.cocktailCategory).toBe("Alkol");
    expect(out.changed).toBe(true);
    expect(house(db, TR).cocktail_tax_category).toBe("Alkol");
    expect(db.tables.system_audit_log.at(-1)).toMatchObject({
      action: COCKTAIL_TAX_CATEGORY_AUDIT_ACTION,
    });
    expect(SETTINGS_AUDIT_ACTIONS).toContain(
      COCKTAIL_TAX_CATEGORY_AUDIT_ACTION,
    );
  });

  it("refuses a category the house has no rate for: nothing is guessed from a name", async () => {
    const { db, controller } = await withCategories();
    const before = db.writes.length;
    await expect(
      controller.setCocktailCategory(TR, "owner-tr", { category: "Kokteyl" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.setCocktailCategory(TR, "owner-tr", {} as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.writes.length).toBe(before);
  });

  it("the same choice writes nothing; null takes it back", async () => {
    const { db, controller } = await withCategories();
    await controller.setCocktailCategory(TR, "owner-tr", { category: "Alkol" });
    const before = db.writes.length;
    const same = await controller.setCocktailCategory(TR, "owner-tr", {
      category: "Alkol",
    });
    expect(same.changed).toBe(false);
    expect(db.writes.length).toBe(before);
    const back = await controller.setCocktailCategory(TR, "owner-tr", {
      category: null,
    });
    expect(back.cocktailCategory).toBeNull();
    expect(house(db, TR).cocktail_tax_category).toBeNull();
  });

  it("refuses staff, writing nothing", async () => {
    const { db, controller } = await withCategories();
    const before = db.writes.length;
    await expect(
      controller.setCocktailCategory(TR, "staff-tr", { category: "Alkol" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.writes.length).toBe(before);
  });
});

describe("GET /settings/tax-basis — every answer, and the house's items (F-1624, S222)", () => {
  const answered = (db: FakeDb) => {
    Object.assign(house(db, TR), {
      tax_basis: "prices_include_tax",
      tax_basis_confirmed_by: "owner-tr",
      tax_basis_confirmed_at: "2026-10-20T09:00:00Z",
    });
    // What the database trigger keeps, one row per change.
    db.tables.house_tax_basis_answers = [
      ["prices_include_tax", "2026-10-03T09:00:00Z"],
      ["prices_exclude_tax", "2026-10-10T09:00:00Z"],
      ["prices_include_tax", "2026-10-20T09:00:00Z"],
    ].map(([basis, at]) => ({
      restaurant_id: TR,
      basis,
      answered_at: at,
      answered_by: "owner-tr",
    }));
  };

  it("reads include, then tax on top, then include again as three stretches", async () => {
    const { db, controller } = make();
    answered(db);
    const out = await controller.read(TR);
    expect(out.answers).toEqual([
      {
        basis: "prices_include_tax",
        answeredAt: "2026-10-03T09:00:00Z",
        fromDay: "2026-10-03",
      },
      {
        basis: "prices_exclude_tax",
        answeredAt: "2026-10-10T09:00:00Z",
        fromDay: "2026-10-10",
      },
      {
        basis: "prices_include_tax",
        answeredAt: "2026-10-20T09:00:00Z",
        fromDay: "2026-10-20",
      },
    ]);
    expect(out.switchDay).toBe("2026-10-20");
    expect(db.writes).toHaveLength(0);
  });

  it("keeps the answer on the house row when no history holds it, and says a failed read", async () => {
    const { db, controller } = make();
    answered(db);
    db.tables.house_tax_basis_answers = [];
    expect((await controller.read(TR)).answers).toEqual([
      {
        basis: "prices_include_tax",
        answeredAt: "2026-10-20T09:00:00Z",
        fromDay: "2026-10-20",
      },
    ]);
    db.failures.house_tax_basis_answers = "permission denied";
    const failed = await controller.read(TR);
    expect(failed.answers).toBeNull();
    expect(failed.answersReason).toMatch(/permission denied/);
  });

  it("lists the house's own items for a rate, by name, only for a house whose prices include tax", async () => {
    const { db, controller } = make();
    db.tables.restaurant_inventory.push(
      {
        id: "item-gone",
        restaurant_id: TR,
        wine_name: "Removed",
        deleted_at: "2026-10-01T00:00:00Z",
      },
      {
        id: "item-raki",
        restaurant_id: TR,
        display_name: "Altınbaş Rakı",
        wine_name: null,
      },
    );
    expect((await controller.read(TR)).items).toBeNull();
    answered(db);
    expect((await controller.read(TR)).items).toEqual([
      { id: "item-raki", name: "Altınbaş Rakı" },
      { id: ITEM_TR, name: "Kavaklıdere Yakut" },
    ]);
    expect((await controller.read(US)).items).toBeNull();
  });

  it("F-1665: past the cap, removed items never take a live one's place, the cut is by name, and the readout says it is cut", async () => {
    const { db, controller } = make();
    answered(db);
    const pad = (n: number) => String(n).padStart(4, "0");
    // Removed items first in table order: a cap before the deleted_at filter
    // read only these and listed nothing.
    for (let n = 0; n < TAX_ITEM_PICK_CAP; n++)
      db.tables.restaurant_inventory.unshift({
        id: `gone-${pad(n)}`,
        restaurant_id: TR,
        wine_name: `Removed ${pad(n)}`,
        deleted_at: "2026-10-01T00:00:00Z",
      });
    for (let n = TAX_ITEM_PICK_CAP; n > 0; n--)
      db.tables.restaurant_inventory.push({
        id: `live-${pad(n)}`,
        restaurant_id: TR,
        display_name: `Item ${pad(n)}`,
        wine_name: null,
      });
    const r = await controller.read(TR);
    expect(r.items).toHaveLength(TAX_ITEM_PICK_CAP);
    expect(r.items!.some((i) => i.id.startsWith("gone-"))).toBe(false);
    // Item 0001..0500 by name; Kavaklıdere Yakut (no display name) is past the cut.
    expect(r.items![0]).toEqual({ id: "live-0001", name: "Item 0001" });
    expect(r.items!.some((i) => i.id === ITEM_TR)).toBe(false);
    expect(r.itemsCapped).toBe(true);
  });

  it("F-1665: at or under the cap, nothing is said to be cut", async () => {
    const { db, controller } = make();
    answered(db);
    const r = await controller.read(TR);
    expect(r.items).toEqual([{ id: ITEM_TR, name: "Kavaklıdere Yakut" }]);
    expect(r.itemsCapped).toBe(false);
  });
});
