/**
 * `RecipientResolverService` does not resolve push recipients, and must not
 * quietly start pretending to again.
 *
 * SUPERSEDES `push-subscription-silence.spec.ts` (#94), which pinned the
 * *loud-failure* behaviour of a read that has now been deleted outright
 * (ADR 0027 / OD-95). That file's guarantee — "a missing source is never
 * reported as zero devices" — is preserved here in its strongest form: there
 * is no source, no read, and no field, so there is nothing left to misreport.
 *
 * WHY THE DELETION, in one place, because a test file that only asserts
 * absence is easy to mistake for a test file that asserts nothing:
 *
 *   1. The read pointed at `push_subscriptions`, which does not exist in
 *      production (`to_regclass('public.push_subscriptions')` → NULL,
 *      2026-08-26) and must not be created — it is an abandoned storage model.
 *   2. The obvious repoint target,
 *      `notification_preferences.push_subscription`, has no working writer:
 *      `registerPushSubscription` upserts `onConflict: "user_id"` while the
 *      table's only unique index is `(restaurant_id, user_id)`, so Postgres
 *      answers 42P10 and the statement cannot be planned. Verified against
 *      production. Repointing would have replaced a loud 404 with a
 *      permanently-empty read that looks successful.
 *   3. Nothing consumed the field. Both push senders take USER IDS and
 *      enumerate devices themselves (`sendWebPush(userId)`,
 *      `sendToUsers(userIds)`), so no shape this resolver could return would
 *      have been usable by either.
 *
 * THE TRAP THIS FILE IS BUILT AGAINST: `pushSubscriptionIds` never once held a
 * value, so an assertion that it is empty passes against the broken code too.
 * Every test below was therefore checked against a revert of the deletion, and
 * the ones that must fail there are marked `[REVERT-FAILS]` — all six were
 * observed failing. The unmarked ones are deliberate both-states guards: they
 * passed against the revert too, which is what stops "delete the whole
 * service" from satisfying this suite.
 */

import { RecipientResolverService } from "./recipient-resolver.service";

type Row = Record<string, any>;

const RESTAURANT = "rest-1";
const USER = "user-1";

/**
 * Every table this resolver is allowed to touch, and nothing else.
 *
 * `mobile_devices` and `notification_preferences.push_subscription` are named
 * in the assertions below rather than only `push_subscriptions`, so that
 * "repoint at the other store" is caught by this file too — not just "undo
 * the delete".
 */
const PUSH_STORES = ["push_subscriptions", "mobile_devices"];

/**
 * Minimal supabase-js stand-in that RECORDS every table it is asked for.
 *
 * It resolves rather than throws on error, matching supabase-js: postgrest-js
 * `PostgrestBuilder.ts:82` sets `shouldThrowOnError = false` and `:529` gates
 * its only `throw` on that flag. A double that rejects instead would let
 * broken code pass.
 */
function makeClient(tables: Record<string, Row[]>, touched: string[]) {
  return {
    from: jest.fn((table: string) => {
      touched.push(table);
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

/**
 * One restaurant, one manager with an email and a phone — and a push store
 * that is POPULATED.
 *
 * The population is the point. If the resolver ever reads either store again,
 * it finds rows, and the absence assertions below stop being vacuous.
 */
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
  notification_preferences: [
    {
      user_id: USER,
      restaurant_id: RESTAURANT,
      push_subscription: { endpoint: "https://push.example/abc", keys: {} },
    },
  ],
  push_subscriptions: [
    { id: "sub-a", user_id: USER },
    { id: "sub-b", user_id: USER },
  ],
  mobile_devices: [{ expo_push_token: "ExponentPushToken[x]", user_id: USER }],
};

function makeResolver(tables: Record<string, Row[]> = POPULATED) {
  const touched: string[] = [];
  const client = makeClient(tables, touched);
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
  return { service, errors, touched };
}

describe("RecipientResolverService — push is not resolved here", () => {
  it("[REVERT-FAILS] reads no push store, even with the channel list omitted", async () => {
    // The load-bearing one. `channels` defaulted to ["email","sms","push"],
    // so an omitting caller reached the push read. If the default or the
    // branch comes back, `push_subscriptions` reappears in `touched` — and it
    // is populated above, so this is not an assertion about an empty table.
    const { service, touched } = makeResolver();

    await service.resolveRecipients({
      restaurantId: RESTAURANT,
      roles: ["manager"],
    });

    for (const store of PUSH_STORES) {
      expect(touched).not.toContain(store);
    }

    // Stated as an allowlist as well, so that a repoint at any *third* store
    // fails here too rather than only the two named above.
    expect([...new Set(touched)].sort()).toEqual([
      "notification_preferences",
      "user_restaurant_access",
      "users",
    ]);
  });

  it("[REVERT-FAILS] returns exactly { emails, phones } and no push field", async () => {
    const { service } = makeResolver();

    const result = await service.resolveRecipients({
      restaurantId: RESTAURANT,
      roles: ["manager"],
      channels: ["email", "sms"],
    });

    expect(Object.keys(result).sort()).toEqual(["emails", "phones"]);
    expect(result).not.toHaveProperty("pushSubscriptionIds");
    expect(result).not.toHaveProperty("pushUnavailable");
  });

  it("[REVERT-FAILS] the env-var fallback shape carries no push field either", async () => {
    // getDefaultRecipients is a second constructor of ResolvedRecipients and
    // had its own `pushSubscriptionIds: []`. Reached by asking for a
    // restaurant nobody belongs to.
    const { service } = makeResolver({
      ...POPULATED,
      user_restaurant_access: [],
    });

    const result = await service.resolveRecipients({
      restaurantId: "rest-nobody",
      roles: ["manager"],
      channels: ["email"],
    });

    expect(result.emails).toEqual(["founder@legacy.test"]);
    expect(Object.keys(result).sort()).toEqual(["emails", "phones"]);
  });

  it("[REVERT-FAILS] the tenant-scoped empty shape carries no push field either", async () => {
    // The third constructor: `fallbackOrEmpty` with the fallback forbidden
    // (OD-87 / ADR 0022). Same field, third place.
    const { service } = makeResolver({
      ...POPULATED,
      user_restaurant_access: [],
    });

    const result = await service.resolveRecipients({
      restaurantId: "rest-other-tenant",
      roles: ["manager"],
      channels: ["email"],
      allowDefaultFallback: false,
    });

    expect(result.emails).toEqual([]);
    expect(Object.keys(result).sort()).toEqual(["emails", "phones"]);
  });

  it("[REVERT-FAILS] `push` is not a member of the NotificationChannel union", () => {
    // Asserted against the SOURCE TEXT, not the type system, and that is a
    // deliberate downgrade rather than laziness.
    //
    // The obvious version of this test is `const c: NotificationChannel[] =
    // [/* @ts-expect-error */ "push"]`. It was written that way first, and it
    // is enforced by NOTHING here: ts-jest runs with `isolatedModules: true`
    // so jest transpiles without type-checking, and `tsconfig.json:24`
    // excludes `**/*.spec.ts` so `tsc --noEmit` never sees the file either. It
    // passed identically against a full revert of this change — a test that
    // structurally cannot report failure, which is the exact defect this
    // repo keeps finding.
    //
    // (That exclusion is a real gap well beyond this change: no spec file in
    // the gateway is type-checked by anything. Reported, not fixed here.)
    //
    // A string match on the declaration does fail on revert, so that is what
    // this asserts. It is coarse; it is also machinery that works.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const path = require("path");
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "recipient-resolver.service.ts"),
      "utf8",
    );

    const declaration = source.match(
      /export type NotificationChannel = [^;]+;/,
    );
    expect(declaration).not.toBeNull();
    expect(declaration![0]).toBe(
      'export type NotificationChannel = "email" | "sms";',
    );
  });

  // ---- both-states guards: these must pass before AND after the deletion ----
  // Without them, deleting the whole service would satisfy every test above.

  it("still resolves the restaurant's own email and phone", async () => {
    const { service, errors } = makeResolver();

    const result = await service.resolveRecipients({
      restaurantId: RESTAURANT,
      roles: ["manager"],
      channels: ["email", "sms"],
    });

    expect(result.emails).toEqual(["manager@one.test"]);
    expect(result.phones).toEqual(["+15551110000"]);
    expect(errors).toEqual([]);
  });

  it("still refuses the global fallback for a non-legacy tenant (OD-87)", async () => {
    const { service } = makeResolver({
      ...POPULATED,
      user_restaurant_access: [],
    });

    const result = await service.resolveRecipients({
      restaurantId: "rest-other-tenant",
      roles: ["manager"],
      channels: ["email"],
      allowDefaultFallback: false,
    });

    expect(result.emails).not.toContain("founder@legacy.test");
  });
});

describe("the resolver's source holds no reader of an abandoned push store", () => {
  it("[REVERT-FAILS] `push_subscriptions` appears only in prose, never in code", () => {
    // A textual ratchet on top of the behavioural one above, because the
    // behavioural test can only catch a store the fake client knows about.
    //
    // The name legitimately appears in this file's and the resolver's
    // comments — explaining why the table must not be used is the point — so
    // comments are stripped first. The stripper is deliberately crude (it does
    // not understand strings containing `//`, and does not need to: the
    // resolver has none). If it ever gets one, this test fails loudly rather
    // than quietly, which is the correct direction.
    //
    // The Python orchestrator still queries the table and is deliberately out
    // of scope here — see ADR 0027 §Consequences. `scripts/
    // check_queried_tables_exist.py` is the repo-wide ratchet that covers it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "recipient-resolver.service.ts"),
      "utf8",
    );

    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).not.toContain("push_subscriptions");
    expect(code).not.toContain("PUSH_SUBSCRIPTION_TABLE");
  });
});
