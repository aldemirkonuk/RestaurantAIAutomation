/**
 * A POS import's refused checks reach the owners' and managers' bell
 * (ADR 0281, amended 2026-10-05).
 *
 * The founder's answers, 2026-10-05: "Bell note, follow-up PR (Recommended)"
 * — one owner/manager bell note per import with refusals ("3 checks not
 * imported: date not readable"), with the check ids; then F5 "One note per
 * till per hour (Recommended)" — later refusals in the same hour are counted
 * into the open note; and F6 "Push outside quiet hours (Recommended)" — inside
 * a person's quiet window they get the bell row only, no push.
 *
 * Run against PR #603's service at af7e68990 with this file and
 * `refused-checks-note.ts` present, every `ingest` case below fails: no note
 * was filed and the result carried no `bellNote`. Run against this branch's
 * first build (1236c41f3's `refused-checks-note.ts`), the F5 and F6 cases
 * fail: every import wrote a new note and pushed, at any hour. Fixtures are
 * synthetic. The notifications table, the house record and the preferences
 * are in-memory stubs: no database is reached here.
 */
import { Logger } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import {
  MAX_NOTE_CHECK_IDS,
  REFUSED_CHECKS_NOTE_TYPE,
  fileRefusedChecksNote,
  refusedChecksNoteCopy,
  sayCheckId,
} from "./refused-checks-note";
import { DatabaseService } from "../database/database.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { AreaRoutingService } from "../areas/area-routing.service";

type Row = Record<string, any>;

const HOUSE = "r-1";
const OTHER_HOUSE = "r-2";
const GROUP = `${REFUSED_CHECKS_NOTE_TYPE}:csv_import`;

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

/** Quiet hours as `NotificationsService.getPreferences` returns them. */
const QUIET_NIGHT = { enabled: true, startTime: "22:00", endTime: "08:00" };
const QUIET_OFF = { enabled: false, startTime: "22:00", endTime: "08:00" };

interface UpdateCall {
  patch: Row;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
}

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
  /** Rows already in the notifications table. */
  notes?: Row[];
  notesReadError?: { message: string } | null;
  /** Runs before each update is applied; may change the table, or answer instead. */
  beforeUpdate?: (u: UpdateCall, table: Row[]) => any;
  /** The house record; `undefined` is a house in Istanbul. */
  house?: Row | null;
  houseError?: { message: string } | null;
  /** Quiet hours per user; a person not listed has none set. */
  quiet?: Record<string, Row>;
  /** Users whose preferences cannot be read. */
  prefsFail?: string[];
}

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

/** An open note's rows, as this file writes them, for owner and manager. */
function seededNote(over: {
  refused: number;
  checkIds: string[];
  createdAt: string;
  status?: string;
  groupKey?: string;
  noteId?: string | null;
}): Row[] {
  const n = over.refused;
  return ["u-owner", "u-manager"].map((user_id, i) => ({
    id: `seed-${i}`,
    restaurant_id: HOUSE,
    user_id,
    type: REFUSED_CHECKS_NOTE_TYPE,
    group_key: over.groupKey ?? GROUP,
    status: i === 0 ? (over.status ?? "read") : (over.status ?? "unread"),
    read_at: i === 0 ? minutesAgo(5) : null,
    title: `${n} check${n === 1 ? "" : "s"} not imported: date not readable`,
    message: "seeded",
    priority: "high",
    created_at: over.createdAt,
    metadata: {
      source: "csv_import",
      ...(over.noteId === null ? {} : { noteId: over.noteId ?? "note-seed" }),
      refused: n,
      checkIds: over.checkIds,
      checkIdsNotNamed: n - over.checkIds.length,
      firstSent: '"03.10.2026"',
      imports: 1,
      reason: "date_not_readable",
    },
  }));
}

function makeService(opts: Opts = {}) {
  const table: Row[] = (opts.notes ?? []).map((r) => structuredClone(r));
  let seq = 0;
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
    noteReads: [] as Row[],
    noteUpdates: [] as UpdateCall[],
    houseReads: [] as Row[],
    prefs: [] as Array<{ userId: string; restaurantId: unknown }>,
  };

  const notesFrom = () => {
    const f = {
      eq: {} as Record<string, unknown>,
      in: {} as Record<string, unknown[]>,
      gte: {} as Record<string, string>,
      limit: Infinity,
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => ((f.eq[c] = v), q),
      in: (c: string, v: unknown[]) => ((f.in[c] = v), q),
      gte: (c: string, v: string) => ((f.gte[c] = v), q),
      order: () => q,
      limit: (n: number) => ((f.limit = n), q),
      then: (resolve: any, reject: any) => {
        calls.noteReads.push(f);
        if (opts.notesReadError)
          return Promise.resolve({
            data: null,
            error: opts.notesReadError,
          }).then(resolve, reject);
        const rows = table
          .filter(
            (r) =>
              Object.entries(f.eq).every(([k, v]) => r[k] === v) &&
              Object.entries(f.in).every(([k, v]) => v.includes(r[k])) &&
              Object.entries(f.gte).every(([k, v]) => r[k] >= v),
          )
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .slice(0, f.limit)
          .map((r) =>
            structuredClone({ id: r.id, title: r.title, metadata: r.metadata }),
          );
        return Promise.resolve({ data: rows, error: null }).then(
          resolve,
          reject,
        );
      },
    };
    q.update = (patch: Row) => {
      const u: UpdateCall = { patch, eq: {}, in: {} };
      const uq: any = {
        in: (c: string, v: unknown[]) => ((u.in[c] = v), uq),
        eq: (c: string, v: unknown) => ((u.eq[c] = v), uq),
        select: async () => {
          calls.noteUpdates.push(u);
          const answer = opts.beforeUpdate?.(u, table);
          if (answer) return answer;
          const hit = table.filter(
            (r) =>
              Object.entries(u.eq).every(([k, v]) => r[k] === v) &&
              Object.entries(u.in).every(([k, v]) => v.includes(r[k])),
          );
          for (const r of hit) Object.assign(r, structuredClone(patch));
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        },
      };
      return uq;
    };
    return q;
  };

  const client: any = {
    from(table: string) {
      if (table === "notifications") return notesFrom();
      if (table === "restaurants") {
        const filters: Record<string, unknown> = {};
        const q: any = {
          select: (cols: string) => ((filters.select = cols), q),
          eq: (c: string, v: unknown) => ((filters[c] = v), q),
          maybeSingle: async () => {
            calls.houseReads.push(filters);
            if (opts.houseError) return { data: null, error: opts.houseError };
            const house =
              opts.house === undefined
                ? { timezone: "Europe/Istanbul", country: "TR" }
                : opts.house;
            return { data: filters.id === HOUSE ? house : null, error: null };
          },
        };
        return q;
      }
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
              const ids: string[] = [];
              const created_at = new Date().toISOString();
              for (const user_id of o.onlyUserIds ?? []) {
                const id = `n-${++seq}`;
                ids.push(id);
                table.push({
                  id,
                  restaurant_id: restaurantId,
                  user_id,
                  type: payload.type,
                  group_key: payload.groupKey ?? null,
                  status: "unread",
                  read_at: null,
                  title: payload.title,
                  message: payload.message,
                  priority: payload.priority,
                  created_at,
                  metadata: structuredClone(payload.metadata ?? {}),
                });
              }
              return { inserted: ids.length, ids };
            },
          ),
          getPreferences: jest.fn(
            async (userId: string, restaurantId?: string) => {
              calls.prefs.push({ userId, restaurantId });
              if (opts.prefsFail?.includes(userId))
                throw new Error("preferences timed out");
              return { userId, quietHours: opts.quiet?.[userId] ?? QUIET_OFF };
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
  const deps = {
    client,
    notifications,
    areaRouting,
    logger: new Logger("refused-checks-note.spec"),
  };
  return { service, calls, table, deps };
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

const filedNew = (over: Row = {}) => ({
  filed: true,
  addedToOpenNote: false,
  recipients: 2,
  heldAway: 0,
  quietHours: 0,
  notFiledBecause: null,
  caveats: [],
  ...over,
});

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
    expect(payload.groupKey).toBe(GROUP);
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
      imports: 1,
      reason: "date_not_readable",
    });
    expect(typeof payload.metadata.noteId).toBe("string");

    expect(res.bellNote).toEqual(filedNew());
  });

  it("files no note, and reads nothing for one, when nothing was refused", async () => {
    const { service, calls } = makeService();
    const res = await ingest(service, [
      check("c-ok", "2026-10-03 21:00:00Z"),
      check("c-open", null),
    ]);

    expect(res.refusedUnreadableDate).toBe(0);
    expect(calls.persist).toHaveLength(0);
    expect(calls.accessFilters).toHaveLength(0);
    expect(calls.noteReads).toHaveLength(0);
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

describe("F5: one note per till per hour", () => {
  it("a second refusing import inside the hour is counted into the open note: every recipient's row, no new row, no second push", async () => {
    const { service, calls, table } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
        // "One note per till per hour": 59 minutes is inside it.
        createdAt: minutesAgo(59),
      }),
    });
    const res = await ingest(service, [
      check("c-4", "03.10.2026"),
      check("c-5", "03.10.2026"),
    ]);

    // Nothing written, so nothing pushed: the only push path is the funnel.
    expect(calls.persist).toHaveLength(0);
    expect(calls.accessFilters).toHaveLength(0);
    expect(table).toHaveLength(2);
    // The read is this house, this type, this till, open rows, last hour.
    expect(calls.noteReads[0]).toMatchObject({
      eq: {
        restaurant_id: HOUSE,
        type: REFUSED_CHECKS_NOTE_TYPE,
        group_key: GROUP,
      },
      in: { status: ["unread", "read"] },
    });
    for (const row of table) {
      expect(row.title).toBe("5 checks not imported: date not readable");
      expect(row.message).toContain("Checks: c-1, c-2, c-3, c-4, c-5.");
      expect(row.message).toContain('(the first was written as "03.10.2026")');
      expect(row.metadata).toMatchObject({
        noteId: "note-seed",
        refused: 5,
        checkIds: ["c-1", "c-2", "c-3", "c-4", "c-5"],
        checkIdsNotNamed: 0,
        imports: 2,
      });
      // A note that grew is news again: back to unread, still no push.
      expect(row.status).toBe("unread");
      expect(row.read_at).toBeNull();
    }
    expect(res.bellNote).toEqual({
      filed: true,
      addedToOpenNote: true,
      recipients: 2,
      heldAway: 0,
      quietHours: 0,
      notFiledBecause: null,
      caveats: [],
    });
  });

  it("after the hour a new note is written, with its own push", async () => {
    const { service, calls, table } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
        // 61 minutes is past it.
        createdAt: minutesAgo(61),
      }),
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].payload.title).toBe(
      "1 check not imported: date not readable",
    );
    expect(calls.persist[0].payload.priority).toBe("high");
    // The old note is left as it was.
    expect(
      table.filter((r) => r.id.startsWith("seed-")).map((r) => r.title),
    ).toEqual([
      "3 checks not imported: date not readable",
      "3 checks not imported: date not readable",
    ]);
    expect(res.bellNote).toEqual(filedNew());
  });

  it("keeps the named ids at ten in total across updates, and counts the rest", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => `a-${i}`);
    const { service, table } = makeService({
      notes: seededNote({
        refused: 8,
        checkIds: eight,
        createdAt: minutesAgo(10),
      }),
    });
    await ingest(
      service,
      Array.from({ length: 5 }, (_, i) => check(`b-${i}`, "03.10.2026")),
    );
    await ingest(service, [check("z-1", "03.10.2026")]);

    const named = [...eight, "b-0", "b-1"];
    for (const row of table) {
      expect(row.title).toBe("14 checks not imported: date not readable");
      expect(row.metadata.checkIds).toEqual(named);
      expect(row.metadata.checkIdsNotNamed).toBe(4);
      expect(row.metadata.imports).toBe(3);
      expect(row.message).toContain(`Checks: ${named.join(", ")}, and 4 more.`);
      expect(row.message).not.toContain("b-2");
      expect(row.message).not.toContain("z-1");
    }
  });

  it("two imports at once from one till write one note and count the second into it", async () => {
    const { service, calls, table } = makeService();
    const [a, b] = await Promise.all([
      ingest(service, [check("c-1", "03.10.2026")]),
      ingest(service, [check("c-2", "03.10.2026"), check("c-3", "x")]),
    ]);

    expect(calls.persist).toHaveLength(1);
    expect(table).toHaveLength(2);
    for (const row of table) {
      expect(row.title).toBe("3 checks not imported: date not readable");
      expect([...row.metadata.checkIds].sort()).toEqual(["c-1", "c-2", "c-3"]);
      expect(row.metadata.imports).toBe(2);
    }
    // Whichever reached the bell first wrote the note; the other counted in.
    expect(
      [a.bellNote.addedToOpenNote, b.bellNote.addedToOpenNote].sort(),
    ).toEqual([false, true]);
  });

  it("another till's note, an archived note and another house's note are not open notes", async () => {
    const other = seededNote({
      refused: 2,
      checkIds: ["s-1", "s-2"],
      createdAt: minutesAgo(5),
      groupKey: `${REFUSED_CHECKS_NOTE_TYPE}:square`,
    }).map((r) => ({ ...r, id: `sq-${r.id}` }));
    const archived = seededNote({
      refused: 2,
      checkIds: ["x-1", "x-2"],
      createdAt: minutesAgo(5),
      status: "archived",
    }).map((r) => ({ ...r, id: `ar-${r.id}` }));
    const elsewhere = seededNote({
      refused: 2,
      checkIds: ["e-1", "e-2"],
      createdAt: minutesAgo(5),
    }).map((r) => ({ ...r, id: `el-${r.id}`, restaurant_id: OTHER_HOUSE }));
    const { service, calls } = makeService({
      notes: [...other, ...archived, ...elsewhere],
    });
    const res = await ingest(service, [check("c-1", "03.10.2026")]);

    expect(calls.noteUpdates).toHaveLength(0);
    expect(calls.persist).toHaveLength(1);
    expect(res.bellNote.addedToOpenNote).toBe(false);
  });

  it("an open note that cannot be read: a new note is written, and the result says so", async () => {
    const { service, calls } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1"],
        createdAt: minutesAgo(5),
      }),
      notesReadError: { message: "statement timeout" },
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.persist).toHaveLength(1);
    expect(res.bellNote).toEqual(
      filedNew({
        caveats: [
          "this till's open note could not be read (statement timeout), so a new note was written",
        ],
      }),
    );
  });

  it("an open note with no note id is not guessed at: a new note is written, and the result says so", async () => {
    const { service, calls } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1"],
        createdAt: minutesAgo(5),
        noteId: null,
      }),
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);
    expect(calls.noteUpdates).toHaveLength(0);
    expect(calls.persist).toHaveLength(1);
    expect(res.bellNote.caveats).toEqual([
      "this till's open note could not be read (it carries no note id or count), so a new note was written",
    ]);
  });

  it("an update that fails: a new note is written, and the result says so", async () => {
    const { service, calls } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1"],
        createdAt: minutesAgo(5),
      }),
      beforeUpdate: () => ({
        data: null,
        error: { message: "deadlock detected" },
      }),
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);
    expect(calls.persist).toHaveLength(1);
    expect(res.bellNote.filed).toBe(true);
    expect(res.bellNote.caveats).toEqual([
      "this till's open note could not be updated (deadlock detected), so a new note was written",
    ]);
  });

  it("another process counting into the note first is not overwritten: the update re-reads and adds to its count", async () => {
    let raced = false;
    const { service, calls, table } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
        createdAt: minutesAgo(5),
      }),
      // Between this import's read and its update, another gateway process
      // counts one refusal into the same note.
      beforeUpdate: (_u, rows) => {
        if (raced) return undefined;
        raced = true;
        for (const r of rows) {
          r.title = "4 checks not imported: date not readable";
          r.metadata = {
            ...r.metadata,
            refused: 4,
            checkIds: ["c-1", "c-2", "c-3", "p-1"],
            imports: 2,
          };
        }
        return undefined;
      },
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.noteUpdates).toHaveLength(2);
    expect(calls.noteUpdates[0].eq).toEqual({
      title: "3 checks not imported: date not readable",
    });
    expect(calls.persist).toHaveLength(0);
    for (const row of table) {
      expect(row.title).toBe("5 checks not imported: date not readable");
      expect(row.metadata.checkIds).toEqual([
        "c-1",
        "c-2",
        "c-3",
        "p-1",
        "c-4",
      ]);
    }
    expect(res.bellNote.addedToOpenNote).toBe(true);
  });

  it("an update that keeps losing the race writes a new note rather than drop the refusals", async () => {
    const { service, calls } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1"],
        createdAt: minutesAgo(5),
      }),
      beforeUpdate: () => ({ data: [], error: null }),
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);
    expect(calls.noteUpdates).toHaveLength(2);
    expect(calls.persist).toHaveLength(1);
    expect(res.bellNote.caveats).toEqual([
      "this till's open note changed while it was being counted into, so a new note was written",
    ]);
  });

  it("a row of the note left at an older count by another process is brought up to the new count", async () => {
    // The note's second row was written after another process had already
    // counted into its first row, so it still says 2 where the first says 3.
    const [first, second] = seededNote({
      refused: 3,
      checkIds: ["c-1", "c-2", "c-3"],
      createdAt: minutesAgo(5),
    });
    const behind = {
      ...second,
      title: "2 checks not imported: date not readable",
      metadata: { ...second.metadata, refused: 2, checkIds: ["c-1", "c-2"] },
    };
    const { service, calls, table } = makeService({ notes: [first, behind] });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.persist).toHaveLength(0);
    // The lead rows under the compare-and-set, then the row behind.
    expect(calls.noteUpdates.map((u) => [u.in.id, u.eq])).toEqual([
      [["seed-0"], { title: "3 checks not imported: date not readable" }],
      [["seed-1"], {}],
    ]);
    for (const row of table) {
      expect(row.title).toBe("4 checks not imported: date not readable");
      expect(row.metadata.checkIds).toEqual(["c-1", "c-2", "c-3", "c-4"]);
    }
    expect(res.bellNote).toMatchObject({
      addedToOpenNote: true,
      recipients: 2,
      caveats: [],
    });
  });
});

describe("F6: a push outside quiet hours, the row only inside them", () => {
  // 00:30 UTC is 03:30 in Istanbul and 17:30 the day before in Los Angeles.
  const NIGHT_IN_ISTANBUL = new Date("2026-10-05T00:30:00Z");
  // 12:00 UTC is 15:00 in Istanbul and 05:00 in Los Angeles.
  const NOON_UTC = new Date("2026-10-05T12:00:00Z");
  const file = (deps: any, now: Date) =>
    fileRefusedChecksNote(deps, {
      restaurantId: HOUSE,
      providerKey: "csv_import",
      refused: [{ externalCheckId: "c-1", closedAt: "03.10.2026" }],
      now,
    });

  it("a recipient inside their quiet window gets the row with no push and no live ping; the other is pushed; one note", async () => {
    const { deps, calls, table } = makeService({
      quiet: { "u-owner": QUIET_NIGHT },
    });
    const res = await file(deps, NIGHT_IN_ISTANBUL);

    expect(calls.persist).toHaveLength(2);
    const [pushed, quiet] = calls.persist;
    expect(pushed.opts).toEqual({
      onlyUserIds: ["u-manager"],
      broadcast: true,
    });
    expect(pushed.payload.priority).toBe("high");
    // "low" is the funnel's no-push priority; no broadcast, no live ping.
    expect(quiet.opts).toEqual({ onlyUserIds: ["u-owner"], broadcast: false });
    expect(quiet.payload.priority).toBe("low");
    // One note: the same words and the same note id on both rows.
    expect(quiet.payload.title).toBe(pushed.payload.title);
    expect(quiet.payload.metadata).toEqual(pushed.payload.metadata);
    // Preferences are read per recipient, for this house.
    expect(calls.prefs.map((p) => p.restaurantId)).toEqual([HOUSE, HOUSE]);
    expect(calls.houseReads).toEqual([
      { select: "timezone, country", id: HOUSE },
    ]);
    expect(table).toHaveLength(2);
    expect(res).toEqual(filedNew({ quietHours: 1 }));
  });

  it("outside the window both are pushed", async () => {
    const { deps, calls } = makeService({
      quiet: { "u-owner": QUIET_NIGHT },
    });
    const res = await file(deps, NOON_UTC);
    expect(calls.persist).toHaveLength(1);
    expect([...calls.persist[0].opts.onlyUserIds].sort()).toEqual([
      "u-manager",
      "u-owner",
    ]);
    expect(calls.persist[0].payload.priority).toBe("high");
    expect(res.quietHours).toBe(0);
  });

  it("reads the window on the house's clock, not the server's: noon UTC is 05:00 in a Los Angeles house", async () => {
    const { deps, calls } = makeService({
      quiet: { "u-owner": QUIET_NIGHT },
      house: { timezone: "America/Los_Angeles", country: "US" },
    });
    const res = await file(deps, NOON_UTC);
    expect(calls.persist.map((p) => p.opts)).toEqual([
      { onlyUserIds: ["u-manager"], broadcast: true },
      { onlyUserIds: ["u-owner"], broadcast: false },
    ]);
    expect(res.quietHours).toBe(1);
  });

  it("a house with no zone of its own takes its country's only zone (ADR 0207)", async () => {
    const { deps, calls } = makeService({
      quiet: { "u-owner": QUIET_NIGHT },
      house: { timezone: null, country: "TR" },
    });
    await file(deps, NIGHT_IN_ISTANBUL);
    expect(calls.persist.map((p) => p.payload.priority)).toEqual([
      "high",
      "low",
    ]);
  });

  it("a house with no zone known pushes everyone, as before, and says so", async () => {
    const { deps, calls } = makeService({
      quiet: { "u-owner": QUIET_NIGHT },
      house: { timezone: null, country: "US" },
    });
    const res = await file(deps, NIGHT_IN_ISTANBUL);
    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].payload.priority).toBe("high");
    expect(calls.prefs).toHaveLength(0);
    expect(res.caveats).toEqual([
      "the house has no time zone on record, so every recipient was pushed",
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("POS_REFUSED_CHECKS_NOTE_QUIET_HOURS_UNREAD"),
    );
  });

  it("a house record that cannot be read pushes everyone, as before, and says so", async () => {
    const { deps, calls } = makeService({
      quiet: { "u-owner": QUIET_NIGHT },
      houseError: { message: "connection reset" },
    });
    const res = await file(deps, NIGHT_IN_ISTANBUL);
    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].opts.broadcast).toBe(true);
    expect(res.filed).toBe(true);
    expect(res.caveats).toEqual([
      "the house's time zone could not be read (connection reset), so every recipient was pushed",
    ]);
  });

  it("preferences that cannot be read: that person is pushed, as before, the others are judged, and it is said", async () => {
    const { deps, calls } = makeService({
      quiet: { "u-owner": QUIET_NIGHT, "u-manager": QUIET_NIGHT },
      prefsFail: ["u-owner"],
    });
    const res = await file(deps, NIGHT_IN_ISTANBUL);
    expect(
      calls.persist.map((p) => [p.opts.onlyUserIds, p.payload.priority]),
    ).toEqual([
      [["u-owner"], "high"],
      [["u-manager"], "low"],
    ]);
    expect(res.quietHours).toBe(1);
    expect(res.caveats).toEqual([
      "the quiet hours of 1 recipient could not be read (preferences timed out), so that person was pushed",
    ]);
  });

  it("every one inside their quiet window: one note, rows only, nothing pushed", async () => {
    const { deps, calls } = makeService({
      quiet: { "u-owner": QUIET_NIGHT, "u-manager": QUIET_NIGHT },
    });
    const res = await file(deps, NIGHT_IN_ISTANBUL);
    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].opts.broadcast).toBe(false);
    expect(calls.persist[0].payload.priority).toBe("low");
    expect(res).toEqual(filedNew({ quietHours: 2 }));
  });

  it("through ingest(): a recipient whose quiet window holds this minute gets the row without a push", async () => {
    const hhmm = (d: Date) => d.toISOString().slice(11, 16);
    const now = Date.now();
    const { service, calls } = makeService({
      house: { timezone: "UTC", country: null },
      quiet: {
        "u-manager": {
          enabled: true,
          startTime: hhmm(new Date(now - 5 * 60_000)),
          endTime: hhmm(new Date(now + 60 * 60_000)),
        },
      },
    });
    const res = await ingest(service, [check("c-1", "03.10.2026")]);
    expect(
      calls.persist.map((p) => [p.opts.onlyUserIds, p.opts.broadcast]),
    ).toEqual([
      [["u-owner"], true],
      [["u-manager"], false],
    ]);
    expect(res.bellNote.quietHours).toBe(1);
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
      addedToOpenNote: false,
      recipients: 0,
      heldAway: 0,
      quietHours: 0,
      notFiledBecause: "the bell write failed (socket closed)",
      caveats: [],
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
    // Quiet hours are read for the one who is not Away only.
    expect(calls.prefs.map((p) => p.userId)).toEqual(["u-owner"]);
    expect(res.bellNote).toEqual(filedNew({ recipients: 1, heldAway: 1 }));
  });

  it("every owner and manager Away: the owners get the row only, no push and no live ping, and quiet hours are not read", async () => {
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
    expect(calls.prefs).toHaveLength(0);
    expect(calls.houseReads).toHaveLength(0);
    expect(res.bellNote).toEqual(filedNew({ recipients: 1, heldAway: 2 }));
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
