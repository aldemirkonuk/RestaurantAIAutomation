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
 *
 * Then, after the founder's answers of 2026-10-05 ("Bring it back
 * (Recommended)", "One push per hour, re-flagged (Recommended)", "Quiet means
 * quiet (Recommended)"): run against e6227de5a's `refused-checks-note.ts` and
 * `notifications.service.ts`, the "Bring it back", the row-behind
 * compare-and-set, the answer-on-time, the push-data and the fixed-phrase
 * cases fail: an archived row stayed archived at its old count, an older
 * count landed over a newer one, a hung bell write held the import and every
 * later one for that till, the push's data carried the till's text, and a
 * database's own words reached the caller.
 *
 * Then, after the founder's answer "Count each check once (Recommended)"
 * (2026-10-05, ~19:10Z): run against c84faf084's `refused-checks-note.ts`,
 * the cases under "a check sent again is counted once" fail: a re-sent check
 * was counted, and named, again, the note kept no keys, and it never said
 * "at least". The seeded notes carry the keys this file computes itself
 * (`keyOf`, 16 hex of the SHA-256 of the id), so no case needs an export
 * the older file lacks.
 *
 * Then, after the founder's answers of 2026-10-05 (~21:05Z): "New note at
 * once (Recommended)" and "No, stays as it is (Recommended)" match the build,
 * and the cases "every recipient deleted it" and "the same three checks sent
 * again within the hour" pin them; "Respect their switch (Recommended)"
 * changed it. Run against d728b6e2b's `refused-checks-note.ts`, 34 of this
 * file's 69 cases fail (the controller's 20 pass). The 11 under "the
 * person's own push switch" fail. In six a person whose switch was off was
 * pushed and pinged like anyone else ((a), (d), the house with no zone,
 * every one off, through ingest(), and through the real funnel, where the
 * owner's phone was pushed with `push_enabled` false); the quiet-and-off
 * case fails on how its rows are grouped and counted. (b), (c) twice and
 * the no-row default pin behaviour that did not change, and fail there only
 * on the result's words. So do 23 earlier cases, none on what was pushed:
 * 20 because the result had no `pushSwitchedOff`, 2 because an unread read
 * was said differently, and 1 because a house with no zone read no one's
 * preferences.
 */
import { createHash } from "crypto";
import { Logger } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import {
  MAX_NOTE_CHECK_IDS,
  NOTE_DEADLINE_MS,
  REFUSED_CHECKS_NOTE_TYPE,
  fileRefusedChecksNote,
  refusedChecksNoteCopy,
  sayCheckId,
} from "./refused-checks-note";
import * as noteModule from "./refused-checks-note";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { AreaRoutingService } from "../areas/area-routing.service";
import { makeStubDb } from "../team/testing/supabase-stub";

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
  /** Answers the bell write; `undefined` falls through to the in-memory table. */
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
  /** Users whose own push switch is off (`push: false`); the rest have it on. */
  pushOff?: string[];
}

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

/** A check id's key as the note keeps it: 16 hex of the SHA-256 of the id. */
const keyOf = (id: string) =>
  createHash("sha256").update(id, "utf8").digest("hex").slice(0, 16);

/** A note's state fields, as this file writes them, for an exact count. */
const stateMeta = (refused: number, checkIds: string[]) => ({
  refused,
  atLeast: false,
  checkIds,
  checkKeys: checkIds.map(keyOf),
  checkIdsNotNamed: refused - checkIds.length,
  withoutId: 0,
});

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
      ...stateMeta(n, over.checkIds),
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
              if (opts.persist) {
                const answer = await opts.persist(restaurantId, payload, o);
                if (answer !== undefined) return answer;
              }
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
              // As `getPreferences` answers: `push` is always there, `true`
              // unless the person switched it off.
              return {
                userId,
                push: !opts.pushOff?.includes(userId),
                quietHours: opts.quiet?.[userId] ?? QUIET_OFF,
              };
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
  pushSwitchedOff: 0,
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
      // Archived rows too: "Bring it back (Recommended)".
      in: { status: ["unread", "read", "archived"] },
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
      pushSwitchedOff: 0,
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

  it("the hour runs from the note's first write, not its last update (the founder rejected a sliding hour)", async () => {
    // "One push per hour, re-flagged (Recommended)": one push per clock hour
    // from the first note; "Sliding hour" was the rejected option. Counting
    // into the note never moves its created_at, so a refusal 61 minutes after
    // the first write starts a new note and its push, although the note was
    // last counted into 11 minutes before.
    const first = new Date("2026-10-05T12:00:00Z");
    const at = (m: number) => new Date(first.getTime() + m * 60_000);
    const { calls, table, deps } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
        createdAt: first.toISOString(),
      }),
    });

    const counted = await fileRefusedChecksNote(deps, {
      restaurantId: HOUSE,
      providerKey: "csv_import",
      refused: [{ externalCheckId: "c-4", closedAt: "03.10.2026" }],
      now: at(50),
    });
    expect(counted.addedToOpenNote).toBe(true);
    expect(calls.noteUpdates.length).toBeGreaterThan(0);
    for (const u of calls.noteUpdates) {
      expect(u.patch).not.toHaveProperty("created_at");
    }
    for (const row of table) {
      expect(row.title).toBe("4 checks not imported: date not readable");
      expect(row.created_at).toBe(first.toISOString());
    }

    const later = await fileRefusedChecksNote(deps, {
      restaurantId: HOUSE,
      providerKey: "csv_import",
      refused: [{ externalCheckId: "c-5", closedAt: "03.10.2026" }],
      now: at(61),
    });
    expect(later).toEqual(filedNew());
    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].payload.title).toBe(
      "1 check not imported: date not readable",
    );
    expect(calls.persist[0].payload.priority).toBe("high");
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

  it("another till's note and another house's note are not open notes", async () => {
    const other = seededNote({
      refused: 2,
      checkIds: ["s-1", "s-2"],
      createdAt: minutesAgo(5),
      groupKey: `${REFUSED_CHECKS_NOTE_TYPE}:square`,
    }).map((r) => ({ ...r, id: `sq-${r.id}` }));
    const elsewhere = seededNote({
      refused: 2,
      checkIds: ["e-1", "e-2"],
      createdAt: minutesAgo(5),
    }).map((r) => ({ ...r, id: `el-${r.id}`, restaurant_id: OTHER_HOUSE }));
    const { service, calls } = makeService({
      notes: [...other, ...elsewhere],
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
        checkIds: ["c-1", "c-2", "c-3"],
        createdAt: minutesAgo(5),
      }),
      notesReadError: { message: "statement timeout" },
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.persist).toHaveLength(1);
    expect(res.bellNote).toEqual(
      filedNew({
        caveats: [
          "this till's open note could not be read, so a new note was written",
        ],
      }),
    );
    // The database's own words go to the log, never to the caller.
    expect(JSON.stringify(res.bellNote)).not.toContain("statement timeout");
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /POS_REFUSED_CHECKS_NOTE_FELL_BACK .*\(statement timeout\)/,
      ),
    );
  });

  it("an open note with no note id is not guessed at: a new note is written, and the result says so", async () => {
    const { service, calls } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
        createdAt: minutesAgo(5),
        noteId: null,
      }),
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);
    expect(calls.noteUpdates).toHaveLength(0);
    expect(calls.persist).toHaveLength(1);
    expect(res.bellNote.caveats).toEqual([
      "this till's open note could not be read (it carries no note id, count or check list), so a new note was written",
    ]);
  });

  it("an update that fails: a new note is written, and the result says so", async () => {
    const { service, calls } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
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
      "this till's open note could not be updated, so a new note was written",
    ]);
    expect(JSON.stringify(res.bellNote)).not.toContain("deadlock");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("(deadlock detected)"),
    );
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
            ...stateMeta(4, ["c-1", "c-2", "c-3", "p-1"]),
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
        checkIds: ["c-1", "c-2", "c-3"],
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
      metadata: { ...second.metadata, ...stateMeta(2, ["c-1", "c-2"]) },
    };
    const { service, calls, table } = makeService({ notes: [first, behind] });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.persist).toHaveLength(0);
    // The lead rows under the compare-and-set, then the row behind under its
    // own: only while it still holds the count that was read.
    expect(calls.noteUpdates.map((u) => [u.in, u.eq])).toEqual([
      [
        { id: ["seed-0"], status: ["unread", "read", "archived"] },
        { title: "3 checks not imported: date not readable" },
      ],
      [
        {
          id: ["seed-1"],
          title: ["2 checks not imported: date not readable"],
          status: ["unread", "read", "archived"],
        },
        {},
      ],
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

  it("a row behind that another process moves on before it is brought up is left at its newer count", async () => {
    const [first, second] = seededNote({
      refused: 3,
      checkIds: ["c-1", "c-2", "c-3"],
      createdAt: minutesAgo(5),
    });
    const behind = {
      ...second,
      title: "2 checks not imported: date not readable",
      metadata: { ...second.metadata, ...stateMeta(2, ["c-1", "c-2"]) },
    };
    let updates = 0;
    const { service, calls, table } = makeService({
      notes: [first, behind],
      // Between this import's two updates, another process counts three
      // refusals into the row behind, which now says 5.
      beforeUpdate: (_u, rows) => {
        if (++updates !== 2) return undefined;
        const row = rows.find((r) => r.id === "seed-1")!;
        row.title = "5 checks not imported: date not readable";
        row.metadata = { ...row.metadata, refused: 5 };
        return undefined;
      },
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.noteUpdates).toHaveLength(2);
    // The lead row took the new count; the row behind kept the newer one,
    // never an older count over a newer one.
    expect(table.find((r) => r.id === "seed-0")!.title).toBe(
      "4 checks not imported: date not readable",
    );
    expect(table.find((r) => r.id === "seed-1")!.title).toBe(
      "5 checks not imported: date not readable",
    );
    expect(res.bellNote).toMatchObject({
      addedToOpenNote: true,
      recipients: 1,
    });
  });

  it("a row of the note whose count does not read is not brought up", async () => {
    const [first, second] = seededNote({
      refused: 3,
      checkIds: ["c-1", "c-2", "c-3"],
      createdAt: minutesAgo(5),
    });
    const unreadable = {
      ...second,
      title: "something else",
      metadata: { noteId: "note-seed" },
    };
    const { service, calls, table } = makeService({
      notes: [first, unreadable],
    });
    await ingest(service, [check("c-4", "03.10.2026")]);
    expect(calls.noteUpdates).toHaveLength(1);
    expect(table.find((r) => r.id === "seed-1")!.title).toBe("something else");
  });
});

describe('a check sent again is counted once: "Count each check once (Recommended)"', () => {
  // The founder (2026-10-05): "The note counts distinct checks in its hour:
  // re-running a CSV with 3 bad checks still reads '3 checks not imported',
  // not 6. Past a cap it says 'at least'."
  const KEPT = 500;
  const ids = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
  const refusedOf = (list: string[]) =>
    list.map((externalCheckId) => ({
      externalCheckId,
      closedAt: "03.10.2026",
    }));
  const named = (message: string, id: string) =>
    message.split(/[\s,.:]+/).filter((w) => w === id).length;

  it("the same three checks sent again within the hour leave the note at 3, not 6, and name each once", async () => {
    // And it does not turn unread: the founder, asked whether a re-send that
    // leaves the count unchanged re-flags the note (2026-10-05, ~21:05Z):
    // "No, stays as it is (Recommended)".
    const { service, calls, table } = makeService();
    const first = await ingest(service, [
      check("c-1", "03.10.2026"),
      check("c-2", "03.10.2026"),
      check("c-3", "03.10.2026"),
    ]);
    expect(first.bellNote).toEqual(filedNew());
    // One reader read it, the other archived it.
    table[0].status = "read";
    table[0].read_at = minutesAgo(1);
    table[1].status = "archived";
    table[1].archived_at = minutesAgo(1);
    const before = structuredClone(table);

    // The same CSV run again, one row twice.
    const again = await ingest(service, [
      check("c-1", "03.10.2026"),
      check("c-2", "03.10.2026"),
      check("c-3", "03.10.2026"),
      check("c-1", "03.10.2026"),
    ]);

    // The import still says what it refused; the note counts checks.
    expect(again.refusedUnreadableDate).toBe(4);
    expect(calls.persist).toHaveLength(1);
    // Nothing the note had not counted, so nothing is written: no row turns
    // unread, none comes back from the archive.
    expect(calls.noteUpdates).toHaveLength(0);
    expect(table).toEqual(before);
    for (const row of table) {
      expect(row.title).toBe("3 checks not imported: date not readable");
      expect(row.message).toContain("Checks: c-1, c-2, c-3. ");
      for (const id of ["c-1", "c-2", "c-3"]) {
        expect(named(row.message, id)).toBe(1);
      }
      expect(row.metadata).toMatchObject({
        refused: 3,
        atLeast: false,
        checkIds: ["c-1", "c-2", "c-3"],
        checkKeys: ["c-1", "c-2", "c-3"].map(keyOf),
        withoutId: 0,
        imports: 1,
      });
    }
    expect(table.map((r) => r.status)).toEqual(["read", "archived"]);
    expect(again.bellNote).toEqual(
      filedNew({ addedToOpenNote: true, recipients: 0 }),
    );
  });

  it("a check named twice in one import is one check", async () => {
    const { service, calls } = makeService();
    await ingest(service, [
      check("c-1", "03.10.2026"),
      check("c-1", "03.10.2026"),
      check("c-2", "03.10.2026"),
    ]);
    const { payload } = calls.persist[0];
    expect(payload.title).toBe("2 checks not imported: date not readable");
    expect(payload.message).toContain("Checks: c-1, c-2. ");
    expect(named(payload.message, "c-1")).toBe(1);
    expect(payload.metadata).toMatchObject({
      refused: 2,
      checkIds: ["c-1", "c-2"],
      checkKeys: [keyOf("c-1"), keyOf("c-2")],
    });
  });

  it("a re-send with two new ids and one old moves the count from 3 to 5, and the note grows as news", async () => {
    const { service, calls, table } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
        createdAt: minutesAgo(20),
      }),
    });
    const res = await ingest(service, [
      check("c-4", "03.10.2026"),
      check("c-2", "03.10.2026"),
      check("c-5", "03.10.2026"),
    ]);

    expect(calls.persist).toHaveLength(0);
    expect(table).toHaveLength(2);
    for (const row of table) {
      expect(row.title).toBe("5 checks not imported: date not readable");
      expect(row.message).toContain("Checks: c-1, c-2, c-3, c-4, c-5. ");
      for (const id of ["c-1", "c-2", "c-3", "c-4", "c-5"]) {
        expect(named(row.message, id)).toBe(1);
      }
      expect(row.metadata).toMatchObject({
        refused: 5,
        atLeast: false,
        checkIds: ["c-1", "c-2", "c-3", "c-4", "c-5"],
        checkKeys: ["c-1", "c-2", "c-3", "c-4", "c-5"].map(keyOf),
        checkIdsNotNamed: 0,
        imports: 2,
      });
      expect(row.status).toBe("unread");
    }
    expect(res.bellNote).toEqual(
      filedNew({ addedToOpenNote: true, recipients: 2 }),
    );
  });

  it("past the ids it keeps, the note says 'at least' with the count it can prove", async () => {
    const { calls, table, deps } = makeService();
    const file = (list: string[]) =>
      fileRefusedChecksNote(deps, {
        restaurantId: HOUSE,
        providerKey: "csv_import",
        refused: refusedOf(list),
      });
    const k = ids("k", KEPT + 3);

    // 503 distinct checks, two of them sent twice: counted exactly.
    expect(await file([...k, "k-0", "k-1"])).toEqual(filedNew());
    for (const row of table) {
      expect(row.title).toBe("503 checks not imported: date not readable");
      expect(row.message).toContain(
        `Checks: ${k.slice(0, MAX_NOTE_CHECK_IDS).join(", ")}, and 493 more. `,
      );
      expect(row.message).not.toContain("At least");
      expect(row.metadata).toMatchObject({ refused: 503, atLeast: false });
    }

    // The same 503 again: the three past the kept ids may be checks it
    // counted, or new ones, so the count is a floor: at least 503.
    expect(await file(k)).toEqual(
      filedNew({ addedToOpenNote: true, recipients: 2 }),
    );
    for (const row of table) {
      expect(row.title).toBe(
        "At least 503 checks not imported: date not readable",
      );
      expect(row.message).toContain("At least 503 checks from CSV");
      expect(row.message).toContain(", and at least 493 more. ");
      expect(row.message).toContain(
        `This note keeps the first ${KEPT} check ids, so past those a check sent again cannot be told from a new one. `,
      );
      expect(row.metadata).toMatchObject({
        refused: 503,
        atLeast: true,
        checkIdsNotNamed: 493,
      });
      expect(row.status).toBe("unread");
    }

    // Ten ids it never kept: at least the 500 kept and these 10.
    await file(ids("n", 10));
    for (const row of table) {
      expect(row.title).toBe(
        "At least 510 checks not imported: date not readable",
      );
      expect(row.metadata).toMatchObject({ refused: 510, atLeast: true });
    }

    // Only ids it keeps: it learns nothing, so nothing is written.
    const updates = calls.noteUpdates.length;
    expect(await file(k.slice(0, 20))).toEqual(
      filedNew({ addedToOpenNote: true, recipients: 0 }),
    );
    expect(calls.noteUpdates).toHaveLength(updates);
    for (const row of table) {
      expect(row.title).toBe(
        "At least 510 checks not imported: date not readable",
      );
    }
    expect(calls.persist).toHaveLength(1);
  });

  it("the ids kept never pass the bound, across imports, and a count it can prove stays exact past it", async () => {
    const { calls, table, deps } = makeService();
    const file = (list: string[]) =>
      fileRefusedChecksNote(deps, {
        restaurantId: HOUSE,
        providerKey: "csv_import",
        refused: refusedOf(list),
      });
    const a = ids("a", 300);
    const b = ids("b", 300);
    await file(a);
    // 300 more, every one new to a note that keeps all it counted: 600, exact.
    await file(b);
    for (const row of table) {
      expect(row.title).toBe("600 checks not imported: date not readable");
      expect(row.metadata.atLeast).toBe(false);
      expect(row.metadata.checkKeys).toHaveLength(KEPT);
      expect(row.metadata.checkKeys).toEqual(
        [...a, ...b].slice(0, KEPT).map(keyOf),
      );
      expect(row.metadata.checkIds).toEqual(a.slice(0, MAX_NOTE_CHECK_IDS));
    }
    // The 100 it counted but did not keep, sent again: at least 600.
    await file(b.slice(200));
    for (const row of table) {
      expect(row.title).toBe(
        "At least 600 checks not imported: date not readable",
      );
      expect(row.metadata.checkKeys).toHaveLength(KEPT);
    }
    expect(calls.persist).toHaveLength(1);
    // Every row the funnel or an update wrote holds at most the bound.
    for (const p of calls.persist) {
      expect(p.payload.metadata.checkKeys.length).toBeLessThanOrEqual(KEPT);
    }
    for (const u of calls.noteUpdates) {
      expect(u.patch.metadata.checkKeys.length).toBeLessThanOrEqual(KEPT);
      expect(u.patch.metadata.checkIds.length).toBeLessThanOrEqual(
        MAX_NOTE_CHECK_IDS,
      );
    }
    expect((noteModule as Record<string, unknown>).MAX_NOTE_KEPT_CHECKS).toBe(
      KEPT,
    );
  });

  it("a check with no id is never merged with another: each is counted every time it is sent, and the note says so", async () => {
    const { table, deps } = makeService();
    const file = (refused: Array<{ externalCheckId: unknown }>) =>
      fileRefusedChecksNote(deps, {
        restaurantId: HOUSE,
        providerKey: "csv_import",
        refused: refused.map((r) => ({ ...r, closedAt: "03.10.2026" })),
      });
    const sent = [
      { externalCheckId: "" },
      { externalCheckId: "  " },
      { externalCheckId: "c-1" },
    ];
    await file(sent);
    for (const row of table) {
      expect(row.title).toBe("3 checks not imported: date not readable");
      expect(row.message).toContain("Checks: c-1. ");
      expect(row.message).not.toContain("(no id)");
      expect(row.message).toContain(
        "2 of them came with no check id, so each is counted every time it is sent. ",
      );
      expect(row.metadata).toMatchObject({
        refused: 3,
        checkIds: ["c-1"],
        checkKeys: [keyOf("c-1")],
        withoutId: 2,
      });
    }
    // Sent again: c-1 is known, the two with no id are counted again.
    await file(sent);
    for (const row of table) {
      expect(row.title).toBe("5 checks not imported: date not readable");
      expect(row.message).toContain("Checks: c-1. ");
      expect(row.message).toContain(
        "4 of them came with no check id, so each is counted every time it is sent. ",
      );
      expect(row.metadata).toMatchObject({ refused: 5, withoutId: 4 });
    }
  });

  it("one check with no id: no ids named, and it says it is counted every time", async () => {
    const { calls, deps } = makeService();
    await fileRefusedChecksNote(deps, {
      restaurantId: HOUSE,
      providerKey: "csv_import",
      refused: [{ externalCheckId: null, closedAt: "03.10.2026" }],
    });
    const { payload } = calls.persist[0];
    expect(payload.title).toBe("1 check not imported: date not readable");
    expect(payload.message).not.toContain("Check:");
    expect(payload.message).toContain(
      "It came with no check id, so it is counted every time it is sent. ",
    );
  });

  it("a note written before checks were kept is not guessed at: a new note is written, and the result says so", async () => {
    const old = seededNote({
      refused: 3,
      checkIds: ["c-1", "c-2", "c-3"],
      createdAt: minutesAgo(10),
    }).map((r) => {
      // As c84faf084 wrote it: no kept keys, no "at least", no id-less count.
      const metadata = { ...r.metadata };
      delete metadata.checkKeys;
      delete metadata.atLeast;
      delete metadata.withoutId;
      return { ...r, metadata };
    });
    const { service, calls } = makeService({ notes: old });
    const res = await ingest(service, [check("c-1", "03.10.2026")]);
    expect(calls.noteUpdates).toHaveLength(0);
    expect(calls.persist).toHaveLength(1);
    expect(res.bellNote.caveats).toEqual([
      "this till's open note could not be read (it carries no note id, count or check list), so a new note was written",
    ]);
  });

  it("an import that adds no check brings a row behind up to the note as it was, without counting itself in", async () => {
    // The lead row has been counted into once already (2 imports); the row
    // behind was written before that and still says 2.
    const [first, second] = seededNote({
      refused: 3,
      checkIds: ["c-1", "c-2", "c-3"],
      createdAt: minutesAgo(5),
    });
    const lead = {
      ...first,
      metadata: { ...first.metadata, imports: 2, lastAddedAt: minutesAgo(3) },
    };
    const behind = {
      ...second,
      status: "read",
      read_at: minutesAgo(2),
      title: "2 checks not imported: date not readable",
      metadata: {
        ...second.metadata,
        ...stateMeta(2, ["c-1", "c-2"]),
        imports: 1,
      },
    };
    const { service, calls, table } = makeService({ notes: [lead, behind] });
    const leadBefore = structuredClone(table.find((r) => r.id === "seed-0"));

    // Checks the note already counts: it does not grow.
    const res = await ingest(service, [
      check("c-1", "03.10.2026"),
      check("c-3", "03.10.2026"),
    ]);

    expect(calls.persist).toHaveLength(0);
    // Only the row behind is written; the lead rows are left as they were.
    expect(calls.noteUpdates).toHaveLength(1);
    expect(calls.noteUpdates[0].in.id).toEqual(["seed-1"]);
    expect(table.find((r) => r.id === "seed-0")).toEqual(leadBefore);
    // The row behind now says what the lead says, word for word and field
    // for field: this import is not counted as one that changed the note
    // (`imports` stays 2, `lastAddedAt` is not stamped again).
    const caught = table.find((r) => r.id === "seed-1")!;
    expect(caught.title).toBe("3 checks not imported: date not readable");
    expect(caught.metadata).toEqual(leadBefore!.metadata);
    expect(caught.metadata.imports).toBe(2);
    // Its reader had seen 2; 3 is news to them, so the row is unread again.
    expect(caught.status).toBe("unread");
    expect(res.bellNote).toEqual(
      filedNew({ addedToOpenNote: true, recipients: 1 }),
    );
  });
});

describe('an archived row is brought back: "Bring it back (Recommended)"', () => {
  it("a note archived by every recipient, counted into within its hour, returns to every bell as unread with the new count", async () => {
    const { service, calls, table } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
        createdAt: minutesAgo(20),
        status: "archived",
      }).map((r) => ({ ...r, archived_at: minutesAgo(10) })),
    });
    const res = await ingest(service, [
      check("c-4", "03.10.2026"),
      check("c-5", "03.10.2026"),
      check("c-6", "03.10.2026"),
      check("c-7", "03.10.2026"),
      check("c-8", "03.10.2026"),
      check("c-9", "03.10.2026"),
    ]);

    // Counted into the note: no new row, so no second push.
    expect(calls.persist).toHaveLength(0);
    expect(table).toHaveLength(2);
    for (const row of table) {
      expect(row.title).toBe("9 checks not imported: date not readable");
      expect(row.status).toBe("unread");
      expect(row.read_at).toBeNull();
      expect(row.archived_at).toBeNull();
      expect(row.metadata.refused).toBe(9);
    }
    expect(res.bellNote).toEqual(
      filedNew({ addedToOpenNote: true, recipients: 2 }),
    );
  });

  it("one recipient archived it and the other read it: both rows take the new count and are unread", async () => {
    const [owner, manager] = seededNote({
      refused: 3,
      checkIds: ["c-1", "c-2", "c-3"],
      createdAt: minutesAgo(20),
    });
    const { service, calls, table } = makeService({
      notes: [
        { ...owner, status: "archived", archived_at: minutesAgo(10) },
        { ...manager, status: "read", read_at: minutesAgo(15) },
      ],
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.persist).toHaveLength(0);
    expect(calls.noteUpdates).toHaveLength(1);
    expect([...calls.noteUpdates[0].in.id].sort()).toEqual([
      "seed-0",
      "seed-1",
    ]);
    for (const row of table) {
      expect(row.title).toBe("4 checks not imported: date not readable");
      expect(row.status).toBe("unread");
      expect(row.archived_at).toBeNull();
    }
    expect(res.bellNote.recipients).toBe(2);
  });

  it("an archived note past its hour is left archived, and a new note is written and pushed", async () => {
    const { service, calls, table } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
        createdAt: minutesAgo(61),
        status: "archived",
      }),
    });
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.noteUpdates).toHaveLength(0);
    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].payload.priority).toBe("high");
    expect(
      table.filter((r) => r.id.startsWith("seed-")).map((r) => r.status),
    ).toEqual(["archived", "archived"]);
    expect(res.bellNote).toEqual(filedNew());
  });

  it("a row in a status outside unread, read and archived is neither read nor brought back", async () => {
    const { service, calls, table } = makeService({
      notes: seededNote({
        refused: 3,
        checkIds: ["c-1", "c-2", "c-3"],
        createdAt: minutesAgo(5),
        status: "dismissed",
      }),
    });
    await ingest(service, [check("c-4", "03.10.2026")]);
    expect(calls.noteUpdates).toHaveLength(0);
    expect(calls.persist).toHaveLength(1);
    expect(
      table.filter((r) => r.id.startsWith("seed-")).map((r) => r.status),
    ).toEqual(["dismissed", "dismissed"]);
  });
});

describe("a row deleted from the bell", () => {
  // Deleting removes the row (`NotificationsService.deleteNotification`,
  // `deleteBulk`, `deleteAllRead`), so here a delete is the row leaving the
  // in-memory table.
  const deleteRowOf = (table: Row[], userId: string) => {
    const at = table.findIndex((r) => r.user_id === userId);
    expect(at).toBeGreaterThanOrEqual(0);
    table.splice(at, 1);
  };

  it('one recipient deleted it, another still holds it: it stays deleted, and the other row takes the new count ("Stays deleted (Recommended)")', async () => {
    const { service, calls, table } = makeService();
    await ingest(service, [
      check("c-1", "03.10.2026"),
      check("c-2", "03.10.2026"),
      check("c-3", "03.10.2026"),
    ]);
    expect(calls.persist).toHaveLength(1);
    deleteRowOf(table, "u-owner");

    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    // Counted into the note through the row still held: nothing written for
    // the owner who deleted it, and nothing pushed to anyone.
    expect(calls.persist).toHaveLength(1);
    expect(table.map((r) => r.user_id)).toEqual(["u-manager"]);
    expect(table[0].title).toBe("4 checks not imported: date not readable");
    expect(res.bellNote).toEqual(
      filedNew({ addedToOpenNote: true, recipients: 1 }),
    );
  });

  it('every recipient deleted it: nothing is left to find, so the next refusal inside the hour writes a new note and pushes it to all of them ("New note at once (Recommended)")', async () => {
    // Fork 2's option text said "The next hour's note still reaches them";
    // when no row of the note is left, the next note comes at once. The
    // founder, asked about exactly this case (2026-10-05, ~21:05Z): "New
    // note at once (Recommended)", "including whoever deleted the old one".
    const { service, calls, table } = makeService();
    await ingest(service, [
      check("c-1", "03.10.2026"),
      check("c-2", "03.10.2026"),
      check("c-3", "03.10.2026"),
    ]);
    const firstNoteId = calls.persist[0].payload.metadata.noteId;
    deleteRowOf(table, "u-owner");
    deleteRowOf(table, "u-manager");
    expect(table).toHaveLength(0);

    // Minutes later, inside the first note's hour.
    const res = await ingest(service, [check("c-4", "03.10.2026")]);

    expect(calls.noteUpdates).toHaveLength(0);
    expect(calls.persist).toHaveLength(2);
    const { payload, opts } = calls.persist[1];
    // A new note, with only this import's check: not the deleted note back.
    expect(payload.metadata.noteId).not.toBe(firstNoteId);
    expect(payload.title).toBe("1 check not imported: date not readable");
    expect(payload.message).toContain("Check: c-4.");
    expect(payload.message).not.toContain("c-1");
    // Pushed, to those who deleted the first note too.
    expect(payload.priority).toBe("high");
    expect(opts.broadcast).toBe(true);
    expect([...opts.onlyUserIds].sort()).toEqual(["u-manager", "u-owner"]);
    expect(res.bellNote).toEqual(filedNew());
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
    // The push's data is the note's id and count, never the till's text.
    const pushData = { noteId: pushed.payload.metadata.noteId, refused: 1 };
    expect(pushed.opts).toEqual({
      onlyUserIds: ["u-manager"],
      broadcast: true,
      pushData,
    });
    expect(pushed.payload.priority).toBe("high");
    // "low" is the funnel's no-push priority; no broadcast, no live ping.
    expect(quiet.opts).toEqual({
      onlyUserIds: ["u-owner"],
      broadcast: false,
      pushData,
    });
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
    expect(
      calls.persist.map((p) => [p.opts.onlyUserIds, p.opts.broadcast]),
    ).toEqual([
      [["u-manager"], true],
      [["u-owner"], false],
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
    // Preferences are still read, for each person's push switch.
    expect(calls.prefs).toHaveLength(2);
    expect(res.caveats).toEqual([
      "the house has no time zone on record, so every recipient whose push is on was pushed",
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
      "the house's time zone could not be read, so every recipient whose push is on was pushed",
    ]);
    expect(JSON.stringify(res)).not.toContain("connection reset");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("(connection reset)"),
    );
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
      "the notification settings of 1 recipient could not be read, so that person was pushed",
    ]);
    expect(JSON.stringify(res)).not.toContain("timed out");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("preferences timed out"),
    );
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

describe('the person\'s own push switch: "Respect their switch (Recommended)"', () => {
  // The founder (2026-10-05, ~21:05Z), asked "An owner or manager switched
  // push off in their settings. Should this till-refusal note still push to
  // their phone?": "Respect their switch (Recommended)", "they get the note
  // in their bell only, no phone push, like quiet hours". A preferences read
  // that fails still pushes (fork 1, "Push anyway (Recommended)").
  // 12:00 UTC is 15:00 in Istanbul, outside a 22:00-08:00 window; 00:30 UTC
  // is 03:30 there, inside it.
  const NOON_UTC = new Date("2026-10-05T12:00:00Z");
  const NIGHT_IN_ISTANBUL = new Date("2026-10-05T00:30:00Z");
  const OWNER_ONLY = ACCESS.filter((r) => r.user_id === "u-owner");
  const file = (deps: any, now?: Date) =>
    fileRefusedChecksNote(deps, {
      restaurantId: HOUSE,
      providerKey: "csv_import",
      refused: [{ externalCheckId: "c-1", closedAt: "03.10.2026" }],
      now,
    });

  it("(a) switch off, outside quiet hours: the row is written, with no push and no live ping", async () => {
    const { deps, calls, table } = makeService({
      access: OWNER_ONLY,
      pushOff: ["u-owner"],
    });
    const res = await file(deps, NOON_UTC);

    expect(calls.persist).toHaveLength(1);
    const { payload, opts } = calls.persist[0];
    expect(opts.onlyUserIds).toEqual(["u-owner"]);
    // "low" is the funnel's no-push priority; no broadcast, no live ping.
    expect(payload.priority).toBe("low");
    expect(opts.broadcast).toBe(false);
    expect(table.map((r) => [r.user_id, r.status])).toEqual([
      ["u-owner", "unread"],
    ]);
    expect(res).toEqual(filedNew({ recipients: 1, pushSwitchedOff: 1 }));
  });

  it("(b) switch on: pushed as before", async () => {
    const { deps, calls } = makeService({ access: OWNER_ONLY });
    const res = await file(deps, NOON_UTC);
    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].payload.priority).toBe("high");
    expect(calls.persist[0].opts.broadcast).toBe(true);
    expect(res).toEqual(filedNew({ recipients: 1, pushSwitchedOff: 0 }));
  });

  it("(c) preferences that cannot be read: pushed, as fork 1 answered, and said", async () => {
    const { deps, calls } = makeService({
      access: OWNER_ONLY,
      prefsFail: ["u-owner"],
    });
    const res = await file(deps, NOON_UTC);
    expect(calls.persist).toHaveLength(1);
    expect(calls.persist[0].payload.priority).toBe("high");
    expect(calls.persist[0].opts.broadcast).toBe(true);
    expect(res).toEqual(
      filedNew({
        recipients: 1,
        pushSwitchedOff: 0,
        caveats: [
          "the notification settings of 1 recipient could not be read, so that person was pushed",
        ],
      }),
    );
  });

  it("(d) a two-recipient house, one with push off and one on: only the second is pushed; one note", async () => {
    const { deps, calls, table } = makeService({ pushOff: ["u-owner"] });
    const res = await file(deps, NOON_UTC);

    expect(calls.persist).toHaveLength(2);
    const [pushed, off] = calls.persist;
    expect(pushed.opts.onlyUserIds).toEqual(["u-manager"]);
    expect(pushed.opts.broadcast).toBe(true);
    expect(pushed.payload.priority).toBe("high");
    expect(off.opts.onlyUserIds).toEqual(["u-owner"]);
    expect(off.opts.broadcast).toBe(false);
    expect(off.payload.priority).toBe("low");
    // One note: the same words and the same note id on both rows.
    expect(off.payload.title).toBe(pushed.payload.title);
    expect(off.payload.metadata).toEqual(pushed.payload.metadata);
    expect(table).toHaveLength(2);
    expect(res).toEqual(filedNew({ pushSwitchedOff: 1 }));
  });

  it("a switch that is off holds in a house whose zone is not known, where quiet hours cannot be judged", async () => {
    const { deps, calls } = makeService({
      pushOff: ["u-owner"],
      house: { timezone: null, country: "US" },
    });
    const res = await file(deps, NOON_UTC);
    expect(
      calls.persist.map((p) => [p.opts.onlyUserIds, p.opts.broadcast]),
    ).toEqual([
      [["u-manager"], true],
      [["u-owner"], false],
    ]);
    expect(res.pushSwitchedOff).toBe(1);
    expect(res.caveats).toEqual([
      "the house has no time zone on record, so every recipient whose push is on was pushed",
    ]);
  });

  it("switch off and inside quiet hours: counted once, as switched off", async () => {
    const { deps, calls } = makeService({
      pushOff: ["u-owner"],
      quiet: { "u-owner": QUIET_NIGHT, "u-manager": QUIET_NIGHT },
    });
    const res = await file(deps, NIGHT_IN_ISTANBUL);
    expect(
      calls.persist.map((p) => [p.opts.onlyUserIds, p.payload.priority]),
    ).toEqual([
      [["u-manager"], "low"],
      [["u-owner"], "low"],
    ]);
    expect(res).toEqual(filedNew({ quietHours: 1, pushSwitchedOff: 1 }));
  });

  it("every recipient with push off: one write, nothing pushed, and it is filed", async () => {
    const { deps, calls } = makeService({
      pushOff: ["u-owner", "u-manager"],
    });
    const res = await file(deps, NOON_UTC);
    expect(calls.persist).toHaveLength(1);
    expect([...calls.persist[0].opts.onlyUserIds].sort()).toEqual([
      "u-manager",
      "u-owner",
    ]);
    expect(calls.persist[0].opts.broadcast).toBe(false);
    expect(res).toEqual(filedNew({ pushSwitchedOff: 2 }));
  });

  it("through ingest(): the manager's switch is off, so the owner alone is pushed", async () => {
    const { service, calls } = makeService({ pushOff: ["u-manager"] });
    const res = await ingest(service, [check("c-1", "03.10.2026")]);
    expect(
      calls.persist.map((p) => [p.opts.onlyUserIds, p.opts.broadcast]),
    ).toEqual([
      [["u-owner"], true],
      [["u-manager"], false],
    ]);
    expect(res.bellNote.pushSwitchedOff).toBe(1);
  });

  describe("through the real funnel and the real preferences read", () => {
    const prefsRow = (user_id: string, push_enabled: boolean | null) => ({
      id: `pref-${user_id}`,
      restaurant_id: HOUSE,
      user_id,
      push_enabled,
      quiet_hours_enabled: false,
    });
    const fileReal = (f: ReturnType<typeof realFunnel>) =>
      fileRefusedChecksNote(
        {
          client: f.db.supabase,
          notifications: f.notifications,
          logger: new Logger("spec"),
        },
        {
          restaurantId: HOUSE,
          providerKey: "csv_import",
          refused: [{ externalCheckId: "c-1", closedAt: "03.10.2026" }],
        },
      );

    it("(d) push_enabled false for the owner: both rows land, only the manager's phone is pushed and only the manager is pinged", async () => {
      const f = realFunnel({
        preferences: [prefsRow("u-owner", false), prefsRow("u-manager", true)],
      });
      const res = await fileReal(f);
      // What reaches a phone and an open page first, then the count.
      expect(f.pushes.map((p) => p.ids)).toEqual([["u-manager"]]);
      expect(f.pings).toEqual(["user:u-manager"]);
      expect(res).toEqual(filedNew({ pushSwitchedOff: 1 }));
      expect(
        f.db.tables.notifications
          .map((r: Row) => [r.user_id, r.priority])
          .sort(),
      ).toEqual([
        ["u-manager", "high"],
        ["u-owner", "low"],
      ]);
    });

    it("no preferences row, or push_enabled not set: pushed (the defaults getPreferences gives)", async () => {
      // u-owner has no row; u-manager's row never set push_enabled.
      const f = realFunnel({ preferences: [prefsRow("u-manager", null)] });
      const res = await fileReal(f);
      expect(res).toEqual(filedNew({ pushSwitchedOff: 0 }));
      expect(f.pushes.map((p) => [...p.ids].sort())).toEqual([
        ["u-manager", "u-owner"],
      ]);
      expect([...f.pings].sort()).toEqual(["user:u-manager", "user:u-owner"]);
    });

    it("(c) a preferences read that fails: pushed, whatever the row says, and said", async () => {
      const f = realFunnel({
        preferences: [prefsRow("u-owner", false), prefsRow("u-manager", false)],
        errors: {
          "notification_preferences:select": { message: "statement timeout" },
        },
      });
      const res = await fileReal(f);
      expect(res).toEqual(
        filedNew({
          pushSwitchedOff: 0,
          caveats: [
            "the notification settings of 2 recipients could not be read, so they were pushed",
          ],
        }),
      );
      expect(f.pushes.map((p) => [...p.ids].sort())).toEqual([
        ["u-manager", "u-owner"],
      ]);
      expect(JSON.stringify(res)).not.toContain("statement timeout");
    });
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
      pushSwitchedOff: 0,
      notFiledBecause: "the bell write failed",
      caveats: [],
    });
    // The error's own words are logged, never returned.
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /POS_REFUSED_CHECKS_NOTE_NOT_FILED .*\(socket closed\)/,
      ),
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
      notFiledBecause: "this house's owners and managers could not be read",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("(timeout)"));
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

describe("the import answers on time when the bell does not", () => {
  const never = () => new Promise<never>(() => undefined);
  /** `p`'s answer, or "no answer" after `ms`: a hang fails here, never stalls. */
  const within = <T>(p: Promise<T>, ms: number) =>
    Promise.race([
      p,
      new Promise<"no answer">((resolve) =>
        setTimeout(() => resolve("no answer"), ms),
      ),
    ]);
  const refused = (id: string) => [{ externalCheckId: id, closedAt: "x" }];

  it("a bell write that never answers: the note answers by its deadline, says so, and logs it", async () => {
    const { deps } = makeService({ persist: never });
    const res = await within(
      fileRefusedChecksNote(
        { ...deps, deadlineMs: 50 },
        {
          restaurantId: HOUSE,
          providerKey: "hung_till_a",
          refused: refused("c-1"),
        },
      ),
      1_000,
    );
    expect(res).toEqual({
      filed: false,
      addedToOpenNote: false,
      recipients: 0,
      heldAway: 0,
      quietHours: 0,
      pushSwitchedOff: 0,
      notFiledBecause:
        "the bell did not answer within 0.05 s; the note may still arrive",
      caveats: [],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("POS_REFUSED_CHECKS_NOTE_LATE"),
    );
  });

  it("one filing that never answers does not hold the next one for the same house and till", async () => {
    let hang = true;
    const { deps, table } = makeService({
      persist: async () => (hang ? never() : undefined),
    });
    const input = { restaurantId: HOUSE, providerKey: "hung_till_b" };
    // The first filing's bell write never answers.
    const first = fileRefusedChecksNote(
      { ...deps, deadlineMs: 50 },
      { ...input, refused: refused("c-1") },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The next import for the same house and till still reaches the bell.
    hang = false;
    const second = await within(
      fileRefusedChecksNote(
        { ...deps, deadlineMs: 2_000 },
        { ...input, refused: refused("c-2") },
      ),
      3_000,
    );
    expect(second).toEqual(filedNew());
    expect(table.map((r) => r.metadata.checkIds)).toEqual([["c-2"], ["c-2"]]);
    expect(await within(first, 1_000)).toMatchObject({ filed: false });
  }, 10_000);

  it("through ingest(): a bell that never answers holds the import for NOTE_DEADLINE_MS at most, and the import's own result stands", async () => {
    jest.useFakeTimers();
    try {
      const { service, calls } = makeService({
        persist: never,
        access: [
          {
            restaurant_id: "r-hung",
            user_id: "u-owner",
            role: "owner",
            is_active: true,
          },
        ],
      });
      let res: any = null;
      void service
        .ingest("r-hung", "csv_import", [
          check("c-ok", "2026-10-03 21:00:00Z"),
          check("c-bad", "03.10.2026"),
        ])
        .then((r) => (res = r));

      await jest.advanceTimersByTimeAsync(NOTE_DEADLINE_MS - 1);
      expect(calls.persist).toHaveLength(1);
      expect(res).toBeNull();

      await jest.advanceTimersByTimeAsync(1);
      expect(res).not.toBeNull();
      expect(res.upserted).toBe(1);
      expect(res.refusedUnreadableDate).toBe(1);
      expect(res.bellNote).toMatchObject({
        filed: false,
        notFiledBecause:
          "the bell did not answer within 3 s; the note may still arrive",
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * The real notification funnel over an in-memory database: its phone pushes
 * and its live pings are recorded. `preferences` are `notification_preferences`
 * rows; `errors` forces a table's read to fail (`"<table>:select"`).
 */
function realFunnel(
  over: {
    preferences?: Row[];
    errors?: Record<string, { message: string }>;
  } = {},
) {
  const db = makeStubDb(
    {
      restaurants: [{ id: HOUSE, timezone: "UTC", country: null }],
      user_restaurant_access: ACCESS.map((r) => ({ ...r })),
      notifications: [],
      notification_preferences: (over.preferences ?? []).map((r) => ({
        ...r,
      })),
    },
    over.errors ?? {},
  );
  const pushes: Array<{ ids: string[]; message: Row }> = [];
  const pings: string[] = [];
  const database = {
    supabase: db.supabase,
    client: db.supabase,
    getClient: () => db.supabase,
    getRestaurantMemberIds: async (rid: string) =>
      ACCESS.filter((r) => r.restaurant_id === rid && r.is_active).map(
        (r) => r.user_id,
      ),
  };
  const notifications = new NotificationsService(
    {
      server: {
        to: (rooms: string | string[]) => ({
          emit: () => void pings.push(...([] as string[]).concat(rooms)),
        }),
      },
    } as never,
    { get: () => undefined } as never,
    database as never,
    undefined,
    {
      sendToUsers: async (ids: string[], message: Row) =>
        void pushes.push({ ids, message }),
    } as never,
  );
  return { db, notifications, pushes, pings };
}

describe("the phone push carries the note's id and count, never the till's text", () => {
  it("the push's data is the type, the link, the note's id and its count; the bell rows keep the ids and the value", async () => {
    const { db, notifications, pushes } = realFunnel();
    const res = await fileRefusedChecksNote(
      { client: db.supabase, notifications, logger: new Logger("spec") },
      {
        restaurantId: HOUSE,
        providerKey: "csv_import",
        refused: [
          { externalCheckId: "c-till-1", closedAt: "03.10.2026" },
          { externalCheckId: "c-till-2", closedAt: "call 0555" },
        ],
      },
    );

    expect(res.filed).toBe(true);
    expect(pushes).toHaveLength(1);
    expect([...pushes[0].ids].sort()).toEqual(["u-manager", "u-owner"]);
    const rows = db.tables.notifications;
    expect(rows).toHaveLength(2);
    expect(pushes[0].message.data).toEqual({
      type: REFUSED_CHECKS_NOTE_TYPE,
      actionUrl: "/connections",
      noteId: rows[0].metadata.noteId,
      refused: 2,
    });
    expect(JSON.stringify(pushes[0].message.data)).not.toMatch(
      /c-till|03\.10\.2026|0555/,
    );
    for (const row of rows) {
      expect(row.metadata.checkIds).toEqual(["c-till-1", "c-till-2"]);
      expect(row.metadata.firstSent).toBe('"03.10.2026"');
    }
  });

  it("a caller that gives no push data still sends its metadata, as before", async () => {
    const { notifications, pushes } = realFunnel();
    await notifications.persistForRestaurant(HOUSE, {
      type: "inventory",
      title: "Gin is running out",
      message: "2 bottles left",
      priority: "high",
      metadata: { inventoryId: "inv-1" },
    });
    expect(pushes[0].message.data).toEqual({
      type: "inventory",
      actionUrl: null,
      inventoryId: "inv-1",
    });
  });
});
