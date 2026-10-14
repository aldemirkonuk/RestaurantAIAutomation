import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * F-1537 lane 3: ingest writes a pre-tax subtotal for a house whose till
 * prices include tax, and the row says how. A house that has not said is a
 * strict no-op (founder 2026-10-12, S218: F1 build it, F2 only from now).
 */

type Row = Record<string, any>;

function makeDb(opts: {
  house?: Row | null;
  houseError?: { message: string };
  rates?: Row[];
  /** F-1624: the copy of the check already stored. */
  stored?: Row | null;
  storedError?: { message: string };
}) {
  const calls = {
    checkUpserts: [] as Row[],
    houseSelects: [] as string[],
    rateReads: 0,
    storedReads: 0,
  };
  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        update: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        eq: () => q,
        in: async () => ({ data: [], error: null }),
        like: async () => ({ data: [], error: null }),
        insert: async () => ({ error: null }),
        upsert: async () => ({ error: null }),
      };
      if (table === "restaurants") {
        q.select = (cols: string) => (calls.houseSelects.push(cols), q);
        q.maybeSingle = async () =>
          opts.houseError
            ? { data: null, error: opts.houseError }
            : { data: opts.house ?? null, error: null };
      }
      if (table === "house_tax_rates") {
        calls.rateReads++;
        const rows = opts.rates ?? [];
        const b: any = {
          select: () => b,
          eq: () => b,
          order: () => b,
          gt: () => b,
          limit: () => b,
          then: (ok: any, bad: any) =>
            Promise.resolve({
              data: rows,
              error: null,
              count: rows.length,
            }).then(ok, bad),
        };
        return b;
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      if (table === "pos_checks") {
        q.upsert = async (row: Row) => {
          calls.checkUpserts.push(row);
          return { error: null };
        };
        let cols = "";
        q.select = (c: string) => ((cols = c), q);
        q.maybeSingle = async () => {
          // Only the stored-copy read names the stamp; others answer null.
          if (!cols.includes("gross_subtotal"))
            return { data: null, error: null };
          calls.storedReads++;
          return opts.storedError
            ? { data: null, error: opts.storedError }
            : { data: opts.stored ?? null, error: null };
        };
      }
      return q;
    },
    rpc: async () => ({ data: "tx-1", error: null }),
  };
  const service = new PosHubService({
    getClient: () => client,
  } as unknown as DatabaseService);
  return { service, calls };
}

/** An open check (no stock moves), two lines at two Turkish rates. */
const PAYLOAD = [
  {
    externalCheckId: "chk-1",
    openedAt: "2026-10-12T17:00:00Z",
    subtotal: 330,
    total: 330,
    items: [
      { name: "Meze", category: "Food", qty: 1, price: 110 },
      { name: "Rakı", category: "Alcohol", qty: 1, price: 240 },
    ],
  },
];

const TR_HOUSE = {
  tax_basis: "prices_include_tax",
  tax_basis_confirmed_at: "2026-10-12T06:00:00Z",
  timezone: "Europe/Istanbul",
  country: "TR",
};

const TR_RATES = [
  {
    id: "r1",
    version: 1,
    key_kind: "pos_category",
    key: "Food",
    rate: 0.1,
    effective_from: "2026-01-01",
    effective_to: null,
  },
  {
    id: "r2",
    version: 2,
    key_kind: "pos_category",
    key: "Alcohol",
    rate: "0.2000",
    effective_from: "2026-01-01",
    effective_to: null,
  },
];

/** Every key the row carried before this lane, for this payload. */
const ROW_KEYS_AS_BEFORE = [
  "closed_at",
  "covers",
  "external_check_id",
  "items",
  "opened_at",
  "raw",
  "restaurant_id",
  "server_external_id",
  "server_name",
  "source",
  "subtotal",
  "table_id",
  "tip",
  "total",
  "voided",
];

describe("a house that has not said: the row is written exactly as before", () => {
  it.each([
    [
      "unset",
      { tax_basis: "unset", timezone: "America/New_York", country: "US" },
    ],
    ["no house row", null],
  ])("%s: no new key, the till's subtotal, no rate read", async (_l, house) => {
    const { service, calls } = makeDb({
      house: house as Row | null,
      rates: TR_RATES,
    });
    const res = await service.ingest("r1", "generic_webhook", PAYLOAD);
    expect(res.upserted).toBe(1);
    const [row] = calls.checkUpserts;
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS_AS_BEFORE);
    expect(row.subtotal).toBe(330);
    expect(row.total).toBe(330);
    expect(calls.rateReads).toBe(0);
    expect(res.errors).toEqual([]);
  });
});

describe("a US house that says prices exclude tax", () => {
  it("keeps every figure and only records the basis", async () => {
    const { service, calls } = makeDb({
      house: {
        tax_basis: "prices_exclude_tax",
        tax_basis_confirmed_at: "2026-10-12T06:00:00Z",
        timezone: "America/New_York",
        country: "US",
      },
    });
    await service.ingest("r1", "generic_webhook", PAYLOAD);
    const [row] = calls.checkUpserts;
    expect(row).toMatchObject({
      subtotal: 330,
      total: 330,
      gross_subtotal: 330,
      tax_basis: "prices_exclude_tax",
      tax_rate_version: null,
    });
    expect(calls.rateReads).toBe(0);
  });
});

describe("a Turkish house whose till prices include KDV", () => {
  it("writes the pre-tax subtotal, the till's figure and the rate version", async () => {
    const { service, calls } = makeDb({ house: TR_HOUSE, rates: TR_RATES });
    const res = await service.ingest("r1", "generic_webhook", PAYLOAD);
    expect(res.upserted).toBe(1);
    const [row] = calls.checkUpserts;
    // 330 * (110/1.1 + 240/1.2) / 350 = 330 * 300 / 350
    expect(row).toMatchObject({
      subtotal: 282.86,
      gross_subtotal: 330,
      total: 330,
      tax_basis: "prices_include_tax",
      tax_rate_version: 2,
      net_not_recorded_reason: null,
    });
    expect(calls.houseSelects).toContain(
      "tax_basis, tax_basis_confirmed_at, timezone, country",
    );
  });

  it("a check it cannot resolve is written with no net, and the import says why", async () => {
    const { service, calls } = makeDb({
      house: TR_HOUSE,
      rates: [TR_RATES[1]],
    });
    const res = await service.ingest("r1", "generic_webhook", PAYLOAD);
    const [row] = calls.checkUpserts;
    expect(row.subtotal).toBeNull();
    expect(row.gross_subtotal).toBe(330);
    // F-1612: the reason is kept on the check, as a code the pages count.
    expect(row.net_not_recorded_reason).toBe("mixed_rates");
    expect(res.errors).toEqual([
      expect.stringMatching(
        /^1 check was stored with net sales not recorded: /,
      ),
    ]);
  });

  it("an unreadable rate table stores nothing", async () => {
    const { service, calls } = makeDb({
      house: TR_HOUSE,
      rates: [{ ...TR_RATES[0], rate: "abc" }],
    });
    const res = await service.ingest("r1", "generic_webhook", PAYLOAD);
    expect(calls.checkUpserts).toHaveLength(0);
    expect(res.errors[0]).toMatch(
      /^chk-1: not imported, a tax rate of the house could not be read/,
    );
  });
});

describe("a basis nobody read is not written on", () => {
  it("a failed read of the house stores nothing and says so", async () => {
    const { service, calls } = makeDb({ houseError: { message: "boom" } });
    const res = await service.ingest("r1", "generic_webhook", PAYLOAD);
    expect(res.upserted).toBe(0);
    expect(calls.checkUpserts).toHaveLength(0);
    expect(res.errors[0]).toBe(
      "chk-1: not imported, the house's tax basis could not be read: boom",
    );
  });

  it("a basis this build does not know stores nothing", async () => {
    const { service, calls } = makeDb({ house: { tax_basis: "inclusive" } });
    const res = await service.ingest("r1", "generic_webhook", PAYLOAD);
    expect(calls.checkUpserts).toHaveLength(0);
    expect(res.errors[0]).toMatch(/tax basis reads as "inclusive"/);
  });
});

/**
 * F-1584: a `tax` or line `tax_rate` the gateway cannot read used to refuse
 * the check for every house, before its basis was read. Only an inclusive
 * house reads either; every other house stores the check exactly as before.
 */
describe("a tax figure the gateway cannot read", () => {
  const UNREAD = [
    {
      ...PAYLOAD[0],
      tax: "1.250",
      items: [
        { name: "Meze", category: "Food", qty: 1, price: 110, tax_rate: 0.06 },
        { name: "Rakı", category: "Alcohol", qty: 1, price: 240 },
      ],
    },
  ];

  it.each([
    [
      "unset",
      { tax_basis: "unset", timezone: "America/New_York", country: "US" },
    ],
    ["no house row", null],
  ])(
    "%s: the check is stored exactly as before, with no error",
    async (_l, house) => {
      const { service, calls } = makeDb({
        house: house as Row | null,
        rates: TR_RATES,
      });
      const res = await service.ingest("r1", "generic_webhook", UNREAD);
      expect(res.upserted).toBe(1);
      const [row] = calls.checkUpserts;
      expect(Object.keys(row).sort()).toEqual(ROW_KEYS_AS_BEFORE);
      expect(row.subtotal).toBe(330);
      expect(res.errors).toEqual([]);
    },
  );

  it("a US house that says prices exclude tax keeps the till's subtotal", async () => {
    const { service, calls } = makeDb({
      house: {
        tax_basis: "prices_exclude_tax",
        tax_basis_confirmed_at: "2026-10-12T06:00:00Z",
        timezone: "America/New_York",
        country: "US",
      },
    });
    const res = await service.ingest("r1", "generic_webhook", UNREAD);
    expect(res.upserted).toBe(1);
    expect(calls.checkUpserts[0]).toMatchObject({
      subtotal: 330,
      gross_subtotal: 330,
      tax_basis: "prices_exclude_tax",
    });
    expect(res.errors).toEqual([]);
  });

  it("an inclusive house stores the check with net not recorded, and says why", async () => {
    const { service, calls } = makeDb({ house: TR_HOUSE, rates: TR_RATES });
    const res = await service.ingest("r1", "generic_webhook", UNREAD);
    expect(res.upserted).toBe(1);
    expect(calls.checkUpserts[0]).toMatchObject({
      subtotal: null,
      gross_subtotal: 330,
      total: 330,
      tax_basis: "prices_include_tax",
    });
    expect(res.errors).toEqual([
      "1 check was stored with net sales not recorded: the till's tax, or a line's tax rate, could not be read — write tax as 12.50 and a rate as 20 for 20 percent",
    ]);
  });
});

/**
 * F-1624: the owner answers include, then exclude (or include again later).
 * The till re-sending a check written under the earlier answer re-stamped
 * it under the new one, though Settings says "Checks already recorded are
 * not changed".
 */
describe("a check already stored under an earlier answer", () => {
  const NOW_EXCLUDE = {
    ...TR_HOUSE,
    tax_basis: "prices_exclude_tax",
    tax_basis_confirmed_at: "2026-10-15T06:00:00Z",
  };
  const STORED_INCLUSIVE = {
    voided: false,
    closed_at: null,
    source_version: null,
    source_modified_at: null,
    subtotal: "282.86",
    gross_subtotal: "330.00",
    tax_basis: "prices_include_tax",
  };
  const STAMP_KEYS = [
    "subtotal",
    "gross_subtotal",
    "tax_basis",
    "tax_rate_version",
    "net_not_recorded_reason",
  ];

  it("keeps its net and stamp when the till sends it again", async () => {
    const { service, calls } = makeDb({
      house: NOW_EXCLUDE,
      stored: STORED_INCLUSIVE,
    });
    const res = await service.ingest("r1", "generic_webhook", PAYLOAD);
    expect(res.upserted).toBe(1);
    const [row] = calls.checkUpserts;
    for (const k of STAMP_KEYS) expect(row).not.toHaveProperty(k);
    expect(row.total).toBe(330);
    expect(res.errors).toEqual([]);
  });

  it("include again: a check of the first include days is not set back to the till's figure", async () => {
    const { service, calls } = makeDb({
      house: { ...TR_HOUSE, tax_basis_confirmed_at: "2026-10-20T06:00:00Z" },
      rates: TR_RATES,
      stored: STORED_INCLUSIVE,
    });
    await service.ingest("r1", "generic_webhook", PAYLOAD);
    for (const k of STAMP_KEYS)
      expect(calls.checkUpserts[0]).not.toHaveProperty(k);
  });

  it("a check never stored before is written under the answer now", async () => {
    const { service, calls } = makeDb({ house: NOW_EXCLUDE, stored: null });
    await service.ingest("r1", "generic_webhook", PAYLOAD);
    expect(calls.checkUpserts[0]).toMatchObject({
      subtotal: 330,
      tax_basis: "prices_exclude_tax",
    });
  });

  it("an unreadable stored copy stores nothing rather than re-stamp it", async () => {
    const { service, calls } = makeDb({
      house: NOW_EXCLUDE,
      storedError: { message: "boom" },
    });
    const res = await service.ingest("r1", "generic_webhook", PAYLOAD);
    expect(calls.checkUpserts).toHaveLength(0);
    expect(res.errors[0]).toMatch(
      /^chk-1: not imported, the copy already kept could not be read .*: boom$/,
    );
  });

  it("an unset house reads no stored copy (rule 1)", async () => {
    const { service, calls } = makeDb({
      house: {
        tax_basis: "unset",
        timezone: "America/New_York",
        country: "US",
      },
      stored: STORED_INCLUSIVE,
    });
    await service.ingest("r1", "generic_webhook", PAYLOAD);
    expect(calls.storedReads).toBe(0);
  });
});
