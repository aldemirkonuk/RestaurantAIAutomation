/**
 * A missing push-subscription source must never be reported as "this user has
 * no devices".
 *
 * `push_subscriptions` does not exist in production: PostgREST answers
 * `404 PGRST205 / Could not find the table 'public.push_subscriptions' in the
 * schema cache` to the service-role key (curl, 2026-08-26). The original
 * implementation destructured `error`, never read it, and returned `data || []`
 * — so every push resolution produced an empty list and not one log line.
 *
 * The fake client below reproduces the exact supabase-js contract that made
 * that possible: a PostgREST failure is RESOLVED as `{ data: null, error }`,
 * never thrown. postgrest-js `PostgrestBuilder.ts:82` sets
 * `shouldThrowOnError = false`, `:529` gates its only `throw` on that flag, and
 * `:366` converts fetch/DNS failures into an error result too. A test whose
 * double *rejects* instead would pass against the broken code, which is why
 * this one must not.
 */

import {
  PushSubscriptionSourceError,
  RecipientResolverService,
} from "./recipient-resolver.service";

type Row = Record<string, any>;

const RESTAURANT = "rest-1";
const USER = "user-1";

/** PostgREST's real answer for a table that is not in the schema cache. */
const MISSING_TABLE_ERROR = {
  code: "PGRST205",
  details: null,
  hint: null,
  message:
    "Could not find the table 'public.push_subscriptions' in the schema cache",
};

/**
 * Minimal supabase-js stand-in.
 *
 * `errorFor` maps a table name to an error object the builder RESOLVES with —
 * matching supabase-js, which does not throw on PostgREST errors.
 */
function makeClient(
  tables: Record<string, Row[]>,
  errorFor: Record<string, any> = {},
) {
  return {
    from: jest.fn((table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      const builder: any = {};
      for (const m of ["select", "order", "limit", "not", "is", "single"]) {
        builder[m] = jest.fn(() => builder);
      }
      builder.eq = jest.fn((col: string, val: any) => {
        filters.push((r) => r[col] === val);
        return builder;
      });
      builder.in = jest.fn((col: string, vals: any[]) => {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      });
      builder.then = (resolve: any, reject: any) => {
        if (errorFor[table]) {
          return Promise.resolve({ data: null, error: errorFor[table] }).then(
            resolve,
            reject,
          );
        }
        const rows = (tables[table] ?? []).filter((r) =>
          filters.every((f) => f(r)),
        );
        return Promise.resolve({ data: rows, error: null }).then(
          resolve,
          reject,
        );
      };
      return builder;
    }),
  };
}

/** One restaurant, one manager, who has an email and a phone. */
const POPULATED: Record<string, Row[]> = {
  user_restaurant_access: [
    { user_id: USER, role: "manager", restaurant_id: RESTAURANT },
  ],
  users: [
    {
      user_id: USER,
      email: "manager@one.test",
      phone: "+15551110000",
      name: "Manager",
    },
  ],
  notification_preferences: [],
};

function makeResolver(
  errorFor: Record<string, any> = {},
  tables: Record<string, Row[]> = POPULATED,
) {
  const client = makeClient(tables, errorFor);
  const config = {
    get: (key: string) =>
      key === "MANAGER_EMAIL"
        ? "founder@legacy.test"
        : key === "MANAGER_PHONE"
          ? "+15550000000"
          : undefined,
  };
  const service = new RecipientResolverService(config as any, {
    getClient: () => client,
    supabase: client,
  } as any);
  const errors: string[] = [];
  jest
    .spyOn((service as any).logger, "error")
    .mockImplementation((msg: any) => {
      errors.push(String(msg));
    });
  jest.spyOn((service as any).logger, "debug").mockImplementation(() => {});
  jest.spyOn((service as any).logger, "warn").mockImplementation(() => {});
  return { service, errors };
}

/** The failure this whole file is about: the table is not there. */
const TABLE_MISSING = {
  [RecipientResolverService.PUSH_SUBSCRIPTION_TABLE]: MISSING_TABLE_ERROR,
};

describe("push subscriptions — a missing table is never reported as zero devices", () => {
  it("throws when push is the only channel asked for", async () => {
    const { service } = makeResolver(TABLE_MISSING);

    // The old code resolved to `{ pushSubscriptionIds: [] }` here, and the
    // caller had no way to tell that apart from "nobody registered a device".
    await expect(
      service.resolveRecipients({
        restaurantId: RESTAURANT,
        roles: ["manager"],
        channels: ["push"],
      }),
    ).rejects.toBeInstanceOf(PushSubscriptionSourceError);
  });

  it("names the table, the user and the PostgREST code in the thrown error", async () => {
    const { service } = makeResolver(TABLE_MISSING);

    const err = await service
      .resolveRecipients({
        restaurantId: RESTAURANT,
        roles: ["manager"],
        channels: ["push"],
      })
      .then(
        () => null,
        (e) => e as PushSubscriptionSourceError,
      );

    expect(err).toBeInstanceOf(PushSubscriptionSourceError);
    expect(err!.message).toContain("push_subscriptions");
    expect(err!.message).toContain("PGRST205");
    expect(err!.message).toContain(USER);
    expect(err!.table).toBe("push_subscriptions");
    expect(err!.userId).toBe(USER);
  });

  it("logs an ERROR carrying the restaurant, the user and the table", async () => {
    const { service, errors } = makeResolver(TABLE_MISSING);

    await service
      .resolveRecipients({
        restaurantId: RESTAURANT,
        roles: ["manager"],
        channels: ["email", "push"],
      })
      .catch(() => undefined);

    const line = errors.find((e) =>
      e.includes("PUSH_SUBSCRIPTIONS_UNREADABLE"),
    );
    expect(line).toBeDefined();
    expect(line).toContain(RESTAURANT);
    expect(line).toContain(USER);
    expect(line).toContain("push_subscriptions");
    expect(line).toContain("PGRST205");
  });

  it("marks the result `pushUnavailable` when other channels were also asked for", async () => {
    const { service } = makeResolver(TABLE_MISSING);

    const result = await service.resolveRecipients({
      restaurantId: RESTAURANT,
      roles: ["manager"],
      channels: ["email", "push"],
    });

    expect(result.pushUnavailable).toMatch(/PGRST205/);
  });

  it("still delivers email and SMS when only the push source is broken", async () => {
    // The degrade half of the decision: a missing push table must not take
    // down the channels that do work.
    const { service } = makeResolver(TABLE_MISSING);

    const result = await service.resolveRecipients({
      restaurantId: RESTAURANT,
      roles: ["manager"],
      channels: ["email", "sms", "push"],
    });

    expect(result.emails).toEqual(["manager@one.test"]);
    expect(result.phones).toEqual(["+15551110000"]);
  });

  it("does not fall back to the global MANAGER_EMAIL because push failed", async () => {
    // The outer catch collapses to the env fallback. If the push failure were
    // allowed to reach it, restaurant B's report would go to restaurant A's
    // inbox — the OD-87 leak, re-entered through a new door.
    const { service } = makeResolver(TABLE_MISSING);

    const result = await service.resolveRecipients({
      restaurantId: RESTAURANT,
      roles: ["manager"],
      channels: ["email", "push"],
    });

    expect(result.emails).not.toContain("founder@legacy.test");
  });

  it("reports a genuinely empty table as zero devices, with no error", async () => {
    // The other half of the distinction: [] must still mean [] when the read
    // actually succeeded. Without this, "throw always" would pass the suite.
    const { service, errors } = makeResolver();

    const result = await service.resolveRecipients({
      restaurantId: RESTAURANT,
      roles: ["manager"],
      channels: ["email", "push"],
    });

    expect(result.pushSubscriptionIds).toEqual([]);
    expect(result.pushUnavailable).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("returns the ids when the read succeeds", async () => {
    const { service } = makeResolver(
      {},
      {
        ...POPULATED,
        [RecipientResolverService.PUSH_SUBSCRIPTION_TABLE]: [
          { id: "sub-a", user_id: USER },
          { id: "sub-b", user_id: USER },
          { id: "sub-other", user_id: "someone-else" },
        ],
      },
    );

    const result = await service.resolveRecipients({
      restaurantId: RESTAURANT,
      roles: ["manager"],
      channels: ["push"],
    });

    expect(result.pushSubscriptionIds).toEqual(["sub-a", "sub-b"]);
    expect(result.pushUnavailable).toBeUndefined();
  });
});
