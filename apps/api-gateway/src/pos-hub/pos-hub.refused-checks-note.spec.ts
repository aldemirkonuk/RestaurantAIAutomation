/**
 * A POS import's refused checks reach the owners' and managers' bell
 * (ADR 0281, amended 2026-10-05).
 *
 * The founder's answer, 2026-10-05: "Bell note, follow-up PR (Recommended)"
 * — one owner/manager bell note per import with refusals ("3 checks not
 * imported: date not readable"), with the check ids. Before this, a refused
 * check was said only in the import's own response, which a webhook import
 * has nobody reading.
 *
 * Run against PR #603's service at af7e68990 (this branch's base) with this
 * file and `refused-checks-note.ts` present, every `ingest` case below fails:
 * no note was filed and the result carried no `bellNote`. The copy cases
 * pin the pure copy function, which did not exist. Fixtures are synthetic.
 */
import { Logger } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import {
  MAX_NOTE_CHECK_IDS,
  REFUSED_CHECKS_NOTE_TYPE,
  refusedChecksNoteCopy,
  sayCheckId,
} from "./refused-checks-note";
import { DatabaseService } from "../database/database.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { AreaRoutingService } from "../areas/area-routing.service";

type Row = Record<string, any>;

const HOUSE = "r-1";
const OTHER_HOUSE = "r-2";

/** Who holds which house. Only HOUSE's active owners and managers may hear. */
const ACCESS: Row[] = [
  { restaurant_id: HOUSE, user_id: "u-owner", role: "owner", is_active: true },
  {
    restaurant_id: HOUSE,
    user_id: "u-manager",
    role: "Manager ",
    is_active: true,
  },
  { restaurant_id: HOUSE, user_id: "u-staff", role: "staff", is_active: true },
  {
    restaurant_id: HOUSE,
    user_id: "u-waiter",
    role: "waiter",
    is_active: true,
  },
  {
    restaurant_id: HOUSE,
    user_id: "u-gone",
    role: "manager",
    is_active: false,
  },
  {
    restaurant_id: OTHER_HOUSE,
    user_id: "u-elsewhere",
    role: "owner",
    is_active: true,
  },
];

const BOTTLE = {
  external_item_id: "btl-1",
  item_name: "SYNTHETIC Yakut bottle",
  is_wine: true,
  inventory_id: "inv-1",
  sale_unit: "bottle",
  sale_volume_ml: null,
};
const INVENTORY = [{ id: "inv-1", bottle_size_ml: 750, pour_size_ml: 150 }];

interface Opts {
  access?: Row[];
  accessError?: { message: string } | null;
  persist?: (restaurantId: string, payload: Row, opts: Row) => Promise<any>;
  /** Pass `null` to build the service with no notifications service. */
  notifications?: null;
  route?: (
    restaurantId: string,
    ids: string[],
    label: unknown,
    now: Date,
  ) => any;
}

function makeService(opts: Opts = {}) {
  const calls = {
    checks: [] as Row[],
    accessFilters: [] as Array<Record<string, unknown>>,
    persist: [] as Array<{ restaurantId: string; payload: Row; opts: Row }>,
    route: [] as Array<{
      restaurantId: string;
      ids: string[];
      label: unknown;
      now: Date;
    }>,
  };
  const client: any = {
    from(table: string) {
      if (table === "user_restaurant_access") {
        const filters: Record<string, unknown> = {};
        calls.accessFilters.push(filters);
        const q: any = {
          select: () => q,
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return q;
          },
          then: (resolve: any, reject: any) => {
            const rows = (opts.access ?? ACCESS).filter((r) =>
              Object.entries(filters).every(([k, v]) => r[k] === v),
            );
            return Promise.resolve(
              opts.accessError
                ? { data: null, error: opts.accessError }
                : {
                    data: rows.map(({ user_id, role }) => ({ user_id, role })),
                    error: null,
                  },
            ).then(resolve, reject);
          },
        };
        return q;
      }
      const q: any = {
        select: () => q,
        eq: () => q,
        in: async () => ({ data: [], error: null }),
        upsert: async (row: Row) => {
          if (table === "pos_checks") calls.checks.push(row);
          return { error: null };
        },
        insert: async () => ({ error: null }),
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({ data: [BOTTLE], error: null });
      }
      if (table === "restaurant_inventory") {
        q.in = async (_col: string, ids: string[]) => ({
          data: INVENTORY.filter((r) => ids.includes(r.id)),
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      return q;
    },
    rpc: async () => ({ data: "tx-1", error: null }),
  };

  const notifications =
    opts.notifications === null
      ? undefined
      : ({
          persistForRestaurant: jest.fn(
            async (restaurantId: string, payload: Row, o: Row = {}) => {
              calls.persist.push({ restaurantId, payload, opts: o });
              if (opts.persist) return opts.persist(restaurantId, payload, o);
              return { inserted: (o.onlyUserIds ?? []).length, ids: [] };
            },
          ),
        } as unknown as NotificationsService);

  const areaRouting = opts.route
    ? ({
        route: jest.fn(
          async (
            restaurantId: string,
            ids: string[],
            label: unknown,
            now: Date,
          ) => {
            calls.route.push({ restaurantId, ids, label, now });
            return opts.route!(restaurantId, ids, label, now);
          },
        ),
      } as unknown as AreaRoutingService)
    : undefined;

  const service = new PosHubService(
    { getClient: () => client } as unknown as DatabaseService,
    undefined,
    notifications,
    areaRouting,
  );
  return { service, calls };
}

const line = () => ({
  name: BOTTLE.item_name,
  externalItemId: BOTTLE.external_item_id,
  qty: 1,
  price: 10,
});
const check = (id: string, closedAt: unknown) => ({
  externalCheckId: id,
  openedAt: "2026-10-03T18:00:00Z",
  closedAt,
  items: [line()],
});

const ingest = async (
  service: PosHubService,
  checks: Row[],
  provider = "csv_import",
) => (await service.ingest(HOUSE, provider, checks)) as any;

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest
    .spyOn(Logger.prototype, "warn")
    .mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("an import that refused checks files one bell note for the owners and managers", () => {
  it("files exactly one note, with the count and the check ids, to this house's active owners and managers only", async () => {
    const { service, calls } = makeService();
    const res = await ingest(service, [
      check("c-1", "03.10.2026"),
      check("c-2", "03.10.2026"),
      check("c-ok", "2026-10-03 21:00:00Z"),
      check("c-3", "10/03/2026"),
    ]);

    // The import itself is unchanged: the readable check is stored, the
    // three are refused and said in errors[].
    expect(res.upserted).toBe(1);
    expect(res.refusedUnreadableDate).toBe(3);
    expect(calls.checks.map((r) => r.external_check_id)).toEqual(["c-ok"]);

    // One note, never one per check.
    expect(calls.persist).toHaveLength(1);
    const [{ restaurantId, payload, opts }] = calls.persist;
    expect(restaurantId).toBe(HOUSE);
    // Owners and managers of THIS house, active, roles read case-blind.
    // Not staff, not a waiter, not an inactive manager, not another house's owner.
    expect([...opts.onlyUserIds].sort()).toEqual(["u-manager", "u-owner"]);
    expect(opts.broadcast).toBe(true);
    // The audience read is scoped to this house and to active access rows.
    expect(calls.accessFilters).toEqual([
      { restaurant_id: HOUSE, is_active: true },
    ]);

    expect(payload.type).toBe(REFUSED_CHECKS_NOTE_TYPE);
    expect(payload.title).toBe("3 checks not imported: date not readable");
    expect(payload.message).toContain("Checks: c-1, c-2, c-3.");
    expect(payload.message).toContain("CSV / JSON Import");
    expect(payload.message).toContain(
      '(the first was written as "03.10.2026")',
    );
    expect(payload.message).toContain("2026-10-03 21:00");
    // The house's words: no internal field name in the note.
    expect(`${payload.title} ${payload.message}`).not.toMatch(
      /closed_?at|refusedUnreadableDate|pos_checks/i,
    );
    expect(payload.priority).toBe("high");
    expect(payload.metadata).toMatchObject({
      source: "csv_import",
      refused: 3,
      checkIds: ["c-1", "c-2", "c-3"],
      checkIdsNotNamed: 0,
      reason: "date_not_readable",
    });

    expect(res.bellNote).toEqual({
      filed: true,
      recipients: 2,
      heldAway: 0,
      notFiledBecause: null,
    });
  });

  it("files no note, and reads no audience, when nothing was refused", async () => {
    const { service, calls } = makeService();
    const res = await ingest(service, [
      check("c-ok", "2026-10-03 21:00:00Z"),
      check("c-open", null),
    ]);

    expect(res.refusedUnreadableDate).toBe(0);
    expect(calls.persist).toHaveLength(0);
    expect(calls.accessFilters).toHaveLength(0);
    expect(res.bellNote).toBeNull();
  });

  it("files no note for a payload with no checks", async () => {
    const { service, calls } = makeService();
    const res = await ingest(service, []);
    expect(calls.persist).toHaveLength(0);
    expect(res.bellNote).toBeNull();
  });

  it("still files one note when an export refuses many checks, naming the first ten and counting the rest", async () => {
    const { service, calls } = makeService();
    const res = await ingest(
      service,
      Array.from({ length: 53 }, (_, i) => check(`c-${i}`, "03.10.2026")),
    );

    expect(res.refusedUnreadableDate).toBe(53);
    expect(calls.persist).toHaveLength(1);
    const { payload } = calls.persist[0];
    expect(payload.title).toBe("53 checks not imported: date not readable");
    const named = Array.from(
      { length: MAX_NOTE_CHECK_IDS },
      (_, i) => `c-${i}`,
    );
    expect(payload.message).toContain(
      `Checks: ${named.join(", ")}, and 43 more.`,
    );
    expect(payload.message).not.toContain("c-10");
    expect(payload.metadata.checkIds).toEqual(named);
    expect(payload.metadata.checkIdsNotNamed).toBe(43);
    expect(payload.metadata.refused).toBe(53);
  });

  it("says the till by name when the registry knows it, and one check in the singular", async () => {
    const { service, calls } = makeService();
    await ingest(
      service,
      [check("c-9", "Sat, 03 Oct 2026 22:00:00 +0300")],
      "generic_webhook",
    );
    const { payload } = calls.persist[0];
    expect(payload.title).toBe("1 check not imported: date not readable");
    expect(payload.message).toBe(
      "1 check from Generic Webhook (canonical JSON) was not imported because its closing time could not be read " +
        '(it was written as "Sat, 03 Oct 2026 22:00:00 +0300"). Its sale and its stock are not recorded. ' +
        "Check: c-9. Send it again with the closing time written as 2026-10-03 21:00.",
    );
  });
});

describe("a note that cannot be filed never fails the import, and the result says so", () => {
  const twoChecks = [
    check("c-ok", "2026-10-03 21:00:00Z"),
    check("c-bad", "03.10.2026"),
  ];

  const expectImportStands = (res: any) => {
    expect(res.received).toBe(2);
    expect(res.upserted).toBe(1);
    expect(res.refusedUnreadableDate).toBe(1);
    expect(res.errors[0]).toContain("c-bad: not imported");
  };

  it("a bell write that throws: the import returns, bellNote says not filed and why", async () => {
    const { service } = makeService({
      persist: async () => {
        throw new Error("socket closed");
      },
    });
    const res = await ingest(service, twoChecks);
    expectImportStands(res);
    expect(res.bellNote).toEqual({
      filed: false,
      recipients: 0,
      heldAway: 0,
      notFiledBecause: "the bell write failed (socket closed)",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("POS_REFUSED_CHECKS_NOTE_NOT_FILED"),
    );
  });

  it("a bell write that wrote no rows is not filed, never read as told", async () => {
    const { service } = makeService({
      persist: async () => ({ inserted: 0, ids: [] }),
    });
    const res = await ingest(service, twoChecks);
    expectImportStands(res);
    expect(res.bellNote.filed).toBe(false);
    expect(res.bellNote.notFiledBecause).toMatch(/wrote no rows/);
  });

  it("an unreadable audience is not filed, and is not widened to staff", async () => {
    const { service, calls } = makeService({
      accessError: { message: "timeout" },
    });
    const res = await ingest(service, twoChecks);
    expectImportStands(res);
    expect(calls.persist).toHaveLength(0);
    expect(res.bellNote).toMatchObject({
      filed: false,
      notFiledBecause:
        "this house's owners and managers could not be read (timeout)",
    });
  });

  it("a house with no active owner or manager is not filed, and staff are not told instead", async () => {
    const { service, calls } = makeService({
      access: ACCESS.filter(
        (r) =>
          !["owner", "manager"].includes(String(r.role).trim().toLowerCase()),
      ),
    });
    const res = await ingest(service, twoChecks);
    expectImportStands(res);
    expect(calls.persist).toHaveLength(0);
    expect(res.bellNote).toMatchObject({
      filed: false,
      notFiledBecause: "this house has no active owner or manager to tell",
    });
  });

  it("a server with no notifications service is not filed, and says so", async () => {
    const { service } = makeService({ notifications: null });
    const res = await ingest(service, twoChecks);
    expectImportStands(res);
    expect(res.bellNote).toMatchObject({
      filed: false,
      notFiledBecause: "the bell is not wired on this server",
    });
  });
});

describe("Away (ADR 0218) applies to the note", () => {
  it("routes over the owners and managers only, and sets aside the one who is Away", async () => {
    const { service, calls } = makeService({
      route: (_r, ids) => ({
        label: null,
        step: "everyone",
        alert: ids.filter((id) => id !== "u-manager"),
        inboxOnly: [],
        heldAway: 1,
        degraded: null,
      }),
    });
    const res = await ingest(service, [check("c-bad", "03.10.2026")]);

    expect(calls.route).toHaveLength(1);
    expect(calls.route[0].restaurantId).toBe(HOUSE);
    expect([...calls.route[0].ids].sort()).toEqual(["u-manager", "u-owner"]);
    expect(calls.route[0].label).toBeNull();
    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].opts.onlyUserIds).toEqual(["u-owner"]);
    expect(calls.persist[0].payload.priority).toBe("high");
    expect(res.bellNote).toEqual({
      filed: true,
      recipients: 1,
      heldAway: 1,
      notFiledBecause: null,
    });
  });

  it("every owner and manager Away: the owners get the row only, no push and no live ping", async () => {
    const { service, calls } = makeService({
      route: () => ({
        label: null,
        step: "owners_inbox_only",
        alert: [],
        inboxOnly: ["u-owner"],
        heldAway: 2,
        degraded: null,
      }),
    });
    const res = await ingest(service, [check("c-bad", "03.10.2026")]);

    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].opts).toMatchObject({
      onlyUserIds: ["u-owner"],
      broadcast: false,
    });
    // "low" is the funnel's no-push priority.
    expect(calls.persist[0].payload.priority).toBe("low");
    expect(res.bellNote).toEqual({
      filed: true,
      recipients: 1,
      heldAway: 2,
      notFiledBecause: null,
    });
  });
});

describe("the note's copy", () => {
  it("cuts a long check id and keeps it on one line", () => {
    expect(sayCheckId("x".repeat(100))).toBe(`${"x".repeat(40)}…`);
    expect(sayCheckId("c-1\n\tline two")).toBe("c-1 line two");
    expect(sayCheckId("")).toBe("(no id)");
  });

  it("cuts the value the till sent", () => {
    const { message } = refusedChecksNoteCopy({
      providerKey: "csv_import",
      refused: [{ externalCheckId: "c-1", closedAt: "y".repeat(100) }],
    });
    expect(message).toContain(`(it was written as "${"y".repeat(39)}…)`);
  });

  it("names an unknown till by its key", () => {
    const { message } = refusedChecksNoteCopy({
      providerKey: "some_new_till",
      refused: [{ externalCheckId: "c-1", closedAt: 1791061200 }],
    });
    expect(message).toContain("1 check from some_new_till was not imported");
    expect(message).toContain("(it was written as 1791061200)");
  });
});
