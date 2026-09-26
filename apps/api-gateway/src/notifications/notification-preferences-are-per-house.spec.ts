/**
 * The 42P10 every preferences save hit, fixed (ADR 0149 row 39, 2026-09-18,
 * recorded on train/finish-2).
 *
 * FOUNDER ANSWER: notification preferences are per person PER HOUSE, not per
 * person. `notification_preferences` has carried `UNIQUE (restaurant_id,
 * user_id)` since the production baseline
 * (`20260805000000_baseline_from_production.sql:7212-7216`); the defect was
 * always in the CODE, not the schema —
 * `NotificationsService.updatePreferences` and `.registerPushSubscription`
 * upserted with `onConflict: "user_id"`, which names no unique index at all
 * (`supabase/migrations/20260813090000_fix_remaining_upsert_targets.sql` §3;
 * confirmed against production). PostgREST cannot plan that statement and
 * Postgres answers 42P10 on every call.
 *
 * EVERY TEST BELOW WAS RUN AGAINST THE PRE-FIX SERVICE (this file's git
 * history, `onConflict: "user_id"`, no `restaurant_id` in the written row, a
 * single `notification_preferences` read with no restaurant filter) and
 * observed FAILING there — that is the shape of the 42P10 this pins.
 *
 * The end-to-end proof that the corrected statement actually plans against
 * real Postgres (not just "the fake client received the right arguments") is
 * `p4-scratch/pglite-probe/notify-preferences-per-house.mjs`, which runs both
 * the old and the new `ON CONFLICT` shape against a live PGlite database.
 */

import { NotificationsService } from "./notifications.service";

type Row = Record<string, any>;

const USER = "22222222-2222-4222-8222-222222222222";
const HOUSE = "11111111-1111-4111-8111-111111111111";

/**
 * Minimal supabase-js stand-in that RECORDS the table, the filters, and the
 * `onConflict` target of every call — enough to tell "which unique index does
 * this statement claim to satisfy" without a real Postgres.
 */
function makeDb(selectResult: Row | null = null) {
  const calls: Array<{
    method: string;
    table: string;
    args: any[];
    filters: Array<[string, any]>;
  }> = [];

  function builder(table: string, method: string, args: any[]) {
    const filters: Array<[string, any]> = [];
    const b: any = {};
    b.eq = (col: string, val: any) => {
      filters.push([col, val]);
      return b;
    };
    b.select = () => b;
    b.single = async () => ({ data: selectResult, error: null });
    b.maybeSingle = async () => ({ data: selectResult, error: null });
    b.then = (resolve: any) =>
      resolve({ data: selectResult ? [selectResult] : [], error: null });
    calls.push({ method, table, args, filters });
    return b;
  }

  const supabase = {
    from: (table: string) => ({
      upsert: (...args: any[]) => builder(table, "upsert", args),
      select: (...args: any[]) => builder(table, "select", args),
      update: (...args: any[]) => builder(table, "update", args),
      delete: (...args: any[]) => builder(table, "delete", args),
    }),
  };

  return { supabase, calls };
}

function makeService(db: { supabase: any }) {
  return new NotificationsService(
    {} as never,
    { get: () => undefined } as never,
    db as never,
  );
}

describe("updatePreferences upserts on the real unique index", () => {
  it("[PRE-FIX-FAILS] targets (restaurant_id, user_id), not user_id alone", async () => {
    const { supabase, calls } = makeDb({ user_id: USER, restaurant_id: HOUSE });
    const service = makeService({ supabase });

    await service.updatePreferences({
      userId: USER,
      restaurantId: HOUSE,
      email: true,
    });

    const upsert = calls.find(
      (c) => c.table === "notification_preferences" && c.method === "upsert",
    );
    expect(upsert).toBeDefined();
    const [row, opts] = upsert!.args;
    expect(opts?.onConflict).toBe("restaurant_id,user_id");
    expect(row.restaurant_id).toBe(HOUSE);
    expect(row.user_id).toBe(USER);
  });

  it("[PRE-FIX-FAILS] getPreferences filters by both user_id and restaurant_id", async () => {
    const { supabase, calls } = makeDb({ user_id: USER, restaurant_id: HOUSE });
    const service = makeService({ supabase });

    await service.getPreferences(USER, HOUSE);

    const read = calls.find(
      (c) => c.table === "notification_preferences" && c.method === "select",
    );
    expect(read).toBeDefined();
    const filterCols = read!.filters.map(([col]) => col).sort();
    expect(filterCols).toEqual(["restaurant_id", "user_id"]);
    expect(read!.filters).toContainEqual(["restaurant_id", HOUSE]);
    expect(read!.filters).toContainEqual(["user_id", USER]);
  });
});

describe("a push subscription is stored outside the per-house row", () => {
  it("[PRE-FIX-FAILS] registerPushSubscription writes notification_push_devices, upserting on (user_id, endpoint)", async () => {
    const { supabase, calls } = makeDb();
    const service = makeService({ supabase });

    await service.registerPushSubscription(USER, {
      endpoint: "https://push.example/dev-a",
      keys: { p256dh: "k1", auth: "k2" },
    });

    const upsert = calls.find((c) => c.method === "upsert");
    expect(upsert).toBeDefined();
    expect(upsert!.table).toBe("notification_push_devices");
    const [row, opts] = upsert!.args;
    expect(opts?.onConflict).toBe("user_id,endpoint");
    expect(row.user_id).toBe(USER);
    expect(row.endpoint).toBe("https://push.example/dev-a");
    // The old target must never be touched again by this write path.
    expect(calls.some((c) => c.table === "notification_preferences")).toBe(
      false,
    );
  });

  it("[PRE-FIX-FAILS] unregisterPushSubscription deletes from notification_push_devices, not notification_preferences", async () => {
    const { supabase, calls } = makeDb();
    const service = makeService({ supabase });

    await service.unregisterPushSubscription(USER);

    const del = calls.find((c) => c.method === "delete");
    expect(del).toBeDefined();
    expect(del!.table).toBe("notification_push_devices");
    expect(calls.some((c) => c.table === "notification_preferences")).toBe(
      false,
    );
  });
});
