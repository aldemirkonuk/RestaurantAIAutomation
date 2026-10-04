import { BadRequestException } from "@nestjs/common";
import { DashboardService, netSalesByHouseDay } from "./dashboard.service";
import { DashboardController } from "./dashboard.controller";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";

/**
 * The dashboard month tells the house's day true (ADR 0290).
 *
 * Found on the Tuzlu Rüzgar analytics walk, 2026-10-03:
 *   C18   the deliveries read named `procurement_orders.wine_name`, a column
 *         the table has never had; PostgREST refused the read, the error was
 *         not read, and every day showed $0 paid (Oct 2: $0 against $39,302.50).
 *   AW12  the events read was `select('*')` with no paging, so a month past
 *         PostgREST's 1,000-row ceiling (supabase/config.toml max_rows) lost
 *         its last days without a word.
 *   AW21  the "sales calendar" had no sales source at all.
 *   F-086 days were cut on the UTC date, not the house's.
 *
 * The fake below behaves like PostgREST where these defects live: it refuses
 * a select naming a column the table does not have, caps every response at
 * 1,000 rows, and honours the filters, the order and the limit, so a read
 * that does not page, or a filter that is wrong, shows up as a wrong figure.
 */

const MAX_ROWS = 1000;
const HOUSE = "house-1";
const LA = "America/Los_Angeles";

const COLUMNS: Record<string, string[]> = {
  restaurants: ["id", "timezone"],
  procurement_orders: [
    "id",
    "restaurant_id",
    "status",
    "final_price",
    "total_cost",
    "bottles_total",
    "quantity",
    "delivered_at",
    "created_at",
  ],
  calendar_events: [
    "id",
    "restaurant_id",
    "title",
    "description",
    "event_type",
    "event_date",
    "event_time",
    "status",
    "color",
  ],
  pos_checks: [
    "id",
    "restaurant_id",
    "subtotal",
    "total",
    "tip",
    "covers",
    "opened_at",
    "closed_at",
    "voided",
  ],
};

type Row = Record<string, any>;
interface Call {
  table: string;
  select: string | null;
  filters: Array<[string, string, any]>;
  orderBy: [string, boolean] | null;
  limit: number | null;
}
type ErrorRule = string | ((call: Call) => string | null);

/** Timestamps compare as instants; dates and ids compare as text. */
function cmp(a: any, b: any): number {
  if (
    typeof a === "string" &&
    typeof b === "string" &&
    a.includes("T") &&
    b.includes("T")
  ) {
    return Date.parse(a) - Date.parse(b);
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matches(row: Row, [op, col, v]: [string, string, any]): boolean {
  const x = row[col];
  switch (op) {
    case "eq":
      return x === v;
    case "in":
      return (v as any[]).includes(x);
    case "gte":
      return x != null && cmp(x, v) >= 0;
    case "gt":
      return x != null && cmp(x, v) > 0;
    case "lt":
      return x != null && cmp(x, v) < 0;
    case "lte":
      return x != null && cmp(x, v) <= 0;
    default:
      throw new Error(`fake: unsupported filter ${op}`);
  }
}

function fakeDb(
  tables: Record<string, Row[]>,
  errors: Record<string, ErrorRule> = {},
) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = {
      table,
      select: null,
      filters: [],
      orderBy: null,
      limit: null,
    };
    calls.push(call);
    const run = () => {
      const rule = errors[table];
      const injected = typeof rule === "function" ? rule(call) : rule;
      if (injected) return { data: null, error: { message: injected } };
      const cols =
        call.select === null || call.select.trim() === "*"
          ? null
          : call.select.split(",").map((c) => c.trim());
      const unknown = (cols ?? []).find(
        (c) => !(COLUMNS[table] ?? []).includes(c),
      );
      if (unknown) {
        return {
          data: null,
          error: {
            message: `column ${table}.${unknown} does not exist`,
            code: "42703",
          },
        };
      }
      let rows = (tables[table] ?? []).filter((r) =>
        call.filters.every((f) => matches(r, f)),
      );
      if (call.orderBy) {
        const [col, asc] = call.orderBy;
        rows = [...rows].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
      }
      rows = rows.slice(0, Math.min(call.limit ?? Infinity, MAX_ROWS));
      const data = rows.map((r) =>
        cols
          ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))
          : { ...r },
      );
      return { data, error: null };
    };
    const b: any = {
      select: (s: string) => ((call.select = s), b),
      eq: (c: string, v: any) => (call.filters.push(["eq", c, v]), b),
      in: (c: string, v: any[]) => (call.filters.push(["in", c, v]), b),
      gte: (c: string, v: any) => (call.filters.push(["gte", c, v]), b),
      gt: (c: string, v: any) => (call.filters.push(["gt", c, v]), b),
      lt: (c: string, v: any) => (call.filters.push(["lt", c, v]), b),
      lte: (c: string, v: any) => (call.filters.push(["lte", c, v]), b),
      order: (c: string, o?: { ascending?: boolean }) => (
        (call.orderBy = [c, o?.ascending !== false]),
        b
      ),
      limit: (n: number) => ((call.limit = n), b),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { client: { from: jest.fn(from) }, calls };
}

const id = (prefix: string, n: number) =>
  `${prefix}-${String(n).padStart(6, "0")}`;

function house(timezone: string | null) {
  return [{ id: HOUSE, timezone }];
}

function order(
  n: number,
  deliveredAt: string,
  totalCost: number,
  bottles: number,
): Row {
  return {
    id: id("po", n),
    restaurant_id: HOUSE,
    status: ProcurementOrderStatus.DELIVERED,
    final_price: 1,
    total_cost: totalCost,
    bottles_total: bottles,
    quantity: 1,
    delivered_at: deliveredAt,
    created_at: "2026-09-01T00:00:00Z",
  };
}

function check(
  n: number,
  openedAt: string,
  closedAt: string | null,
  subtotal: number | null,
  extra: Row = {},
): Row {
  return {
    id: id("chk", n),
    restaurant_id: HOUSE,
    subtotal,
    total: subtotal === null ? 99 : subtotal * 1.2,
    tip: 5,
    covers: 2,
    opened_at: openedAt,
    closed_at: closedAt,
    voided: false,
    ...extra,
  };
}

function serviceOver(db: ReturnType<typeof fakeDb>) {
  return new DashboardService({ getClient: () => db.client } as any);
}

const day = (month: any, date: string) =>
  month.daily.find((d: any) => d.date === date);

afterEach(() => jest.useRealTimers());

describe("C18 — the month's deliveries", () => {
  it("reads deliveries without naming wine_name, so the day carries its real spend", async () => {
    const db = fakeDb({
      restaurants: house(LA),
      procurement_orders: [
        order(1, "2026-10-02T21:00:00Z", 39302.5, 4347),
        order(2, "2026-10-02T21:30:00Z", 100, 12),
      ],
    });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10);

    const reads = db.calls.filter((c) => c.table === "procurement_orders");
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r.select).not.toMatch(/wine_name/);
    expect(day(month, "2026-10-02")).toMatchObject({
      procurement_spend: 39402.5,
      bottles_sold: 4359,
      order_count: 2,
    });
    expect(month.monthly_procurement_spend).toBe(39402.5);
  });

  it("fails the month when deliveries cannot be read, instead of drawing $0", async () => {
    const db = fakeDb(
      {
        restaurants: house(LA),
        procurement_orders: [order(1, "2026-10-02T21:00:00Z", 10, 1)],
      },
      { procurement_orders: "permission denied for table procurement_orders" },
    );
    await expect(
      serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("AW12 — the month's calendar entries", () => {
  it("names its columns, never '*', and returns every entry past the 1,000-row ceiling", async () => {
    const events = Array.from({ length: 1200 }, (_, i) => ({
      id: id("ev", i),
      restaurant_id: HOUSE,
      title: `Delivery ${i}`,
      description: "x".repeat(200),
      event_type: "delivery_eta",
      // The late days are the ones a capped read ordered by date would drop.
      event_date: `2026-10-${String(1 + (i % 31)).padStart(2, "0")}`,
      event_time: i % 2 ? "09:00:00" : null,
      status: "pending",
      color: null,
    }));
    const db = fakeDb({ restaurants: house(LA), calendar_events: events });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10);

    const reads = db.calls.filter((c) => c.table === "calendar_events");
    for (const r of reads) {
      expect(r.select).not.toBe("*");
      expect(r.select).toBe("id, title, event_type, event_date, event_time");
    }
    const all = month.daily.flatMap((d: any) => d.events);
    expect(all).toHaveLength(1200);
    expect(day(month, "2026-10-31").events.length).toBeGreaterThan(0);
    expect(Object.keys(all[0]).sort()).toEqual(
      ["event_date", "event_time", "event_type", "id", "title"].sort(),
    );
  });

  it("fails the month when the calendar cannot be read", async () => {
    const db = fakeDb(
      { restaurants: house(LA) },
      { calendar_events: "canceling statement due to statement timeout" },
    );
    await expect(
      serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10),
    ).rejects.toThrow(/statement timeout/);
  });
});

/** The two one-row register probes: its first check, and its latest. */
const isFirstProbe = (c: Call) =>
  c.table === "pos_checks" && c.select === "opened_at";
const isLatestProbe = (c: Call) =>
  c.table === "pos_checks" && c.select === "opened_at, closed_at";

/**
 * The house's clock for the sales blocks: mid-November 2026, so October is a
 * month that has ended. The month's figure is over the days that have begun,
 * so a test that left the real clock running would change with the date.
 */
const AFTER_OCTOBER = new Date("2026-11-15T20:00:00Z");

describe("AW21 — net sales on the house's day", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(AFTER_OCTOBER));

  it("sums subtotal over checks that are not voided, never total or tip, across every page", async () => {
    // 2,500 checks: three pages at the 1,000-row ceiling.
    const checks = Array.from({ length: 2500 }, (_, i) => {
      const d = 1 + (i % 25);
      const at = `2026-10-${String(d).padStart(2, "0")}T20:00:00Z`; // 13:00 in LA
      return check(i, at, at, 10);
    });
    checks.push(
      check(9001, "2026-10-05T20:00:00Z", "2026-10-05T20:30:00Z", 5000, {
        voided: true,
      }),
      // The register kept sending into November, so all of October is a
      // stretch it was there for.
      check(9002, "2026-11-02T20:00:00Z", "2026-11-02T20:30:00Z", 7),
    );
    const db = fakeDb({ restaurants: house(LA), pos_checks: checks });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });

    expect(month.pos_connected).toBe(true);
    expect(month.monthly_checks).toBe(2500);
    expect(month.monthly_net_sales).toBe(25000);
    expect(day(month, "2026-10-05")).toMatchObject({
      checks: 100,
      net_sales: 1000,
    });
    // A connected register's quiet day is a measured zero.
    expect(day(month, "2026-10-30")).toMatchObject({ checks: 0, net_sales: 0 });

    // The takings pages; the two one-row probes are asserted on their own.
    const reads = db.calls.filter(
      (c) => c.table === "pos_checks" && !isFirstProbe(c) && !isLatestProbe(c),
    );
    for (const r of reads) {
      expect(r.select).toBe("id, subtotal, opened_at, closed_at");
      expect(r.filters).toContainEqual(["eq", "voided", false]);
    }
    expect(reads.length).toBeGreaterThanOrEqual(3);
  });

  it("files checks and deliveries on the house's day, not the UTC date", async () => {
    const db = fakeDb({
      restaurants: house(LA),
      pos_checks: [
        // 22:30 on Oct 3 in Los Angeles; Oct 4 in UTC.
        check(1, "2026-10-04T04:00:00Z", "2026-10-04T05:30:00Z", 80),
        // Opened 23:00 on Sep 30 local, closed 00:30 on Oct 1 local: it
        // closed on the 1st, and it opened before the month began.
        check(2, "2026-10-01T06:00:00Z", "2026-10-01T07:30:00Z", 40),
        // Opened 23:30 on Oct 31 local, closed 00:30 on Nov 1 local: November's.
        check(3, "2026-11-01T06:30:00Z", "2026-11-01T07:30:00Z", 999),
      ],
      procurement_orders: [order(1, "2026-10-04T03:00:00Z", 250, 6)],
    });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });

    expect(month.timezone).toBe(LA);
    expect(day(month, "2026-10-03")).toMatchObject({
      net_sales: 80,
      checks: 1,
      procurement_spend: 250,
      order_count: 1,
    });
    expect(day(month, "2026-10-04")).toMatchObject({
      net_sales: 0,
      procurement_spend: 0,
      order_count: 0,
    });
    expect(day(month, "2026-10-01")).toMatchObject({
      net_sales: 40,
      checks: 1,
    });
    expect(month.monthly_net_sales).toBe(120);
  });

  it("reads a day with a check that states no subtotal as unknown, not as the rest", async () => {
    const db = fakeDb({
      restaurants: house(LA),
      pos_checks: [
        // The register was already sending in August, so every October day
        // is one it was there for.
        check(0, "2026-08-10T20:00:00Z", "2026-08-10T21:00:00Z", 30),
        check(1, "2026-10-06T20:00:00Z", "2026-10-06T21:00:00Z", 50),
        check(2, "2026-10-06T22:00:00Z", "2026-10-06T23:00:00Z", null),
        // ...and was still sending in November.
        check(3, "2026-11-03T20:00:00Z", "2026-11-03T21:00:00Z", 20),
      ],
    });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });
    expect(day(month, "2026-10-06")).toMatchObject({
      checks: 2,
      net_sales: null,
    });
    expect(month.monthly_net_sales).toBeNull();
    expect(month.monthly_checks).toBe(2);
  });

  it("says 'no register' when the house has never sent a check, never zero", async () => {
    const db = fakeDb({ restaurants: house(LA), pos_checks: [] });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });
    expect(month.pos_connected).toBe(false);
    expect(month.monthly_net_sales).toBeNull();
    expect(month.monthly_checks).toBeNull();
    for (const d of month.daily) {
      expect(d.net_sales).toBeNull();
      expect(d.checks).toBeNull();
    }
  });

  it("reads a quiet month as zeros when the register sent checks before and after it", async () => {
    const db = fakeDb({
      restaurants: house(LA),
      pos_checks: [
        check(1, "2026-08-10T20:00:00Z", "2026-08-10T21:00:00Z", 30),
        check(2, "2026-11-04T20:00:00Z", "2026-11-04T21:00:00Z", 30),
      ],
    });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });
    expect(month.pos_connected).toBe(true);
    expect(month.monthly_net_sales).toBe(0);
    expect(month.monthly_checks).toBe(0);
    expect(day(month, "2026-10-15")).toMatchObject({ checks: 0, net_sales: 0 });
  });

  it("reads the days after the register's latest check as unknown, not as quiet zeros", async () => {
    // Tuzlu Rüzgar's shape: the feed runs Jul 1 to Aug 30 and then stops.
    jest.useFakeTimers().setSystemTime(new Date("2026-10-03T17:00:00Z"));
    const db = fakeDb({
      restaurants: house(LA),
      pos_checks: [
        check(1, "2026-07-01T19:00:00Z", "2026-07-01T20:00:00Z", 100),
        check(2, "2026-07-20T19:00:00Z", "2026-07-20T20:00:00Z", 50),
        // The last check ever: opened 23:30 on Aug 29 in Los Angeles and
        // closed 00:15 on Aug 30, so Aug 30 is a day the register sent on.
        check(3, "2026-08-30T06:30:00Z", "2026-08-30T07:15:00Z", 80),
      ],
    });
    const service = serviceOver(db);

    const august = await service.getCalendarRevenue(HOUSE, 2026, 8, {
      withSales: true,
    });
    expect(day(august, "2026-08-30")).toMatchObject({
      net_sales: 80,
      checks: 1,
    });
    // Between the first and the last check, a day without one is measured.
    expect(day(august, "2026-08-15")).toMatchObject({
      net_sales: 0,
      checks: 0,
    });
    // After the last one, it is not: no check came, and nothing says the
    // register was still sending.
    expect(day(august, "2026-08-31")).toMatchObject({
      net_sales: null,
      checks: null,
    });
    expect(august.monthly_net_sales).toBeNull();
    expect(august.monthly_checks).toBeNull();

    for (const [y, m] of [
      [2026, 9],
      [2026, 10],
    ]) {
      const later = await service.getCalendarRevenue(HOUSE, y, m, {
        withSales: true,
      });
      expect(later.pos_connected).toBe(true);
      expect(
        later.daily.every((d) => d.net_sales === null && d.checks === null),
      ).toBe(true);
      expect(later.monthly_net_sales).toBeNull();
      expect(later.monthly_checks).toBeNull();
    }

    // July lies wholly between the first and the last check: it is known.
    const july = await service.getCalendarRevenue(HOUSE, 2026, 7, {
      withSales: true,
    });
    expect(july.monthly_net_sales).toBe(150);
    expect(july.monthly_checks).toBe(2);

    // The latest check is asked of every check the house ever sent, newest
    // first, voided or not.
    const probe = db.calls.find(isLatestProbe);
    expect(probe).toMatchObject({
      orderBy: ["opened_at", false],
      limit: 1,
    });
    expect(probe!.filters).not.toContainEqual(["eq", "voided", false]);
  });

  it("states the month so far when the register sent today, and leaves the days ahead unknown", async () => {
    // 21:00 on Oct 14 in Los Angeles.
    jest.useFakeTimers().setSystemTime(new Date("2026-10-15T04:00:00Z"));
    const db = fakeDb({
      restaurants: house(LA),
      pos_checks: [
        check(1, "2026-09-20T19:00:00Z", "2026-09-20T20:00:00Z", 10),
        check(2, "2026-10-03T19:00:00Z", "2026-10-03T20:00:00Z", 30),
        check(3, "2026-10-14T19:00:00Z", "2026-10-14T20:00:00Z", 45),
      ],
    });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });
    expect(month.today).toBe("2026-10-14");
    expect(day(month, "2026-10-14")).toMatchObject({
      net_sales: 45,
      checks: 1,
    });
    expect(day(month, "2026-10-15")).toMatchObject({
      net_sales: null,
      checks: null,
    });
    // The days ahead have not happened; the month so far is Oct 1-14.
    expect(month.monthly_net_sales).toBe(75);
    expect(month.monthly_checks).toBe(2);
  });

  it("reads today as unknown until its first check lands, and the month with it", async () => {
    // 09:00 on Oct 14 in Los Angeles; the last check closed last night.
    jest.useFakeTimers().setSystemTime(new Date("2026-10-14T16:00:00Z"));
    const db = fakeDb({
      restaurants: house(LA),
      pos_checks: [
        check(1, "2026-09-20T19:00:00Z", "2026-09-20T20:00:00Z", 10),
        check(2, "2026-10-14T03:00:00Z", "2026-10-14T04:00:00Z", 30),
      ],
    });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });
    expect(day(month, "2026-10-13")).toMatchObject({
      net_sales: 30,
      checks: 1,
    });
    // No heartbeat says the register is up, so "no sales yet" would be a
    // guess; the cost of not guessing is that the month waits for today.
    expect(day(month, "2026-10-14")).toMatchObject({
      net_sales: null,
      checks: null,
    });
    expect(month.monthly_net_sales).toBeNull();
    expect(month.monthly_checks).toBeNull();
  });

  it("counts a day a month's check closed on, even past the latest-opened check's day", async () => {
    // Check 1 opened first and closed last: 23:00 Oct 20 to 00:30 Oct 22 in
    // Los Angeles. Check 2 opened later and closed the same evening.
    const db = fakeDb({
      restaurants: house(LA),
      pos_checks: [
        check(0, "2026-09-01T19:00:00Z", "2026-09-01T20:00:00Z", 5),
        check(1, "2026-10-21T06:00:00Z", "2026-10-22T07:30:00Z", 90),
        check(2, "2026-10-21T19:00:00Z", "2026-10-21T20:00:00Z", 10),
      ],
    });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });
    expect(day(month, "2026-10-21")).toMatchObject({
      net_sales: 10,
      checks: 1,
    });
    expect(day(month, "2026-10-22")).toMatchObject({
      net_sales: 90,
      checks: 1,
    });
    expect(day(month, "2026-10-23")).toMatchObject({
      net_sales: null,
      checks: null,
    });
  });

  it("reads the days before the register's first check as unknown, not as quiet zeros", async () => {
    // The register's first check ever: 12:00 on Oct 10 in Los Angeles.
    const db = fakeDb({
      restaurants: house(LA),
      pos_checks: [
        check(1, "2026-10-10T19:00:00Z", "2026-10-10T19:40:00Z", 60),
        check(2, "2026-10-12T19:00:00Z", "2026-10-12T19:40:00Z", 40),
      ],
    });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });

    expect(month.pos_connected).toBe(true);
    for (const date of ["2026-10-01", "2026-10-05", "2026-10-09"]) {
      expect(day(month, date)).toMatchObject({ net_sales: null, checks: null });
    }
    expect(day(month, "2026-10-10")).toMatchObject({
      net_sales: 60,
      checks: 1,
    });
    // On or after the first check, a day without one is a measured zero.
    expect(day(month, "2026-10-11")).toMatchObject({ net_sales: 0, checks: 0 });
    expect(day(month, "2026-10-12")).toMatchObject({
      net_sales: 40,
      checks: 1,
    });
    // Nine unknown days leave the month unknown, never the sum of the rest.
    expect(month.monthly_net_sales).toBeNull();
    expect(month.monthly_checks).toBeNull();

    // A whole month before the register began is unknown on every day.
    const september = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 9, {
      withSales: true,
    });
    expect(september.pos_connected).toBe(true);
    expect(
      september.daily.every((d) => d.net_sales === null && d.checks === null),
    ).toBe(true);
    expect(september.monthly_net_sales).toBeNull();

    // The first check is asked of every check the house ever sent, in order.
    const probe = db.calls.find(isFirstProbe);
    expect(probe).toMatchObject({
      orderBy: ["opened_at", true],
      limit: 1,
    });
    expect(probe!.filters).not.toContainEqual(["eq", "voided", false]);
  });

  it("dates the register's beginning from a voided first check too", async () => {
    // A voided check still means the register was sending that day.
    const db = fakeDb({
      restaurants: house(LA),
      pos_checks: [
        check(1, "2026-10-02T19:00:00Z", "2026-10-02T19:40:00Z", 70, {
          voided: true,
        }),
      ],
    });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
      withSales: true,
    });
    expect(day(month, "2026-10-01")).toMatchObject({
      net_sales: null,
      checks: null,
    });
    expect(day(month, "2026-10-02")).toMatchObject({ net_sales: 0, checks: 0 });
  });

  it.each([
    ["first", isFirstProbe],
    ["latest", isLatestProbe],
  ])(
    "fails the month when the register's %s check cannot be read",
    async (_which, probe) => {
      const db = fakeDb(
        {
          restaurants: house(LA),
          pos_checks: [
            check(1, "2026-10-02T20:00:00Z", "2026-10-02T21:00:00Z", 10),
          ],
        },
        { pos_checks: (c) => (probe(c) ? "connection reset" : null) },
      );
      await expect(
        serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
          withSales: true,
        }),
      ).rejects.toThrow(/connection reset/);
    },
  );

  it("folds subtotal per house day and ignores total and tip", () => {
    const days = netSalesByHouseDay(
      [
        {
          subtotal: 10,
          total: 999,
          tip: 999,
          opened_at: "2026-10-04T05:00:00Z",
          closed_at: null,
        },
        {
          subtotal: "2.50",
          total: 999,
          opened_at: "2026-10-04T05:10:00Z",
          closed_at: null,
        },
      ],
      LA,
    );
    expect(days.get("2026-10-03")).toEqual({ checks: 2, net_sales: 12.5 });
  });
});

describe("DASH-G2 — a house with no time zone", () => {
  it.each([[null], ["  "], ["Mars/Olympus"]])(
    "gives every day figure as unknown, keeps the events, and reads neither orders nor checks (zone %p)",
    async (zone) => {
      const db = fakeDb({
        restaurants: house(zone),
        procurement_orders: [order(1, "2026-10-02T21:00:00Z", 10, 1)],
        pos_checks: [
          check(1, "2026-10-02T20:00:00Z", "2026-10-02T21:00:00Z", 10),
        ],
        calendar_events: [
          {
            id: id("ev", 1),
            restaurant_id: HOUSE,
            title: "Tasting",
            event_type: "tasting",
            event_date: "2026-10-09",
            event_time: null,
          },
        ],
      });
      const month = await serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10, {
        withSales: true,
      });

      expect(month).toMatchObject({
        timezone: null,
        zone_unset: true,
        today: null,
        monthly_procurement_spend: null,
        monthly_bottles: null,
        monthly_net_sales: null,
        monthly_checks: null,
        pos_connected: null,
      });
      expect(month.daily).toHaveLength(31);
      for (const d of month.daily) {
        expect(d).toMatchObject({
          procurement_spend: null,
          bottles_sold: null,
          order_count: null,
          net_sales: null,
          checks: null,
        });
      }
      expect(day(month, "2026-10-09").events).toHaveLength(1);
      const tables = db.calls.map((c) => c.table);
      expect(tables).not.toContain("procurement_orders");
      expect(tables).not.toContain("pos_checks");
    },
  );

  it("fails when the house's zone cannot be read", async () => {
    const db = fakeDb({}, { restaurants: "JWT expired" });
    await expect(
      serviceOver(db).getCalendarRevenue(HOUSE, 2026, 10),
    ).rejects.toThrow(/JWT expired/);
  });
});

describe("the house's today", () => {
  it("states today and picks the default month on the house's clock", async () => {
    // 05:00 UTC on Nov 1 is still Oct 31 in Los Angeles.
    jest.useFakeTimers().setSystemTime(new Date("2026-11-01T05:00:00Z"));
    const db = fakeDb({ restaurants: house(LA) });
    const month = await serviceOver(db).getCalendarRevenue(HOUSE, null, null);
    expect(month.today).toBe("2026-10-31");
    expect([month.year, month.month]).toEqual([2026, 10]);
    expect(month.daily).toHaveLength(31);
  });
});

describe("who sees sales — through the controller", () => {
  function controllerOver(db: ReturnType<typeof fakeDb>) {
    return new DashboardController(serviceOver(db));
  }
  beforeEach(() => jest.useFakeTimers().setSystemTime(AFTER_OCTOBER));
  const tables = () => ({
    restaurants: house(LA),
    pos_checks: [
      // The register began in September and was still sending in November,
      // so all of October is counted.
      check(0, "2026-09-15T20:00:00Z", "2026-09-15T21:00:00Z", 5),
      check(1, "2026-10-02T20:00:00Z", "2026-10-02T21:00:00Z", 10),
      check(2, "2026-11-02T20:00:00Z", "2026-11-02T21:00:00Z", 20),
    ],
  });

  it.each([
    [{ role: "staff" }],
    [{ role: "server" }],
    [{ role: null }],
    [undefined],
  ])("withholds sales from %p and never reads the register", async (caller) => {
    const db = fakeDb(tables());
    const month: any = await controllerOver(db).getCalendarRevenue(
      HOUSE,
      "2026",
      "10",
      caller,
    );
    expect(month.sales_withheld).toBe(true);
    expect(month.monthly_net_sales).toBeNull();
    expect(month.pos_connected).toBeNull();
    expect(
      month.daily.every((d: any) => d.net_sales === null && d.checks === null),
    ).toBe(true);
    expect(db.calls.map((c) => c.table)).not.toContain("pos_checks");
  });

  it.each([["owner"], ["manager"], ["Owner"], ["admin"]])(
    "gives net sales to %s",
    async (role) => {
      const db = fakeDb(tables());
      const month: any = await controllerOver(db).getCalendarRevenue(
        HOUSE,
        "2026",
        "10",
        {
          role,
        },
      );
      expect(month.sales_withheld).toBe(false);
      expect(month.monthly_net_sales).toBe(10);
    },
  );

  it.each([
    ["13", "month"],
    ["0", "month"],
    ["10.5", "month"],
    ["abc", "year"],
  ])(
    "refuses %s as a %s with a 400 instead of reading a month that does not exist",
    async (value, part) => {
      const db = fakeDb(tables());
      const args: [string, string] =
        part === "month" ? ["2026", value] : [value, "10"];
      await expect(
        controllerOver(db).getCalendarRevenue(HOUSE, args[0], args[1], {
          role: "owner",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.calls).toHaveLength(0);
    },
  );
});
