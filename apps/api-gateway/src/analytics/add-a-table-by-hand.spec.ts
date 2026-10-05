import "reflect-metadata";
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DatabaseService } from "../database/database.service";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { AnalyticsController } from "./analytics.controller";
import { TableAnalyticsService } from "./table-analytics.service";

/**
 * ADR 0303, amendment 2026-10-05 — an owner or a manager adds a table by hand
 * (founder, verbatim "Follow-up: 'Add a table' (Recommended)").
 *
 * Before: POST /analytics/tables/:restaurantId admitted any signed-in member
 * of the house, upserted on the label (so a name another table had quietly
 * overwrote that table), and wrote seats 2 and is_outdoor false when the body
 * gave none.
 *
 * After: owner or manager only (RolesGuard, exact); it only adds, and a name
 * the house already answers to is a 409 that says which table; a value not
 * given is NULL; and it says how many waiting checks the new table took (the
 * database's re-link on add does the linking, migration
 * tables_learned_from_the_pos).
 */

type Row = Record<string, any>;
type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

const ok = (data: unknown, count?: number): Result => ({
  data,
  error: null,
  count,
});
const failed = (message: string, code?: string): Result => ({
  data: null,
  error: { message, code },
});

/** Chainable Supabase stub: each `.from(table)` takes the next queued result. */
function makeDb(queue: Record<string, Result[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = jest.fn((table: string) => {
    const next = queue[table]?.shift() ?? ok([]);
    const builder: Record<string, unknown> = {};
    for (const method of [
      "select",
      "eq",
      "insert",
      "upsert",
      "update",
      "order",
    ])
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    builder.single = () => {
      calls.push({ table, method: "single", args: [] });
      return Promise.resolve(next);
    };
    builder.maybeSingle = builder.single;
    builder.then = (
      resolve: (r: Result) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(next).then(resolve, reject);
    return builder;
  });
  const db = { getClient: () => ({ from }) } as unknown as DatabaseService;
  return { service: new TableAnalyticsService(db), calls };
}

const RID = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "55555555-5555-4555-8555-555555555555";

const house = (): Row[] => [
  {
    id: "t7",
    label: "T7",
    hidden_at: null,
    is_active: true,
    pos_refs: { csv_import: "T7" },
  },
  {
    id: "t9",
    label: "Window",
    hidden_at: "2026-10-04T09:00:00.000Z",
    is_active: true,
    pos_refs: {},
  },
  {
    id: "old",
    label: "Old bar",
    hidden_at: null,
    is_active: false,
    pos_refs: { csv_import: "lounge" },
  },
  {
    id: "w12",
    label: "Garden 12",
    hidden_at: null,
    is_active: true,
    pos_refs: { csv_import: "T12" },
  },
];

function add(
  body: unknown,
  {
    tables = ok(house()),
    insert = ok({ id: NEW_ID, label: "Bar", seats: null, is_outdoor: null }),
    count = ok(null, 2),
  }: { tables?: Result; insert?: Result; count?: Result } = {},
) {
  const m = makeDb({
    restaurant_tables: [tables, insert],
    pos_checks: [count],
  });
  return { ...m, result: m.service.addTable(RID, body) };
}

const inserted = (calls: Array<{ method: string; args: unknown[] }>) =>
  calls.find((c) => c.method === "insert")?.args[0] as Row | undefined;

describe("adding a table by hand is the owner's or a manager's (ADR 0303, founder fork F1)", () => {
  it("guards POST tables/:restaurantId with RolesGuard and ['owner', 'manager']", () => {
    const handler = (AnalyticsController.prototype as any).addTable;
    expect(typeof handler).toBe("function");
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      "owner",
      "manager",
    ]);
    expect(Reflect.getMetadata("__guards__", handler)).toContain(RolesGuard);
    expect(Reflect.getMetadata("path", handler)).toBe("tables/:restaurantId");
    expect((AnalyticsController.prototype as any).upsertTable).toBeUndefined();
  });

  it.each<[string | null, boolean]>([
    ["owner", true],
    ["manager", true],
    ["staff", false],
    ["admin", false],
    [null, false],
  ])("the real guard lets %s through: %s", (role, admitted) => {
    const handler = (AnalyticsController.prototype as any).addTable;
    const guard = new RolesGuard(new Reflector());
    const ctx = {
      getHandler: () => handler,
      getClass: () => AnalyticsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: "u", role } }),
      }),
    } as any;
    expect(guard.canActivate(ctx)).toBe(admitted);
  });
});

describe("addTable refuses a bad body with 400 and writes nothing", () => {
  it.each<[unknown, string]>([
    [null, "no body"],
    [{}, "no name"],
    [{ label: "" }, "a blank name"],
    [{ label: "   " }, "a name of spaces"],
    [{ label: "x".repeat(61) }, "a name over 60 characters"],
    [{ label: 7 }, "a name that is not text"],
    [{ label: "Bar", seats: 0 }, "no seats"],
    [{ label: "Bar", seats: 2.5 }, "half a seat"],
    [{ label: "Bar", seats: "4" }, "seats as text"],
    [
      { label: "Bar", is_outdoor: "yes" },
      "an outdoor flag that is not a boolean",
    ],
    [{ label: "Bar", zone: 3 }, "a zone that is not text"],
    [{ label: "Bar", distance_to_bar_m: -1 }, "a negative distance"],
    [
      { label: "Bar", distance_to_bar_m: 10000 },
      "a distance the column cannot hold",
    ],
    [{ label: "Bar", x_pos: Number.NaN }, "a position that is not a number"],
  ])("%j (%s)", async (body) => {
    const { result, calls } = add(body);
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted(calls)).toBeUndefined();
  });
});

describe("addTable refuses a name the house already answers to with 409, and says which table", () => {
  it("a shown table with the name, in any case and spacing", async () => {
    const { result, calls } = add({ label: "  t7 " });
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(add({ label: "  t7 " }).result).rejects.toThrow(
      'This house already has a table called "T7".',
    );
    expect(inserted(calls)).toBeUndefined();
    expect(calls.some((c) => c.method === "upsert")).toBe(false);
  });

  it("a hidden table with the name, and says to show it again", async () => {
    const { result, calls } = add({ label: "WINDOW" });
    await expect(result).rejects.toThrow(
      'This house already has a table called "Window". It is hidden: show it again instead of adding it.',
    );
    expect(inserted(calls)).toBeUndefined();
  });

  it("a table the house no longer uses with the name", async () => {
    const { result, calls } = add({ label: "old bar" });
    await expect(result).rejects.toThrow(
      'A table this house no longer uses is already called "Old bar", so the name cannot be added again.',
    );
    expect(inserted(calls)).toBeUndefined();
  });

  it("a till word another table already catches", async () => {
    const { result, calls } = add({ label: "t12" });
    await expect(result).rejects.toThrow(
      'The till\'s word "T12" already goes to the table "Garden 12", so a new table by that name would catch no check.',
    );
    expect(inserted(calls)).toBeUndefined();
  });

  it("but a word only a table no longer used once caught is free", async () => {
    const { result, calls } = add({ label: "Lounge" });
    await expect(result).resolves.toMatchObject({ id: NEW_ID });
    expect(inserted(calls)).toMatchObject({ label: "Lounge" });
  });

  it("the database's own refusal of a duplicate name (23505) is a 409 too", async () => {
    const { result } = add(
      { label: "Bar" },
      {
        insert: failed(
          "duplicate key value violates unique constraint",
          "23505",
        ),
      },
    );
    await expect(result).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("addTable adds, and writes no answer nobody gave", () => {
  it("inserts the trimmed name for the caller's house, with seats and is_outdoor NULL", async () => {
    const { result, calls } = add({ label: "  Bar " });
    await result;
    const row = inserted(calls);
    expect(row).toEqual({
      restaurant_id: RID,
      label: "Bar",
      seats: null,
      is_outdoor: null,
      zone: null,
      distance_to_kitchen_m: null,
      distance_to_bar_m: null,
      distance_to_pool_m: null,
      x_pos: null,
      y_pos: null,
    });
    // A hand-added table carries no learned_at, so the database's re-link on
    // add (not the deferred learned one) runs in the same statement.
    expect(row).not.toHaveProperty("learned_at");
    expect(calls.some((c) => c.method === "upsert")).toBe(false);
  });

  it("keeps the values a body does give", async () => {
    const { result, calls } = add({
      label: "Patio",
      seats: 4,
      is_outdoor: true,
      zone: " Garden ",
      distance_to_bar_m: 12.5,
    });
    await result;
    expect(inserted(calls)).toMatchObject({
      seats: 4,
      is_outdoor: true,
      zone: "Garden",
      distance_to_bar_m: 12.5,
      distance_to_kitchen_m: null,
    });
  });

  it("says how many waiting checks the new table took, counted in its house", async () => {
    const { result, calls } = add({ label: "Bar" });
    await expect(result).resolves.toMatchObject({
      id: NEW_ID,
      label: "Bar",
      seats: null,
      checksLinked: 2,
    });
    const scope = calls
      .filter((c) => c.table === "pos_checks" && c.method === "eq")
      .map((c) => c.args);
    expect(scope).toEqual([
      ["restaurant_id", RID],
      ["table_id", NEW_ID],
    ]);
  });

  it("says null, not 0, when the checks it took could not be counted", async () => {
    const { result } = add(
      { label: "Bar" },
      { count: failed("statement timeout") },
    );
    await expect(result).resolves.toMatchObject({
      id: NEW_ID,
      checksLinked: null,
    });
  });

  it("adds nothing when the house's tables cannot be read (503)", async () => {
    const { result, calls } = add(
      { label: "Bar" },
      { tables: failed("connection reset") },
    );
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(inserted(calls)).toBeUndefined();
  });

  it("a write the database refuses for another reason is a 500, not a 400 with its text", async () => {
    const { result } = add(
      { label: "Bar" },
      { insert: failed("null value in column violates not-null", "23502") },
    );
    await expect(result).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
