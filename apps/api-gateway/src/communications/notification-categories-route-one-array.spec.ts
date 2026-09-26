/**
 * OD-121 — a notification is routed by ONE preference category, named for
 * every send, and a send with no category is refused.
 *
 * Founder answer 15 (ADR 0149, 2026-09-16): "map the seven resolver sites to
 * categories, an unmapped category is refused".
 *
 * THE DEFECT (measured on `origin/main` @ 60ed83a7):
 *   `RecipientResolverService.checkChannelPreference` was not told what it was
 *   resolving for, so gate 2 took a UNION across `low_stock_channels`,
 *   `order_approval_channels` and `financial_reports_channels`, and never read
 *   `delivery_channels`, `inequality_alerts_channels` or
 *   `calendar_reminders_channels`. A person who wanted email for financial
 *   reports got email for low stock too, and could not separate them.
 *
 * Every test marked [REVERT-FAILS] fails against that tree: the query had no
 * `category`, so the refusal cannot fire and the union answers instead. The
 * unmarked ones are both-states guards, there so that "refuse everything"
 * does not satisfy this file.
 *
 * [REVIEW-FAILS] marks a test added by the 2026-09-17 review fixes; each fails
 * against the first build of this lane: a failed read came back as an empty
 * list with no marker (so the digest recorded `no_recipients`), and the roster
 * ignored `valid_from` / `valid_until`.
 */

import * as fs from "fs";
import * as path from "path";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEND_CATEGORY,
  RecipientResolverService,
  UnmappedNotificationCategoryError,
} from "./recipient-resolver.service";
import type { NotificationCategory } from "./recipient-resolver.service";
import { LowStockAlertsService } from "../notifications/low-stock-alerts.service";

type Row = Record<string, any>;

const HOUSE = "house-a";
const OTHER_HOUSE = "house-b";
const USER = "user-1";
const EMAIL = "manager@a.test";

/**
 * supabase-js stand-in with the filters this resolver issues. Resolves (never
 * rejects) on error, as postgrest-js does, and records every table touched so
 * a refusal can be shown to have read nothing.
 */
function makeClient(
  tables: Record<string, Row[]>,
  opts: { failing?: string[]; touched?: string[] } = {},
) {
  return {
    from: (table: string) => {
      opts.touched?.push(table);
      const filters: Array<(r: Row) => boolean> = [];
      const builder: any = {};
      for (const m of ["select", "order", "limit", "not", "is", "single"]) {
        builder[m] = () => builder;
      }
      builder.eq = (col: string, val: any) => {
        filters.push((r) => r[col] === val);
        return builder;
      };
      builder.in = (col: string, vals: any[]) => {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      };
      builder.then = (resolve: any, reject: any) => {
        if (opts.failing?.includes(table)) {
          return Promise.resolve({
            data: null,
            error: { message: `${table} is unreachable` },
          }).then(resolve, reject);
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
    },
  };
}

function tables(prefs: Row | null, extra: Partial<Record<string, Row[]>> = {}) {
  return {
    user_restaurant_access: [
      { user_id: USER, role: "manager", restaurant_id: HOUSE, is_active: true },
    ],
    users: [{ user_id: USER, email: EMAIL, phone: "+15550001111" }],
    notification_preferences: prefs
      ? [{ user_id: USER, restaurant_id: HOUSE, ...prefs }]
      : [],
    ...extra,
  } as Record<string, Row[]>;
}

function makeResolver(
  t: Record<string, Row[]>,
  opts: { failing?: string[]; touched?: string[]; legacyHouse?: string } = {},
) {
  const client = makeClient(t, opts);
  const config = {
    get: (key: string) =>
      key === "MANAGER_EMAIL"
        ? "founder@legacy.test"
        : key === "DEFAULT_RESTAURANT_ID"
          ? opts.legacyHouse
          : undefined,
  };
  const service = new RecipientResolverService(
    config as any,
    { getClient: () => client, supabase: client } as any,
  );
  const logs: string[] = [];
  for (const level of ["error", "debug", "warn", "log"]) {
    jest
      .spyOn((service as any).logger, level as any)
      .mockImplementation((m: any) => {
        logs.push(String(m));
      });
  }
  return { service, logs };
}

/** The row every production member carried when it was measured
 *  (`team/broadcast-preferences.ts:27-33`, 2026-09-02), with the three arrays
 *  it did not print filled from the baseline defaults (:3909, :3913, :3915). */
const STOCK_ROW: Row = {
  email_enabled: true,
  push_enabled: true,
  sms_enabled: false,
  low_stock_channels: ["sms", "push"],
  order_approval_channels: ["sms", "push", "email"],
  delivery_channels: ["push", "email"],
  financial_reports_channels: ["email", "dashboard"],
  inequality_alerts_channels: ["sms", "push"],
  calendar_reminders_channels: ["push", "email"],
};

const COLUMN: Record<NotificationCategory, string> = {
  low_stock: "low_stock_channels",
  order_approval: "order_approval_channels",
  delivery: "delivery_channels",
  financial_reports: "financial_reports_channels",
  inequality_alerts: "inequality_alerts_channels",
  calendar_reminders: "calendar_reminders_channels",
};

async function emailFor(prefs: Row | null, category: any) {
  const { service } = makeResolver(tables(prefs));
  return service.resolveRecipients({
    restaurantId: HOUSE,
    roles: ["manager"],
    category,
    channels: ["email"],
    allowDefaultFallback: false,
  });
}

describe("an unmapped category is refused, not defaulted", () => {
  it.each([[undefined], ["marketing"], [""], ["low_stock_channels"]])(
    "[REVERT-FAILS] refuses category %p and reads nothing",
    async (category) => {
      const touched: string[] = [];
      const { service, logs } = makeResolver(tables(STOCK_ROW), { touched });
      await expect(
        service.resolveRecipients({
          restaurantId: HOUSE,
          roles: ["manager"],
          category: category as any,
          channels: ["email"],
        }),
      ).rejects.toBeInstanceOf(UnmappedNotificationCategoryError);
      expect(touched).toEqual([]);
      expect(logs.join("\n")).toMatch(/RECIPIENTS_REFUSED/);
    },
  );

  it("[REVERT-FAILS] a refusal never becomes the legacy env fallback", async () => {
    // The resolver's try/catch turns a FAILURE into MANAGER_EMAIL for the
    // legacy tenant. A refusal must not be caught by it.
    const { service } = makeResolver(tables(STOCK_ROW), {
      legacyHouse: HOUSE,
    });
    await expect(
      service.resolveRecipients({
        restaurantId: HOUSE,
        roles: ["manager"],
        category: "everything" as any,
        channels: ["email"],
        allowDefaultFallback: true,
      }),
    ).rejects.toThrow(/not mapped/);
  });
});

describe("gate 2 reads the named category's array and no other", () => {
  it.each(NOTIFICATION_CATEGORIES.map((c) => [c]))(
    "[REVERT-FAILS] %s: email follows its own array alone",
    async (category) => {
      // Every OTHER array says email; this one does not. The union said yes.
      const refusing: Row = { email_enabled: true };
      for (const c of NOTIFICATION_CATEGORIES) {
        refusing[COLUMN[c]] = c === category ? ["push"] : ["email"];
      }
      expect((await emailFor(refusing, category)).emails).toEqual([]);

      // And the mirror: only this array says email; the others do not.
      const allowing: Row = { email_enabled: true };
      for (const c of NOTIFICATION_CATEGORIES) {
        allowing[COLUMN[c]] = c === category ? ["email"] : ["push"];
      }
      expect((await emailFor(allowing, category)).emails).toEqual([EMAIL]);
    },
  );

  it("[REVERT-FAILS] email for financial reports no longer switches on low-stock email (the OD-121 symptom)", async () => {
    const prefs = {
      email_enabled: true,
      low_stock_channels: ["push"],
      financial_reports_channels: ["email"],
    };
    expect((await emailFor(prefs, "financial_reports")).emails).toEqual([
      EMAIL,
    ]);
    expect((await emailFor(prefs, "low_stock")).emails).toEqual([]);
  });

  it("an absent array expresses nothing, and gate 1 decides (both states)", async () => {
    expect(
      (await emailFor({ email_enabled: true }, "delivery")).emails,
    ).toEqual([EMAIL]);
    expect(
      (await emailFor({ email_enabled: false }, "delivery")).emails,
    ).toEqual([]);
  });

  it("gate 1 still wins over an array that names the channel (both states)", async () => {
    const res = await emailFor(
      { email_enabled: false, delivery_channels: ["email"] },
      "delivery",
    );
    expect(res.emails).toEqual([]);
  });
});

describe("what the category-aware gate does to a stock production row (ADR 0022's check)", () => {
  // ADR 0022: "a category-aware gate must not be shipped without first checking
  // it does not silence this tenant". Checked here, over the measured row. The
  // answer is that it DOES silence one thing — low-stock email — and that is
  // stated in OD-121's amendment and the build report, not discovered later.
  const EXPECTED: Record<NotificationCategory, boolean> = {
    low_stock: false,
    order_approval: true,
    delivery: true,
    financial_reports: true,
    inequality_alerts: false,
    calendar_reminders: true,
  };

  it.each(NOTIFICATION_CATEGORIES.map((c) => [c, EXPECTED[c]]))(
    "%s → email delivered: %p",
    async (category, delivered) => {
      const res = await emailFor(STOCK_ROW, category);
      expect(res.emails).toEqual(delivered ? [EMAIL] : []);
      // A withheld address is COUNTED as declined, never reported as nobody.
      expect(res.declined).toEqual({ email: delivered ? 0 : 1, sms: 0 });
    },
  );

  it("[REVERT-FAILS] a low-stock email on a stock row is recorded as declined_by_preference, not no_recipients", async () => {
    // The REAL resolver behind the REAL LowStockAlertsService, over the stock
    // row. Before OD-121 this row delivered through the union.
    const { service: resolver } = makeResolver(tables(STOCK_ROW));
    const { email, gmail } = await digestOutcome(resolver);
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    expect(email).toMatchObject({
      ok: false,
      error: "declined_by_preference",
      recipients: 0,
    });
  });
});

/**
 * Run the REAL LowStockAlertsService digest over the given resolver and return
 * the email outcome it stamped on the notification row.
 */
async function digestOutcome(resolver: RecipientResolverService) {
    const updates: Row[] = [];
    const db = {
      supabase: {
        from: (table: string) => {
          const q: any = {
            select: () => q,
            in: () =>
              table === "notifications"
                ? Promise.resolve({
                    data: [{ id: "n-1", delivery_status: null }],
                    error: null,
                  })
                : q,
            update: (patch: Row) => ({
              eq: () => {
                updates.push(patch);
                return Promise.resolve({ error: null });
              },
            }),
            upsert: () => Promise.resolve({ error: null }),
            then: (resolve: any) => resolve({ data: [], error: null }),
          };
          return q;
        },
      },
    } as any;
    const gmail = { sendLowStockDigest: jest.fn(async () => ({})) };
    const lowStock = new LowStockAlertsService(
      db,
      {
        persistForRestaurant: jest.fn(async () => ({
          inserted: 1,
          ids: ["n-1"],
        })),
      } as any,
      { get: () => "" } as any,
      gmail as any,
      resolver,
    );
    jest.spyOn((lowStock as any).logger, "log").mockImplementation(() => {});
    jest.spyOn((lowStock as any).logger, "warn").mockImplementation(() => {});
    jest.spyOn((lowStock as any).logger, "error").mockImplementation(() => {});

    await lowStock.sendDigest(
      HOUSE,
      [
        {
          inventoryId: "inv-1",
          wineId: "w-1",
          wineName: "Barolo",
          currentStock: 1,
          threshold: 6,
          severity: "critical",
        } as any,
      ],
      "House A",
    );

    return { email: updates[0]?.delivery_status?.email, gmail };
}

describe("who is resolved, and a failed read is not a preference", () => {
  it("[REVERT-FAILS] the preference read IS narrowed to one house (ADR 0149 row 39, 2026-09-18)", async () => {
    // Was: "the preference read is NOT narrowed to one house while the
    // per-user fork is open (ADR 0027 §3)" — that fork is settled. Founder
    // answer, row 39: preferences are per person PER HOUSE. The person's row
    // names house B, so it must NOT decide anything about house A: with no
    // row for house A, the default (email allowed) applies instead of house
    // B's `email_enabled: false`.
    const { service } = makeResolver({
      ...tables(null),
      notification_preferences: [
        {
          user_id: USER,
          restaurant_id: OTHER_HOUSE,
          email_enabled: false,
        },
      ],
    });
    const res = await service.resolveRecipients({
      restaurantId: HOUSE,
      roles: ["manager"],
      category: "low_stock",
      channels: ["email"],
      allowDefaultFallback: false,
    });
    expect(res.emails).toEqual([EMAIL]);
    expect(res.declined).toEqual({ email: 0, sms: 0 });
  });

  it("[REVERT-FAILS] a member whose access was ended is not resolved", async () => {
    const { service } = makeResolver({
      ...tables(null),
      user_restaurant_access: [
        {
          user_id: USER,
          role: "manager",
          restaurant_id: HOUSE,
          is_active: false,
        },
      ],
    });
    const res = await service.resolveRecipients({
      restaurantId: HOUSE,
      roles: ["manager"],
      category: "delivery",
      channels: ["email"],
      allowDefaultFallback: false,
    });
    expect(res.emails).toEqual([]);
  });

  it("[REVERT-FAILS] an unreadable preferences table sends to nobody, not to everybody", async () => {
    // Pre-fix the error was swallowed as "no preferences", and no preferences
    // means every channel allowed — an outage re-enabled every opt-out.
    const { service, logs } = makeResolver(
      tables({ email_enabled: false }),
      { failing: ["notification_preferences"] },
    );
    const res = await service.resolveRecipients({
      restaurantId: HOUSE,
      roles: ["manager"],
      category: "delivery",
      channels: ["email"],
      allowDefaultFallback: false,
    });
    expect(res.emails).toEqual([]);
    expect(logs.join("\n")).toMatch(/notification_preferences read failed/);
  });

  it.each([
    ["user_restaurant_access"],
    ["notification_preferences"],
    ["users"],
  ])(
    "[REVIEW-FAILS] an unreadable %s is reported as a failed lookup, never as an empty answer",
    async (table) => {
      const { service } = makeResolver(tables(STOCK_ROW), { failing: [table] });
      const res = await service.resolveRecipients({
        restaurantId: HOUSE,
        roles: ["manager"],
        category: "delivery",
        channels: ["email"],
        allowDefaultFallback: false,
      });
      expect(res.emails).toEqual([]);
      expect(res.lookupFailed?.reason).toMatch(new RegExp(`read failed: ${table} is unreachable`));
    },
  );

  it("[REVIEW-FAILS] the legacy house still gets its env address on a failed read, and is told the read failed", async () => {
    const { service } = makeResolver(tables(STOCK_ROW), {
      failing: ["notification_preferences"],
      legacyHouse: HOUSE,
    });
    const res = await service.resolveRecipients({
      restaurantId: HOUSE,
      roles: ["manager"],
      category: "delivery",
      channels: ["email"],
      allowDefaultFallback: true,
    });
    expect(res.emails).toEqual(["founder@legacy.test"]);
    expect(res.lookupFailed?.reason).toMatch(/notification_preferences read failed/);
  });

  it("a successful read carries no failure marker (both states)", async () => {
    const res = await emailFor(STOCK_ROW, "delivery");
    expect(res.emails).toEqual([EMAIL]);
    expect(res.lookupFailed).toBeUndefined();
  });

  it("[REVIEW-FAILS] the low-stock digest records recipient_lookup_failed, not no_recipients, when preferences cannot be read", async () => {
    const { service: resolver } = makeResolver(tables(STOCK_ROW), {
      failing: ["notification_preferences"],
    });
    const { email, gmail } = await digestOutcome(resolver);
    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    expect(email).toMatchObject({
      ok: false,
      error: "recipient_lookup_failed",
      recipients: 0,
    });
  });

  it.each([
    ["past valid_until", { valid_until: "2020-01-01T00:00:00Z" }],
    ["future valid_from", { valid_from: "2999-01-01T00:00:00Z" }],
    ["unparseable valid_until", { valid_until: "not a date" }],
  ])(
    "[REVIEW-FAILS] a membership with a %s is not resolved (the one membership predicate)",
    async (_label, window) => {
      const { service } = makeResolver({
        ...tables(null),
        user_restaurant_access: [
          {
            user_id: USER,
            role: "manager",
            restaurant_id: HOUSE,
            is_active: true,
            ...window,
          },
        ],
      });
      const res = await service.resolveRecipients({
        restaurantId: HOUSE,
        roles: ["manager"],
        category: "delivery",
        channels: ["email"],
        allowDefaultFallback: false,
      });
      expect(res.emails).toEqual([]);
      expect(res.lookupFailed).toBeUndefined();
    },
  );

  it("a membership inside its window is resolved (both states)", async () => {
    const { service } = makeResolver({
      ...tables(null),
      user_restaurant_access: [
        {
          user_id: USER,
          role: "manager",
          restaurant_id: HOUSE,
          is_active: true,
          valid_from: "2020-01-01T00:00:00Z",
          valid_until: "2999-01-01T00:00:00Z",
        },
      ],
    });
    const res = await service.resolveRecipients({
      restaurantId: HOUSE,
      roles: ["manager"],
      category: "delivery",
      channels: ["email"],
      allowDefaultFallback: false,
    });
    expect(res.emails).toEqual([EMAIL]);
  });
});

describe("every send names its category, from one table", () => {
  const SRC = path.resolve(__dirname, "..");

  function codeOf(file: string): string {
    return fs
      .readFileSync(path.join(SRC, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  it("[REVERT-FAILS] the mapping is exactly the founder-reviewable table", () => {
    // Pinned in full so a change to any send's category is a deliberate edit
    // of this file, not a drive-by in a service.
    expect(NOTIFICATION_SEND_CATEGORY).toEqual({
      "daily-sms-summary": "financial_reports",
      "weekly-email-report": "financial_reports",
      "midday-low-stock-report": "low_stock",
      "low-stock-alerts": "low_stock",
      "recurring-order-reminder": "order_approval",
      "delivery-eta-notification": "delivery",
      "inventory-audit-reminder": "calendar_reminders",
      "event-prep-check": "calendar_reminders",
      "custom-reminders-check": "calendar_reminders",
      "low-stock-digest": "low_stock",
      "experiment-ended": "financial_reports",
    });
  });

  it("[REVERT-FAILS] each scheduled job passes its own job name as the send", () => {
    const code = codeOf("communications/scheduled-tasks.service.ts");
    const jobs = [...code.matchAll(/runPerTenant\(\s*"([a-z-]+)"/g)].map(
      (m) => ({ name: m[1], at: m.index! }),
    );
    const calls = [
      ...code.matchAll(
        /this\.recipientsFor\(tenant, \{\s*send: "([a-z-]+)"/g,
      ),
    ].map((m) => ({ send: m[1], at: m.index! }));
    const allCalls = [...code.matchAll(/this\.recipientsFor\(/g)];

    expect(allCalls.length).toBe(9); // re-measured 2026-09-16; never vacuous
    expect(calls.length).toBe(allCalls.length);
    for (const call of calls) {
      const job = jobs.filter((j) => j.at < call.at).pop();
      expect(call.send).toBe(job?.name);
      expect(Object.keys(NOTIFICATION_SEND_CATEGORY)).toContain(call.send);
    }
  });

  it("[REVERT-FAILS] every resolveRecipients call outside the resolver names a category", () => {
    const files = [
      "communications/scheduled-tasks.service.ts",
      "notifications/low-stock-alerts.service.ts",
      "notifications/producers/experiment-ended.producer.ts",
    ];

    // The list above is the WHOLE list: a new caller anywhere in the gateway
    // fails here until it is added and given a category.
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".spec.ts") &&
          entry.name !== "recipient-resolver.service.ts" &&
          /\.resolveRecipients\(/.test(fs.readFileSync(full, "utf8"))
        ) {
          callers.push(path.relative(SRC, full));
        }
      }
    };
    walk(SRC);
    expect(callers.sort()).toEqual([...files].sort());

    let seen = 0;
    for (const file of files) {
      const code = codeOf(file);
      for (const m of code.matchAll(/resolveRecipients\(\{([\s\S]*?)\}\)/g)) {
        seen += 1;
        expect(m[1]).toMatch(/category:\s*NOTIFICATION_SEND_CATEGORY/);
      }
    }
    expect(seen).toBe(3);
  });
});
