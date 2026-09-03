/**
 * `RecipientResolverService.checkChannelPreference` reads columns that exist,
 * and the opt-out it implements runs in the right direction.
 *
 * THE DEFECT THIS FILE PINS (measured against `origin/main` @ 77eb7888):
 *
 *   `checkChannelPreference` read `prefs.order_channels` and
 *   `prefs.report_channels`. Neither column has ever been declared by any
 *   migration — `notification_preferences` carries `order_approval_channels`
 *   and `financial_reports_channels`
 *   (`supabase/migrations/20260805000000_baseline_from_production.sql:3899-3939`).
 *
 *   Both reads were therefore permanently `undefined`, and that broke the
 *   method on two axes at once, in opposite directions:
 *
 *     - EMAIL WAS REFUSED TO USERS WHO HAD ENABLED IT. The only array that
 *       could ever match was `low_stock_channels`, whose production default is
 *       `['sms','push']`. Email is not in it, and the "no explicit preferences
 *       set" escape hatch could not fire either, because that column was
 *       truthy while the two misspelled ones were undefined.
 *
 *     - SMS WAS PERMITTED TO USERS WHO HAD DISABLED IT. `sms_enabled` — the
 *       switch a user actually toggles, and the only one that is opt-IN
 *       (default `false`) — was never consulted at all. `'sms'` IS in
 *       `low_stock_channels`' default, so it matched.
 *
 * WHY THE COLUMN RENAME ALONE IS NOT THE FIX, which is the trap here: with the
 * real column names, `order_approval_channels` defaults to
 * `['sms','push','email']`, so email starts passing — the first half looks
 * fixed. SMS keeps passing too, because nothing has yet taught this method that
 * `sms_enabled` exists. The second half of the defect survives a pure rename
 * silently.
 *
 * That is measured, not assumed. This suite was run against three trees:
 *
 *   origin/main (both defects)        6 of 10 failed
 *   rename-only (names fixed, no      4 of 10 failed  <- incl. `refuses SMS …`
 *     global-switch gate)                                and `refuses email
 *                                                        when … off globally`
 *   this branch                       0 of 10 failed
 *
 * The middle row is the one that matters: a reviewer who "just fixes the
 * column names" gets a tree that still mis-routes SMS, and this file says so.
 *
 * EVERY TEST MARKED `[PRE-FIX-FAILS]` WAS OBSERVED FAILING against
 * `origin/main` before this change; full counts are in ADR 0093. The unmarked
 * ones are both-states guards — they pass against `origin/main` too, and exist
 * so that "delete the preference check entirely" does not satisfy this suite.
 */

import * as fs from "fs";
import * as path from "path";
import { RecipientResolverService } from "./recipient-resolver.service";

type Row = Record<string, any>;

const RESTAURANT = "rest-1";
const USER = "user-1";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BASELINE_MIGRATION = path.join(
  REPO_ROOT,
  "supabase/migrations/20260805000000_baseline_from_production.sql",
);
const RESOLVER_SRC = path.join(__dirname, "recipient-resolver.service.ts");
const NOTIFICATIONS_SRC = path.join(
  __dirname,
  "../notifications/notifications.service.ts",
);

/**
 * Every column `public.notification_preferences` actually declares, read out of
 * the migration corpus rather than restated here.
 *
 * Restating the list would defeat the purpose: the bug was a column name that
 * looked plausible and was never checked against the schema. A hand-copied
 * array in a test is the same failure mode one layer up.
 */
function declaredColumns(): Set<string> {
  const sql = fs.readFileSync(BASELINE_MIGRATION, "utf8");
  const start = sql.indexOf("CREATE TABLE public.notification_preferences (");
  if (start === -1) {
    throw new Error(
      `CANNOT CHECK: no CREATE TABLE for notification_preferences in ${BASELINE_MIGRATION}. ` +
        "The table was renamed or the baseline was rewritten — this guard is " +
        "not measuring anything until that is reconciled.",
    );
  }
  const body = sql.slice(start, sql.indexOf(");", start));
  const cols = new Set<string>();
  for (const line of body.split("\n").slice(1)) {
    const m = /^\s{2,}([a-z_][a-z0-9_]*)\s+\S/.exec(line);
    if (m) cols.add(m[1]);
  }
  if (cols.size < 20) {
    throw new Error(
      `CANNOT CHECK: parsed only ${cols.size} columns from notification_preferences; ` +
        "the CREATE TABLE shape changed and this parser is stale.",
    );
  }
  return cols;
}

/**
 * supabase-js stand-in. Resolves rather than throws on error, matching
 * postgrest-js (`PostgrestBuilder.ts:82` leaves `shouldThrowOnError` false), so
 * broken code cannot pass by way of a double that rejects when the real client
 * would not.
 */
function makeClient(tables: Record<string, Row[]>) {
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
 * One restaurant, one manager who has BOTH an email and a phone on file.
 *
 * Both contact details are populated deliberately: every assertion below is
 * about the preference gate, so the contact row must never be the reason a
 * channel comes back empty.
 */
function tablesWithPrefs(prefs: Row | null): Record<string, Row[]> {
  return {
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
    notification_preferences: prefs
      ? [{ user_id: USER, restaurant_id: RESTAURANT, ...prefs }]
      : [],
  };
}

function makeResolver(prefs: Row | null) {
  const client = makeClient(tablesWithPrefs(prefs));
  const config = {
    get: (key: string) =>
      key === "MANAGER_EMAIL"
        ? "founder@legacy.test"
        : key === "MANAGER_PHONE"
          ? "+15550000000"
          : undefined,
  };
  const service = new RecipientResolverService(
    config as any,
    {
      getClient: () => client,
      supabase: client,
    } as any,
  );
  for (const level of ["error", "debug", "warn", "log"]) {
    jest
      .spyOn((service as any).logger, level as any)
      .mockImplementation(() => {});
  }
  return service;
}

/** Resolve for one restaurant with the env fallback OFF, so the only thing
 *  that can put an address in the result is the preference gate itself. */
async function resolve(prefs: Row | null, channels: Array<"email" | "sms">) {
  const service = makeResolver(prefs);
  return service.resolveRecipients({
    restaurantId: RESTAURANT,
    roles: ["manager"],
    channels,
    allowDefaultFallback: false,
  });
}

/**
 * The exact production default for `notification_preferences`, as declared by
 * the baseline migration. This is the row shape all three production tenants
 * carry, and the shape the defect was measured against.
 */
const PRODUCTION_DEFAULTS: Row = {
  low_stock_channels: ["sms", "push"],
  order_approval_channels: ["sms", "push", "email"],
  financial_reports_channels: ["email", "dashboard"],
  email_enabled: true,
  push_enabled: true,
  sms_enabled: false,
};

describe("checkChannelPreference — reads real columns", () => {
  it("[PRE-FIX-FAILS] names no notification_preferences column the schema does not declare", () => {
    const declared = declaredColumns();
    const src = fs.readFileSync(RESOLVER_SRC, "utf8");

    // Only the executable half of the file. The doc comment above the method
    // names `order_channels` and `report_channels` on purpose, to say what the
    // bug was, and must not be read as a violation of itself.
    const code = src
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    const read = [...code.matchAll(/\bprefs\.([a-z_][a-z0-9_]*)/g)].map(
      (m) => m[1],
    );

    expect(read.length).toBeGreaterThan(0); // never vacuous
    const undeclared = [...new Set(read)].filter((c) => !declared.has(c));
    expect(undeclared).toEqual([]);
  });

  it("[PRE-FIX-FAILS] agrees with notifications.service.ts on the per-channel defaults", () => {
    // Two readers of the same row. If they disagree, the row means different
    // things depending on which path looks at it — which is how `sms_enabled`
    // came to be honoured in Settings and ignored in routing.
    const resolver = fs.readFileSync(RESOLVER_SRC, "utf8");
    const notifications = fs.readFileSync(NOTIFICATIONS_SRC, "utf8");

    for (const [col, dflt] of [
      ["email_enabled", "true"],
      ["push_enabled", "true"],
      ["sms_enabled", "false"],
    ]) {
      const pattern = new RegExp(`${col}\\s*\\?\\?\\s*${dflt}\\b`);
      expect(notifications).toMatch(pattern); // the first reader still says this
      expect(resolver).toMatch(pattern); // and the second one agrees
    }
  });

  it("[PRE-FIX-FAILS] delivers email to a user on stock production defaults", async () => {
    // The headline symptom. `email_enabled` is true and email is in
    // `order_approval_channels`' default, so this user has email on by every
    // measure the product exposes. Pre-fix this returned zero addresses.
    const res = await resolve(PRODUCTION_DEFAULTS, ["email"]);
    expect(res.emails).toEqual(["manager@one.test"]);
  });

  it("[PRE-FIX-FAILS] refuses SMS to a user on stock production defaults", async () => {
    // The half a pure column rename does NOT fix. `sms_enabled` defaults to
    // false — SMS is the one opt-IN channel — yet `'sms'` sits in
    // `low_stock_channels`' default, so the array gate alone says yes.
    const res = await resolve(PRODUCTION_DEFAULTS, ["sms"]);
    expect(res.phones).toEqual([]);
  });

  it("[PRE-FIX-FAILS] honours order_approval_channels as an opt-out", async () => {
    // Only one category array is expressed and it excludes email. Pre-fix the
    // escape hatch fired (all three of the columns it tested were falsy,
    // because two of them never existed) and email was allowed regardless.
    const res = await resolve(
      { order_approval_channels: ["sms"], email_enabled: true },
      ["email"],
    );
    expect(res.emails).toEqual([]);
  });

  it("[PRE-FIX-FAILS] honours financial_reports_channels as an opt-in", async () => {
    // Mirror of the above: the user named email in the financial-reports
    // array and nowhere else. Pre-fix this column was not read at all, so the
    // answer came from `low_stock_channels`, which excludes email.
    const res = await resolve(
      { low_stock_channels: ["sms"], financial_reports_channels: ["email"] },
      ["email"],
    );
    expect(res.emails).toEqual(["manager@one.test"]);
  });

  it("refuses email when the user switched email off globally", async () => {
    // Both-states guard: passes pre-fix too (email was refused for the wrong
    // reason). Here to stop a "return true always" fix.
    const res = await resolve(
      { ...PRODUCTION_DEFAULTS, email_enabled: false },
      ["email"],
    );
    expect(res.emails).toEqual([]);
  });

  it("delivers SMS once the user opts in", async () => {
    const res = await resolve({ ...PRODUCTION_DEFAULTS, sms_enabled: true }, [
      "sms",
    ]);
    expect(res.phones).toEqual(["+15551110000"]);
  });

  it("delivers on every channel when the user has no preferences row", async () => {
    // No row at all is not the same as a row full of defaults: the caller
    // short-circuits on `!prefs`. Guards that path against regression.
    const res = await resolve(null, ["email", "sms"]);
    expect(res.emails).toEqual(["manager@one.test"]);
    expect(res.phones).toEqual(["+15551110000"]);
  });

  it("[PRE-FIX-FAILS] falls through to the global switch when no category array is set", async () => {
    // A row that exists but expresses no category preference. Gate 1 decides:
    // email on by default, SMS off by default.
    const res = await resolve({ email_enabled: true }, ["email", "sms"]);
    expect(res.emails).toEqual(["manager@one.test"]);
    expect(res.phones).toEqual([]);
  });
});
