import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { JwtStrategy } from "../auth/strategies/jwt.strategy";
import type { JwtPayload } from "../auth/auth.service";
import { NotificationsService } from "../notifications/notifications.service";
import { DashboardController } from "./dashboard.controller";
import { DashboardService, RECENT_NOTICE_COLUMNS } from "./dashboard.service";

/**
 * GET /dashboard/summary/:id — the `notifications.recent` leg reads only the
 * caller's own notices, scoped as the bell scopes its list.
 *
 * It read every notice in the house (`select("*")` by restaurant_id, no
 * user_id), so a waiter's summary carried the owners' own-wage notice with
 * both figures (ADR 0215), a manager's limit notice, and rows a producer filed
 * with no addressee. One fixture, three tokens (owner, manager, staff), each
 * built by the real JwtStrategy and handed to the handler through its real
 * `@CurrentUser()` factory; the summary is then checked against what the
 * bell (`NotificationsService.getNotifications`) gives the same person.
 */

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER_HOUSE = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const OWNER = "0a0a0a0a-0000-4000-8000-000000000001";
const MANAGER = "0b0b0b0b-0000-4000-8000-000000000002";
const STAFF = "0c0c0c0c-0000-4000-8000-000000000003";

const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 7, 12, minute)).toISOString();

/** A row as the gateway writes one: `sent_at` is never set (notifications.service.ts). */
function row(
  id: string,
  userId: string | null,
  minute: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    user_id: userId,
    recipient_id: userId,
    restaurant_id: HOUSE,
    notification_type: "system",
    channels: ["in_app"],
    type: "system",
    title: `notice ${id}`,
    message: `text ${id}`,
    priority: "medium",
    status: "unread",
    action_url: null,
    action_label: null,
    metadata: {},
    read_at: null,
    sent_at: null,
    delivery_status: null,
    group_key: null,
    archived_at: null,
    created_at: at(minute),
    ...extra,
  };
}

/** The house's notices, oldest first (the order they were written in). */
const ROWS = [
  // The owner's: the own-wage notice carries both figures (ADR 0215 round 5).
  row("own-wage", OWNER, 40, {
    title: "Mert set their own wage",
    message:
      "Mert changed their own hourly wage on Team from ₺250.00 to ₺320.00.",
    priority: "high",
    metadata: { hourly_wage: { from: 250, to: 320 }, currency: "TRY" },
  }),
  row("price-review", OWNER, 41, {
    type: "price_index_review",
    title: "4 price rows wait for your review",
  }),
  // The manager's own limit.
  row("mgr-limit", MANAGER, 42, {
    type: "order_limit",
    title: "Your order limit is now ₺5,000",
  }),
  // A row with no addressee (email_intel_agent.py's direct insert).
  row("promo-null", null, 50, {
    type: "email_classified_promo",
    title: "Deal: Rioja at 20% off from Vinos",
  }),
  // The waiter's six, oldest first; the newest five are the summary's.
  row("s1", STAFF, 10, { status: "read", read_at: at(11) }),
  row("s2", STAFF, 12),
  row("s3", STAFF, 14, { status: "read", read_at: at(15) }),
  row("s4", STAFF, 16),
  row("s5", STAFF, 18, {
    metadata: { order_total: 1840.5, currency: "TRY" },
  }),
  row("s6", STAFF, 20),
  // The waiter's notice in another house.
  row("staff-other-house", STAFF, 55, { restaurant_id: OTHER_HOUSE }),
];

/**
 * A PostgREST stand-in that applies what the reads ask for: the column list,
 * `eq` (which never matches NULL, as in SQL), `order` (DESC puts NULLs first,
 * as Postgres does), `range` and `limit`. Every other call passes through.
 */
function fakeClient(rowsByTable: Record<string, any[]>) {
  const reads: Array<{ table: string; select: string; eqs: string[] }> = [];
  const client = {
    from(table: string) {
      let rows = [...(rowsByTable[table] ?? [])];
      let columns: string[] | null = null;
      const read = { table, select: "*", eqs: [] as string[] };
      reads.push(read);
      const builder: any = {};
      const passthrough = [
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "in",
        "is",
        "or",
        "not",
        "filter",
        "match",
        "ilike",
        "like",
        "contains",
      ];
      for (const m of passthrough) builder[m] = () => builder;
      builder.select = (cols = "*") => {
        read.select = cols;
        columns =
          cols.trim() === "*" ? null : cols.split(",").map((c) => c.trim());
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        read.eqs.push(column);
        rows = rows.filter((r) => r[column] !== null && r[column] === value);
        return builder;
      };
      builder.order = (
        column: string,
        opts: { ascending?: boolean; nullsFirst?: boolean } = {},
      ) => {
        const asc = opts.ascending !== false;
        const nullsFirst = opts.nullsFirst ?? !asc;
        rows = [...rows].sort((a, b) => {
          const x = a[column];
          const y = b[column];
          if (x === null && y === null) return 0;
          if (x === null) return nullsFirst ? -1 : 1;
          if (y === null) return nullsFirst ? 1 : -1;
          if (x === y) return 0;
          return (x < y ? -1 : 1) * (asc ? 1 : -1);
        });
        return builder;
      };
      builder.range = (from: number, to: number) => {
        rows = rows.slice(from, to + 1);
        return builder;
      };
      builder.limit = (n: number) => {
        rows = rows.slice(0, n);
        return builder;
      };
      const settle = () => {
        const data = columns
          ? rows.map((r) => Object.fromEntries(columns!.map((c) => [c, r[c]])))
          : rows;
        return { data, error: null, count: rows.length };
      };
      builder.maybeSingle = async () => ({
        data: settle().data[0] ?? null,
        error: null,
      });
      builder.single = builder.maybeSingle;
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve(settle()).then(resolve, reject);
      return builder;
    },
  };
  return { client, reads };
}

function harness() {
  const { client, reads } = fakeClient({ notifications: ROWS });
  const db = {
    supabase: client,
    getClient: () => client,
    getRestaurantInventory: async () => [],
    getLowStockItems: async () => [],
    getProcurementOrders: async () => [],
  };
  const dashboard = new DashboardService(db as never);
  const controller = new DashboardController(dashboard);
  const bell = new NotificationsService(
    {} as never,
    { get: () => undefined } as never,
    db as never,
  );
  return { controller, bell, reads };
}

/** `request.user` exactly as the gateway builds it from a token in HOUSE. */
async function userFromToken(
  userId: string,
  role: "owner" | "manager" | "staff",
): Promise<Record<string, unknown>> {
  const strategy = new JwtStrategy({
    validateJwtPayload: jest.fn().mockResolvedValue({
      user_id: userId,
      email: `${role}@house.test`,
      name: role,
      house_role: role,
      email_verified: true,
    }),
  } as never);
  const payload = {
    sub: userId,
    email: `${role}@house.test`,
    restaurantId: HOUSE,
  } as JwtPayload;
  return (await strategy.validate(payload)) as Record<string, unknown>;
}

/** The handler's `@CurrentUser()` argument, through its real factory. */
function asNestWould(requestUser: Record<string, unknown> | undefined) {
  const meta = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    DashboardController,
    "getDashboardSummary",
  ) as Record<
    string,
    { index: number; factory?: (...a: unknown[]) => unknown; data?: unknown }
  >;
  const entry = Object.values(meta).find(
    (m) => typeof m.factory === "function" && m.index === 1,
  );
  if (!entry?.factory) {
    throw new Error("getDashboardSummary takes no @CurrentUser() at index 1");
  }
  return entry.factory(entry.data, {
    switchToHttp: () => ({ getRequest: () => ({ user: requestUser }) }),
  }) as any;
}

async function summaryFor(userId: string, role: "owner" | "manager" | "staff") {
  const h = harness();
  const user = asNestWould(await userFromToken(userId, role));
  const summary: any = await h.controller.getDashboardSummary(HOUSE, user);
  const bell = await h.bell.getNotifications({
    userId: user.userId,
    restaurantId: user.restaurantId,
  });
  return { summary, bell, reads: h.reads };
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
const ALLOWED_KEYS = RECENT_NOTICE_COLUMNS.split(",").map((c) => c.trim());

describe("the dashboard summary's notices are the caller's own, as the bell's are", () => {
  // DASH-W22 (#579, merged with this spec): the summary carries vendor spend
  // and whole order rows, so it is refused to a waiter outright, in words,
  // before anything is read; the waiter's own notices are the bell's.
  it("a waiter is refused the summary before anything is read, never handed the house's notices", async () => {
    const h = harness();
    const user = asNestWould(await userFromToken(STAFF, "staff"));
    await expect(h.controller.getDashboardSummary(HOUSE, user)).rejects.toThrow(
      "Amounts are for the house's owners and managers.",
    );
    expect(h.reads).toEqual([]);
    const bell = await h.bell.getNotifications({ userId: user.userId, restaurantId: user.restaurantId });
    expect(ids(bell.data).slice(0, 5)).toEqual(["s6", "s5", "s4", "s3", "s2"]);
  });

  it("an owner on the same fixture reads only the owner's own notices", async () => {
    const { summary, bell } = await summaryFor(OWNER, "owner");
    const recent = summary.notifications.recent;

    expect(ids(recent)).toEqual(["price-review", "own-wage"]);
    expect(ids(recent)).toEqual(ids(bell.data).slice(0, 5));
    expect(JSON.stringify(recent)).not.toContain("Deal: Rioja");
  });

  it("a manager on the same fixture reads only the manager's own notice", async () => {
    const { summary, bell } = await summaryFor(MANAGER, "manager");

    expect(ids(summary.notifications.recent)).toEqual(["mgr-limit"]);
    expect(ids(summary.notifications.recent)).toEqual(
      ids(bell.data).slice(0, 5),
    );
  });

  it("carries only the columns a bell row draws, never metadata", async () => {
    const { summary, reads } = await summaryFor(OWNER, "owner");
    const read = reads.find(
      (r) => r.table === "notifications" && r.select !== "*",
    );

    expect(read?.select).toBe(RECENT_NOTICE_COLUMNS);
    expect(read?.eqs).toEqual(
      expect.arrayContaining(["user_id", "restaurant_id"]),
    );
    for (const notice of summary.notifications.recent) {
      expect(Object.keys(notice).sort()).toEqual([...ALLOWED_KEYS].sort());
    }
    expect(JSON.stringify(summary.notifications)).not.toContain("hourly_wage");
  });

  it("with no user on the call reads no notices at all, never the house's", async () => {
    const h = harness();
    // No role reads as staff (DASH-W22), so the call is refused before any read.
    await expect(
      h.controller.getDashboardSummary(HOUSE, asNestWould(undefined)),
    ).rejects.toThrow("Amounts are for the house's owners and managers.");
    expect(h.reads.some((r) => r.table === "notifications")).toBe(false);
  });
});
